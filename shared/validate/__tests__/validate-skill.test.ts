import { afterAll, describe, expect, test } from "bun:test";

import { CliError, parseArgs } from "../../cli.ts";
import {
  BODY_LINES_MAX,
  CLI_SPEC,
  COMPATIBILITY_MAX,
  DESCRIPTION_HARD_MAX,
  DESCRIPTION_MAX,
  NAME_MAX,
  REFERENCE_TOC_LINES_MIN,
  baseName,
  extractReferences,
  formatResult,
  resolveTier,
  resolvePath,
  validateSkill,
  type Tier,
  type ValidationResult,
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

describe("structural genres (informational, never a finding)", () => {
  /** Only the genre line for one detector, so the three cannot mask each other. */
  function genre(result: { readonly genres: readonly string[] }, prefix: string): string {
    return result.genres.find((line) => line.startsWith(prefix)) ?? "";
  }

  async function bodied(body: string): Promise<ValidationResult> {
    return await validateSkill(await makeSkill({ frontmatter: VALID, body }));
  }

  const STEPS = ["# Demo", "", "## Step 1: One", "", "## Step 2: Two", "", "## Step 3: Three", ""];

  describe("genre 1: the ordered-step spine", () => {
    test("contiguous ascending steps are reported with their range", async () => {
      const line = genre(await bodied(STEPS.join("\n")), "ordered workflow");
      expect(line).toContain("steps 1-3");
      expect(line).toContain("contiguous");
    });

    test("a numbering gap is the finding, and the gap is named", async () => {
      const line = genre(
        await bodied(["# Demo", "", "## Step 1: One", "", "## Step 2: Two", "", "## Step 4: Four", ""].join("\n")),
        "ordered workflow",
      );
      expect(line).toContain("numbering gap at 3");
      expect(line).toContain("1, 2, 4");
    });

    test("a repeat is distinguished from a gap, because they are different mistakes", async () => {
      const line = genre(
        await bodied(["# Demo", "", "## Step 1: One", "", "## Step 2: Two", "", "## Step 2: Again", ""].join("\n")),
        "ordered workflow",
      );
      expect(line).toContain("repeats or goes backwards");
    });

    test("`## 3. Thing` counts as a step heading too, not only Step and Phase", async () => {
      const line = genre(
        await bodied(["# Demo", "", "## 1. One", "", "## 2. Two", "", "## 3. Three", ""].join("\n")),
        "ordered workflow",
      );
      expect(line).toContain("steps 1-3");
    });

    test("two numbered headings are not a spine, and absence is stated", async () => {
      const line = genre(
        await bodied(["# Demo", "", "## Step 1: One", "", "## Step 2: Two", ""].join("\n")),
        "ordered workflow",
      );
      expect(line).toContain("no numbered step spine");
    });

    test("steps inside a fenced sample are being shown, not used", async () => {
      const line = genre(
        await bodied(["# Demo", "", "```markdown", ...STEPS, "```", ""].join("\n")),
        "ordered workflow",
      );
      expect(line).toContain("no numbered step spine");
    });
  });

  describe("genre 3: the anti-rationalization table", () => {
    const TABLE = [
      "## Common Rationalizations",
      "",
      "| Rationalization | Reality |",
      "| --- | --- |",
      "| It is a small change | Small changes ship the same bugs |",
      "| The tests are slow | Slower than the outage |",
      "| I checked it manually | Manual checks are not repeatable |",
      "",
    ];

    test("the table is reported present with its row count", async () => {
      const line = genre(await bodied(["# Demo", "", ...TABLE].join("\n")), "anti-rationalization");
      expect(line).toContain("present");
      expect(line).toContain("3 row(s)");
    });

    test("absence is reported too, since a healthy skill may simply not have one", async () => {
      const line = genre(await bodied("# Demo\n\nJust prose.\n"), "anti-rationalization");
      expect(line).toContain("absent");
    });

    test("the provenance travels WITH the fact, present or absent", async () => {
      // Without the note, "absent" reads as a gap to close — which is the reading the
      // evidence does not support, since nobody has measured whether the table works.
      for (const body of ["# Demo\n\nJust prose.\n", ["# Demo", "", ...TABLE].join("\n")]) {
        const line = genre(await bodied(body), "anti-rationalization");
        expect(line).toContain("single-vendor");
        expect(line).toContain("no measured effect");
        expect(line).toContain("not a recommendation");
      }
    });

    test("a heading with a two-row table is not the genre", async () => {
      const line = genre(
        await bodied(
          [
            "# Demo",
            "",
            "## Common Rationalizations",
            "",
            "| Rationalization | Reality |",
            "| --- | --- |",
            "| Only one | Not a list |",
            "",
          ].join("\n"),
        ),
        "anti-rationalization",
      );
      expect(line).toContain("absent");
    });

    test("a table quoted inside a fence is a sample, not an adoption", async () => {
      const line = genre(
        await bodied(["# Demo", "", "```markdown", ...TABLE, "```", ""].join("\n")),
        "anti-rationalization",
      );
      expect(line).toContain("absent");
    });
  });

  describe("genres 10 and 11: the manifest-form split", () => {
    test("pointers are split by whether they carry a firing condition", async () => {
      const line = genre(
        await bodied(
          [
            "# Demo",
            "",
            "Read references/layout.md when the body outgrows one screen.",
            "Open references/api.md before you touch a handler.",
            "See references/glossary.md.",
            "",
          ].join("\n"),
        ),
        "reference pointers",
      );
      expect(line).toContain("2 carrying a firing condition");
      expect(line).toContain("1 bare-name");
    });

    test("no pointers at all is stated rather than reported as two zeros", async () => {
      expect(genre(await bodied("# Demo\n\nProse only.\n"), "reference pointers")).toContain(
        "none found",
      );
    });

    test("pointers inside a fenced sample are not counted", async () => {
      const line = genre(
        await bodied(
          ["# Demo", "", "```markdown", "Read references/layout.md when it is needed.", "```", ""].join("\n"),
        ),
        "reference pointers",
      );
      expect(line).toContain("none found");
    });

    test("the count carries the refuted cap explicitly, so nobody re-adds one", async () => {
      // A cap on bundled references was proposed and refuted — it came from a figure
      // about whole skills attached to a task, not files inside one.
      const line = genre(
        await bodied(
          ["# Demo", "", ...Array.from({ length: 20 }, (_, i) => `See references/f${i}.md.`), ""].join("\n"),
        ),
        "reference pointers",
      );
      expect(line).toContain("20 bare-name");
      expect(line).toContain("no count cap applies");
    });
  });

  test("the section can never change the verdict or the warning count", async () => {
    // The structural guarantee, asserted rather than trusted. A body dense with every
    // genre and one with none must agree on everything except `genres`.
    const dense = await bodied(
      [
        "# Demo",
        "",
        "## Step 1: One",
        "## Step 2: Two",
        "## Step 3: Three",
        "",
        "## Common Rationalizations",
        "",
        "| Rationalization | Reality |",
        "| --- | --- |",
        "| A | B |",
        "| C | D |",
        "| E | F |",
        "",
        "Read references/layout.md when needed.",
        "",
      ].join("\n"),
    );
    const bare = await bodied("# Demo\n\nProse only.\n");

    expect(dense.valid).toBe(bare.valid);
    expect(dense.valid).toBe(true);
    expect(dense.warnings.length).toBe(bare.warnings.length);
    expect(dense.errors).toEqual(bare.errors);
    // Both still REPORT, which is the point — absence is a fact worth stating.
    expect(dense.genres).toHaveLength(3);
    expect(bare.genres).toHaveLength(3);
  });

  test("the rendered section is labelled informational and carries no count", async () => {
    const dir = await makeSkill({ frontmatter: VALID, body: STEPS.join("\n") });
    const output = formatResult(await validateSkill(dir), dir, "extended");
    expect(output).toContain("## Structural genres (informational)");
    expect(output).toContain("none of");
    expect(output).toContain("affects the verdict");
    // A count in the heading would invite comparison with the warning count above it.
    expect(output).not.toContain("## Structural genres (3)");
  });
});

describe("formatResult", () => {
  test("renders a passing result as markdown", () => {
    const output = formatResult({ valid: true, errors: [], warnings: [], genres: [] }, "/a/demo-skill", "standard");
    expect(output).toContain("# Skill validation: `demo-skill`");
    expect(output).toContain("**Tier**: standard");
    expect(output).toContain("**Skill is valid.**");
    expect(output).not.toContain("## Errors");
  });

  test("renders errors and warnings as markdown lists", () => {
    const output = formatResult(
      { valid: false, errors: ["boom"], warnings: ["careful"], genres: [] },
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
    const output = formatResult({ valid: false, errors: ["x"], warnings: [], genres: [] }, "/a/b", "standard");
    expect(output).not.toContain("\x1b[");
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
    expect(proc.stdout.toString()).toContain("Usage: bun shared/validate/validate-skill.ts");
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
    expect(output).toContain("Usage: bun shared/validate/validate-skill.ts");
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

describe("reference table of contents (warning, presence not quality)", () => {
  /** `n` lines of reference prose under an H1, so the file reads as a document. */
  function reference(n: number, opening: readonly string[] = []): string {
    return [
      "# Reference",
      "",
      ...opening,
      ...Array.from({ length: n }, (_, i) => `Line ${i + 1} of reference prose.`),
    ].join("\n");
  }

  const TOC = ["## Table of Contents", "", "- [First section](#first-section)", ""];

  /** Only this rule's warnings, so a token-count skip cannot mask the assertion. */
  function tocWarnings(warnings: readonly string[]): readonly string[] {
    return warnings.filter((warning) => warning.includes("table of contents"));
  }

  test("warns on a long reference with no table of contents, naming file and count", async () => {
    const result = await validateSkill(
      await makeSkill({
        frontmatter: VALID,
        files: { "references/long.md": reference(REFERENCE_TOC_LINES_MIN + 20) },
      }),
    );
    const warning = tocWarnings(result.warnings)[0];
    expect(warning).toBeDefined();
    expect(warning).toContain("references/long.md");
    expect(warning).toContain(`${REFERENCE_TOC_LINES_MIN + 22} lines`);
    expect(warning).toContain("## Table of Contents");
    expect(warning).toContain("progressive-disclosure.md");
  });

  test("a long reference carrying the standard block says nothing", async () => {
    const result = await validateSkill(
      await makeSkill({
        frontmatter: VALID,
        files: { "references/long.md": reference(REFERENCE_TOC_LINES_MIN + 20, TOC) },
      }),
    );
    expect(tocWarnings(result.warnings)).toEqual([]);
  });

  test("a short reference needs no map, however it is written", async () => {
    const result = await validateSkill(
      await makeSkill({
        frontmatter: VALID,
        files: { "references/short.md": reference(10) },
      }),
    );
    expect(tocWarnings(result.warnings)).toEqual([]);
  });

  test("a whole-specimen file is exempt: a map would alter the artifact", async () => {
    // Opens with frontmatter rather than an H1-plus-wrapper, so the file IS the
    // specimen. Injecting a table of contents would change the thing on display.
    const specimen = [
      "---",
      "name: specimen-skill",
      "description: A complete skill shown as a specimen.",
      "---",
      "",
      ...Array.from({ length: REFERENCE_TOC_LINES_MIN + 20 }, (_, i) => `Body line ${i + 1}.`),
    ].join("\n");
    const result = await validateSkill(
      await makeSkill({ frontmatter: VALID, files: { "examples/whole-skill.md": specimen } }),
    );
    expect(tocWarnings(result.warnings)).toEqual([]);
  });

  test("a long file of raw specimen content with no H1 is exempt too", async () => {
    const raw = Array.from(
      { length: REFERENCE_TOC_LINES_MIN + 20 },
      (_, i) => `output row ${i + 1}`,
    ).join("\n");
    const result = await validateSkill(
      await makeSkill({ frontmatter: VALID, files: { "examples/transcript.md": raw } }),
    );
    expect(tocWarnings(result.warnings)).toEqual([]);
  });

  test("the warning never makes a skill invalid", async () => {
    const result = await validateSkill(
      await makeSkill({
        frontmatter: VALID,
        files: { "references/long.md": reference(REFERENCE_TOC_LINES_MIN + 20) },
      }),
    );
    expect(tocWarnings(result.warnings)).toHaveLength(1);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test("root-level markdown is covered, and SKILL.md never is", async () => {
    const result = await validateSkill(
      await makeSkill({
        frontmatter: VALID,
        // A body over the threshold would be warned about by this rule if
        // SKILL.md were in scope; it has its own size targets instead.
        body: Array.from({ length: REFERENCE_TOC_LINES_MIN + 20 }, (_, i) => `Body ${i}.`).join(
          "\n",
        ),
        files: { "NOTES.md": reference(REFERENCE_TOC_LINES_MIN + 20) },
      }),
    );
    const warnings = tocWarnings(result.warnings);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("NOTES.md");
    expect(warnings[0]).not.toContain("SKILL.md");
  });

  test("presence is the whole check: one bullet satisfies it, however incomplete", async () => {
    // Deliberate. Counting bullets against headings or resolving slugs turns a
    // cheap lint into a formatter with an opinion, and its false positives are
    // what teach authors to ignore warnings.
    const manyHeadings = [
      "# Reference",
      "",
      ...TOC,
      ...Array.from({ length: 12 }, (_, i) => `## Section ${i + 1}\n\nProse.\n`),
      ...Array.from({ length: REFERENCE_TOC_LINES_MIN }, (_, i) => `Filler ${i + 1}.`),
    ].join("\n");
    const result = await validateSkill(
      await makeSkill({ frontmatter: VALID, files: { "references/many.md": manyHeadings } }),
    );
    expect(tocWarnings(result.warnings)).toEqual([]);
  });

  test("a heading with no bullet under it is not a table of contents", async () => {
    const headingOnly = reference(REFERENCE_TOC_LINES_MIN + 20, [
      "## Table of Contents",
      "",
      "Coming soon.",
      "",
    ]);
    const result = await validateSkill(
      await makeSkill({ frontmatter: VALID, files: { "references/stub.md": headingOnly } }),
    );
    expect(tocWarnings(result.warnings)).toHaveLength(1);
  });

  describe("position: the block must be the first H2", () => {
    test("a table of contents behind a content section warns about position", async () => {
      const late = reference(REFERENCE_TOC_LINES_MIN + 20, [
        "## Overview",
        "",
        "Some content section that got in first.",
        "",
        ...TOC,
      ]);
      const result = await validateSkill(
        await makeSkill({ frontmatter: VALID, files: { "references/late.md": late } }),
      );
      const warnings = tocWarnings(result.warnings);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("is not the first H2");
      expect(warnings[0]).toContain("references/late.md");
    });

    test("a table of contents as the first H2 passes", async () => {
      const result = await validateSkill(
        await makeSkill({
          frontmatter: VALID,
          files: {
            "references/ordered.md": reference(REFERENCE_TOC_LINES_MIN + 20, [
              ...TOC,
              "## Overview",
              "",
              "Content after the map, which is where content belongs.",
              "",
            ]),
          },
        }),
      );
      expect(tocWarnings(result.warnings)).toEqual([]);
    });

    test("orientation prose before the block is fine — only an H2 may not precede it", async () => {
      const result = await validateSkill(
        await makeSkill({
          frontmatter: VALID,
          files: {
            "references/prose.md": reference(REFERENCE_TOC_LINES_MIN + 20, [
              "One paragraph of orientation prose that says what this file is for.",
              "",
              ...TOC,
            ]),
          },
        }),
      );
      expect(tocWarnings(result.warnings)).toEqual([]);
    });

    test("a missing block reports absence only, never absence and position both", async () => {
      const result = await validateSkill(
        await makeSkill({
          frontmatter: VALID,
          files: {
            "references/none.md": reference(REFERENCE_TOC_LINES_MIN + 20, [
              "## Overview",
              "",
              "A content section and no map at all.",
              "",
            ]),
          },
        }),
      );
      const warnings = tocWarnings(result.warnings);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("has no table of contents");
      expect(warnings[0]).not.toContain("first H2");
    });

    test("an H2 inside a code fence is a sample, not the file's first H2", async () => {
      // These are documents ABOUT writing markdown, so fenced samples containing
      // `## Something` are ordinary. Reading one as a heading reports a position
      // defect against a file whose real first H2 is exactly where it belongs.
      const withSample = reference(REFERENCE_TOC_LINES_MIN + 20, [
        "```markdown",
        "## Sample section from another document",
        "```",
        "",
        ...TOC,
      ]);
      const result = await validateSkill(
        await makeSkill({ frontmatter: VALID, files: { "references/sample.md": withSample } }),
      );
      expect(tocWarnings(result.warnings)).toEqual([]);
    });

    test("a table of contents quoted inside a fence does not satisfy the check", async () => {
      // The same guard in the other direction: a file showing the standard form
      // as an example has not adopted it.
      const quoted = reference(REFERENCE_TOC_LINES_MIN + 20, [
        "```markdown",
        ...TOC,
        "```",
        "",
      ]);
      const result = await validateSkill(
        await makeSkill({ frontmatter: VALID, files: { "references/quoted.md": quoted } }),
      );
      const warnings = tocWarnings(result.warnings);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("has no table of contents");
    });
  });
});
