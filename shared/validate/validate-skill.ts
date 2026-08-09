#!/usr/bin/env bun
/**
 * Port of skill-creator's `quick_validate.py`, with resolved decisions applied.
 *
 * Unlike `lib/frontmatter.ts` -- which is a deliberate hand-rolled parser whose
 * quirks are load-bearing -- this validator uses REAL YAML (`Bun.YAML.parse`),
 * matching the Python original's use of `yaml.safe_load`. The two parsers
 * coexist on purpose.
 *
 * The strict allow-list is not arbitrary strictness: `{name, description,
 * license, allowed-tools, metadata, compatibility}` is exactly the field set of
 * the Agent Skills open standard. This validator therefore checks
 * STANDARD-CONFORMANCE, and exposes two tiers:
 *
 *   --standard (default)  Only the six standard fields. Intended for `.skill`
 *                         packaging, where anything else is not portable.
 *   --extended            Additionally permits the Claude Code frontmatter
 *                         extensions, for plugin-bundled authoring.
 *
 * Usage: bun shared/validate/validate-skill.ts <skill-dir> [--standard|--extended]
 * Exit code 0 when valid, 1 when invalid. Warnings never affect the exit code.
 */

import { CliError, formatHelp, parseArgs, type ParsedArgs, type Spec } from "../cli.ts";
import { skillMdPath } from "../parse/frontmatter.ts";

export type Tier = "standard" | "extended";

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

interface Collector {
  readonly errors: string[];
  readonly warnings: string[];
}

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
/**
 * Body size targets from `../references/progressive-disclosure.md`: a body must be
 * under BOTH. They are not redundant -- a 480-line file of dense paragraphs can
 * blow the token budget while passing the line check.
 *
 * Reported as warnings rather than errors: an oversized body still loads and
 * still works, so this is design guidance, not a breakage. The value is in
 * making it measurable at all -- character-count heuristics overestimate by
 * 13-29% against a real tokenizer, which is enough to send an author trimming a
 * body that was never over.
 */
export const BODY_LINES_MAX = 500;
export const BODY_TOKENS_MAX = 5000;

/** The standard's description ceiling. Beyond this a skill is not portable. */
export const DESCRIPTION_MAX = 1024;
/** Claude Code truncates its skill listing here, so beyond it the skill breaks. */
export const DESCRIPTION_HARD_MAX = 1536;
export const COMPATIBILITY_MAX = 500;

const NAME_PATTERN = /^[a-z0-9-]+$/;
const FRONTMATTER_PATTERN = /^---\n([\s\S]*?)\n---/;

/** Describe a value's type for error messages (Python reports `type(x).__name__`). */
function describeType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Resolve a possibly-relative path to an absolute, normalised one. */
export function resolvePath(p: string): string {
  const absolute = p.startsWith("/") ? p : `${process.cwd()}/${p}`;
  const segments: string[] = [];
  for (const segment of absolute.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return `/${segments.join("/")}`;
}

/** Final path segment, ignoring trailing slashes. */
export function baseName(p: string): string {
  const resolved = resolvePath(p);
  const index = resolved.lastIndexOf("/");
  return index === -1 ? resolved : resolved.slice(index + 1);
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await Bun.file(p).stat();
    return true;
  } catch {
    // `Bun.file().exists()` reports false for directories, so stat() is required.
    return false;
  }
}

function checkAllowedKeys(frontmatter: Record<string, unknown>, tier: Tier, out: Collector): void {
  const allowedList = [
    ...STANDARD_FIELDS,
    ...(tier === "extended" ? CLAUDE_CODE_EXTENSIONS : []),
  ].sort().join(", ");

  for (const key of Object.keys(frontmatter).sort()) {
    if (STANDARD_FIELDS.has(key)) continue;
    if (tier === "extended" && CLAUDE_CODE_EXTENSIONS.has(key)) continue;

    if (CLAUDE_CODE_EXTENSIONS.has(key)) {
      out.errors.push(
        `Key \`${key}\` is a Claude Code extension, not part of the portable Agent Skills ` +
          `standard, so a skill using it is not portable to other agent runtimes. ` +
          `Re-run with --extended to permit it for plugin-bundled authoring.`,
      );
    } else {
      out.errors.push(
        `Unexpected key \`${key}\` in SKILL.md frontmatter. Allowed properties are: ${allowedList}.`,
      );
    }
  }
}

function checkName(frontmatter: Record<string, unknown>, out: Collector): string | undefined {
  if (!("name" in frontmatter)) {
    out.errors.push("Missing `name` in frontmatter.");
    return undefined;
  }
  const raw = frontmatter["name"];
  if (typeof raw !== "string") {
    out.errors.push(`Name must be a string, got ${describeType(raw)}.`);
    return undefined;
  }
  const name = raw.trim();

  // DELIBERATE DIVERGENCE from quick_validate.py, which guards every content
  // check behind `if name:` -- so an empty string silently passed all of them
  // and only an absent key failed. The standard requires a real identifier.
  if (name === "") {
    out.errors.push("Name is empty. The Agent Skills standard requires a non-empty name.");
    return undefined;
  }

  if (!NAME_PATTERN.test(name)) {
    out.errors.push(
      `Name '${name}' should be kebab-case (lowercase letters, digits, and hyphens only).`,
    );
  }
  if (name.startsWith("-") || name.endsWith("-") || name.includes("--")) {
    out.errors.push(
      `Name '${name}' cannot start/end with a hyphen or contain consecutive hyphens.`,
    );
  }
  if (name.length > NAME_MAX) {
    out.errors.push(`Name is too long (${name.length} characters). Maximum is ${NAME_MAX}.`);
  }
  return name;
}

function checkDescription(
  frontmatter: Record<string, unknown>,
  tier: Tier,
  out: Collector,
): void {
  if (!("description" in frontmatter)) {
    out.errors.push("Missing `description` in frontmatter.");
    return;
  }
  const raw = frontmatter["description"];
  if (typeof raw !== "string") {
    out.errors.push(`Description must be a string, got ${describeType(raw)}.`);
    return;
  }
  const description = raw.trim();

  // DELIBERATE DIVERGENCE, same rationale as `name` above: the standard requires
  // a non-empty description, since it is the sole trigger signal for the skill.
  if (description === "") {
    out.errors.push(
      "Description is empty. The Agent Skills standard requires a non-empty description; " +
        "it is the only signal an agent uses to decide whether to load the skill.",
    );
    return;
  }

  if (description.includes("<") || description.includes(">")) {
    out.errors.push("Description cannot contain angle brackets (< or >).");
  }
  checkDescriptionLength(description.length, tier, out);
}

/**
 * The standard's ceiling is 1024. Under `--standard` that is a hard error.
 * Under `--extended` it degrades to a warning -- the skill still works, it has
 * simply left the portable standard -- until 1536, where Claude Code truncates
 * its skill listing and the tail of the description would never be read.
 */
function checkDescriptionLength(length: number, tier: Tier, out: Collector): void {
  if (tier === "standard") {
    if (length > DESCRIPTION_MAX) {
      out.errors.push(
        `Description is too long (${length} characters). Maximum is ${DESCRIPTION_MAX}.`,
      );
    }
    return;
  }
  if (length > DESCRIPTION_HARD_MAX) {
    out.errors.push(
      `Description is too long (${length} characters). Claude Code truncates its skill ` +
        `listing at ${DESCRIPTION_HARD_MAX} characters, so the tail would never be read.`,
    );
  } else if (length > DESCRIPTION_MAX) {
    out.warnings.push(
      `Description is ${length} characters, over the Agent Skills standard's ` +
        `${DESCRIPTION_MAX}-character limit. The skill still works in Claude Code but has ` +
        `left the portable standard.`,
    );
  }
}

function checkCompatibility(frontmatter: Record<string, unknown>, out: Collector): void {
  const raw = frontmatter["compatibility"];
  // Matches the original's `if compatibility:` -- absent and empty both skip.
  if (raw === undefined || raw === null || raw === "") return;
  if (typeof raw !== "string") {
    out.errors.push(`Compatibility must be a string, got ${describeType(raw)}.`);
    return;
  }
  if (raw.length > COMPATIBILITY_MAX) {
    out.errors.push(
      `Compatibility is too long (${raw.length} characters). Maximum is ${COMPATIBILITY_MAX}.`,
    );
  }
}

function checkDirectoryName(name: string | undefined, skillDir: string, out: Collector): void {
  if (name === undefined) return;
  const directory = baseName(skillDir);
  if (directory === name) return;
  out.warnings.push(
    `Skill name '${name}' does not match its parent directory '${directory}'. The Agent ` +
      `Skills standard requires them to match; Claude Code lets the directory name win, so ` +
      `the skill would be invoked as '${directory}'.`,
  );
}

/**
 * Relative path references extracted from SKILL.md.
 *
 * Two precision tiers, because a false "dangling reference" is worse than a
 * missed one: markdown link targets are unambiguous file references and are
 * always checked, whereas a backticked path is only checked when its first
 * segment is a directory that actually exists in the skill -- which anchors it
 * to real layout and skips illustrative placeholders like `path/to/your.md`.
 */
export function extractReferences(content: string): {
  readonly links: readonly string[];
  readonly candidates: readonly string[];
} {
  const links = new Set<string>();
  for (const match of content.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const target = cleanTarget(match[1]);
    if (target !== undefined) links.add(target);
  }
  const candidates = new Set<string>();
  for (const match of content.matchAll(/`([^`\n]+)`/g)) {
    const raw = match[1];
    if (raw === undefined) continue;
    if (!/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+$/.test(raw)) continue;
    if (raw.includes("..") || !/\.[A-Za-z0-9]{1,8}$/.test(raw)) continue;
    if (!links.has(raw)) candidates.add(raw);
  }
  return { links: [...links].sort(), candidates: [...candidates].sort() };
}

/** Normalise a markdown link target, or return undefined if it is not a local path. */
function cleanTarget(target: string | undefined): string | undefined {
  if (target === undefined || target === "") return undefined;
  if (target.startsWith("#") || target.startsWith("/") || target.startsWith("~")) return undefined;
  if (target.startsWith("//") || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(target)) return undefined;
  const withoutFragment = target.split("#")[0]?.split("?")[0] ?? "";
  if (withoutFragment === "" || withoutFragment.includes("..")) return undefined;
  try {
    return decodeURIComponent(withoutFragment);
  } catch {
    return withoutFragment;
  }
}

/**
 * Warn when the body exceeds either size target.
 *
 * Counts the body only -- frontmatter is metadata that loads separately from the
 * instructions, and the targets are about the instruction budget.
 *
 * Token counting needs a real tokenizer to be worth doing. `tiktoken` is used
 * where available; when it is not, the count is skipped and said to be skipped
 * rather than approximated, because a heuristic that can be 700 tokens wrong at
 * the boundary sends authors trimming bodies that were never over.
 */
async function checkBodySize(content: string, out: Collector): Promise<void> {
  const body = content.replace(FRONTMATTER_PATTERN, "").trimStart();

  const lines = body.split("\n").length;
  if (lines > BODY_LINES_MAX) {
    out.warnings.push(
      `Body is ${lines} lines, over the ${BODY_LINES_MAX}-line target. ` +
        `Push detail into \`references/\` and leave a pointer to where it went.`,
    );
  }

  let tokens: number | undefined;
  try {
    const { get_encoding } = await import("tiktoken");
    const encoding = get_encoding("cl100k_base");
    tokens = encoding.encode(body).length;
    encoding.free();
  } catch {
    out.warnings.push(
      "Token count skipped: `tiktoken` is not installed. " +
        `Line count is ${lines}/${BODY_LINES_MAX}; the ${BODY_TOKENS_MAX}-token target went unchecked.`,
    );
    return;
  }

  if (tokens > BODY_TOKENS_MAX) {
    out.warnings.push(
      `Body is ~${tokens} tokens, over the ${BODY_TOKENS_MAX}-token target ` +
        `(${lines}/${BODY_LINES_MAX} lines). Both targets bind, and this is the one that broke.`,
    );
  }
}

async function checkDanglingReferences(
  content: string,
  skillDir: string,
  out: Collector,
): Promise<void> {
  const root = resolvePath(skillDir);
  const { links, candidates } = extractReferences(content);

  for (const link of links) {
    if (!(await pathExists(`${root}/${link}`))) {
      out.errors.push(`Dangling reference: SKILL.md links to \`${link}\`, which does not exist.`);
    }
  }
  for (const candidate of candidates) {
    const firstSegment = candidate.split("/")[0] ?? "";
    if (!(await pathExists(`${root}/${firstSegment}`))) continue;
    if (!(await pathExists(`${root}/${candidate}`))) {
      out.errors.push(
        `Dangling reference: SKILL.md mentions \`${candidate}\`, which does not exist.`,
      );
    }
  }
}

type LoadOutcome =
  | { readonly ok: true; readonly content: string; readonly frontmatter: Record<string, unknown> }
  | { readonly ok: false; readonly error: string };

/**
 * Read and structurally parse SKILL.md.
 *
 * These failures are fatal and reported alone, matching the original's
 * fail-fast `return False, message`. Field-level findings are collected in
 * full instead, so one run reports every problem.
 */
async function loadFrontmatter(skillDir: string): Promise<LoadOutcome> {
  const file = Bun.file(skillMdPath(skillDir));
  if (!(await file.exists())) return { ok: false, error: "SKILL.md not found." };

  const content = await file.text();
  if (!content.startsWith("---")) return { ok: false, error: "No YAML frontmatter found." };

  const match = FRONTMATTER_PATTERN.exec(content);
  // Note: the anchored `\n` is load-bearing and ported as-is -- it means a
  // CRLF-terminated SKILL.md is rejected here exactly as CPython rejects it.
  if (match?.[1] === undefined) return { ok: false, error: "Invalid frontmatter format." };

  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(match[1]);
  } catch (error) {
    return { ok: false, error: `Invalid YAML in frontmatter: ${(error as Error).message}` };
  }
  if (!isRecord(parsed)) return { ok: false, error: "Frontmatter must be a YAML dictionary." };

  return { ok: true, content, frontmatter: parsed };
}

/** Validate a skill directory against the given conformance tier. */
export async function validateSkill(
  skillDir: string,
  tier: Tier = "standard",
): Promise<ValidationResult> {
  const loaded = await loadFrontmatter(skillDir);
  if (!loaded.ok) return { valid: false, errors: [loaded.error], warnings: [] };

  const { content, frontmatter: parsed } = loaded;
  const out: Collector = { errors: [], warnings: [] };
  checkAllowedKeys(parsed, tier, out);
  const name = checkName(parsed, out);
  checkDescription(parsed, tier, out);
  checkCompatibility(parsed, out);
  checkDirectoryName(name, skillDir, out);
  await checkBodySize(content, out);
  await checkDanglingReferences(content, skillDir, out);

  return { valid: out.errors.length === 0, errors: out.errors, warnings: out.warnings };
}

const TIER_LABEL: Readonly<Record<Tier, string>> = {
  standard: "standard (portable Agent Skills standard)",
  extended: "extended (Claude Code plugin-bundled authoring)",
};

/** Render a result as markdown, per Claude Code's markdown-first output. */
export function formatResult(result: ValidationResult, skillDir: string, tier: Tier): string {
  const lines = [
    `# Skill validation: \`${baseName(skillDir)}\``,
    "",
    `- **Directory**: \`${resolvePath(skillDir)}\``,
    `- **Tier**: ${TIER_LABEL[tier]}`,
    "",
  ];
  if (result.errors.length > 0) {
    lines.push(`## Errors (${result.errors.length})`, "");
    for (const error of result.errors) lines.push(`- ${error}`);
    lines.push("");
  }
  if (result.warnings.length > 0) {
    lines.push(`## Warnings (${result.warnings.length})`, "");
    for (const warning of result.warnings) lines.push(`- ${warning}`);
    lines.push("");
  }
  lines.push(
    result.valid
      ? `**Skill is valid.**${result.warnings.length > 0 ? ` ${result.warnings.length} warning(s).` : ""}`
      : `**Skill is invalid.** ${result.errors.length} error(s), ${result.warnings.length} warning(s).`,
  );
  return lines.join("\n");
}

const USAGE = "Usage: bun shared/validate/validate-skill.ts <skill-dir> [--standard|--extended]";

export const CLI_SPEC: Spec = {
  standard: {
    kind: "boolean",
    default: false,
    help: "validate against the Agent Skills open standard only",
  },
  extended: {
    kind: "boolean",
    default: false,
    help: "allow Claude Code extension fields",
  },
  help: { kind: "boolean", default: false, help: "show this message" },
};

/**
 * Map the two tier flags onto a single tier.
 *
 * Passing both is rejected rather than resolved by precedence: the flags make
 * opposite claims about what the skill is for, and silently honouring one would
 * report a verdict the caller did not ask for.
 */
export function resolveTier(flags: ParsedArgs["flags"]): Tier {
  const standard = flags["standard"] === true;
  const extended = flags["extended"] === true;
  if (standard && extended) {
    throw new CliError("--standard and --extended are mutually exclusive");
  }
  return extended ? "extended" : "standard";
}

/**
 * Exit codes are three-way on purpose: 0 valid, 1 invalid skill, 2 usage error.
 * A mistyped flag must never be mistaken for a validation verdict.
 */
if (import.meta.main) {
  try {
    const { flags, positionals } = parseArgs(Bun.argv.slice(2), CLI_SPEC);

    if (flags["help"] === true) {
      console.log(formatHelp(USAGE, CLI_SPEC));
      process.exit(0);
    }

    const dir = positionals[0];
    if (dir === undefined) throw new CliError(`missing <skill-dir>\n${USAGE}`);
    if (positionals.length > 1) {
      throw new CliError(`unexpected extra argument: ${positionals[1]}\n${USAGE}`);
    }

    const tier = resolveTier(flags);
    const result = await validateSkill(dir, tier);
    console.log(formatResult(result, dir, tier));
    process.exit(result.valid ? 0 : 1);
  } catch (error) {
    if (!(error instanceof CliError)) throw error;
    console.log(`Error: ${error.message}`);
    process.exit(2);
  }
}
