#!/usr/bin/env bun
/**
 * Aggregate individual run results into benchmark summary statistics.
 *
 * Reads grading.json files from run directories and produces:
 * - run_summary with mean, stddev, min, max for each metric
 * - delta between with_skill and without_skill configurations
 *
 * Usage:
 *     bun run scripts/aggregate-results.ts <benchmark_dir>
 *
 * Example:
 *     bun run scripts/aggregate-results.ts benchmarks/2026-01-15T10-30-00/
 *
 * Eval directories are recognised by their contents rather than their names, so
 * all of these work:
 *
 *     Repeated runs per configuration (what the benchmark harness writes):
 *     <benchmark_dir>/
 *     └── eval-N/
 *         ├── with_skill/
 *         │   ├── run-1/grading.json
 *         │   └── run-2/grading.json
 *         └── without_skill/
 *             ├── run-1/grading.json
 *             └── run-2/grading.json
 *
 *     One run per configuration (what SKILL.md's manual loop writes):
 *     <benchmark_dir>/
 *     └── <descriptive-eval-name>/
 *         ├── eval_metadata.json
 *         ├── with_skill/grading.json
 *         └── without_skill/grading.json
 *
 *     Legacy layout (with runs/ subdirectory):
 *     <benchmark_dir>/
 *     └── runs/
 *         └── eval-N/
 *             ├── with_skill/
 *             │   └── run-1/grading.json
 *             └── without_skill/
 *                 └── run-1/grading.json
 */

import { ensureDashboard } from "./lib/browser.ts";
import { CliError, formatHelp, parseArgs, type ParsedArgs, type Spec } from "./lib/cli.ts";
import { ProgressReporter } from "./lib/progress.ts";
import { formatFixed, formatSigned, pyTitle } from "./lib/pyfloat.ts";
import { calculateStats, type Stats } from "./lib/stats.ts";

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

/**
 * Eval identifiers come from user-authored `eval_metadata.json`, so they are
 * whatever that file says.
 */
export type EvalId = number | string;

export interface RunResult {
  readonly evalId: EvalId;
  readonly evalName: string;
  readonly configuration: string;
  readonly runNumber: number;
  readonly passRate: number;
  readonly passed: number;
  readonly failed: number;
  readonly total: number;
  readonly timeSeconds: number;
  readonly tokens: number;
  readonly toolCalls: number;
  readonly errors: number;
  readonly expectations: readonly unknown[];
  readonly notes: readonly unknown[];
}

export interface ConfigSummary {
  readonly passRate: Stats;
  readonly timeSeconds: Stats;
  readonly tokens: Stats;
}

export interface Delta {
  readonly passRate: string;
  readonly timeSeconds: string;
  readonly tokens: string;
}

export interface Benchmark {
  readonly skillName: string;
  readonly skillPath: string;
  readonly executorModel: string;
  readonly analyzerModel: string;
  readonly timestamp: string;
  readonly evalsRun: readonly EvalId[];
  readonly runsPerConfiguration: number;
  /** Insertion order is primary-then-baseline; the delta uses the first two. */
  readonly summaries: ReadonlyMap<string, ConfigSummary>;
  readonly delta: Delta;
  readonly runs: readonly RunResult[];
  readonly notes: readonly string[];
}

const ZERO_STATS: Stats = { mean: 0, stddev: 0, min: 0, max: 0 };
const RUNS_PER_CONFIGURATION = 3;
const MODEL_PLACEHOLDER = "<model-name>";

/** The configurations under test: the skill, or the revision of it, being measured. */
const PRIMARY_CONFIGS: ReadonlySet<string> = new Set(["with_skill", "new_skill"]);
/** The configurations measured against: no skill, or the version being replaced. */
const BASELINE_CONFIGS: ReadonlySet<string> = new Set(["without_skill", "old_skill"]);

/** True for the two names that mean "this is the thing being compared against". */
export function isBaselineConfig(config: string): boolean {
  return BASELINE_CONFIGS.has(config);
}

/**
 * Order configurations so the one under test comes first and its baseline second.
 *
 * Sorting the names lexically -- which is what discovery order amounted to --
 * gets the default `with_skill`/`without_skill` pair right by luck and the
 * `new_skill`/`old_skill` pair wrong by the same luck: "old_skill" sorts before
 * "new_skill", so a +0.60 improvement was reported as -0.60 in benchmark.json,
 * benchmark.md and the viewer alike. That inversion only ever hit the two modes
 * whose whole question is "did my change help", which are the modes where the
 * sign carries the answer. Classifying the names instead makes the order mean
 * what the delta assumes it means.
 *
 * A name in neither set sits between the two classes: it is more likely to be
 * the subject of the comparison than the control, and among names of the same
 * class the old lexical order is kept so nothing else moves.
 */
export function orderConfigs(configs: Iterable<string>): string[] {
  const rank = (config: string): number =>
    PRIMARY_CONFIGS.has(config) ? 0 : isBaselineConfig(config) ? 2 : 1;
  return [...configs].sort(
    (a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0),
  );
}

/** Rebuild a config-keyed map in primary-then-baseline order. */
function orderByConfig<T>(entries: ReadonlyMap<string, T>): Map<string, T> {
  const ordered = new Map<string, T>();
  for (const config of orderConfigs(entries.keys())) {
    ordered.set(config, entries.get(config) as T);
  }
  return ordered;
}

// ---------------------------------------------------------------------------
// Filesystem helpers (Bun-native; no node:fs)
// ---------------------------------------------------------------------------

function joinPath(base: string, ...children: readonly string[]): string {
  return children.reduce((acc, child) => (acc.endsWith("/") ? `${acc}${child}` : `${acc}/${child}`), base);
}

function baseName(path: string): string {
  const trimmed = path.endsWith("/") ? path.slice(0, -1) : path;
  const slash = trimmed.lastIndexOf("/");
  return slash === -1 ? trimmed : trimmed.slice(slash + 1);
}

/** Equivalent of `Path.exists()`: true for files and directories alike. */
async function pathExists(path: string): Promise<boolean> {
  try {
    await Bun.file(path).stat();
    return true;
  } catch {
    return false;
  }
}

/**
 * Equivalent of `Path(dir).glob(pattern)`: returns matching entry paths
 * relative to `dir` (files and directories alike, dotfiles included, as
 * pathlib does), or `[]` when `dir` is missing or is not a directory -- which
 * is what pathlib yields in those cases.
 *
 * Names are sorted with the default string comparison. That is UTF-16 code
 * unit order where CPython uses code point order; the two agree for every name
 * in the Basic Multilingual Plane, which covers all names these layouts
 * produce (`eval-*`, `with_skill`, `run-*`).
 */
async function globSorted(dir: string, pattern: string): Promise<string[]> {
  const names: string[] = [];
  try {
    for await (const name of new Bun.Glob(pattern).scan({
      cwd: dir,
      onlyFiles: false,
      dot: true,
    })) {
      names.push(name);
    }
  } catch {
    return [];
  }
  return names.sort();
}

async function readJson(path: string): Promise<unknown> {
  return (await Bun.file(path).json()) as unknown;
}

// ---------------------------------------------------------------------------
// JSON access helpers
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function getRecord(source: Record<string, unknown>, key: string): Record<string, unknown> {
  return asRecord(source[key]);
}

function getNumber(source: Record<string, unknown>, key: string, fallback: number): number {
  const value = source[key];
  return typeof value === "number" ? value : fallback;
}

function getArray(source: Record<string, unknown>, key: string): readonly unknown[] {
  const value = source[key];
  return Array.isArray(value) ? value : [];
}

/**
 * Equivalent of CPython `int(text)` for the forms a directory name can take.
 * Returns null where CPython raises ValueError, and also where the value would
 * exceed the exact-integer range (CPython ints are unbounded; silently losing
 * precision would be worse than reporting failure).
 */
export function pyParseInt(text: string): number | null {
  const trimmed = text.trim();
  if (!/^[+-]?\d+(?:_\d+)*$/.test(trimmed)) return null;
  const value = Number(trimmed.replaceAll("_", ""));
  return Number.isSafeInteger(value) ? value : null;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

interface EvalIdentity {
  readonly id: EvalId;
  readonly name: string;
}

async function readEvalIdentity(evalDir: string, evalIndex: number): Promise<EvalIdentity> {
  const metadataPath = joinPath(evalDir, "eval_metadata.json");

  if (await pathExists(metadataPath)) {
    try {
      const metadata = asRecord(await readJson(metadataPath));
      const rawId = metadata["eval_id"];
      const id: EvalId = typeof rawId === "number" || typeof rawId === "string" ? rawId : evalIndex;
      // DELIBERATE FIX (not a port bug): aggregate_benchmark.py never reads
      // eval_name, so every run record it emits omits it -- yet schemas.md
      // documents eval_name as the viewer's per-eval section header, and the
      // viewer reads it. It is written into eval_metadata.json right next to
      // eval_id. Reading it here makes the header render instead of falling
      // back to "Eval <id>". Absent metadata yields "", which the viewer
      // already treats as "use the fallback".
      const rawName = metadata["eval_name"];
      return { id, name: typeof rawName === "string" ? rawName : "" };
    } catch {
      return { id: evalIndex, name: "" };
    }
  }

  const parsed = pyParseInt(baseName(evalDir).split("-")[1] ?? "");
  return { id: parsed ?? evalIndex, name: "" };
}

function extractNotes(grading: Record<string, unknown>): readonly unknown[] {
  const summary = getRecord(grading, "user_notes_summary");
  return [
    ...getArray(summary, "uncertainties"),
    ...getArray(summary, "needs_review"),
    ...getArray(summary, "workarounds"),
  ];
}

function checkExpectations(gradingFile: string, expectations: readonly unknown[]): void {
  for (const expectation of expectations) {
    const record = asRecord(expectation);
    // DELIBERATE FIX (not a port bug): the Python warning names three required
    // fields -- text, passed, evidence -- but only checks two. Reconciled
    // toward the message: all three are checked now. That is the safe
    // direction because the warning is advisory (it never blocks aggregation)
    // and schemas.md shows evidence on every graded expectation, so a missing
    // one is a real grader defect worth surfacing.
    if (!("text" in record) || !("passed" in record) || !("evidence" in record)) {
      console.log(
        `Warning: expectation in ${gradingFile} missing required fields (text, passed, evidence): ${JSON.stringify(expectation)}`,
      );
    }
  }
}

async function loadRun(
  runDir: string,
  identity: EvalIdentity,
  configuration: string,
  runNumber: number,
): Promise<RunResult | null> {
  const gradingFile = joinPath(runDir, "grading.json");

  if (!(await pathExists(gradingFile))) {
    console.log(`Warning: grading.json not found in ${runDir}`);
    return null;
  }

  let grading: Record<string, unknown>;
  try {
    grading = asRecord(await readJson(gradingFile));
  } catch (error) {
    console.log(`Warning: Invalid JSON in ${gradingFile}: ${(error as Error).message}`);
    return null;
  }

  const summary = getRecord(grading, "summary");
  let timeSeconds = getNumber(getRecord(grading, "timing"), "total_duration_seconds", 0);
  let tokens: number | undefined;

  // Timing lives in grading.json when the grader recorded it, and in a sibling
  // timing.json when the orchestrator captured it from the task notification.
  const timingFile = joinPath(runDir, "timing.json");
  if (timeSeconds === 0 && (await pathExists(timingFile))) {
    try {
      const timing = asRecord(await readJson(timingFile));
      timeSeconds = getNumber(timing, "total_duration_seconds", 0);
      tokens = getNumber(timing, "total_tokens", 0);
    } catch {
      // Malformed timing.json leaves the grading.json values in place.
    }
  }

  const metrics = getRecord(grading, "execution_metrics");
  const expectations = getArray(grading, "expectations");
  checkExpectations(gradingFile, expectations);

  return {
    evalId: identity.id,
    evalName: identity.name,
    configuration,
    runNumber,
    passRate: getNumber(summary, "pass_rate", 0),
    passed: getNumber(summary, "passed", 0),
    failed: getNumber(summary, "failed", 0),
    total: getNumber(summary, "total", 0),
    timeSeconds,
    tokens: tokens === undefined || tokens === 0 ? getNumber(metrics, "output_chars", 0) : tokens,
    toolCalls: getNumber(metrics, "total_tool_calls", 0),
    errors: getNumber(metrics, "errors_encountered", 0),
    expectations,
    notes: extractNotes(grading),
  };
}

interface DiscoveredRun {
  readonly dir: string;
  readonly runNumber: number;
}

/**
 * The runs inside one configuration directory.
 *
 * Two shapes are in use. `run-1/`, `run-2/`, ... holds repeated runs of the
 * same configuration, which is what the benchmark harness writes. A
 * configuration directory with no `run-*` children is itself the single run --
 * that is the shape SKILL.md prescribes for the manual loop, where each
 * configuration is run once per iteration and `grading.json` sits beside
 * `outputs/`. Reading only the first shape found nothing at all in the second.
 */
async function discoverRuns(configDir: string): Promise<DiscoveredRun[]> {
  const runNames = await globSorted(configDir, "run-*");
  if (runNames.length === 0) return [{ dir: configDir, runNumber: 1 }];

  const runs: DiscoveredRun[] = [];
  for (const runName of runNames) {
    const runNumber = pyParseInt(runName.split("-")[1] ?? "");
    if (runNumber === null) {
      // CPython raises ValueError here and aborts the whole aggregation,
      // losing every run. Warning and skipping matches how this script
      // already handles every other malformed input.
      console.log(`Warning: skipping ${joinPath(configDir, runName)}: run number is not an integer`);
      continue;
    }
    runs.push({ dir: joinPath(configDir, runName), runNumber });
  }
  return runs;
}

/**
 * Does this directory hold per-configuration results for one test case?
 *
 * Tested by contents rather than by name. Eval directories used to be matched
 * with an `eval-*` glob, but SKILL.md asks for a name that says what the case
 * tests -- "pdf-table-extraction" rather than "eval-0" -- so the glob matched
 * nothing in a workspace laid out the way the workflow describes, and the run
 * ended with an empty benchmark and no complaint.
 *
 * `eval_metadata.json` marks the directory outright. Failing that, a child
 * directory holding a `grading.json`, or holding `run-*` directories, means the
 * results of a configuration live below here.
 */
async function isEvalDir(dir: string): Promise<boolean> {
  if (await pathExists(joinPath(dir, "eval_metadata.json"))) return true;

  for (const childName of await globSorted(dir, "*")) {
    const child = joinPath(dir, childName);
    if (await pathExists(joinPath(child, "grading.json"))) return true;
    if ((await globSorted(child, "run-*")).length > 0) return true;
  }
  return false;
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await Bun.file(path).stat()).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Load all run results from a benchmark directory.
 *
 * Returns a map keyed by config name ("with_skill"/"without_skill", or
 * "new_skill"/"old_skill"), each holding a list of run results. Config
 * directories are discovered DYNAMICALLY rather than hardcoded -- that is what
 * makes the old-vs-new baseline mode work. The map is ordered primary-first, so
 * the delta computed from its first two entries reads as improvement.
 *
 * A configuration contributing no readable run gets no entry at all, rather
 * than an entry of zeros: a config that scored nothing and a config whose
 * directory was misread look identical once they are both zero, and the second
 * is the one worth noticing.
 */
export async function loadRunResults(benchmarkDir: string): Promise<Map<string, RunResult[]>> {
  const runsDir = joinPath(benchmarkDir, "runs");
  const searchDir = (await pathExists(runsDir)) ? runsDir : benchmarkDir;

  // Sorted LEXICALLY, so "eval-10" precedes "eval-2". Preserved deliberately.
  const evalNames: string[] = [];
  for (const name of await globSorted(searchDir, "*")) {
    if (await isEvalDir(joinPath(searchDir, name))) evalNames.push(name);
  }

  if (evalNames.length === 0) {
    console.log(`No eval directories found in ${searchDir}`);
    return new Map();
  }

  const results = new Map<string, RunResult[]>();

  for (const [evalIndex, evalName] of evalNames.entries()) {
    const evalDir = joinPath(searchDir, evalName);
    const identity = await readEvalIdentity(evalDir, evalIndex);

    // Config names and run names are sorted separately rather than sorting the
    // joined "config/run-N" paths: '-' sorts below '/', so joined-path order
    // diverges from CPython's nested iteration for names like "a-b" vs "a".
    const configs: string[] = [];
    for (const name of await globSorted(evalDir, "*")) {
      if (await isDirectory(joinPath(evalDir, name))) configs.push(name);
    }

    for (const config of configs) {
      const configDir = joinPath(evalDir, config);
      for (const { dir, runNumber } of await discoverRuns(configDir)) {
        const run = await loadRun(dir, identity, config, runNumber);
        if (run === null) continue;

        let bucket = results.get(config);
        if (bucket === undefined) {
          bucket = [];
          results.set(config, bucket);
        }
        bucket.push(run);
      }
    }
  }

  return orderByConfig(results);
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

function summarize(runs: readonly RunResult[]): ConfigSummary {
  if (runs.length === 0) {
    return { passRate: ZERO_STATS, timeSeconds: ZERO_STATS, tokens: ZERO_STATS };
  }
  return {
    passRate: calculateStats(runs.map((run) => run.passRate)),
    timeSeconds: calculateStats(runs.map((run) => run.timeSeconds)),
    tokens: calculateStats(runs.map((run) => run.tokens)),
  };
}

/**
 * Aggregate run results into per-config summary statistics plus the delta.
 *
 * The delta is `primary - baseline`: the configurations are reordered here
 * rather than trusted in the order they arrive, so a hand-built map or a future
 * caller cannot silently flip the sign of every number this reports.
 */
export function aggregateResults(results: ReadonlyMap<string, readonly RunResult[]>): {
  readonly summaries: Map<string, ConfigSummary>;
  readonly delta: Delta;
} {
  const summaries = new Map<string, ConfigSummary>();
  for (const config of orderConfigs(results.keys())) {
    summaries.set(config, summarize(results.get(config) ?? []));
  }

  const configs = [...summaries.keys()];
  const primary = configs.length >= 1 ? summaries.get(configs[0] as string) : undefined;
  const baseline = configs.length >= 2 ? summaries.get(configs[1] as string) : undefined;

  const meanOf = (summary: ConfigSummary | undefined, metric: keyof ConfigSummary): number =>
    summary === undefined ? 0 : summary[metric].mean;

  return {
    summaries,
    delta: {
      passRate: formatSigned(meanOf(primary, "passRate") - meanOf(baseline, "passRate"), 2),
      timeSeconds: formatSigned(meanOf(primary, "timeSeconds") - meanOf(baseline, "timeSeconds"), 1),
      tokens: formatSigned(meanOf(primary, "tokens") - meanOf(baseline, "tokens"), 0),
    },
  };
}

/** CPython raises TypeError sorting a mixed int/str set; order numbers first. */
function sortEvalIds(ids: Iterable<EvalId>): EvalId[] {
  return [...new Set(ids)].sort((a, b) => {
    if (typeof a === "number" && typeof b === "number") return a - b;
    if (typeof a === "number") return -1;
    if (typeof b === "number") return 1;
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

function utcTimestamp(now: Date): string {
  return `${now.toISOString().slice(0, 19)}Z`;
}

/** Generate the complete benchmark model from run results. */
export async function generateBenchmark(
  benchmarkDir: string,
  skillName = "",
  skillPath = "",
  now: Date = new Date(),
): Promise<Benchmark> {
  const results = await loadRunResults(benchmarkDir);
  const { summaries, delta } = aggregateResults(results);
  const runs = [...results.values()].flat();

  return {
    skillName: skillName || "<skill-name>",
    skillPath: skillPath || "<path/to/skill>",
    executorModel: MODEL_PLACEHOLDER,
    analyzerModel: MODEL_PLACEHOLDER,
    timestamp: utcTimestamp(now),
    evalsRun: sortEvalIds(runs.map((run) => run.evalId)),
    runsPerConfiguration: RUNS_PER_CONFIGURATION,
    summaries,
    delta,
    runs,
    notes: [], // To be filled by analyzer
  };
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

function statsToJson(stats: Stats): Record<string, number> {
  return { mean: stats.mean, stddev: stats.stddev, min: stats.min, max: stats.max };
}

/**
 * Build the `benchmark.json` payload.
 *
 * CONTRACT -- the viewer reads these field names literally. `configuration`
 * (never `config`), valued exactly "with_skill" or "without_skill" for the
 * default mode; per-run stats nested under `result` (never hoisted to the
 * run's top level); `run_summary` keyed by configuration name with a sibling
 * `delta` block. Renaming or flattening any of it makes the viewer render
 * zeros.
 */
export function benchmarkToJson(benchmark: Benchmark): Record<string, unknown> {
  const runSummary: Record<string, unknown> = {};
  for (const [config, summary] of benchmark.summaries) {
    runSummary[config] = {
      pass_rate: statsToJson(summary.passRate),
      time_seconds: statsToJson(summary.timeSeconds),
      tokens: statsToJson(summary.tokens),
    };
  }
  runSummary["delta"] = {
    pass_rate: benchmark.delta.passRate,
    time_seconds: benchmark.delta.timeSeconds,
    tokens: benchmark.delta.tokens,
  };

  return {
    metadata: {
      skill_name: benchmark.skillName,
      skill_path: benchmark.skillPath,
      executor_model: benchmark.executorModel,
      analyzer_model: benchmark.analyzerModel,
      timestamp: benchmark.timestamp,
      evals_run: benchmark.evalsRun,
      runs_per_configuration: benchmark.runsPerConfiguration,
    },
    runs: benchmark.runs.map((run) => ({
      eval_id: run.evalId,
      eval_name: run.evalName,
      configuration: run.configuration,
      run_number: run.runNumber,
      result: {
        pass_rate: run.passRate,
        passed: run.passed,
        failed: run.failed,
        total: run.total,
        time_seconds: run.timeSeconds,
        tokens: run.tokens,
        tool_calls: run.toolCalls,
        errors: run.errors,
      },
      expectations: run.expectations,
      notes: run.notes,
    })),
    run_summary: runSummary,
    notes: benchmark.notes,
  };
}

/**
 * CPython `json.dumps(..., ensure_ascii=True)`: escape every non-ASCII
 * character. Safe to apply after stringification because JSON.stringify only
 * ever emits these code points inside string literals.
 */
export function ensureAscii(json: string): string {
  let out = "";
  for (let i = 0; i < json.length; i += 1) {
    const code = json.charCodeAt(i);
    out += code < 0x80 ? (json[i] as string) : `\\u${code.toString(16).padStart(4, "0")}`;
  }
  return out;
}

export function benchmarkToJsonText(benchmark: Benchmark): string {
  return ensureAscii(JSON.stringify(benchmarkToJson(benchmark), null, 2));
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

/** Generate human-readable benchmark.md from benchmark data. */
export function generateMarkdown(benchmark: Benchmark): string {
  const configs = [...benchmark.summaries.keys()];
  const configA = configs[0] ?? "config_a";
  const configB = configs[1] ?? "config_b";
  const labelA = pyTitle(configA.replaceAll("_", " "));
  const labelB = pyTitle(configB.replaceAll("_", " "));

  const metric = (config: string, key: keyof ConfigSummary): Stats =>
    benchmark.summaries.get(config)?.[key] ?? ZERO_STATS;

  const passA = metric(configA, "passRate");
  const passB = metric(configB, "passRate");
  const timeA = metric(configA, "timeSeconds");
  const timeB = metric(configB, "timeSeconds");
  const tokensA = metric(configA, "tokens");
  const tokensB = metric(configB, "tokens");

  const lines = [
    `# Skill Benchmark: ${benchmark.skillName}`,
    "",
    `**Model**: ${benchmark.executorModel}`,
    `**Date**: ${benchmark.timestamp}`,
    `**Evals**: ${benchmark.evalsRun.join(", ")} (${benchmark.runsPerConfiguration} runs each per configuration)`,
    "",
    "## Summary",
    "",
    `| Metric | ${labelA} | ${labelB} | Delta |`,
    "|--------|------------|---------------|-------|",
    `| Pass Rate | ${formatFixed(passA.mean * 100, 0)}% ± ${formatFixed(passA.stddev * 100, 0)}% | ${formatFixed(passB.mean * 100, 0)}% ± ${formatFixed(passB.stddev * 100, 0)}% | ${benchmark.delta.passRate} |`,
    `| Time | ${formatFixed(timeA.mean, 1)}s ± ${formatFixed(timeA.stddev, 1)}s | ${formatFixed(timeB.mean, 1)}s ± ${formatFixed(timeB.stddev, 1)}s | ${benchmark.delta.timeSeconds}s |`,
    `| Tokens | ${formatFixed(tokensA.mean, 0)} ± ${formatFixed(tokensA.stddev, 0)} | ${formatFixed(tokensB.mean, 0)} ± ${formatFixed(tokensB.stddev, 0)} | ${benchmark.delta.tokens} |`,
  ];

  if (benchmark.notes.length > 0) {
    lines.push("", "## Notes", "");
    for (const note of benchmark.notes) {
      lines.push(`- ${note}`);
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = "Usage: bun shared/scripts/aggregate-results.ts <benchmark-dir> [options]";

export const CLI_SPEC: Spec = {
  "skill-name": { kind: "string", default: "", help: "name of the skill being benchmarked" },
  "skill-path": { kind: "string", default: "", help: "path to the skill being benchmarked" },
  output: {
    kind: "string",
    short: "o",
    help: "output path for benchmark.json (default: <benchmark-dir>/benchmark.json)",
  },
  help: { kind: "boolean", default: false, help: "show this message" },
};

function stringFlag(flags: ParsedArgs["flags"], name: string): string | undefined {
  const value = flags[name];
  return typeof value === "string" ? value : undefined;
}

/** Equivalent of `Path.with_suffix()`: replaces the final suffix of the name. */
export function withSuffix(path: string, suffix: string): string {
  const slash = path.lastIndexOf("/");
  const dir = slash === -1 ? "" : path.slice(0, slash + 1);
  const name = path.slice(slash + 1);
  const dot = name.lastIndexOf(".");
  return `${dir}${dot > 0 ? name.slice(0, dot) : name}${suffix}`;
}

async function run(
  benchmarkDir: string,
  skillName: string,
  skillPath: string,
  output: string | undefined,
): Promise<number> {
  if (!(await pathExists(benchmarkDir))) {
    console.log(`Directory not found: ${benchmarkDir}`);
    return 1;
  }

  // On the main eval path: SKILL.md has the reader run this right after the viewer, so a
  // status file with nothing displaying it would be the common case. Idempotent by probe.
  await ensureDashboard();

  // Aggregation reads every grading.json under the workspace, so its duration scales
  // with the run count and it prints nothing until it finishes. The total is not known
  // before the walk, so this reports a phase rather than a count -- which is still the
  // difference between "working" and "hung".
  const reporter = ProgressReporter.start({
    kind: "benchmark",
    label: `aggregate — ${baseName(benchmarkDir)}`,
    total: 0,
    subject: baseName(benchmarkDir),
    detail: { phase: "reading run results" },
  });

  let benchmark: Benchmark;
  try {
    benchmark = await generateBenchmark(benchmarkDir, skillName, skillPath);
    reporter.update({ phase: "writing benchmark" }, { total: benchmark.runs.length, settled: benchmark.runs.length });
  } catch (error) {
    await reporter.finish("failed", error instanceof Error ? error.message : String(error));
    throw error;
  }

  if (benchmark.runs.length === 0) {
    // Nothing is written in this case, and the exit code says so. An empty
    // benchmark.json reads as a measured zero rather than as a missing
    // measurement, the viewer renders it without complaint, and the run that
    // produced it looks finished -- so the failure surfaced hours later, if at
    // all, and overwrote whatever the previous iteration had left behind.
    console.log(`\nNo runs found under ${benchmarkDir}. Nothing was aggregated, and no benchmark was written.`);
    console.log(
      "Each test case wants a directory holding one subdirectory per configuration — `with_skill`,\n" +
        "`without_skill`, `new_skill` or `old_skill` — and each of those wants a `grading.json`, either\n" +
        "directly inside it or inside `run-1/`, `run-2/`, ... Grade the runs first if that step is still\n" +
        "outstanding; the grader writes exactly that file.",
    );
    await reporter.finish("failed", "no runs found");
    return 1;
  }

  const outputJson = output ?? joinPath(benchmarkDir, "benchmark.json");
  const outputMd = withSuffix(outputJson, ".md");

  await Bun.write(outputJson, benchmarkToJsonText(benchmark));
  console.log(`Generated: ${outputJson}`);

  await Bun.write(outputMd, generateMarkdown(benchmark));
  console.log(`Generated: ${outputMd}`);

  // Recorded so this run's page shows its own output. The markdown first: it is the
  // human-readable summary, and the JSON beside it is the machine contract.
  reporter.update({ artifactPaths: [outputMd, outputJson] });

  console.log("\nSummary:");
  for (const [config, summary] of benchmark.summaries) {
    console.log(
      `  ${pyTitle(config.replaceAll("_", " "))}: ${formatFixed(summary.passRate.mean * 100, 1)}% pass rate`,
    );
  }
  console.log(`  Delta:         ${benchmark.delta.passRate}`);

  await reporter.finish("done");
  return 0;
}

/** Exit codes: 0 ok, 1 nothing to aggregate, 2 usage error -- matching validate-skill.ts. */
if (import.meta.main) {
  try {
    const { flags, positionals } = parseArgs(Bun.argv.slice(2), CLI_SPEC);

    if (flags["help"] === true) {
      console.log(formatHelp(USAGE, CLI_SPEC));
      process.exit(0);
    }

    const benchmarkDir = positionals[0];
    if (benchmarkDir === undefined) throw new CliError(`missing <benchmark-dir>\n${USAGE}`);
    if (positionals.length > 1) {
      throw new CliError(`unexpected extra argument: ${positionals[1]}\n${USAGE}`);
    }

    process.exit(
      await run(
        benchmarkDir,
        stringFlag(flags, "skill-name") ?? "",
        stringFlag(flags, "skill-path") ?? "",
        stringFlag(flags, "output"),
      ),
    );
  } catch (error) {
    if (!(error instanceof CliError)) throw error;
    console.log(`Error: ${error.message}`);
    process.exit(2);
  }
}
