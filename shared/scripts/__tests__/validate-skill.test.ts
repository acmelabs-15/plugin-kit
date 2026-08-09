import { afterAll, describe, expect, test } from "bun:test";

import { CliError, parseArgs } from "../lib/cli.ts";
import {
  BODY_LINES_MAX,
  CLI_SPEC,
  COMPATIBILITY_MAX,
  DESCRIPTION_HARD_MAX,
  DESCRIPTION_MAX,
  NAME_MAX,
  baseName,
  extractReferences,
  formatResult,
  resolveTier,
  resolvePath,
  validateSkill,
  type Tier,
} from "../validate-skill.ts";

const TMP_ROOT = `${Bun.env.TMPDIR ?? "/tmp"}/skill-creator-validate-${Bun.nanoseconds()}`;
const CLI = `${import.meta.dir}/../validate-skill.ts`;

let counter = 0;

afterAll(async () => {
  await Bun.$`rm -rf ${TMP_ROOT}`.quiet().nothrow();
});

interface SkillSpec {
  readonly dirName?: string;
  readonly frontmatter: readonly string[];
  readonly body?: string;
  readonly files?: Readonly<Record<string, string>>;
  /** Write SKILL.md verbatim, bypassing frontmatter assembly. */
  readonly raw?: string;
}

/** Materialise a skill directory and return its path. */
async function makeSkill(spec: SkillSpec): Promise<string> {
  counter += 1;
  const dirName = spec.dirName ?? "demo-skill";
  const dir = `${TMP_ROOT}/case-${counter}/${dirName}`;
  const content =
    spec.raw ?? ["---", ...spec.frontmatter, "---", "", spec.body ?? "# Demo"].join("\n");
  await Bun.write(`${dir}/SKILL.md`, content);
  for (const [path, text] of Object.entries(spec.files ?? {})) {
    await Bun.write(`${dir}/${path}`, text);
  }
  return dir;
}

const VALID = ["name: demo-skill", "description: A demo skill for tests."];

describe("structural checks (fatal, ported verbatim)", () => {
  test("accepts a minimal valid skill", async () => {
    const result = await validateSkill(await makeSkill({ frontmatter: VALID }));
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  test("reports a missing SKILL.md", async () => {
    const result = await validateSkill(`${TMP_ROOT}/does-not-exist`);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(["SKILL.md not found."]);
  });

  test("reports missing frontmatter", async () => {
    const dir = await makeSkill({ frontmatter: [], raw: "# No frontmatter\n" });
    expect((await validateSkill(dir)).errors).toEqual(["No YAML frontmatter found."]);
  });

  test("reports an unterminated frontmatter block", async () => {
    const dir = await makeSkill({ frontmatter: [], raw: "---\nname: demo-skill\n" });
    expect((await validateSkill(dir)).errors).toEqual(["Invalid frontmatter format."]);
  });

  test("rejects CRLF frontmatter, preserving the Python regex's \\n requirement", async () => {
    const dir = await makeSkill({
      frontmatter: [],
      raw: "---\r\nname: demo-skill\r\ndescription: x\r\n---\r\n",
    });
    expect((await validateSkill(dir)).errors).toEqual(["Invalid frontmatter format."]);
  });

  test("reports invalid YAML", async () => {
    const dir = await makeSkill({ frontmatter: ["name: [unclosed"] });
    const result = await validateSkill(dir);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toStartWith("Invalid YAML in frontmatter:");
  });

  test("rejects a YAML sequence at the top level", async () => {
    const dir = await makeSkill({ frontmatter: ["- one", "- two"] });
    expect((await validateSkill(dir)).errors).toEqual(["Frontmatter must be a YAML dictionary."]);
  });

  test("rejects empty frontmatter", async () => {
    const dir = await makeSkill({ frontmatter: [""] });
    expect((await validateSkill(dir)).errors).toEqual(["Frontmatter must be a YAML dictionary."]);
  });
});

describe("tier: --standard is Agent Skills standard conformance", () => {
  test.each(["license: MIT", "allowed-tools: Read", "compatibility: claude-code"])(
    "accepts the standard field %s",
    async (field) => {
      const dir = await makeSkill({ frontmatter: [...VALID, field] });
      expect((await validateSkill(dir, "standard")).valid).toBe(true);
    },
  );

  test("rejects a Claude Code extension and explains why", async () => {
    const dir = await makeSkill({ frontmatter: [...VALID, "version: 1.0.0"] });
    const result = await validateSkill(dir, "standard");
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("`version`");
    expect(result.errors[0]).toContain("Claude Code extension");
    expect(result.errors[0]).toContain("--extended");
  });

  test.each([
    "disallowed-tools: Bash",
    "when_to_use: always",
    "argument-hint: <file>",
    "user-invocable: true",
    "disable-model-invocation: true",
    "model: opus",
    "effort: high",
    "background: true",
    "shell: bash",
  ])("rejects the extension %s under --standard", async (field) => {
    const dir = await makeSkill({ frontmatter: [...VALID, field] });
    const result = await validateSkill(dir, "standard");
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("Claude Code extension");
  });

  test("defaults to the standard tier", async () => {
    const dir = await makeSkill({ frontmatter: [...VALID, "version: 1.0.0"] });
    expect((await validateSkill(dir)).valid).toBe(false);
  });

  test("reports a genuinely unknown key differently from a known extension", async () => {
    const dir = await makeSkill({ frontmatter: [...VALID, "bogus-key: x"] });
    const result = await validateSkill(dir, "standard");
    expect(result.errors[0]).toContain("Unexpected key `bogus-key`");
    expect(result.errors[0]).not.toContain("Claude Code extension");
    expect(result.errors[0]).toContain("Allowed properties are:");
  });

  test("reports every unexpected key, not just the first", async () => {
    const dir = await makeSkill({ frontmatter: [...VALID, "alpha: 1", "zeta: 2"] });
    const result = await validateSkill(dir, "standard");
    expect(result.errors).toHaveLength(2);
  });
});

describe("tier: --extended permits Claude Code extensions", () => {
  test.each([
    "disallowed-tools: Bash",
    "version: 1.0.0",
    "when_to_use: always",
    "argument-hint: <file>",
    "arguments: none",
    "user-invocable: true",
    "disable-model-invocation: true",
    "model: opus",
    "effort: high",
    "context: fresh",
    "agent: general-purpose",
    "background: true",
    "hooks: none",
    "paths: src",
    "shell: bash",
  ])("accepts %s", async (field) => {
    const dir = await makeSkill({ frontmatter: [...VALID, field] });
    expect((await validateSkill(dir, "extended")).valid).toBe(true);
  });

  test("still rejects a genuinely unknown key", async () => {
    const dir = await makeSkill({ frontmatter: [...VALID, "bogus-key: x"] });
    const result = await validateSkill(dir, "extended");
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("Unexpected key `bogus-key`");
  });
});

describe("name validation", () => {
  test("reports an absent name", async () => {
    const dir = await makeSkill({ frontmatter: ["description: A demo skill."] });
    expect((await validateSkill(dir)).errors).toContain("Missing `name` in frontmatter.");
  });

  test("DIVERGENCE: an empty name is a hard error (Python let it pass)", async () => {
    const dir = await makeSkill({ frontmatter: ['name: ""', "description: A demo skill."] });
    const result = await validateSkill(dir);
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("Name is empty");
  });

  test("DIVERGENCE: a whitespace-only name is a hard error", async () => {
    const dir = await makeSkill({ frontmatter: ['name: "   "', "description: A demo skill."] });
    expect((await validateSkill(dir)).valid).toBe(false);
  });

  test("reports a null name with its type", async () => {
    const dir = await makeSkill({ frontmatter: ["name:", "description: A demo skill."] });
    expect((await validateSkill(dir)).errors).toContain("Name must be a string, got null.");
  });

  test("reports a numeric name with its type", async () => {
    const dir = await makeSkill({ frontmatter: ["name: 42", "description: A demo skill."] });
    expect((await validateSkill(dir)).errors).toContain("Name must be a string, got number.");
  });

  test.each(["Demo-Skill", "demo_skill", "demo skill", "demo.skill", "démo"])(
    "rejects non-kebab-case name %s",
    async (name) => {
      const dir = await makeSkill({
        dirName: "x",
        frontmatter: [`name: "${name}"`, "description: A demo skill."],
      });
      const result = await validateSkill(dir);
      expect(result.valid).toBe(false);
      expect(result.errors.join("\n")).toContain("kebab-case");
    },
  );

  test.each(["-leading", "trailing-", "double--hyphen"])(
    "rejects hyphen-shaped name %s",
    async (name) => {
      const dir = await makeSkill({
        dirName: name,
        frontmatter: [`name: "${name}"`, "description: A demo skill."],
      });
      const result = await validateSkill(dir);
      expect(result.valid).toBe(false);
      expect(result.errors.join("\n")).toContain("consecutive hyphens");
    },
  );

  test("accepts digits and single hyphens", async () => {
    const dir = await makeSkill({
      dirName: "skill-2-alpha",
      frontmatter: ["name: skill-2-alpha", "description: A demo skill."],
    });
    expect((await validateSkill(dir)).valid).toBe(true);
  });

  test(`accepts a name of exactly ${NAME_MAX} characters`, async () => {
    const name = "a".repeat(NAME_MAX);
    const dir = await makeSkill({
      dirName: name,
      frontmatter: [`name: ${name}`, "description: A demo skill."],
    });
    expect((await validateSkill(dir)).valid).toBe(true);
  });

  test(`rejects a name of ${NAME_MAX + 1} characters`, async () => {
    const name = "a".repeat(NAME_MAX + 1);
    const dir = await makeSkill({
      dirName: name,
      frontmatter: [`name: ${name}`, "description: A demo skill."],
    });
    const result = await validateSkill(dir);
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain(`Name is too long (${NAME_MAX + 1} characters)`);
  });
});

describe("description validation", () => {
  const withDescription = (text: string): readonly string[] => [
    "name: demo-skill",
    `description: "${text}"`,
  ];

  test("reports an absent description", async () => {
    const dir = await makeSkill({ frontmatter: ["name: demo-skill"] });
    expect((await validateSkill(dir)).errors).toContain("Missing `description` in frontmatter.");
  });

  test("DIVERGENCE: an empty description is a hard error (Python let it pass)", async () => {
    const dir = await makeSkill({ frontmatter: ["name: demo-skill", 'description: ""'] });
    const result = await validateSkill(dir);
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("Description is empty");
  });

  test("reports a null description with its type", async () => {
    const dir = await makeSkill({ frontmatter: ["name: demo-skill", "description:"] });
    expect((await validateSkill(dir)).errors).toContain(
      "Description must be a string, got null.",
    );
  });

  test.each(["a < b", "a > b", "<tag>"])("rejects angle brackets in %s", async (text) => {
    const dir = await makeSkill({ frontmatter: withDescription(text) });
    const result = await validateSkill(dir);
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("angle brackets");
  });

  test(`--standard accepts exactly ${DESCRIPTION_MAX} characters`, async () => {
    const dir = await makeSkill({ frontmatter: withDescription("a".repeat(DESCRIPTION_MAX)) });
    expect((await validateSkill(dir, "standard")).valid).toBe(true);
  });

  test(`--standard rejects ${DESCRIPTION_MAX + 1} characters`, async () => {
    const dir = await makeSkill({ frontmatter: withDescription("a".repeat(DESCRIPTION_MAX + 1)) });
    const result = await validateSkill(dir, "standard");
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain(`Description is too long (${DESCRIPTION_MAX + 1}`);
    expect(result.warnings).toEqual([]);
  });

  test(`--extended warns but stays valid at ${DESCRIPTION_MAX + 1} characters`, async () => {
    const dir = await makeSkill({ frontmatter: withDescription("a".repeat(DESCRIPTION_MAX + 1)) });
    const result = await validateSkill(dir, "extended");
    expect(result.valid).toBe(true);
    expect(result.warnings.join("\n")).toContain("left the portable standard");
  });

  test(`--extended does not warn at exactly ${DESCRIPTION_MAX} characters`, async () => {
    const dir = await makeSkill({ frontmatter: withDescription("a".repeat(DESCRIPTION_MAX)) });
    const result = await validateSkill(dir, "extended");
    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  test(`--extended warns but stays valid at exactly ${DESCRIPTION_HARD_MAX} characters`, async () => {
    const dir = await makeSkill({
      frontmatter: withDescription("a".repeat(DESCRIPTION_HARD_MAX)),
    });
    const result = await validateSkill(dir, "extended");
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(1);
  });

  test(`--extended hard-errors at ${DESCRIPTION_HARD_MAX + 1} characters`, async () => {
    const dir = await makeSkill({
      frontmatter: withDescription("a".repeat(DESCRIPTION_HARD_MAX + 1)),
    });
    const result = await validateSkill(dir, "extended");
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("truncates its skill listing");
  });
});

describe("compatibility validation", () => {
  test(`accepts exactly ${COMPATIBILITY_MAX} characters`, async () => {
    const dir = await makeSkill({
      frontmatter: [...VALID, `compatibility: "${"a".repeat(COMPATIBILITY_MAX)}"`],
    });
    expect((await validateSkill(dir)).valid).toBe(true);
  });

  test(`rejects ${COMPATIBILITY_MAX + 1} characters`, async () => {
    const dir = await makeSkill({
      frontmatter: [...VALID, `compatibility: "${"a".repeat(COMPATIBILITY_MAX + 1)}"`],
    });
    const result = await validateSkill(dir);
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("Compatibility is too long");
  });

  test("an empty compatibility is skipped, matching the original's `if compatibility:`", async () => {
    const dir = await makeSkill({ frontmatter: [...VALID, 'compatibility: ""'] });
    expect((await validateSkill(dir)).valid).toBe(true);
  });

  test("reports a non-string compatibility", async () => {
    const dir = await makeSkill({ frontmatter: [...VALID, "compatibility: 42"] });
    expect((await validateSkill(dir)).errors).toContain(
      "Compatibility must be a string, got number.",
    );
  });
});

describe("directory-name mismatch (added check)", () => {
  test("warns, but stays valid, when name and directory differ", async () => {
    const dir = await makeSkill({
      dirName: "actual-directory",
      frontmatter: ["name: declared-name", "description: A demo skill."],
    });
    const result = await validateSkill(dir);
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("does not match its parent directory");
    expect(result.warnings[0]).toContain("actual-directory");
  });

  test("no warning when they match", async () => {
    const dir = await makeSkill({ dirName: "demo-skill", frontmatter: VALID });
    expect((await validateSkill(dir)).warnings).toEqual([]);
  });

  test("a trailing slash does not create a false mismatch", async () => {
    const dir = await makeSkill({ dirName: "demo-skill", frontmatter: VALID });
    expect((await validateSkill(`${dir}/`)).warnings).toEqual([]);
  });
});

describe("dangling references (added check)", () => {
  test("reports a markdown link to a missing file", async () => {
    const dir = await makeSkill({
      frontmatter: VALID,
      body: "See [the guide](references/guide.md).",
    });
    const result = await validateSkill(dir);
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("Dangling reference");
    expect(result.errors.join("\n")).toContain("references/guide.md");
  });

  test("accepts a markdown link to a file that exists", async () => {
    const dir = await makeSkill({
      frontmatter: VALID,
      body: "See [the guide](references/guide.md).",
      files: { "references/guide.md": "# Guide" },
    });
    expect((await validateSkill(dir)).valid).toBe(true);
  });

  test("accepts a link to a directory", async () => {
    const dir = await makeSkill({
      frontmatter: VALID,
      body: "See [the folder](references).",
      files: { "references/guide.md": "# Guide" },
    });
    expect((await validateSkill(dir)).valid).toBe(true);
  });

  test("ignores external URLs, anchors and absolute paths", async () => {
    const dir = await makeSkill({
      frontmatter: VALID,
      body: [
        "[web](https://example.com/x.md)",
        "[mail](mailto:a@b.com)",
        "[anchor](#section)",
        "[abs](/etc/hosts)",
        "[home](~/notes.md)",
        "[proto](//cdn.example.com/x.md)",
      ].join("\n\n"),
    });
    expect((await validateSkill(dir)).valid).toBe(true);
  });

  test("strips fragments before checking a link", async () => {
    const dir = await makeSkill({
      frontmatter: VALID,
      body: "See [the guide](references/guide.md#usage).",
      files: { "references/guide.md": "# Guide" },
    });
    expect((await validateSkill(dir)).valid).toBe(true);
  });

  test("reports a backticked path anchored to a directory that exists", async () => {
    const dir = await makeSkill({
      frontmatter: VALID,
      body: "Run `scripts/missing.ts` to start.",
      files: { "scripts/present.ts": "export {};" },
    });
    const result = await validateSkill(dir);
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("scripts/missing.ts");
  });

  test("accepts a backticked path that exists", async () => {
    const dir = await makeSkill({
      frontmatter: VALID,
      body: "Run `scripts/present.ts` to start.",
      files: { "scripts/present.ts": "export {};" },
    });
    expect((await validateSkill(dir)).valid).toBe(true);
  });

  test("PRECISION: ignores a placeholder path whose root directory does not exist", async () => {
    const dir = await makeSkill({
      frontmatter: VALID,
      body: "Edit `path/to/your/file.md` and `some/other/thing.json`.",
    });
    expect((await validateSkill(dir)).valid).toBe(true);
  });

  test("PRECISION: ignores globs, prose and flags in backticks", async () => {
    const dir = await makeSkill({
      frontmatter: VALID,
      body: "Use `**/*.md`, `--extended`, `a/b`, `~/.claude/settings.json` and `Bun.file()`.",
      files: { "scripts/present.ts": "export {};" },
    });
    expect((await validateSkill(dir)).valid).toBe(true);
  });
});

describe("extractReferences", () => {
  test("collects relative markdown link targets only", () => {
    const { links } = extractReferences(
      "[a](docs/a.md) [b](https://x.com) [c](#h) [d](sub/dir/b.txt)",
    );
    expect(links).toEqual(["docs/a.md", "sub/dir/b.txt"]);
  });

  test("collects only path-shaped backtick candidates", () => {
    const { candidates } = extractReferences(
      "`scripts/a.ts` `**/*.md` `notaslash.ts` `dir/no-extension` `a/b/c.json`",
    );
    expect(candidates).toEqual(["a/b/c.json", "scripts/a.ts"]);
  });

  test("does not duplicate a path present as both a link and a backtick", () => {
    const { links, candidates } = extractReferences("[x](scripts/a.ts) and `scripts/a.ts`");
    expect(links).toEqual(["scripts/a.ts"]);
    expect(candidates).toEqual([]);
  });

  test("rejects parent-directory escapes", () => {
    const { links, candidates } = extractReferences("[x](../outside.md) `../outside.md`");
    expect(links).toEqual([]);
    expect(candidates).toEqual([]);
  });
});

describe("path helpers", () => {
  test.each([
    ["/a/b/c", "/a/b/c"],
    ["/a/b/../c", "/a/c"],
    ["/a/./b/", "/a/b"],
    ["/a//b", "/a/b"],
  ])("resolvePath(%s) -> %s", (input, expected) => {
    expect(resolvePath(input)).toBe(expected);
  });

  test("resolves a relative path against the working directory", () => {
    expect(resolvePath("rel")).toBe(`${process.cwd()}/rel`);
  });

  test.each([
    ["/a/b/demo-skill", "demo-skill"],
    ["/a/b/demo-skill/", "demo-skill"],
    ["/a/b/./demo-skill", "demo-skill"],
  ])("baseName(%s) -> %s", (input, expected) => {
    expect(baseName(input)).toBe(expected);
  });
});

describe("resolveTier", () => {
  test("defaults to standard when neither flag is given", () => {
    const { flags } = parseArgs([], CLI_SPEC);
    expect(resolveTier(flags)).toBe("standard");
  });

  test.each<[string[], Tier]>([
    [["dir", "--extended"], "extended"],
    [["--extended", "dir"], "extended"],
    [["dir", "--standard"], "standard"],
    [["dir", "--extended=true"], "extended"],
    [["dir", "--extended=false"], "standard"],
  ])("resolves %o to %s", (argv, expected) => {
    const { flags } = parseArgs(argv, CLI_SPEC);
    expect(resolveTier(flags)).toBe(expected);
  });

  test("rejects both tier flags rather than picking one", () => {
    const { flags } = parseArgs(["dir", "--standard", "--extended"], CLI_SPEC);
    expect(() => resolveTier(flags)).toThrow(CliError);
    expect(() => resolveTier(flags)).toThrow("mutually exclusive");
  });

  test("the shared parser rejects an unknown flag", () => {
    expect(() => parseArgs(["dir", "--bogus"], CLI_SPEC)).toThrow(CliError);
  });

  test("the shared parser collects the skill directory as a positional", () => {
    expect(parseArgs(["dir", "--extended"], CLI_SPEC).positionals).toEqual(["dir"]);
  });
});

describe("formatResult", () => {
  test("renders a passing result as markdown", () => {
    const output = formatResult({ valid: true, errors: [], warnings: [] }, "/a/demo-skill", "standard");
    expect(output).toContain("# Skill validation: `demo-skill`");
    expect(output).toContain("**Tier**: standard");
    expect(output).toContain("**Skill is valid.**");
    expect(output).not.toContain("## Errors");
  });

  test("renders errors and warnings as markdown lists", () => {
    const output = formatResult(
      { valid: false, errors: ["boom"], warnings: ["careful"] },
      "/a/demo-skill",
      "extended",
    );
    expect(output).toContain("## Errors (1)");
    expect(output).toContain("- boom");
    expect(output).toContain("## Warnings (1)");
    expect(output).toContain("- careful");
    expect(output).toContain("**Skill is invalid.** 1 error(s), 1 warning(s).");
  });

  test("emits no ANSI escape codes", () => {
    const output = formatResult({ valid: false, errors: ["x"], warnings: [] }, "/a/b", "standard");
    expect(output).not.toContain("[");
  });
});

describe("CLI", () => {
  test("exits 0 for a valid skill", async () => {
    const dir = await makeSkill({ frontmatter: VALID });
    const proc = Bun.spawnSync(["bun", CLI, dir]);
    expect(proc.exitCode).toBe(0);
    expect(proc.stdout.toString()).toContain("**Skill is valid.**");
  });

  test("exits 1 for an invalid skill", async () => {
    const dir = await makeSkill({ frontmatter: [...VALID, "version: 1.0.0"] });
    const proc = Bun.spawnSync(["bun", CLI, dir]);
    expect(proc.exitCode).toBe(1);
    expect(proc.stdout.toString()).toContain("Claude Code extension");
  });

  test("--extended changes the verdict for the same skill", async () => {
    const dir = await makeSkill({ frontmatter: [...VALID, "version: 1.0.0"] });
    const proc = Bun.spawnSync(["bun", CLI, dir, "--extended"]);
    expect(proc.exitCode).toBe(0);
  });

  test("exits 2 with usage when no directory is given", () => {
    const proc = Bun.spawnSync(["bun", CLI]);
    expect(proc.exitCode).toBe(2);
    expect(proc.stdout.toString()).toContain("Usage: bun shared/scripts/validate-skill.ts");
  });

  test("exits 2 for an unknown flag, never mistaking it for a verdict", async () => {
    const dir = await makeSkill({ frontmatter: VALID });
    const proc = Bun.spawnSync(["bun", CLI, dir, "--bogus"]);
    expect(proc.exitCode).toBe(2);
    expect(proc.stdout.toString()).toContain("unknown flag: --bogus");
    expect(proc.stdout.toString()).not.toContain("Skill is valid");
  });

  test("exits 2 for a misspelled tier flag rather than silently using the default", async () => {
    const dir = await makeSkill({ frontmatter: [...VALID, "version: 1.0.0"] });
    const proc = Bun.spawnSync(["bun", CLI, dir, "--extend"]);
    expect(proc.exitCode).toBe(2);
    expect(proc.stdout.toString()).not.toContain("Skill is");
  });

  test("exits 2 when both tier flags are given", async () => {
    const dir = await makeSkill({ frontmatter: VALID });
    const proc = Bun.spawnSync(["bun", CLI, dir, "--standard", "--extended"]);
    expect(proc.exitCode).toBe(2);
    expect(proc.stdout.toString()).toContain("mutually exclusive");
  });

  test("exits 2 for a second positional argument", async () => {
    const dir = await makeSkill({ frontmatter: VALID });
    const proc = Bun.spawnSync(["bun", CLI, dir, "extra"]);
    expect(proc.exitCode).toBe(2);
    expect(proc.stdout.toString()).toContain("unexpected extra argument: extra");
  });

  test("--help exits 0 and renders options from the shared spec", () => {
    const proc = Bun.spawnSync(["bun", CLI, "--help"]);
    expect(proc.exitCode).toBe(0);
    const output = proc.stdout.toString();
    expect(output).toContain("Usage: bun shared/scripts/validate-skill.ts");
    expect(output).toContain("--standard");
    expect(output).toContain("--extended");
  });

  test("-- terminator lets a directory named like a flag through", async () => {
    const dir = await makeSkill({ frontmatter: VALID });
    const proc = Bun.spawnSync(["bun", CLI, "--extended", "--", dir]);
    expect(proc.exitCode).toBe(0);
  });
});

describe("body size (warnings, never fatal)", () => {
  /** A body of `n` lines, each long enough that tokens track lines sensibly. */
  function padded(n: number): string {
    return Array.from(
      { length: n },
      (_, i) => `Line ${i + 1} of padded body text used to exercise the size targets.`,
    ).join("\n");
  }

  test("says nothing about a body inside both targets", async () => {
    const result = await validateSkill(await makeSkill({ frontmatter: VALID, body: padded(20) }));
    expect(result.warnings).toEqual([]);
  });

  test("warns past the line target and names the count", async () => {
    const result = await validateSkill(
      await makeSkill({ frontmatter: VALID, body: padded(BODY_LINES_MAX + 40) }),
    );
    const warning = result.warnings.find((w) => w.includes("-line target"));
    expect(warning).toBeDefined();
    expect(warning).toContain(`${BODY_LINES_MAX + 40} lines`);
  });

  test("warns past the token target and names the count", async () => {
    const result = await validateSkill(
      await makeSkill({ frontmatter: VALID, body: padded(BODY_LINES_MAX + 200) }),
    );
    const warning = result.warnings.find((w) => w.includes("-token target"));
    expect(warning).toBeDefined();
    expect(warning).toMatch(/~\d+ tokens/);
  });

  test("an oversized body is still valid — this is guidance, not breakage", async () => {
    const result = await validateSkill(
      await makeSkill({ frontmatter: VALID, body: padded(BODY_LINES_MAX + 200) }),
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test("measures the body only, so frontmatter cannot push it over", async () => {
    // A description near the 1024-char ceiling is ~250 tokens of frontmatter.
    const fat = ["name: demo-skill", `description: ${"Produces a report. ".repeat(50)}`];
    const result = await validateSkill(await makeSkill({ frontmatter: fat, body: padded(20) }));
    expect(result.warnings.filter((w) => w.includes("target"))).toEqual([]);
  });
});
