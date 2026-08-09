#!/usr/bin/env bun
/**
 * synthesize-scenarios -- derive a trigger eval set from what an artifact DOES.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every optimizer in this plugin currently starts by asking the author to write
 * test cases. That is a real cost, and it caps the eval's quality at whatever the
 * author thought of in five minutes. This script proposes the set instead, so the
 * author edits a draft rather than authoring one from nothing.
 *
 * THE CIRCULARITY TRAP, WHICH IS THE WHOLE DESIGN CONSTRAINT
 * ----------------------------------------------------------
 * Generating trigger queries from the description you are about to optimize is
 * circular. The queries inherit the description's vocabulary and framing, so every
 * candidate scores well on the cases its own text suggested, and the loop ends up
 * certifying the description against itself. Worse, the failure is silent in the
 * direction that matters most: a description that omits an entire capability
 * generates no queries for that capability, so the omission is never penalised and
 * the score looks fine.
 *
 * So synthesis reads what the artifact DOES, never what it says about itself:
 *
 *   - the SKILL.md body -- the workflows, the branches, the steps;
 *   - every file in references/, scripts/, examples/, and the NAMES in assets/;
 *   - for a subagent, the system-prompt body and the tool grant, because an agent
 *     granted Bash is being asked to do something the description had better imply;
 *   - for an MCP server, the configured surface and whatever local implementation
 *     the config points at.
 *
 * The exclusion is enforced rather than merely intended. `buildInventory` reads the
 * description into ONE field, used for exactly two things -- the gap report, and the
 * leak guard -- and `buildSynthesisPrompt` redacts any run of the description's own
 * words out of the material before it goes to the model, then asserts that none
 * survived. See `redactDescription` and `assertNoDescriptionLeak`. If that assertion
 * ever fires it means the exclusion sprang a leak, and failing loudly is the point:
 * a quietly circular eval set is indistinguishable from a good one until it has
 * already certified a bad description.
 *
 * WHERE THE HARD NEGATIVES COME FROM
 * ----------------------------------
 * Near-misses have to be genuinely hard or the eval certifies everything, and the
 * three sources are deliberately different in kind:
 *
 *   1. The artifact's own stated non-goals, phrased in the POSITIVE vocabulary. A
 *      negative built from words that never appear in the positives excludes
 *      nothing, because near-miss cases arrive phrased in the positive vocabulary.
 *   2. The adjacent capability one step outside the boundary -- the request a
 *      reasonable person would assume this handles, and it does not.
 *   3. Co-installed neighbours, discovered by `check-overlap.ts`. Those are not
 *      imagined near-misses; they are queries a real installation will genuinely
 *      contest, which makes them the sharpest material available.
 *
 * USAGE
 *   bun shared/scripts/synthesize-scenarios.ts --target <path> --out <path>
 *   bun shared/scripts/synthesize-scenarios.ts --target <path> --inventory-only
 *
 * EXIT
 *   0  scenarios written, or inventory reported
 *   1  the target could not be read, or the model returned nothing usable
 *   2  usage error
 */

import { CliError, formatHelp, parseArgs, type ParsedArgs, type Spec } from "./lib/cli.ts";
import { runCommand } from "../util/subprocess.ts";
import {
  absolute,
  domainTerms,
  findNeighbours,
  joinAbsolute,
  SHARED_TERM_FLOOR,
  type Neighbour,
} from "./check-overlap.ts";

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

/**
 * The artifact kinds synthesis can read.
 *
 * Wider than the trigger harness's `TargetType`, which covers only what it can
 * measure. An MCP server's tool surface is worth deriving scenarios for even
 * though routing over tool descriptions is measured differently from routing over
 * a skill description.
 */
export type TargetKind = "skill" | "agent" | "command" | "mcp";

const TARGET_KINDS: readonly TargetKind[] = ["skill", "agent", "command", "mcp"];

/**
 * Why a file was read, which is also how much weight its content carries.
 *
 * Mirrors the plugin's own load-mode layout rule: a file's directory is decided by
 * how it is loaded, so the directory is exactly the signal for what kind of
 * capability evidence its contents are.
 */
export type SourceRole =
  | "body"
  | "example"
  | "reference"
  | "script"
  | "asset"
  | "tool-grant"
  | "arguments"
  | "mcp-server";

export interface CapabilitySource {
  /** Path relative to the artifact, so the report reads at a glance. */
  readonly path: string;
  readonly role: SourceRole;
  /** The text handed to the model, already truncated to the per-file budget. */
  readonly excerpt: string;
  /** Full size before truncation, so a report can say what was left out. */
  readonly bytes: number;
  readonly truncated: boolean;
}

export interface CapabilityInventory {
  readonly name: string;
  readonly kind: TargetKind;
  /** Absolute path, so a report is unambiguous about what was read. */
  readonly targetPath: string;
  readonly sources: readonly CapabilitySource[];
  /** What the artifact appears to do, derived from structure rather than prose. */
  readonly capabilities: readonly string[];
  /** Boundaries the artifact states about itself. */
  readonly nonGoals: readonly string[];
  /** An agent's tool grant, or a command's declared arguments. Empty otherwise. */
  readonly grants: readonly string[];
  readonly neighbours: readonly Neighbour[];
  /** How many installed skills the neighbour sweep read, whether or not they matched. */
  readonly neighboursScanned: number;
  /**
   * The artifact's own description.
   *
   * Held for exactly two purposes: computing `undocumented`, and feeding the leak
   * guard. It is never a source, never enters the prompt, and never seeds the
   * neighbour search. Everything else in this record is derived from substance.
   */
  readonly description: string;
  /** Capabilities whose vocabulary the description never uses. Each one is a finding. */
  readonly undocumented: readonly string[];
  /** Things the reader could not determine, said out loud rather than guessed. */
  readonly notes: readonly string[];
}

export interface Scenario {
  readonly query: string;
  readonly should_trigger: boolean;
}

// ---------------------------------------------------------------------------
// Budgets
//
// A prompt carrying every byte of a mature skill's references/ would be tens of
// thousands of tokens, most of them prose the model does not need in order to see
// what the artifact does. The caps trade completeness for a prompt that fits and a
// call that returns, and truncation is REPORTED rather than silent so an author can
// see when a file was only partly read.
// ---------------------------------------------------------------------------

export const MAX_FILE_EXCERPT_CHARS = 3_000;
export const MAX_TOTAL_EXCERPT_CHARS = 80_000;
/** Files past this are skipped unread -- nothing that large is a capability statement. */
export const MAX_FILE_BYTES = 400_000;
/** Neighbours past this add noise to the prompt without adding discrimination. */
export const MAX_NEIGHBOURS = 6;

export const DEFAULT_COUNT = 20;
export const SYNTHESIS_TIMEOUT_SECONDS = 300;

/**
 * Extensions worth reading as text. Anything else is recorded by name and size.
 *
 * An allow-list rather than a binary sniff: a font or a screenshot in `assets/`
 * contributes its NAME as evidence of a capability, and its bytes contribute
 * nothing but prompt budget.
 */
const TEXT_EXTENSIONS: ReadonlySet<string> = new Set([
  ".md", ".markdown", ".txt", ".rst",
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".json", ".jsonc", ".yaml", ".yml", ".toml", ".ini",
  ".py", ".rb", ".sh", ".bash", ".zsh",
  ".html", ".css", ".svg", ".sql", ".graphql",
]);

/**
 * Directories holding caches, vendored copies, or scaffolding rather than capability.
 *
 * `__tests__` is the one worth explaining, because a test file looks like excellent
 * evidence and is not. It is dense with the artifact's vocabulary while describing
 * something no user would ever ask for: that a helper writes to a particular path is
 * a fact about the implementation, not a capability anyone can phrase a query about.
 * Left in, a mature skill's suite crowds out the material a query could be grounded
 * in -- dogfooding this script against `skill-creator` itself, the suite was two
 * thirds of the files read.
 */
const SKIP_SEGMENTS: ReadonlySet<string> = new Set([
  "node_modules", ".git", "dist", "build", "__pycache__", ".venv", "__tests__",
]);

/**
 * Files read per bundled directory.
 *
 * A ceiling alongside the total-character budget, because the two protect different
 * things. The character budget keeps the prompt affordable; this keeps one large
 * directory from being the only thing in it, which is what happens when a skill has
 * forty scripts and six references and the scripts arrive first.
 */
export const MAX_FILES_PER_ROLE = 20;

function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot).toLowerCase();
}

// ---------------------------------------------------------------------------
// Frontmatter
// ---------------------------------------------------------------------------

export interface SplitDocument {
  /** The raw YAML block between the delimiters, or "" when there is none. */
  readonly frontmatter: string;
  /** Everything after the closing delimiter. The whole file when there is none. */
  readonly body: string;
}

/**
 * Separate frontmatter from body.
 *
 * The split is the first thing synthesis does to any markdown artifact, and it is
 * what makes the anti-circularity rule structural rather than a matter of
 * discipline: the description lives in the frontmatter, so discarding the
 * frontmatter from the source set removes it by construction instead of by
 * remembering to filter it later.
 */
export function splitFrontmatter(text: string): SplitDocument {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (match === null) return { frontmatter: "", body: text };
  return { frontmatter: match[1] ?? "", body: text.slice(match[0].length) };
}

/**
 * Read frontmatter fields with real YAML, falling back to an empty map.
 *
 * Real YAML rather than the hand-rolled reader in `lib/frontmatter.ts`, for the
 * reason `validate-skill.ts` and `check-overlap.ts` give: this reads artifacts we
 * do not own, and what matters is what the loader will see. A parse failure is not
 * fatal here -- the body is the primary evidence, and losing the tool grant is a
 * smaller loss than refusing to run.
 */
export function readFrontmatterFields(frontmatter: string): Record<string, unknown> {
  if (frontmatter.trim() === "") return {};
  try {
    const parsed: unknown = Bun.YAML.parse(frontmatter);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** A frontmatter value that may be a scalar list, a YAML sequence, or absent. */
function asStringList(value: unknown): string[] {
  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry !== "");
  }
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  return [];
}

// ---------------------------------------------------------------------------
// Structural extraction
//
// Everything here is derived WITHOUT a model, which is what makes `--inventory-only`
// instant, offline and fully testable. The model's job is writing queries; deciding
// what the artifact appears to do is structural enough to do in code, and doing it in
// code is what lets the gap report exist before any API call is made.
// ---------------------------------------------------------------------------

/** Headings that name a document's furniture rather than a capability. */
const BOILERPLATE_HEADINGS: ReadonlySet<string> = new Set([
  "overview", "introduction", "intro", "contents", "table of contents", "summary",
  "notes", "note", "see also", "further reading", "changelog", "license", "usage",
  "installation", "install", "getting started", "background", "appendix", "role",
  "scope", "output", "input", "example", "examples", "when to use", "what to do",
]);

/**
 * A heading naming a step inside a workflow rather than a capability.
 *
 * "Step 3: As each run completes, capture its timing" is a real and useful thing the
 * artifact does, and it is not something anyone would ever ask for -- nobody types a
 * request for step 3 of anything. Left in the capability list it does two kinds of
 * damage: the model is invited to write a positive nobody would send, and the gap
 * report fills with workflow internals the description was never meant to name,
 * burying the two or three findings that are real.
 *
 * The step's TEXT is still in the material the model reads. What is filtered here is
 * only its promotion to a headline capability.
 *
 * Matched after `plainText` has already removed a bare leading `1.` or `2)`, so this
 * only has to catch the worded forms. A merely numbered heading is usually an ordered
 * section rather than a procedure -- `## 1. Structure` in a reviewer's checklist is a
 * topic, not a step -- and filtering those out would lose real capabilities.
 */
const STEP_HEADING_PATTERN = /^(?:step|phase|stage)\s*\d+\b/i;

/** Strip inline markdown so a heading compares as the words a human reads. */
function plainText(text: string): string {
  return text
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]*)\*\*/g, "$1")
    .replace(/\*([^*]*)\*/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#+\s*/, "")
    .replace(/^\d+[.)]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * What the artifact appears to do, read off its structure.
 *
 * Headings first, because a body's headings are its author's own decomposition of
 * the work -- the closest thing to a capability list that already exists in the
 * file. Bullet leaders are the fallback for a body with few headings, which is the
 * normal shape for a subagent system prompt: those are written as a set of
 * instructions rather than as a document with sections.
 *
 * Deliberately NOT a model call. A structural read can be wrong in ways an author
 * spots instantly ("that heading is not a capability"), and being wrong in legible
 * ways is what makes the confirm-before-you-run step worth doing.
 */
export function extractCapabilities(body: string, limit = 24): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string): void => {
    const text = plainText(raw);
    if (text.length < 3 || text.length > 120) return;
    const key = text.toLowerCase();
    if (BOILERPLATE_HEADINGS.has(key) || seen.has(key)) return;
    if (STEP_HEADING_PATTERN.test(text)) return;
    seen.add(key);
    found.push(text);
  };

  const lines = body.split("\n");
  let inFence = false;
  const bulletLines: string[] = [];
  for (const line of lines) {
    // Fenced blocks hold sample output and code, whose headings and bullets belong
    // to the example rather than to the artifact's own structure.
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (/^#{2,4}\s+\S/.test(line)) add(line);
    else if (/^\s*(?:[-*+]|\d+[.)])\s+\S/.test(line)) {
      bulletLines.push(line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, ""));
    }
  }

  // Only reach for bullets when headings did not describe the artifact, so a
  // well-sectioned document is not diluted by every list item it contains.
  if (found.length < 3) {
    for (const bullet of bulletLines) {
      // The leading clause: a bullet's first sentence is its claim, and the rest is
      // usually the justification.
      add(bullet.split(/(?<=[.!?])\s+/)[0] ?? bullet);
      if (found.length >= limit) break;
    }
  }

  return found.slice(0, limit);
}

/**
 * What one bundled file is about, in one line.
 *
 * A bundled file contributes its TOPIC to the capability inventory, not its internal
 * section headings. The distinction matters and the brief turns on it: a reference on
 * a subject the description never mentions is precisely the capability gap the
 * synthesized queries need to probe, whereas `## Structure (4)` -- a section inside
 * that reference -- is a fact about how the document is laid out. Treating the second
 * as a capability floods the gap report with document furniture and buries the
 * finding the first one represents.
 *
 * Three sources of a topic, in falling order of how deliberately the author wrote it:
 * a markdown title, the opening line of a script's doc comment, and the filename.
 * The filename always works, which is why an unreadable asset still contributes.
 */
export function documentTitle(source: CapabilitySource): string | undefined {
  const heading = /^\s*#{1,2}\s+(\S.*)$/m.exec(source.excerpt);
  if (heading?.[1] !== undefined) {
    const text = plainText(heading[1]);
    if (text.length >= 3 && text.length <= 120) return text;
  }

  // A doc comment's first sentence. This house writes `name -- what it is for` at the
  // top of every script, which is a better capability statement than any heading.
  const doc = /^\s*\/\*\*\s*\n\s*\*\s*(\S.*?)\s*$/m.exec(source.excerpt);
  if (doc?.[1] !== undefined) {
    const text = plainText(doc[1]);
    if (text.length >= 3 && text.length <= 120) return text;
  }

  const base = source.path.slice(source.path.lastIndexOf("/") + 1);
  const stem = base.replace(/\.[A-Za-z0-9]+$/, "").replace(/[-_]+/g, " ").trim();
  return stem.length >= 3 ? stem : undefined;
}

/**
 * Assemble the capability inventory from every source at its own granularity.
 *
 * The body is decomposed into its headings, because those are the author's own
 * breakdown of the work the artifact does. Every other file contributes one line,
 * because what a bundled file adds to the inventory is the existence of a topic.
 */
export function capabilitiesFromSources(
  sources: readonly CapabilitySource[],
  limit = 24,
): string[] {
  const seen = new Set<string>();
  const collect = (texts: Iterable<string | undefined>): string[] => {
    const out: string[] = [];
    for (const text of texts) {
      if (text === undefined) return out;
      const key = text.toLowerCase();
      if (seen.has(key) || BOILERPLATE_HEADINGS.has(key)) continue;
      seen.add(key);
      out.push(text);
    }
    return out;
  };

  const fromBody = collect(
    sources
      .filter((source) => source.role === "body")
      .flatMap((source) => extractCapabilities(source.excerpt)),
  );
  const fromBundled = collect(
    sources
      .filter((source) => source.role !== "body")
      // The grant and the argument list are reported under their own heading rather
      // than as capabilities, so they are not repeated here.
      .filter((source) => source.role !== "tool-grant" && source.role !== "arguments")
      .map((source) => documentTitle(source)),
  );

  // Bundled topics get a reserved share of the budget rather than whatever the body
  // leaves over. A body with thirty headings would otherwise fill the list on its own
  // and silence every reference -- which is the one part of the inventory the gap
  // report most depends on, since a reference on a subject the description never
  // mentions is the capability gap the synthesized queries exist to probe.
  const reserved = Math.min(fromBundled.length, Math.floor(limit / 3));
  const bodyShare = Math.max(0, limit - reserved);
  const body = fromBody.slice(0, bodyShare);
  return [...body, ...fromBundled.slice(0, limit - body.length)];
}

/**
 * Markers of a stated boundary.
 *
 * Deliberately tight. A looser pattern -- `does not`, or a bare `instead` -- matches
 * ordinary explanatory prose several times per page, and a non-goal list padded with
 * prose is worse than a short one: it hands the model false boundaries to write
 * negatives against, and a negative for a boundary the artifact does not actually
 * have is a query it SHOULD trigger on, scored as a failure.
 */
const NON_GOAL_PATTERN =
  /\b(?:do not use|don't use|do not reach for|never use|not for|non-?goals?|out of scope|does not (?:cover|handle|apply|extend)|hands? off to|is not a|are not)\b/i;

/** Split a line into sentences, which is the unit a stated boundary occupies. */
function sentencesOf(line: string): string[] {
  return line
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== "");
}

export function extractNonGoals(body: string, limit = 12): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  let inFence = false;

  for (const rawLine of body.split("\n")) {
    if (/^\s*(```|~~~)/.test(rawLine)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    for (const sentence of sentencesOf(plainText(rawLine))) {
      if (!NON_GOAL_PATTERN.test(sentence)) continue;
      const text = sentence.length > 240 ? `${sentence.slice(0, 237)}...` : sentence;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(text);
      if (found.length >= limit) return found;
    }
  }
  return found;
}

/**
 * Characters of a term compared when asking whether the description mentions it.
 *
 * `domainTerms` strips a trailing `s`, which is enough to collide
 * `migration`/`migrations` but not `create`/`creating` -- and that second pair is
 * exactly the shape a heading and a description take when they say the same thing.
 * Comparing on a prefix collapses the whole inflected family without a real stemmer,
 * which would be a dependency this plugin does not take.
 *
 * The truncation is biased on purpose. A prefix is over-generous: it will
 * occasionally treat `packaging` and `package-lock` as the same mention. That is the
 * safe direction to be wrong in, because the two errors are not symmetric -- a MISSED
 * gap costs a finding the author can still notice by reading the inventory, while a
 * FALSE gap sends them rewriting a description that already covered the capability,
 * and a gap report full of those is one nobody reads.
 *
 * Applied here rather than pushed into `domainTerms`, because that function also
 * decides check-overlap's collision verdicts and loosening it would move a check
 * tuned against a different question.
 */
const STEM_PREFIX = 5;

function stemsOf(terms: Iterable<string>): Set<string> {
  const stems = new Set<string>();
  for (const term of terms) stems.add(term.slice(0, STEM_PREFIX));
  return stems;
}

/**
 * Capabilities the description never mentions.
 *
 * The comparison runs over `domainTerms`, borrowed from `check-overlap.ts`, so both
 * sides get the same stopword removal -- including its deliberate removal of the
 * vocabulary of skill descriptions themselves, since two artifacts both saying "use
 * this skill when the user asks" share nothing meaningful.
 *
 * A capability contributing no domain terms at all is skipped rather than reported.
 * A heading like "Steps" says nothing the description could be expected to cover,
 * and reporting it as a gap would bury the real findings under furniture.
 *
 * This is the finding the brief asks for: a capability the author confirms but the
 * description never mentions is a defect visible before a single eval runs, because
 * the loop can only optimize toward queries the description's own vocabulary can win.
 * The capability generates no test case, so nothing ever scores it as missing, and
 * the run comes back clean with the gap still there.
 */
export function undocumentedCapabilities(
  capabilities: readonly string[],
  description: string,
): string[] {
  const described = stemsOf(domainTerms(description));
  const gaps: string[] = [];
  for (const capability of capabilities) {
    const terms = domainTerms(capability);
    if (terms.size === 0) continue;
    let mentioned = false;
    for (const stem of stemsOf(terms)) {
      if (described.has(stem)) {
        mentioned = true;
        break;
      }
    }
    if (!mentioned) gaps.push(capability);
  }
  return gaps;
}

// ---------------------------------------------------------------------------
// The anti-circularity guard
// ---------------------------------------------------------------------------

/**
 * Word-run length at which shared phrasing stops being coincidence.
 *
 * Two texts about the same subject inevitably share individual words, and stripping
 * shared vocabulary would gut the body. Eight consecutive words in the same order is
 * a different claim: that is reuse, not overlap. This is the line between "the body
 * and the description are about the same thing", which is expected and fine, and
 * "the material is quoting the description back", which is the circularity.
 */
export const LEAK_SHINGLE_WORDS = 8;

/**
 * Below this, a description has no distinctive phrasing to inherit.
 *
 * Redacting a three-word description's word order out of the body would delete real
 * capability evidence to prevent a leak that carries no framing anyway. The guard
 * stands down and says so rather than damaging the material.
 */
export const MIN_LEAK_WORDS = 4;

interface Token {
  readonly word: string;
  readonly start: number;
  readonly end: number;
}

const WORD_PATTERN = /[A-Za-z0-9']+/g;

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const match of text.matchAll(WORD_PATTERN)) {
    const index = match.index;
    if (index === undefined) continue;
    tokens.push({ word: match[0].toLowerCase(), start: index, end: index + match[0].length });
  }
  return tokens;
}

/**
 * The same tokenization, keeping only the words.
 *
 * Offsets are what `redactDescription` cuts on, and the detector does not cut anything --
 * it only reports which runs it saw. Building a `{word, start, end}` object per word to
 * throw two thirds of it away costs one allocation per word of the material, and the
 * material here is every byte of the synthesis prompt.
 */
function tokenizeWords(text: string): string[] {
  const words: string[] = [];
  for (const match of text.matchAll(WORD_PATTERN)) {
    if (match.index === undefined) continue;
    words.push(match[0].toLowerCase());
  }
  return words;
}

/**
 * What both halves of the guard need from a description: the runs to look for, and the
 * vocabulary those runs are made of.
 */
interface LeakGuard {
  /** The description's own word runs. A window matches when it is one of these. */
  readonly wanted: ReadonlySet<string>;
  /**
   * Every word appearing in any wanted run, as a pre-filter over sliding positions.
   *
   * Both halves of the guard slide an eight-word window across the whole of the material
   * and join each window into a string to look it up. Nearly every one of those joins is
   * thrown away unmatched: a description contributes a few dozen runs, and an
   * eighty-kilobyte prompt has some twelve thousand positions.
   *
   * A window can only equal a wanted run if every word of the window is the word at that
   * position in the run -- so every window word must appear in this set. That makes it a
   * strict superset test: it can admit a window that will not match, which costs only the
   * join we would have done anyway, and it can never reject one that would. It also
   * short-circuits on the first word not in the description's vocabulary, which is the
   * first word of nearly every window. Measured over the 80 KB of material this skill
   * itself produces, it takes 12,342 candidate positions down to 8.
   */
  readonly vocabulary: ReadonlySet<string>;
}

/**
 * The guard for one description, remembered between calls.
 *
 * `renderSourcesForPrompt` redacts every source against the SAME description, and each
 * call was re-tokenizing that description and rebuilding its run set from scratch --
 * forty times for a skill with forty bundled files, for forty identical results. The
 * cache is invisible because the value is a pure function of its key, and it holds one
 * entry because the access pattern is a loop over one description rather than a mix.
 */
let lastGuard: { readonly key: string; readonly guard: LeakGuard } | undefined;

function leakGuard(description: string, size: number): LeakGuard {
  const key = `${size} ${description}`;
  if (lastGuard?.key === key) return lastGuard.guard;

  const wanted = new Set(descriptionShingles(description, size));
  const vocabulary = new Set<string>();
  for (const shingle of wanted) for (const word of shingle.split(" ")) vocabulary.add(word);

  const guard: LeakGuard = { wanted, vocabulary };
  lastGuard = { key, guard };
  return guard;
}

/** Every word run of length `size` in `text`, as space-joined lowercase strings. */
function shinglesOf(words: readonly string[], size: number): string[] {
  if (words.length < size) return words.length === 0 ? [] : [words.join(" ")];
  const out: string[] = [];
  for (let i = 0; i + size <= words.length; i += 1) out.push(words.slice(i, i + size).join(" "));
  return out;
}

/** The description's own word runs, which no synthesis input may contain. */
export function descriptionShingles(description: string, size = LEAK_SHINGLE_WORDS): string[] {
  const words = tokenize(description).map((token) => token.word);
  if (words.length < MIN_LEAK_WORDS) return [];
  return shinglesOf(words, Math.min(size, words.length));
}

/**
 * Runs of the description that appear verbatim in `text`.
 *
 * The detector half of the guard. `redactDescription` removes them; this reports
 * what is left, and an empty result is the assertion `buildSynthesisPrompt` makes
 * before it will hand anything to a model.
 */
export function findDescriptionLeaks(
  text: string,
  description: string,
  size = LEAK_SHINGLE_WORDS,
): string[] {
  const { wanted, vocabulary } = leakGuard(description, size);
  if (wanted.size === 0) return [];
  const words = tokenizeWords(text);

  // The window width `shinglesOf` would have used. Its short-input branch is unreachable
  // from here -- `Math.max(words.length, 1)` keeps the width at or below the word count
  // for any non-empty text, and an empty text runs the loop zero times -- so the sliding
  // form below covers every case it did.
  const width = Math.min(size, Math.max(words.length, 1));
  const found = new Set<string>();
  for (let i = 0; i + width <= words.length; i += 1) {
    if (!windowInVocabulary(vocabulary, words, i, width)) continue;
    const shingle = words.slice(i, i + width).join(" ");
    if (wanted.has(shingle)) found.add(shingle);
  }
  return [...found];
}

/**
 * Whether every word of the `width`-wide window at `start` is in the guard's vocabulary.
 *
 * The pre-filter described on {@link LeakGuard.vocabulary}. Takes the words rather than
 * an accessor so the caller does not allocate a closure per sliding position, which on
 * this material would be twelve thousand of them per source file.
 */
function windowInVocabulary(
  vocabulary: ReadonlySet<string>,
  words: readonly string[],
  start: number,
  width: number,
): boolean {
  for (let k = 0; k < width; k += 1) {
    if (!vocabulary.has(words[start + k] as string)) return false;
  }
  return true;
}

export const REDACTION_MARKER = "[redacted: restates the description]";

/**
 * Remove any run of the description's own words from a piece of source material.
 *
 * Redaction rather than rejection, because the overlap is usually legitimate and
 * local: a SKILL.md body whose opening paragraph paraphrases its own description is
 * ordinary, well-written documentation. Throwing the whole file away over one
 * sentence would discard the capability evidence synthesis exists to read, while
 * keeping the sentence would let the description seed its own test set. Cutting out
 * the sentence keeps both properties.
 *
 * Returns the redacted text and how many spans were removed, so a run can say what
 * it did instead of quietly editing its inputs.
 */
export function redactDescription(
  text: string,
  description: string,
  size = LEAK_SHINGLE_WORDS,
): { readonly text: string; readonly redactions: number } {
  const { wanted, vocabulary } = leakGuard(description, size);
  if (wanted.size === 0) return { text, redactions: 0 };

  const tokens = tokenize(text);
  // The words alone, for the pre-filter. Offsets are what this function cuts on, so it
  // needs the full tokens too -- but the gate rejects all but a handful of positions and
  // should not pay a property load per word to do it.
  const words = tokens.map((token) => token.word);
  const width = Math.min(size, Math.max(tokens.length, 1));
  const spans: Array<{ start: number; end: number }> = [];

  for (let i = 0; i + width <= tokens.length; i += 1) {
    if (!windowInVocabulary(vocabulary, words, i, width)) continue;
    const run = tokens.slice(i, i + width);
    const shingle = run.map((token) => token.word).join(" ");
    if (!wanted.has(shingle)) continue;
    const start = run[0]?.start ?? 0;
    const end = run[run.length - 1]?.end ?? start;
    const previous = spans[spans.length - 1];
    // Consecutive matching windows overlap by construction, so merging keeps one
    // marker per redacted passage instead of one per sliding position.
    if (previous !== undefined && start <= previous.end) previous.end = Math.max(previous.end, end);
    else spans.push({ start, end });
  }

  if (spans.length === 0) return { text, redactions: 0 };

  let out = "";
  let cursor = 0;
  for (const span of spans) {
    out += text.slice(cursor, span.start) + REDACTION_MARKER;
    cursor = span.end;
  }
  out += text.slice(cursor);
  return { text: out, redactions: spans.length };
}

/** Raised when the exclusion sprang a leak, which must never pass silently. */
export class CircularityError extends Error {
  public override readonly name = "CircularityError";
}

/**
 * Refuse to send a prompt that quotes the description back at the model.
 *
 * The assertion exists because the redaction is a mechanism and mechanisms drift.
 * A synthesis run whose queries were seeded by the description produces an eval set
 * that looks exactly like a good one and certifies exactly the description that
 * wrote it -- so the failure has to be loud at the moment it happens, not visible
 * later in a score.
 */
export function assertNoDescriptionLeak(prompt: string, description: string): void {
  const leaks = findDescriptionLeaks(prompt, description);
  if (leaks.length === 0) return;
  throw new CircularityError(
    `the synthesis prompt still contains ${leaks.length} run(s) of the description under ` +
      `optimization, which would make the generated queries circular. First leak: ` +
      `"${leaks[0]}". This is a bug in the source collection, not in the artifact.`,
  );
}

// ---------------------------------------------------------------------------
// Reading the artifact
// ---------------------------------------------------------------------------

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await Bun.file(path).stat()).isDirectory();
  } catch {
    return false;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await Bun.file(path).stat();
    return true;
  } catch {
    return false;
  }
}

/**
 * Work out what kind of artifact a path names.
 *
 * Path shape is a reliable signal because Claude Code's own loader uses it: a skill
 * IS a directory with a SKILL.md, an agent IS a `.md` under `agents/`. Where the
 * shape is genuinely ambiguous -- a bare `.md` in no particular directory could be
 * an agent, a command, or neither -- this returns nothing and the caller asks,
 * rather than guessing and reading the wrong fields.
 */
export function inferTargetKind(
  path: string,
  looksLikeDirectory: boolean,
): TargetKind | undefined {
  const normalized = path.replace(/\/+$/, "");
  const base = normalized.slice(normalized.lastIndexOf("/") + 1);
  if (base.endsWith(".mcp.json") || base === "mcp.json") return "mcp";
  if (looksLikeDirectory) return "skill";
  if (!base.endsWith(".md")) return undefined;
  const parent = normalized.slice(0, normalized.lastIndexOf("/"));
  const parentName = parent.slice(parent.lastIndexOf("/") + 1);
  if (parentName === "agents") return "agent";
  if (parentName === "commands") return "command";
  return undefined;
}

/** Directory-aware wrapper over `inferTargetKind`, for the CLI. */
export async function detectTargetKind(path: string): Promise<TargetKind | undefined> {
  return inferTargetKind(path, await isDirectory(path));
}

interface Budget {
  remaining: number;
}

/** Read one file into a source record, respecting the per-file and total budgets. */
async function readSource(
  absolutePath: string,
  relativePath: string,
  role: SourceRole,
  budget: Budget,
): Promise<CapabilitySource | undefined> {
  const file = Bun.file(absolutePath);
  let bytes: number;
  try {
    bytes = (await file.stat()).size;
  } catch {
    return undefined;
  }

  // Assets are copied into output as material rather than read for meaning, per the
  // plugin's own load-mode rule. Their NAMES are capability evidence -- an
  // `assets/eval_review.html` says the artifact produces a review page -- and their
  // bytes are budget spent on content no capability can be inferred from.
  const readable =
    role !== "asset" && bytes <= MAX_FILE_BYTES && TEXT_EXTENSIONS.has(extensionOf(absolutePath));
  if (!readable) return { path: relativePath, role, excerpt: "", bytes, truncated: bytes > 0 };

  let text: string;
  try {
    text = await file.text();
  } catch {
    return undefined;
  }

  const perFile = Math.min(MAX_FILE_EXCERPT_CHARS, Math.max(0, budget.remaining));
  if (perFile === 0) return { path: relativePath, role, excerpt: "", bytes, truncated: true };
  const excerpt = text.length > perFile ? text.slice(0, perFile) : text;
  budget.remaining -= excerpt.length;
  return { path: relativePath, role, excerpt, bytes, truncated: excerpt.length < text.length };
}

/**
 * Which bundled directory maps to which role, in the order they are read.
 *
 * Examples come before references on purpose. An example is a complete specimen of
 * the deliverable -- the densest available statement of what the artifact produces --
 * whereas a reference explains a decision. When the budget binds, the specimen is
 * what you want to have kept.
 */
const BUNDLED_DIRECTORIES: ReadonlyArray<{ readonly dir: string; readonly role: SourceRole }> = [
  { dir: "examples", role: "example" },
  { dir: "references", role: "reference" },
  { dir: "scripts", role: "script" },
  { dir: "assets", role: "asset" },
];

async function collectBundled(root: string, budget: Budget): Promise<CapabilitySource[]> {
  const sources: CapabilitySource[] = [];
  const glob = new Bun.Glob("**/*");
  for (const { dir, role } of BUNDLED_DIRECTORIES) {
    let relatives: string[];
    try {
      relatives = await Array.fromAsync(
        glob.scan({ cwd: `${root}/${dir}`, onlyFiles: true, followSymlinks: false }),
      );
    } catch {
      continue; // the directory does not exist, which is the common case
    }
    let readForRole = 0;
    for (const relative of relatives.sort()) {
      if (relative.split("/").some((segment) => SKIP_SEGMENTS.has(segment))) continue;
      if (readForRole >= MAX_FILES_PER_ROLE) break;
      const source = await readSource(
        `${root}/${dir}/${relative}`,
        `${dir}/${relative}`,
        role,
        budget,
      );
      if (source === undefined) continue;
      sources.push(source);
      readForRole += 1;
    }
  }
  return sources;
}

/** Server entries from a `.mcp.json`, tolerating both the wrapped and bare shapes. */
function mcpServersOf(config: unknown): Record<string, unknown> {
  if (config === null || typeof config !== "object" || Array.isArray(config)) return {};
  const record = config as Record<string, unknown>;
  const wrapped = record["mcpServers"];
  if (wrapped !== null && typeof wrapped === "object" && !Array.isArray(wrapped)) {
    return wrapped as Record<string, unknown>;
  }
  return record;
}

/**
 * Describe one configured MCP server without leaking a credential.
 *
 * `env` and `headers` values are exactly where a token lives, and this text goes
 * into a subprocess prompt. Key names carry the capability signal -- a server
 * wanting `GITHUB_TOKEN` is a server that talks to GitHub -- and the values carry
 * only risk, so the names are kept and the values are dropped.
 */
export function describeMcpServer(name: string, entry: unknown): string {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    return `server "${name}": unreadable entry`;
  }
  const record = entry as Record<string, unknown>;
  const lines = [`server "${name}"`];
  const transport = record["type"] ?? record["transport"];
  if (typeof transport === "string") lines.push(`  transport: ${transport}`);
  if (typeof record["url"] === "string") lines.push(`  url: ${record["url"]}`);
  if (typeof record["command"] === "string") lines.push(`  command: ${record["command"]}`);
  const args = asStringList(record["args"]);
  if (args.length > 0) lines.push(`  args: ${args.join(" ")}`);
  for (const field of ["env", "headers"]) {
    const value = record[field];
    if (value === null || typeof value !== "object" || Array.isArray(value)) continue;
    const keys = Object.keys(value as Record<string, unknown>);
    if (keys.length > 0) lines.push(`  ${field} keys (values withheld): ${keys.join(", ")}`);
  }
  return lines.join("\n");
}

interface RawArtifact {
  readonly name: string;
  readonly description: string;
  readonly sources: readonly CapabilitySource[];
  readonly grants: readonly string[];
  /** Text the structural extractors run over: bodies, not frontmatter. */
  readonly substance: string;
  readonly notes: readonly string[];
}

async function readSkillArtifact(root: string, budget: Budget): Promise<RawArtifact> {
  const text = await Bun.file(`${root}/SKILL.md`).text();
  const { frontmatter, body } = splitFrontmatter(text);
  const fields = readFrontmatterFields(frontmatter);
  const name =
    typeof fields["name"] === "string" && fields["name"] !== ""
      ? fields["name"]
      : root.replace(/\/+$/, "").slice(root.replace(/\/+$/, "").lastIndexOf("/") + 1);

  const bodyExcerpt = body.slice(0, Math.min(body.length, budget.remaining));
  budget.remaining -= bodyExcerpt.length;
  const sources: CapabilitySource[] = [
    {
      path: "SKILL.md",
      role: "body",
      excerpt: bodyExcerpt,
      bytes: body.length,
      truncated: bodyExcerpt.length < body.length,
    },
    ...(await collectBundled(root, budget)),
  ];

  const grants = asStringList(fields["allowed-tools"]).map((tool) => `allowed-tools: ${tool}`);
  return {
    name,
    description: typeof fields["description"] === "string" ? fields["description"] : "",
    sources,
    grants,
    substance: sources.map((source) => source.excerpt).join("\n"),
    notes: [],
  };
}

async function readMarkdownArtifact(
  filePath: string,
  kind: "agent" | "command",
  budget: Budget,
): Promise<RawArtifact> {
  const text = await Bun.file(filePath).text();
  const { frontmatter, body } = splitFrontmatter(text);
  const fields = readFrontmatterFields(frontmatter);
  const base = filePath.slice(filePath.lastIndexOf("/") + 1);
  const name =
    typeof fields["name"] === "string" && fields["name"] !== ""
      ? fields["name"]
      : base.replace(/\.md$/, "");

  const bodyExcerpt = body.slice(0, Math.min(body.length, budget.remaining));
  budget.remaining -= bodyExcerpt.length;
  const sources: CapabilitySource[] = [
    {
      path: base,
      role: "body",
      excerpt: bodyExcerpt,
      bytes: body.length,
      truncated: bodyExcerpt.length < body.length,
    },
  ];

  const notes: string[] = [];
  const grants: string[] = [];
  if (kind === "agent") {
    // The tool grant is capability evidence in its own right, and the brief is
    // explicit about why: an agent granted `Bash` is being asked to do something the
    // description had better imply. An omitted `tools` inherits everything, which is
    // a wider claim than most descriptions make and is worth saying out loud.
    const tools = asStringList(fields["tools"]);
    const disallowed = asStringList(fields["disallowedTools"]);
    if (tools.length > 0) grants.push(...tools);
    else notes.push("`tools` is absent, so this agent inherits every tool available to subagents.");
    if (disallowed.length > 0) grants.push(...disallowed.map((tool) => `not: ${tool}`));
    if (grants.length > 0) {
      sources.push({
        path: "frontmatter: tools",
        role: "tool-grant",
        excerpt: grants.join(", "),
        bytes: grants.join(", ").length,
        truncated: false,
      });
    }
  } else {
    // A command's arguments are its interface. A query that supplies one is a
    // positive the body alone would never suggest.
    const hint = typeof fields["argument-hint"] === "string" ? fields["argument-hint"] : "";
    const args = asStringList(fields["arguments"]);
    if (hint !== "") grants.push(`argument-hint: ${hint}`);
    grants.push(...args.map((argument) => `argument: ${argument}`));
    if (grants.length > 0) {
      sources.push({
        path: "frontmatter: arguments",
        role: "arguments",
        excerpt: grants.join("\n"),
        bytes: grants.join("\n").length,
        truncated: false,
      });
    }
  }

  return {
    name,
    description: typeof fields["description"] === "string" ? fields["description"] : "",
    sources,
    grants,
    substance: sources.map((source) => source.excerpt).join("\n"),
    notes,
  };
}

async function readMcpArtifact(filePath: string, budget: Budget): Promise<RawArtifact> {
  const config: unknown = await Bun.file(filePath).json();
  const servers = mcpServersOf(config);
  const base = filePath.slice(filePath.lastIndexOf("/") + 1);
  const sources: CapabilitySource[] = [];
  const grants: string[] = [];

  for (const [serverName, entry] of Object.entries(servers).sort()) {
    const described = describeMcpServer(serverName, entry);
    budget.remaining -= described.length;
    sources.push({
      path: `${base}: ${serverName}`,
      role: "mcp-server",
      excerpt: described,
      bytes: described.length,
      truncated: false,
    });
    grants.push(serverName);

    // Follow a stdio server to its implementation when the config points at a local
    // file that exists. That file IS the tool list -- the tool names, their
    // descriptions and their schemas -- which the config by itself does not carry.
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
    const args = asStringList((entry as Record<string, unknown>)["args"]);
    for (const arg of args) {
      if (!TEXT_EXTENSIONS.has(extensionOf(arg))) continue;
      const candidate = arg.startsWith("/")
        ? arg
        : joinAbsolute(filePath.slice(0, filePath.lastIndexOf("/") + 1), arg);
      if (!(await fileExists(candidate))) continue;
      const source = await readSource(candidate, arg, "script", budget);
      if (source !== undefined) sources.push(source);
    }
  }

  const notes: string[] = [];
  const followed = sources.some((source) => source.role === "script");
  if (!followed) {
    // Said plainly rather than papered over. A `.mcp.json` declares how to REACH a
    // server; the tool names, descriptions and schemas live behind that connection.
    // Scenarios derived from config alone describe the server's subject matter, not
    // its tool surface, and an author should know which one they are editing.
    notes.push(
      "This `.mcp.json` declares how to reach each server, not what it exposes. No local " +
        "implementation was found to read the tool list and schemas from, so the scenarios " +
        "below are derived from the server's configured subject matter only.",
    );
  }

  return {
    name: base.replace(/\.json$/, ""),
    // An MCP config carries no description field to be circular about. The routing
    // text a model reads is each tool's own description, which lives in the server.
    description: "",
    sources,
    grants,
    substance: sources.map((source) => source.excerpt).join("\n"),
    notes,
  };
}

export interface InventoryOptions {
  readonly targetPath: string;
  readonly kind: TargetKind;
  /** Root the neighbour sweep treats as the project. Defaults to the cwd. */
  readonly projectDir?: string;
  readonly minShared?: number;
  readonly maxNeighbours?: number;
  /** Skip the installed-set sweep. Used by tests, and by an author who wants speed. */
  readonly skipNeighbours?: boolean;
}

/**
 * Read the artifact's substance and assemble the inventory.
 *
 * No model is involved. That is deliberate: the inventory is what the author
 * confirms BEFORE anything runs, and a step that costs an API call and a minute of
 * waiting is a step people skip.
 */
export async function buildInventory(options: InventoryOptions): Promise<CapabilityInventory> {
  const targetPath = absolute(options.targetPath);
  const budget: Budget = { remaining: MAX_TOTAL_EXCERPT_CHARS };

  const raw =
    options.kind === "skill"
      ? await readSkillArtifact(targetPath, budget)
      : options.kind === "mcp"
        ? await readMcpArtifact(targetPath, budget)
        : await readMarkdownArtifact(targetPath, options.kind, budget);

  const capabilities = capabilitiesFromSources(raw.sources);
  const nonGoals = extractNonGoals(raw.substance);

  // The neighbour search is seeded from BODY-DERIVED vocabulary, never from the
  // description. Seeding it from the description would make the hard negatives
  // circular in exactly the way the positives are guarded against: the queries a
  // neighbour contests would be chosen by the same text the loop is optimizing.
  //
  // From the capabilities and non-goals rather than from every byte read. The full
  // substance of a mature skill is tens of thousands of words, whose vocabulary
  // eventually intersects almost any installed skill's -- dogfooded against
  // `skill-creator`, it matched three document-format skills on words like `file`
  // and `format`, which contest none of its queries. The capability list and the
  // stated boundaries are the artifact's own summary of what it competes for, which
  // is the comparable unit: a description-sized statement of subject matter, derived
  // from substance instead of from the description.
  const targetTerms = domainTerms(
    `${raw.name} ${capabilities.join(" ")} ${nonGoals.join(" ")}`,
  );
  const sweep = options.skipNeighbours === true
    ? { scanned: 0, neighbours: [] as readonly Neighbour[] }
    : await findNeighbours({
        targetTerms,
        excludePath: options.kind === "skill" ? `${targetPath}/SKILL.md` : targetPath,
        ...(options.projectDir === undefined ? {} : { projectDir: options.projectDir }),
        minShared: options.minShared ?? SHARED_TERM_FLOOR,
      });

  return {
    name: raw.name,
    kind: options.kind,
    targetPath,
    sources: raw.sources,
    capabilities,
    nonGoals,
    grants: raw.grants,
    neighbours: sweep.neighbours.slice(0, options.maxNeighbours ?? MAX_NEIGHBOURS),
    neighboursScanned: sweep.scanned,
    description: raw.description,
    undocumented: undocumentedCapabilities(capabilities, raw.description),
    notes: raw.notes,
  };
}

// ---------------------------------------------------------------------------
// The prompt
// ---------------------------------------------------------------------------

export interface ScenarioCounts {
  readonly positives: number;
  readonly negatives: number;
}

/**
 * Split a total into positives and negatives.
 *
 * Roughly half each, with the odd one going to positives: a positive that never
 * fires is a capability the artifact loses outright, while an extra negative buys
 * a little more precision on a boundary that is already covered.
 */
export function splitCount(count: number): ScenarioCounts {
  if (!Number.isInteger(count) || count < 2) {
    throw new CliError(`--count must be a whole number of at least 2, got: ${count}`);
  }
  const positives = Math.ceil(count / 2);
  return { positives, negatives: count - positives };
}

function renderSourcesForPrompt(sources: readonly CapabilitySource[], description: string): {
  readonly text: string;
  readonly redactions: number;
} {
  const chunks: string[] = [];
  let redactions = 0;
  for (const source of sources) {
    if (source.excerpt === "") {
      // A name-only source. Still evidence: a file called `references/grader.md`
      // says the artifact grades something, whatever its bytes contain.
      chunks.push(`<file path="${source.path}" role="${source.role}" content="not read" />`);
      continue;
    }
    const redacted = redactDescription(source.excerpt, description);
    redactions += redacted.redactions;
    const truncated = source.truncated ? ' truncated="true"' : "";
    chunks.push(
      `<file path="${source.path}" role="${source.role}"${truncated}>\n${redacted.text}\n</file>`,
    );
  }
  return { text: chunks.join("\n\n"), redactions };
}

export interface SynthesisPrompt {
  readonly prompt: string;
  /** How many description-quoting passages were cut out of the material. */
  readonly redactions: number;
}

/**
 * Build the prompt that asks a model to write the scenarios.
 *
 * The prompt hands over the artifact's substance and withholds its description,
 * then says so -- a model told nothing about the omission tends to hedge toward
 * generic phrasing, whereas one told the description was deliberately withheld
 * writes from the evidence it has.
 *
 * @throws {CircularityError} if any run of the description survived redaction.
 */
export function buildSynthesisPrompt(
  inventory: CapabilityInventory,
  counts: ScenarioCounts,
): SynthesisPrompt {
  const rendered = renderSourcesForPrompt(inventory.sources, inventory.description);

  const neighbourLines =
    inventory.neighbours.length === 0
      ? "(none found on this machine)"
      : inventory.neighbours
          .map(
            (neighbour) =>
              `- "${neighbour.skill.name}" (${neighbour.skill.origin}) — overlapping vocabulary: ` +
              `${neighbour.shared.join(", ")}\n  its description: ${neighbour.skill.description.replace(/\s+/g, " ").slice(0, 300)}`,
          )
          .join("\n");

  const capabilityLines =
    inventory.capabilities.length === 0
      ? "(none could be read off the structure — work from the files below)"
      : inventory.capabilities.map((capability) => `- ${capability}`).join("\n");

  const nonGoalLines =
    inventory.nonGoals.length === 0
      ? "(none stated)"
      : inventory.nonGoals.map((goal) => `- ${goal}`).join("\n");

  const grantLines = inventory.grants.length === 0 ? "(none declared)" : inventory.grants.join(", ");

  const prompt = `You are writing a trigger evaluation set for a Claude Code ${inventory.kind} named "${inventory.name}".

A trigger eval measures one thing: whether Claude reaches for this artifact when it should, and leaves it alone when it should not. Each scenario is a query a user might actually send, paired with whether this artifact ought to handle it.

You have deliberately NOT been shown this artifact's description. That is not an oversight. The description is the text being optimized, and queries written from it would inherit its vocabulary — every candidate would then score well on the cases its own words suggested, and a capability the description forgets would generate no queries and never be penalised. Write from what the artifact DOES, which is below.

<derived_capabilities>
${capabilityLines}
</derived_capabilities>

<stated_non_goals>
${nonGoalLines}
</stated_non_goals>

<tool_grant_or_arguments>
${grantLines}
</tool_grant_or_arguments>

<co_installed_neighbours>
These are real skills installed alongside this one, found by a vocabulary sweep of the machine. They are listed with the words they share.

The sweep is lexical, so judge each one: some share only generic words that any authored artifact uses, and those contest nothing. Use the ones whose own description shows a genuine adjacency — where a reasonable person really could send the same sentence to either — and ignore the rest rather than forcing a negative out of a weak match.
${neighbourLines}
</co_installed_neighbours>

<artifact_substance>
${rendered.text}
</artifact_substance>

Write exactly ${counts.positives} positive scenarios and ${counts.negatives} negative scenarios.

For the ${counts.positives} positives:
- Ground each one in a specific capability you can point to in the material above. Spread them across the capabilities rather than restating one of them ${counts.positives} ways.
- Phrase them the way a real person types: lowercase starts, half-remembered names, the actual mess of their situation, the thing they are annoyed about. Not "Create a skill for PDF extraction" but "we keep re-explaining the same pdf table thing to claude every week, can you make that stick".
- Vary the length. Some people write one line and some write a paragraph.
- Include at least one that exercises a capability visible only in a bundled file rather than in the main body — a reference, a script, an example. Those are the capabilities a description most often forgets.

For the ${counts.negatives} negatives, take them from three different places, roughly evenly:
- The artifact's stated non-goals, phrased in its POSITIVE vocabulary. A negative built from words the positives never use excludes nothing, because a real near-miss arrives sounding exactly like a hit.
- The adjacent capability one step outside the boundary: the request a reasonable person would assume this handles, and it does not.
- The co-installed neighbours above: a query that genuinely belongs to one of them. Those are the queries this artifact will actually lose or wrongly win in production.

A negative must be hard. If the answer is obvious from the first five words, it measures nothing.

Respond with only a JSON array inside <scenarios> tags, nothing else:

<scenarios>
[
  {"query": "...", "should_trigger": true},
  {"query": "...", "should_trigger": false}
]
</scenarios>`;

  // The guard, applied to the finished prompt rather than to each part, so it also
  // catches a leak introduced by the assembly itself.
  assertNoDescriptionLeak(prompt, inventory.description);
  return { prompt, redactions: rendered.redactions };
}

// ---------------------------------------------------------------------------
// Model call and response handling
// ---------------------------------------------------------------------------

/**
 * Run `claude -p` with the prompt on stdin.
 *
 * The same subprocess pattern `propose-description.ts` uses, through the same
 * `util/subprocess.ts` helper: the parent environment is merged rather than replaced
 * so a nested call keeps the session's auth, and the payload goes over stdin rather
 * than argv because it embeds whole files.
 */
async function callClaude(
  prompt: string,
  model: string | undefined,
  timeoutSeconds: number,
): Promise<string> {
  const cmd = ["claude", "-p", "--output-format", "text"];
  if (model !== undefined && model !== "") cmd.push("--model", model);

  const outcome = await runCommand(cmd, { stdin: prompt, timeoutMs: timeoutSeconds * 1000 });
  switch (outcome.kind) {
    case "timeout":
      throw new Error(`claude -p timed out after ${timeoutSeconds}s`);
    case "error":
      throw new Error(`claude -p could not be started: ${outcome.message}`);
    case "ok":
      if (outcome.exitCode !== 0) {
        throw new Error(`claude -p exited ${outcome.exitCode}\nstderr: ${outcome.stderr}`);
      }
      return outcome.stdout;
  }
}

/**
 * Pull the JSON array out of a model response.
 *
 * Three shapes are accepted in falling order of confidence: the requested
 * `<scenarios>` tags, a fenced ```json block, and a bare bracketed array. The
 * fallbacks exist because losing a whole synthesis run to a stray code fence would
 * be an expensive way to enforce a formatting preference.
 */
export function extractScenarioBlock(text: string): string | undefined {
  const tagged = /<scenarios>([\s\S]*?)<\/scenarios>/.exec(text);
  if (tagged?.[1] !== undefined) return tagged[1].trim();
  const fenced = /```(?:json)?\s*(\[[\s\S]*?\])\s*```/.exec(text);
  if (fenced?.[1] !== undefined) return fenced[1].trim();
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start !== -1 && end > start) return text.slice(start, end + 1);
  return undefined;
}

export interface ParsedScenarios {
  readonly scenarios: readonly Scenario[];
  /** Rows that did not carry a string query and a boolean flag. */
  readonly skipped: number;
}

/**
 * Validate the model's rows at the boundary.
 *
 * Malformed rows are dropped and counted rather than throwing, because a single bad
 * row in an otherwise good set of twenty should cost that row and not the run. A
 * response that is not an array at all is a different matter -- there is nothing to
 * salvage and pretending otherwise would write an empty eval set to disk.
 */
export function parseScenarios(raw: unknown): ParsedScenarios {
  if (!Array.isArray(raw)) throw new TypeError("expected a JSON array of scenarios");
  const scenarios: Scenario[] = [];
  let skipped = 0;
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      skipped += 1;
      continue;
    }
    const record = entry as Record<string, unknown>;
    const query = record["query"];
    const shouldTrigger = record["should_trigger"];
    if (typeof query !== "string" || query.trim() === "" || typeof shouldTrigger !== "boolean") {
      skipped += 1;
      continue;
    }
    scenarios.push({ query: query.trim(), should_trigger: shouldTrigger });
  }
  return { scenarios, skipped };
}

/**
 * Take the requested number of each class, deduplicated, positives first.
 *
 * Under-delivery is passed through rather than padded. A synthesized set is a draft
 * the author edits, and eighteen real scenarios are worth more than twenty where two
 * were invented to hit a number.
 */
export function balanceScenarios(
  scenarios: readonly Scenario[],
  counts: ScenarioCounts,
): readonly Scenario[] {
  const seen = new Set<string>();
  const positives: Scenario[] = [];
  const negatives: Scenario[] = [];

  for (const scenario of scenarios) {
    const key = scenario.query.toLowerCase().replace(/\s+/g, " ").trim();
    if (seen.has(key)) continue;
    seen.add(key);
    const bucket = scenario.should_trigger ? positives : negatives;
    const limit = scenario.should_trigger ? counts.positives : counts.negatives;
    if (bucket.length < limit) bucket.push(scenario);
  }

  return [...positives, ...negatives];
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const KIND_LABEL: Readonly<Record<TargetKind, string>> = {
  skill: "skill (SKILL.md and its bundled files)",
  agent: "subagent (system prompt and tool grant)",
  command: "slash command (body and argument plumbing)",
  mcp: "MCP configuration (server surface)",
};

/** Shared terms printed per neighbour before the list is summarized. */
const SHOWN_SHARED_TERMS = 8;

const ROLE_LABEL: Readonly<Record<SourceRole, string>> = {
  body: "body",
  example: "examples",
  reference: "references",
  script: "scripts",
  asset: "assets (names only)",
  "tool-grant": "tool grant",
  arguments: "arguments",
  "mcp-server": "servers",
};

function countByRole(sources: readonly CapabilitySource[]): string {
  const counts = new Map<SourceRole, number>();
  for (const source of sources) counts.set(source.role, (counts.get(source.role) ?? 0) + 1);
  return [...counts.entries()]
    .map(([role, count]) => `${count} ${ROLE_LABEL[role]}`)
    .join(", ");
}

export interface SynthesisOutcome {
  readonly scenarios: readonly Scenario[];
  readonly outPath: string;
  readonly requested: ScenarioCounts;
  readonly redactions: number;
  readonly skipped: number;
}

/**
 * Render the inventory as markdown, in the shape `validate-skill.ts` uses.
 *
 * Markdown because it lands in a Claude Code transcript where ANSI is stripped, and
 * the same heading-and-bold-verdict shape because two scripts in one skill printing
 * two different report formats is a small thing that makes a toolkit feel like
 * separate tools.
 */
export function renderInventory(
  inventory: CapabilityInventory,
  outcome?: SynthesisOutcome,
): string {
  const totalChars = inventory.sources.reduce((sum, source) => sum + source.excerpt.length, 0);
  const lines: string[] = [
    `# Scenario synthesis: \`${inventory.name}\``,
    "",
    `- **Target**: \`${inventory.targetPath}\``,
    `- **Type**: ${KIND_LABEL[inventory.kind]}`,
    `- **Read for substance**: ${inventory.sources.length} source(s) — ${countByRole(inventory.sources)}`,
    `- **Material handed to synthesis**: ${totalChars.toLocaleString("en-US")} characters`,
    "",
    `## What this artifact appears to do (${inventory.capabilities.length})`,
    "",
    "Derived from the artifact's own structure and its bundled files. The description was",
    "not read — queries written from it would inherit its vocabulary and the eval would",
    "certify the description against itself.",
    "",
  ];

  if (inventory.capabilities.length === 0) {
    lines.push("- (nothing could be read off the structure — check the target path)", "");
  } else {
    for (const capability of inventory.capabilities) lines.push(`- ${capability}`);
    lines.push("");
  }

  if (inventory.nonGoals.length > 0) {
    lines.push(`## Stated non-goals (${inventory.nonGoals.length})`, "");
    lines.push("Hard negatives are drawn from these, phrased in the positive vocabulary.", "");
    for (const goal of inventory.nonGoals) lines.push(`- ${goal}`);
    lines.push("");
  }

  if (inventory.grants.length > 0) {
    lines.push("## Declared surface", "");
    for (const grant of inventory.grants) lines.push(`- \`${grant}\``);
    lines.push("");
  }

  lines.push(`## Co-installed neighbours (${inventory.neighbours.length})`, "");
  lines.push(
    `Scanned ${inventory.neighboursScanned} installed skill(s). A neighbour sharing this`,
  );
  lines.push("artifact's vocabulary owns queries this one has to decline, which makes its");
  lines.push("territory the sharpest available source of hard negatives.", "");
  if (inventory.neighbours.length === 0) {
    lines.push("- (none share enough vocabulary to compete)", "");
  } else {
    for (const neighbour of inventory.neighbours) {
      const pushy = neighbour.pushy.length > 0 ? " — **uses pushy phrasing**" : "";
      // Truncated, because the count is the signal and the tail is noise: past a
      // handful of shared terms the next one does not change whether this neighbour
      // competes, and a forty-term list buries the neighbour's name.
      const shown = neighbour.shared.slice(0, SHOWN_SHARED_TERMS);
      const rest = neighbour.shared.length - shown.length;
      lines.push(
        `- \`${neighbour.skill.name}\` (${neighbour.skill.origin})${pushy} — shares ` +
          shown.map((term) => `\`${term}\``).join(", ") +
          (rest > 0 ? ` and ${rest} more` : ""),
      );
    }
    lines.push("");
  }

  if (inventory.undocumented.length > 0) {
    lines.push(`## Capabilities the description never mentions (${inventory.undocumented.length})`, "");
    lines.push("Each of these is a finding on its own. The loop optimizes the description, so a");
    lines.push("capability its vocabulary never touches generates no queries and is never");
    lines.push("penalised for being missing — the score comes back clean and the gap survives.", "");
    for (const capability of inventory.undocumented) lines.push(`- ${capability}`);
    lines.push("");
  }

  for (const note of inventory.notes) lines.push(`> ${note}`, "");

  if (outcome !== undefined) {
    const positives = outcome.scenarios.filter((scenario) => scenario.should_trigger).length;
    const negatives = outcome.scenarios.length - positives;
    lines.push(`## Scenarios (${outcome.scenarios.length})`, "");
    lines.push(
      `- ${positives} positive, ${negatives} negative ` +
        `(asked for ${outcome.requested.positives} and ${outcome.requested.negatives})`,
    );
    lines.push(`- Written to \`${outcome.outPath}\``);
    if (outcome.skipped > 0) {
      lines.push(`- ${outcome.skipped} malformed row(s) from the model were dropped`);
    }
    if (outcome.redactions > 0) {
      lines.push(
        `- ${outcome.redactions} passage(s) restating the description were cut from the material ` +
          "before synthesis saw it",
      );
    }
    lines.push("");
  }

  lines.push(
    outcome === undefined
      ? "**Inventory only — nothing was generated.** Confirm this describes the artifact, then " +
          "re-run with `--out <path>` to write the scenario set."
      : "**Scenarios are a draft.** Confirm the inventory above describes the artifact, then edit " +
          "the set before running the loop — correcting a misread now costs nothing, and " +
          "correcting it after an iteration costs the iteration.",
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const USAGE = [
  "Usage: bun shared/scripts/synthesize-scenarios.ts --target <path> --out <path> [options]",
  "",
  "Derives a trigger eval set from what an artifact does — its body, its bundled",
  "files, its tool grant — rather than from the description being optimized, which",
  "would make the queries circular.",
  "",
  "The target may also be given as a bare positional argument.",
  "Exit 0 on success, 1 when the target cannot be read or the model returns nothing,",
  "2 on usage error.",
].join("\n");

export const CLI_SPEC: Spec = {
  target: { kind: "string", help: "Path to the skill directory, agent .md, or .mcp.json" },
  "target-type": { kind: "string", help: "skill | agent | command | mcp (inferred when absent)" },
  out: { kind: "string", help: "Where to write the eval-set JSON" },
  inventory: { kind: "string", help: "Write the inventory markdown here instead of stdout" },
  "inventory-only": {
    kind: "boolean",
    default: false,
    help: "Report the inventory and stop, without calling a model",
  },
  count: { kind: "integer", default: DEFAULT_COUNT, help: "Total scenarios, split half each way" },
  model: { kind: "string", help: "Model for synthesis (default: user's configured)" },
  "project-dir": { kind: "string", help: "Project root for the neighbour sweep (default: cwd)" },
  "min-shared": {
    kind: "number",
    default: SHARED_TERM_FLOOR,
    help: "Shared domain terms before a neighbour counts as competing",
  },
  "max-neighbours": {
    kind: "number",
    default: MAX_NEIGHBOURS,
    help: "Neighbours carried into the prompt",
  },
  timeout: {
    kind: "number",
    default: SYNTHESIS_TIMEOUT_SECONDS,
    help: "Budget for the synthesis call, in seconds",
  },
  help: { kind: "boolean", short: "h", default: false, help: "Show this message" },
};

function flagString(flags: ParsedArgs["flags"], name: string): string | undefined {
  const value = flags[name];
  return typeof value === "string" && value !== "" ? value : undefined;
}

function flagNumber(flags: ParsedArgs["flags"], name: string, fallback: number): number {
  const value = flags[name];
  return typeof value === "number" ? value : fallback;
}

/** Read `--target-type`, rejecting a value that is not one of the four. */
export function resolveKind(raw: string | undefined): TargetKind | undefined {
  if (raw === undefined) return undefined;
  const match = TARGET_KINDS.find((kind) => kind === raw);
  if (match === undefined) {
    throw new CliError(`--target-type must be one of ${TARGET_KINDS.join(", ")}, got: ${raw}`);
  }
  return match;
}

async function main(argv: readonly string[]): Promise<number> {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv, CLI_SPEC);
  } catch (error) {
    if (!(error instanceof CliError)) throw error;
    console.log(`Error: ${error.message}\n\n${formatHelp(USAGE, CLI_SPEC)}`);
    return 2;
  }
  const { flags, positionals } = parsed;

  if (flags["help"] === true) {
    console.log(formatHelp(USAGE, CLI_SPEC));
    return 0;
  }

  const targetPath = flagString(flags, "target") ?? positionals[0];
  if (targetPath === undefined) {
    console.log(`Error: --target is required\n\n${formatHelp(USAGE, CLI_SPEC)}`);
    return 2;
  }

  let kind: TargetKind | undefined;
  let counts: ScenarioCounts;
  try {
    kind = resolveKind(flagString(flags, "target-type")) ?? (await detectTargetKind(targetPath));
    counts = splitCount(flagNumber(flags, "count", DEFAULT_COUNT));
  } catch (error) {
    if (!(error instanceof CliError)) throw error;
    console.log(`Error: ${error.message}\n\n${formatHelp(USAGE, CLI_SPEC)}`);
    return 2;
  }

  if (kind === undefined) {
    console.log(
      `Error: cannot tell what kind of artifact \`${targetPath}\` is. A directory with a ` +
        "SKILL.md is a skill, a `.md` under `agents/` is an agent, a `.md` under `commands/` " +
        "is a command, and a `.mcp.json` is mcp. Pass --target-type to say which.",
    );
    return 2;
  }

  const inventoryOnly = flags["inventory-only"] === true;
  const outPath = flagString(flags, "out");
  if (!inventoryOnly && outPath === undefined) {
    console.log(
      `Error: --out is required unless --inventory-only is set\n\n${formatHelp(USAGE, CLI_SPEC)}`,
    );
    return 2;
  }

  const projectDir = flagString(flags, "project-dir");
  let inventory: CapabilityInventory;
  try {
    inventory = await buildInventory({
      targetPath,
      kind,
      ...(projectDir === undefined ? {} : { projectDir }),
      minShared: flagNumber(flags, "min-shared", SHARED_TERM_FLOOR),
      maxNeighbours: flagNumber(flags, "max-neighbours", MAX_NEIGHBOURS),
    });
  } catch (error) {
    console.log(
      `Error: could not read ${kind} at \`${targetPath}\`: ` +
        (error instanceof Error ? error.message : String(error)),
    );
    return 1;
  }

  const emit = async (text: string): Promise<void> => {
    const inventoryPath = flagString(flags, "inventory");
    if (inventoryPath === undefined) console.log(text);
    else {
      await Bun.write(inventoryPath, `${text}\n`);
      console.log(`Inventory written to \`${inventoryPath}\`.`);
    }
  };

  if (inventoryOnly) {
    await emit(renderInventory(inventory));
    return 0;
  }

  let built: SynthesisPrompt;
  try {
    built = buildSynthesisPrompt(inventory, counts);
  } catch (error) {
    // A circularity failure is reported as a defect in this script, not in the
    // artifact, because that is what it is: the exclusion is this script's job.
    console.log(`Error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  let response: string;
  try {
    response = await callClaude(
      built.prompt,
      flagString(flags, "model"),
      flagNumber(flags, "timeout", SYNTHESIS_TIMEOUT_SECONDS),
    );
  } catch (error) {
    console.log(`Error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  const block = extractScenarioBlock(response);
  if (block === undefined) {
    console.log("Error: the model's response contained no JSON array of scenarios.");
    return 1;
  }

  let parsedScenarios: ParsedScenarios;
  try {
    parsedScenarios = parseScenarios(JSON.parse(block));
  } catch (error) {
    console.log(
      `Error: could not read the model's scenarios: ` +
        (error instanceof Error ? error.message : String(error)),
    );
    return 1;
  }

  const scenarios = balanceScenarios(parsedScenarios.scenarios, counts);
  if (scenarios.length === 0) {
    console.log("Error: the model returned no usable scenarios.");
    return 1;
  }

  const resolvedOut = outPath as string;
  await Bun.write(resolvedOut, `${JSON.stringify(scenarios, null, 2)}\n`);
  await emit(
    renderInventory(inventory, {
      scenarios,
      outPath: absolute(resolvedOut),
      requested: counts,
      redactions: built.redactions,
      skipped: parsedScenarios.skipped,
    }),
  );
  return 0;
}

// Guarded so the module can be imported by tests without running the CLI.
if (import.meta.main) process.exit(await main(Bun.argv.slice(2)));
