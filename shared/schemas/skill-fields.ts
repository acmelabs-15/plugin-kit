/**
 * The frontmatter and body rules, and the limits they enforce.
 *
 * Every function here is pure: given the parsed frontmatter, the body text and
 * the tier, it says what is wrong. Nothing reads the disk, so `./skill.ts` can
 * compose these into a layer a unit test parses with no filesystem at all.
 *
 * Semantics are mirrored from `../validate/validate-skill.ts`, message for
 * message. Where the two disagree, that file is right and this one is a bug.
 *
 * The constants below are a THIRD copy of limits that already exist in
 * `../validate/validate-skill.ts` and (for the 1024 ceiling) in
 * `../validate/rules/agent.ts`, `../validate/rules/command.ts` and
 * `../operations/propose-description.ts`. Unifying them is a later pass; mirroring
 * them is this one.
 */

import { baseName } from "./paths.ts";
import { addError, addWarning, type IssueSink } from "./severity.ts";


export const TIERS = ["standard", "extended"] as const;
export type Tier = (typeof TIERS)[number];

/** The Agent Skills open standard's complete frontmatter field set. */
export const STANDARD_FIELDS: ReadonlySet<string> = new Set([
  "name", "description", "license", "allowed-tools", "metadata", "compatibility",
]);

/** Claude Code frontmatter extensions: valid locally, not part of the standard. */
export const CLAUDE_CODE_EXTENSIONS: ReadonlySet<string> = new Set([
  "disallowed-tools", "version", "when_to_use", "argument-hint", "arguments",
  "user-invocable", "disable-model-invocation", "model", "effort", "context",
  "agent", "background", "hooks", "paths", "shell",
]);

export const NAME_MAX = 64;
/** Both body targets bind: a dense 480-line body can still blow the token budget. */
export const BODY_LINES_MAX = 500;
export const BODY_TOKENS_MAX = 5000;
/** The standard's description ceiling. Beyond this a skill is not portable. */
export const DESCRIPTION_MAX = 1024;
/** Claude Code truncates its skill listing here, so beyond it the skill breaks. */
export const DESCRIPTION_HARD_MAX = 1536;
export const COMPATIBILITY_MAX = 500;

const NAME_PATTERN = /^[a-z0-9-]+$/;

/** Describe a value's type for error messages, as the Python original reports it. */
function describeType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

export function checkAllowedKeys(
  frontmatter: Record<string, unknown>,
  tier: Tier,
  ctx: IssueSink,
): void {
  const allowedList = [
    ...STANDARD_FIELDS,
    ...(tier === "extended" ? CLAUDE_CODE_EXTENSIONS : []),
  ].sort().join(", ");

  for (const key of Object.keys(frontmatter).sort()) {
    if (STANDARD_FIELDS.has(key)) continue;
    if (tier === "extended" && CLAUDE_CODE_EXTENSIONS.has(key)) continue;

    if (CLAUDE_CODE_EXTENSIONS.has(key)) {
      addError(
        ctx,
        `Key \`${key}\` is a Claude Code extension, not part of the portable Agent Skills ` +
          `standard, so a skill using it is not portable to other agent runtimes. ` +
          `Re-run with --extended to permit it for plugin-bundled authoring.`,
        ["frontmatter", key],
      );
    } else {
      addError(
        ctx,
        `Unexpected key \`${key}\` in SKILL.md frontmatter. Allowed properties are: ${allowedList}.`,
        ["frontmatter", key],
      );
    }
  }
}

/** Returns the trimmed name when there is one to compare against the directory. */
export function checkName(frontmatter: Record<string, unknown>, ctx: IssueSink): string | undefined {
  const path = ["frontmatter", "name"] as const;
  if (!("name" in frontmatter)) {
    addError(ctx, "Missing `name` in frontmatter.", path);
    return undefined;
  }
  const raw = frontmatter["name"];
  if (typeof raw !== "string") {
    addError(ctx, `Name must be a string, got ${describeType(raw)}.`, path);
    return undefined;
  }
  const name = raw.trim();
  if (name === "") {
    addError(ctx, "Name is empty. The Agent Skills standard requires a non-empty name.", path);
    return undefined;
  }

  if (!NAME_PATTERN.test(name)) {
    addError(
      ctx,
      `Name '${name}' should be kebab-case (lowercase letters, digits, and hyphens only).`,
      path,
    );
  }
  if (name.startsWith("-") || name.endsWith("-") || name.includes("--")) {
    addError(
      ctx,
      `Name '${name}' cannot start/end with a hyphen or contain consecutive hyphens.`,
      path,
    );
  }
  if (name.length > NAME_MAX) {
    addError(ctx, `Name is too long (${name.length} characters). Maximum is ${NAME_MAX}.`, path);
  }
  return name;
}

export function checkDescription(
  frontmatter: Record<string, unknown>,
  tier: Tier,
  ctx: IssueSink,
): void {
  const path = ["frontmatter", "description"] as const;
  if (!("description" in frontmatter)) {
    addError(ctx, "Missing `description` in frontmatter.", path);
    return;
  }
  const raw = frontmatter["description"];
  if (typeof raw !== "string") {
    addError(ctx, `Description must be a string, got ${describeType(raw)}.`, path);
    return;
  }
  const description = raw.trim();
  if (description === "") {
    addError(
      ctx,
      "Description is empty. The Agent Skills standard requires a non-empty description; " +
        "it is the only signal an agent uses to decide whether to load the skill.",
      path,
    );
    return;
  }

  if (description.includes("<") || description.includes(">")) {
    addError(ctx, "Description cannot contain angle brackets (< or >).", path);
  }
  checkDescriptionLength(description.length, tier, ctx);
}

/**
 * Severity is tier-dependent, which is the reason named tiers exist at all.
 * Under `--standard` the standard's 1024 ceiling is an error. Under `--extended`
 * it degrades to a warning -- the skill still works, it has simply left the
 * portable standard -- until 1536, where Claude Code truncates its skill listing
 * and the tail of the description would never be read.
 */
function checkDescriptionLength(length: number, tier: Tier, ctx: IssueSink): void {
  const path = ["frontmatter", "description"] as const;
  if (tier === "standard") {
    if (length > DESCRIPTION_MAX) {
      addError(
        ctx,
        `Description is too long (${length} characters). Maximum is ${DESCRIPTION_MAX}.`,
        path,
      );
    }
    return;
  }
  if (length > DESCRIPTION_HARD_MAX) {
    addError(
      ctx,
      `Description is too long (${length} characters). Claude Code truncates its skill ` +
        `listing at ${DESCRIPTION_HARD_MAX} characters, so the tail would never be read.`,
      path,
    );
  } else if (length > DESCRIPTION_MAX) {
    addWarning(
      ctx,
      `Description is ${length} characters, over the Agent Skills standard's ` +
        `${DESCRIPTION_MAX}-character limit. The skill still works in Claude Code but has ` +
        `left the portable standard.`,
      path,
    );
  }
}

export function checkCompatibility(frontmatter: Record<string, unknown>, ctx: IssueSink): void {
  const path = ["frontmatter", "compatibility"] as const;
  const raw = frontmatter["compatibility"];
  // Mirrors the original's `if compatibility:` -- absent and empty both skip.
  if (raw === undefined || raw === null || raw === "") return;
  if (typeof raw !== "string") {
    addError(ctx, `Compatibility must be a string, got ${describeType(raw)}.`, path);
    return;
  }
  if (raw.length > COMPATIBILITY_MAX) {
    addError(
      ctx,
      `Compatibility is too long (${raw.length} characters). Maximum is ${COMPATIBILITY_MAX}.`,
      path,
    );
  }
}

export function checkDirectoryName(
  name: string | undefined,
  skillDir: string,
  ctx: IssueSink,
): void {
  if (name === undefined) return;
  const directory = baseName(skillDir);
  if (directory === name) return;
  addWarning(
    ctx,
    `Skill name '${name}' does not match its parent directory '${directory}'. The Agent ` +
      `Skills standard requires them to match; Claude Code lets the directory name win, so ` +
      `the skill would be invoked as '${directory}'.`,
    ["skillDir"],
  );
}

/** Lines are always checkable; tokens only when someone measured them. */
export function checkBodySize(body: string, bodyTokens: number | undefined, ctx: IssueSink): void {
  const lines = bodyLineCount(body);
  if (lines > BODY_LINES_MAX) {
    addWarning(
      ctx,
      `Body is ${lines} lines, over the ${BODY_LINES_MAX}-line target. ` +
        `Push detail into \`references/\` and leave a pointer to where it went.`,
      ["body"],
    );
  }
  if (bodyTokens !== undefined && bodyTokens > BODY_TOKENS_MAX) {
    addWarning(
      ctx,
      `Body is ~${bodyTokens} tokens, over the ${BODY_TOKENS_MAX}-token target ` +
        `(${lines}/${BODY_LINES_MAX} lines). Both targets bind, and this is the one that broke.`,
      ["bodyTokens"],
    );
  }
}

export function bodyLineCount(body: string): number {
  return body.split("\n").length;
}

/**
 * The message for a token count nobody could take.
 *
 * Said rather than approximated: a character-count heuristic overestimates by
 * 13-29% against a real tokenizer, which is enough to send an author trimming a
 * body that was never over.
 */
export function tokenCountSkippedMessage(body: string): string {
  return (
    "Token count skipped: `tiktoken` is not installed. " +
    `Line count is ${bodyLineCount(body)}/${BODY_LINES_MAX}; ` +
    `the ${BODY_TOKENS_MAX}-token target went unchecked.`
  );
}
