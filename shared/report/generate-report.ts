#!/usr/bin/env bun
/**
 * Generate an HTML report from optimize-description output.
 *
 * Takes the JSON output from optimize-description.ts and generates a visual HTML report
 * showing each description attempt with check/x for each test case.
 * Distinguishes between train and test queries.
 *
 * Usage:
 *     bun run scripts/generate-report.ts <input.json|-> [-o OUTPUT] [--skill-name NAME]
 */

import { CliError, formatHelp, parseArgs, type ParsedArgs, type Spec } from "../cli.ts";
import { htmlEscape } from "../util/pyfloat.ts";
import {
  DESIGN_COMPONENTS,
  THEME_PREPAINT_SCRIPT,
  THEME_TOKENS,
} from "./theme.ts";

// ---------------------------------------------------------------------------
// Input shapes
// ---------------------------------------------------------------------------

export interface QueryInfo {
  readonly query: string;
  readonly shouldTrigger: boolean;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function getRecords(source: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const value = source[key];
  return Array.isArray(value) ? value.map(asRecord) : [];
}

function getNumber(source: Record<string, unknown>, key: string, fallback: number): number {
  const value = source[key];
  return typeof value === "number" ? value : fallback;
}

function getBoolean(source: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = source[key];
  return typeof value === "boolean" ? value : fallback;
}

function getString(source: Record<string, unknown>, key: string, fallback: string): string {
  const value = source[key];
  return typeof value === "string" ? value : fallback;
}

/** CPython f-string interpolation of a `dict.get(key, fallback)` result. */
function displayValue(value: unknown, fallback: string): string {
  if (value === undefined) return fallback;
  if (value === null) return "None";
  return String(value);
}

/**
 * `results`, falling back to the pre-split key.
 *
 * DELIBERATE FIX (not a port bug): `generate_report.py` reads test results with
 * `h.get("test_results", [])`, but run_loop writes an explicit `null` for that
 * key whenever the eval ran with `--holdout 0`. `.get` only substitutes its
 * default for an ABSENT key, so the value came back as None and
 * `aggregate_runs` raised `TypeError: 'NoneType' object is not iterable` --
 * a hard crash on a documented configuration ("0 to disable"). Treating null
 * like a missing key fixes it; verified against the upstream script, which
 * fails on the same input.
 */
function resultRows(source: Record<string, unknown>, key: string, fallbackKey?: string): Record<string, unknown>[] {
  const value = source[key];
  if (value === null || value === undefined) {
    return fallbackKey === undefined ? [] : getRecords(source, fallbackKey);
  }
  return getRecords(source, key);
}

function toQueryInfo(rows: readonly Record<string, unknown>[]): QueryInfo[] {
  return rows.map((row) => ({
    query: getString(row, "query", ""),
    shouldTrigger: getBoolean(row, "should_trigger", true),
  }));
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/** Aggregate correct/total runs across all retries. */
function aggregateRuns(rows: readonly Record<string, unknown>[]): readonly [number, number] {
  let correct = 0;
  let total = 0;
  for (const row of rows) {
    const runs = getNumber(row, "runs", 0);
    const triggers = getNumber(row, "triggers", 0);
    total += runs;
    correct += getBoolean(row, "should_trigger", true) ? triggers : runs - triggers;
  }
  return [correct, total];
}

function scoreClass(correct: number, total: number): string {
  if (total > 0) {
    const ratio = correct / total;
    if (ratio >= 0.8) return "score-good";
    if (ratio >= 0.5) return "score-ok";
  }
  return "score-bad";
}

/** CPython `max(seq, key=...)`: the FIRST maximal element wins. */
function argMaxFirst<T>(items: readonly T[], key: (item: T) => number): T | undefined {
  let best: T | undefined;
  let bestKey = Number.NEGATIVE_INFINITY;
  for (const item of items) {
    const value = key(item);
    if (best === undefined || value > bestKey) {
      best = item;
      bestKey = value;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

const STYLE = `    <style>
${THEME_TOKENS}
${DESIGN_COMPONENTS}

        body {
            font-family: var(--sans);
            max-width: 100%;
            margin: 0 auto;
            padding: 20px;
            background: var(--bg);
            color: var(--text);
        }
        h1 { font-family: var(--sans); color: var(--text); }
        .explainer {
            background: var(--surface);
            padding: 15px;
            border-radius: 6px;
            margin-bottom: 20px;
            border: 1px solid var(--border);
            color: var(--muted);
            font-size: 0.875rem;
            line-height: 1.6;
        }
        .summary {
            background: var(--surface);
            padding: 15px;
            border-radius: 6px;
            margin-bottom: 20px;
            border: 1px solid var(--border);
        }
        .summary p { margin: 5px 0; }
        .best { color: var(--good); font-weight: bold; }
        .wrap { max-width: 960px; margin: 0 auto; padding: 0 20px 48px; }
        section.sec:first-child { border-top: 0; padding-top: 24px; }
        /*
         * THE ONE EXCEPTION to the 960px reading column, stated rather than silent.
         *
         * This table has four fixed columns plus one per eval-set query -- at 20 queries that
         * is 24 columns. Constraining it to 960px would make a table that currently scrolls
         * legibly into one that is unreadable, so the container alone breaks out of the column
         * while every other block on the page stays inside it. The source is a reading-width
         * document and has no equivalent of a 24-column table; this is ours, not a port.
         */
        .table-container {
            overflow-x: auto;
            width: 100vw;
            max-width: 100vw;
            margin-left: calc(50% - 50vw);
            padding: 0 20px;
        }
        table {
            border-collapse: collapse;
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 6px;
            font-size: 12px;
            min-width: 100%;
        }
        th, td {
            padding: 8px;
            text-align: left;
            border: 1px solid var(--border);
            white-space: normal;
            word-wrap: break-word;
        }
        th {
            font-family: var(--sans);
            background: var(--surface-2);
            color: var(--muted);
            font-weight: 500;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: .05em;
        }
        /* Held-out columns are distinguished by an accent underline rather than a filled
           background: a solid accent block per column overwhelmed the results it labels. */
        th.test-col {
            color: var(--accent);
        }
        th.query-col { min-width: 200px; }
        td.description {
            font-family: monospace;
            font-size: 11px;
            word-wrap: break-word;
            max-width: 400px;
        }
        td.result {
            text-align: center;
            font-size: 16px;
            min-width: 40px;
        }
        td.test-result {
            background: var(--surface-2);
        }
        .pass { color: var(--good); }
        .fail { color: var(--bad); }
        .rate {
            font-size: 9px;
            color: var(--muted);
            display: block;
        }
        tr:hover { background: var(--surface-2); }
        .score {
            display: inline-block;
            padding: 2px 6px;
            border-radius: 4px;
            font-weight: bold;
            font-size: 11px;
        }
        .score-good { background: var(--surface-2); color: var(--good); }
        .score-ok { background: var(--surface-2); color: var(--warn); }
        .score-bad { background: var(--surface-2); color: var(--bad); }
        .train-label { color: var(--muted); font-size: 10px; }
        .test-label { color: var(--accent); font-size: 10px; font-weight: bold; }
        .best-row { background: var(--surface-2); }
        th.positive-col { border-bottom: 3px solid var(--good); }
        th.negative-col { border-bottom: 3px solid var(--bad); }
        th.test-col.positive-col { border-bottom: 3px solid var(--good); }
        th.test-col.negative-col { border-bottom: 3px solid var(--bad); }
        .in-progress-row { background: var(--surface-2); }
        .progress-cell { padding: 10px 8px; }
        .progress-track {
            background: var(--border);
            border-radius: 4px;
            height: 10px;
            overflow: hidden;
            min-width: 160px;
        }
        .progress-fill {
            background: var(--accent);
            height: 100%;
            border-radius: 4px;
            /* No CSS transition: the page is replaced wholesale by a meta refresh, so
               there is no continuous element for a transition to animate between. */
        }
        .progress-meta {
            font-family: var(--sans);
            font-size: 11px;
            color: var(--muted);
            margin-top: 4px;
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
        }
        .progress-phase { color: var(--text); font-weight: 500; }
        .pending-cell { text-align: center; color: var(--border); font-size: 16px; }
        /* Renamed from .legend so the ported rule of that name stays verbatim: the source
           uses .legend for a COLUMN of definition rows, this is a horizontal swatch row. */
        .col-legend { font-family: var(--sans); display: flex; gap: 20px; margin-bottom: 10px; font-size: 13px; align-items: center; }
        .col-legend-item { display: flex; align-items: center; gap: 6px; }
        .col-legend-swatch { width: 16px; height: 16px; border-radius: 3px; display: inline-block; }
        .swatch-positive { background: var(--surface-3); border-bottom: 3px solid var(--good); }
        .swatch-negative { background: var(--surface-3); border-bottom: 3px solid var(--bad); }
        .swatch-test { background: var(--accent); }
        .swatch-train { background: var(--surface-3); }
    </style>
</head>
<body>
`;

/**
 * The explainer, as prose for a `.note` rather than its own bespoke box.
 *
 * The source states every caveat in a `.note` with an uppercase `.nb` label -- a running
 * commentary qualifying the data beside it -- so this is that, not a fourth kind of callout.
 */
const EXPLAINER_TEXT = `<strong>This page updates itself as Claude tests candidate descriptions.</strong>
    A tick means the skill did what the query expected: triggered on a positive, stayed quiet on a
    negative. The train score covers queries used to propose improvements; the held-out score covers
    queries the optimizer never saw, which is why the selected description is chosen on that one.`;

const LEGEND = `
    <div class="col-legend">
        <span style="font-weight:600">Query columns:</span>
        <span class="col-legend-item"><span class="col-legend-swatch swatch-positive"></span> Should trigger</span>
        <span class="col-legend-item"><span class="col-legend-swatch swatch-negative"></span> Should NOT trigger</span>
        <span class="col-legend-item"><span class="col-legend-swatch swatch-train"></span> Train</span>
        <span class="col-legend-item"><span class="col-legend-swatch swatch-test"></span> Test</span>
    </div>
`;

const TABLE_HEAD = `
    <div class="table-container">
    <table>
        <thead>
            <tr>
                <th>Iter</th>
                <th>Train</th>
                <th>Test</th>
                <th class="query-col">Description</th>
`;

function resultCell(row: Record<string, unknown>, extraClass: string): string {
  const didPass = getBoolean(row, "pass", false);
  const triggers = getNumber(row, "triggers", 0);
  const runs = getNumber(row, "runs", 0);
  const icon = didPass ? "✓" : "✗";
  const cssClass = didPass ? "pass" : "fail";
  return `                <td class="result ${extraClass}${cssClass}">${icon}<span class="rate">${triggers}/${runs}</span></td>\n`;
}

function headerCells(queries: readonly QueryInfo[], extraClass: string): string {
  return queries
    .map((info) => {
      const polarity = info.shouldTrigger ? "positive-col" : "negative-col";
      return `                <th class="${extraClass}${polarity}">${htmlEscape(info.query)}</th>\n`;
    })
    .join("");
}

/** Whole seconds as `1m 40s`, or `40s` under a minute. Approximate by nature, so no decimals. */
function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  const minutes = Math.trunc(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

/**
 * Render the in-flight iteration as a progress row.
 *
 * Deliberately spans the same columns as a results row and carries the same iteration
 * number, because that is what makes it a placeholder: the next report writes a real
 * row at this position and the bar is gone. Query cells render as empty pending marks
 * rather than being omitted, so the table does not reflow its column widths when the
 * swap happens.
 */
function inProgressRow(
  progress: InProgress,
  trainQueries: readonly QueryInfo[],
  testQueries: readonly QueryInfo[],
  now: number,
): string {
  const percent =
    progress.total > 0 ? Math.min(100, Math.round((progress.settled / progress.total) * 100)) : 0;

  const meta: string[] = [`<span class="progress-phase">${htmlEscape(progress.phase)}</span>`];
  if (progress.total > 0) meta.push(`${progress.settled}/${progress.total} runs`);
  if (progress.startedAt !== undefined) {
    meta.push(`${formatDuration(now - progress.startedAt)} elapsed`);
  }
  // Presented as approximate because it is extrapolated from observed completions and
  // per-call durations were measured from 13s to 124s -- a hard countdown would imply
  // a precision the measurement does not have.
  if (progress.remainingMs !== undefined) meta.push(`~${formatDuration(progress.remainingMs)} left`);

  const parts = [
    `            <tr class="in-progress-row">
                <td>${progress.iteration}</td>
                <td colspan="2" class="progress-cell">
                    <div class="progress-track"><div class="progress-fill" style="width:${percent}%"></div></div>
                    <div class="progress-meta">${meta.join("<span>·</span>")}</div>
                </td>
                <td class="description">${htmlEscape(progress.description ?? "")}</td>
`,
  ];
  for (let i = 0; i < trainQueries.length; i += 1) {
    parts.push(`                <td class="pending-cell">·</td>\n`);
  }
  for (let i = 0; i < testQueries.length; i += 1) {
    parts.push(`                <td class="pending-cell test-result">·</td>\n`);
  }
  parts.push("            </tr>\n");
  return parts.join("");
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

/**
 * The loop output this report reads.
 *
 * Every field is optional because the Python reads the dict entirely through
 * `.get(key, default)` and renders a usable page from a partial one --
 * behaviour `optimize-description.ts` depends on, since the live mid-run report is written
 * before any verdict fields exist. Both `LoopReportInput` and the fuller
 * `LoopOutput` exported by `optimize-description.ts` are assignable to this, so either can
 * be passed without a cast.
 */
export interface LoopOutput {
  readonly original_description?: unknown;
  readonly best_description?: unknown;
  readonly best_score?: unknown;
  readonly best_test_score?: unknown;
  readonly iterations_run?: unknown;
  readonly holdout?: unknown;
  readonly train_size?: unknown;
  readonly test_size?: unknown;
  readonly history?: readonly unknown[];
  /**
   * The work currently in flight, rendered as a progress row where its results row
   * will land. Absent once nothing is in flight, which is what makes the row a
   * placeholder rather than a permanent fixture.
   */
  readonly in_progress?: InProgress;
}

/**
 * A phase of the loop that has started but not produced a history entry yet.
 *
 * This is the whole fix for the blind window. The report only ever grew a row when an
 * iteration COMPLETED, so the page showed "Starting optimization loop..." for the
 * entire duration of iteration 1 -- minutes, during which the meta-refresh dutifully
 * re-fetched a page with nothing new on it. A run and a hang looked identical.
 *
 * `iteration` is the number the finished row will carry, so the placeholder sits in
 * the position the results take, and is replaced rather than appended to.
 */
export interface InProgress {
  readonly iteration: number;
  readonly settled: number;
  readonly total: number;
  /** Shown beside the bar: "baseline evaluation", "improving description", etc. */
  readonly phase: string;
  /** Epoch ms, for the elapsed reading. */
  readonly startedAt?: number;
  /** Projected ms remaining, derived from observed completions. Omitted when unknown. */
  readonly remainingMs?: number;
  /** The description under test, shown so the row is informative before it has a score. */
  readonly description?: string;
}

export interface ReportOptions {
  /**
   * Adds a meta refresh tag, for the live report written between iterations.
   *
   * Defaults to FALSE, matching `generate_html(data, auto_refresh=False, ...)`.
   * A final report that reloads itself every five seconds forever is the bug
   * this default exists to avoid; `optimize-description.ts` passes the flag explicitly at
   * both of its call sites, so only the CLI path relies on the default.
   */
  readonly autoRefresh?: boolean;
  /** Prefixes the page title and heading. Defaults to "", as the Python does. */
  readonly skillName?: string;
  /**
   * Column headers to use before any iteration has finished.
   *
   * Headers are normally derived from `history[0]`, which does not exist during the
   * baseline evaluation -- so without this the first live report would render a bar
   * with no columns beside it and then reflow once results landed.
   */
  readonly plannedQueries?: {
    readonly train: readonly QueryInfo[];
    readonly test: readonly QueryInfo[];
  };
  /** Injected for deterministic elapsed readings in tests. Defaults to now. */
  readonly now?: number;
}

/**
 * Generate the HTML report from loop output data.
 *
 * The Python took `auto_refresh` and `skill_name` as keyword arguments after
 * one positional; they are an options object here because two adjacent
 * optional parameters -- one boolean, one string -- are exactly the shape that
 * gets passed in the wrong order, and `optimize-description.ts` resolves this module at
 * runtime, where a swap would not be caught by tsc.
 */
export function generateHtml(output: LoopOutput, opts: ReportOptions = {}): string {
  const { autoRefresh = false, skillName = "", plannedQueries, now = Date.now() } = opts;
  const root = asRecord(output);
  const history = getRecords(root, "history");
  const titlePrefix = skillName ? htmlEscape(`${skillName} — `) : "";

  const first = history[0];
  // Planned queries only stand in while there is no history to read them from. Once a
  // row exists it is authoritative, so a mid-run change of eval set cannot desync the
  // headers from the cells beneath them.
  const trainQueries =
    first === undefined
      ? (plannedQueries?.train ?? [])
      : toQueryInfo(resultRows(first, "train_results", "results"));
  const testQueries =
    first === undefined
      ? (plannedQueries?.test ?? [])
      : resultRows(first, "test_results").length === 0
        ? []
        : toQueryInfo(resultRows(first, "test_results"));

  const refreshTag = autoRefresh ? '    <meta http-equiv="refresh" content="5">\n' : "";
  const bestTestScore = root["best_test_score"];

  const parts: string[] = [
    `<!DOCTYPE html>\n<html>\n<head>\n    <meta charset="utf-8">\n${THEME_PREPAINT_SCRIPT}\n`,
    refreshTag,
    `    <title>${titlePrefix}Skill Description Optimization</title>\n`,
    STYLE,
    `<div class="wrap">\n`,
    // Section in the source's shape: eyebrow + h2 on the left, a .desc explaining what the
    // reader is looking at on the right.
    `    <section class="sec">
        <div class="sec-head">
            <div>
                <div class="eyebrow">outcome</div>
                <h2>${titlePrefix}Description optimization</h2>
            </div>
            <p class="desc">Each iteration proposes a new description and re-scores it. The selected
            one is chosen on the HELD-OUT score, not the training score: a description tuned until it
            aces its own training queries has usually just memorised them.</p>
        </div>
`,
    // .metric tiles for the headline figures -- label, value, footnote -- rather than a
    // paragraph list. .mf carries the qualification that makes each number readable.
    `        <div class="g3">
            <div class="metric">
                <div class="ml">selected score</div>
                <div class="mv">${displayValue(root["best_score"], "N/A")}</div>
                <div class="mf">${bestTestScore ? "on held-out queries the optimizer never saw" : "on training queries; no held-out split was run"}</div>
            </div>
            <div class="metric">
                <div class="ml">iterations</div>
                <div class="mv">${displayValue(root["iterations_run"], "0")}</div>
                <div class="mf">each one a full re-score of every query</div>
            </div>
            <div class="metric">
                <div class="ml">split</div>
                <div class="mv">${displayValue(root["train_size"], "?")}/${displayValue(root["test_size"], "?")}</div>
                <div class="mf">train / held-out, stratified by expected polarity</div>
            </div>
        </div>
`,
    `        <div class="note">
            <div class="nb">how to read this</div>
            <div>${EXPLAINER_TEXT}</div>
        </div>
    </section>
`,
    // The table is its own section: it is a different kind of reading from the summary above.
    `    <section class="sec">
        <div class="sec-head">
            <div>
                <div class="eyebrow">per iteration</div>
                <h2>Attempts</h2>
            </div>
            <p class="desc">One row per iteration, one column per query. A tick means the skill did
            what that query expected of it — triggering on a positive, or staying quiet on a
            negative. The rate beneath each mark is how many of that query's attempts agreed.</p>
        </div>
`,
    LEGEND,
    TABLE_HEAD,
    headerCells(trainQueries, ""),
    headerCells(testQueries, "test-col "),
    `            </tr>\n        </thead>\n        <tbody>\n`,
  ];

  // Find the best iteration for highlighting. CPython raises ValueError on an
  // empty history; there are no rows to highlight in that case, so skip it.
  const bestIteration =
    testQueries.length > 0
      ? argMaxFirst(history, (h) => getNumber(h, "test_passed", 0))
      : argMaxFirst(history, (h) =>
          "train_passed" in h ? getNumber(h, "train_passed", 0) : getNumber(h, "passed", 0),
        );
  const bestIterationId = bestIteration === undefined ? undefined : bestIteration["iteration"];

  for (const entry of history) {
    const iteration = displayValue(entry["iteration"], "?");
    const trainResults = resultRows(entry, "train_results", "results");
    const testResults = resultRows(entry, "test_results");

    const trainByQuery = new Map(trainResults.map((row) => [getString(row, "query", ""), row]));
    const testByQuery = new Map(testResults.map((row) => [getString(row, "query", ""), row]));

    const [trainCorrect, trainRuns] = aggregateRuns(trainResults);
    const [testCorrect, testRuns] = aggregateRuns(testResults);

    const rowClass =
      bestIterationId !== undefined && entry["iteration"] === bestIterationId ? "best-row" : "";

    parts.push(`            <tr class="${rowClass}">
                <td>${iteration}</td>
                <td><span class="score ${scoreClass(trainCorrect, trainRuns)}">${trainCorrect}/${trainRuns}</span></td>
                <td><span class="score ${scoreClass(testCorrect, testRuns)}">${testCorrect}/${testRuns}</span></td>
                <td class="description">${htmlEscape(getString(entry, "description", ""))}</td>
`);

    for (const info of trainQueries) {
      parts.push(resultCell(trainByQuery.get(info.query) ?? {}, ""));
    }
    for (const info of testQueries) {
      parts.push(resultCell(testByQuery.get(info.query) ?? {}, "test-result "));
    }
    parts.push("            </tr>\n");
  }

  // Appended AFTER every finished row, so it always sits in the position the next
  // results row will occupy. The swap needs no diffing: the following report either
  // carries a history entry for this iteration (and the placeholder moves down to the
  // next one) or carries no `in_progress` at all (and the bar disappears).
  const progress = readInProgress(root["in_progress"]);
  if (progress !== null) parts.push(inProgressRow(progress, trainQueries, testQueries, now));

  parts.push(
    `        </tbody>\n    </table>\n    </div>\n`,
    // .fine under the data, per the source: every data panel is followed by small print
    // saying how to read it. Ours says which half is the hard half, which the numbers alone
    // do not convey.
    `        <p class="fine">A negative query is the harder half: a description broad enough to
        catch every positive usually catches these too, so a run that scores well on both is
        the one worth applying.</p>
    </section>
`,
    `</div>\n`,
    `\n</body>\n</html>\n`,
  );

  return parts.join("");
}

/**
 * Read the in-flight block, tolerating a partial one.
 *
 * Read defensively for the same reason every other field here is: this module is
 * resolved at runtime by `optimize-description.ts`, so a shape mismatch would surface as a broken
 * page rather than a type error.
 */
function readInProgress(value: unknown): InProgress | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const iteration = record["iteration"];
  if (typeof iteration !== "number") return null;

  const startedAt = record["startedAt"];
  const remainingMs = record["remainingMs"];
  const description = record["description"];
  return {
    iteration,
    settled: getNumber(record, "settled", 0),
    total: getNumber(record, "total", 0),
    phase: getString(record, "phase", "working"),
    ...(typeof startedAt === "number" ? { startedAt } : {}),
    ...(typeof remainingMs === "number" ? { remainingMs } : {}),
    ...(typeof description === "string" ? { description } : {}),
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = "Usage: bun shared/report/generate-report.ts <input.json|-> [options]";

export const CLI_SPEC: Spec = {
  output: { kind: "string", short: "o", help: "write the HTML here instead of stdout" },
  "skill-name": { kind: "string", default: "", help: "skill name to include in the report title" },
  help: { kind: "boolean", default: false, help: "show this message" },
};

function stringFlag(flags: ParsedArgs["flags"], name: string): string | undefined {
  const value = flags[name];
  return typeof value === "string" ? value : undefined;
}

async function run(input: string, output: string | undefined, skillName: string): Promise<number> {
  const text = input === "-" ? await Bun.stdin.text() : await Bun.file(input).text();
  // autoRefresh is false here for the same reason the Python CLI never passes
  // it: this is a finished report, not the live one optimize-description rewrites.
  const html = generateHtml(JSON.parse(text) as LoopOutput, { autoRefresh: false, skillName });

  if (output === undefined) {
    console.log(html);
  } else {
    await Bun.write(output, html);
    console.error(`Report written to ${output}`);
  }
  return 0;
}

/** Exit codes: 0 ok, 2 usage error -- matching validate-skill.ts. */
if (import.meta.main) {
  try {
    const { flags, positionals } = parseArgs(Bun.argv.slice(2), CLI_SPEC);

    if (flags["help"] === true) {
      console.log(formatHelp(USAGE, CLI_SPEC));
      process.exit(0);
    }

    const input = positionals[0];
    if (input === undefined) throw new CliError(`missing <input.json|->\n${USAGE}`);
    if (positionals.length > 1) {
      throw new CliError(`unexpected extra argument: ${positionals[1]}\n${USAGE}`);
    }

    process.exit(await run(input, stringFlag(flags, "output"), stringFlag(flags, "skill-name") ?? ""));
  } catch (error) {
    if (!(error instanceof CliError)) throw error;
    console.log(`Error: ${error.message}`);
    process.exit(2);
  }
}
