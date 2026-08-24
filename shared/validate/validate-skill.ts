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
  /**
   * Facts about the body's structure. NOT findings, and never part of a verdict.
   *
   * Kept in its own array rather than folded into `warnings` precisely so that it
   * cannot become one by accident: `valid` reads `errors`, the summary line counts
   * `warnings`, and nothing anywhere reads this.
   */
  readonly genres: readonly string[];
}

interface Collector {
  readonly errors: string[];
  readonly warnings: string[];
  readonly genres: string[];
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

/**
 * Length past which a bundled reference file carries a table of contents.
 *
 * A reference is read by a model that arrived looking for one thing. Past about
 * a hundred lines it cannot see the whole file at once, and a map at the top is
 * what turns "read this file" into "jump to this section" -- which is the whole
 * economics of deferral.
 */
export const REFERENCE_TOC_LINES_MIN = 100;

/**
 * How far below the heading a table-of-contents bullet may sit and still count.
 *
 * Wide enough for the blank line that always follows a heading and an
 * introductory sentence some files put there; narrow enough that an unrelated
 * link further down the file cannot satisfy the check by accident.
 */
const TOC_BULLET_WINDOW = 5;

/** The standard form, case-insensitively: the standard itself writes it title-case. */
const TOC_HEADING_PATTERN = /^##\s+table of contents\s*$/i;
/** A flat anchor-link bullet. Indentation is allowed; nesting is not the check's business. */
const TOC_BULLET_PATTERN = /^\s*[-*]\s+\[[^\]]+\]\(#[^)]+\)/;
/** An H2 and not a deeper heading: `###` fails because its third character is not space. */
const H2_PATTERN = /^##\s+\S/;
const FENCE_PATTERN = /^\s*(```|~~~)/;

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

/**
 * Bundled markdown whose CONTENT a model reads, which is what a map helps with.
 *
 * `references/` and `examples/` plus root-level markdown, and never `SKILL.md`:
 * the body has its own size targets above and is not a file anyone navigates to.
 * Anything nested under another directory is out by construction, which is also
 * what keeps a vendored `node_modules/**\/README.md` from being warned about.
 */
function isReadModeMarkdown(relPath: string): boolean {
  if (!relPath.endsWith(".md") || relPath === "SKILL.md") return false;
  if (relPath.startsWith("references/") || relPath.startsWith("examples/")) return true;
  return !relPath.includes("/");
}

/**
 * A file that is a specimen in its entirety, rather than a document with a map.
 *
 * The heuristic is the opening line after any frontmatter: a wrapper document
 * starts with an H1, and a whole-specimen file starts with frontmatter or with
 * raw specimen content instead. Exempt because injecting a table of contents
 * into one would ALTER THE ARTIFACT -- the file is the thing being shown, and a
 * map bolted onto the top of it is no longer the thing being shown.
 */
function isWholeSpecimen(content: string): boolean {
  return !content.replace(FRONTMATTER_PATTERN, "").trimStart().startsWith("# ");
}

/**
 * The file's lines, with everything inside a fenced code block blanked out.
 *
 * Not optional politeness. These are reference documents ABOUT writing markdown,
 * so they are full of fenced samples containing `## Something` -- seven such
 * lines across four shipped files at the time this was written. Reading a heading
 * out of a sample would find a table of contents that is not there, or worse,
 * find a "first H2" that is a quoted example and report a position defect
 * against a file whose real first H2 is exactly where the standard wants it.
 *
 * Blanked rather than dropped so that every surviving index still refers to the
 * line it does in the file, which is what lets the two scans below be compared.
 */
function linesOutsideFences(content: string): readonly string[] {
  let fenced = false;
  return content.split("\n").map((line) => {
    if (FENCE_PATTERN.test(line)) {
      fenced = !fenced;
      return "";
    }
    return fenced ? "" : line;
  });
}

/**
 * Where the standard block starts, or -1 when there is not one.
 *
 * A heading alone is not a table of contents -- a `## Table of Contents`
 * followed by "coming soon" is a promise, not a map -- so at least one anchor
 * bullet has to follow it within the window.
 */
function tableOfContentsIndex(lines: readonly string[]): number {
  for (const [index, line] of lines.entries()) {
    if (!TOC_HEADING_PATTERN.test(line.trim())) continue;
    const window = lines.slice(index + 1, index + 1 + TOC_BULLET_WINDOW);
    if (window.some((entry) => TOC_BULLET_PATTERN.test(entry))) return index;
  }
  return -1;
}

/**
 * Warn when a long reference file carries no table of contents.
 *
 * PRESENCE AND POSITION, NOT QUALITY, and the line is deliberate. This checks
 * that the block is there and that it comes first, then stops. It does not count
 * bullets against headings, does not resolve a slug against the heading it
 * claims to point at, and does not judge the ORDER OF THE BULLETS -- every one
 * of those turns a cheap lint into a formatter with an opinion, and the failure
 * mode of a heuristic that guesses at quality is a wall of false positives that
 * teaches authors to ignore the warnings that matter.
 *
 * Position is checkable in the way those are not: "first H2 in the file" is a
 * fact about the document, decided without knowing what any section says.
 *
 * A CAP ON THE NUMBER OF REFERENCE FILES DOES NOT BELONG HERE, and this is the
 * place a future author would reach for one. It was refuted: file count is not
 * the cost, since a reference is paid for only when it is read, and a skill with
 * twelve tight references is cheaper at runtime than one with three sprawling
 * ones. Count nothing; check each file on its own.
 *
 * Warn tier, never fatal: a reference without a map still loads and still works.
 */
async function checkReferenceTableOfContents(skillDir: string, out: Collector): Promise<void> {
  const root = resolvePath(skillDir);
  const paths: string[] = [];
  for await (const entry of new Bun.Glob("**/*.md").scan({ cwd: root, onlyFiles: true })) {
    const relPath = entry.split("\\").join("/");
    if (isReadModeMarkdown(relPath)) paths.push(relPath);
  }
  // Sorted so two runs over the same skill report in the same order. `scan`
  // makes no ordering promise, and a warning list that reshuffles between runs
  // is one nobody can diff.
  for (const relPath of paths.sort()) {
    const content = await Bun.file(`${root}/${relPath}`).text();
    const lines = content.split("\n").length;
    if (lines <= REFERENCE_TOC_LINES_MIN) continue;
    if (isWholeSpecimen(content)) continue;

    const scannable = linesOutsideFences(content);
    const tocIndex = tableOfContentsIndex(scannable);
    if (tocIndex === -1) {
      out.warnings.push(
        `reference file ${relPath} (${lines} lines) has no table of contents — the standard ` +
          "form is a `## Table of Contents` heading with flat anchor-link bullets; see " +
          "shared/references/progressive-disclosure.md",
      );
      continue;
    }
    // Only reached when a real block exists, so the two findings never both fire
    // on one file: a file with no map has no position to be wrong about, and
    // saying so twice would read as two defects where there is one.
    const firstH2 = scannable.findIndex((line) => H2_PATTERN.test(line));
    if (firstH2 !== -1 && firstH2 < tocIndex) {
      out.warnings.push(
        `reference file ${relPath} (${lines} lines): table of contents is not the first H2 — ` +
          "the standard places it after the H1 and orientation prose, before any content " +
          "section; see shared/references/progressive-disclosure.md",
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Structural genres — INFORMATIONAL ONLY
// ---------------------------------------------------------------------------
//
// WHY THESE REPORT AND NEVER WARN, and what a future author has to change before
// promoting one.
//
// The table-of-contents rule above warns because its threshold is published by the
// vendor and the form is house-locked. These three have neither. Of the fourteen
// structural genres catalogued across four vendors, THIRTEEN HAVE NO MEASURED
// EFFECT — they are shipped practice or asserted guidance, counted but never tested.
// A rule that says "this reference is over 100 lines and has no table of contents"
// states a fact. A rule that says "add an anti-rationalization table" is guidance
// dressed as enforcement, and it would be enforcing one vendor's house style: that
// table appears in 22 of 24 skills in a single pack and in 0 of 20 of Anthropic's.
//
// The calibration to carry is that a six-rule "standard skill shape" was proposed
// here once and TWO OF ITS SIX RULES WERE REFUTED BY MEASUREMENT WITHIN HOURS. One
// of the refuted rules capped how many references a skill may bundle, which is why
// the manifest reporter below counts forms and pointedly does not cap anything.
//
// So: these lines state what is present. They do not say what should be. Promoting
// any of them to a warning needs an experiment first — an ablation that strips the
// structure from real skills and runs both arms against the same scenario set — not
// a majority of vendors doing it, which is exactly the evidence that failed before.

/** Genre 1: `## Step 3`, `### Phase 2`, or `## 4. Do the thing`. */
const STEP_HEADING_PATTERNS: readonly RegExp[] = [
  /^#{2,4}\s*(?:Step|Phase)\s*(\d+)\b/i,
  /^#{2,4}\s*(\d+)\.\s/,
];

/** Below this a body has headings that happen to be numbered, not a step spine. */
const STEP_SPINE_MIN = 3;

/** Genre 3: the heading, and the header row whose first cell names the excuse. */
const RATIONALIZATION_HEADING = /rationaliz/i;
const RATIONALIZATION_HEADER_ROW = /^\|\s*(Rationaliz\w*|Excuse|Objection)\s*\|[^|]*\|\s*$/i;
const TABLE_BODY_ROW = /^\|.*\|.*\|\s*$/;
const RATIONALIZATION_WINDOW = 5;
const RATIONALIZATION_MIN_ROWS = 3;

/** Genres 10 and 11: a pointer to a bundled file, with or without its firing condition. */
const POINTER_PATH = /(?:[\w.-]+\/)*[\w-]+\.(?:md|ts|tsx|js|py|sh|json|ya?ml|txt|csv|html)\b/;
const FIRING_CLAUSE = /\b(?:when|before|while|open it)\b/i;

function stepNumberOf(line: string): number | undefined {
  for (const pattern of STEP_HEADING_PATTERNS) {
    const match = pattern.exec(line);
    if (match?.[1] !== undefined) return Number(match[1]);
  }
  return undefined;
}

/**
 * Genre 1, as a fact: are the step numbers contiguous and ascending?
 *
 * A gap or a repeat is the finding, per the catalogue — not because a gap is known
 * to cost anything, but because it is the one property of this genre that can be
 * checked without an opinion. Whether numbered steps beat topic organisation at all
 * is the one MEASURED claim in the catalogue, and it is external to this repository.
 */
function describeOrderedSteps(lines: readonly string[]): string {
  const numbers = lines
    .map(stepNumberOf)
    .filter((value): value is number => value !== undefined);
  if (numbers.length < STEP_SPINE_MIN) {
    return `ordered workflow: no numbered step spine (${numbers.length} numbered step heading(s), fewer than ${STEP_SPINE_MIN})`;
  }
  const first = numbers[0] ?? 0;
  for (const [index, value] of numbers.entries()) {
    const expected = first + index;
    if (value === expected) continue;
    const anomaly =
      value < expected
        ? `numbering repeats or goes backwards at ${value}`
        : `numbering gap at ${expected}`;
    return `ordered workflow: ${numbers.length} numbered steps present, ${anomaly} (found ${numbers.join(", ")})`;
  }
  return `ordered workflow: steps ${first}-${numbers[numbers.length - 1]}, contiguous`;
}

/**
 * Genre 3, as a fact WITH its provenance attached in the same sentence.
 *
 * The note travels with the line deliberately. "anti-rationalization table: absent"
 * on its own reads as a gap to close, which is precisely the reading the evidence
 * does not support — so the sentence that states the fact also states that nobody
 * has measured whether the table does anything.
 */
function describeAntiRationalization(lines: readonly string[]): string {
  const provenance =
    "single-vendor shipped practice (22 of 24 in one pack, 0 of 20 in Anthropic's) with no measured effect; reported as a fact, not a recommendation";
  for (const [index, line] of lines.entries()) {
    if (!line.startsWith("#") || !RATIONALIZATION_HEADING.test(line)) continue;
    const window = lines.slice(index + 1, index + 1 + RATIONALIZATION_WINDOW);
    const headerAt = window.findIndex((entry) => RATIONALIZATION_HEADER_ROW.test(entry.trim()));
    if (headerAt === -1) continue;
    // The separator row sits between the header and the body, so body rows start two
    // lines down. Counted rather than assumed: a table with a header and one example
    // is a different artifact from the genre, which is a list of rebutted excuses.
    let rows = 0;
    for (const entry of lines.slice(index + 1 + headerAt + 2)) {
      if (!TABLE_BODY_ROW.test(entry.trim())) break;
      rows += 1;
    }
    if (rows >= RATIONALIZATION_MIN_ROWS) {
      return `anti-rationalization table: present, ${rows} row(s) — ${provenance}`;
    }
  }
  return `anti-rationalization table: absent — ${provenance}`;
}

/**
 * Genres 10 and 11, as counts: pointers that carry a firing condition, and pointers
 * that are a bare name.
 *
 * THE LINE IS THE UNIT, deliberately, where the catalogue's signature says "in the
 * same sentence". A sentence splitter has to break on `.` and every pointer here
 * contains one inside a filename; the splitter that protects `guide.md` then breaks
 * `guide.md When the work needs it`, which would file the clearest possible instance
 * of the conditional form under the bare form. Over-inclusion is the harmless
 * direction for a count nobody acts on, and a mis-split is not.
 *
 * NO CAP IS APPLIED TO EITHER COUNT and none may be added. A cap on how many
 * references a skill bundles was proposed and refuted: it came from a figure about
 * whole skills attached to one task, not files inside one, and one shipped skill
 * routes 66 bundled files through a single manifest of this genre.
 */
function describeManifestForms(lines: readonly string[]): string {
  let conditional = 0;
  let bare = 0;
  for (const line of lines) {
    if (line.startsWith("#") || !POINTER_PATH.test(line)) continue;
    if (FIRING_CLAUSE.test(line)) conditional += 1;
    else bare += 1;
  }
  if (conditional + bare === 0) return "reference pointers: none found in the body";
  return (
    `reference pointers: ${conditional} carrying a firing condition, ${bare} bare-name — ` +
    "both forms are unvalidated and under measurement; no count cap applies"
  );
}

/**
 * The informational section. Adds to `genres` and touches nothing else.
 *
 * Fence-aware for the same reason the table-of-contents rule is: a skill body that
 * demonstrates a numbered step or a pointer inside a fenced sample is showing one,
 * not using one, and counting the sample would report the example as the artifact.
 */
function reportStructuralGenres(content: string, out: Collector): void {
  const body = content.replace(FRONTMATTER_PATTERN, "");
  const lines = linesOutsideFences(body);
  out.genres.push(
    describeOrderedSteps(lines),
    describeAntiRationalization(lines),
    describeManifestForms(lines),
  );
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
  if (!loaded.ok) return { valid: false, errors: [loaded.error], warnings: [], genres: [] };

  const { content, frontmatter: parsed } = loaded;
  const out: Collector = { errors: [], warnings: [], genres: [] };
  checkAllowedKeys(parsed, tier, out);
  const name = checkName(parsed, out);
  checkDescription(parsed, tier, out);
  checkCompatibility(parsed, out);
  checkDirectoryName(name, skillDir, out);
  await checkBodySize(content, out);
  await checkReferenceTableOfContents(skillDir, out);
  await checkDanglingReferences(content, skillDir, out);
  reportStructuralGenres(content, out);

  // `valid` reads `errors` and nothing else, which is what makes the genre lines
  // structurally incapable of changing a verdict rather than merely intended not to.
  return {
    valid: out.errors.length === 0,
    errors: out.errors,
    warnings: out.warnings,
    genres: out.genres,
  };
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
  // Below the findings and above the verdict, with no count in its heading. A count
  // would invite comparison with the warning count above it, and these are not
  // findings to be driven to zero — several of them read "absent" on a healthy skill.
  if (result.genres.length > 0) {
    lines.push("## Structural genres (informational)", "");
    lines.push(
      "Facts about how this body is put together. Nothing here is a finding, and none of",
      "it affects the verdict: thirteen of the fourteen catalogued genres have no measured",
      "effect, so presence is reported and never prescribed.",
      "",
    );
    for (const genre of result.genres) lines.push(`- ${genre}`);
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
