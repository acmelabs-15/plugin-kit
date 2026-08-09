#!/usr/bin/env bun
/**
 * check-bun-purity -- enforce `../references/pure-bun.md` mechanically.
 *
 * WHY THIS EXISTS
 * ---------------
 * The pure-Bun rule was a convention, and a convention nobody checks decays in
 * one direction only. The decay is also invisible in review: a hook config that
 * pipes a payload through two external tools reads as ordinary shell, and the
 * cost -- a plugin that silently needs three things installed before it works
 * -- lands on a user's machine rather than in the diff.
 *
 * WHAT IT LOOKS AT, AND WHAT IT DELIBERATELY DOES NOT
 * ---------------------------------------------------
 * It lints the **copyable surface**: TypeScript, JSON, and fenced code blocks
 * inside markdown. Prose is not scanned, including inline `code spans` inside a
 * sentence. That boundary is the whole reason this stays usable in a
 * documentation-heavy repository -- a page explaining that Claude Code will
 * spawn whatever a config's `command` names has to be able to say so, and a
 * reader does not copy a sentence into a config file. Inside a fence it is
 * different: a fenced block is a thing someone pastes.
 *
 * A `node:` import is not a finding and never will be. Those builtins are
 * reimplemented inside the Bun binary; nothing resolves to a Node installation.
 * The rule is about spawning a *runtime*, not about which standard library the
 * code calls. `../references/pure-bun.md` argues that at length.
 *
 * SUPPRESSION
 * -----------
 * Some mentions are load-bearing facts about the platform rather than
 * recommendations. Those are suppressed by an explicit marker carrying a
 * reason, never by a heuristic this script guesses at:
 *
 *     // bun-purity-ignore: <why this mention is a platform fact>
 *
 * The marker suppresses the line it sits on and the line after it. When the
 * following line opens a fenced code block, it suppresses that whole block. A
 * marker with no reason after the colon is itself an error, because an
 * unexplained suppression is how a rule stops meaning anything.
 *
 * Usage: bun shared/tools/check-bun-purity.ts <dir>
 * Exit code 0 when clean or warnings-only, 1 on any error, 2 on a usage error.
 */

import { readdir } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";

import { CliError, formatHelp, parseArgs, type Spec } from "../cli.ts";
import { mapWithConcurrency } from "../util/pool.ts";

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

export type Severity = "error" | "warning";

export type Rule =
  | "spawned-runtime"
  | "external-cli"
  | "shebang"
  | "runtime-dependency"
  | "foreign-script"
  | "bare-builtin-import"
  | "commonjs-require"
  | "unexplained-suppression";

export interface Finding {
  /** Path relative to the scanned root, so output is stable across machines. */
  readonly file: string;
  /** 1-indexed. 0 means the finding is about the file rather than a line. */
  readonly line: number;
  readonly severity: Severity;
  readonly rule: Rule;
  /** The offending text, trimmed and clipped. */
  readonly evidence: string;
  readonly message: string;
  readonly fix: string;
}

/**
 * Runtimes that must never be spawned.
 *
 * Each one costs a user the same concrete thing: the plugin stops working on a
 * machine that does not have it, and the failure arrives at invocation rather
 * than at install, so it reads as "the plugin is broken".
 */
// bun-purity-ignore: the tokens this script searches for have to be written down somewhere
const RUNTIME_TOKENS = ["node", "npx", "npm", "pnpm", "yarn", "python3", "python", "pip3", "pip", "uvx", "uv", "deno"];

/**
 * External commands a script may not assume are installed.
 *
 * Warnings rather than errors: unlike a runtime, one of these is sometimes the
 * only way to do a thing, and the honest fix is often a README line rather than
 * a rewrite. What is never acceptable is depending on one silently.
 */
// bun-purity-ignore: same -- the search terms are the data this rule is made of
const EXTERNAL_CLI_TOKENS = ["jq", "yq", "curl", "wget", "biome", "prettier", "eslint", "xargs", "docker", "bash", "unzip", "chmod"];

/** Node builtins that must carry the `node:` prefix, because a bare name is shadowable. */
const SHADOWABLE_BUILTINS = [
  "assert", "buffer", "child_process", "crypto", "events", "fs", "http", "https",
  "os", "path", "process", "stream", "string_decoder", "timers", "tty", "url", "util", "zlib",
];

const RUNTIME_FIX =
  "Spawn Bun on a TypeScript entry point instead, or ship a `bun build --compile` binary " +
  "when the user should need no runtime at all.";

const CLI_FIX =
  "Do the work in the handler with a Bun API, or state the dependency in the README and " +
  "fail with a message that names the missing command.";

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/**
 * A token only counts when it is in command position.
 *
 * Written as five narrow patterns rather than one loose one, because the loose
 * bun-purity-ignore: the next line quotes the false positive that motivated the narrow patterns
 * version flags the word "npm" in the sentence "no npm dependencies", and a rule
 * that cries wolf gets suppressed wholesale rather than fixed.
 */
function commandPatterns(token: string): readonly RegExp[] {
  // `node:fs` must not match, so `:` is excluded on the right. `/usr/bin/node`
  // must not match either, so `/` is excluded on the left.
  const before = String.raw`(?<![\w./@$:-])`;
  const after = String.raw`(?![\w./@:-])`;
  // An argument looks like a flag, a quoted string, a variable, or a path.
  const argument = String.raw`(?:[-"'$/~@]|[\w@.-]*[./][\w@.-]+)`;
  return [
    // First word of a line, allowing indentation and a shell prompt.
    new RegExp(String.raw`^[ \t]*(?:[$>] )?${token}${after}`),
    // First word after a pipe, a `&&`, a `;`, or a command substitution.
    new RegExp(String.raw`(?:[|&;]|\$\()[ \t]*${token}${after}`),
    // Followed by something argument-shaped.
    new RegExp(String.raw`${before}${token}${after}[ \t]+${argument}`),
    // A config field whose value is a process to run.
    new RegExp(String.raw`"(?:command|headersHelper)"\s*:\s*"${token}${after}`),
    // A whole string literal -- an argv array element, or a bare config value.
    new RegExp(String.raw`(["'])${token}\1`),
  ];
}

const RUNTIME_PATTERNS = new Map(RUNTIME_TOKENS.map((t) => [t, commandPatterns(t)]));
const CLI_PATTERNS = new Map(EXTERNAL_CLI_TOKENS.map((t) => [t, commandPatterns(t)]));

/**
 * One alternation over the bare token text, used to decide whether the real patterns are
 * worth running at all.
 *
 * Every pattern `commandPatterns` builds requires its token's literal characters to be
 * present, so "the token appears somewhere in this text" is a strict superset of "one of
 * these patterns matches". That makes it safe as a pre-filter: it can say yes when the
 * answer is no, which only costs the work we would have done anyway, and it can never say
 * no when the answer is yes.
 *
 * Worth having because of the arithmetic. Twenty-three tokens at five patterns each is
 * 115 regex executions per line, and a scan of this repository ran about five million of
 * them — nearly all on lines containing no token at all. Measured on 172 files, the check
 * went from 1,451ms to the figure in this file's tests. Reads were never the cost: the
 * directory walk is 3ms and every file read totals 15ms.
 */
const ANY_TOKEN = new RegExp([...RUNTIME_TOKENS, ...EXTERNAL_CLI_TOKENS].join("|"));

/** True when a body could not possibly contain a command finding. Superset, never a lie. */
export function mayContainCommand(text: string): boolean {
  return ANY_TOKEN.test(text);
}

/** The first token from `patterns` that appears in command position on `line`. */
export function matchCommand(line: string, patterns: ReadonlyMap<string, readonly RegExp[]>): string | undefined {
  // Cheap gate first: on a line with no token text, this replaces 115 executions with one.
  if (!ANY_TOKEN.test(line)) return undefined;
  for (const [token, regexes] of patterns) {
    // The same superset argument as `ANY_TOKEN`, applied one level down. Every pattern
    // `commandPatterns` built for this token embeds the token's literal characters, so a
    // line not containing them cannot match any of the five -- and a line that survived
    // the gate above did so because of SOME token, almost never all of them. This is the
    // difference between five regex executions per token and one substring search: on a
    // line mentioning `node:path`, eleven of the twelve runtime tokens now cost a
    // `includes` each instead of five backtracking patterns each.
    if (!line.includes(token)) continue;
    if (regexes.some((regex) => regex.test(line))) return token;
  }
  return undefined;
}

const BARE_IMPORT = new RegExp(
  String.raw`(?:from|import|require\()\s*(["'])(${SHADOWABLE_BUILTINS.join("|")})\1`,
);

/**
 * A CommonJS call, excluding `foo.require(` and `myrequire(`.
 *
 * Hoisted to module scope rather than written inline in the loop. A regex literal is
 * re-evaluated at its site on every pass, and this one sat inside a per-line branch.
 */
const REQUIRE_CALL = /(?<![\w.])require\s*\(/;

// ---------------------------------------------------------------------------
// Suppression
// ---------------------------------------------------------------------------

/**
 * The marker's literal text, kept beside the pattern that reads it.
 *
 * Every match of `MARKER` contains this substring, which makes it a superset test for
 * "could this text hold a marker at all" -- the same pre-filter argument `ANY_TOKEN`
 * makes, applied to a whole file rather than a line. Most files carry no marker, and
 * for those `checkText` skips the per-line scan entirely.
 *
 * Spelling it out a second time next to the pattern is deliberate: the pattern is what
 * the scanner reads and this is what gates it, and a gate derived from `MARKER.source`
 * would be clever in a way that breaks silently the day the pattern gains a prefix.
 */
const MARKER_TEXT = "bun-purity-ignore";
const MARKER = /bun-purity-ignore:?(.*)$/;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

export interface SuppressionScan {
  /** 1-indexed lines on which findings are suppressed. */
  readonly suppressed: ReadonlySet<number>;
  /** Markers written without a reason, which are themselves a finding. */
  readonly unexplained: readonly number[];
}

/** The answer for a file with no marker text in it at all. Shared, because it is immutable. */
const NO_SUPPRESSIONS: SuppressionScan = { suppressed: new Set<number>(), unexplained: [] };

/**
 * Work out which lines a file's markers cover.
 *
 * Deliberately not "suppress everything below": a marker's scope is one line,
 * the next line, or -- when the next line opens a fence -- that block. Anything
 * wider and a marker added for one honest reason quietly covers a violation
 * added underneath it a year later.
 */
export function scanSuppressions(lines: readonly string[]): SuppressionScan {
  const suppressed = new Set<number>();
  const unexplained: number[] = [];

  for (const [index, line] of lines.entries()) {
    const match = MARKER.exec(line);
    if (match === null) continue;
    if ((match[1] ?? "").trim() === "") {
      unexplained.push(index + 1);
      continue;
    }

    suppressed.add(index + 1);
    const next = lines[index + 1];
    if (next === undefined) continue;
    suppressed.add(index + 2);

    const opener = FENCE.exec(next);
    if (opener === null) continue;
    const delimiter = opener[1]!;
    for (let cursor = index + 2; cursor < lines.length; cursor++) {
      suppressed.add(cursor + 1);
      const closer = FENCE.exec(lines[cursor]!);
      if (closer !== null && closer[1]!.length >= delimiter.length && closer[1]![0] === delimiter[0]) break;
    }
  }

  return { suppressed, unexplained };
}

// ---------------------------------------------------------------------------
// Deciding which lines are code
// ---------------------------------------------------------------------------

export type Language = "typescript" | "json" | "markdown";

/**
 * The lines of a file that are code a reader would copy or a machine would run.
 *
 * For TypeScript and JSON that is every line. For markdown it is the interior
 * of fenced blocks, excluding the fence lines themselves -- otherwise the
 * ```bash info string is read as an invocation of bash.
 */
export function codeLines(text: string, language: Language): ReadonlyMap<number, string> {
  return new Map(walkCodeLines(text.split("\n"), language));
}

/**
 * The same walk, over lines already split and without materializing a Map.
 *
 * `checkText` has the split lines in hand for its shebang and suppression checks, and it
 * only ever iterates the result in order. Going through `codeLines` made it split the
 * file a second time and build a Map of every line of every TypeScript file just to walk
 * it once and throw it away. The public function stays, because a Map is the right thing
 * to hand a caller that wants to ask about a particular line; this is the shape the one
 * hot caller actually needs.
 */
function* walkCodeLines(
  lines: readonly string[],
  language: Language,
): Generator<readonly [number, string]> {
  if (language !== "markdown") {
    for (const [index, line] of lines.entries()) yield [index + 1, line];
    return;
  }

  let openDelimiter: string | undefined;
  for (const [index, line] of lines.entries()) {
    const fence = FENCE.exec(line);
    if (openDelimiter === undefined) {
      if (fence !== null) openDelimiter = fence[1]!;
      continue;
    }
    if (fence !== null && fence[1]!.length >= openDelimiter.length && fence[1]![0] === openDelimiter[0]) {
      openDelimiter = undefined;
      continue;
    }
    yield [index + 1, line];
  }
}

// ---------------------------------------------------------------------------
// Per-file checks
// ---------------------------------------------------------------------------

const LANGUAGE_BY_EXTENSION: Readonly<Record<string, Language>> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".js": "typescript",
  ".jsx": "typescript",
  ".mjs": "typescript",
  ".cjs": "typescript",
  ".json": "json",
  ".md": "markdown",
};

function clip(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > 120 ? `${trimmed.slice(0, 117)}...` : trimmed;
}

/** Every finding in one file's text. Pure, so the tests need no filesystem. */
export function checkText(file: string, text: string, language: Language): readonly Finding[] {
  const findings: Finding[] = [];
  const lines = text.split("\n");
  // Whole-file gates, each a superset of the per-line work it stands in front of. The
  // arithmetic is the same one that motivated `ANY_TOKEN`, moved up a level: a file with
  // no marker anywhere pays nothing per line for the suppression scan, and a file
  // mentioning no runtime or CLI token pays nothing per line for the command patterns.
  // Across this repository that is most files, and the per-line gate they replace was
  // still a regex execution per line.
  const { suppressed, unexplained } = text.includes(MARKER_TEXT)
    ? scanSuppressions(lines)
    : NO_SUPPRESSIONS;
  const scanCommands = mayContainCommand(text);

  for (const line of unexplained) {
    findings.push({
      file,
      line,
      severity: "error",
      rule: "unexplained-suppression",
      evidence: clip(lines[line - 1] ?? ""),
      message: "A suppression marker carries no reason.",
      fix: "Write `bun-purity-ignore: <why this mention is a platform fact>`, or delete the marker.",
    });
  }

  const first = lines[0] ?? "";
  if (first.startsWith("#!") && first.trim() !== "#!/usr/bin/env bun" && !suppressed.has(1)) {
    findings.push({
      file,
      line: 1,
      severity: "error",
      rule: "shebang",
      evidence: clip(first),
      message: "A shebang naming a runtime other than Bun.",
      fix: "Use `#!/usr/bin/env bun`. Bun runs TypeScript directly, so there is no build step to add.",
    });
  }

  for (const [line, content] of walkCodeLines(lines, language)) {
    if (suppressed.has(line)) continue;

    // Two layers of the same superset test, and both earn their place. The file-level
    // `scanCommands` skips the per-line work entirely for the half of this repository
    // that mentions no token anywhere. The per-line test then replaces the TWO gates the
    // pair of `matchCommand` calls would each run for themselves with one.
    if (scanCommands && mayContainCommand(content)) {
      const runtime = matchCommand(content, RUNTIME_PATTERNS);
      if (runtime !== undefined) {
        findings.push({
          file,
          line,
          severity: "error",
          rule: "spawned-runtime",
          evidence: clip(content),
          message: `Spawns or recommends \`${runtime}\`, a runtime outside Bun.`,
          fix: RUNTIME_FIX,
        });
      }

      const cli = matchCommand(content, CLI_PATTERNS);
      if (cli !== undefined) {
        findings.push({
          file,
          line,
          severity: "warning",
          rule: "external-cli",
          evidence: clip(content),
          message: `Assumes \`${cli}\` is installed. Only Bun and git are guaranteed.`,
          fix: CLI_FIX,
        });
      }
    }

    if (language === "typescript") {
      // `BARE_IMPORT` cannot match without one of its three literal openers, and
      // `REQUIRE_CALL` cannot match without the bare word, so both get the same substring
      // gate. This is the single largest saving in the file: the two patterns ran on
      // every line of every TypeScript file, and almost no line is an import.
      const mayImport =
        content.includes("from") || content.includes("import") || content.includes("require");
      const bare = mayImport ? BARE_IMPORT.exec(content) : null;
      if (bare !== null) {
        findings.push({
          file,
          line,
          severity: "error",
          rule: "bare-builtin-import",
          evidence: clip(content),
          message: `Imports \`${bare[2]}\` without the \`node:\` prefix, so an npm package of that name shadows it.`,
          fix: `Write \`node:${bare[2]}\`. The prefix is the rule; the builtin itself is correct under Bun.`,
        });
      }
      if (content.includes("require") && REQUIRE_CALL.test(content)) {
        findings.push({
          file,
          line,
          severity: "error",
          rule: "commonjs-require",
          evidence: clip(content),
          // bun-purity-ignore: the message has to name the call it is reporting
          message: "Uses `require()`. This codebase is ESM.",
          fix: "Use a static `import`, or `await import()` where the load has to be conditional.",
        });
      }
    }
  }

  return findings;
}

/** Findings from a `package.json`, which are about the manifest rather than a line. */
export function checkManifest(file: string, text: string): readonly Finding[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  const manifest = parsed as Record<string, unknown>;
  const findings: Finding[] = [];

  for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
    const value = manifest[field];
    if (typeof value !== "object" || value === null) continue;
    const names = Object.keys(value as Record<string, unknown>);
    if (names.length === 0) continue;
    findings.push({
      file,
      line: 0,
      severity: "error",
      rule: "runtime-dependency",
      evidence: `${field}: ${names.join(", ")}`,
      message: `\`${field}\` ships with the plugin, so the user's machine needs an install step.`,
      fix:
        "Move it to `devDependencies` if it only runs during development, bundle it with " +
        "`Bun.build`, or replace it with a Bun built-in.",
    });
  }

  if (manifest["engines"] !== undefined) {
    findings.push({
      file,
      line: 0,
      severity: "error",
      rule: "runtime-dependency",
      evidence: `engines: ${JSON.stringify(manifest["engines"])}`,
      message: "An `engines` field declares a runtime this plugin does not run on.",
      fix: "Delete it. Bun is the runtime, and it is not what `engines` describes.",
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Walking a tree
// ---------------------------------------------------------------------------

const SKIP_DIRECTORIES = new Set([
  "node_modules", ".git", "dist", "build", "coverage", ".next", ".cache", "vendor",
]);

/** Extensions that are a finding by existing at all, and why. */
const FOREIGN_SCRIPTS: Readonly<Record<string, { readonly severity: Severity; readonly what: string }>> = {
  ".py": { severity: "error", what: "A Python source file" },
  ".pyc": { severity: "error", what: "A compiled Python file" },
  ".rb": { severity: "error", what: "A Ruby source file" },
  ".sh": { severity: "warning", what: "A shell script" },
  ".bash": { severity: "warning", what: "A shell script" },
  ".ps1": { severity: "warning", what: "A PowerShell script" },
};

/**
 * Every file worth reading under `root`.
 *
 * A hand-rolled walk rather than a glob because pruning matters: descending
 * into `node_modules` to throw the results away is the difference between a
 * check people run and one they skip.
 */
export async function collectFiles(root: string): Promise<readonly string[]> {
  const found: string[] = [];
  const queue = [root];
  while (queue.length > 0) {
    const directory = queue.pop()!;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name) || entry.name.endsWith("-workspace")) continue;
        queue.push(path);
        continue;
      }
      if (entry.isFile()) found.push(path);
    }
  }
  return found.sort();
}

/**
 * Files read at once. Bounded, because a scanned tree has no ceiling and a few thousand
 * simultaneous opens is how a lint run turns into `EMFILE`.
 */
const READ_CONCURRENCY = 32;

export async function checkDirectory(root: string): Promise<{
  readonly findings: readonly Finding[];
  readonly filesScanned: number;
}> {
  const absolute = resolve(root);
  const findings: Finding[] = [];
  let filesScanned = 0;

  // What each path is, decided once. The reporting loop and the read pass below both
  // need the answer, and `extname` plus two lookups per file is not worth doing twice.
  const files = (await collectFiles(absolute)).map((path) => {
    const extension = extname(path).toLowerCase();
    return {
      path,
      name: relative(absolute, path),
      foreign: FOREIGN_SCRIPTS[extension],
      language: LANGUAGE_BY_EXTENSION[extension],
    };
  });

  // Reads overlapped, findings still assembled in sorted-path order below. This used to
  // be free relative to the regex work -- 15ms against 1,451ms -- but the regex work is
  // now around 35ms, and 15ms of serial waiting is a share worth having back.
  //
  // A read failure is captured rather than thrown here, so that the ordered pass below
  // can raise the LOWEST-indexed one. `mapWithConcurrency` re-raises whichever failure
  // settled first, which under concurrency need not be the first file in path order --
  // and the serial loop this replaces always failed on the first unreadable path.
  const readable = files.filter((file) => file.foreign === undefined && file.language !== undefined);
  const reads = await mapWithConcurrency(readable, READ_CONCURRENCY, async ({ path }) => {
    try {
      return { text: await Bun.file(path).text() };
    } catch (error) {
      return { error };
    }
  });
  const readByPath = new Map(readable.map(({ path }, index) => [path, reads[index]!]));

  for (const { path, name, foreign, language } of files) {
    if (foreign !== undefined) {
      findings.push({
        file: name,
        line: 0,
        severity: foreign.severity,
        rule: "foreign-script",
        evidence: name,
        message: `${foreign.what} in a plugin whose scripts all run on Bun.`,
        fix: "Port it to TypeScript and run it with Bun. Bun's shell, `Bun.$`, covers what a shell script was for.",
      });
      continue;
    }
    if (language === undefined) continue;

    const read = readByPath.get(path)!;
    if ("error" in read) throw read.error;
    const text = read.text;
    filesScanned += 1;
    findings.push(...checkText(name, text, language));
    if (name === "package.json" || name.endsWith("/package.json")) {
      findings.push(...checkManifest(name, text));
    }
  }

  findings.sort(
    (a, b) =>
      Number(b.severity === "error") - Number(a.severity === "error") ||
      a.file.localeCompare(b.file) ||
      a.line - b.line,
  );
  return { findings, filesScanned };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

/** Render findings as markdown, matching this plugin's markdown-first CLI output. */
export function formatReport(
  findings: readonly Finding[],
  root: string,
  filesScanned: number,
): string {
  const errors = findings.filter((f) => f.severity === "error");
  const warnings = findings.filter((f) => f.severity === "warning");

  const lines = [
    `# Bun purity: \`${resolve(root)}\``,
    "",
    `- **Files scanned**: ${filesScanned}`,
    `- **Errors**: ${errors.length}`,
    `- **Warnings**: ${warnings.length}`,
    "",
  ];

  const section = (title: string, group: readonly Finding[]): void => {
    if (group.length === 0) return;
    lines.push(`## ${title} (${group.length})`, "");
    for (const finding of group) {
      const at = finding.line === 0 ? finding.file : `${finding.file}:${finding.line}`;
      lines.push(`- \`${at}\` — **${finding.rule}** — ${finding.message}`);
      lines.push(`  - found: \`${finding.evidence}\``);
      lines.push(`  - fix: ${finding.fix}`);
    }
    lines.push("");
  };

  section("Errors", errors);
  section("Warnings", warnings);

  if (errors.length === 0 && warnings.length === 0) {
    lines.push(`**Pure Bun.** ${filesScanned} file(s) scanned, nothing to report.`);
  } else if (errors.length === 0) {
    lines.push(`**Pure Bun.** ${warnings.length} warning(s), no errors.`);
    lines.push("");
    lines.push(
      "A warning is a dependency on something the user may not have. Either remove it or " +
        "document it — a suppression marker with a reason is the third honest answer.",
    );
  } else {
    lines.push(`**Not pure Bun.** ${errors.length} error(s), ${warnings.length} warning(s).`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = "Usage: bun shared/tools/check-bun-purity.ts <dir>";

export const CLI_SPEC: Spec = {
  help: { kind: "boolean", default: false, help: "show this message" },
};

if (import.meta.main) {
  try {
    const { flags, positionals } = parseArgs(Bun.argv.slice(2), CLI_SPEC);

    if (flags["help"] === true) {
      console.log(formatHelp(USAGE, CLI_SPEC));
      process.exit(0);
    }

    const dir = positionals[0];
    if (dir === undefined) throw new CliError(`missing <dir>\n${USAGE}`);
    if (positionals.length > 1) {
      throw new CliError(`unexpected extra argument: ${positionals[1]}\n${USAGE}`);
    }

    const { findings, filesScanned } = await checkDirectory(dir);
    console.log(formatReport(findings, dir, filesScanned));
    process.exit(findings.some((f) => f.severity === "error") ? 1 : 0);
  } catch (error) {
    if (!(error instanceof CliError)) throw error;
    console.log(`Error: ${error.message}`);
    process.exit(2);
  }
}
