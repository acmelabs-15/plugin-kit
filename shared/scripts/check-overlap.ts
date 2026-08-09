#!/usr/bin/env bun
/**
 * check-overlap -- find installed skills that will steal a target skill's triggers.
 *
 * WHY THIS EXISTS
 * ---------------
 * Description quality is not sufficient for triggering, because triggering is a
 * competition and the competitors are not under the author's control.
 *
 * The measurement: a well-formed, correctly-scoped description was co-installed
 * with a single neighbouring skill whose description used universal-quantifier
 * phrasing ("even if they don't...", "whenever the user mentions..."). The
 * well-formed skill then won 0 of its own 21 true positives -- the neighbour
 * absorbed every one. No rewrite of the well-formed description recovered them.
 * The failure is not in the description under review; it is in the pair. So it
 * cannot be detected, and cannot be fixed, by looking at one skill alone.
 * (Result measured on Sonnet only, n=9 runs. Treat the magnitude as indicative
 * and the direction as solid.)
 *
 * That is why the check runs across the whole installed set rather than over a
 * single SKILL.md, and why it is a separate script from the per-skill validator.
 *
 * THE HEURISTIC
 * -------------
 * Flag a neighbour when it BOTH:
 *
 *   1. shares domain vocabulary with the target -- otherwise it is not competing
 *      for the same queries at all; and
 *   2. uses universal-quantifier pushy phrasing.
 *
 * Neither half stands alone. Pushy phrasing measured 90.5% true-positive against
 * 44.4% false-positive: effective enough that it reliably wins the contested
 * query, imprecise enough that it should not have. Shared vocabulary alone would
 * flag every skill in a domain, most of which coexist fine. The conjunction is
 * what identifies an actual thief.
 *
 * READ-ONLY. This script never writes to, moves, or rewrites anything under
 * ~/.claude or the project. It reports; the human decides whether to uninstall
 * a neighbour, narrow it, or accept the collision.
 *
 * USED AS A LIBRARY TOO
 * ---------------------
 * `findNeighbours` is the discovery half, exported so `synthesize-scenarios.ts`
 * can reuse it as its hard-negative source. The reason that reuse is worth the
 * indirection: a co-installed skill sharing the target's vocabulary is the most
 * realistic near-miss available anywhere. Hand-written negatives are invented
 * from the author's imagination; these are queries a real installation will
 * genuinely contest.
 *
 * The library form is deliberately LOOSER than the CLI's rule. The CLI reports a
 * *collision*, which requires shared vocabulary AND pushy phrasing, because that
 * conjunction is what identifies a thief worth acting on. Scenario synthesis
 * wants every vocabulary-sharing neighbour, pushy or not: a perfectly
 * well-behaved neighbour in the same domain still owns queries the target must
 * decline, and those are exactly the hard negatives an eval set needs. So
 * `findNeighbours` returns the shared-vocabulary set with `pushy` attached, and
 * the CLI applies the second half of the conjunction itself.
 *
 * USAGE
 *   bun shared/scripts/check-overlap.ts <skill-dir>
 *
 * EXIT
 *   0  no collision found
 *   1  at least one collision found
 *   2  usage or I/O error
 */

import { parseArgs, formatHelp, CliError, type Spec } from "./lib/cli.ts";
import { mapWithConcurrency } from "./lib/pool.ts";

// ---------------------------------------------------------------------------
// Paths
//
// No Node builtins. `Bun.pathToFileURL` resolves a relative path against the cwd
// and `new URL(rel, base)` performs the same segment normalization a path join
// would -- `..` and `.` collapse, and the round-trip through `fileURLToPath`
// restores characters the URL form percent-encodes, so a directory containing
// `#`, `%` or a space survives. Separators are `/`: this targets macOS and
// Linux, and Bun normalizes what it returns.
// ---------------------------------------------------------------------------

/** Absolute, normalized form of a path that may be relative to the cwd. */
export function absolute(path: string): string {
  return Bun.fileURLToPath(Bun.pathToFileURL(path));
}

/** Join a relative path onto a directory and normalize, as `resolve` would. */
export function joinAbsolute(dir: string, rel: string): string {
  const base = Bun.pathToFileURL(dir.endsWith("/") ? dir : `${dir}/`);
  return Bun.fileURLToPath(new URL(rel, base));
}

/** Final segment of a path -- the directory name for a skill directory. */
function baseName(path: string): string {
  const trimmed = path.endsWith("/") ? path.slice(0, -1) : path;
  return trimmed.slice(trimmed.lastIndexOf("/") + 1);
}

// ---------------------------------------------------------------------------
// Frontmatter
// ---------------------------------------------------------------------------

export interface SkillRecord {
  readonly name: string;
  readonly description: string;
  /** Absolute path to the SKILL.md. */
  readonly path: string;
  /** Where it came from, for the report. */
  readonly origin: string;
}

/**
 * Read `name` and `description` from a SKILL.md.
 *
 * Uses real YAML, not the hand-rolled reader in `lib/frontmatter.ts`. That one
 * exists to reproduce a specific Python parser's quirks byte-for-byte for skills
 * we own; here we are reading arbitrary third-party skills and want to see what
 * the loader sees. `validate-skill.ts` makes the same choice for the same reason.
 *
 * Falls back to a line scan when YAML parsing throws -- an unquoted colon inside
 * a description is common in the wild and would otherwise drop the skill from
 * the comparison set entirely, which is the one outcome this check cannot afford.
 *
 * Exported under a qualified name because `lib/frontmatter.ts` exports a
 * `parseFrontmatter` too, and the two are deliberately different readers. An
 * importer that needs both should not have to guess which one it got.
 */
export function parseSkillFrontmatter(text: string): { name: string; description: string } | null {
  if (!text.startsWith("---")) return null;
  const end = text.indexOf("\n---", 3);
  if (end === -1) return null;
  const block = text.slice(text.indexOf("\n") + 1, end);

  try {
    const parsed = Bun.YAML.parse(block) as Record<string, unknown> | null;
    if (parsed && typeof parsed === "object") {
      const name = typeof parsed.name === "string" ? parsed.name : "";
      const description = typeof parsed.description === "string" ? parsed.description : "";
      if (name || description) return { name, description };
    }
  } catch {
    // fall through
  }

  let name = "";
  let description = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("name:")) name = line.slice(5).trim().replace(/^["']|["']$/g, "");
    else if (line.startsWith("description:")) {
      description = line.slice(12).trim().replace(/^["']|["']$/g, "");
    }
  }
  return name || description ? { name, description } : null;
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

const HOME = process.env.HOME ?? "";

/** Roots to sweep, in the order a collision report should present them. */
function searchRoots(projectDir: string): ReadonlyArray<{ root: string; origin: string }> {
  const roots: Array<{ root: string; origin: string }> = [];
  if (HOME) {
    roots.push({ root: `${HOME}/.claude/skills`, origin: "user" });
    roots.push({ root: `${HOME}/.claude/plugins/marketplaces`, origin: "plugin" });
    roots.push({ root: `${HOME}/.claude/plugins/repos`, origin: "plugin" });
  }
  roots.push({ root: `${projectDir}/.claude/skills`, origin: "project" });
  return roots;
}

/** Directories that hold copies, caches, or scaffolds rather than live skills. */
const SKIP_SEGMENTS = ["node_modules", ".git", "cache", "template", "templates", "__tests__"];

/**
 * File reads in flight at once during the sweep.
 *
 * The reads are independent and each is tiny, so serializing them spent the whole sweep
 * waiting: measured on a 300-skill tree, reading them one after another cost 13.4ms
 * against 2.2ms for the same reads overlapped. Bounded rather than unbounded because an
 * installed set has no ceiling and a few thousand simultaneous opens is how a sweep
 * turns into `EMFILE` on a machine with a low descriptor limit.
 */
const READ_CONCURRENCY = 32;

/** What happened at one search root, so a caller can tell "empty" from "blind". */
export type RootStatus = "scanned" | "absent" | "unreadable";

export interface RootOutcome {
  readonly root: string;
  readonly origin: string;
  readonly status: RootStatus;
  /** Skills found under this root, before de-duplication against earlier roots. */
  readonly found: number;
}

export interface Discovery {
  readonly skills: SkillRecord[];
  readonly roots: readonly RootOutcome[];
  /** True when `HOME` is unset, so the user and plugin roots cannot even be named. */
  readonly homeless: boolean;
}

/**
 * Sweep the installed set, recording what happened at each root.
 *
 * The distinction this returns is the whole reason it exists. A root that is
 * absent is an observation -- nothing is installed there. A root that exists and
 * refuses to enumerate is a blind spot, and a collision check that treats the
 * two the same reports "no problems" on the strength of having failed to look.
 * `discoverSkills` keeps the old shape for the callers that only want the list.
 */
export async function discoverSkillsWithStatus(
  projectDir: string,
  exclude: string,
): Promise<Discovery> {
  const glob = new Bun.Glob("**/SKILL.md");
  const seen = new Set<string>([exclude]);
  const found: SkillRecord[] = [];
  const roots: RootOutcome[] = [];

  for (const { root, origin } of searchRoots(projectDir)) {
    let paths: string[];
    try {
      paths = await Array.fromAsync(glob.scan({ cwd: root, onlyFiles: true, followSymlinks: false }));
    } catch {
      // `Bun.Glob.scan` throws the same way for "no such directory", "you may
      // not read it" and "that is a file", so the three are separated by a stat.
      // Anything that exists and would not enumerate is a blind spot: an absent
      // root is the observation "nothing installed here", while a root that is
      // present and unreadable means the sweep does not know what is there.
      let exists = false;
      try {
        await Bun.file(root).stat();
        exists = true;
      } catch {
        exists = false;
      }
      roots.push({ root, origin, status: exists ? "unreadable" : "absent", found: 0 });
      continue;
    }
    const before = found.length;

    // Selection first, reads second. Splitting the pass this way is what lets the reads
    // overlap: `seen` is decided synchronously here, so no two runners can race to claim
    // the same path, and `mapWithConcurrency` returns in input order -- which matters
    // because `found`'s order survives into the report through a stable sort.
    const candidates: Array<{ abs: string; fallbackName: string }> = [];
    for (const rel of paths) {
      const segments = rel.split("/");
      if (segments.some((s) => SKIP_SEGMENTS.includes(s))) continue;

      const abs = joinAbsolute(root, rel);
      if (seen.has(abs)) continue;
      seen.add(abs);
      // The skill's own directory name, which is what the loader would call it when the
      // frontmatter names nothing; the whole relative path when there is no directory.
      // `||` rather than `??`, so an empty segment falls through to the path as before.
      candidates.push({ abs, fallbackName: segments.at(-2) || rel });
    }

    // Returns undefined rather than throwing on an unreadable file, because
    // `mapWithConcurrency` re-throws the first failure and one unreadable SKILL.md must
    // not take the sweep down with it -- the previous loop skipped it and so does this.
    const texts = await mapWithConcurrency(candidates, READ_CONCURRENCY, async ({ abs }) => {
      try {
        return await Bun.file(abs).text();
      } catch {
        return undefined;
      }
    });

    for (const [index, { abs, fallbackName }] of candidates.entries()) {
      const text = texts[index];
      if (text === undefined) continue;
      const parsed = parseSkillFrontmatter(text);
      if (!parsed?.description) continue;

      found.push({
        name: parsed.name || fallbackName,
        description: parsed.description,
        path: abs,
        origin,
      });
    }
    roots.push({ root, origin, status: "scanned", found: found.length - before });
  }

  return { skills: found, roots, homeless: HOME === "" };
}

export async function discoverSkills(projectDir: string, exclude: string): Promise<SkillRecord[]> {
  return (await discoverSkillsWithStatus(projectDir, exclude)).skills;
}

// ---------------------------------------------------------------------------
// Domain vocabulary
// ---------------------------------------------------------------------------

/**
 * Words that carry no domain signal. Deliberately includes the vocabulary of
 * skill descriptions themselves ("skill", "trigger", "user") -- two skills both
 * saying "use this skill when the user asks" share nothing meaningful.
 */
const STOPWORDS: ReadonlySet<string> = new Set([
  "this", "that", "these", "those", "with", "from", "into", "when", "what", "which",
  "they", "them", "their", "there", "then", "than", "have", "has", "had", "been",
  "will", "would", "should", "could", "want", "wants", "wanted", "need", "needs",
  "use", "used", "uses", "using", "user", "users", "skill", "skills", "trigger",
  "triggers", "triggered", "triggering", "ask", "asks", "asked", "asking", "say",
  "says", "said", "like", "such", "also", "even", "just", "only", "any", "all",
  "and", "the", "for", "not", "but", "you", "your", "its", "it's", "are", "was",
  "were", "does", "did", "doing", "done", "make", "makes", "made", "get", "gets",
  "help", "helps", "helping", "work", "works", "working", "task", "tasks", "thing",
  "things", "case", "cases", "example", "examples", "phrase", "phrases", "call",
  "calls", "run", "runs", "running", "new", "existing", "specific", "including",
  "instead", "whenever", "always", "never", "before", "after", "each", "every",
  "claude", "code", "agent", "agents", "tool", "tools",
  "mention", "mentions", "mentioned", "explicitly", "something", "anything",
  "someone", "otherwise", "afterward", "afterwards", "please",
]);

/**
 * Tokens carrying domain signal: lowercased alphanumeric runs of 4+ characters,
 * minus stopwords, with a trailing `s` stripped so `migration`/`migrations`
 * collide. Crude stemming on purpose -- a real stemmer would be a dependency,
 * and this only has to make two descriptions about the same subject overlap.
 */
export function domainTerms(text: string): Set<string> {
  const terms = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 4) continue;
    const term = raw.endsWith("s") && raw.length > 4 ? raw.slice(0, -1) : raw;
    if (STOPWORDS.has(term) || STOPWORDS.has(raw)) continue;
    terms.add(term);
  }
  return terms;
}

/** Two shared domain terms is the floor for "competing for the same queries". */
export const SHARED_TERM_FLOOR = 2;

// ---------------------------------------------------------------------------
// Pushy phrasing
// ---------------------------------------------------------------------------

/**
 * Universal-quantifier phrasing. Each pattern claims the skill applies past the
 * point where the user's own words stop supporting it -- which is exactly the
 * property that lets it take a neighbour's triggers.
 */
const PUSHY_PATTERNS: ReadonlyArray<{ readonly re: RegExp; readonly label: string }> = [
  // Deliberately matched on the opener alone, not on a following negation.
  // An earlier version required "even if they DON'T ..." and "whenever the user
  // MENTIONS ...", and dogfooding caught it missing the most aggressive
  // description on this machine, which reads "even if they DESCRIBE the goal
  // without using the word" and "whenever the user SAYS things like". Both
  // evaded by one word while doing exactly what the check exists to find. The
  // tell is the concessive opener itself -- it is there to widen the trigger
  // past what the user's own words support -- so the verb after it is noise.
  { re: /\beven if (?:they|the user|you)\b/i, label: "even-if-they" },
  { re: /\bwhenever the user\b/i, label: "whenever-the-user" },
  { re: /\balways use this skill\b/i, label: "always-use-this-skill" },
  { re: /\buse this skill (?:for|on|in) (?:any|every|all)\b/i, label: "use-for-any/every/all" },
  { re: /\bany time (?:the user|you|someone)\b/i, label: "any-time" },
  { re: /\bin all cases\b/i, label: "in-all-cases" },
  { re: /\bno matter (?:what|how|whether)\b/i, label: "no-matter-what" },
  { re: /\bregardless of (?:what|whether|how)\b/i, label: "regardless-of" },
  { re: /\bmust (?:always )?(?:be )?(?:used|invoked|loaded)\b/i, label: "must-be-used" },
  { re: /\bproactively (?:use|invoke|trigger|load)\b/i, label: "proactively-use" },
];

/**
 * The same ten patterns compiled once, globally, for the replace pass.
 *
 * `stripPushy` used to build these inside its loop, so a sweep of an installed set paid
 * ten `new RegExp` compilations per skill -- three thousand of them on a machine with
 * three hundred skills, all producing the same ten objects. Reuse is safe because
 * `String.prototype.replace` resets a global regex's `lastIndex` around the call, so no
 * state survives from one description to the next.
 */
const PUSHY_GLOBAL: readonly RegExp[] = PUSHY_PATTERNS.map(({ re }) => new RegExp(re.source, "gi"));

/**
 * One alternation over all ten, as a pre-filter.
 *
 * A description matching none of the patterns comes out of `stripPushy` byte-identical
 * and out of `findPushy` empty, so the ten-pattern pass over it was ten scans that could
 * not have found anything. Most descriptions in the wild are not pushy -- that is the
 * whole reason pushiness is a signal -- so this is the common case, and one alternation
 * answers it. Deliberately NOT global: `test` on a global regex advances `lastIndex`,
 * which would make a shared instance give different answers on successive calls.
 */
const ANY_PUSHY = new RegExp(PUSHY_PATTERNS.map(({ re }) => re.source).join("|"), "i");

/**
 * Remove pushy phrasing before the vocabulary test runs over a description.
 *
 * Without this the check is circular: "whenever the user mentions" contributes
 * the word "mentions" to the vocabulary of every pushy description, so two
 * unrelated skills look like they share domain terms purely because both are
 * pushy. The vocabulary test has to see what a description is ABOUT, with the
 * boilerplate that makes it pushy taken out.
 */
export function stripPushy(description: string): string {
  if (!ANY_PUSHY.test(description)) return description;
  let out = description;
  for (const re of PUSHY_GLOBAL) {
    out = out.replace(re, " ");
  }
  return out;
}

export interface PushyHit {
  readonly label: string;
  /** The matched text plus a little surrounding context, for the report. */
  readonly quote: string;
}

export function findPushy(description: string): PushyHit[] {
  if (!ANY_PUSHY.test(description)) return [];
  const hits: PushyHit[] = [];
  for (const { re, label } of PUSHY_PATTERNS) {
    const m = re.exec(description);
    if (!m || m.index === undefined) continue;
    const start = Math.max(0, m.index - 20);
    const end = Math.min(description.length, m.index + m[0].length + 40);
    const quote = `${start > 0 ? "..." : ""}${description.slice(start, end).replace(/\s+/g, " ").trim()}${end < description.length ? "..." : ""}`;
    hits.push({ label, quote });
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Neighbour search -- the reusable half
// ---------------------------------------------------------------------------

/**
 * One installed skill that shares the target's domain vocabulary.
 *
 * `pushy` may be empty. A neighbour with no pushy phrasing is not a collision by
 * the CLI's rule, but it is still competing for the same queries -- which is why
 * the two consumers filter this list differently.
 */
export interface Neighbour {
  readonly skill: SkillRecord;
  readonly shared: string[];
  readonly pushy: PushyHit[];
}

export interface NeighbourSearch {
  /**
   * Domain vocabulary the target competes on.
   *
   * Passed in rather than derived from a description here, because the caller
   * knows which text is legitimate to derive it from. `synthesize-scenarios.ts`
   * deliberately derives it from the artifact's BODY, never from the description
   * it is about to optimize -- seeding the neighbour search from the description
   * would make the hard negatives circular in exactly the way the positives are
   * guarded against.
   */
  readonly targetTerms: ReadonlySet<string>;
  /** Absolute path of the target's own SKILL.md, so it cannot match itself. */
  readonly excludePath: string;
  /** Project root to sweep alongside the user and plugin roots. Defaults to cwd. */
  readonly projectDir?: string;
  readonly minShared?: number;
}

export interface NeighbourReport {
  /** How many installed skills were read, whether or not they shared anything. */
  readonly scanned: number;
  /** Worst first: most shared vocabulary means most directly competing. */
  readonly neighbours: readonly Neighbour[];
}

/**
 * Sweep the installed set for skills sharing `targetTerms`.
 *
 * Read-only, like everything else in this file. The pushy check still runs on
 * each match, so a caller that wants the CLI's stricter collision rule filters
 * on `pushy.length > 0` rather than re-deriving anything.
 */
export async function findNeighbours(search: NeighbourSearch): Promise<NeighbourReport> {
  return await findNeighboursWithStatus(search);
}

/**
 * `findNeighbours` plus what the sweep could and could not see.
 *
 * Separate entry point rather than a wider return on the original, so the
 * scenario-synthesis caller -- which genuinely does not care, because a thin
 * hard-negative set is a weaker eval rather than a wrong answer -- is unchanged.
 */
export async function findNeighboursWithStatus(
  search: NeighbourSearch,
): Promise<NeighbourReport & { readonly discovery: Discovery }> {
  const minShared = search.minShared ?? SHARED_TERM_FLOOR;
  const discovery = await discoverSkillsWithStatus(
    search.projectDir ?? process.cwd(),
    search.excludePath,
  );
  const candidates = discovery.skills;

  const neighbours: Neighbour[] = [];
  for (const skill of candidates) {
    const shared = [...domainTerms(`${skill.name} ${stripPushy(skill.description)}`)].filter((t) =>
      search.targetTerms.has(t),
    );
    if (shared.length < minShared) continue;
    neighbours.push({ skill, shared: shared.sort(), pushy: findPushy(skill.description) });
  }

  neighbours.sort((a, b) => b.shared.length - a.shared.length);
  return { scanned: candidates.length, neighbours, discovery };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

/** Output is markdown: it lands in a Claude Code transcript, where ANSI is stripped. */
function report(target: SkillRecord, scanned: number, collisions: readonly Neighbour[]): string {
  const lines: string[] = [];
  lines.push(`## Trigger-overlap check: \`${target.name}\``);
  lines.push("");
  lines.push(`Scanned ${scanned} installed skill${scanned === 1 ? "" : "s"}.`);
  lines.push("");

  if (collisions.length === 0) {
    lines.push("**No collisions found.** No installed skill both shares this skill's domain");
    lines.push("vocabulary and uses universal-quantifier phrasing.");
    return lines.join("\n");
  }

  lines.push(
    `**${collisions.length} collision${collisions.length === 1 ? "" : "s"}.** Each skill below shares domain`,
  );
  lines.push("vocabulary with the target *and* claims triggers past what its own scope supports.");
  lines.push("Expect it to win contested queries that belong to the target.");
  lines.push("");

  for (const { skill, shared, pushy } of collisions) {
    lines.push(`### \`${skill.name}\` (${skill.origin})`);
    lines.push("");
    lines.push(`- Path: \`${skill.path}\``);
    lines.push(`- Shared domain terms: ${shared.map((t) => `\`${t}\``).join(", ")}`);
    lines.push("- Pushy phrasing:");
    for (const hit of pushy) {
      lines.push(`  - \`${hit.label}\` — "${hit.quote}"`);
    }
    lines.push("");
  }

  lines.push("### What to do");
  lines.push("");
  lines.push("Rewriting the target's own description will not recover these triggers — that");
  lines.push("was measured and it did not work. The fix is on the neighbour: narrow its");
  lines.push("description, remove the universal-quantifier clause, or uninstall it. If the");
  lines.push("neighbour is not yours to change, treat the overlap as a known limit and say so");
  lines.push("in the target skill's README.");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const USAGE = [
  "Usage: bun shared/scripts/check-overlap.ts <skill-dir> [options]",
  "",
  "Reports installed skills likely to steal <skill-dir>'s triggers.",
  "Read-only: nothing under ~/.claude or the project is modified.",
  "Exit 0 clean, 1 on collision, 2 on usage or I/O error.",
].join("\n");

const SPEC: Spec = {
  "min-shared": {
    kind: "number",
    default: SHARED_TERM_FLOOR,
    help: "Shared domain terms required to count as competing",
  },
  json: { kind: "boolean", default: false, help: "Emit machine-readable JSON" },
  help: { kind: "boolean", short: "h", default: false, help: "Show this help" },
};

async function main(argv: string[]): Promise<number> {
  let flags: Record<string, unknown>;
  let positionals: string[];
  try {
    ({ flags, positionals } = parseArgs(argv, SPEC));
  } catch (err) {
    if (err instanceof CliError) {
      console.error(`${err.message}\n\n${formatHelp(USAGE, SPEC)}`);
      return 2;
    }
    throw err;
  }

  const skillDir = positionals[0];
  if (flags.help || !skillDir) {
    console.log(formatHelp(USAGE, SPEC));
    return flags.help ? 0 : 2;
  }

  const minShared = Number(flags["min-shared"]);
  const targetPath = joinAbsolute(skillDir, "SKILL.md");
  let targetText: string;
  try {
    targetText = await Bun.file(targetPath).text();
  } catch {
    console.error(`Cannot read ${targetPath}`);
    return 2;
  }

  const parsed = parseSkillFrontmatter(targetText);
  if (!parsed?.description) {
    console.error(`${targetPath} has no description in its frontmatter — nothing to compare.`);
    return 2;
  }

  const target: SkillRecord = {
    name: parsed.name || baseName(absolute(skillDir)) || skillDir,
    description: parsed.description,
    path: targetPath,
    origin: "target",
  };

  // The CLI derives the target's vocabulary from its own description, which is
  // the right source HERE: this check asks whether a neighbour will steal the
  // triggers that description is claiming. Scenario synthesis asks a different
  // question and passes body-derived terms instead.
  const targetTerms = domainTerms(`${target.name} ${stripPushy(target.description)}`);
  const { scanned, neighbours } = await findNeighbours({
    targetTerms,
    excludePath: targetPath,
    minShared,
  });

  // The second half of the conjunction, applied here rather than in the search:
  // shared vocabulary alone would flag every skill in a domain, most of which
  // coexist fine. A collision needs pushy phrasing too.
  const collisions = neighbours.filter((neighbour) => neighbour.pushy.length > 0);

  if (flags.json) {
    console.log(
      JSON.stringify(
        {
          target: { name: target.name, path: target.path },
          scanned,
          minShared,
          collisions: collisions.map(({ skill, shared, pushy }) => ({
            name: skill.name,
            path: skill.path,
            origin: skill.origin,
            shared,
            pushy,
          })),
        },
        null,
        2,
      ),
    );
  } else {
    console.log(report(target, scanned, collisions));
  }
  return collisions.length > 0 ? 1 : 0;
}

// Guarded, because this module is now imported as a library. Without the guard,
// `import "./check-overlap.ts"` would run the whole CLI -- sweeping the machine,
// printing a report, and then calling `process.exit` out from under its importer.
if (import.meta.main) process.exit(await main(Bun.argv.slice(2)));
