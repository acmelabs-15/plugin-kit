/**
 * The pure half of the progressive-disclosure optimizer.
 *
 * Everything here is a function of data rather than of the filesystem or of a
 * subprocess: token counting, the bundled-file inventory, pull-rate arithmetic, the
 * decision rule, candidate generation, the layout rewrite, and held-out selection.
 * `optimize-disclosure.ts` owns the parts that spawn `claude` and touch disk.
 *
 * The split is not tidiness. Every judgement this optimizer makes -- which reference to
 * inline, which body section to push out, which candidate wins -- is decided here, and a
 * decision that can only be exercised by spawning `claude` is a decision with no test
 * coverage. Driving these from fixtures is what makes the rules auditable at all.
 *
 * Pure Bun: `Bun.Glob` and `Bun.file` for the two functions that do read the disk
 * (inventory and content loading), `node:path` for path arithmetic because Bun offers no
 * native equivalent, and nothing else.
 */

import { relative, resolve } from "node:path";

import { scenarioSetFindings } from "../schemas/scenario-set.ts";
import { PythonRandom } from "../util/mt19937.ts";

// ---------------------------------------------------------------------------
// Token counting
// ---------------------------------------------------------------------------

/**
 * How a token figure was arrived at.
 *
 * Carried alongside every count rather than assumed, because the two are not
 * interchangeable and the report has to say which one the reader is looking at. A
 * body that measures 4,800 estimated tokens against a 5,000-token budget has not been
 * shown to be inside it.
 */
export type TokenMethod = "tiktoken:cl100k_base" | "estimator:chars-over-4";

export interface TokenCounter {
  count(text: string): number;
  readonly method: TokenMethod;
  /** True when `count` is an approximation rather than a real tokenization. */
  readonly estimated: boolean;
}

/**
 * The documented rule-of-thumb estimator: one token per four characters of English text.
 *
 * Used only when `tiktoken` is absent. It is published guidance rather than a
 * measurement of this corpus, and it is wrong in both directions -- dense code and
 * tables tokenize worse than 4:1, ordinary prose often better -- which is exactly why
 * every figure derived from it is labelled as an estimate all the way through to the
 * report. An author trimming a body against a number that could be 700 tokens out
 * deserves to know that before they start cutting.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** The estimator as a counter, so callers and tests can ask for it explicitly. */
export function estimatingCounter(): TokenCounter {
  return { count: estimateTokens, method: "estimator:chars-over-4", estimated: true };
}

/**
 * Load the best token counter available in this environment.
 *
 * `tiktoken` is a devDependency of this repository, not a runtime one -- the house rule
 * is that a skill's scripts run with nothing but Bun installed. So it is reached for
 * through a dynamic import that is allowed to fail, exactly as `validate-skill.ts` does,
 * and the estimator takes over when it does. The encoder is created once and reused:
 * building a cl100k encoder costs a WASM instantiation, and this counts every bundled
 * file of every candidate layout on every iteration.
 */
export async function loadTokenCounter(): Promise<TokenCounter> {
  try {
    const { get_encoding } = await import("tiktoken");
    const encoding = get_encoding("cl100k_base");
    return {
      count: (text: string) => encoding.encode(text).length,
      method: "tiktoken:cl100k_base",
      estimated: false,
    };
  } catch {
    return estimatingCounter();
  }
}

// ---------------------------------------------------------------------------
// SKILL.md structure
// ---------------------------------------------------------------------------

/** Matches the frontmatter block, tolerating CRLF, the same shape `measure-triggering.ts` uses. */
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export interface SplitSkill {
  /** The `---` block including both delimiters, or "" when there is none. */
  readonly frontmatter: string;
  /** Everything after it. This is what costs tokens on every invocation. */
  readonly body: string;
}

/**
 * Separate frontmatter from body.
 *
 * The body alone is what the budget is about: frontmatter is metadata that loads with
 * the skill listing rather than with the instructions, so counting it against the
 * instruction budget would charge the skill twice for its description.
 */
export function splitSkillMd(content: string): SplitSkill {
  const match = FRONTMATTER.exec(content);
  if (match === null) return { frontmatter: "", body: content };
  return { frontmatter: match[0], body: content.slice(match[0].length) };
}

/**
 * One `##`-or-deeper section of the body, as a unit that could move out.
 *
 * A section runs from its heading to the next heading at the same level or shallower,
 * so nested subsections travel with their parent. That is the right granularity for
 * extraction: pushing out a `###` while leaving its siblings behind produces a body that
 * reads as though a paragraph went missing.
 */
export interface BodySection {
  readonly heading: string;
  readonly level: number;
  /** 0-based index of the heading line within the body. */
  readonly startLine: number;
  /** Exclusive. */
  readonly endLine: number;
  /** Heading line included, so the section can be written out as a document. */
  readonly text: string;
  readonly tokens: number;
  readonly lines: number;
}

/** Headings inside a fenced code block are not headings. */
function headingLevel(line: string): number {
  const match = /^(#{1,6})\s+\S/.exec(line);
  return match === null ? 0 : (match[1] as string).length;
}

/**
 * Segment the body into sections at `minLevel` and deeper.
 *
 * Fenced blocks are tracked so a `# comment` inside a shell example does not open a
 * phantom section -- which would slice a section boundary through the middle of a code
 * block and produce an extraction that cannot compile.
 */
export function bodySections(
  body: string,
  counter: TokenCounter,
  minLevel = 2,
): readonly BodySection[] {
  const lines = body.split("\n");
  const starts: { index: number; level: number; heading: string }[] = [];
  let fence: string | null = null;

  for (const [index, line] of lines.entries()) {
    const fenceMatch = /^\s*(```+|~~~+)/.exec(line);
    if (fenceMatch !== null) {
      const marker = (fenceMatch[1] as string)[0] as string;
      if (fence === null) fence = marker;
      else if (marker === fence) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const level = headingLevel(line);
    if (level >= minLevel) {
      starts.push({ index, level, heading: line.replace(/^#{1,6}\s+/, "").trim() });
    }
  }

  return starts.map((start, position) => {
    // The section ends at the next heading that is NOT nested inside it. Anything deeper
    // belongs to this section and moves with it.
    let end = lines.length;
    for (let next = position + 1; next < starts.length; next += 1) {
      const candidate = starts[next] as { index: number; level: number };
      if (candidate.level <= start.level) {
        end = candidate.index;
        break;
      }
    }
    const text = lines.slice(start.index, end).join("\n");
    return {
      heading: start.heading,
      level: start.level,
      startLine: start.index,
      endLine: end,
      text,
      tokens: counter.count(text),
      lines: end - start.index,
    };
  });
}

/**
 * Sections large enough that moving them out could pay for the tool call that brings
 * them back.
 *
 * The floor is a judgement, not a measurement: a deferred read costs a round trip and
 * some hundreds of tokens of tool-call overhead, so extracting a 60-token section makes
 * the skill slower and barely cheaper. Sorted by cost descending, because the whole
 * objective is the unconditional body bill and the biggest section is where it lives.
 */
export function shortlistExtractions(
  sections: readonly BodySection[],
  minTokens: number,
): readonly BodySection[] {
  return [...sections]
    .filter((section) => section.tokens >= minTokens)
    .sort((a, b) => b.tokens - a.tokens);
}

// ---------------------------------------------------------------------------
// Bundled-file inventory
// ---------------------------------------------------------------------------

/**
 * How a file is meant to reach the model, derived from its directory.
 *
 * This is the taxonomy `../../references/progressive-disclosure.md` sets out, and it decides
 * whether a zero pull rate is a finding or the correct outcome. A `scripts/` file is
 * executed and its text never enters context, so nobody reading it is exactly right; a
 * `references/` file nobody reads is either dead weight or invisible.
 */
export type LoadMode = "read" | "specimen" | "execute" | "copy" | "root";

export function loadModeOf(relPath: string): LoadMode {
  const first = relPath.split("/")[0] ?? "";
  if (relPath.includes("/")) {
    if (first === "scripts") return "execute";
    if (first === "assets") return "copy";
    if (first === "examples") return "specimen";
    if (first === "references") return "read";
  }
  return "root";
}

/** Load modes whose files are supposed to enter context when the work needs them. */
const READ_MODES: ReadonlySet<LoadMode> = new Set<LoadMode>(["read", "specimen", "root"]);

export interface BundledFile {
  /** Skill-relative, POSIX separators. */
  readonly path: string;
  readonly loadMode: LoadMode;
  readonly bytes: number;
  /** What this file costs the run that reads it. */
  readonly tokens: number;
  /** Whether the body names it, which is what makes it reachable at all. */
  readonly signposted: boolean;
}

/**
 * Does the body point at this file?
 *
 * A substring test with boundaries rather than a markdown-link parse, because a skill
 * signposts a file in every form the prose allows -- a link target, a backticked path, a
 * bare mention in a sentence, or `${CLAUDE_SKILL_DIR}/references/x.md` -- and only the
 * path itself is common to all of them. The trailing guard stops `references/api.md`
 * matching inside `references/api.md.bak`; the leading one stops it matching the tail of
 * `old-references/api.md`.
 */
export function bodyPointsAt(body: string, relPath: string): boolean {
  // Cheap gate before the compile. The pattern below is the path's own characters with
  // every regex metacharacter escaped, wrapped in two zero-width guards -- so a body not
  // containing the path as a plain substring cannot match it, and there is nothing to
  // compile. That is the common case: `inventoryBundledFiles` asks this of every bundled
  // file, and roughly half of a mature skill's files are never named in the body. The
  // `new RegExp` is per-path by nature and cannot be hoisted, which is exactly why not
  // reaching it is the saving.
  if (!body.includes(relPath)) return false;
  const escaped = relPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\w/.-])\\.?/?${escaped}(?![\\w.-])`).test(body);
}

/** Files that are part of the harness rather than the skill, and never a disclosure finding. */
const INVENTORY_EXCLUDES: ReadonlySet<string> = new Set(["SKILL.md"]);

function isExcluded(relPath: string): boolean {
  if (INVENTORY_EXCLUDES.has(relPath)) return true;
  // Test suites, lockfiles and node_modules ship with a skill's scripts but are never
  // loaded into a model's context, so counting them as unread bundled files would fill
  // the findings table with rows whose correct verdict is always "ignore this".
  return (
    relPath.startsWith("node_modules/") ||
    relPath.includes("/__tests__/") ||
    relPath.endsWith(".lock") ||
    relPath.startsWith(".")
  );
}

/**
 * Every bundled file in the skill, with its cost and whether the body points at it.
 *
 * One of the two functions here that touch the disk. Reading each file's text is
 * deliberate: the point of the inventory is what each file would cost if it loaded, and
 * a byte count is not that -- a 4 KB table of identifiers and 4 KB of prose differ by
 * more than a third in tokens.
 */
export async function inventoryBundledFiles(
  skillDir: string,
  body: string,
  counter: TokenCounter,
): Promise<readonly BundledFile[]> {
  const names = await Array.fromAsync(
    new Bun.Glob("**/*").scan({ cwd: skillDir, onlyFiles: true }),
  );
  const files: BundledFile[] = [];
  for (const name of names.sort()) {
    const relPath = name.split("\\").join("/");
    if (isExcluded(relPath)) continue;
    const file = Bun.file(`${skillDir}/${relPath}`);
    let text = "";
    try {
      text = await file.text();
    } catch {
      // A binary asset -- a font, a logo -- has no token cost because nothing reads it
      // for meaning. It still belongs in the inventory so a run that DID read it shows up.
      text = "";
    }
    files.push({
      path: relPath,
      loadMode: loadModeOf(relPath),
      bytes: file.size,
      tokens: counter.count(text),
      signposted: bodyPointsAt(body, relPath),
    });
  }
  return files;
}

// ---------------------------------------------------------------------------
// Runs and pull rates
// ---------------------------------------------------------------------------

/** One `claude -p` execution of one scenario against one layout. */
export interface ScenarioRun {
  readonly scenarioId: string;
  readonly attempt: number;
  /** Skill-relative paths the run actually read. Deduplicated within the run. */
  readonly filesRead: readonly string[];
  /** Whether the body reached context at all. A run where it did not measures nothing. */
  readonly skillLoaded: boolean;
  /** Everything the `result` event's usage block reported, summed. */
  readonly contextTokens: number;
  readonly assertionsPassed: number;
  readonly assertionsTotal: number;
  /** Set when the harness could not complete the run; such runs are excluded from rates. */
  readonly error?: string;
}

/**
 * What the measurement says about one bundled file.
 *
 * `pullRate` is over runs where the skill actually loaded, not over all runs. A run
 * that never opened SKILL.md never had the chance to follow a pointer, so counting it in
 * the denominator would report a low pull rate for a reference that is in fact pulled
 * every time the skill is used -- and the decision rule would then inline exactly the
 * wrong thing.
 */
export interface FileStat extends BundledFile {
  readonly pulls: number;
  readonly countedRuns: number;
  readonly pullRate: number;
  readonly verdict: FileVerdict;
}

/**
 * What the pull rate says to do about a file.
 *
 * - `inline` -- pulled on nearly every run, so it is body content that pays an extra
 *   tool call for the privilege of arriving late.
 * - `prune` -- pulled on no run although the body points straight at it. The pointer
 *   works and nothing needs the file; deleting it is a hypothesis the loop can test.
 * - `signpost` -- pulled on no run and nothing in the body names it, so it could never
 *   have loaded. The pull rate says nothing about its value yet.
 * - `misfiled` -- an `execute`- or `copy`-mode file that was read. Scripts are called and
 *   assets are copied; a read means either the body asks for the wrong verb or the file
 *   sits in the wrong directory.
 * - `keep` -- genuinely conditional content, which is what deferral is for.
 */
export type FileVerdict = "inline" | "prune" | "signpost" | "misfiled" | "keep";

export interface VerdictInput {
  readonly pulls: number;
  readonly pullRate: number;
  readonly countedRuns: number;
  readonly signposted: boolean;
  readonly loadMode: LoadMode;
}

/**
 * How often a reference has to be pulled before it stops being deferred content.
 *
 * A judgement rather than a measured threshold. At 0.8 a reference has to be needed by
 * four runs in five before inlining it is proposed, which keeps genuinely conditional
 * content deferred while catching the reference that is really just the second half of
 * the body. Lower it and the loop starts inlining branch-specific detail into every
 * invocation; raise it and a reference pulled on nine runs in ten stays behind a tool
 * call it never avoids.
 */
export const DEFAULT_INLINE_THRESHOLD = 0.8;

/**
 * The decision rule, as a function of the pull rate and the load mode.
 *
 * Load mode is checked first and it is not a formality. A `scripts/` file has a pull
 * rate of zero when everything is working -- its text is never supposed to enter context
 * -- so running the read-mode rule over it would propose deleting the skill's own
 * tooling. The same applies to `assets/`, which is copied rather than read.
 */
export function decideFileVerdict(input: VerdictInput, inlineThreshold: number): FileVerdict {
  if (!READ_MODES.has(input.loadMode)) {
    return input.pulls > 0 ? "misfiled" : "keep";
  }
  // Nothing was measured, so nothing is concluded. This is the state a run set with no
  // successful runs leaves every file in, and inventing verdicts from it would be the
  // most expensive kind of wrong: a restructure justified by no evidence at all.
  if (input.countedRuns === 0) return "keep";
  if (input.pullRate >= inlineThreshold) return "inline";
  if (input.pullRate === 0) return input.signposted ? "prune" : "signpost";
  return "keep";
}

/**
 * Per-file pull rates and verdicts, over the runs that actually loaded the skill.
 *
 * Runs that errored are dropped rather than scored as "did not read it": a timed-out run
 * says nothing about whether its scenario needed the reference, and treating silence as
 * evidence of absence would push the loop toward deleting files whose only crime was
 * being needed by a slow scenario.
 */
export function computeFileStats(
  inventory: readonly BundledFile[],
  runs: readonly ScenarioRun[],
  inlineThreshold: number = DEFAULT_INLINE_THRESHOLD,
): readonly FileStat[] {
  const counted = runs.filter((run) => run.error === undefined && run.skillLoaded);
  const pullsByPath = new Map<string, number>();
  for (const run of counted) {
    for (const path of new Set(run.filesRead)) {
      pullsByPath.set(path, (pullsByPath.get(path) ?? 0) + 1);
    }
  }

  return inventory.map((file) => {
    const pulls = pullsByPath.get(file.path) ?? 0;
    const pullRate = counted.length === 0 ? 0 : pulls / counted.length;
    return {
      ...file,
      pulls,
      countedRuns: counted.length,
      pullRate,
      verdict: decideFileVerdict(
        {
          pulls,
          pullRate,
          countedRuns: counted.length,
          signposted: file.signposted,
          loadMode: file.loadMode,
        },
        inlineThreshold,
      ),
    };
  });
}

// ---------------------------------------------------------------------------
// Scoring a layout
// ---------------------------------------------------------------------------

/** One split's summary of a layout: what it cost and whether the work still happened. */
export interface SplitScore {
  readonly scenarios: number;
  /** Runs that produced a measurement. Errored runs are excluded. */
  readonly runs: number;
  readonly assertionsPassed: number;
  readonly assertionsTotal: number;
  /** Assertions passed over assertions checked. 1 when a scenario set carries none. */
  readonly passRate: number;
  readonly meanContextTokens: number;
  /** How many runs never loaded the skill, which is a health signal rather than a score. */
  readonly runsWithoutSkill: number;
}

/**
 * Summarize a set of runs.
 *
 * A scenario set with no expectations produces `passRate: 1`, and that is a trap worth
 * naming out loud rather than hiding in a default: with nothing asserted the guardrail
 * cannot fire, so the loop is free to strip the skill to nothing and call it an
 * improvement. The caller warns when `assertionsTotal` is zero.
 */
export function scoreRuns(runs: readonly ScenarioRun[]): SplitScore {
  const measured = runs.filter((run) => run.error === undefined);
  const assertionsPassed = measured.reduce((total, run) => total + run.assertionsPassed, 0);
  const assertionsTotal = measured.reduce((total, run) => total + run.assertionsTotal, 0);
  const contextTokens = measured.reduce((total, run) => total + run.contextTokens, 0);
  return {
    scenarios: new Set(runs.map((run) => run.scenarioId)).size,
    runs: measured.length,
    assertionsPassed,
    assertionsTotal,
    passRate: assertionsTotal === 0 ? 1 : assertionsPassed / assertionsTotal,
    meanContextTokens: measured.length === 0 ? 0 : contextTokens / measured.length,
    runsWithoutSkill: measured.filter((run) => !run.skillLoaded).length,
  };
}

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

export type DisclosureEdit =
  | { readonly kind: "inline"; readonly path: string }
  | { readonly kind: "prune"; readonly path: string }
  | { readonly kind: "extract"; readonly heading: string; readonly toPath: string };

export interface DisclosureCandidate {
  /** Stable across iterations, so a candidate already tried is not proposed again. */
  readonly id: string;
  /** One line, for the report's row. */
  readonly summary: string;
  /** Why the measurement suggests it. Shown beside the result so a rejection is legible. */
  readonly rationale: string;
  readonly edits: readonly DisclosureEdit[];
}

/** A body section the proposal step suggested moving out, before it becomes a candidate. */
export interface ProposedExtraction {
  readonly heading: string;
  readonly reason: string;
}

/**
 * Read the proposal step's answer into extractions the loop can act on.
 *
 * Every heading is checked against the sections that actually exist. A model asked which
 * parts of a body are minority-use will occasionally answer with a heading it
 * paraphrased or invented, and an extraction naming a section that is not there would
 * silently no-op -- a candidate that changes nothing, measures the same as the baseline,
 * and looks like evidence that restructuring does not help.
 *
 * Unknown headings are dropped rather than throwing. The proposal step is an optional
 * source of candidates; one bad row should cost that row, not the iteration.
 */
export function parseExtractionProposal(
  text: string,
  sections: readonly BodySection[],
): readonly ProposedExtraction[] {
  const known = new Set(sections.map((section) => section.heading));
  const rows = extractJsonArray(text);
  if (rows === null) return [];
  const proposals: ProposedExtraction[] = [];
  const seen = new Set<string>();
  for (const raw of rows) {
    const row = asRecord(raw);
    const heading = typeof row["heading"] === "string" ? row["heading"].trim() : "";
    if (!known.has(heading) || seen.has(heading)) continue;
    seen.add(heading);
    proposals.push({
      heading,
      reason: typeof row["reason"] === "string" ? row["reason"] : "proposed by the analysis step",
    });
  }
  return proposals;
}

/** Turn a heading into a reference filename, avoiding collisions with what already exists. */
export function referencePathFor(heading: string, taken: ReadonlySet<string>): string {
  const slug =
    heading
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "section";
  let path = `references/${slug}.md`;
  let suffix = 2;
  while (taken.has(path)) {
    path = `references/${slug}-${suffix}.md`;
    suffix += 1;
  }
  return path;
}

export interface CandidateInput {
  readonly files: readonly FileStat[];
  readonly sections: readonly BodySection[];
  /** Extractions the proposal step suggested. Empty when it was skipped or failed. */
  readonly extractions: readonly ProposedExtraction[];
  readonly maxCandidates: number;
  /** Ids already measured in an earlier iteration, so the loop does not re-run them. */
  readonly alreadyTried: ReadonlySet<string>;
}

/**
 * Propose restructures from what the measurement showed.
 *
 * Ordered by how much unconditional cost each one could remove, because that is the
 * objective: extractions first (they cut the bill every invocation pays), then inlines
 * (they remove a round trip and usually a little cost), then prunes (they remove weight
 * without removing tokens, so they can only win when nothing else does).
 *
 * A `signpost` verdict deliberately produces NO candidate. The fix for a file nothing
 * points at is a sentence in the body saying what is in there and when to read it, and
 * where that sentence goes is an editorial decision the measurement cannot make -- a
 * pointer bolted onto the end of the body would measure the wrong thing and then get
 * rejected for costing tokens. It is reported as a finding instead, which is the
 * different fix the two cases need.
 */
export function generateCandidates(input: CandidateInput): readonly DisclosureCandidate[] {
  const candidates: DisclosureCandidate[] = [];
  const taken = new Set(input.files.map((file) => file.path));
  const sectionByHeading = new Map(input.sections.map((section) => [section.heading, section]));

  for (const extraction of input.extractions) {
    const section = sectionByHeading.get(extraction.heading);
    if (section === undefined) continue;
    const toPath = referencePathFor(section.heading, taken);
    taken.add(toPath);
    candidates.push({
      id: `extract:${section.heading}`,
      summary: `Move "${section.heading}" (${section.tokens} tokens) into ${toPath}`,
      rationale: extraction.reason,
      edits: [{ kind: "extract", heading: section.heading, toPath }],
    });
  }

  const inlinable = input.files.filter((file) => file.verdict === "inline");
  for (const file of inlinable) {
    candidates.push({
      id: `inline:${file.path}`,
      summary: `Inline ${file.path} (${file.tokens} tokens) into the body`,
      rationale:
        `Pulled on ${file.pulls} of ${file.countedRuns} runs, so it is body content ` +
        `paying an extra tool call to arrive late.`,
      edits: [{ kind: "inline", path: file.path }],
    });
  }
  // Inlining two references separately and inlining both together are different layouts
  // with different costs, and the second is not implied by the first two -- the body may
  // fit one but not both. Offered once, only when there is more than one.
  if (inlinable.length > 1) {
    candidates.push({
      id: `inline-all:${inlinable.map((file) => file.path).join(",")}`,
      summary: `Inline all ${inlinable.length} near-always-pulled references`,
      rationale: `Each is pulled on at least ${Math.round(
        Math.min(...inlinable.map((file) => file.pullRate)) * 100,
      )}% of runs.`,
      edits: inlinable.map((file) => ({ kind: "inline", path: file.path }) as const),
    });
  }

  for (const file of input.files.filter((entry) => entry.verdict === "prune")) {
    candidates.push({
      id: `prune:${file.path}`,
      summary: `Delete ${file.path} (${file.tokens} tokens, never read)`,
      rationale:
        `The body points at it and no run followed the pointer across ` +
        `${file.countedRuns} runs. If deleting it does not move the pass rate, it was ` +
        `carrying nothing.`,
      edits: [{ kind: "prune", path: file.path }],
    });
  }

  return candidates
    .filter((candidate) => !input.alreadyTried.has(candidate.id))
    .slice(0, Math.max(0, input.maxCandidates));
}

// ---------------------------------------------------------------------------
// Applying a candidate
// ---------------------------------------------------------------------------

export interface LayoutEdit {
  /** The rewritten SKILL.md, frontmatter included. */
  readonly skillMd: string;
  /** Bundled files to create or overwrite, keyed by skill-relative path. */
  readonly writes: ReadonlyMap<string, string>;
  readonly deletes: readonly string[];
  /** Anything the rewrite did that an author would want to know about. */
  readonly notes: readonly string[];
}

/** Strip a leading `# Title` so splicing a reference into a body does not nest an H1. */
function withoutLeadingH1(text: string): string {
  const lines = text.split("\n");
  const first = lines.findIndex((line) => line.trim() !== "");
  if (first === -1) return text;
  if (!/^#\s+\S/.test(lines[first] as string)) return text;
  return lines
    .slice(first + 1)
    .join("\n")
    .replace(/^\n+/, "");
}

/**
 * The first sentence of a section's prose, for the pointer left behind by an extraction.
 *
 * The whole first PARAGRAPH is joined before the sentence is cut out of it. Working line
 * by line looked equivalent and was not: markdown prose is hard-wrapped, so the first
 * line of a paragraph is usually half a sentence, and the pointer came out reading
 * "...which is a" with the rest of the clause in the file that just moved away.
 */
function leadSentence(sectionBody: string): string {
  const lines = sectionBody.split("\n");
  const start = lines.findIndex(
    (line) => line.trim() !== "" && !line.trim().startsWith("#") && !line.trim().startsWith("```"),
  );
  if (start === -1) return "";
  const collected: string[] = [];
  for (let index = start; index < lines.length; index += 1) {
    const line = (lines[index] as string).trim();
    if (line === "") break;
    collected.push(line);
  }
  const paragraph = collected.join(" ");
  const sentence = /^(.*?[.!?])(\s|$)/.exec(paragraph)?.[1] ?? paragraph;
  return sentence.length > 200 ? `${sentence.slice(0, 197)}...` : sentence;
}

/**
 * The paragraph a line belongs to: the run of non-blank lines around it.
 *
 * Every removal and replacement below works at this granularity rather than on single
 * lines, for the reason `leadSentence` does. A pointer sentence is routinely wrapped
 * across two lines, and deleting only the line that happens to hold the path leaves the
 * other half of the sentence in the body, dangling mid-clause.
 */
function paragraphAround(lines: readonly string[], lineIndex: number): {
  readonly start: number;
  readonly end: number;
} {
  let start = lineIndex;
  while (start > 0 && (lines[start - 1] ?? "").trim() !== "") start -= 1;
  let end = lineIndex + 1;
  while (end < lines.length && (lines[end] ?? "").trim() !== "") end += 1;
  return { start, end };
}

/** Skill-relative paths a chunk of prose points at, whatever form they are written in. */
const BUNDLED_PATH = /(?:references|examples|scripts|assets)\/[A-Za-z0-9._-]+/g;

function otherBundledPaths(text: string, exclude: string): readonly string[] {
  return [...new Set(text.match(BUNDLED_PATH) ?? [])].filter((path) => path !== exclude);
}

/**
 * Remove the paragraph holding a pointer, unless it points at something else as well.
 *
 * The exception is the important half. A sentence like "the everyday rules are in
 * `references/a.md`, and the historical notes are in `references/b.md`" points at two
 * files, and deleting the paragraph to get rid of one silently takes the pointer to the
 * other with it. That loss is invisible: the surviving file simply stops being read, and
 * the next iteration reports it as under-signposted with no trace of why.
 *
 * A dangling reference is the lesser evil, because it is loud -- `validate-skill.ts` and
 * the skill-reviewer agent both flag one -- so in that case the paragraph is left alone
 * and a note says the sentence needs rewriting by hand.
 */
function dropPointerParagraphs(
  lines: readonly string[],
  path: string,
  notes: string[],
  from = 0,
): readonly string[] {
  let working = [...lines];
  let cursor = from;
  for (;;) {
    const found = working.findIndex((line, index) => index >= cursor && bodyPointsAt(line, path));
    if (found === -1) return working;
    const { start, end } = paragraphAround(working, found);
    const paragraph = working.slice(start, end).join(" ");
    const others = otherBundledPaths(paragraph, path);
    if (others.length > 0) {
      notes.push(
        `The sentence pointing at ${path} also points at ${others.join(", ")}, so it was left ` +
          `in place rather than deleted along with them. It now names a file that is gone — ` +
          `rewrite it before adopting this layout.`,
      );
      cursor = end;
      continue;
    }
    // One adjoining blank line goes too, so removing a paragraph does not leave a double
    // gap where it was. Trailing for preference, since that is the separator it owned.
    let cut = end;
    let head = start;
    if (cut < working.length && (working[cut] ?? "").trim() === "") cut += 1;
    else if (head > 0 && (working[head - 1] ?? "").trim() === "") head -= 1;
    working = [...working.slice(0, head), ...working.slice(cut)];
    cursor = head;
  }
}

/**
 * Rewrite a layout, as data.
 *
 * Takes the SKILL.md text and the contents of any file an edit needs, and returns what
 * to write and what to delete. No filesystem, so the whole transformation is drivable
 * from fixtures -- which matters more here than anywhere else in this module, because a
 * rewrite that silently mangles a body would show up as a pass-rate regression the loop
 * blames on the restructure rather than on the rewriter.
 *
 * Edits are applied in a fixed order -- extract, then inline, then prune -- so a
 * candidate carrying several is deterministic regardless of how they were listed.
 */
export function applyEdits(params: {
  readonly skillMd: string;
  readonly fileContents: ReadonlyMap<string, string>;
  readonly edits: readonly DisclosureEdit[];
}): LayoutEdit {
  const { frontmatter, body: originalBody } = splitSkillMd(params.skillMd);
  let body = originalBody;
  const writes = new Map<string, string>();
  const deletes: string[] = [];
  const notes: string[] = [];

  const ordered = [
    ...params.edits.filter((edit) => edit.kind === "extract"),
    ...params.edits.filter((edit) => edit.kind === "inline"),
    ...params.edits.filter((edit) => edit.kind === "prune"),
  ];

  for (const edit of ordered) {
    if (edit.kind === "extract") {
      // Re-segmented on every edit rather than once up front: an earlier extraction has
      // already changed the line numbering, and a stale offset would cut the next
      // section in the wrong place.
      const sections = bodySections(body, estimatingCounter());
      const section = sections.find((entry) => entry.heading === edit.heading);
      if (section === undefined) {
        notes.push(`Skipped extract "${edit.heading}": no section with that heading.`);
        continue;
      }
      const lines = body.split("\n");
      const headingLine = lines[section.startLine] as string;
      const sectionBody = lines.slice(section.startLine + 1, section.endLine).join("\n");
      writes.set(edit.toPath, `# ${section.heading}\n\n${sectionBody.trim()}\n`);

      const lead = leadSentence(sectionBody);
      // The heading stays. What is left behind is a signpost saying what moved and when
      // it is worth reading -- which is the shape `../../references/progressive-disclosure.md`
      // asks for, and it is also what keeps the extracted file discoverable at all.
      const pointer = [
        headingLine,
        "",
        ...(lead === "" ? [] : [lead, ""]),
        `\`${edit.toPath}\` carries the detail — read it when this part of the workflow applies.`,
        "",
      ].join("\n");
      body = [...lines.slice(0, section.startLine), pointer, ...lines.slice(section.endLine)].join(
        "\n",
      );
      continue;
    }

    if (edit.kind === "inline") {
      const content = params.fileContents.get(edit.path);
      if (content === undefined) {
        notes.push(`Skipped inline ${edit.path}: its content was not supplied.`);
        continue;
      }
      const spliced = withoutLeadingH1(content).trim();
      const lines = body.split("\n");
      const pointerIndex = lines.findIndex((line) => bodyPointsAt(line, edit.path));
      if (pointerIndex === -1) {
        // Nothing pointed at it, yet it was read on nearly every run -- so the model found
        // it another way. Appending keeps the content rather than dropping it, and the
        // note says the placement wants a human.
        body = `${body.replace(/\s+$/, "")}\n\n${spliced}\n`;
        notes.push(
          `Inlined ${edit.path} at the end of the body: nothing in the body pointed at it, ` +
            `so there was no pointer line to replace.`,
        );
      } else {
        const { start, end } = paragraphAround(lines, pointerIndex);
        const others = otherBundledPaths(lines.slice(start, end).join(" "), edit.path);
        const replaced =
          others.length > 0
            ? // The sentence names other files too, so it survives and the content lands
              // after it. Not tidy, and said so in the note -- but a pointer to a file that
              // is still there is worth more than a clean paragraph.
              [...lines.slice(start, end), "", spliced]
            : [spliced];
        if (others.length > 0) {
          notes.push(
            `Inlined ${edit.path} after the sentence that pointed at it, because that ` +
              `sentence also points at ${others.join(", ")}. The sentence now names a file ` +
              `that is gone — rewrite it before adopting this layout.`,
          );
        }
        const rest = dropPointerParagraphs(lines.slice(end), edit.path, notes);
        body = [...lines.slice(0, start), ...replaced, ...rest].join("\n");
      }
      deletes.push(edit.path);
      continue;
    }

    const pruned = dropPointerParagraphs(body.split("\n"), edit.path, notes).join("\n");
    // Only claimed when it happened. A paragraph that also pointed at another file is
    // left in place by `dropPointerParagraphs`, and a note saying the prose was removed
    // when it was not is worse than no note -- it is the one an author would trust.
    if (pruned !== body) {
      notes.push(`Deleted ${edit.path} and removed the prose that pointed at it.`);
    }
    body = pruned;
    deletes.push(edit.path);
  }

  return { skillMd: `${frontmatter}${body}`, writes, deletes, notes };
}

// ---------------------------------------------------------------------------
// Held-out selection
// ---------------------------------------------------------------------------

export interface ScoredCandidate {
  readonly candidate: DisclosureCandidate;
  readonly bodyTokens: number;
  readonly train: SplitScore;
  /**
   * The split selection reads. Null when the run was configured with no holdout, and
   * ALSO null for a candidate `trainGate` retired before its held-out runs were spent --
   * so a caller must not hand this function a gated candidate, since `holdout ?? train`
   * below would then quietly select one on the split that already rejected it.
   */
  readonly holdout: SplitScore | null;
}

export interface SelectionResult {
  readonly chosen: ScoredCandidate | null;
  readonly reason: string;
  readonly rejected: readonly { readonly id: string; readonly reason: string }[];
}

/**
 * How far the pass rate may fall before a restructure counts as breaking the work.
 *
 * A judgement, and a deliberately tight one. These runs check on the order of twenty
 * assertions, so 0.05 absorbs roughly one assertion flipping -- the sampling noise you
 * get from re-running the same layout twice -- and refuses a candidate that drops two.
 * Widen it and the loop will happily trade the skill's behaviour for tokens, which is
 * the failure mode the guardrail exists to prevent.
 */
export const DEFAULT_PASS_RATE_TOLERANCE = 0.05;

/** Whether a candidate has earned the cost of being measured on the held-out split. */
export interface TrainGateVerdict {
  readonly inContention: boolean;
  /** Why, in the same voice as a `selectCandidate` rejection, so the report reads uniformly. */
  readonly reason: string;
}

/**
 * Decide, from the train split alone, whether a candidate is still worth held-out runs.
 *
 * The optimizer used to measure every candidate on BOTH splits and only then partition,
 * so a layout that had already lost on train had its held-out runs in flight before
 * anything looked at the train numbers. At the default `--holdout 0.4` that is two of
 * every five runs spent on candidates that were never going to be selected -- and these
 * are runs that do the skill's real work, minutes each.
 *
 * The two gates are `selectCandidate`'s own, applied one split earlier and against the
 * INCUMBENT's train score rather than against a held-out baseline:
 *
 * 1. The guardrail. A candidate whose train pass rate falls more than `tolerance` below
 *    the incumbent's has broken something, and no held-out result would rescue it.
 * 2. Cost. A candidate that costs more context than the incumbent on train is not an
 *    optimization. Body tokens are paid on every run of both splits, so a restructure
 *    that fails to cut cost on train has essentially no route to cutting it on holdout.
 *
 * Be clear about what this is: a FILTER, not a reformulation of the selection rule.
 * Selection still happens on the held-out split and is unchanged for everything that
 * reaches it. What changes is that a candidate which regresses on train can no longer be
 * selected on the strength of a held-out result nobody paid for. That case is not a
 * missed opportunity worth two fifths of the budget -- a layout that costs more or breaks
 * more on the scenarios it was proposed from, and then reverses on a smaller split, is
 * describing sampling noise rather than a better layout.
 *
 * The gate is deliberately not applied when there is no held-out split. With
 * `--holdout 0` the train score IS the selection score, so there is nothing to save by
 * refusing to measure it and a candidate filtered here would simply vanish.
 */
export function trainGate(params: {
  readonly candidate: SplitScore;
  readonly incumbent: SplitScore;
  readonly passRateTolerance?: number;
}): TrainGateVerdict {
  const tolerance = params.passRateTolerance ?? DEFAULT_PASS_RATE_TOLERANCE;
  const floor = params.incumbent.passRate - tolerance;
  const percent = (value: number): string => `${(value * 100).toFixed(0)}%`;

  if (params.candidate.passRate < floor) {
    return {
      inContention: false,
      reason:
        `train pass rate ${percent(params.candidate.passRate)} is below the ${percent(floor)} ` +
        `floor (incumbent ${percent(params.incumbent.passRate)}, tolerance ` +
        `${(tolerance * 100).toFixed(0)} points), so the held-out runs were not spent`,
    };
  }
  if (params.candidate.meanContextTokens > params.incumbent.meanContextTokens) {
    return {
      inContention: false,
      reason:
        `train context cost rose from ${Math.round(params.incumbent.meanContextTokens)} to ` +
        `${Math.round(params.candidate.meanContextTokens)} tokens per run, so the held-out ` +
        `runs were not spent`,
    };
  }
  return {
    inContention: true,
    reason:
      `train context cost ${Math.round(params.candidate.meanContextTokens)} tokens per run ` +
      `against the incumbent's ${Math.round(params.incumbent.meanContextTokens)}, pass rate ` +
      `${percent(params.candidate.passRate)} — measured on the held-out split`,
  };
}

/**
 * Pick the winning candidate on the held-out split.
 *
 * Held-out and not train, for the reason the description loop uses the same split: a
 * layout tuned until it aces the scenarios that motivated it has usually just memorized
 * them. The restructures are proposed from what the train split showed, so scoring them
 * there too would be marking your own homework -- an extraction proposed because no
 * train scenario needed that section will always look free on the train scenarios.
 *
 * Three gates, in order:
 *
 * 1. The guardrail. A candidate whose held-out pass rate falls more than `tolerance`
 *    below the baseline is rejected outright, however cheap it is.
 * 2. Cost. A candidate that costs more context than the baseline is not an optimization,
 *    whatever else it improved.
 * 3. Among what survives, the cheapest wins; ties break toward the higher pass rate, then
 *    the smaller body, then the earlier proposal -- so the result does not depend on map
 *    iteration order.
 */
export function selectCandidate(params: {
  readonly baseline: SplitScore;
  readonly baselineBodyTokens: number;
  readonly candidates: readonly ScoredCandidate[];
  readonly passRateTolerance?: number;
}): SelectionResult {
  const tolerance = params.passRateTolerance ?? DEFAULT_PASS_RATE_TOLERANCE;
  const rejected: { id: string; reason: string }[] = [];
  const survivors: ScoredCandidate[] = [];

  for (const scored of params.candidates) {
    // With no holdout configured the train score is the only score there is. Saying so
    // here keeps the caller from having to fabricate a second split to satisfy the type.
    const score = scored.holdout ?? scored.train;
    const floor = params.baseline.passRate - tolerance;
    if (score.passRate < floor) {
      rejected.push({
        id: scored.candidate.id,
        reason:
          `pass rate ${(score.passRate * 100).toFixed(0)}% is below the ` +
          `${(floor * 100).toFixed(0)}% floor (baseline ${(params.baseline.passRate * 100).toFixed(0)}%, ` +
          `tolerance ${(tolerance * 100).toFixed(0)} points)`,
      });
      continue;
    }
    if (score.meanContextTokens > params.baseline.meanContextTokens) {
      rejected.push({
        id: scored.candidate.id,
        reason:
          `context cost rose from ${Math.round(params.baseline.meanContextTokens)} to ` +
          `${Math.round(score.meanContextTokens)} tokens per run`,
      });
      continue;
    }
    survivors.push(scored);
  }

  if (survivors.length === 0) {
    return {
      chosen: null,
      reason:
        params.candidates.length === 0
          ? "no candidate was proposed"
          : "no candidate cut context cost on the held-out split without regressing the work",
      rejected,
    };
  }

  let best = survivors[0] as ScoredCandidate;
  for (const scored of survivors.slice(1)) {
    const a = scored.holdout ?? scored.train;
    const b = best.holdout ?? best.train;
    if (a.meanContextTokens < b.meanContextTokens) {
      best = scored;
    } else if (a.meanContextTokens === b.meanContextTokens) {
      if (a.passRate > b.passRate) best = scored;
      else if (a.passRate === b.passRate && scored.bodyTokens < best.bodyTokens) best = scored;
    }
  }

  const bestScore = best.holdout ?? best.train;
  const saved = params.baseline.meanContextTokens - bestScore.meanContextTokens;
  const bodySaved = params.baselineBodyTokens - best.bodyTokens;
  return {
    chosen: best,
    reason:
      `selected on the held-out split: ${Math.round(saved)} fewer context tokens per run, ` +
      `${bodySaved >= 0 ? `${bodySaved} fewer` : `${-bodySaved} more`} body tokens, ` +
      `pass rate ${(bestScore.passRate * 100).toFixed(0)}% against a baseline of ` +
      `${(params.baseline.passRate * 100).toFixed(0)}%`,
    rejected,
  };
}

// ---------------------------------------------------------------------------
// Scenarios and the split
// ---------------------------------------------------------------------------

/**
 * One task the skill is measured doing.
 *
 * Deliberately the same shape as `evals.json` -- `{id, prompt, expectations}` -- so a
 * skill that already has an eval set needs no second file. The extra fields that file
 * carries (`expected_output`, `files`) are ignored here rather than rejected.
 */
export interface DisclosureScenario {
  readonly id: string;
  readonly prompt: string;
  readonly expectations: readonly string[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Read a scenario set from `evals.json` or from a bare array of the same rows.
 *
 * Validated at the boundary rather than deep in the pool, for the reason
 * `parseEvalSet` is: a malformed row discovered thirty `claude` calls in has already
 * cost the run.
 *
 * `../schemas/scenario-set.ts` owns what counts as wrong, and reports every problem at
 * once. It exists for one finding above all: a row whose `expectations` key is
 * MISSPELLED used to default to `[]` in silence, so a set with every expectation
 * misspelled measured the skill against nothing while `optimize-disclosure.ts` was
 * warning about exactly that state. An empty `expectations` is still legal; a typo that
 * produced one is now named.
 *
 * Unknown keys are warnings, never errors -- `expected_output` and `files` are
 * documented fields this reader ignores, and every scenario set in the repository
 * carries them. The narrowing below is what the compiler needs, not a second check.
 */
export function parseScenarioSet(raw: unknown, source: string): readonly DisclosureScenario[] {
  const { errors, warnings } = scenarioSetFindings(raw, source);
  for (const warning of warnings) console.error(`Warning: ${warning}`);
  if (errors.length > 0) throw new TypeError(errors.join("\n"));

  const rows: unknown[] = Array.isArray(raw)
    ? raw
    : Array.isArray(asRecord(raw)["evals"])
      ? (asRecord(raw)["evals"] as unknown[])
      : [];
  if (rows.length === 0) {
    throw new TypeError(
      `${source}: expected a JSON array of scenarios, or an object with a non-empty "evals" array`,
    );
  }

  return rows.map((entry, index) => {
    const row = asRecord(entry);
    const prompt = row["prompt"];
    if (typeof prompt !== "string" || prompt.trim() === "") {
      throw new TypeError(`${source}: scenario ${index} has no non-empty string "prompt"`);
    }
    const rawId = row["id"] ?? row["eval_id"] ?? row["eval_name"];
    const expectations = row["expectations"] ?? row["assertions"];
    return {
      id: rawId === undefined ? `scenario-${index + 1}` : String(rawId),
      prompt,
      expectations: Array.isArray(expectations)
        ? expectations.filter((item): item is string => typeof item === "string")
        : [],
    };
  });
}

/**
 * Split scenarios into train and held-out.
 *
 * The same shuffle-then-slice as `splitEvalSet`, on the same seeded CPython RNG so two
 * runs of the same set agree, minus the stratification -- a scenario has no polarity to
 * stratify on. The `max(1, ...)` floor is kept for the same reason it exists there: a
 * holdout that rounds to zero silently turns held-out selection back into train
 * selection, which is the failure this whole split exists to prevent.
 */
export function splitScenarios(
  scenarios: readonly DisclosureScenario[],
  holdout: number,
  seed = 42,
): readonly [DisclosureScenario[], DisclosureScenario[]] {
  if (holdout <= 0 || scenarios.length < 2) return [[...scenarios], []];
  const shuffled = [...scenarios];
  new PythonRandom(seed).shuffle(shuffled);
  const testCount = Math.min(scenarios.length - 1, Math.max(1, Math.trunc(scenarios.length * holdout)));
  return [shuffled.slice(testCount), shuffled.slice(0, testCount)];
}

// ---------------------------------------------------------------------------
// Reading the stream
// ---------------------------------------------------------------------------

/**
 * The usage fields that add up to what a run cost.
 *
 * An explicit list rather than "every key ending in `_tokens`", because `usage` also
 * carries `cache_creation`, whose `ephemeral_5m_input_tokens` and
 * `ephemeral_1h_input_tokens` are a BREAKDOWN of `cache_creation_input_tokens` -- summing
 * everything would count the cached prefix twice and inflate the very number this loop
 * is trying to reduce.
 */
const USAGE_FIELDS = [
  "input_tokens",
  "cache_creation_input_tokens",
  "cache_read_input_tokens",
  "output_tokens",
] as const;

export function sumUsage(usage: unknown): number {
  const record = asRecord(usage);
  let total = 0;
  for (const field of USAGE_FIELDS) {
    const value = record[field];
    if (typeof value === "number" && Number.isFinite(value)) total += value;
  }
  return total;
}

/** What one run's stream told us. */
export interface RunObservation {
  readonly filesRead: readonly string[];
  readonly skillLoaded: boolean;
  readonly contextTokens: number;
  /** Tool names in call order, for the grader's trace and for diagnosing a stuck run. */
  readonly toolCalls: readonly string[];
  /**
   * Paths the run wrote, outside the skill itself.
   *
   * Collected so the guardrail can be graded on what the run PRODUCED rather than only on
   * what it said it produced. A run that reports "I wrote the CSV" and wrote nothing
   * passes a transcript-only grader and fails a real one.
   */
  readonly filesWritten: readonly string[];
  /** The final assistant text from the `result` event, which the grader reads. */
  readonly finalText: string;
  /** `success`, `error_max_turns`, and so on. Empty when no result event arrived. */
  readonly resultSubtype: string;
}

/**
 * Build the line handler that watches one run for disclosure signals.
 *
 * A factory returning a handler plus an accessor, mirroring `createTriggerReader`'s
 * shape and for the same reason: the rule that decides what counts as a pull is the part
 * most worth driving from synthetic event lines rather than only by spawning `claude`.
 *
 * The handler NEVER returns a value, so `runStreamingLines` reads to exhaustion. That is
 * the opposite of the trigger harness, which short-circuits the moment it can decide --
 * here the interesting events (`result`, and every `Read` after the first) arrive at the
 * end, so an early return would throw away the measurement.
 *
 * Only complete `assistant` events are parsed. The trigger harness needs
 * `--include-partial-messages` because it wants a verdict before a tool executes;
 * reading to the end makes that unnecessary, and the complete event carries the whole
 * `input` object rather than a string of JSON fragments to reassemble.
 */
export function createRunCollector(params: {
  /** Absolute path of the installed skill directory. Reads inside it are pulls. */
  readonly skillDir: string;
  /** The run's working directory, for resolving a relative `file_path`. */
  readonly projectRoot: string;
}): {
  readonly onLine: (line: string) => undefined;
  readonly observation: () => RunObservation;
} {
  const skillDir = resolve(params.skillDir);
  const filesRead: string[] = [];
  const filesWritten: string[] = [];
  const toolCalls: string[] = [];
  let skillLoaded = false;
  let contextTokens = 0;
  let finalText = "";
  let resultSubtype = "";

  /** A path inside the skill, relative to it -- or null when it is somewhere else. */
  const insideSkill = (filePath: string): string | null => {
    if (filePath === "") return null;
    const absolute = filePath.startsWith("/")
      ? resolve(filePath)
      : resolve(params.projectRoot, filePath);
    const rel = relative(skillDir, absolute);
    if (rel === "" || rel.startsWith("..") || rel.startsWith("/")) return null;
    return rel.split("\\").join("/");
  };

  const record = (toolName: string, input: Record<string, unknown>): void => {
    toolCalls.push(toolName);
    const filePath = typeof input["file_path"] === "string" ? input["file_path"] : "";
    if (toolName === "Skill") {
      // The Skill tool loading this skill is the body entering context. Matched on the
      // installed alias appearing anywhere in the argument, because the field name has
      // varied between `skill` and `name` across versions.
      const argument = JSON.stringify(input);
      if (argument.includes(skillDir.split("/").pop() ?? "")) skillLoaded = true;
      return;
    }
    if (toolName === "Write" || toolName === "Edit" || toolName === "NotebookEdit") {
      // Recorded only when it lands OUTSIDE the skill: a run editing the skill under test
      // is doing something to the artifact rather than producing the deliverable, and
      // handing that to the grader as output would be misleading.
      if (filePath !== "" && insideSkill(filePath) === null) filesWritten.push(filePath);
      return;
    }
    if (toolName !== "Read") return;
    const rel = insideSkill(filePath);
    if (rel === null) return;
    // Reading SKILL.md IS the body loading -- some runs reach the skill that way rather
    // than through the Skill tool -- so it counts as loaded and not as a pull. Counting
    // it as a pull would give the body a pull rate and put it in the file table.
    if (rel === "SKILL.md") {
      skillLoaded = true;
      return;
    }
    filesRead.push(rel);
  };

  return {
    onLine: (line: string): undefined => {
      let event: unknown;
      try {
        event = JSON.parse(line);
      } catch {
        return undefined;
      }
      const record_ = asRecord(event);

      if (record_["type"] === "assistant") {
        const content = asRecord(record_["message"])["content"];
        if (!Array.isArray(content)) return undefined;
        for (const raw of content) {
          const item = asRecord(raw);
          if (item["type"] !== "tool_use") continue;
          const name = typeof item["name"] === "string" ? item["name"] : "";
          record(name, asRecord(item["input"]));
        }
        return undefined;
      }

      if (record_["type"] === "result") {
        contextTokens = sumUsage(record_["usage"]);
        const text = record_["result"];
        if (typeof text === "string") finalText = text;
        const subtype = record_["subtype"];
        if (typeof subtype === "string") resultSubtype = subtype;
      }
      return undefined;
    },
    observation: (): RunObservation => ({
      filesRead: [...new Set(filesRead)],
      skillLoaded,
      contextTokens,
      toolCalls,
      filesWritten: [...new Set(filesWritten)],
      finalText,
      resultSubtype,
    }),
  };
}

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

export interface AssertionVerdict {
  readonly text: string;
  readonly passed: boolean;
  readonly evidence: string;
}

export interface Grading {
  readonly verdicts: readonly AssertionVerdict[];
  readonly passed: number;
  readonly total: number;
}

/**
 * Read the grader's answer.
 *
 * Field names are `text`, `passed` and `evidence`, matching `../../references/grader.md` and
 * `../../references/schemas.md` -- the repository already has one grading contract and a second
 * spelling of the same three fields would be a thing to keep in step forever.
 *
 * An expectation the grader did not return a verdict for is scored as a FAIL, not
 * skipped. A grader that answers three of four assertions has not shown the fourth
 * holds, and treating silence as a pass is how a restructure that broke something gets
 * waved through the guardrail.
 */
export function parseGrading(text: string, expectations: readonly string[]): Grading {
  const verdicts: AssertionVerdict[] = [];
  const byText = new Map<string, AssertionVerdict>();

  const json = extractJsonArray(text);
  if (json !== null) {
    for (const raw of json) {
      const row = asRecord(raw);
      const label = typeof row["text"] === "string" ? row["text"] : "";
      const passed = row["passed"] === true;
      const evidence = typeof row["evidence"] === "string" ? row["evidence"] : "";
      byText.set(label, { text: label, passed, evidence });
    }
  }

  for (const [index, expectation] of expectations.entries()) {
    const exact = byText.get(expectation);
    // Positional fallback, because a grader routinely paraphrases the assertion it was
    // handed. Exact text first so a reordered answer still lines up correctly, and only
    // for a row that actually exists -- a grader that returned three verdicts for four
    // assertions has not judged the fourth, and inventing an empty row for it would score
    // "no answer" identically to "answered, and it failed".
    const positional = json === null || index >= json.length ? undefined : asRecord(json[index]);
    const fallback: AssertionVerdict | undefined =
      positional === undefined
        ? undefined
        : { text: expectation, passed: positional["passed"] === true, evidence: typeof positional["evidence"] === "string" ? positional["evidence"] : "" };
    verdicts.push(
      exact ?? fallback ?? { text: expectation, passed: false, evidence: "no verdict returned" },
    );
  }

  return {
    verdicts,
    passed: verdicts.filter((verdict) => verdict.passed).length,
    total: verdicts.length,
  };
}

/**
 * Pull the first JSON array out of a model response.
 *
 * Models wrap JSON in prose and in fences however they feel, so this scans for the
 * outermost bracket pair rather than requiring the whole response to parse. Returns null
 * when there is nothing array-shaped, which the caller turns into an all-fail grading.
 */
function extractJsonArray(text: string): unknown[] | null {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
