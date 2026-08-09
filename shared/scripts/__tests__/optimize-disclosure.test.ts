/**
 * Tests for the progressive-disclosure optimizer's decision-making.
 *
 * Nothing here spawns `claude`. Every rule the loop applies -- what counts as a pull,
 * what a pull rate means, which restructures get proposed, which one wins on the held-out
 * split, and when the guardrail refuses -- is a pure function of data, and that is
 * deliberate: a decision reachable only by spending an hour of API time is a decision
 * with no coverage.
 *
 * The stream reader is driven with synthetic event lines rather than a real transcript,
 * the same way `measure-triggering-harness.test.ts` covers the trigger reader. Skill trees that
 * need to exist on disk are built in a temp directory rather than committed, which is
 * the pattern that file already establishes -- a committed fixture `SKILL.md` inside this
 * skill would be a second skill in the tree for anything that goes looking.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";

import {
  applyEdits,
  bodyPointsAt,
  bodySections,
  computeFileStats,
  createRunCollector,
  decideFileVerdict,
  estimateTokens,
  estimatingCounter,
  generateCandidates,
  inventoryBundledFiles,
  loadModeOf,
  loadTokenCounter,
  parseExtractionProposal,
  parseGrading,
  parseScenarioSet,
  referencePathFor,
  scoreRuns,
  selectCandidate,
  shortlistExtractions,
  splitScenarios,
  splitSkillMd,
  sumUsage,
  trainGate,
  type BundledFile,
  type DisclosureCandidate,
  type FileStat,
  type ScenarioRun,
  type ScoredCandidate,
  type SplitScore,
} from "../lib/disclosure.ts";
import {
  generateDisclosureReport,
  type IterationRecord,
} from "../lib/disclosure-report.ts";
import { parseArgs } from "../lib/cli.ts";
import {
  ENVELOPE_FILENAME,
  installConflict,
  readEnvelope,
  validateEnvelope,
  writeEnvelope,
} from "../lib/envelope.ts";
import {
  buildDisclosureEnvelope,
  classifyRun,
  createRunTally,
  DEFAULT_GRADER_MODEL,
  materializeCandidate,
  measureWithGate,
  OPTIMIZE_FLAGS,
  TIMEOUT_ERROR_PREFIX,
  type DisclosureEnvelopeInput,
  type OptimizeOutput,
} from "../optimize-disclosure.ts";
import { flagString } from "../measure-triggering.ts";

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function run(overrides: Partial<ScenarioRun> = {}): ScenarioRun {
  return {
    scenarioId: "s1",
    attempt: 1,
    filesRead: [],
    skillLoaded: true,
    contextTokens: 1000,
    assertionsPassed: 2,
    assertionsTotal: 2,
    ...overrides,
  };
}

function bundled(path: string, overrides: Partial<BundledFile> = {}): BundledFile {
  return {
    path,
    loadMode: loadModeOf(path),
    bytes: 100,
    tokens: 250,
    signposted: true,
    ...overrides,
  };
}

function score(overrides: Partial<SplitScore> = {}): SplitScore {
  return {
    scenarios: 2,
    runs: 4,
    assertionsPassed: 8,
    assertionsTotal: 8,
    passRate: 1,
    meanContextTokens: 10_000,
    runsWithoutSkill: 0,
    ...overrides,
  };
}

function candidate(id: string): DisclosureCandidate {
  return { id, summary: id, rationale: "because", edits: [] };
}

function scored(
  id: string,
  parts: { train?: Partial<SplitScore>; holdout?: Partial<SplitScore>; bodyTokens?: number },
): ScoredCandidate {
  return {
    candidate: candidate(id),
    bodyTokens: parts.bodyTokens ?? 4000,
    train: score(parts.train),
    holdout: score(parts.holdout),
  };
}

// ---------------------------------------------------------------------------
// Token counting
// ---------------------------------------------------------------------------

describe("token counting", () => {
  test("the fallback is the documented characters-over-four estimator", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    // Rounded up, because a partial token still costs a whole one.
    expect(estimateTokens("abcde")).toBe(2);
  });

  test("the estimator declares itself an estimate, which the report repeats", () => {
    const counter = estimatingCounter();
    expect(counter.estimated).toBe(true);
    expect(counter.method).toBe("estimator:chars-over-4");
  });

  test("the loaded counter's estimated flag always agrees with its method", async () => {
    // Asserted as an invariant rather than pinned to one branch: `tiktoken` is a
    // devDependency, so this suite has it and a fresh checkout of the skill alone does
    // not. Both outcomes are correct; a counter that lies about which one it is, is not.
    const counter = await loadTokenCounter();
    expect(counter.count("hello world")).toBeGreaterThan(0);
    expect(counter.estimated).toBe(counter.method === "estimator:chars-over-4");
  });
});

// ---------------------------------------------------------------------------
// SKILL.md structure
// ---------------------------------------------------------------------------

describe("splitSkillMd", () => {
  test("separates frontmatter from the body so only the body is charged", () => {
    const { frontmatter, body } = splitSkillMd("---\nname: x\ndescription: y\n---\n\n# Title\n");
    expect(frontmatter).toBe("---\nname: x\ndescription: y\n---\n");
    expect(body).toBe("\n# Title\n");
  });

  test("a file with no frontmatter is all body", () => {
    expect(splitSkillMd("# Title\n").frontmatter).toBe("");
    expect(splitSkillMd("# Title\n").body).toBe("# Title\n");
  });
});

describe("bodySections", () => {
  const body = [
    "# Title",
    "",
    "## Alpha",
    "prose",
    "",
    "### Alpha detail",
    "more prose",
    "",
    "## Beta",
    "```bash",
    "# not a heading",
    "```",
    "tail",
  ].join("\n");

  test("a section owns its subsections, so an extraction moves a coherent unit", () => {
    const sections = bodySections(body, estimatingCounter());
    const alpha = sections.find((section) => section.heading === "Alpha");
    expect(alpha?.level).toBe(2);
    expect(alpha?.text).toContain("### Alpha detail");
    expect(alpha?.text).not.toContain("## Beta");
  });

  test("a comment inside a fenced block does not open a phantom section", () => {
    const headings = bodySections(body, estimatingCounter()).map((section) => section.heading);
    expect(headings).toEqual(["Alpha", "Alpha detail", "Beta"]);
  });

  test("the H1 is not a section: the whole body is not a candidate for extraction", () => {
    expect(bodySections(body, estimatingCounter()).some((s) => s.heading === "Title")).toBe(false);
  });
});

describe("shortlistExtractions", () => {
  test("drops sections too small to pay for the tool call, biggest first", () => {
    const sections = bodySections(
      ["## Small", "x", "## Large", "y".repeat(2000), "## Medium", "z".repeat(1200)].join("\n"),
      estimatingCounter(),
    );
    const shortlist = shortlistExtractions(sections, 250);
    expect(shortlist.map((section) => section.heading)).toEqual(["Large", "Medium"]);
  });
});

// ---------------------------------------------------------------------------
// Signposting and load mode
// ---------------------------------------------------------------------------

describe("bodyPointsAt", () => {
  test("matches a link target, a backticked path and a bare mention", () => {
    expect(bodyPointsAt("See [the guide](references/guide.md).", "references/guide.md")).toBe(true);
    expect(bodyPointsAt("Read `references/guide.md` first.", "references/guide.md")).toBe(true);
    expect(bodyPointsAt("Detail lives in references/guide.md today.", "references/guide.md")).toBe(true);
    expect(bodyPointsAt("${CLAUDE_SKILL_DIR}/references/guide.md", "references/guide.md")).toBe(true);
  });

  test("does not match a longer path that merely contains it", () => {
    expect(bodyPointsAt("see references/guide.md.bak", "references/guide.md")).toBe(false);
    expect(bodyPointsAt("see old-references/guide.md", "references/guide.md")).toBe(false);
  });
});

describe("loadModeOf", () => {
  test("the directory decides the load mode, which is what the verdicts key on", () => {
    expect(loadModeOf("references/a.md")).toBe("read");
    expect(loadModeOf("examples/a.md")).toBe("specimen");
    expect(loadModeOf("scripts/a.ts")).toBe("execute");
    expect(loadModeOf("assets/a.html")).toBe("copy");
    expect(loadModeOf("LICENSE")).toBe("root");
  });
});

// ---------------------------------------------------------------------------
// Pull rates
// ---------------------------------------------------------------------------

describe("computeFileStats", () => {
  const inventory = [bundled("references/always.md"), bundled("references/rare.md")];

  test("the denominator is runs that loaded the skill, not runs attempted", () => {
    const stats = computeFileStats(inventory, [
      run({ filesRead: ["references/always.md"] }),
      run({ attempt: 2, filesRead: ["references/always.md"] }),
      // Never loaded the body, so it never had a pointer to follow. Counting it would
      // report 2/3 for a reference that is pulled every time the skill is actually used.
      run({ attempt: 3, skillLoaded: false }),
      // Never happened at all. Silence is not evidence of absence.
      run({ attempt: 4, error: "timed out" }),
    ]);
    const always = stats.find((file) => file.path === "references/always.md");
    expect(always?.countedRuns).toBe(2);
    expect(always?.pulls).toBe(2);
    expect(always?.pullRate).toBe(1);
  });

  test("a file read twice in one run is one pull, not two", () => {
    const stats = computeFileStats(inventory, [
      run({ filesRead: ["references/rare.md", "references/rare.md"] }),
      run({ attempt: 2 }),
    ]);
    expect(stats.find((file) => file.path === "references/rare.md")?.pulls).toBe(1);
    expect(stats.find((file) => file.path === "references/rare.md")?.pullRate).toBe(0.5);
  });

  test("with no usable runs nothing is concluded about anything", () => {
    const stats = computeFileStats(inventory, [run({ error: "spawn failed" })]);
    expect(stats.every((file) => file.countedRuns === 0)).toBe(true);
    expect(stats.every((file) => file.verdict === "keep")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The decision rule
// ---------------------------------------------------------------------------

describe("decideFileVerdict", () => {
  const base = { countedRuns: 10, signposted: true, loadMode: "read" as const };

  test("a reference pulled on nearly every run is body content arriving late", () => {
    expect(decideFileVerdict({ ...base, pulls: 9, pullRate: 0.9 }, 0.8)).toBe("inline");
    expect(decideFileVerdict({ ...base, pulls: 8, pullRate: 0.8 }, 0.8)).toBe("inline");
  });

  test("a reference pulled some of the time is exactly what deferral is for", () => {
    expect(decideFileVerdict({ ...base, pulls: 5, pullRate: 0.5 }, 0.8)).toBe("keep");
    expect(decideFileVerdict({ ...base, pulls: 1, pullRate: 0.1 }, 0.8)).toBe("keep");
  });

  test("never pulled splits on signposting, because the two need different fixes", () => {
    expect(decideFileVerdict({ ...base, pulls: 0, pullRate: 0 }, 0.8)).toBe("prune");
    expect(decideFileVerdict({ ...base, pulls: 0, pullRate: 0, signposted: false }, 0.8)).toBe(
      "signpost",
    );
  });

  test("a script that nobody read is working correctly, not dead weight", () => {
    // The rule that would delete it read-mode-first is the reason load mode is checked
    // before the pull rate: a `scripts/` file's text is never supposed to enter context.
    expect(decideFileVerdict({ ...base, pulls: 0, pullRate: 0, loadMode: "execute" }, 0.8)).toBe(
      "keep",
    );
    expect(decideFileVerdict({ ...base, pulls: 0, pullRate: 0, loadMode: "copy" }, 0.8)).toBe("keep");
  });

  test("a script that WAS read is misfiled, or the body asks for the wrong verb", () => {
    expect(decideFileVerdict({ ...base, pulls: 4, pullRate: 0.4, loadMode: "execute" }, 0.8)).toBe(
      "misfiled",
    );
  });

  test("no measurement, no verdict", () => {
    expect(decideFileVerdict({ ...base, countedRuns: 0, pulls: 0, pullRate: 0 }, 0.8)).toBe("keep");
  });

  test("the threshold is a parameter, so a tighter run can demand more evidence", () => {
    expect(decideFileVerdict({ ...base, pulls: 9, pullRate: 0.9 }, 0.95)).toBe("keep");
  });
});

// ---------------------------------------------------------------------------
// Candidate generation
// ---------------------------------------------------------------------------

describe("generateCandidates", () => {
  const sections = bodySections(
    ["## Rare workflow", "prose ".repeat(300), "## Core", "prose"].join("\n"),
    estimatingCounter(),
  );
  const files = computeFileStats(
    [
      bundled("references/always.md"),
      bundled("references/second.md"),
      bundled("references/dead.md"),
      bundled("references/hidden.md", { signposted: false }),
      bundled("scripts/tool.ts"),
    ],
    [
      run({ filesRead: ["references/always.md", "references/second.md"] }),
      run({ attempt: 2, filesRead: ["references/always.md", "references/second.md"] }),
    ],
  );

  test("extractions come first: they cut the bill every invocation pays", () => {
    const candidates = generateCandidates({
      files,
      sections,
      extractions: [{ heading: "Rare workflow", reason: "only the migration path needs it" }],
      maxCandidates: 10,
      alreadyTried: new Set(),
    });
    expect(candidates[0]?.id).toBe("extract:Rare workflow");
    expect(candidates[0]?.edits[0]).toEqual({
      kind: "extract",
      heading: "Rare workflow",
      toPath: "references/rare-workflow.md",
    });
  });

  test("an always-pulled reference becomes an inline candidate", () => {
    const candidates = generateCandidates({
      files,
      sections,
      extractions: [],
      maxCandidates: 10,
      alreadyTried: new Set(),
    });
    expect(candidates.map((entry) => entry.id)).toContain("inline:references/always.md");
  });

  test("inlining both is offered as its own layout, not implied by inlining each", () => {
    const candidates = generateCandidates({
      files,
      sections,
      extractions: [],
      maxCandidates: 10,
      alreadyTried: new Set(),
    });
    const all = candidates.find((entry) => entry.id.startsWith("inline-all:"));
    expect(all?.edits).toHaveLength(2);
  });

  test("a signposted file nobody read becomes a deletion to test", () => {
    const candidates = generateCandidates({
      files,
      sections,
      extractions: [],
      maxCandidates: 10,
      alreadyTried: new Set(),
    });
    expect(candidates.map((entry) => entry.id)).toContain("prune:references/dead.md");
  });

  test("an unsignposted file produces no edit: the fix is a sentence, not a deletion", () => {
    const candidates = generateCandidates({
      files,
      sections,
      extractions: [],
      maxCandidates: 10,
      alreadyTried: new Set(),
    });
    expect(candidates.some((entry) => entry.id.includes("hidden.md"))).toBe(false);
    // It is still a finding -- the verdict is what the report renders.
    expect(files.find((file) => file.path === "references/hidden.md")?.verdict).toBe("signpost");
  });

  test("a script is never proposed for inlining or deletion", () => {
    const candidates = generateCandidates({
      files,
      sections,
      extractions: [],
      maxCandidates: 10,
      alreadyTried: new Set(),
    });
    expect(candidates.some((entry) => entry.id.includes("scripts/tool.ts"))).toBe(false);
  });

  test("an extraction naming a section that does not exist is dropped", () => {
    const candidates = generateCandidates({
      files,
      sections,
      extractions: [{ heading: "Nonexistent", reason: "hallucinated" }],
      maxCandidates: 10,
      alreadyTried: new Set(),
    });
    expect(candidates.some((entry) => entry.id === "extract:Nonexistent")).toBe(false);
  });

  test("a candidate already measured is not proposed again", () => {
    const candidates = generateCandidates({
      files,
      sections,
      extractions: [],
      maxCandidates: 10,
      alreadyTried: new Set(["inline:references/always.md"]),
    });
    expect(candidates.map((entry) => entry.id)).not.toContain("inline:references/always.md");
  });

  test("the budget caps how many layouts an iteration will pay to measure", () => {
    const candidates = generateCandidates({
      files,
      sections,
      extractions: [],
      maxCandidates: 2,
      alreadyTried: new Set(),
    });
    expect(candidates).toHaveLength(2);
  });
});

describe("referencePathFor", () => {
  test("slugs the heading and steps around a name already in use", () => {
    expect(referencePathFor("Rare Workflow!", new Set())).toBe("references/rare-workflow.md");
    expect(referencePathFor("Rare Workflow", new Set(["references/rare-workflow.md"]))).toBe(
      "references/rare-workflow-2.md",
    );
  });
});

// ---------------------------------------------------------------------------
// Rewriting a layout
// ---------------------------------------------------------------------------

const SKILL_MD = [
  "---",
  "name: demo",
  "description: does a thing",
  "---",
  "",
  "# Demo",
  "",
  "## Setup",
  "",
  "Install the thing first.",
  "",
  "More setup prose that only a minority of runs need.",
  "",
  "## Deep detail",
  "",
  "See `references/deep.md` for the full rules.",
  "",
  "## Legacy",
  "",
  "Historical notes live in `references/legacy.md`.",
  "",
].join("\n");

describe("applyEdits", () => {
  test("an extraction leaves the heading, a lead sentence and a pointer", () => {
    const result = applyEdits({
      skillMd: SKILL_MD,
      fileContents: new Map(),
      edits: [{ kind: "extract", heading: "Setup", toPath: "references/setup.md" }],
    });
    expect(result.skillMd).toContain("## Setup");
    expect(result.skillMd).toContain("Install the thing first.");
    expect(result.skillMd).toContain("`references/setup.md` carries the detail");
    // The detail itself is gone from the body -- which is the whole point.
    expect(result.skillMd).not.toContain("More setup prose");
    expect(result.writes.get("references/setup.md")).toContain("# Setup");
    expect(result.writes.get("references/setup.md")).toContain("More setup prose");
  });

  test("an extraction does not disturb the sections around it", () => {
    const result = applyEdits({
      skillMd: SKILL_MD,
      fileContents: new Map(),
      edits: [{ kind: "extract", heading: "Setup", toPath: "references/setup.md" }],
    });
    expect(result.skillMd).toContain("## Deep detail");
    expect(result.skillMd).toContain("## Legacy");
    expect(splitSkillMd(result.skillMd).frontmatter).toContain("name: demo");
  });

  test("an extraction naming no section is a note, not a silent no-op", () => {
    const result = applyEdits({
      skillMd: SKILL_MD,
      fileContents: new Map(),
      edits: [{ kind: "extract", heading: "Missing", toPath: "references/missing.md" }],
    });
    expect(result.skillMd).toBe(SKILL_MD);
    expect(result.notes.join(" ")).toContain('Skipped extract "Missing"');
  });

  test("an inline splices the reference in at its pointer and deletes the file", () => {
    const result = applyEdits({
      skillMd: SKILL_MD,
      fileContents: new Map([["references/deep.md", "# Deep\n\nThe full rules are these.\n"]]),
      edits: [{ kind: "inline", path: "references/deep.md" }],
    });
    expect(result.skillMd).toContain("The full rules are these.");
    // The reference's own H1 would nest a second title inside the body's outline.
    expect(result.skillMd).not.toContain("# Deep\n");
    expect(result.skillMd).not.toContain("references/deep.md");
    expect(result.deletes).toEqual(["references/deep.md"]);
  });

  test("an inline with no content supplied changes nothing and says so", () => {
    const result = applyEdits({
      skillMd: SKILL_MD,
      fileContents: new Map(),
      edits: [{ kind: "inline", path: "references/deep.md" }],
    });
    expect(result.skillMd).toBe(SKILL_MD);
    expect(result.notes.join(" ")).toContain("Skipped inline references/deep.md");
  });

  test("an inline with no pointer to replace appends, and flags the placement", () => {
    const body = "---\nname: demo\n---\n\n# Demo\n\nNothing points anywhere.\n";
    const result = applyEdits({
      skillMd: body,
      fileContents: new Map([["references/found.md", "Content that was found anyway.\n"]]),
      edits: [{ kind: "inline", path: "references/found.md" }],
    });
    expect(result.skillMd).toContain("Content that was found anyway.");
    expect(result.notes.join(" ")).toContain("nothing in the body pointed at it");
  });

  test("a prune removes the file and the lines that pointed at it", () => {
    const result = applyEdits({
      skillMd: SKILL_MD,
      fileContents: new Map(),
      edits: [{ kind: "prune", path: "references/legacy.md" }],
    });
    expect(result.skillMd).not.toContain("references/legacy.md");
    expect(result.skillMd).toContain("## Legacy");
    expect(result.deletes).toEqual(["references/legacy.md"]);
  });

  test("a wrapped pointer sentence is removed whole, not cut in half", () => {
    // Markdown prose is hard-wrapped, so the line holding the path is usually half a
    // sentence. Deleting only that line left the other half dangling mid-clause.
    const wrapped = [
      "---",
      "name: demo",
      "---",
      "",
      "# Demo",
      "",
      "The historical notes for the pre-2024 format are recorded in",
      "`references/legacy.md`, and nothing else needs them.",
      "",
      "Carry on.",
      "",
    ].join("\n");
    const result = applyEdits({
      skillMd: wrapped,
      fileContents: new Map(),
      edits: [{ kind: "prune", path: "references/legacy.md" }],
    });
    expect(result.skillMd).not.toContain("The historical notes");
    expect(result.skillMd).toContain("Carry on.");
    expect(result.skillMd).not.toMatch(/\n\n\n/);
  });

  test("a sentence naming two files is left alone, because losing the other pointer is silent", () => {
    const shared = [
      "---",
      "name: demo",
      "---",
      "",
      "# Demo",
      "",
      "The everyday rules live in `references/always.md`, and the historical notes are in",
      "`references/legacy.md`.",
      "",
    ].join("\n");
    const result = applyEdits({
      skillMd: shared,
      fileContents: new Map(),
      edits: [{ kind: "prune", path: "references/legacy.md" }],
    });
    // The surviving pointer matters more than the dangling one: a dangling reference is
    // flagged by validate-skill and the reviewer, a lost pointer is flagged by nothing.
    expect(result.skillMd).toContain("references/always.md");
    expect(result.notes.join(" ")).toContain("rewrite it before adopting this layout");
    // And it does not also claim to have removed prose it left in place.
    expect(result.notes.join(" ")).not.toContain("removed the prose that pointed at it");
  });

  test("the extraction pointer keeps a whole lead sentence, not a wrapped fragment", () => {
    const wrapped = [
      "---",
      "name: demo",
      "---",
      "",
      "## Migration",
      "",
      "This branch only matters when a caller is migrating from the legacy format, which is",
      "a minority of the work. More detail follows here.",
      "",
      "Another paragraph entirely.",
      "",
    ].join("\n");
    const result = applyEdits({
      skillMd: wrapped,
      fileContents: new Map(),
      edits: [{ kind: "extract", heading: "Migration", toPath: "references/migration.md" }],
    });
    expect(result.skillMd).toContain(
      "This branch only matters when a caller is migrating from the legacy format, which is a minority of the work.",
    );
  });

  test("edits apply in a fixed order regardless of how they were listed", () => {
    const edits = [
      { kind: "prune", path: "references/legacy.md" },
      { kind: "extract", heading: "Setup", toPath: "references/setup.md" },
    ] as const;
    const forward = applyEdits({ skillMd: SKILL_MD, fileContents: new Map(), edits: [...edits] });
    const reversed = applyEdits({
      skillMd: SKILL_MD,
      fileContents: new Map(),
      edits: [...edits].reverse(),
    });
    expect(forward.skillMd).toBe(reversed.skillMd);
  });
});

// ---------------------------------------------------------------------------
// Scoring and held-out selection
// ---------------------------------------------------------------------------

describe("scoreRuns", () => {
  test("errored runs are excluded from every figure they would distort", () => {
    const result = scoreRuns([
      run({ contextTokens: 1000, assertionsPassed: 2, assertionsTotal: 2 }),
      run({ attempt: 2, error: "timed out", contextTokens: 0, assertionsPassed: 0, assertionsTotal: 0 }),
    ]);
    expect(result.runs).toBe(1);
    expect(result.meanContextTokens).toBe(1000);
    expect(result.passRate).toBe(1);
  });

  test("a scenario set with no expectations reports a vacuous pass rate of 1", () => {
    // Named rather than hidden: with nothing asserted the guardrail cannot fire, which is
    // why the loop warns at startup instead of quietly optimizing against nothing.
    const result = scoreRuns([run({ assertionsPassed: 0, assertionsTotal: 0 })]);
    expect(result.assertionsTotal).toBe(0);
    expect(result.passRate).toBe(1);
  });

  test("runs that never loaded the skill are counted as a health signal", () => {
    const result = scoreRuns([run(), run({ attempt: 2, skillLoaded: false })]);
    expect(result.runsWithoutSkill).toBe(1);
  });
});

describe("selectCandidate", () => {
  const baseline = score({ passRate: 1, meanContextTokens: 10_000 });

  test("selection reads the held-out split, not the split that proposed the change", () => {
    // A wins on train and loses on held-out; B is the reverse. A layout tuned until it
    // aces the scenarios that motivated it has usually just memorized them, so B wins.
    const result = selectCandidate({
      baseline,
      baselineBodyTokens: 5000,
      candidates: [
        scored("A", { train: { meanContextTokens: 6000 }, holdout: { meanContextTokens: 9500 } }),
        scored("B", { train: { meanContextTokens: 9800 }, holdout: { meanContextTokens: 7000 } }),
      ],
    });
    expect(result.chosen?.candidate.id).toBe("B");
  });

  test("the guardrail refuses a cheaper layout that broke the work", () => {
    const result = selectCandidate({
      baseline,
      baselineBodyTokens: 5000,
      candidates: [
        scored("cheap-but-broken", {
          holdout: { meanContextTokens: 3000, passRate: 0.6, assertionsPassed: 6, assertionsTotal: 10 },
        }),
      ],
    });
    expect(result.chosen).toBeNull();
    expect(result.rejected[0]?.id).toBe("cheap-but-broken");
    expect(result.rejected[0]?.reason).toContain("pass rate");
  });

  test("the tolerance absorbs one flipped assertion and no more", () => {
    const withinTolerance = selectCandidate({
      baseline,
      baselineBodyTokens: 5000,
      candidates: [scored("nudge", { holdout: { meanContextTokens: 9000, passRate: 0.96 } })],
      passRateTolerance: 0.05,
    });
    expect(withinTolerance.chosen?.candidate.id).toBe("nudge");

    const beyondIt = selectCandidate({
      baseline,
      baselineBodyTokens: 5000,
      candidates: [scored("drop", { holdout: { meanContextTokens: 9000, passRate: 0.9 } })],
      passRateTolerance: 0.05,
    });
    expect(beyondIt.chosen).toBeNull();
  });

  test("a restructure that costs more context is not an optimization", () => {
    const result = selectCandidate({
      baseline,
      baselineBodyTokens: 5000,
      candidates: [scored("pricier", { holdout: { meanContextTokens: 12_000 } })],
    });
    expect(result.chosen).toBeNull();
    expect(result.rejected[0]?.reason).toContain("context cost rose");
  });

  test("ties break toward the higher pass rate, then the smaller body", () => {
    const result = selectCandidate({
      baseline,
      baselineBodyTokens: 5000,
      candidates: [
        scored("equal-low-pass", { holdout: { meanContextTokens: 8000, passRate: 0.98 } }),
        scored("equal-high-pass", { holdout: { meanContextTokens: 8000, passRate: 1 } }),
      ],
    });
    expect(result.chosen?.candidate.id).toBe("equal-high-pass");

    const bodyTie = selectCandidate({
      baseline,
      baselineBodyTokens: 5000,
      candidates: [
        scored("bigger-body", { holdout: { meanContextTokens: 8000 }, bodyTokens: 4500 }),
        scored("smaller-body", { holdout: { meanContextTokens: 8000 }, bodyTokens: 3000 }),
      ],
    });
    expect(bodyTie.chosen?.candidate.id).toBe("smaller-body");
  });

  test("with no holdout configured the train score is the only score there is", () => {
    const result = selectCandidate({
      baseline,
      baselineBodyTokens: 5000,
      candidates: [
        { candidate: candidate("train-only"), bodyTokens: 4000, train: score({ meanContextTokens: 8000 }), holdout: null },
      ],
    });
    expect(result.chosen?.candidate.id).toBe("train-only");
  });

  test("nothing proposed and nothing accepted read as different outcomes", () => {
    expect(selectCandidate({ baseline, baselineBodyTokens: 5000, candidates: [] }).reason).toBe(
      "no candidate was proposed",
    );
    const allRejected = selectCandidate({
      baseline,
      baselineBodyTokens: 5000,
      candidates: [scored("pricier", { holdout: { meanContextTokens: 12_000 } })],
    });
    expect(allRejected.reason).toContain("without regressing the work");
  });
});

// ---------------------------------------------------------------------------
// Scenarios and the split
// ---------------------------------------------------------------------------

describe("parseScenarioSet", () => {
  test("reads the evals.json shape the rest of the skill already uses", () => {
    const scenarios = parseScenarioSet(
      {
        skill_name: "invoice-parser",
        evals: [{ id: 1, prompt: "Pull the line items", expectations: ["A CSV is produced"] }],
      },
      "evals.json",
    );
    expect(scenarios).toEqual([
      { id: "1", prompt: "Pull the line items", expectations: ["A CSV is produced"] },
    ]);
  });

  test("reads a bare array, and names a scenario that carries no id", () => {
    const scenarios = parseScenarioSet([{ prompt: "Do the thing" }], "scenarios.json");
    expect(scenarios[0]?.id).toBe("scenario-1");
    expect(scenarios[0]?.expectations).toEqual([]);
  });

  test("rejects a malformed row at the boundary rather than thirty calls in", () => {
    expect(() => parseScenarioSet([{ prompt: "" }], "s.json")).toThrow(/no non-empty string/);
    expect(() => parseScenarioSet({}, "s.json")).toThrow(/expected a JSON array/);
  });
});

describe("splitScenarios", () => {
  const scenarios = Array.from({ length: 10 }, (_, index) => ({
    id: `s${index}`,
    prompt: `p${index}`,
    expectations: [],
  }));

  test("partitions with no overlap and no loss", () => {
    const [train, holdout] = splitScenarios(scenarios, 0.4);
    expect(train).toHaveLength(6);
    expect(holdout).toHaveLength(4);
    expect([...train, ...holdout].map((s) => s.id).sort()).toEqual(scenarios.map((s) => s.id).sort());
  });

  test("is deterministic, so two runs of one set agree on what was held out", () => {
    expect(splitScenarios(scenarios, 0.4)[1]).toEqual(splitScenarios(scenarios, 0.4)[1]);
  });

  test("holdout 0 disables the split entirely", () => {
    const [train, holdout] = splitScenarios(scenarios, 0);
    expect(train).toHaveLength(10);
    expect(holdout).toHaveLength(0);
  });

  test("a holdout that would round to zero still holds one back", () => {
    // A holdout rounding to zero silently turns held-out selection back into train
    // selection, which is the failure the split exists to prevent.
    const [, holdout] = splitScenarios(scenarios.slice(0, 3), 0.1);
    expect(holdout).toHaveLength(1);
  });

  test("a holdout that would take everything still leaves something to propose from", () => {
    const [train, holdout] = splitScenarios(scenarios.slice(0, 2), 0.9);
    expect(train).toHaveLength(1);
    expect(holdout).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Reading the stream
// ---------------------------------------------------------------------------

describe("createRunCollector", () => {
  const projectRoot = "/tmp/disclosure-root";
  const skillDir = `${projectRoot}/.claude/skills/demo-tab12cd`;

  function feed(lines: readonly unknown[]) {
    const collector = createRunCollector({ skillDir, projectRoot });
    for (const line of lines) collector.onLine(JSON.stringify(line));
    return collector.observation();
  }

  const readTool = (filePath: string) => ({
    type: "assistant",
    message: { content: [{ type: "tool_use", name: "Read", input: { file_path: filePath } }] },
  });

  test("a Read inside the skill directory is a pull, recorded relative to the skill", () => {
    const observed = feed([readTool(`${skillDir}/references/deep.md`)]);
    expect(observed.filesRead).toEqual(["references/deep.md"]);
  });

  test("a relative path is resolved against the run's working directory", () => {
    const observed = feed([readTool(".claude/skills/demo-tab12cd/references/deep.md")]);
    expect(observed.filesRead).toEqual(["references/deep.md"]);
  });

  test("a Read outside the skill is not a pull", () => {
    expect(feed([readTool("/etc/hosts"), readTool(`${projectRoot}/notes.md`)]).filesRead).toEqual([]);
  });

  test("reading SKILL.md is the body loading, not a pull against the body", () => {
    const observed = feed([readTool(`${skillDir}/SKILL.md`)]);
    expect(observed.skillLoaded).toBe(true);
    expect(observed.filesRead).toEqual([]);
  });

  test("the Skill tool naming this installation counts as the body loading", () => {
    const observed = feed([
      {
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Skill", input: { skill: "demo-tab12cd" } }] },
      },
    ]);
    expect(observed.skillLoaded).toBe(true);
  });

  test("the same file read twice is reported once", () => {
    const observed = feed([
      readTool(`${skillDir}/references/deep.md`),
      readTool(`${skillDir}/references/deep.md`),
    ]);
    expect(observed.filesRead).toEqual(["references/deep.md"]);
  });

  test("writes outside the skill are collected for the grader", () => {
    const observed = feed([
      {
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", name: "Write", input: { file_path: `${projectRoot}/out.csv` } },
            { type: "tool_use", name: "Edit", input: { file_path: `${skillDir}/SKILL.md` } },
          ],
        },
      },
    ]);
    expect(observed.filesWritten).toEqual([`${projectRoot}/out.csv`]);
  });

  test("the result event carries the token bill and the final text", () => {
    const observed = feed([
      {
        type: "result",
        subtype: "success",
        result: "Done, wrote out.csv",
        usage: {
          input_tokens: 100,
          output_tokens: 10,
          cache_creation_input_tokens: 200,
          cache_read_input_tokens: 5000,
          // A BREAKDOWN of cache_creation_input_tokens. Adding it would count the cached
          // prefix twice and inflate the number this loop exists to reduce.
          cache_creation: { ephemeral_5m_input_tokens: 200, ephemeral_1h_input_tokens: 0 },
        },
      },
    ]);
    expect(observed.contextTokens).toBe(5310);
    expect(observed.finalText).toBe("Done, wrote out.csv");
    expect(observed.resultSubtype).toBe("success");
  });

  test("a malformed line is skipped rather than ending the read", () => {
    const collector = createRunCollector({ skillDir, projectRoot });
    collector.onLine("not json at all");
    collector.onLine(JSON.stringify(readTool(`${skillDir}/references/deep.md`)));
    expect(collector.observation().filesRead).toEqual(["references/deep.md"]);
  });

  test("the handler never decides, so the stream is read to the end", () => {
    const collector = createRunCollector({ skillDir, projectRoot });
    expect(collector.onLine(JSON.stringify({ type: "result", usage: {} }))).toBeUndefined();
  });
});

describe("sumUsage", () => {
  test("adds the four top-level token fields and nothing else", () => {
    expect(sumUsage({ input_tokens: 1, output_tokens: 2 })).toBe(3);
    expect(sumUsage({ input_tokens: 1, service_tier: "standard", server_tool_use: {} })).toBe(1);
    expect(sumUsage(undefined)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Grading and proposals
// ---------------------------------------------------------------------------

describe("parseGrading", () => {
  const expectations = ["A CSV is produced", "Totals reconcile"];

  test("matches verdicts to expectations by exact text", () => {
    const grading = parseGrading(
      JSON.stringify([
        { text: "Totals reconcile", passed: false, evidence: "sum was off by 3" },
        { text: "A CSV is produced", passed: true, evidence: "out.csv exists" },
      ]),
      expectations,
    );
    expect(grading.verdicts[0]).toEqual({
      text: "A CSV is produced",
      passed: true,
      evidence: "out.csv exists",
    });
    expect(grading.passed).toBe(1);
    expect(grading.total).toBe(2);
  });

  test("falls back to position when the grader paraphrased the assertion", () => {
    const grading = parseGrading(
      JSON.stringify([
        { text: "csv produced", passed: true, evidence: "yes" },
        { text: "totals ok", passed: true, evidence: "yes" },
      ]),
      expectations,
    );
    expect(grading.passed).toBe(2);
    expect(grading.verdicts[0]?.text).toBe("A CSV is produced");
  });

  test("an expectation with no verdict is a fail, not a skip", () => {
    const grading = parseGrading(JSON.stringify([{ text: "A CSV is produced", passed: true }]), expectations);
    expect(grading.total).toBe(2);
    expect(grading.passed).toBe(1);
    expect(grading.verdicts[1]?.evidence).toBe("no verdict returned");
  });

  test("an unreadable answer fails every assertion, so the guardrail fails closed", () => {
    const grading = parseGrading("I could not grade this.", expectations);
    expect(grading.passed).toBe(0);
    expect(grading.total).toBe(2);
  });

  test("JSON wrapped in prose or a fence is still read", () => {
    const grading = parseGrading(
      'Here you go:\n```json\n[{"text":"A CSV is produced","passed":true,"evidence":"e"},' +
        '{"text":"Totals reconcile","passed":true,"evidence":"e"}]\n```\nHope that helps.',
      expectations,
    );
    expect(grading.passed).toBe(2);
  });
});

describe("parseExtractionProposal", () => {
  const sections = bodySections(["## Alpha", "a", "## Beta", "b"].join("\n"), estimatingCounter());

  test("keeps proposals naming a real section", () => {
    const proposals = parseExtractionProposal(
      JSON.stringify([{ heading: "Beta", reason: "only the migration path needs it" }]),
      sections,
    );
    expect(proposals).toEqual([{ heading: "Beta", reason: "only the migration path needs it" }]);
  });

  test("drops a heading that does not exist, rather than producing a candidate that no-ops", () => {
    expect(parseExtractionProposal(JSON.stringify([{ heading: "Gamma" }]), sections)).toEqual([]);
  });

  test("drops duplicates and survives an unreadable answer", () => {
    expect(
      parseExtractionProposal(JSON.stringify([{ heading: "Alpha" }, { heading: "Alpha" }]), sections),
    ).toHaveLength(1);
    expect(parseExtractionProposal("nothing structured here", sections)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The inventory, against a real tree
// ---------------------------------------------------------------------------

describe("inventoryBundledFiles", () => {
  let dir = "";

  beforeEach(async () => {
    dir = `${process.env["TMPDIR"] ?? "/tmp"}/disclosure-inv-${crypto.randomUUID().slice(0, 8)}`;
    await Bun.write(`${dir}/SKILL.md`, "---\nname: demo\n---\n\n# Demo\n\nSee `references/a.md`.\n");
    await Bun.write(`${dir}/references/a.md`, "# A\n\nreferenced\n");
    await Bun.write(`${dir}/references/b.md`, "# B\n\nnot referenced\n");
    await Bun.write(`${dir}/scripts/tool.ts`, "console.log('hi');\n");
    await Bun.write(`${dir}/scripts/__tests__/tool.test.ts`, "// harness, not skill surface\n");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("lists bundled files with load mode, cost and whether the body points at them", async () => {
    const body = splitSkillMd(await Bun.file(`${dir}/SKILL.md`).text()).body;
    const inventory = await inventoryBundledFiles(dir, body, estimatingCounter());
    const paths = inventory.map((file) => file.path);

    expect(paths).toContain("references/a.md");
    expect(paths).toContain("scripts/tool.ts");
    // SKILL.md is the body, not a bundled file; a test suite is harness, not skill surface.
    expect(paths).not.toContain("SKILL.md");
    expect(paths).not.toContain("scripts/__tests__/tool.test.ts");

    expect(inventory.find((file) => file.path === "references/a.md")?.signposted).toBe(true);
    expect(inventory.find((file) => file.path === "references/b.md")?.signposted).toBe(false);
    expect(inventory.find((file) => file.path === "scripts/tool.ts")?.loadMode).toBe("execute");
    expect(inventory.every((file) => file.tokens > 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Materializing a candidate on disk
// ---------------------------------------------------------------------------

describe("materializeCandidate", () => {
  let root = "";
  let source = "";

  beforeEach(async () => {
    root = `${process.env["TMPDIR"] ?? "/tmp"}/disclosure-mat-${crypto.randomUUID().slice(0, 8)}`;
    source = `${root}/source`;
    await Bun.write(`${source}/SKILL.md`, SKILL_MD);
    await Bun.write(`${source}/references/deep.md`, "# Deep\n\nThe full rules are these.\n");
    await Bun.write(`${source}/references/legacy.md`, "# Legacy\n\nOld notes.\n");
    await Bun.write(`${source}/scripts/tool.ts`, "console.log('hi');\n");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("writes the candidate into its own tree and leaves the source untouched", async () => {
    const dest = `${root}/cand-1/demo`;
    await materializeCandidate(source, dest, {
      id: "inline:references/deep.md",
      summary: "inline deep",
      rationale: "pulled every run",
      edits: [{ kind: "inline", path: "references/deep.md" }],
    });

    expect(await Bun.file(`${dest}/SKILL.md`).text()).toContain("The full rules are these.");
    expect(await Bun.file(`${dest}/references/deep.md`).exists()).toBe(false);
    // Everything the edit did not name travels with the copy.
    expect(await Bun.file(`${dest}/scripts/tool.ts`).exists()).toBe(true);

    // A loop that edited the artifact it is measuring would have destroyed its own
    // baseline, so this is the assertion that matters most in the whole file.
    expect(await Bun.file(`${source}/references/deep.md`).exists()).toBe(true);
    expect(await Bun.file(`${source}/SKILL.md`).text()).toBe(SKILL_MD);
  });

  test("an extraction lands as a new reference file beside the rewritten body", async () => {
    const dest = `${root}/cand-2/demo`;
    await materializeCandidate(source, dest, {
      id: "extract:Setup",
      summary: "extract Setup",
      rationale: "minority of runs",
      edits: [{ kind: "extract", heading: "Setup", toPath: "references/setup.md" }],
    });
    expect(await Bun.file(`${dest}/references/setup.md`).text()).toContain("More setup prose");
    expect(await Bun.file(`${dest}/SKILL.md`).text()).toContain("`references/setup.md` carries");
  });

  test("a prune deletes the file in the copy only", async () => {
    const dest = `${root}/cand-3/demo`;
    const notes = await materializeCandidate(source, dest, {
      id: "prune:references/legacy.md",
      summary: "delete legacy",
      rationale: "never read",
      edits: [{ kind: "prune", path: "references/legacy.md" }],
    });
    expect(await Bun.file(`${dest}/references/legacy.md`).exists()).toBe(false);
    expect(await Bun.file(`${source}/references/legacy.md`).exists()).toBe(true);
    expect(notes.join(" ")).toContain("Deleted references/legacy.md");
  });

  test("an inline naming a file that is not there is a note rather than a crash", async () => {
    const dest = `${root}/cand-4/demo`;
    const notes = await materializeCandidate(source, dest, {
      id: "inline:references/absent.md",
      summary: "inline absent",
      rationale: "stale measurement",
      edits: [{ kind: "inline", path: "references/absent.md" }],
    });
    expect(notes.join(" ")).toContain("Skipped inline references/absent.md");
    expect(await Bun.file(`${dest}/SKILL.md`).text()).toBe(SKILL_MD);
  });
});

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

describe("generateDisclosureReport", () => {
  const files = computeFileStats(
    [bundled("references/always.md"), bundled("references/hidden.md", { signposted: false })],
    [run({ filesRead: ["references/always.md"] })],
  );
  const base = {
    skillName: "demo",
    skillPath: "/skills/demo",
    tokenMethod: "tiktoken:cl100k_base" as const,
    estimatedTokens: false,
    baselineBodyTokens: 5000,
    bestBodyTokens: 4200,
    baselineContextTokens: 12_000,
    bestContextTokens: 10_500,
    holdoutFraction: 0.4,
    trainSize: 3,
    holdoutSize: 2,
    runsPerScenario: 2,
    files,
    iterations: [
      {
        iteration: 1,
        label: "baseline (as authored)",
        candidateId: null,
        rationale: "2 bundled file(s)",
        bodyTokens: 5000,
        train: score(),
        holdout: score(),
        accepted: true,
        note: "the layout every candidate is measured against",
      },
    ],
    exitReason: "max_iterations (3)",
    appliedTo: null,
  };

  test("uses the shared theme rather than a second look", () => {
    const html = generateDisclosureReport(base);
    expect(html).toContain('--good:#0070f3');
    expect(html).toContain("table.tbl");
    expect(html).toContain('data-theme');
  });

  test("shows every bundled file with its pull rate and verdict", () => {
    const html = generateDisclosureReport(base);
    expect(html).toContain("references/always.md");
    expect(html).toContain("references/hidden.md");
    expect(html).toContain(">inline<");
    expect(html).toContain(">signpost<");
  });

  test("puts the guardrail next to the body-token trend", () => {
    const html = generateDisclosureReport(base);
    expect(html).toContain("Body tokens against the guardrail");
    expect(html).toContain("Held-out pass");
    expect(html).toContain("5000");
  });

  test("says out loud when the token figures are estimates", () => {
    const estimated = generateDisclosureReport({
      ...base,
      tokenMethod: "estimator:chars-over-4",
      estimatedTokens: true,
    });
    expect(estimated).toContain("ESTIMATES");
    expect(generateDisclosureReport(base)).not.toContain("ESTIMATES");
  });

  test("renders a progress row while work is in flight, and none when it is not", () => {
    const live = generateDisclosureReport(
      { ...base, inProgress: { iteration: 2, settled: 3, total: 10, phase: "measuring", startedAt: 0 } },
      { now: 60_000 },
    );
    expect(live).toContain("measuring");
    expect(live).toContain("1m 0s elapsed");
    expect(generateDisclosureReport(base)).not.toContain("elapsed");
  });

  test("says when runs never loaded the skill, because the rates then rest on less", () => {
    const hollow = generateDisclosureReport({
      ...base,
      iterations: [
        {
          ...(base.iterations[0] as (typeof base.iterations)[number]),
          holdout: score({ runsWithoutSkill: 2 }),
        },
      ],
    });
    expect(hollow).toContain("2 run(s) never loaded the skill");
    expect(generateDisclosureReport(base)).not.toContain("never loaded the skill");
  });

  test("puts the rewriter's caveats in front of whoever is about to adopt the layout", () => {
    const withNotes = generateDisclosureReport({
      ...base,
      notes: ["The sentence pointing at references/legacy.md also points at references/always.md"],
    });
    expect(withNotes).toContain("before adopting this layout");
    expect(withNotes).toContain("also points at references/always.md");
    expect(generateDisclosureReport(base)).not.toContain("before adopting this layout");
  });

  test("survives a run with nothing measured yet", () => {
    const empty = generateDisclosureReport({ ...base, files: [], iterations: [] });
    expect(empty).toContain("No bundled files.");
  });
});

// ---------------------------------------------------------------------------
// Train-first gating
// ---------------------------------------------------------------------------

describe("trainGate", () => {
  const incumbent = score({ passRate: 1, meanContextTokens: 10_000 });

  test("a candidate that cuts cost at the same pass rate earns its held-out runs", () => {
    const verdict = trainGate({
      candidate: score({ passRate: 1, meanContextTokens: 8_000 }),
      incumbent,
    });
    expect(verdict.inContention).toBe(true);
  });

  test("a tie on both counts is still in contention", () => {
    // Ties go through deliberately: the held-out split is what decides, and refusing to
    // measure a candidate that merely failed to improve on train would throw away the one
    // measurement that could tell the two layouts apart.
    const verdict = trainGate({ candidate: score(), incumbent });
    expect(verdict.inContention).toBe(true);
  });

  test("a candidate that costs MORE on train never reaches the held-out split", () => {
    const verdict = trainGate({
      candidate: score({ meanContextTokens: 11_000 }),
      incumbent,
    });
    expect(verdict.inContention).toBe(false);
    expect(verdict.reason).toContain("10000");
    expect(verdict.reason).toContain("11000");
    expect(verdict.reason).toContain("held-out runs were not spent");
  });

  test("a candidate that breaks the work on train never reaches the held-out split", () => {
    const verdict = trainGate({
      candidate: score({ passRate: 0.7, meanContextTokens: 5_000 }),
      incumbent,
    });
    expect(verdict.inContention).toBe(false);
    expect(verdict.reason).toContain("70%");
    expect(verdict.reason).toContain("95%");
  });

  test("the guardrail keeps the same tolerance it has at selection time", () => {
    // One assertion flipping out of twenty is sampling noise, not a regression, and the
    // gate has to absorb the same amount of it the final guardrail does -- otherwise the
    // cheaper check rejects candidates the expensive one would have kept.
    const withinTolerance = trainGate({
      candidate: score({ passRate: 0.96, meanContextTokens: 9_000 }),
      incumbent,
    });
    expect(withinTolerance.inContention).toBe(true);

    const outside = trainGate({
      candidate: score({ passRate: 0.94, meanContextTokens: 9_000 }),
      incumbent,
    });
    expect(outside.inContention).toBe(false);
  });

  test("a widened tolerance widens the gate, in step with --pass-rate-tolerance", () => {
    const verdict = trainGate({
      candidate: score({ passRate: 0.85, meanContextTokens: 9_000 }),
      incumbent,
      passRateTolerance: 0.2,
    });
    expect(verdict.inContention).toBe(true);
  });
});

describe("measureWithGate", () => {
  /** Runs whose score is whatever the test needs the split to look like. */
  function runsAt(scenarioId: string, contextTokens: number, passed: number): ScenarioRun[] {
    return [
      run({ scenarioId, attempt: 1, contextTokens, assertionsPassed: passed, assertionsTotal: 2 }),
      run({ scenarioId, attempt: 2, contextTokens, assertionsPassed: passed, assertionsTotal: 2 }),
    ];
  }

  /** Three recording sweeps, so "which sweeps ran" is a fact the test can assert. */
  function sweeps(parts: {
    all?: ScenarioRun[];
    train?: ScenarioRun[];
    holdout?: ScenarioRun[];
  }) {
    const calls: string[] = [];
    return {
      calls,
      sweepAll: async (): Promise<readonly ScenarioRun[]> => {
        calls.push("all");
        return parts.all ?? [];
      },
      sweepTrain: async (): Promise<readonly ScenarioRun[]> => {
        calls.push("train");
        return parts.train ?? [];
      },
      sweepHoldout: async (): Promise<readonly ScenarioRun[]> => {
        calls.push("holdout");
        return parts.holdout ?? [];
      },
      partitionRuns: (runs: readonly ScenarioRun[]) => ({
        train: runs.filter((entry) => entry.scenarioId.startsWith("train")),
        holdout: runs.filter((entry) => !entry.scenarioId.startsWith("train")),
      }),
    };
  }

  const incumbent = score({ passRate: 1, meanContextTokens: 10_000 });

  test("the baseline runs both splits in ONE pool, ungated", async () => {
    // Not two half-sweeps: the baseline has to measure both whatever it scores, and two
    // sequential pools drain twice. It is also the thing every candidate is compared
    // against, so there is nothing to gate it on.
    const fakes = sweeps({
      all: [...runsAt("train-1", 10_000, 2), ...runsAt("hold-1", 9_000, 2)],
    });
    const measured = await measureWithGate({ ...fakes, hasHoldout: true, gateAgainst: null });

    expect(fakes.calls).toEqual(["all"]);
    expect(measured.gateReason).toBeNull();
    expect(measured.train.meanContextTokens).toBe(10_000);
    expect(measured.holdout?.meanContextTokens).toBe(9_000);
  });

  test("a candidate that loses on train never spends a held-out run", async () => {
    // The whole point of the change. At --holdout 0.4 these are two runs in five, and
    // each one does the skill's real work.
    const fakes = sweeps({ train: runsAt("train-1", 12_000, 2) });
    const measured = await measureWithGate({
      ...fakes,
      hasHoldout: true,
      gateAgainst: incumbent,
    });

    expect(fakes.calls).toEqual(["train"]);
    expect(fakes.calls).not.toContain("holdout");
    expect(measured.gateReason).not.toBeNull();
    expect(measured.holdoutRuns).toHaveLength(0);
  });

  test("a gated candidate reports a null held-out score, which is what keeps it unselectable", async () => {
    const fakes = sweeps({ train: runsAt("train-1", 12_000, 2) });
    const measured = await measureWithGate({
      ...fakes,
      hasHoldout: true,
      gateAgainst: incumbent,
    });
    expect(measured.holdout).toBeNull();
    expect(measured.gateReason).not.toBeNull();
  });

  test("a candidate still in contention gets its held-out runs, in that order", async () => {
    const fakes = sweeps({
      train: runsAt("train-1", 8_000, 2),
      holdout: runsAt("hold-1", 7_500, 2),
    });
    const measured = await measureWithGate({
      ...fakes,
      hasHoldout: true,
      gateAgainst: incumbent,
    });

    expect(fakes.calls).toEqual(["train", "holdout"]);
    expect(measured.gateReason).toBeNull();
    expect(measured.holdout?.meanContextTokens).toBe(7_500);
    expect(measured.train.meanContextTokens).toBe(8_000);
  });

  test("with no holdout configured nothing is gated, because train IS the selection split", async () => {
    // Gating here would delete candidates rather than save anything: there is no second
    // sweep to skip, and a filtered candidate would simply vanish from the iteration.
    const fakes = sweeps({ train: runsAt("train-1", 12_000, 1) });
    const measured = await measureWithGate({
      ...fakes,
      hasHoldout: false,
      gateAgainst: incumbent,
    });

    expect(fakes.calls).toEqual(["train"]);
    expect(measured.gateReason).toBeNull();
    expect(measured.holdout).toBeNull();
  });

  test("a tie on train is measured on the held-out split rather than assumed to lose", async () => {
    const fakes = sweeps({
      train: runsAt("train-1", 10_000, 2),
      holdout: runsAt("hold-1", 6_000, 2),
    });
    const measured = await measureWithGate({
      ...fakes,
      hasHoldout: true,
      gateAgainst: incumbent,
    });
    expect(fakes.calls).toEqual(["train", "holdout"]);
    expect(measured.holdout?.meanContextTokens).toBe(6_000);
  });

  test("the gate uses --pass-rate-tolerance, so widening it buys held-out measurements", async () => {
    const broken = runsAt("train-1", 5_000, 1);
    const tight = await measureWithGate({
      ...sweeps({ train: broken }),
      hasHoldout: true,
      gateAgainst: incumbent,
      passRateTolerance: 0.05,
    });
    expect(tight.gateReason).not.toBeNull();

    const wide = await measureWithGate({
      ...sweeps({ train: broken, holdout: runsAt("hold-1", 5_000, 1) }),
      hasHoldout: true,
      gateAgainst: incumbent,
      passRateTolerance: 0.75,
    });
    expect(wide.gateReason).toBeNull();
    expect(wide.holdout).not.toBeNull();
  });
});

describe("gating leaves selection where it was", () => {
  const baseline = score({ passRate: 1, meanContextTokens: 10_000 });

  test("the winner is the same whether or not the losers were measured on holdout", () => {
    // The property that makes the saving free: a candidate the gate retires would have
    // been rejected on holdout anyway, so removing it from the list cannot change who
    // wins. Both calls below pick B.
    const withAll = selectCandidate({
      baseline,
      baselineBodyTokens: 5000,
      candidates: [
        // A costs more on both splits -- the gate's cost rule and selection's agree.
        scored("A", { train: { meanContextTokens: 12_000 }, holdout: { meanContextTokens: 12_500 } }),
        scored("B", { train: { meanContextTokens: 8_000 }, holdout: { meanContextTokens: 7_000 } }),
      ],
    });
    const contendersOnly = selectCandidate({
      baseline,
      baselineBodyTokens: 5000,
      candidates: [
        scored("B", { train: { meanContextTokens: 8_000 }, holdout: { meanContextTokens: 7_000 } }),
      ],
    });
    expect(withAll.chosen?.candidate.id).toBe("B");
    expect(contendersOnly.chosen?.candidate.id).toBe("B");
  });

  test("a null holdout falls back to TRAIN inside selectCandidate, which is why the loop filters first", () => {
    // The hazard this test exists to pin down. `selectCandidate` reads `holdout ?? train`
    // so a run configured with no holdout still works -- and that same fallback would
    // score a GATED candidate on the split that just rejected it. The loop therefore hands
    // it only candidates whose `gateReason` is null; if that filter is ever dropped, the
    // layout below wins the iteration on a number nobody paid for.
    const gatedButCheapOnTrain: ScoredCandidate = {
      candidate: candidate("gated"),
      bodyTokens: 1000,
      train: score({ meanContextTokens: 1_000 }),
      holdout: null,
    };
    const result = selectCandidate({
      baseline,
      baselineBodyTokens: 5000,
      candidates: [gatedButCheapOnTrain],
    });
    expect(result.chosen?.candidate.id).toBe("gated");
  });
});

// ---------------------------------------------------------------------------
// The grader model
// ---------------------------------------------------------------------------

describe("--grader-model", () => {
  test("defaults to a small fast model rather than inheriting --model", () => {
    // The whole saving: grading is single-turn, has the transcript in the prompt already,
    // and runs serially in the same worker slot as the scenario. Inheriting `--model opus`
    // made every scenario wait on the heavy model twice.
    const { flags } = parseArgs(["--model", "opus"], OPTIMIZE_FLAGS);
    expect(flags["model"]).toBe("opus");
    expect(flags["grader-model"]).toBe(DEFAULT_GRADER_MODEL);
    expect(flags["grader-model"]).not.toBe(flags["model"]);
  });

  test("the default is an alias the CLI resolves, not an empty string", () => {
    // An unrecognized model does not fail loudly -- `claude` warns on stderr and carries
    // on -- so a default that was wrong would grade every run under a fallback nobody
    // chose, and the pass rates would move for no visible reason.
    expect(DEFAULT_GRADER_MODEL).toBe("sonnet");
    expect(OPTIMIZE_FLAGS["grader-model"]?.default).toBe(DEFAULT_GRADER_MODEL);
  });

  test("it overrides", () => {
    const { flags } = parseArgs(["--grader-model", "sonnet"], OPTIMIZE_FLAGS);
    expect(flags["grader-model"]).toBe("sonnet");
  });

  test("an empty override falls back to the default rather than passing --model ''", () => {
    // `flagString` reads "" as absent, which is the convention every entrypoint here
    // shares. Without the fallback this would spawn `claude --model ""`.
    const { flags } = parseArgs(["--grader-model="], OPTIMIZE_FLAGS);
    expect(flagString(flags, "grader-model") ?? DEFAULT_GRADER_MODEL).toBe(DEFAULT_GRADER_MODEL);
  });

  test("--model documents that it is not the grader", () => {
    expect(OPTIMIZE_FLAGS["model"]?.help).toContain("NOT the grader");
  });
});

// ---------------------------------------------------------------------------
// The results envelope
// ---------------------------------------------------------------------------

describe("the results envelope", () => {
  /** Two bundled files with opposite fates, so the verdict block has something to say. */
  const filesFor = (runs: readonly ScenarioRun[]): readonly FileStat[] =>
    computeFileStats(
      [
        bundled("references/always.md", { tokens: 900 }),
        bundled("references/never.md", { tokens: 400 }),
      ],
      runs,
    );

  function iteration(
    overrides: Partial<IterationRecord> & { readonly iteration: number },
  ): IterationRecord {
    return {
      label: "baseline (as authored)",
      candidateId: null,
      rationale: "2 bundled file(s)",
      bodyTokens: 5000,
      train: score(),
      holdout: score(),
      accepted: true,
      note: "the layout every candidate is measured against",
      ...overrides,
    };
  }

  function output(overrides: Partial<OptimizeOutput> = {}): OptimizeOutput {
    return {
      skill_name: "demo",
      skill_path: "/skills/demo",
      exit_reason: "max_iterations (3)",
      token_method: "tiktoken:cl100k_base",
      tokens_are_estimated: false,
      holdout: 0.4,
      train_size: 3,
      holdout_size: 2,
      runs_per_scenario: 2,
      baseline_body_tokens: 5000,
      best_body_tokens: 4200,
      baseline_context_tokens: 12_000,
      best_context_tokens: 10_500,
      best_layout_path: "/tmp/workspace/iter-2/cand-1/demo",
      applied_edits: ["extract 'Advanced options'"],
      files: filesFor([
        run({ filesRead: ["references/always.md"] }),
        run({ attempt: 2, filesRead: ["references/always.md"] }),
      ]),
      iterations: [
        iteration({ iteration: 1 }),
        iteration({
          iteration: 2,
          label: "extract 'Advanced options'",
          candidateId: "extract-advanced",
          bodyTokens: 4200,
          accepted: true,
        }),
      ],
      notes: [],
      ...overrides,
    };
  }

  function envelopeInput(
    overrides: Partial<DisclosureEnvelopeInput> = {},
  ): DisclosureEnvelopeInput {
    return {
      output: output(),
      tally: { measured: 20, unloaded: 0, timeout: 0, error: 0 },
      plannedRuns: 20,
      model: "opus",
      graderModel: "sonnet",
      workers: 12,
      timeoutSeconds: 600,
      maxIterations: 3,
      maxCandidates: 3,
      inlineThreshold: 0.8,
      scenarioSetHash: "sha256:scenarios",
      targetSha: "sha256:target",
      installState: "absent",
      ...overrides,
    };
  }

  test("what it produces is a valid envelope, checked by the contract's own validator", () => {
    // The whole retrofit rests on this. A producer that builds a nearly-right envelope is
    // worse than one that builds none: `writeEnvelope` refuses it at the moment of writing
    // rather than three weeks later, and this is that refusal moved into the suite.
    expect(validateEnvelope(buildDisclosureEnvelope(envelopeInput()))).toEqual([]);
  });

  test("the timeout policy is `excluded`, which is the OPPOSITE of the trigger harness's", () => {
    // Not a detail. `scoreRuns` filters `run.error === undefined`, so a timed-out scenario
    // is dropped from the rates here, where `measure-triggering.ts` scores a timed-out
    // query as a non-trigger. Both behaviours are defensible for their own operation and
    // neither is changing; declaring which one produced the numbers is the entire point of
    // the field, and a reader comparing a pull rate against a trigger rate needs it.
    const envelope = buildDisclosureEnvelope(envelopeInput());
    expect(envelope.provenance.timeoutPolicy).toBe("excluded");
    expect(envelope.provenance.unit).toBe("scenario run");
  });

  test("excluded and failed are counted apart from scored, and coincide under this policy", () => {
    const envelope = buildDisclosureEnvelope(
      envelopeInput({ tally: { measured: 14, unloaded: 2, timeout: 3, error: 1 } }),
    );
    // Runs that produced a measurement, unloaded ones included: they were graded and they
    // cost what they cost, so they are in the pass rate and the context-token mean.
    expect(envelope.provenance.scored).toBe(16);
    // Timeouts and hard failures, dropped from every denominator.
    expect(envelope.provenance.excluded).toBe(4);
    expect(envelope.provenance.failed).toBe(4);
    // The invariant the contract states: scored + excluded = attempted.
    expect(envelope.provenance.scored + envelope.provenance.excluded).toBe(20);
  });

  test("a clean run reports zero on both counts rather than omitting them", () => {
    const envelope = buildDisclosureEnvelope(envelopeInput());
    expect(envelope.provenance.excluded).toBe(0);
    expect(envelope.provenance.failed).toBe(0);
    expect(envelope.provenance.scored).toBe(20);
  });

  test("the exclusion cap separates timeouts from other failures and names the other policy", () => {
    const envelope = buildDisclosureEnvelope(
      envelopeInput({ tally: { measured: 14, unloaded: 0, timeout: 3, error: 1 } }),
    );
    const cap = envelope.provenance.caps.find((entry) => entry.includes("EXCLUDED"));
    expect(cap).toBeDefined();
    expect(cap).toContain("3 hit the 600s budget");
    expect(cap).toContain("1 failed outright");
    expect(cap).toContain("measure-triggering");
  });

  test("an unloaded run is scored but called out, because it is out of the pull rates", () => {
    // The second, narrower exclusion. `computeFileStats` counts only runs that loaded the
    // skill, so a run where the body never reached context is inside `scored` and outside
    // every number in `rows` -- two denominators, and a reader who divides one by the
    // other gets nonsense.
    const envelope = buildDisclosureEnvelope(
      envelopeInput({ tally: { measured: 18, unloaded: 2, timeout: 0, error: 0 } }),
    );
    expect(envelope.provenance.scored).toBe(20);
    expect(envelope.provenance.excluded).toBe(0);
    expect(envelope.provenance.caps.some((cap) => cap.includes("never reaching"))).toBe(false);
    expect(
      envelope.provenance.caps.some((cap) => cap.includes("without the skill body ever reaching")),
    ).toBe(true);
  });

  test("one row per bundled file, carrying the path, pull rate, tokens and verdict", () => {
    const envelope = buildDisclosureEnvelope(envelopeInput());
    expect(envelope.rows.map((row) => row.path)).toEqual([
      "references/always.md",
      "references/never.md",
    ]);
    const always = envelope.rows[0]!;
    expect(always.pullRate).toBe(1);
    expect(always.tokens).toBe(900);
    expect(always.verdict).toBe("inline");
    expect(always.countedRuns).toBe(2);
    // The wire row is not `FileStat`: `bytes` is a different number that looks like the
    // token count, and dropping it here is what keeps the two types free to diverge.
    expect(always).not.toHaveProperty("bytes");
  });

  test("every verdict reaches the verdict block with a reason, not just the row", () => {
    const envelope = buildDisclosureEnvelope(envelopeInput());
    expect(envelope.verdicts.map((entry) => [entry.subject, entry.verdict])).toEqual([
      ["references/always.md", "inline"],
      ["references/never.md", "prune"],
    ]);
    // A verdict a reader has never seen before still arrives with its justification.
    expect(envelope.verdicts[0]!.reason).toContain("0.8 inline threshold");
    expect(envelope.verdicts[1]!.reason).toContain("the body points straight at it");
    for (const verdict of envelope.verdicts) expect(verdict.reason.length).toBeGreaterThan(20);
  });

  test("the five file verdicts each get their own reasoning, including the no-evidence case", () => {
    const reasons = (files: readonly FileStat[]): readonly string[] =>
      buildDisclosureEnvelope(envelopeInput({ output: output({ files }) })).verdicts.map(
        (entry) => entry.reason,
      );

    // Never measured at all: nothing is concluded, and the reason says why that matters.
    expect(reasons(filesFor([]))[0]).toContain("no evidence");
    // A script that was read is misfiled rather than conditional content.
    const misfiled = computeFileStats(
      [bundled("scripts/run.ts")],
      [run({ filesRead: ["scripts/run.ts"] })],
    );
    expect(reasons(misfiled)[0]).toContain("wrong verb");
    // A script nobody read is a script working correctly.
    expect(reasons(computeFileStats([bundled("scripts/run.ts")], [run()]))[0]).toContain(
      "what a working",
    );
    // Unsignposted and unread: the fix is a sentence, not a deletion.
    const unsignposted = computeFileStats(
      [bundled("references/hidden.md", { signposted: false })],
      [run()],
    );
    expect(reasons(unsignposted)[0]).toContain("not a deletion");
    // Sometimes, which is what deferral is for.
    const conditional = computeFileStats(
      [bundled("references/sometimes.md")],
      [run({ filesRead: ["references/sometimes.md"] }), run({ attempt: 2 })],
    );
    expect(reasons(conditional)[0]).toContain("genuinely conditional");
  });

  test("a root-level file read on some runs is conditional content, not a working script", () => {
    // `root` is a read mode and does not look like one — the load mode is named after
    // where the file sits, not after what happens to it. Deciding the wording by testing
    // `loadMode` against a hand-copied list of read modes gets this row wrong and calls a
    // half-pulled `NOTES.md` "what a working root file looks like".
    const rootFile = computeFileStats(
      [bundled("NOTES.md")],
      [run({ filesRead: ["NOTES.md"] }), run({ attempt: 2 })],
    );
    expect(rootFile[0]!.loadMode).toBe("root");
    expect(rootFile[0]!.verdict).toBe("keep");
    const reason = buildDisclosureEnvelope(
      envelopeInput({ output: output({ files: rootFile }) }),
    ).verdicts[0]!.reason;
    expect(reason).toContain("genuinely conditional");
    expect(reason).not.toContain("what a working");
  });

  test("caps name every knob that bounded coverage", () => {
    const caps = buildDisclosureEnvelope(envelopeInput()).provenance.caps.join("\n");
    expect(caps).toContain("--max-iterations");
    expect(caps).toContain("--max-candidates");
    expect(caps).toContain("--runs-per-scenario");
    expect(caps).toContain("--holdout");
    // The split is the one most easily missed: the file table is computed over the train
    // runs alone, so a reference only the held-out scenarios needed reads as never pulled.
    expect(caps).toContain("2 of 5 scenario(s) were held out");
    expect(caps).toContain("TRAIN scenario(s) only");
  });

  test("no holdout is a cap of its own rather than a missing sentence", () => {
    const caps = buildDisclosureEnvelope(
      envelopeInput({ output: output({ holdout: 0, train_size: 5, holdout_size: 0 }) }),
    ).provenance.caps.join("\n");
    expect(caps).toContain("No scenarios were held out");
    expect(caps).toContain("will be optimistic");
  });

  test("unspent runs are declared, because gating and early exit both shrink the sweep", () => {
    const caps = buildDisclosureEnvelope(
      envelopeInput({ plannedRuns: 30, tally: { measured: 20, unloaded: 0, timeout: 0, error: 0 } }),
    ).provenance.caps.join("\n");
    expect(caps).toContain("10 of 30 planned run(s) went unspent");
  });

  test("the tokenizer is carried through from the loop rather than asked for again", () => {
    // `lib/disclosure.ts` already decides this once, by trying to load tiktoken and
    // falling back, and the report prints the estimate warning off the same flag. Asking a
    // second time could get a second answer.
    expect(buildDisclosureEnvelope(envelopeInput()).provenance.tokenizer).toBe("tiktoken");
    const estimated = buildDisclosureEnvelope(
      envelopeInput({
        output: output({ tokens_are_estimated: true, token_method: "estimator:chars-over-4" }),
      }),
    );
    expect(estimated.provenance.tokenizer).toBe("estimated");
    expect(estimated.provenance.caps.some((cap) => cap.includes("ESTIMATES"))).toBe(true);
  });

  test("the run block records the grader as well as the run model", () => {
    // The first producer with a real grading step. Recording only `model` would hide half
    // of what decided the guardrail.
    const envelope = buildDisclosureEnvelope(envelopeInput());
    expect(envelope.run.graderModel).toBe("sonnet");
    expect(envelope.run.model).toBe("opus");
    expect(envelope.run.operation).toBe("optimize-disclosure");
    expect(envelope.run.artifact).toBe("skill");
    expect(envelope.run.target).toBe("demo");
    expect(envelope.run.evalSetHash).toBe("sha256:scenarios");
    expect(envelope.run.runsPer).toBe(2);
  });

  test("headline deltas are within-run, which is the only place one is legitimate", () => {
    const envelope = buildDisclosureEnvelope(envelopeInput());
    const body = envelope.headline.find((metric) => metric.label === "body tokens");
    expect(body?.value).toBe(4200);
    expect(body?.delta).toBe(-800);
    const context = envelope.headline.find(
      (metric) => metric.label === "context tokens per run",
    );
    expect(context?.delta).toBe(-1500);
  });

  test("a pass rate over no assertions is omitted rather than reported as a perfect score", () => {
    // `scoreRuns` returns 1 for a scenario set with no expectations. True about zero
    // assertions, and on a dashboard it reads as a skill that passed everything.
    const empty = score({ assertionsPassed: 0, assertionsTotal: 0, passRate: 1 });
    const envelope = buildDisclosureEnvelope(
      envelopeInput({
        output: output({
          iterations: [iteration({ iteration: 1, train: empty, holdout: empty })],
        }),
      }),
    );
    expect(envelope.headline.some((metric) => metric.label === "assertion pass rate")).toBe(false);
    expect(
      envelope.provenance.caps.some((cap) => cap.includes("guardrail could not fire")),
    ).toBe(true);
  });

  test("the selected layout is found by walking accepted records, not by re-deciding", () => {
    // A second implementation of the selection rule here would be free to disagree with
    // the `best_layout_path` the same run just wrote.
    const envelope = buildDisclosureEnvelope(
      envelopeInput({
        output: output({
          iterations: [
            iteration({ iteration: 1, train: score({ passRate: 0.5 }), holdout: score({ passRate: 0.5 }) }),
            iteration({ iteration: 2, accepted: false, holdout: score({ passRate: 0.1 }) }),
            iteration({ iteration: 2, accepted: true, holdout: score({ passRate: 0.9 }) }),
          ],
        }),
      }),
    );
    const passRate = envelope.headline.find((metric) => metric.label === "assertion pass rate");
    expect(passRate?.value).toBeCloseTo(0.9);
    expect(passRate?.delta).toBeCloseTo(0.4);
  });

  test("an install conflict is loud: first in caps, and a verdict of its own", () => {
    // The failure this exists for. Content served through the skill system never produces
    // a `Read`, so a sweep against an installed copy floors every pull rate at zero and
    // the file table fills with `prune` — a clean-looking instruction to delete the skill's
    // references, resting on nothing.
    const conflict = installConflict({
      operation: "optimize-disclosure",
      needs: "absent",
      found: "installed",
    });
    expect(conflict).not.toBeNull();
    const envelope = buildDisclosureEnvelope(
      envelopeInput({
        installState: "installed",
        installConflict: conflict,
        caps: ["A copy of `demo` is installed at /home/u/.claude/skills/demo."],
      }),
    );
    expect(envelope.run.installState).toBe("installed");
    // First, ahead of the caller's own caps and every mechanical one. A reader who stops
    // after one line has to have read this one.
    expect(envelope.provenance.caps[0]).toBe(conflict as string);
    expect(envelope.provenance.caps[1]).toContain("is installed at");
    // And again as a verdict whose subject is the skill rather than a file, so a consumer
    // rendering only the verdict block still sees it.
    expect(envelope.verdicts[0]).toEqual({
      subject: "demo",
      verdict: "unsound",
      reason: conflict as string,
    });
    expect(validateEnvelope(envelope)).toEqual([]);
  });

  test("no conflict leaves the verdict block to the files alone", () => {
    const envelope = buildDisclosureEnvelope(envelopeInput({ installConflict: null }));
    expect(envelope.verdicts.every((entry) => entry.verdict !== "unsound")).toBe(true);
    expect(envelope.provenance.caps[0]).not.toContain("needs the target NOT to be installed");
  });

  test("an absent install state raises no conflict, which is the healthy case here", () => {
    // The mirror image of the trigger harness, which needs the target INSTALLED. The same
    // machine state is healthy for one operation and fatal for the other.
    expect(
      installConflict({ operation: "optimize-disclosure", needs: "absent", found: "absent" }),
    ).toBeNull();
    expect(
      installConflict({ operation: "measure-triggering", needs: "installed", found: "absent" }),
    ).toBeNull();
  });

  test("the envelope survives a round trip through writeEnvelope", async () => {
    const dir = `${tmpdir()}/disclosure-envelope-${crypto.randomUUID()}`;
    try {
      const path = `${dir}/${ENVELOPE_FILENAME}`;
      await writeEnvelope(path, buildDisclosureEnvelope(envelopeInput()));
      const read = await readEnvelope(path);
      expect(read.run.operation).toBe("optimize-disclosure");
      expect(read.provenance.timeoutPolicy).toBe("excluded");
      expect(read.rows).toHaveLength(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// The run tally
// ---------------------------------------------------------------------------

describe("classifyRun and createRunTally", () => {
  test("a timed-out run is told apart from a run that failed some other way", () => {
    // `failed: 6` cannot say whether the answer is a bigger --timeout or a look at the
    // machine, and a `ScenarioRun` carries only an error string to tell them apart with.
    expect(classifyRun(run({ error: `${TIMEOUT_ERROR_PREFIX} 600s and held a worker slot` }))).toBe(
      "timeout",
    );
    expect(classifyRun(run({ error: "spawn claude ENOENT" }))).toBe("error");
  });

  test("an error wins over the skill having loaded, because the run produced nothing", () => {
    expect(classifyRun(run({ error: "boom", skillLoaded: true }))).toBe("error");
  });

  test("a clean run that never loaded the skill is its own outcome", () => {
    expect(classifyRun(run({ skillLoaded: false }))).toBe("unloaded");
    expect(classifyRun(run())).toBe("measured");
  });

  test("the tally counts each outcome once and starts at zero", () => {
    const tally = createRunTally();
    expect(tally.snapshot()).toEqual({ measured: 0, unloaded: 0, timeout: 0, error: 0 });
    tally.record(run());
    tally.record(run({ skillLoaded: false }));
    tally.record(run({ error: `${TIMEOUT_ERROR_PREFIX} 600s` }));
    tally.record(run({ error: `${TIMEOUT_ERROR_PREFIX} 600s` }));
    tally.record(run({ error: "grader unreachable" }));
    expect(tally.snapshot()).toEqual({ measured: 1, unloaded: 1, timeout: 2, error: 1 });
  });

  test("the snapshot is a copy, so a later run cannot rewrite an envelope already built", () => {
    const tally = createRunTally();
    tally.record(run());
    const taken = tally.snapshot();
    tally.record(run());
    expect(taken.measured).toBe(1);
  });
});
