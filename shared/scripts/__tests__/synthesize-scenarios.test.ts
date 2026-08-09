/**
 * Tests for scenario synthesis.
 *
 * Nothing here spawns `claude`. That is not a shortcut around the hard part -- it is
 * where the hard part is. The model writes the queries, but everything that decides
 * WHAT it is shown is pure: which files count as substance, which text is a
 * capability, which is a stated boundary, and above all which text is excluded so the
 * generated queries are not seeded by the description they will be used to optimize.
 * A regression in any of those produces an eval set that looks entirely healthy and
 * certifies the wrong thing, so those are the parts that need to be reachable from
 * the suite.
 *
 * The fixture skill under `fixtures/synth-skill/` is a real bundled layout -- body,
 * references, scripts, examples, assets, and a `__tests__` directory that must be
 * ignored -- so the collection tests exercise the same walk a real artifact gets.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";

import {
  assertNoDescriptionLeak,
  balanceScenarios,
  buildInventory,
  buildSynthesisPrompt,
  capabilitiesFromSources,
  CircularityError,
  describeMcpServer,
  descriptionShingles,
  detectTargetKind,
  documentTitle,
  extractCapabilities,
  extractNonGoals,
  extractScenarioBlock,
  findDescriptionLeaks,
  inferTargetKind,
  parseScenarios,
  readFrontmatterFields,
  redactDescription,
  REDACTION_MARKER,
  renderInventory,
  resolveKind,
  splitCount,
  splitFrontmatter,
  undocumentedCapabilities,
  type CapabilitySource,
} from "../synthesize-scenarios.ts";

const FIXTURES = `${import.meta.dir}/fixtures`;
const SKILL = `${FIXTURES}/synth-skill`;
const AGENT = `${FIXTURES}/agents/spec-auditor.md`;
const COMMAND = `${FIXTURES}/commands/deploy.md`;
const MCP = `${FIXTURES}/servers.mcp.json`;

/** Temp roots created by individual tests, cleaned up together at the end. */
const temporaryRoots: string[] = [];

function temporaryRoot(label: string): string {
  const root = `${process.env["TMPDIR"] ?? "/tmp"}/synth-${label}-${crypto.randomUUID().slice(0, 8)}`;
  temporaryRoots.push(root);
  return root;
}

afterAll(async () => {
  for (const root of temporaryRoots) await rm(root, { recursive: true, force: true });
});

/** The neighbour sweep reads the whole machine, so the pure tests opt out of it. */
const NO_SWEEP = { skipNeighbours: true } as const;

function sourceOf(partial: Partial<CapabilitySource> & { path: string }): CapabilitySource {
  return {
    role: "reference",
    excerpt: "",
    bytes: 0,
    truncated: false,
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// Frontmatter
// ---------------------------------------------------------------------------

describe("splitFrontmatter", () => {
  test("separates the YAML block from the body", () => {
    const { frontmatter, body } = splitFrontmatter("---\nname: x\n---\n\n# Title\n");
    expect(frontmatter).toBe("name: x");
    expect(body).toBe("\n# Title\n");
  });

  test("a file with no frontmatter is all body", () => {
    const { frontmatter, body } = splitFrontmatter("# Title\n\nprose\n");
    expect(frontmatter).toBe("");
    expect(body).toBe("# Title\n\nprose\n");
  });

  test("CRLF line endings still split", () => {
    const { frontmatter, body } = splitFrontmatter("---\r\nname: x\r\n---\r\nbody\r\n");
    expect(frontmatter).toBe("name: x");
    expect(body).toBe("body\r\n");
  });

  test("the split is what removes the description from the source set", () => {
    // The structural half of the anti-circularity rule. The description lives in the
    // frontmatter, so discarding the frontmatter excludes it by construction rather
    // than by anyone remembering to filter it downstream.
    const { body } = splitFrontmatter("---\ndescription: the text under optimization\n---\nbody\n");
    expect(body).not.toContain("under optimization");
  });
});

describe("readFrontmatterFields", () => {
  test("reads scalar and sequence fields", () => {
    const fields = readFrontmatterFields('name: a\ntools: ["Read", "Grep"]\n');
    expect(fields["name"]).toBe("a");
    expect(fields["tools"]).toEqual(["Read", "Grep"]);
  });

  test("malformed YAML yields an empty map rather than throwing", () => {
    // The body is the primary evidence, so losing a tool grant is a smaller loss than
    // refusing to run over an artifact whose frontmatter this parser dislikes.
    expect(readFrontmatterFields("name: [unclosed\n  : :\n")).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Capability extraction
// ---------------------------------------------------------------------------

describe("extractCapabilities", () => {
  test("headings become capabilities", () => {
    const found = extractCapabilities("## Render the chart\n\ntext\n\n## Place it in a deck\n");
    expect(found).toEqual(["Render the chart", "Place it in a deck"]);
  });

  test("boilerplate headings are dropped", () => {
    expect(extractCapabilities("## Overview\n## Installation\n## Render the chart\n")).toEqual([
      "Render the chart",
    ]);
  });

  test("a worded step heading is not a capability", () => {
    // Nobody types a request for step 3 of anything. Promoting it would invite a
    // positive no user would send and bury the real gap findings under workflow.
    expect(extractCapabilities("## Step 1: Read the sheet\n## Render the chart\n")).toEqual([
      "Render the chart",
    ]);
  });

  test("a numbered section heading IS a capability", () => {
    // `## 1. Structure` in a checklist is a topic, not a procedure, so the step filter
    // deliberately does not match a bare number.
    expect(extractCapabilities("## 1. Structure\n## 2. Description\n")).toEqual([
      "Structure",
      "Description",
    ]);
  });

  test("headings inside a fenced block belong to the example, not the artifact", () => {
    const body = "## Real one\n\n```markdown\n## Fake one\n```\n";
    expect(extractCapabilities(body)).toEqual(["Real one"]);
  });

  test("bullets are the fallback for a body with almost no headings", () => {
    // The normal shape for a subagent system prompt: instructions, not sections.
    const body = "You audit specs.\n\n- Find contradictions between requirements\n- Flag ambiguity\n";
    expect(extractCapabilities(body)).toEqual([
      "Find contradictions between requirements",
      "Flag ambiguity",
    ]);
  });

  test("markdown formatting is stripped so a heading reads as its words", () => {
    expect(extractCapabilities("## Run `bun test` on **every** file\n")).toEqual([
      "Run bun test on every file",
    ]);
  });
});

describe("documentTitle", () => {
  test("a markdown title wins", () => {
    const title = documentTitle(
      sourceOf({ path: "references/colour.md", excerpt: "# Colour contrast\n\nprose\n" }),
    );
    expect(title).toBe("Colour contrast");
  });

  test("a script's doc-comment opening line is used when there is no heading", () => {
    // This house writes `name -- what it is for` at the top of every script, which is
    // a better capability statement than any heading in the file.
    const title = documentTitle(
      sourceOf({
        path: "scripts/render-chart.ts",
        role: "script",
        excerpt: "/**\n * render-chart -- rasterize a chart spec to PNG.\n */\nexport const x = 1;\n",
      }),
    );
    expect(title).toBe("render-chart -- rasterize a chart spec to PNG.");
  });

  test("the filename is the fallback, so an unread asset still contributes", () => {
    const title = documentTitle(sourceOf({ path: "assets/brand-template.html", role: "asset" }));
    expect(title).toBe("brand template");
  });
});

describe("capabilitiesFromSources", () => {
  test("the body is decomposed, a bundled file contributes one line", () => {
    // The distinction the brief turns on: a reference on a subject the description
    // never mentions is the capability gap worth probing, whereas a section heading
    // inside that reference is a fact about the document's layout.
    const found = capabilitiesFromSources([
      sourceOf({ path: "SKILL.md", role: "body", excerpt: "## First\n## Second\n" }),
      sourceOf({
        path: "references/palette.md",
        excerpt: "# Colour palettes\n\n## Ratios\n## Contrast\n",
      }),
    ]);
    expect(found).toEqual(["First", "Second", "Colour palettes"]);
    expect(found).not.toContain("Ratios");
  });

  test("the tool grant is not repeated as a capability", () => {
    const found = capabilitiesFromSources([
      sourceOf({ path: "a.md", role: "body", excerpt: "## Audit\n" }),
      sourceOf({ path: "frontmatter: tools", role: "tool-grant", excerpt: "Read, Grep" }),
    ]);
    expect(found).toEqual(["Audit"]);
  });
});

describe("extractNonGoals", () => {
  test("finds a stated boundary", () => {
    const found = extractNonGoals("Do not use this to clean up the source spreadsheet.");
    expect(found).toEqual(["Do not use this to clean up the source spreadsheet."]);
  });

  test("ordinary prose without a boundary marker is not a non-goal", () => {
    // A looser pattern matches explanatory prose several times a page, and a non-goal
    // list padded with prose hands the model false boundaries: a negative written
    // against a boundary the artifact does not have is a query it SHOULD trigger on.
    expect(extractNonGoals("This renders the chart and then places it in the deck.")).toEqual([]);
  });

  test("boundaries inside a fenced block are ignored", () => {
    expect(extractNonGoals("```\nDo not use this sample.\n```\n")).toEqual([]);
  });

  test("duplicates collapse", () => {
    const body = "Do not use for spreadsheets.\n\nmore\n\nDo not use for spreadsheets.\n";
    expect(extractNonGoals(body)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// The gap finding
// ---------------------------------------------------------------------------

describe("undocumentedCapabilities", () => {
  test("a capability absent from the description is reported", () => {
    const gaps = undocumentedCapabilities(
      ["Colour contrast for low vision"],
      "Build a rendered chart from a spreadsheet.",
    );
    expect(gaps).toEqual(["Colour contrast for low vision"]);
  });

  test("an inflected form counts as mentioned", () => {
    // `domainTerms` only strips a trailing `s`, which collides migration/migrations
    // and not create/creating -- and that second pair is exactly the shape a heading
    // and a description take when they say the same thing. A false gap is the
    // expensive error: it sends the author rewriting a description that was fine.
    expect(undocumentedCapabilities(["Creating a chart"], "Create charts from data")).toEqual([]);
    expect(undocumentedCapabilities(["Rendering the chart"], "produces a rendered chart")).toEqual(
      [],
    );
  });

  test("a capability carrying no domain terms is skipped rather than reported", () => {
    // `domainTerms` strips the vocabulary of skill descriptions themselves, so a
    // heading like "Use cases" reduces to nothing. It says nothing the description
    // could be expected to cover, and reporting it would bury the real findings.
    expect(undocumentedCapabilities(["Use cases"], "Build a chart")).toEqual([]);
  });

  test("an empty description makes every real capability a gap", () => {
    expect(undocumentedCapabilities(["Colour contrast", "Deck placement"], "")).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// The anti-circularity guard
// ---------------------------------------------------------------------------

describe("descriptionShingles", () => {
  test("a description shorter than the floor yields nothing to guard against", () => {
    // Redacting a three-word description's word order out of the body would delete
    // real capability evidence to prevent a leak that carries no framing anyway.
    expect(descriptionShingles("build charts")).toEqual([]);
  });

  test("a long description yields overlapping word runs", () => {
    const shingles = descriptionShingles("one two three four five six seven eight nine");
    expect(shingles).toEqual([
      "one two three four five six seven eight",
      "two three four five six seven eight nine",
    ]);
  });
});

describe("findDescriptionLeaks", () => {
  const description =
    "Build a rendered chart from a spreadsheet and place it into a slide deck for review.";

  test("a verbatim restatement is a leak", () => {
    const body = "This skill will build a rendered chart from a spreadsheet and place it into a slide deck for review, every time.";
    expect(findDescriptionLeaks(body, description).length).toBeGreaterThan(0);
  });

  test("shared vocabulary alone is not a leak", () => {
    // Two texts about the same subject inevitably share words. Stripping shared
    // vocabulary would gut the body; eight consecutive words in order is reuse.
    const body = "Charts are rendered from spreadsheet data. A deck holds the result.";
    expect(findDescriptionLeaks(body, description)).toEqual([]);
  });

  test("a short description disables the check rather than matching everything", () => {
    expect(findDescriptionLeaks("build charts here", "build charts")).toEqual([]);
  });
});

describe("redactDescription", () => {
  const description =
    "Build a rendered chart from a spreadsheet and place it into a slide deck for review.";

  test("cuts the restatement and keeps the surrounding text", () => {
    // Redaction rather than rejection: a body whose opening paragraph paraphrases its
    // own description is ordinary documentation, and discarding the file would throw
    // away the capability evidence synthesis exists to read.
    const body =
      "Preface. Build a rendered chart from a spreadsheet and place it into a slide deck for review. It also reconciles totals.";
    const { text, redactions } = redactDescription(body, description);
    expect(redactions).toBe(1);
    expect(text).toContain("Preface.");
    expect(text).toContain("It also reconciles totals.");
    expect(text).toContain(REDACTION_MARKER);
    expect(findDescriptionLeaks(text, description)).toEqual([]);
  });

  test("overlapping windows merge into one marker", () => {
    const body = `x ${description} y`;
    expect(redactDescription(body, description).redactions).toBe(1);
  });

  test("text with no restatement is returned untouched", () => {
    const body = "Charts are rendered from spreadsheets.";
    const { text, redactions } = redactDescription(body, description);
    expect(redactions).toBe(0);
    expect(text).toBe(body);
  });
});

describe("assertNoDescriptionLeak", () => {
  const description =
    "Build a rendered chart from a spreadsheet and place it into a slide deck for review.";

  test("throws when a run of the description survived", () => {
    // Loud at the moment it happens, because a synthesis run seeded by the
    // description produces an eval set that looks exactly like a good one.
    expect(() => assertNoDescriptionLeak(`prefix ${description}`, description)).toThrow(
      CircularityError,
    );
  });

  test("passes on material that merely shares vocabulary", () => {
    expect(() =>
      assertNoDescriptionLeak("Charts, spreadsheets and decks are involved.", description),
    ).not.toThrow();
  });
});

describe("buildSynthesisPrompt", () => {
  test("the prompt carries the artifact's substance and none of its description", async () => {
    // The load-bearing assertion of the whole script. If this ever fails, the
    // generated queries are inheriting the vocabulary of the text they will be used
    // to score, and the loop certifies the description against itself.
    const inventory = await buildInventory({ targetPath: SKILL, kind: "skill", ...NO_SWEEP });
    const { prompt } = buildSynthesisPrompt(inventory, splitCount(20));

    expect(inventory.description).not.toBe("");
    expect(findDescriptionLeaks(prompt, inventory.description)).toEqual([]);
    expect(prompt).toContain("Rendering the chart");
    expect(prompt).toContain("Colour contrast for readers with low vision");
  });

  test("a body that restates the description is redacted, not rejected", async () => {
    const root = temporaryRoot("leaky");
    const description =
      "Convert legacy invoice spreadsheets into a normalized ledger export for the finance team.";
    await Bun.write(
      `${root}/leaky/SKILL.md`,
      `---\nname: leaky\ndescription: ${description}\n---\n\n` +
        `This skill will ${description.charAt(0).toLowerCase()}${description.slice(1)}\n\n` +
        "## Reconcile bank statements\n\nMatch each transaction against a ledger row.\n",
    );

    const inventory = await buildInventory({
      targetPath: `${root}/leaky`,
      kind: "skill",
      ...NO_SWEEP,
    });
    const { prompt, redactions } = buildSynthesisPrompt(inventory, splitCount(20));

    expect(redactions).toBeGreaterThan(0);
    expect(findDescriptionLeaks(prompt, description)).toEqual([]);
    // The capability the description does NOT mention has to survive the redaction,
    // because it is the one the synthesized queries most need to probe.
    expect(prompt).toContain("Reconcile bank statements");
  });

  test("the prompt names all three hard-negative sources", async () => {
    const inventory = await buildInventory({ targetPath: SKILL, kind: "skill", ...NO_SWEEP });
    const { prompt } = buildSynthesisPrompt(inventory, splitCount(20));
    expect(prompt).toContain("stated non-goals");
    expect(prompt).toContain("adjacent capability one step outside the boundary");
    expect(prompt).toContain("co-installed neighbours");
  });

  test("the requested counts reach the prompt", async () => {
    const inventory = await buildInventory({ targetPath: SKILL, kind: "skill", ...NO_SWEEP });
    const { prompt } = buildSynthesisPrompt(inventory, splitCount(8));
    expect(prompt).toContain("exactly 4 positive scenarios and 4 negative scenarios");
  });
});

// ---------------------------------------------------------------------------
// Target kinds
// ---------------------------------------------------------------------------

describe("inferTargetKind", () => {
  test("a directory is a skill", () => {
    expect(inferTargetKind("/repo/skills/chart-maker", true)).toBe("skill");
  });

  test("a .md under agents/ is an agent", () => {
    expect(inferTargetKind("/repo/agents/reviewer.md", false)).toBe("agent");
  });

  test("a .md under commands/ is a command", () => {
    expect(inferTargetKind("/repo/commands/deploy.md", false)).toBe("command");
  });

  test("a .mcp.json is mcp", () => {
    expect(inferTargetKind("/repo/.mcp.json", false)).toBe("mcp");
    expect(inferTargetKind("/repo/servers.mcp.json", false)).toBe("mcp");
  });

  test("a bare .md is ambiguous, so nothing is guessed", () => {
    // An agent, a command, or neither. Guessing would read the wrong fields and
    // report an inventory that quietly describes the wrong shape of artifact.
    expect(inferTargetKind("/repo/notes/thing.md", false)).toBeUndefined();
  });

  test("detectTargetKind reads the real fixtures", async () => {
    expect(await detectTargetKind(SKILL)).toBe("skill");
    expect(await detectTargetKind(AGENT)).toBe("agent");
    expect(await detectTargetKind(COMMAND)).toBe("command");
    expect(await detectTargetKind(MCP)).toBe("mcp");
  });
});

describe("resolveKind", () => {
  test("accepts the four kinds and rejects anything else", () => {
    expect(resolveKind("agent")).toBe("agent");
    expect(resolveKind(undefined)).toBeUndefined();
    expect(() => resolveKind("agents")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Reading real artifacts
// ---------------------------------------------------------------------------

describe("buildInventory: a skill", () => {
  test("reads the body and every bundled load mode", async () => {
    const inventory = await buildInventory({ targetPath: SKILL, kind: "skill", ...NO_SWEEP });
    const roles = new Set(inventory.sources.map((source) => source.role));
    expect(roles).toEqual(new Set(["body", "example", "reference", "script", "asset"]));
    expect(inventory.name).toBe("chart-maker");
  });

  test("an asset contributes its name and not its bytes", async () => {
    // Assets are copied into output as material rather than read for meaning, per the
    // plugin's own load-mode rule, so their bytes are budget spent on nothing.
    const inventory = await buildInventory({ targetPath: SKILL, kind: "skill", ...NO_SWEEP });
    const asset = inventory.sources.find((source) => source.role === "asset");
    expect(asset?.path).toBe("assets/brand-template.html");
    expect(asset?.excerpt).toBe("");
    expect(inventory.capabilities).toContain("brand template");
  });

  test("a __tests__ directory inside references is never read", async () => {
    // A test file is dense with the artifact's vocabulary while describing something
    // no user would ever ask for, so it crowds the budget with unusable material.
    const inventory = await buildInventory({ targetPath: SKILL, kind: "skill", ...NO_SWEEP });
    const paths = inventory.sources.map((source) => source.path);
    expect(paths).not.toContain("references/__tests__/ignored.md");
    expect(paths).toContain("references/colour-accessibility.md");
  });

  test("the capability list mixes body headings with bundled-file topics", async () => {
    const inventory = await buildInventory({ targetPath: SKILL, kind: "skill", ...NO_SWEEP });
    expect(inventory.capabilities).toContain("Pick a chart form");
    expect(inventory.capabilities).toContain("Colour contrast for readers with low vision");
    expect(inventory.capabilities).toContain("render-chart -- rasterize a chart spec to PNG at print resolution.");
    expect(inventory.capabilities).not.toContain("Overview");
    expect(inventory.capabilities).not.toContain("Not a real heading");
  });

  test("the stated non-goal is picked up", async () => {
    const inventory = await buildInventory({ targetPath: SKILL, kind: "skill", ...NO_SWEEP });
    expect(inventory.nonGoals.join(" ")).toContain("clean up the source spreadsheet");
  });

  test("a capability the description never mentions is surfaced as a finding", async () => {
    // The finding that exists before a single eval runs: the loop optimizes the
    // description, so a capability its vocabulary never touches generates no queries
    // and is never penalised for being missing.
    const inventory = await buildInventory({ targetPath: SKILL, kind: "skill", ...NO_SWEEP });
    expect(inventory.undocumented).toContain("Colour contrast for readers with low vision");
    // ...while a capability the description DOES cover is not reported.
    expect(inventory.undocumented).not.toContain("Rendering the chart");
  });
});

describe("buildInventory: an agent", () => {
  test("the tool grant is captured as evidence of what the agent is asked to do", async () => {
    // An agent granted Bash is being asked to do something its description had
    // better imply, so the grant belongs in the inventory alongside the prompt.
    const inventory = await buildInventory({ targetPath: AGENT, kind: "agent", ...NO_SWEEP });
    expect(inventory.name).toBe("spec-auditor");
    expect(inventory.grants).toEqual(["Read", "Grep"]);
    expect(inventory.sources.some((source) => source.role === "tool-grant")).toBe(true);
  });

  test("an absent tool grant is reported as inheriting everything", async () => {
    const inventory = await buildInventory({
      targetPath: `${FIXTURES}/agents/wide-open.md`,
      kind: "agent",
      ...NO_SWEEP,
    });
    expect(inventory.grants).toEqual([]);
    expect(inventory.notes.join(" ")).toContain("inherits every tool");
  });

  test("the system prompt's structure becomes the capability list", async () => {
    const inventory = await buildInventory({ targetPath: AGENT, kind: "agent", ...NO_SWEEP });
    expect(inventory.capabilities).toContain("Contradiction sweep");
    expect(inventory.nonGoals.join(" ")).toContain("rewrite the specification");
  });
});

describe("buildInventory: a command", () => {
  test("the argument plumbing is part of the surface", async () => {
    // A command's arguments are its interface, and a query that supplies one is a
    // positive the body alone would never suggest.
    const inventory = await buildInventory({ targetPath: COMMAND, kind: "command", ...NO_SWEEP });
    expect(inventory.grants).toContain("argument-hint: <environment>");
    expect(inventory.grants).toContain("argument: environment");
  });
});

describe("buildInventory: an MCP config", () => {
  test("server configuration is described without its credentials", async () => {
    // `env` and `headers` values are exactly where a token lives, and this text goes
    // into a subprocess prompt. Key names carry the capability signal; values carry
    // only risk.
    const inventory = await buildInventory({ targetPath: MCP, kind: "mcp", ...NO_SWEEP });
    const excerpts = inventory.sources.map((source) => source.excerpt).join("\n");
    expect(excerpts).toContain("tickets.example.com");
    expect(excerpts).toContain("Authorization");
    expect(excerpts).not.toContain("super-secret-value");
  });

  test("the missing tool list is said out loud rather than papered over", async () => {
    // A `.mcp.json` declares how to REACH a server; the tool names, descriptions and
    // schemas live behind that connection. An author should know which one they are
    // editing scenarios against.
    const inventory = await buildInventory({ targetPath: MCP, kind: "mcp", ...NO_SWEEP });
    expect(inventory.notes.join(" ")).toContain("not what it exposes");
  });

  test("a stdio server's local implementation is followed and read", async () => {
    const root = temporaryRoot("mcp");
    await Bun.write(
      `${root}/notes.mcp.json`,
      JSON.stringify({ mcpServers: { notes: { command: "bun", args: ["./note-server.ts"] } } }),
    );
    await Bun.write(
      `${root}/note-server.ts`,
      "/**\n * note-server -- expose a notes database as MCP tools.\n */\nexport const tools = [];\n",
    );

    const inventory = await buildInventory({
      targetPath: `${root}/notes.mcp.json`,
      kind: "mcp",
      ...NO_SWEEP,
    });
    expect(inventory.sources.some((source) => source.role === "script")).toBe(true);
    expect(inventory.notes).toEqual([]);
  });

  test("an MCP config has no description, so nothing can be circular about it", async () => {
    const inventory = await buildInventory({ targetPath: MCP, kind: "mcp", ...NO_SWEEP });
    expect(inventory.description).toBe("");
  });
});

describe("describeMcpServer", () => {
  test("keeps key names and drops values", () => {
    const described = describeMcpServer("s", { env: { API_TOKEN: "secret" }, command: "bun" });
    expect(described).toContain("API_TOKEN");
    expect(described).not.toContain("secret");
  });

  test("an unreadable entry is reported rather than thrown over", () => {
    expect(describeMcpServer("s", 42)).toContain("unreadable");
  });
});

// ---------------------------------------------------------------------------
// Hard negatives from co-installed neighbours
// ---------------------------------------------------------------------------

describe("neighbour sourcing", () => {
  test("a co-installed skill sharing the artifact's vocabulary is found", async () => {
    // The third hard-negative source, and the sharpest: not an imagined near-miss but
    // a query a real installation will genuinely contest. Asserted by presence rather
    // than by count, since whatever else is installed on the machine varies.
    const root = temporaryRoot("neighbours");
    await Bun.write(
      `${root}/.claude/skills/rival-charter/SKILL.md`,
      "---\nname: rival-charter\ndescription: Renders chart images from spreadsheet data and " +
        "places the result into a slide deck for review.\n---\n\nBody.\n",
    );

    const inventory = await buildInventory({ targetPath: SKILL, kind: "skill", projectDir: root });
    const names = inventory.neighbours.map((neighbour) => neighbour.skill.name);
    expect(names).toContain("rival-charter");
    const rival = inventory.neighbours.find((n) => n.skill.name === "rival-charter");
    expect(rival?.shared.length).toBeGreaterThanOrEqual(2);
  });

  test("the sweep is seeded from body-derived vocabulary, not from the description", async () => {
    // Seeding it from the description would make the hard negatives circular in the
    // same way the positives are guarded against. This rival shares only the words
    // that appear in a bundled reference, never in the description.
    const root = temporaryRoot("neighbours-body");
    await Bun.write(
      `${root}/.claude/skills/contrast-checker/SKILL.md`,
      "---\nname: contrast-checker\ndescription: Audits colour contrast ratios for readers " +
        "with low vision across a design system.\n---\n\nBody.\n",
    );

    const inventory = await buildInventory({ targetPath: SKILL, kind: "skill", projectDir: root });
    const names = inventory.neighbours.map((neighbour) => neighbour.skill.name);
    expect(names).toContain("contrast-checker");
    // Proof it came from the reference rather than the description: none of those
    // words appear in the description at all.
    expect(inventory.description.toLowerCase()).not.toContain("contrast");
    expect(inventory.description.toLowerCase()).not.toContain("vision");
  });
});

// ---------------------------------------------------------------------------
// Counts, parsing and output shape
// ---------------------------------------------------------------------------

describe("splitCount", () => {
  test("an even count splits evenly", () => {
    expect(splitCount(20)).toEqual({ positives: 10, negatives: 10 });
  });

  test("the odd one goes to positives", () => {
    // A positive that never fires is a capability lost outright; an extra negative
    // buys a little precision on a boundary already covered.
    expect(splitCount(21)).toEqual({ positives: 11, negatives: 10 });
  });

  test("a count below two, or a fraction, is rejected", () => {
    expect(() => splitCount(1)).toThrow();
    expect(() => splitCount(7.5)).toThrow();
  });
});

describe("extractScenarioBlock", () => {
  test("prefers the requested tags", () => {
    expect(extractScenarioBlock('noise <scenarios>[{"a":1}]</scenarios> noise')).toBe('[{"a":1}]');
  });

  test("falls back to a fenced json block", () => {
    // Losing a whole synthesis run to a stray code fence would be an expensive way to
    // enforce a formatting preference.
    expect(extractScenarioBlock('Here:\n```json\n[{"a":1}]\n```\n')).toBe('[{"a":1}]');
  });

  test("falls back to a bare array", () => {
    expect(extractScenarioBlock('Sure. [{"a":1}] Done.')).toBe('[{"a":1}]');
  });

  test("returns nothing when there is no array at all", () => {
    expect(extractScenarioBlock("I could not do that.")).toBeUndefined();
  });
});

describe("parseScenarios", () => {
  test("reads well-formed rows", () => {
    const { scenarios, skipped } = parseScenarios([
      { query: "  do the thing  ", should_trigger: true },
      { query: "do another", should_trigger: false },
    ]);
    expect(skipped).toBe(0);
    expect(scenarios).toEqual([
      { query: "do the thing", should_trigger: true },
      { query: "do another", should_trigger: false },
    ]);
  });

  test("drops malformed rows and counts them", () => {
    // One bad row in an otherwise good set of twenty should cost that row, not the run.
    const { scenarios, skipped } = parseScenarios([
      { query: "keep me", should_trigger: true },
      { query: "no flag" },
      { should_trigger: true },
      { query: "   ", should_trigger: false },
      "not an object",
      null,
    ]);
    expect(scenarios).toHaveLength(1);
    expect(skipped).toBe(5);
  });

  test("a response that is not an array is fatal", () => {
    // Nothing to salvage, and pretending otherwise would write an empty eval set.
    expect(() => parseScenarios({ scenarios: [] })).toThrow(TypeError);
  });
});

describe("balanceScenarios", () => {
  const counts = { positives: 2, negatives: 2 };

  test("caps each class and puts positives first", () => {
    const balanced = balanceScenarios(
      [
        { query: "n1", should_trigger: false },
        { query: "p1", should_trigger: true },
        { query: "p2", should_trigger: true },
        { query: "p3", should_trigger: true },
        { query: "n2", should_trigger: false },
      ],
      counts,
    );
    expect(balanced.map((s) => s.query)).toEqual(["p1", "p2", "n1", "n2"]);
  });

  test("deduplicates on normalized text", () => {
    const balanced = balanceScenarios(
      [
        { query: "Fix   the Chart", should_trigger: true },
        { query: "fix the chart", should_trigger: true },
      ],
      counts,
    );
    expect(balanced).toHaveLength(1);
  });

  test("under-delivery is passed through rather than padded", () => {
    // A synthesized set is a draft the author edits: three real scenarios are worth
    // more than four where one was invented to hit a number.
    const balanced = balanceScenarios([{ query: "p1", should_trigger: true }], counts);
    expect(balanced).toHaveLength(1);
  });

  test("the output is the shape the existing loop consumes", () => {
    const balanced = balanceScenarios([{ query: "p1", should_trigger: true }], counts);
    for (const scenario of balanced) {
      expect(Object.keys(scenario).sort()).toEqual(["query", "should_trigger"]);
      expect(typeof scenario.query).toBe("string");
      expect(typeof scenario.should_trigger).toBe("boolean");
    }
  });
});

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

describe("renderInventory", () => {
  test("matches the house report shape", async () => {
    const inventory = await buildInventory({ targetPath: SKILL, kind: "skill", ...NO_SWEEP });
    const report = renderInventory(inventory);
    expect(report.startsWith("# Scenario synthesis: `chart-maker`")).toBe(true);
    expect(report).toContain("- **Target**: `");
    expect(report).toContain("- **Type**: skill");
    expect(report).toContain("## What this artifact appears to do");
    expect(report.trimEnd().endsWith("`--out <path>` to write the scenario set.")).toBe(true);
  });

  test("the description gap gets its own section", async () => {
    const inventory = await buildInventory({ targetPath: SKILL, kind: "skill", ...NO_SWEEP });
    const report = renderInventory(inventory);
    expect(report).toContain("## Capabilities the description never mentions");
    expect(report).toContain("Colour contrast for readers with low vision");
  });

  test("an outcome adds the scenario summary and the draft caveat", async () => {
    const inventory = await buildInventory({ targetPath: SKILL, kind: "skill", ...NO_SWEEP });
    const report = renderInventory(inventory, {
      scenarios: [
        { query: "p", should_trigger: true },
        { query: "n", should_trigger: false },
      ],
      outPath: "/tmp/out.json",
      requested: { positives: 1, negatives: 1 },
      redactions: 2,
      skipped: 1,
    });
    expect(report).toContain("## Scenarios (2)");
    expect(report).toContain("1 positive, 1 negative");
    expect(report).toContain("/tmp/out.json");
    expect(report).toContain("1 malformed row(s)");
    expect(report).toContain("2 passage(s) restating the description");
    expect(report).toContain("**Scenarios are a draft.**");
  });

  test("a note is carried into the report", async () => {
    const inventory = await buildInventory({ targetPath: MCP, kind: "mcp", ...NO_SWEEP });
    expect(renderInventory(inventory)).toContain("> This `.mcp.json` declares");
  });
});
