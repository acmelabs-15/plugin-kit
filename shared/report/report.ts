#!/usr/bin/env bun
/**
 * Render a results envelope as a self-contained HTML page.
 *
 * WHY A SCRIPT WRITES THE DATA AND AN AGENT WRITES ONLY THE PROSE
 * ---------------------------------------------------------------
 * Data cannot be half-injected. An earlier shape of this flow had an agent copying a
 * template and editing the numbers in by hand; a partial edit produced a page full of
 * plausible zeros, which is the worst possible failure for a reporting layer -- wrong and
 * confident. Here the script embeds every figure in one write, and the only hand-edited
 * region is the `<!-- AGENT: findings -->` slot in `template.html`. A slot nobody filled in
 * renders as a loud empty state, so a missing narrative is visibly incomplete rather than
 * quietly wrong.
 *
 * WHY IT IS NOT A FIFTH RENDERER
 * ------------------------------
 * `envelope.ts` says it plainly: a shared renderer written against one producer's data is
 * another renderer with a better name. So nothing in this file branches on which operation
 * produced the envelope. `run.operation` reaches the page as a label and as the document
 * title; that is the whole of its influence. Rows are rendered from columns DERIVED from
 * the rows themselves, headline metrics from `headline`, verdicts from `verdicts` -- all
 * four current producers and any fifth get the identical code path.
 *
 * WHAT THE PAGE MUST CARRY
 * ------------------------
 * `run` and `provenance` are rendered as first-class sections, not as a footer. A report
 * that shows numbers without the conditions they were taken under is the exact defect the
 * envelope exists to prevent: a sweep once reported 21% recall against a truth of 71%
 * because a stale copy of the target was installed under a previous name and won sixteen
 * probes, with nothing in the output saying so. `installState` and `targetSha` are on the
 * page for that reason.
 *
 * `provenance.caps` is coverage -- what the run did NOT look at -- and an empty list is a
 * claim rather than an absence, so the page states it in words instead of leaving a gap.
 *
 * COMPARISON GOES THROUGH THE CONTRACT
 * ------------------------------------
 * Any delta shown is gated by {@link compareRuns}. When the two `run` blocks disagree on a
 * comparability key the page prints {@link explainIncomparability}'s sentence and draws no
 * delta at all. This file never decides for itself that two numbers may be subtracted.
 *
 * Pure Bun. `Bun.file`, `Bun.write`; no npm runtime dependency, no spawned tool, and the
 * emitted page loads nothing over the network.
 *
 * Usage:
 *     bun run report.ts <envelope.json> [--out PATH] [--baseline PATH]
 */

import { injectAppBar } from "./app-bar.ts";
import { CliError, formatHelp, parseArgs, type Spec } from "../cli.ts";
import {
  compareRuns,
  explainIncomparability,
  readEnvelope,
  type Comparability,
  type Envelope,
  type HeadlineMetric,
  type Provenance,
  type RunBlock,
} from "../envelope.ts";

/** Comment token in `template.html` replaced with the embedded data assignment. */
export const EMBEDDED_DATA_TOKEN = "/*__EMBEDDED_DATA__*/";

/** The marker in `template.html` naming the one region a hand edit belongs in. */
export const FINDINGS_SLOT = "<!-- AGENT: findings -->";

// ---------------------------------------------------------------------------
// The payload the page consumes
// ---------------------------------------------------------------------------

/** One `[key, value]` pair rendered as a labelled box. Order is the render order. */
export type FieldEntry = readonly [label: string, value: string | number | boolean | null];

/**
 * A column of the rows table, derived from the rows rather than declared per operation.
 *
 * `numeric` decides right-alignment only. It is `true` when ANY row carries a number under
 * the key, because a column of counts with one `null` in it is still a column of counts.
 */
export interface RowColumn {
  readonly key: string;
  readonly label: string;
  readonly numeric: boolean;
}

/** One metric lined up against its baseline, only ever built for a comparable pair. */
export interface MetricDelta {
  readonly label: string;
  readonly baseline: number;
  readonly current: number;
  readonly delta: number;
}

/** What the page is told about a baseline run. */
export interface ComparisonBlock {
  readonly baselineRunId: string;
  readonly baselineStartedAt: string;
  readonly comparable: boolean;
  readonly differing: readonly string[];
  readonly advisory: readonly string[];
  /** {@link explainIncomparability}'s sentence, or null when the runs are comparable. */
  readonly explanation: string | null;
  /** Empty whenever `comparable` is false. Nothing is subtracted across an incomparable pair. */
  readonly deltas: readonly MetricDelta[];
}

/** Everything `template.html` reads. Nothing is computed in the page that could be computed here. */
export interface ReportPayload {
  readonly generatedAt: string;
  readonly run: RunBlock;
  readonly provenance: Provenance;
  readonly runFields: readonly FieldEntry[];
  readonly provenanceFields: readonly FieldEntry[];
  readonly headline: readonly HeadlineMetric[];
  readonly columns: readonly RowColumn[];
  readonly rows: readonly Record<string, unknown>[];
  readonly verdicts: Envelope["verdicts"];
  readonly comparison: ComparisonBlock | null;
}

// ---------------------------------------------------------------------------
// Deriving the payload
// ---------------------------------------------------------------------------

/** `pullRate` as `Pull rate`, `targetSha` as `Target sha`. Applied to keys, never to values. */
export function humanizeKey(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Columns from the union of the rows' own keys, in first-seen order.
 *
 * First-seen rather than sorted, because a producer's key order is its own presentation
 * decision and re-sorting it would replace that with an arbitrary one. The union rather
 * than the first row's keys, because a row type with an optional member would otherwise
 * lose a whole column to whichever row happened to land first.
 */
export function deriveColumns(rows: readonly unknown[]): readonly RowColumn[] {
  const keys: string[] = [];
  const numeric = new Set<string>();
  for (const row of rows) {
    if (row === null || typeof row !== "object" || Array.isArray(row)) continue;
    for (const [key, value] of Object.entries(row)) {
      if (!keys.includes(key)) keys.push(key);
      if (typeof value === "number") numeric.add(key);
    }
  }
  return keys.map((key) => ({ key, label: humanizeKey(key), numeric: numeric.has(key) }));
}

/** Rows narrowed to the records the table can render. A non-record row is dropped, not coerced. */
function asRecords(rows: readonly unknown[]): readonly Record<string, unknown>[] {
  return rows.filter(
    (row): row is Record<string, unknown> =>
      row !== null && typeof row === "object" && !Array.isArray(row),
  );
}

/**
 * The `run` block as ordered labelled fields.
 *
 * Every key is listed, including the ones that are `null`. A run with `model: null` and a
 * run whose model was not recorded read identically once a field is dropped for being
 * empty, and the envelope went to some trouble to keep those apart.
 */
export function runFields(run: RunBlock): readonly FieldEntry[] {
  return [
    ["Run id", run.id],
    ["Started at", run.startedAt],
    ["Operation", run.operation],
    ["Artifact", run.artifact],
    ["Target", run.target],
    ["Install state", run.installState],
    ["Target sha", run.targetSha],
    ["Model", run.model],
    ["Grader model", run.graderModel],
    ["Workers", run.workers],
    ["Runs per unit", run.runsPer],
    ["Timeout seconds", run.timeoutSeconds],
    ["Eval set hash", run.evalSetHash],
  ];
}

/** The `provenance` block as ordered labelled fields. `caps` is rendered separately, as prose. */
export function provenanceFields(provenance: Provenance): readonly FieldEntry[] {
  return [
    ["Unit", provenance.unit],
    ["Scored", provenance.scored],
    ["Excluded", provenance.excluded],
    ["Failed", provenance.failed],
    ["Timeout policy", provenance.timeoutPolicy],
    ["Tokenizer", provenance.tokenizer],
    ["Coverage caps", provenance.caps.length],
  ];
}

/**
 * Line the two runs' headline metrics up by label.
 *
 * Only reached once {@link compareRuns} has said the pair is comparable, and only for a
 * label present on both sides: a metric the baseline never reported has no delta, and
 * inventing a zero baseline for it would report the metric's INTRODUCTION as a gain.
 */
function deltasFor(
  current: readonly HeadlineMetric[],
  baseline: readonly HeadlineMetric[],
): readonly MetricDelta[] {
  const byLabel = new Map(baseline.map((metric) => [metric.label, metric]));
  const deltas: MetricDelta[] = [];
  for (const metric of current) {
    const before = byLabel.get(metric.label);
    if (before === undefined) continue;
    deltas.push({
      label: metric.label,
      baseline: before.value,
      current: metric.value,
      delta: metric.value - before.value,
    });
  }
  return deltas;
}

/**
 * Build the comparison block, deferring the whole judgement to the envelope's own check.
 *
 * The incomparable branch is the important one: it produces the sentence naming which
 * fields moved and an EMPTY delta list, so a page rendered from it cannot show a delta
 * even by accident.
 */
export function buildComparison(
  current: Envelope,
  baseline: Envelope,
): ComparisonBlock {
  const result: Comparability = compareRuns(current.run, baseline.run);
  return {
    baselineRunId: baseline.run.id,
    baselineStartedAt: baseline.run.startedAt,
    comparable: result.comparable,
    differing: result.differing,
    advisory: result.advisory,
    explanation: explainIncomparability(result),
    deltas: result.comparable ? deltasFor(current.headline, baseline.headline) : [],
  };
}

/**
 * Attach deltas to the headline metrics themselves, so the figure and its movement render
 * together. Only ever called with a comparable pair's deltas.
 */
function headlineWithDeltas(
  headline: readonly HeadlineMetric[],
  comparison: ComparisonBlock | null,
): readonly HeadlineMetric[] {
  if (comparison === null || !comparison.comparable) return headline;
  const byLabel = new Map(comparison.deltas.map((entry) => [entry.label, entry.delta]));
  return headline.map((metric) => {
    const delta = byLabel.get(metric.label);
    return delta === undefined ? metric : { ...metric, delta };
  });
}

export interface PayloadOptions {
  /** A comparable earlier run, or none. */
  readonly baseline?: Envelope | null;
  /** Overridden in tests so a rendered page is byte-stable. */
  readonly generatedAt?: string;
}

export function buildReportPayload(
  envelope: Envelope,
  options: PayloadOptions = {},
): ReportPayload {
  const comparison =
    options.baseline === undefined || options.baseline === null
      ? null
      : buildComparison(envelope, options.baseline);
  return {
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    run: envelope.run,
    provenance: envelope.provenance,
    runFields: runFields(envelope.run),
    provenanceFields: provenanceFields(envelope.provenance),
    headline: headlineWithDeltas(envelope.headline, comparison),
    columns: deriveColumns(envelope.rows),
    rows: asRecords(envelope.rows),
    verdicts: envelope.verdicts,
    comparison,
  };
}

// ---------------------------------------------------------------------------
// Injection
// ---------------------------------------------------------------------------

/**
 * Serialize for embedding inside an inline `<script>`.
 *
 * The same escaping `generate-dashboard.ts` applies, and reachable for the same reason: a
 * verdict reason and a row's `message` are producer text, and a literal `</script>` in
 * either would terminate the script element and render the page blank with no error
 * pointing at the cause. The `\uXXXX` forms decode back to the identical characters, so
 * the parsed value is unchanged.
 */
export function serializeForScriptTag(payload: ReportPayload): string {
  return JSON.stringify(payload).replace(
    /[<>&\u2028\u2029]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

/**
 * Replace the token with the data assignment.
 *
 * The function-valued replacement is required: a `$&` or `$1` inside the serialized JSON
 * would otherwise be read as a substitution pattern and corrupt the output.
 */
export function injectEmbeddedData(template: string, payload: ReportPayload): string {
  const dataJson = serializeForScriptTag(payload);
  return template.replaceAll(EMBEDDED_DATA_TOKEN, () => `const EMBEDDED_DATA = ${dataJson};`);
}

/** Thrown when the template on disk cannot carry the data -- a build problem, not a data one. */
export class ReportTemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportTemplateError";
  }
}

export async function loadTemplate(): Promise<string> {
  return await Bun.file(`${import.meta.dir}/template.html`).text();
}

/**
 * Render the page.
 *
 * Refuses a template missing either marker. The data token is obvious -- without it the
 * page renders with no data at all -- but the findings slot matters just as much: a
 * template that lost it produces a page an agent has nowhere to write into, and the page
 * would look finished. Both are checked here rather than trusted.
 */
export function renderReportFrom(
  template: string,
  envelope: Envelope,
  options: PayloadOptions = {},
): string {
  if (!template.includes(EMBEDDED_DATA_TOKEN)) {
    throw new ReportTemplateError(
      `template.html has no ${EMBEDDED_DATA_TOKEN} token, so the run's data has nowhere to go.`,
    );
  }
  if (!template.includes(FINDINGS_SLOT)) {
    throw new ReportTemplateError(
      `template.html has no ${FINDINGS_SLOT} marker, so the page would ship with no place ` +
        `for the findings and no sign that they are missing.`,
    );
  }
  const withData = injectEmbeddedData(template, buildReportPayload(envelope, options));
  return injectAppBar(withData, {
    title: envelope.run.target,
    subtitle: envelope.run.operation,
    active: "report",
    // A finished report is a snapshot of a run that is over. Zero disables polling, which
    // is what makes the page self-contained: nothing is fetched at view time.
    runningCount: 0,
    refreshSeconds: 0,
  });
}

export async function renderReport(
  envelope: Envelope,
  options: PayloadOptions = {},
): Promise<string> {
  return renderReportFrom(await loadTemplate(), envelope, options);
}

/** Render and write. Returns the HTML so a caller can assert on it without a second read. */
export async function writeReport(
  path: string,
  envelope: Envelope,
  options: PayloadOptions = {},
): Promise<string> {
  const html = await renderReport(envelope, options);
  await Bun.write(path, html);
  return html;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const SPEC: Spec = {
  out: { kind: "string", short: "o", help: "Where to write the page (default: alongside the envelope)" },
  baseline: { kind: "string", help: "An earlier envelope to compare against" },
  help: { kind: "boolean", short: "h", help: "Show this help" },
};

const USAGE = "bun run report.ts <envelope.json> [--out PATH] [--baseline PATH]";

/** `.../envelope.json` becomes `.../report.html`, so the page lands beside its data. */
export function defaultOutPath(envelopePath: string): string {
  const slash = envelopePath.lastIndexOf("/");
  return slash === -1 ? "report.html" : `${envelopePath.slice(0, slash)}/report.html`;
}

/* istanbul ignore next -- @preserve */
async function main(): Promise<void> {
  const { flags, positionals } = parseArgs(Bun.argv.slice(2), SPEC);
  if (flags.help === true) {
    console.log(formatHelp(USAGE, SPEC));
    return;
  }
  const envelopePath = positionals[0];
  if (envelopePath === undefined) throw new CliError(`missing envelope path\n\n${USAGE}`);

  const envelope = await readEnvelope(envelopePath);
  const baseline =
    typeof flags.baseline === "string" ? await readEnvelope(flags.baseline) : null;
  const outPath = typeof flags.out === "string" ? flags.out : defaultOutPath(envelopePath);

  await writeReport(outPath, envelope, { baseline });
  console.log(`Wrote ${outPath}`);
  console.log(`Findings slot is empty. Edit ${FINDINGS_SLOT} in the page with 3-5 one-line items.`);
}

/* istanbul ignore next -- @preserve */
if (import.meta.path === Bun.main) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(error instanceof CliError ? 2 : 1);
  }
}
