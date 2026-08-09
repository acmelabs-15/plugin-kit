/**
 * The pure half of this suite never touches the filesystem -- that is the point
 * of the split, and `PURE_DIR` deliberately does not exist to prove it.
 */

import { afterAll, describe, expect, test } from "bun:test";

import { partitionIssues } from "../severity.ts";
import { loadSkillInput } from "../skill-input.ts";
import {
  BODY_LINES_MAX,
  COMPATIBILITY_MAX,
  DESCRIPTION_HARD_MAX,
  DESCRIPTION_MAX,
  NAME_MAX,
  SkillFull,
  SkillShape,
  type SkillCandidate,
  type Tier,
} from "../skill.ts";

const PURE_DIR = "/nonexistent/schema-pure/my-skill";
const TMP_ROOT = `${Bun.env.TMPDIR ?? "/tmp"}/plugin-kit-schemas-${Bun.nanoseconds()}`;
let counter = 0;

afterAll(async () => {
  await Bun.$`rm -rf ${TMP_ROOT}`.quiet().nothrow();
});

interface CandidateSpec {
  readonly frontmatter?: Record<string, unknown>;
  readonly body?: string;
  readonly content?: string;
  readonly tier?: Tier;
  readonly bodyTokens?: number;
  readonly skillDir?: string;
}

function candidate(spec: CandidateSpec = {}): SkillCandidate {
  return {
    skillDir: spec.skillDir ?? PURE_DIR,
    content: spec.content ?? spec.body ?? "# Body\n",
    body: spec.body ?? "# Body\n",
    frontmatter: spec.frontmatter ?? { name: "my-skill", description: "Does a thing." },
    tier: spec.tier ?? "standard",
    ...(spec.bodyTokens === undefined ? {} : { bodyTokens: spec.bodyTokens }),
  };
}

/** Parse the pure layer and return its findings, split by severity. */
function pure(spec: CandidateSpec = {}): {
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
} {
  const result = SkillShape.safeParse(candidate(spec));
  return result.success ? { errors: [], warnings: [] } : partitionIssues(result.error.issues);
}

async function full(dir: string, tier: Tier = "standard"): Promise<{
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}> {
  const loaded = await loadSkillInput(dir, tier);
  if (!loaded.ok) return { errors: [loaded.error], warnings: [] };
  const result = await SkillFull.safeParseAsync(loaded.input);
  return result.success ? { errors: [], warnings: [] } : partitionIssues(result.error.issues);
}

/** Materialise a skill directory and return its path. */
async function makeSkill(files: Readonly<Record<string, string>>, dirName = "my-skill"): Promise<string> {
  counter += 1;
  const dir = `${TMP_ROOT}/${counter}/${dirName}`;
  for (const [name, contents] of Object.entries(files)) {
    await Bun.write(`${dir}/${name}`, contents);
  }
  return dir;
}

describe("pure layer: full enumeration", () => {
  test("three bad fields report three errors, not the first one", () => {
    const { errors } = pure({
      frontmatter: { name: "Bad Name", description: "has <angle> brackets", surprise: 1 },
    });
    expect(errors).toHaveLength(3);
    expect(errors.some((e) => e.includes("Unexpected key `surprise`"))).toBe(true);
    expect(errors.some((e) => e.includes("should be kebab-case"))).toBe(true);
    expect(errors.some((e) => e.includes("angle brackets"))).toBe(true);
  });

  test("a well-formed skill produces nothing", () => {
    expect(pure()).toEqual({ errors: [], warnings: [] });
  });
});

describe("pure layer: name", () => {
  test.each([
    [{ description: "d" }, "Missing `name` in frontmatter."],
    [{ name: 7, description: "d" }, "Name must be a string, got number."],
    [{ name: "   ", description: "d" }, "Name is empty."],
    [{ name: "-lead", description: "d" }, "cannot start/end with a hyphen"],
    [{ name: "a--b", description: "d" }, "consecutive hyphens"],
  ])("%o reports %s", (frontmatter, fragment) => {
    const { errors } = pure({ frontmatter });
    expect(errors.some((e) => e.includes(fragment))).toBe(true);
  });

  test("length ceiling is reported with the measured length", () => {
    const name = "a".repeat(NAME_MAX + 1);
    const { errors } = pure({ frontmatter: { name, description: "d" } });
    expect(errors).toContain(
      `Name is too long (${NAME_MAX + 1} characters). Maximum is ${NAME_MAX}.`,
    );
  });
});

describe("pure layer: description severity is tier-dependent", () => {
  const over = (length: number): Record<string, unknown> => ({
    name: "my-skill",
    description: "d".repeat(length),
  });

  test(`${DESCRIPTION_MAX + 1} chars is an error under standard`, () => {
    const { errors, warnings } = pure({ frontmatter: over(DESCRIPTION_MAX + 1) });
    expect(errors).toContain(
      `Description is too long (${DESCRIPTION_MAX + 1} characters). Maximum is ${DESCRIPTION_MAX}.`,
    );
    expect(warnings).toEqual([]);
  });

  test(`${DESCRIPTION_MAX + 1} chars is only a warning under extended`, () => {
    const { errors, warnings } = pure({ frontmatter: over(DESCRIPTION_MAX + 1), tier: "extended" });
    expect(errors).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("left the portable standard");
  });

  test(`${DESCRIPTION_HARD_MAX + 1} chars is an error under extended`, () => {
    const { errors } = pure({
      frontmatter: over(DESCRIPTION_HARD_MAX + 1),
      tier: "extended",
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(`truncates its skill listing at ${DESCRIPTION_HARD_MAX}`);
  });

  test("the ceiling itself passes both tiers", () => {
    expect(pure({ frontmatter: over(DESCRIPTION_MAX) })).toEqual({ errors: [], warnings: [] });
  });
});

describe("pure layer: allowed keys", () => {
  test("an extension key is an error under standard, naming the escape hatch", () => {
    const { errors } = pure({ frontmatter: { name: "my-skill", description: "d", model: "opus" } });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("Key `model` is a Claude Code extension");
    expect(errors[0]).toContain("--extended");
  });

  test("the same key passes under extended", () => {
    expect(
      pure({ frontmatter: { name: "my-skill", description: "d", model: "opus" }, tier: "extended" }),
    ).toEqual({ errors: [], warnings: [] });
  });

  test("an unknown key lists the allowed set, which widens with the tier", () => {
    const standard = pure({ frontmatter: { name: "my-skill", description: "d", nope: 1 } });
    const extended = pure({
      frontmatter: { name: "my-skill", description: "d", nope: 1 },
      tier: "extended",
    });
    expect(standard.errors[0]).toContain("Allowed properties are: allowed-tools, compatibility");
    expect(standard.errors[0]).not.toContain("hooks");
    expect(extended.errors[0]).toContain("hooks");
  });
});

describe("pure layer: compatibility", () => {
  test("absent and empty both skip", () => {
    expect(pure({ frontmatter: { name: "my-skill", description: "d", compatibility: "" } })).toEqual(
      { errors: [], warnings: [] },
    );
  });

  test("a non-string is an error naming the type", () => {
    const { errors } = pure({
      frontmatter: { name: "my-skill", description: "d", compatibility: ["a"] },
    });
    expect(errors).toEqual(["Compatibility must be a string, got array."]);
  });

  test("the length ceiling is enforced", () => {
    const { errors } = pure({
      frontmatter: {
        name: "my-skill",
        description: "d",
        compatibility: "c".repeat(COMPATIBILITY_MAX + 1),
      },
    });
    expect(errors[0]).toContain(`Maximum is ${COMPATIBILITY_MAX}`);
  });
});

describe("pure layer: directory name and body size", () => {
  test("a name that differs from its directory is a warning, not an error", () => {
    const { errors, warnings } = pure({ frontmatter: { name: "other", description: "d" } });
    expect(errors).toEqual([]);
    expect(warnings[0]).toContain("does not match its parent directory 'my-skill'");
  });

  test("an oversized body warns on lines", () => {
    const { warnings } = pure({ body: "x\n".repeat(BODY_LINES_MAX + 1) });
    expect(warnings[0]).toContain(`over the ${BODY_LINES_MAX}-line target`);
  });

  test("tokens are checked when measured", () => {
    const { warnings } = pure({ bodyTokens: 5001 });
    expect(warnings[0]).toContain("~5001 tokens");
  });

  test("an unmeasured token count is silent in the pure layer", () => {
    expect(pure().warnings).toEqual([]);
  });
});

describe("full layer: what only the disk can answer", () => {
  test("a link to a missing file is a dangling reference", async () => {
    const dir = await makeSkill({
      "SKILL.md": "---\nname: my-skill\ndescription: d\n---\n\nSee [docs](references/gone.md).\n",
    });
    const { errors } = await full(dir);
    expect(errors).toEqual([
      "Dangling reference: SKILL.md links to `references/gone.md`, which does not exist.",
    ]);
  });

  test("a link that resolves reports nothing", async () => {
    const dir = await makeSkill({
      "SKILL.md": "---\nname: my-skill\ndescription: d\n---\n\nSee [docs](references/here.md).\n",
      "references/here.md": "# Here\n",
    });
    expect((await full(dir)).errors).toEqual([]);
  });

  test("a backticked path is only checked when its first segment exists", async () => {
    const withDir = await makeSkill({
      "SKILL.md": "---\nname: my-skill\ndescription: d\n---\n\nRun `scripts/gone.ts`.\n",
      "scripts/other.ts": "export {};\n",
    });
    const withoutDir = await makeSkill({
      "SKILL.md": "---\nname: my-skill\ndescription: d\n---\n\nEdit `path/to/your.md`.\n",
    });
    expect((await full(withDir)).errors).toEqual([
      "Dangling reference: SKILL.md mentions `scripts/gone.ts`, which does not exist.",
    ]);
    expect((await full(withoutDir)).errors).toEqual([]);
  });

  test("pure findings survive into a full parse", async () => {
    const dir = await makeSkill({
      "SKILL.md": "---\nname: Bad Name\ndescription: d\n---\n\nSee [x](gone.md).\n",
    });
    const { errors } = await full(dir);
    expect(errors.some((e) => e.includes("should be kebab-case"))).toBe(true);
    expect(errors.some((e) => e.includes("Dangling reference"))).toBe(true);
  });
});

describe("full layer: an unmeasured token count is said to be unmeasured", () => {
  test("the warning names both targets and the line count it did have", async () => {
    const result = await SkillFull.safeParseAsync(candidate({ skillDir: PURE_DIR }));
    expect(result.success).toBe(false);
    if (result.success) return;
    const { warnings } = partitionIssues(result.error.issues);
    expect(warnings).toEqual([
      "Token count skipped: `tiktoken` is not installed. " +
        `Line count is 2/${BODY_LINES_MAX}; the 5000-token target went unchecked.`,
    ]);
  });
});

describe("load phase: fatal and reported alone", () => {
  test.each([
    [{}, "SKILL.md not found."],
    [{ "SKILL.md": "no frontmatter here\n" }, "No YAML frontmatter found."],
    [{ "SKILL.md": "---\r\nname: x\r\n---\r\n" }, "Invalid frontmatter format."],
    [{ "SKILL.md": "---\n- a\n- b\n---\n" }, "Frontmatter must be a YAML dictionary."],
  ])("%o reports %s alone", async (files, message) => {
    const dir = await makeSkill(files);
    expect(await full(dir)).toEqual({ errors: [message], warnings: [] });
  });

  test("a loaded skill carries a measured token count, so nothing is skipped", async () => {
    const dir = await makeSkill({ "SKILL.md": "---\nname: my-skill\ndescription: d\n---\n\nBody.\n" });
    const loaded = await loadSkillInput(dir, "standard");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.input.bodyTokens).toBeGreaterThan(0);
    expect((await full(dir)).warnings).toEqual([]);
  });
});
