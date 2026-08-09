/**
 * The consolidated validator: its generic surface, and one rules module each.
 *
 * The tests that matter most here are the three `--with-environment` outcomes.
 * The flag exists because a collision check that cannot see the installed set
 * used to report "no collisions found", and an author reading that shipped. Two
 * of the three cases are therefore about refusing rather than about finding
 * anything, and they are asserted on the exit code as well as the text -- a
 * caller in a script reads the code and never sees the prose.
 */

import { afterAll, describe, expect, test } from "bun:test";

import { CliError } from "../../cli.ts";
import { RULES, TARGET_TYPES } from "../rules/registry.ts";
import { RuleAbort, type Section } from "../rules/types.ts";
import {
  readEnvelope,
  EnvelopeSchema,
  type ArtifactKind,
} from "../../envelope.ts";
import { buildDisclosureEnvelope } from "../../operations/optimize-disclosure.ts";
import {
  asArtifactKind,
  buildValidationEnvelope,
  censusArtifactFiles,
  formatReport,
  parseFinding,
  requireTargetType,
  resolveTier,
  USAGE,
  type ValidationEnvelopeInput,
  type ValidationRow,
} from "../validate.ts";

const CLI = `${import.meta.dir}/../validate.ts`;
const TMP = `${Bun.env["TMPDIR"] ?? "/tmp"}/validate-rules-${Bun.nanoseconds()}`;

let counter = 0;
function tempDir(): string {
  counter += 1;
  return `${TMP}/case-${counter}`;
}

afterAll(async () => {
  await Bun.$`rm -rf ${TMP}`.quiet().nothrow();
});

interface RunOptions {
  readonly home?: string | null;
  readonly cwd?: string;
}

function run(args: readonly string[], options: RunOptions = {}) {
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  if (options.home === null) delete env["HOME"];
  else if (options.home !== undefined) env["HOME"] = options.home;
  const proc = Bun.spawnSync(["bun", CLI, ...args], { env, cwd: options.cwd });
  return {
    code: proc.exitCode,
    out: proc.stdout.toString(),
    err: proc.stderr.toString(),
  };
}

async function writeSkill(
  dir: string,
  frontmatter: string,
  body = "Body.\n",
): Promise<string> {
  await Bun.write(`${dir}/SKILL.md`, `---\n${frontmatter}\n---\n\n${body}`);
  return dir;
}

// ---------------------------------------------------------------------------
// The generic surface
// ---------------------------------------------------------------------------

describe("the entry point stays generic", () => {
  test("every registered artifact is reachable and self-describing", () => {
    expect(TARGET_TYPES).toEqual(["skill", "agent", "command", "mcp", "plugin"]);
    for (const type of TARGET_TYPES) {
      const rule = RULES[type]!;
      expect(rule.targetType).toBe(type);
      expect(rule.summary.length).toBeGreaterThan(0);
      expect(rule.expects.length).toBeGreaterThan(0);
      // The usage text is generated from the registry, so a new artifact cannot
      // be added without appearing in --help.
      expect(USAGE).toContain(type);
      expect(USAGE).toContain(rule.summary);
    }
  });

  test("--help exits 0 and lists every artifact", () => {
    const { code, out } = run(["--help"]);
    expect(code).toBe(0);
    for (const type of TARGET_TYPES) expect(out).toContain(type);
  });

  test("a missing --target-type is a usage error rather than a default", () => {
    const { code, out } = run(["skills/skill-creator"]);
    expect(code).toBe(2);
    expect(out).toContain("missing --target-type");
  });

  test("an unknown --target-type names the valid ones", () => {
    expect(() => requireTargetType({ "target-type": "agnet" })).toThrow(CliError);
    const { code, out } = run(["--target-type", "agnet", "."]);
    expect(code).toBe(2);
    expect(out).toContain("must be one of skill, agent, command, mcp, plugin");
  });

  test("the tier flags are mutually exclusive", () => {
    expect(() => resolveTier({ standard: true, extended: true })).toThrow(CliError);
    expect(resolveTier({ extended: true })).toBe("extended");
    expect(resolveTier({})).toBe("standard");
  });

  test("a flag that cannot apply is rejected, not ignored", () => {
    // Accepting it would let the caller believe a check ran that never could.
    const agent = run(["--target-type", "agent", "agents/skill-reviewer.md", "--with-environment"]);
    expect(agent.code).toBe(2);
    expect(agent.out).toContain("no environment-dependent checks");
  });

  test("a nonexistent path exits 2 rather than reporting a verdict", () => {
    const { code, out } = run(["--target-type", "skill", `${TMP}/definitely-absent`]);
    expect(code).toBe(2);
    expect(out).toContain("No such path");
  });
});

describe("formatReport", () => {
  test("errors decide the verdict and warnings do not", () => {
    const withWarning = formatReport(
      [{ title: "Structure", errors: [], warnings: ["w"] }],
      "skill",
      "/tmp/x",
      "standard",
      false,
    );
    expect(withWarning).toContain("**skill is valid.** 1 warning(s).");

    const withError = formatReport(
      [{ title: "Structure", errors: ["e"], warnings: ["w"] }],
      "skill",
      "/tmp/x",
      "standard",
      false,
    );
    expect(withError).toContain("**skill is invalid.** 1 error(s), 1 warning(s).");
  });

  test("the header states whether environment checks ran", () => {
    const off = formatReport([], "skill", "/tmp/x", "standard", false);
    expect(off).toContain("**Environment checks**: not performed");
    const on = formatReport([], "skill", "/tmp/x", "standard", true);
    expect(on).toContain("**Environment checks**: included");
  });

  test("artifacts without a tier do not claim one", () => {
    const report = formatReport([], "agent", "/tmp/x", "standard", false);
    expect(report).not.toContain("**Tier**");
    expect(report).not.toContain("Environment checks");
  });
});

// ---------------------------------------------------------------------------
// --with-environment: the three outcomes
// ---------------------------------------------------------------------------

describe("--with-environment", () => {
  /** A skill whose description shares vocabulary with the planted neighbour. */
  async function targetSkill(): Promise<string> {
    const dir = `${tempDir()}/pdf-table-extraction`;
    return await writeSkill(
      dir,
      `name: pdf-table-extraction\ndescription: "Extract tables from a PDF into CSV. Use when the user has a PDF whose tables need extracting into a spreadsheet."`,
    );
  }

  /** A home holding one pushy neighbour in the same domain. */
  async function homeWithThief(): Promise<string> {
    const home = tempDir();
    await Bun.write(
      `${home}/.claude/skills/pdf-everything/SKILL.md`,
      `---\nname: pdf-everything\ndescription: "Use this whenever the user mentions a PDF, table, CSV or spreadsheet — even if they don't ask for extraction directly."\n---\n\nBody.\n`,
    );
    return home;
  }

  test("passed and readable: the check runs and names the roots it read", async () => {
    const target = await targetSkill();
    const home = await homeWithThief();
    const { code, out } = run(["--target-type", "skill", target, "--with-environment"], { home });

    expect(out).toContain("**Environment checks**: included");
    expect(out).toContain("Search roots:");
    expect(out).toContain(`${home}/.claude/skills`);
    // Absent roots are reported as absent rather than passed over in silence.
    expect(out).toContain("(absent)");
    expect(out).toContain("pdf-everything");
    expect(code).toBe(1);
  });

  test("passed and readable with nothing installed: clean, and says what it read", async () => {
    const target = await targetSkill();
    const home = tempDir();
    await Bun.write(`${home}/.claude/skills/.keep`, "");
    const { code, out } = run(["--target-type", "skill", target, "--with-environment"], { home });

    expect(code).toBe(0);
    expect(out).toContain("No collisions.");
    expect(out).toContain("Scanned 0 installed skill(s)");
    expect(out).toContain("Search roots:");
  });

  test("passed and unreadable: refuses with exit 2 rather than reporting clean", async () => {
    const target = await targetSkill();
    const home = tempDir();
    // A file where the skills directory belongs: it exists and will not
    // enumerate, which is the same blind spot a permission denial produces.
    await Bun.write(`${home}/.claude/skills`, "not a directory");
    const { code, out } = run(["--target-type", "skill", target, "--with-environment"], { home });

    expect(code).toBe(2);
    expect(out).toContain("could not be read");
    expect(out).toContain(`${home}/.claude/skills`);
    // The critical negative: it must not have reported a clean result.
    expect(out).not.toContain("No collisions");
    expect(out).not.toContain("is valid");
  });

  test("passed with no HOME: refuses, because the roots cannot even be located", async () => {
    const target = await targetSkill();
    const { code, out } = run(["--target-type", "skill", target, "--with-environment"], { home: null });

    expect(code).toBe(2);
    expect(out).toContain("`HOME` is unset");
    expect(out).not.toContain("No collisions");
  });

  test("not passed: the report states the check was not performed", async () => {
    const target = await targetSkill();
    const home = await homeWithThief();
    const { code, out } = run(["--target-type", "skill", target], { home });

    expect(code).toBe(0);
    expect(out).toContain("**Environment checks**: not performed");
    expect(out).toContain("Collision checking was not performed");
    // Silence would be the bug: the thief is installed and goes unmentioned, so
    // the report has to say the question was not asked.
    expect(out).not.toContain("No collisions");
    expect(out).not.toContain("pdf-everything");
  });
});

// ---------------------------------------------------------------------------
// Per-artifact rules
// ---------------------------------------------------------------------------

describe("skill rules", () => {
  test("the structural checks are validate-skill's, unchanged", async () => {
    const dir = await writeSkill(`${tempDir()}/bad-name`, `name: Bad_Name\ndescription: ""`);
    const { code, out } = run(["--target-type", "skill", dir]);
    expect(code).toBe(1);
    expect(out).toContain("kebab-case");
    expect(out).toContain("Description is empty");
  });

  test("an extension field fails standard and passes extended", async () => {
    const dir = await writeSkill(
      `${tempDir()}/modelled`,
      `name: modelled\ndescription: "Does a thing when a thing is needed."\nmodel: opus`,
    );
    expect(run(["--target-type", "skill", dir]).code).toBe(1);
    expect(run(["--target-type", "skill", dir, "--extended"]).code).toBe(0);
  });

  test("purity runs only when the skill ships scripts", async () => {
    const plain = await writeSkill(
      `${tempDir()}/plain`,
      `name: plain\ndescription: "Does a thing when a thing is needed."`,
    );
    expect(run(["--target-type", "skill", plain]).out).not.toContain("Bun purity");

    const coded = `${tempDir()}/coded`;
    await writeSkill(coded, `name: coded\ndescription: "Does a thing when a thing is needed."`);
    // bun-purity-ignore: the fixture has to contain the violation being detected
    await Bun.write(`${coded}/scripts/run.ts`, 'Bun.spawnSync(["python3", "x.py"]);\n');
    const { code, out } = run(["--target-type", "skill", coded]);
    expect(out).toContain("Bun purity");
    expect(out).toContain("spawned-runtime");
    expect(code).toBe(1);
  });
});

describe("agent rules", () => {
  test("kebab-case keys are an error, because an agent silently ignores them", async () => {
    const file = `${tempDir()}/reviewer.md`;
    await Bun.write(
      file,
      `---\nname: reviewer\ndescription: Reviews things.\ndisallowed-tools: Bash\n---\n\nPrompt.\n`,
    );
    const { code, out } = run(["--target-type", "agent", file]);
    expect(code).toBe(1);
    expect(out).toContain("camelCase");
    expect(out).toContain("disallowedTools");
  });

  test("name and description are both required", async () => {
    const file = `${tempDir()}/nameless.md`;
    await Bun.write(file, `---\ntools: Read\n---\n\nPrompt.\n`);
    const { code, out } = run(["--target-type", "agent", file]);
    expect(code).toBe(1);
    expect(out).toContain("Missing `name`");
    expect(out).toContain("Missing `description`");
  });

  test("plugin-ignored fields warn without failing", async () => {
    const file = `${tempDir()}/scoped.md`;
    await Bun.write(
      file,
      `---\nname: scoped\ndescription: Reviews things.\npermissionMode: acceptEdits\n---\n\nPrompt.\n`,
    );
    const { code, out } = run(["--target-type", "agent", file]);
    expect(code).toBe(0);
    expect(out).toContain("ignored for a plugin-bundled agent");
  });
});

describe("command rules", () => {
  test("an argument contract that does not match the body is reported both ways", async () => {
    const promises = `${tempDir()}/promises`;
    await writeSkill(promises, `name: promises\ndescription: "Deploys."\nargument-hint: "[env]"`, "Deploy it.\n");
    expect(run(["--target-type", "command", promises, "--extended"]).out).toContain("promises arguments");

    const silent = `${tempDir()}/silent`;
    await writeSkill(silent, `name: silent\ndescription: "Deploys."`, "Deploy $ARGUMENTS.\n");
    expect(run(["--target-type", "command", silent, "--extended"]).out).toContain("no `argument-hint`");
  });

  test("fail-open guardrails are called out by name", async () => {
    const dir = `${tempDir()}/guarded`;
    await writeSkill(
      dir,
      `name: guarded\ndescription: "Deploys."\ndisable-model-invocation: true`,
      "Deploy it.\n",
    );
    const { out } = run(["--target-type", "command", dir, "--extended"]);
    expect(out).toContain("fail open");
    expect(out).toContain("disable-model-invocation");
  });
});

describe("mcp rules", () => {
  test("a stdio server is flagged for the surfaces it cannot reach", async () => {
    const file = `${tempDir()}/.mcp.json`;
    await Bun.write(file, JSON.stringify({ mcpServers: { db: { command: "bun", args: [] } } }));
    const { code, out } = run(["--target-type", "mcp", file]);
    expect(code).toBe(0);
    expect(out).toContain("web and mobile");
  });

  test("spawning a foreign runtime is an error", async () => {
    const file = `${tempDir()}/.mcp.json`;
    // bun-purity-ignore: the fixture has to name the runtime the rule rejects
    await Bun.write(file, JSON.stringify({ mcpServers: { db: { command: "npx", args: ["x"] } } }));
    const { code, out } = run(["--target-type", "mcp", file]);
    expect(code).toBe(1);
    expect(out).toContain("runtime outside Bun");
  });
});

describe("plugin rules", () => {
  test("a skill directory with no SKILL.md registers nothing", async () => {
    const root = tempDir();
    await Bun.write(`${root}/.claude-plugin/plugin.json`, JSON.stringify({ name: "p", version: "1" }));
    await Bun.write(`${root}/skills/empty/notes.md`, "hi");
    const { code, out } = run(["--target-type", "plugin", root]);
    expect(code).toBe(1);
    expect(out).toContain("has no SKILL.md");
  });

  test("a component-path override that replaces the default scan warns", async () => {
    const root = tempDir();
    await Bun.write(
      `${root}/.claude-plugin/plugin.json`,
      JSON.stringify({ name: "p", version: "1", agents: "./elsewhere" }),
    );
    const { out } = run(["--target-type", "plugin", root]);
    expect(out).toContain("replaces");
  });

  test("a bare relative override path is an error", async () => {
    const root = tempDir();
    await Bun.write(
      `${root}/.claude-plugin/plugin.json`,
      JSON.stringify({ name: "p", version: "1", skills: "elsewhere" }),
    );
    const { code, out } = run(["--target-type", "plugin", root]);
    expect(code).toBe(1);
    expect(out).toContain("./");
  });
});

describe("RuleAbort", () => {
  test("carries a message rather than a verdict", () => {
    const abort = new RuleAbort("could not look");
    expect(abort).toBeInstanceOf(Error);
    expect(abort.message).toBe("could not look");
  });
});

// ---------------------------------------------------------------------------
// The results envelope
// ---------------------------------------------------------------------------

describe("the results envelope", () => {
  const section_ = (
    title: string,
    errors: readonly string[] = [],
    warnings: readonly string[] = [],
    note?: string,
  ): Section => (note === undefined ? { title, errors, warnings } : { title, errors, warnings, note });

  function input(overrides: Partial<ValidationEnvelopeInput> = {}): ValidationEnvelopeInput {
    return {
      sections: [section_("Structure", ["`name` is missing."], ["`description` is long."])],
      targetType: "skill",
      path: "/skills/demo",
      tier: "standard",
      withEnvironment: false,
      census: { examined: 7, unreadable: 0 },
      targetSha: "sha256:target",
      installState: "unknown",
      ...overrides,
    };
  }

  test("a validate run produces a valid envelope, so the contract is not measurement-only", () => {
    // The reason this producer exists in the retrofit at all. Everything else that writes
    // an envelope spawns a model and reports rates; if the contract only fitted those it
    // would be a measurement schema with an ambitious name.
    expect(EnvelopeSchema.safeParse(buildValidationEnvelope(input())).success).toBe(true);
  });

  test("the timeout policy is `not-applicable`, because nothing here is spawned", () => {
    const envelope = buildValidationEnvelope(input());
    expect(envelope.provenance.timeoutPolicy).toBe("not-applicable");
    // The field it pairs with. A budget recorded on an operation with no budget would be
    // a comparability key that moves for no reason.
    expect(envelope.run.timeoutSeconds).toBeNull();
  });

  test("excluded and failed are counted separately from scored, and both are files", () => {
    const envelope = buildValidationEnvelope(
      input({ census: { examined: 12, unreadable: 3 } }),
    );
    expect(envelope.provenance.unit).toBe("file examined");
    expect(envelope.provenance.scored).toBe(12);
    // A file that is there and will not open has not been checked. Folding it into
    // `scored` would claim a check that never happened.
    expect(envelope.provenance.excluded).toBe(3);
    expect(envelope.provenance.failed).toBe(3);
    expect(
      envelope.provenance.caps.some((cap) => cap.includes("could not be opened")),
    ).toBe(true);
  });

  test("a clean census reports zeros rather than omitting the counts", () => {
    const envelope = buildValidationEnvelope(input());
    expect(envelope.provenance.scored).toBe(7);
    expect(envelope.provenance.excluded).toBe(0);
    expect(envelope.provenance.failed).toBe(0);
  });

  test("the two timeout policies in this repository disagree, and both envelopes say so", () => {
    // The comparison the field exists to make possible, asserted across two producers so
    // that unifying them by accident breaks a test rather than a reader's conclusion.
    expect(buildValidationEnvelope(input()).provenance.timeoutPolicy).toBe("not-applicable");
    expect(
      buildDisclosureEnvelope({
        output: {
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
          best_layout_path: "/tmp/best",
          applied_edits: [],
          files: [],
          iterations: [],
          notes: [],
        },
        tally: { measured: 8, unloaded: 0, timeout: 2, error: 0 },
        plannedRuns: 10,
        model: "opus",
        graderModel: "sonnet",
        workers: 12,
        timeoutSeconds: 600,
        maxIterations: 3,
        maxCandidates: 3,
        inlineThreshold: 0.8,
        scenarioSetHash: "sha256:s",
        targetSha: "sha256:t",
        installState: "absent",
      }).provenance.timeoutPolicy,
    ).toBe("excluded");
  });

  test("the fields that cannot apply are null, and the ones that can are filled", () => {
    const envelope = buildValidationEnvelope(input());
    // Genuinely inapplicable: no model is asked anything, no questions are posed, nothing
    // can time out.
    expect(envelope.run.model).toBeNull();
    expect(envelope.run.graderModel).toBeNull();
    expect(envelope.run.evalSetHash).toBeNull();
    expect(envelope.run.timeoutSeconds).toBeNull();
    // Genuinely applicable, and 1 is the truthful answer rather than a stand-in: the run is
    // sequential and examines each file exactly once.
    expect(envelope.run.workers).toBe(1);
    expect(envelope.run.runsPer).toBe(1);
    expect(envelope.run.operation).toBe("validate");
    expect(envelope.run.artifact).toBe("skill");
    expect(envelope.run.targetSha).toBe("sha256:target");
  });

  test("installState is `unknown` when nothing read the machine, never `absent`", () => {
    // `absent` is a claim about a machine this run did not look at, and it is a
    // comparability key — two runs that both assert `absent` would compare as equal while
    // one of them never checked.
    const envelope = buildValidationEnvelope(input({ withEnvironment: false }));
    expect(envelope.run.installState).toBe("unknown");
    expect(
      envelope.provenance.caps.some((cap) => cap.includes("were NOT performed")),
    ).toBe(true);
  });

  test("`run.target` is the path's basename, and the envelope admits it is not a name", () => {
    // The one required field that does not fit this operation. A validator is routinely
    // pointed at artifacts whose `name` is missing or malformed — that is what it is for —
    // and reading one would mean branching on artifact type, which this entry point is
    // built never to do. So the field is filled with something defined and the cap says
    // plainly that it is not what the field asked for.
    const envelope = buildValidationEnvelope(input({ path: "/skills/demo/" }));
    expect(envelope.run.target).toBe("demo");
    expect(envelope.provenance.caps[0]).toContain("basename rather than the artifact's authored name");
  });

  test("one row per finding, carrying file, line, severity, rule and message", () => {
    const envelope = buildValidationEnvelope(
      input({
        sections: [
          section_("Structure", ["`name` is missing."]),
          section_(
            "Bun purity",
            ["`scripts/run.ts:12` — **spawned-runtime** — Spawns `python3`. Fix: use Bun."],
            ["`scripts/a.ts` — **npm-dependency** — Imports `chalk`. Fix: drop it."],
          ),
        ],
      }),
    );
    expect(envelope.rows).toHaveLength(3);
    expect(envelope.rows[0]).toEqual({
      // No file was named, so the finding is about the artifact, which is true.
      file: "/skills/demo",
      line: null,
      severity: "error",
      rule: "Structure",
      message: "`name` is missing.",
      section: "Structure",
    });
    expect(envelope.rows[1]).toEqual({
      file: "scripts/run.ts",
      line: 12,
      severity: "error",
      rule: "spawned-runtime",
      message: "Spawns `python3`. Fix: use Bun.",
      section: "Bun purity",
    });
    // Errors before warnings within a section, and the warning keeps its severity.
    expect(envelope.rows[2]?.severity).toBe("warning");
    expect(envelope.rows[2]?.line).toBeNull();
  });

  test("headline counts errors and warnings apart, and reports the file count", () => {
    const envelope = buildValidationEnvelope(input({ census: { examined: 9, unreadable: 0 } }));
    expect(envelope.headline).toEqual([
      { label: "errors", value: 1, unit: "findings" },
      { label: "warnings", value: 1, unit: "findings" },
      { label: "files examined", value: 9, unit: "files" },
    ]);
  });

  test("a section that reported nothing is `no-findings`, never `pass`", () => {
    // The distinction the whole `--with-environment` flag exists for. A section that ran
    // and was satisfied and a section that declined to look both arrive as zero errors and
    // zero warnings; `pass` is a judgement this code has not earned on the second.
    const envelope = buildValidationEnvelope(
      input({
        sections: [
          section_("Structure"),
          section_("Trigger collisions", [], [], "Collision checking was not performed."),
        ],
      }),
    );
    const bySubject = new Map(envelope.verdicts.map((v) => [v.subject, v]));
    expect(bySubject.get("Structure")?.verdict).toBe("no-findings");
    expect(bySubject.get("Trigger collisions")?.verdict).toBe("no-findings");
    expect(envelope.verdicts.some((v) => v.verdict === "pass")).toBe(false);
    // The declining section's own note travels with the verdict, which is where it says so.
    expect(bySubject.get("Trigger collisions")?.reason).toContain("was not performed");
  });

  test("a skipped environment check gets a `not-checked` verdict of its own", () => {
    const skipped = buildValidationEnvelope(input({ withEnvironment: false }));
    const notChecked = skipped.verdicts.find((v) => v.verdict === "not-checked");
    expect(notChecked?.subject).toBe("environment-dependent checks");
    expect(notChecked?.reason).toContain("not a clean bill of health");
    // And it is absent when the check actually ran, rather than always present.
    expect(
      buildValidationEnvelope(input({ withEnvironment: true })).verdicts.some(
        (v) => v.verdict === "not-checked",
      ),
    ).toBe(false);
  });

  test("an artifact with no environment checks claims neither one way nor the other", () => {
    // `mcp` has no environment-dependent checks at all, so there is nothing that was
    // skipped and nothing to declare.
    const envelope = buildValidationEnvelope(
      input({ targetType: "mcp", path: "/servers/.mcp.json", sections: [section_("Servers")] }),
    );
    expect(envelope.verdicts.some((v) => v.verdict === "not-checked")).toBe(false);
    expect(envelope.provenance.caps.some((cap) => cap.includes("were NOT performed"))).toBe(false);
  });

  test("the artifact verdict is decided by errors, and says what it does not cover", () => {
    expect(buildValidationEnvelope(input()).verdicts[0]).toMatchObject({
      subject: "demo",
      verdict: "invalid",
    });
    const clean = buildValidationEnvelope(input({ sections: [section_("Structure")] }));
    expect(clean.verdicts[0]?.verdict).toBe("valid");
    expect(clean.verdicts[0]?.reason).toContain("see `provenance.caps` for what was not");
  });

  test("the tier is a cap, because `--standard` leaves extension fields unchecked", () => {
    const standard = buildValidationEnvelope(input({ tier: "standard" }));
    expect(
      standard.provenance.caps.some((cap) => cap.includes("portable Agent Skills field set only")),
    ).toBe(true);
    const extended = buildValidationEnvelope(input({ tier: "extended" }));
    expect(
      extended.provenance.caps.some((cap) => cap.includes("portable Agent Skills field set only")),
    ).toBe(false);
    // An artifact with no tier never claims one either way.
    const untiered = buildValidationEnvelope(
      input({ targetType: "agent", tier: "standard", sections: [section_("Structure")] }),
    );
    expect(
      untiered.provenance.caps.some((cap) => cap.includes("portable Agent Skills field set only")),
    ).toBe(false);
  });

  test("the target type is always a cap: one pass checks one artifact's rules", () => {
    expect(
      buildValidationEnvelope(input()).provenance.caps.some((cap) =>
        cap.includes("Only the `skill` rules ran"),
      ),
    ).toBe(true);
  });
});

describe("parseFinding", () => {
  const parse = (text: string) =>
    parseFinding({ text, severity: "error", section: "Bun purity", fallbackFile: "/skills/demo" });

  test("recovers the file, line and rule the rendered form carries", () => {
    expect(parse("`scripts/a.ts:41` — **npm-dependency** — Imports `chalk`.")).toEqual({
      file: "scripts/a.ts",
      line: 41,
      severity: "error",
      rule: "npm-dependency",
      message: "Imports `chalk`.",
      section: "Bun purity",
    });
  });

  test("line 0 is the scanner's file-level sentinel and becomes null, not a line", () => {
    // A `0` travelling as a line number is a location no editor can jump to.
    expect(parse("`package.json:0` — **lockfile** — No lockfile.").line).toBeNull();
  });

  test("a locator with no line keeps its whole path", () => {
    expect(parse("`scripts/a.ts` — **npm-dependency** — Imports `chalk`.").file).toBe(
      "scripts/a.ts",
    );
  });

  test("a colon that is not a line number does not eat the last path segment", () => {
    const row = parse("`C:/work/a.ts` — **npm-dependency** — Imports `chalk`.");
    expect(row.file).toBe("C:/work/a.ts");
    expect(row.line).toBeNull();
  });

  test("an unrecognized shape degrades to a row that is still completely true", () => {
    // The property that makes reading structure back out of rendered markdown safe: a
    // parse that does not match loses nothing, because the message is kept verbatim and
    // the file falls back to the artifact the finding is genuinely about.
    const row = parse("The body is empty. It is the agent's system prompt.");
    expect(row).toEqual({
      file: "/skills/demo",
      line: null,
      severity: "error",
      rule: "Bun purity",
      message: "The body is empty. It is the agent's system prompt.",
      section: "Bun purity",
    });
  });

  test("a message spanning several lines survives intact", () => {
    expect(parse("`a.ts:1` — **r** — First line.\nSecond line.").message).toBe(
      "First line.\nSecond line.",
    );
  });
});

describe("asArtifactKind", () => {
  test("every registered target type maps onto an envelope artifact kind", () => {
    // The drift this catches: `../rules/registry.ts` is keyed by plain strings, so adding a
    // seventh artifact there compiles fine and would write an envelope claiming a kind the
    // contract does not define. `writeEnvelope` would refuse it at runtime; this refuses it
    // in the suite.
    for (const targetType of TARGET_TYPES) {
      expect(asArtifactKind(targetType)).toBe(targetType as ArtifactKind);
    }
  });

  test("an unknown kind is refused by name rather than guessed at", () => {
    expect(() => asArtifactKind("output-style")).toThrow(CliError);
    expect(() => asArtifactKind("output-style")).toThrow("lib/envelope.ts");
  });
});

describe("censusArtifactFiles", () => {
  test("counts the artifact's files, with the same exclusions the target hash uses", async () => {
    // Same set as `hashArtifact`, deliberately: `provenance.scored` and `run.targetSha`
    // then describe the same files. Counting `node_modules` would make the number a report
    // on somebody's install rather than on the artifact.
    const dir = tempDir();
    await Bun.write(`${dir}/SKILL.md`, "x");
    await Bun.write(`${dir}/references/a.md`, "x");
    await Bun.write(`${dir}/node_modules/pkg/index.js`, "x");
    await Bun.write(`${dir}/.git/HEAD`, "x");
    expect(await censusArtifactFiles(dir)).toEqual({ examined: 2, unreadable: 0 });
  });

  test("a single-file artifact is one file, not zero", async () => {
    const dir = tempDir();
    await Bun.write(`${dir}/reviewer.md`, "x");
    expect(await censusArtifactFiles(`${dir}/reviewer.md`)).toEqual({
      examined: 1,
      unreadable: 0,
    });
  });

  test("a path that is not there reports an unreadable file rather than a clean zero", async () => {
    // Zero examined and zero unreadable would read as "an artifact with no files", which is
    // a different and much more reassuring statement than "nothing was there to check".
    expect(await censusArtifactFiles(`${tempDir()}/gone.md`)).toEqual({
      examined: 0,
      unreadable: 1,
    });
  });
});

describe("the --envelope flag end to end", () => {
  test("writes an envelope beside the report without changing the report", async () => {
    const dir = tempDir();
    const skill = await writeSkill(
      `${dir}/demo`,
      "name: demo\ndescription: A demo skill with a description long enough to be plausible for the validator.",
    );
    const envelopePath = `${dir}/envelope.json`;

    const without = run(["--target-type", "skill", skill]);
    const with_ = run(["--target-type", "skill", skill, "--envelope", envelopePath]);
    // The markdown is the wire contract every existing caller reads. It does not move.
    expect(with_.out).toBe(without.out);
    expect(with_.code).toBe(without.code);
    expect(with_.err).toContain("Envelope written to:");

    const envelope = await readEnvelope(envelopePath);
    expect(envelope.run.operation).toBe("validate");
    expect(envelope.run.target).toBe("demo");
    expect(envelope.run.installState).toBe("unknown");
    expect(envelope.provenance.timeoutPolicy).toBe("not-applicable");
    expect(envelope.provenance.scored).toBe(1);
    expect(envelope.run.targetSha).toStartWith("sha256:");
  });

  test("no flag, no file: the envelope is additive and opt-in", async () => {
    const dir = tempDir();
    const skill = await writeSkill(
      `${dir}/demo`,
      "name: demo\ndescription: A demo skill with a description long enough to be plausible for the validator.",
    );
    run(["--target-type", "skill", skill]);
    expect(await Bun.file(`${dir}/envelope.json`).exists()).toBe(false);
  });

  test("--with-environment is what turns installState into an observation", async () => {
    const dir = tempDir();
    const home = `${dir}/home`;
    await Bun.write(`${home}/.claude/skills/.keep`, "");
    const skill = await writeSkill(
      `${dir}/demo`,
      "name: demo\ndescription: A demo skill with a description long enough to be plausible for the validator.",
    );
    const envelopePath = `${dir}/envelope.json`;
    const result = run(
      ["--target-type", "skill", skill, "--with-environment", "--envelope", envelopePath],
      { home, cwd: dir },
    );
    expect(result.code).toBe(0);
    const envelope = await readEnvelope(envelopePath);
    // Nothing else on this machine answers to the name, and the sweep actually looked.
    expect(envelope.run.installState).toBe("absent");
    expect(envelope.verdicts.some((v) => v.verdict === "not-checked")).toBe(false);
  });

  test("findings reach the rows with their severity intact", async () => {
    const dir = tempDir();
    // `argument-hint` is a Claude Code extension, so `--standard` reports it as an error.
    const skill = await writeSkill(
      `${dir}/demo`,
      "name: demo\ndescription: A demo skill with a description long enough to be plausible for the validator.\nargument-hint: <path>",
    );
    const envelopePath = `${dir}/envelope.json`;
    expect(run(["--target-type", "skill", skill, "--envelope", envelopePath]).code).toBe(1);
    const envelope = await readEnvelope(envelopePath);
    const rows = envelope.rows as readonly ValidationRow[];
    expect(rows.some((row) => row.severity === "error" && row.message.includes("argument-hint"))).toBe(
      true,
    );
    expect(envelope.verdicts[0]?.verdict).toBe("invalid");
    expect(envelope.headline.find((metric) => metric.label === "errors")?.value).toBe(rows.length);
  });
});
