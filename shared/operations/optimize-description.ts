#!/usr/bin/env bun
/**
 * Optimize a description by measuring it, proposing a replacement, and repeating
 * until every query passes or the iteration budget runs out.
 *
 * Combines measure-triggering.ts and propose-description.ts in a loop, tracking history and
 * returning the best description found. Supports train/test split to prevent
 * overfitting.
 *
 * Port of run_loop.py, since generalized past skills: the same loop optimizes a
 * subagent's or a slash command's description, because what it drives -- score the
 * candidate, propose a replacement, select on the held-out split -- does not depend
 * on which kind of artifact the description belongs to. `--target-type` picks; the
 * default is `skill`, so an invocation written before the generalization behaves
 * exactly as it did.
 */

import { proposeDescription, type ProposeHistoryEntry } from "./propose-description.ts";
import { ensureDashboard, openInBrowser } from "../util/browser.ts";
import {
  buildEnvelope,
  detectInstallState,
  hashArtifact,
  hashJsonValue,
  installConflict,
  writeEnvelope,
  type ArtifactKind,
  type Envelope,
  type HeadlineMetric,
  type InstallState,
} from "../envelope.ts";
import {
  createIsolationLedger,
  type IsolationState,
  type IsolationVerdict,
} from "../isolation.ts";
import { PythonRandom } from "../util/mt19937.ts";
import { formatFixed, formatPercent } from "../util/pyfloat.ts";
import { ProgressReporter, projectRemainingMs } from "../util/progress.ts";
import {
  flagBoolean,
  flagNumber,
  flagString,
  isRecord,
  parseCli,
  parseEvalSet,
  pyBool,
  readTargetDefinition,
  requireFlag,
  requireTargetPath,
  requireTargetType,
  resolveTargetFile,
  createAttemptTally,
  measureTriggering,
  SHARED_EVAL_FLAGS,
  type AttemptOutcome,
  type AttemptTally,
  type EvalItem,
  type QueryResult,
  type TargetType,
} from "./measure-triggering.ts";

export interface LoopHistoryEntry {
  readonly iteration: number;
  readonly description: string;
  readonly train_passed: number;
  readonly train_failed: number;
  readonly train_total: number;
  readonly train_results: readonly QueryResult[];
  readonly test_passed: number | null;
  readonly test_failed: number | null;
  readonly test_total: number | null;
  readonly test_results: readonly QueryResult[] | null;
  /** Duplicated under the pre-split names for backward compat with the report generator. */
  readonly passed: number;
  readonly failed: number;
  readonly total: number;
  readonly results: readonly QueryResult[];
}

/** What the report shows for work that has started but produced no results row yet. */
export interface LoopProgress {
  readonly iteration: number;
  readonly settled: number;
  readonly total: number;
  readonly phase: string;
  readonly startedAt: number;
  readonly remainingMs?: number;
  readonly description: string;
}

/** The shape handed to the report generator mid-run, when no verdict exists yet. */
export interface LoopReportInput {
  readonly original_description: string;
  readonly best_description: string;
  readonly best_score: string;
  readonly iterations_run: number;
  readonly holdout: number;
  readonly train_size: number;
  readonly test_size: number;
  readonly history: readonly LoopHistoryEntry[];
  /** Present only while something is in flight; its absence is what removes the bar. */
  readonly in_progress?: LoopProgress;
}

export interface LoopOutput extends LoopReportInput {
  readonly exit_reason: string;
  readonly best_train_score: string;
  readonly best_test_score: string | null;
  readonly final_description: string;
  /**
   * Set when the improvement step failed and the loop stopped early.
   *
   * Its presence means the history is valid but shorter than `maxIterations` for a reason
   * other than convergence, and the CLI exits non-zero. A caller reading `best_description`
   * still gets a real answer -- the best of what was actually scored.
   */
  readonly improvement_error?: string;
}

export interface OptimizeDescriptionParams {
  readonly evalSet: readonly EvalItem[];
  /** Skill directory, or the `.md` file when the target is an agent or a command. */
  readonly skillPath: string;
  /** Defaults to `skill`, so every pre-existing caller keeps its behaviour. */
  readonly targetType?: TargetType;
  readonly descriptionOverride?: string | undefined;
  readonly numWorkers: number;
  readonly timeoutSeconds: number;
  readonly maxIterations: number;
  readonly runsPerQuery: number;
  readonly triggerThreshold: number;
  /**
   * Passed through to `measureTriggering`. Defaults to true, as it does there.
   *
   * Safe for the loop specifically because `scoreOf` ranks iterations on PASS COUNTS
   * (`train_passed` / `test_passed`), never on mean trigger rate -- and a stopped query
   * reports the same pass or fail it would have after all N attempts. The rates the
   * improvement prompt shows do move, which is fine: it reads them as "2 of 2 attempts
   * triggered", and that is what happened.
   */
  readonly earlyStop?: boolean;
  readonly holdout: number;
  readonly model: string;
  readonly verbose: boolean;
  readonly liveReportPath?: string | undefined;
  readonly logDir?: string | undefined;
  /**
   * Directory to persist results into AS EACH ITERATION COMPLETES.
   *
   * Previously the loop wrote `results.json` only after returning, so any failure before
   * that discarded every completed iteration. Measured on a real run: iteration 1's 200
   * scored attempts were lost because the improvement step that followed them exited 1,
   * and the results directory was left empty. Scored attempts cost minutes of API time
   * each; a measurement that cannot survive the next failure is not a measurement.
   */
  readonly resultsDir?: string | undefined;
  /**
   * Iterations already scored by an earlier run, to continue from rather than repeat.
   *
   * This is what makes a RETRY a retry rather than a restart. At roughly 12 minutes per
   * iteration, re-deriving three scored iterations costs over half an hour for answers
   * already on disk. Seeded history counts toward `maxIterations`, so a resumed run
   * finishes the original budget instead of extending it.
   *
   * The loop continues from the LAST seeded description, because that is the candidate
   * the improvement step had reached when it died.
   */
  readonly resumeHistory?: readonly LoopHistoryEntry[] | undefined;
  /**
   * Forwarded to every `measureTriggering` call the loop makes.
   *
   * The loop, not the CLI, owns those calls, so the count of attempts that timed out or
   * failed to spawn is only reachable from in here. It is needed for `provenance.failed`
   * in the results envelope: this loop inherits the trigger harness's policy of SCORING a
   * timeout as a non-trigger, so a description that looks slightly worse this iteration
   * may simply have been measured on a slower afternoon, and the envelope has to let a
   * reader see that.
   */
  readonly onAttemptOutcome?: ((outcome: AttemptOutcome) => void) | undefined;
  /**
   * Handed each attempt's isolation proof, for the caller's ledger to fold.
   *
   * Threaded for the same reason `onAttemptOutcome` is. This loop spawns real children
   * through the trigger harness, so its isolation IS checkable -- and an operation that can
   * check and does not would be writing `unverified` as a fabrication rather than an answer.
   */
  readonly onIsolation?: ((verdict: IsolationVerdict) => void) | undefined;
}

/** Split eval set into train and test sets, stratified by should_trigger. */
export function splitEvalSet<T extends EvalItem>(
  evalSet: readonly T[],
  holdout: number,
  seed = 42,
): readonly [T[], T[]] {
  const random = new PythonRandom(seed);

  const trigger = evalSet.filter((item) => item.should_trigger);
  const noTrigger = evalSet.filter((item) => !item.should_trigger);

  random.shuffle(trigger);
  random.shuffle(noTrigger);

  const triggerTestCount = Math.max(1, Math.trunc(trigger.length * holdout));
  const noTriggerTestCount = Math.max(1, Math.trunc(noTrigger.length * holdout));

  const testSet = [
    ...trigger.slice(0, triggerTestCount),
    ...noTrigger.slice(0, noTriggerTestCount),
  ];
  const trainSet = [...trigger.slice(triggerTestCount), ...noTrigger.slice(noTriggerTestCount)];

  return [trainSet, testSet];
}

/**
 * Options-object form, mandated by the team lead: the Python is
 * `generate_html(output, auto_refresh=..., skill_name=...)` -- one positional
 * plus keyword args -- and a bare positional boolean invites transposition.
 *
 * The first parameter is `LoopReportInput`, NOT `LoopOutput`. The live-report
 * call happens mid-run, before any verdict exists, so it has no `exit_reason`,
 * `best_train_score`, `best_test_score` or `final_description`. `LoopOutput`
 * extends `LoopReportInput`, so the final-report call satisfies this too.
 */
type GenerateHtml = (
  output: LoopReportInput,
  opts?: {
    autoRefresh?: boolean;
    skillName?: string;
    /**
     * Column headers for the window before any iteration has finished. Without them
     * the baseline report renders a bar with no columns and reflows once results land.
     */
    plannedQueries?: {
      train: readonly { query: string; shouldTrigger: boolean }[];
      test: readonly { query: string; shouldTrigger: boolean }[];
    };
  },
) => string;

let cachedGenerator: GenerateHtml | null | undefined;

/**
 * Load the sibling report generator at runtime.
 *
 * `generate-report.ts` belongs to a different workstream of this port, so a static
 * import would fail typecheck until it lands. Resolving the specifier at runtime
 * keeps the loop usable either way; a missing generator degrades to no HTML report
 * rather than to a crashed run.
 */
async function loadGenerateHtml(): Promise<GenerateHtml | null> {
  if (cachedGenerator !== undefined) return cachedGenerator;
  try {
    const module: unknown = await import(new URL("./generate-report.ts", import.meta.url).href);
    if (isRecord(module) && typeof module["generateHtml"] === "function") {
      cachedGenerator = module["generateHtml"] as GenerateHtml;
      return cachedGenerator;
    }
    console.error("Warning: generate-report.ts exports no generateHtml; skipping HTML report");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Warning: HTML report unavailable (${message})`);
  }
  cachedGenerator = null;
  return null;
}

async function writeReport(
  path: string,
  output: LoopReportInput,
  autoRefresh: boolean,
  skillName: string,
  plannedQueries?: PlannedQueries,
): Promise<void> {
  const generate = await loadGenerateHtml();
  if (generate === null) return;
  await Bun.write(
    path,
    generate(output, {
      autoRefresh,
      skillName,
      ...(plannedQueries === undefined ? {} : { plannedQueries }),
    }),
  );
}

interface PlannedQueries {
  readonly train: readonly { query: string; shouldTrigger: boolean }[];
  readonly test: readonly { query: string; shouldTrigger: boolean }[];
}

function plannedQueriesOf(
  trainSet: readonly EvalItem[],
  testSet: readonly EvalItem[],
): PlannedQueries {
  const toInfo = (
    items: readonly EvalItem[],
  ): { query: string; shouldTrigger: boolean }[] =>
    items.map((item) => ({ query: item.query, shouldTrigger: item.should_trigger }));
  return { train: toInfo(trainSet), test: toInfo(testSet) };
}

/**
 * Write the loop's results so far, if a results directory was given.
 *
 * Called after every completed iteration rather than once at the end. Failures are
 * swallowed: persistence protects the run's output, and a full disk must not be the thing
 * that kills a run which is otherwise succeeding.
 */
async function persistPartial(
  resultsDir: string | undefined,
  snapshot: LoopReportInput,
): Promise<void> {
  if (resultsDir === undefined) return;
  try {
    await Bun.write(`${resultsDir}/results.json`, `${JSON.stringify(snapshot, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Warning: could not persist partial results (${message})`);
  }
}

function sumOf(results: readonly QueryResult[], pick: (result: QueryResult) => number): number {
  return results.reduce((total, result) => total + pick(result), 0);
}

function printEvalStats(
  label: string,
  results: readonly QueryResult[],
  elapsedSeconds: number,
): void {
  const positive = results.filter((result) => result.should_trigger);
  const negative = results.filter((result) => !result.should_trigger);
  const truePositive = sumOf(positive, (result) => result.triggers);
  const falseNegative = sumOf(positive, (result) => result.runs) - truePositive;
  const falsePositive = sumOf(negative, (result) => result.triggers);
  const trueNegative = sumOf(negative, (result) => result.runs) - falsePositive;
  const total = truePositive + trueNegative + falsePositive + falseNegative;
  const precision =
    truePositive + falsePositive > 0 ? truePositive / (truePositive + falsePositive) : 1.0;
  const recall =
    truePositive + falseNegative > 0 ? truePositive / (truePositive + falseNegative) : 1.0;
  const accuracy = total > 0 ? (truePositive + trueNegative) / total : 0.0;

  console.error(
    `${label}: ${truePositive + trueNegative}/${total} correct, precision=${formatPercent(precision, 0)} recall=${formatPercent(recall, 0)} accuracy=${formatPercent(accuracy, 0)} (${formatFixed(elapsedSeconds, 1)}s)`,
  );
  for (const result of results) {
    const status = result.pass ? "PASS" : "FAIL";
    console.error(
      `  [${status}] rate=${result.triggers}/${result.runs} expected=${pyBool(result.should_trigger)}: ${result.query.slice(0, 60)}`,
    );
  }
}

/** Strip the test-side scores so the improvement model cannot see the holdout. */
function blindTestScores(entry: LoopHistoryEntry): ProposeHistoryEntry {
  const { test_passed: _p, test_failed: _f, test_total: _t, test_results: _r, ...rest } = entry;
  return rest;
}

function scoreOf(entry: LoopHistoryEntry, useTest: boolean): number {
  return useTest ? (entry.test_passed ?? 0) : entry.train_passed;
}

/** Python's `max()` keeps the FIRST maximum on ties; so does this. */
function bestIteration(history: readonly LoopHistoryEntry[], useTest: boolean): LoopHistoryEntry {
  const first = history[0];
  if (first === undefined) throw new Error("run loop produced no iterations");
  let best = first;
  for (const entry of history) {
    if (scoreOf(entry, useTest) > scoreOf(best, useTest)) best = entry;
  }
  return best;
}

function elapsedSince(startNanos: number): number {
  return (Bun.nanoseconds() - startNanos) / 1e9;
}

/** Run the eval + improvement loop. */
export async function optimizeDescription(params: OptimizeDescriptionParams): Promise<LoopOutput> {
  const targetType = params.targetType ?? "skill";
  // The same three fields for every artifact type: a SKILL.md and an `agents/<name>.md`
  // are both markdown with YAML frontmatter, so what the loop needs -- the name it will
  // alias, the description it is optimizing, and the full text it hands the improvement
  // model as context -- is read the same way from either.
  const {
    name,
    description: originalDescription,
    content,
  } = await readTargetDefinition(params.skillPath, targetType);
  let currentDescription = params.descriptionOverride ?? originalDescription;

  const [trainSet, testSet] =
    params.holdout > 0
      ? splitEvalSet(params.evalSet, params.holdout)
      : ([[...params.evalSet], []] as const);
  if (params.holdout > 0 && params.verbose) {
    console.error(
      `Split: ${trainSet.length} train, ${testSet.length} test (holdout=${params.holdout})`,
    );
  }

  // Seeded from a previous run when resuming, so those iterations are not re-derived.
  // The starting description is the last one already tried: that is the candidate the
  // improvement step had reached, and re-testing an earlier one would waste the resume.
  const history: LoopHistoryEntry[] = [...(params.resumeHistory ?? [])];
  const resumedCount = history.length;
  const lastSeeded = history[history.length - 1];
  if (lastSeeded !== undefined) currentDescription = lastSeeded.description;
  let exitReason = "unknown";
  /** Set when the improvement step failed; the loop still returns its scored history. */
  let improvementError: string | undefined;

  if (resumedCount >= params.maxIterations) {
    throw new Error(
      `resume seed already holds ${resumedCount} iteration(s), which meets --max-iterations ` +
        `(${params.maxIterations}); raise the limit to continue`,
    );
  }

  const planned = plannedQueriesOf(trainSet, testSet);
  const attemptsPerIteration = params.evalSet.length * params.runsPerQuery;

  /**
   * Rewrite the live report, optionally with a progress row.
   *
   * Serialized through a chain rather than awaited at the call site: this is driven
   * from `onProgress`, which fires from the pool's `finally` on every settled attempt,
   * and awaiting an HTML write there would put a filesystem round-trip on the hot
   * path. Overlapping writes would also let an older snapshot land last.
   */
  let reportChain: Promise<void> = Promise.resolve();
  const publish = (progress?: LoopProgress): void => {
    if (params.liveReportPath === undefined) return;
    const snapshot: LoopReportInput = {
      original_description: originalDescription,
      best_description: currentDescription,
      best_score: "in progress",
      iterations_run: history.length,
      holdout: params.holdout,
      train_size: trainSet.length,
      test_size: testSet.length,
      history: [...history],
      ...(progress === undefined ? {} : { in_progress: progress }),
    };
    reportChain = reportChain
      .then(() =>
        writeReport(params.liveReportPath as string, snapshot, true, name, planned),
      )
      .catch(() => undefined);
  };

  // The dashboard's unit is the whole loop, not one iteration: a caller watching this
  // run wants to know how far through the optimization it is. Total is every attempt
  // across every iteration, which is an upper bound -- the loop exits early when all
  // train queries pass, and `finish` records that as done rather than as abandoned.
  const reporter = ProgressReporter.start({
    kind: "description-loop",
    label: `${name} — description optimization`,
    total: attemptsPerIteration * params.maxIterations,
    subject: name,
    detail: {
      maxIterations: params.maxIterations,
      phase: "baseline evaluation",
      ...(params.liveReportPath === undefined ? {} : { reportPath: params.liveReportPath }),
      // Recorded so a retry can resume from what this run already scored. The directory is
      // timestamped per run, so it is not recoverable from the command line alone.
      ...(params.resultsDir === undefined ? {} : { resultsDir: params.resultsDir }),
    },
  });

  // The blind window the user named: before this, the page read "Starting optimization
  // loop..." for the entire duration of iteration 1's evaluation. Publishing a zeroed
  // bar up front means the very first poll shows the run's shape.
  publish({
    iteration: 1,
    settled: 0,
    total: attemptsPerIteration,
    phase: "baseline evaluation",
    startedAt: Date.now(),
    description: currentDescription,
  });

  try {
  // Starts past whatever was seeded, and shares the original budget rather than adding
  // to it -- a resumed run finishes the work, it does not get extra iterations.
  for (let iteration = resumedCount + 1; iteration <= params.maxIterations; iteration += 1) {
    if (params.verbose) {
      console.error(`\n${"=".repeat(60)}`);
      console.error(`Iteration ${iteration}/${params.maxIterations}`);
      console.error(`Description: ${currentDescription}`);
      console.error("=".repeat(60));
    }

    // Evaluate train + test together in one batch for parallelism.
    const started = Bun.nanoseconds();
    const iterationStartedAt = Date.now();
    // Attempts completed in earlier iterations, so the loop-wide counter keeps climbing
    // instead of resetting to zero at each iteration boundary.
    // Counted from the ITERATION NUMBER, not from history length, so a resumed run's
    // progress bar reflects the whole budget rather than restarting at zero.
    const priorAttempts = (iteration - 1) * attemptsPerIteration;
    const phase = iteration === 1 ? "baseline evaluation" : `evaluating iteration ${iteration}`;
    reporter.update({ iteration, phase });

    const allResults = await measureTriggering({
      evalSet: [...trainSet, ...testSet],
      skillName: name,
      description: currentDescription,
      skillPath: params.skillPath,
      targetType,
      numWorkers: params.numWorkers,
      timeoutSeconds: params.timeoutSeconds,
      runsPerQuery: params.runsPerQuery,
      triggerThreshold: params.triggerThreshold,
      ...(params.earlyStop === undefined ? {} : { earlyStop: params.earlyStop }),
      ...(params.onAttemptOutcome === undefined
        ? {}
        : { onAttemptOutcome: params.onAttemptOutcome }),
      ...(params.onIsolation === undefined ? {} : { onIsolation: params.onIsolation }),
      model: params.model,
      verbose: params.verbose,
      onProgress: (settled, total) => {
        reporter.report(priorAttempts + settled);
        // Projected against THIS iteration's clock rather than the loop's, so a slow
        // first iteration does not skew the estimate for a later one. Shared with the
        // dashboard's projection so the two cannot disagree.
        const remainingMs =
          projectRemainingMs(
            { ...reporter.status, settled, total, startedAt: iterationStartedAt },
            Date.now(),
          ) ?? undefined;
        publish({
          iteration,
          settled,
          total,
          phase,
          startedAt: iterationStartedAt,
          ...(remainingMs === undefined ? {} : { remainingMs }),
          description: currentDescription,
        });
      },
    });
    const evalElapsed = elapsedSince(started);

    // Split results back into train/test by matching queries.
    const trainQueries = new Set(trainSet.map((item) => item.query));
    const trainResults = allResults.results.filter((result) => trainQueries.has(result.query));
    const testResults = allResults.results.filter((result) => !trainQueries.has(result.query));

    const trainPassed = trainResults.filter((result) => result.pass).length;
    const testPassed = testResults.filter((result) => result.pass).length;
    const hasTestSet = testSet.length > 0;

    history.push({
      iteration,
      description: currentDescription,
      train_passed: trainPassed,
      train_failed: trainResults.length - trainPassed,
      train_total: trainResults.length,
      train_results: trainResults,
      test_passed: hasTestSet ? testPassed : null,
      test_failed: hasTestSet ? testResults.length - testPassed : null,
      test_total: hasTestSet ? testResults.length : null,
      test_results: hasTestSet ? testResults : null,
      passed: trainPassed,
      failed: trainResults.length - trainPassed,
      total: trainResults.length,
      results: trainResults,
    });

    // The swap: this iteration now has a history entry, so publishing without a
    // progress row replaces the bar with the real results in the same position.
    publish();

    // Persisted HERE, not at the end of the loop. Every iteration's scored attempts are
    // durable the moment they exist, so a later failure costs only the iteration it
    // interrupted rather than everything before it.
    await persistPartial(params.resultsDir, {
      original_description: originalDescription,
      best_description: currentDescription,
      best_score: "in progress",
      iterations_run: history.length,
      holdout: params.holdout,
      train_size: trainSet.length,
      test_size: testSet.length,
      history: [...history],
    });
    reporter.update({
      trainScore: `${trainPassed}/${trainResults.length}`,
      ...(hasTestSet ? { testScore: `${testPassed}/${testResults.length}` } : {}),
    });

    if (params.verbose) {
      printEvalStats("Train", trainResults, evalElapsed);
      if (hasTestSet) printEvalStats("Test ", testResults, 0);
    }

    if (trainResults.length - trainPassed === 0) {
      exitReason = `all_passed (iteration ${iteration})`;
      if (params.verbose) console.error(`\nAll train queries passed on iteration ${iteration}!`);
      break;
    }

    if (iteration === params.maxIterations) {
      exitReason = `max_iterations (${params.maxIterations})`;
      if (params.verbose) console.error(`\nMax iterations reached (${params.maxIterations}).`);
      break;
    }

    if (params.verbose) console.error("\nImproving description...");
    // The other blind window, and a smaller one only in relative terms: this is a
    // single `claude -p` call, measured at 13s to 124s. A bar with no countable items
    // still says the run is alive and what it is doing, which is the whole point.
    const improveStartedAt = Date.now();
    reporter.update({ phase: "improving description" });
    publish({
      iteration: iteration + 1,
      settled: 0,
      total: 0,
      phase: `improving description after iteration ${iteration}`,
      startedAt: improveStartedAt,
      description: currentDescription,
    });

    const improveStarted = Bun.nanoseconds();
    // Wrapped rather than allowed to propagate. The loop holds valid scored iterations at
    // this point, and a failing improvement step is a reason to STOP proposing candidates,
    // not a reason to discard the measurements already taken. Measured: `claude -p` exited
    // 1 with empty stderr here and took 200 completed attempts down with it.
    let proposed: string;
    try {
      proposed = await proposeDescription({
        skillName: name,
        skillContent: content,
        currentDescription,
        evalResults: {
          results: trainResults,
          summary: {
            passed: trainPassed,
            failed: trainResults.length - trainPassed,
            total: trainResults.length,
          },
        },
        history: history.map(blindTestScores),
        model: params.model,
        logDir: params.logDir,
        iteration,
      });
    } catch (error) {
      // Recorded as the exit reason and surfaced, then the loop ENDS normally: the caller
      // gets every iteration scored so far and a non-zero exit code, rather than an
      // exception that discards the history.
      improvementError = error instanceof Error ? error.message : String(error);
      exitReason = `improvement_failed (iteration ${iteration}): ${improvementError}`;
      console.error(`\nImprovement step failed after iteration ${iteration}: ${improvementError}`);
      console.error(`Keeping ${history.length} scored iteration(s) and stopping here.`);
      break;
    }

    currentDescription = proposed;
    if (params.verbose) {
      console.error(
        `Proposed (${formatFixed(elapsedSince(improveStarted), 1)}s): ${currentDescription}`,
      );
    }
  }
  } catch (error) {
    // Recorded before rethrowing so a crashed loop reads as failed immediately, rather
    // than showing `running` until the staleness threshold eventually catches it.
    await reporter.finish("failed", error instanceof Error ? error.message : String(error));
    // The bar is left in place deliberately: it names the phase that was in flight when
    // the run died, which is the single most useful thing the page can still say.
    await reportChain;
    throw error;
  }

  // Clear the bar and settle both channels before returning. `main` writes the final
  // report over this one, but a caller using `optimizeDescription` as a library does not, so the
  // in-progress row has to be gone by the time the loop reports itself finished.
  publish();
  await reportChain;
  // `failed` when the loop stopped on a broken improvement step, even though it returned
  // normally with a valid history. The run did not do what it set out to do, and the
  // dashboard must not show that as a clean success -- the exit code says the same thing.
  if (improvementError === undefined) {
    await reporter.finish("done");
  } else {
    await reporter.finish("failed", improvementError);
  }

  // Find the best iteration by TEST score (or train if no test set).
  const hasTestSet = testSet.length > 0;
  const best = bestIteration(history, hasTestSet);
  const bestScore = hasTestSet
    ? `${best.test_passed}/${best.test_total}`
    : `${best.train_passed}/${best.train_total}`;

  if (params.verbose) {
    console.error(`\nExit reason: ${exitReason}`);
    console.error(`Best score: ${bestScore} (iteration ${best.iteration})`);
  }

  return {
    exit_reason: exitReason,
    original_description: originalDescription,
    best_description: best.description,
    best_score: bestScore,
    best_train_score: `${best.train_passed}/${best.train_total}`,
    best_test_score: hasTestSet ? `${best.test_passed}/${best.test_total}` : null,
    final_description: currentDescription,
    iterations_run: history.length,
    holdout: params.holdout,
    train_size: trainSet.length,
    test_size: testSet.length,
    history,
    ...(improvementError === undefined ? {} : { improvement_error: improvementError }),
  };
}

/**
 * Read scored iterations from a previous run's `results.json`.
 *
 * Validated rather than trusted: a resume seed decides which iterations are treated as
 * already-measured, so a malformed entry would silently drop real work or inject a fake
 * score. Anything that does not carry a description and train totals is rejected outright
 * -- a partial resume that looks successful is worse than a clean re-run.
 */
async function readResumeHistory(path: string): Promise<readonly LoopHistoryEntry[]> {
  let raw: unknown;
  try {
    raw = await Bun.file(path).json();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: could not read --resume-from ${path}: ${message}`);
    process.exit(1);
  }

  const history = isRecord(raw) ? raw["history"] : undefined;
  if (!Array.isArray(history) || history.length === 0) {
    console.error(`Error: ${path} holds no scored iterations to resume from`);
    process.exit(1);
  }

  const entries: LoopHistoryEntry[] = [];
  for (const [index, item] of history.entries()) {
    if (!isRecord(item) || typeof item["description"] !== "string") {
      console.error(`Error: ${path} history[${index}] has no description; refusing a partial resume`);
      process.exit(1);
    }
    if (typeof item["train_passed"] !== "number" || typeof item["train_total"] !== "number") {
      console.error(`Error: ${path} history[${index}] has no train score; refusing a partial resume`);
      process.exit(1);
    }
    // Renumbered to its position, so a seed assembled from a run that itself resumed
    // cannot carry duplicate iteration numbers into the report's rows.
    entries.push({ ...(item as unknown as LoopHistoryEntry), iteration: index + 1 });
  }
  return entries;
}

function tempDir(): string {
  const configured = Bun.env.TMPDIR ?? Bun.env.TMP ?? Bun.env.TEMP;
  return configured === undefined || configured === "" ? "/tmp" : configured.replace(/\/+$/, "");
}

function baseName(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const slash = trimmed.lastIndexOf("/");
  return slash === -1 ? trimmed : trimmed.slice(slash + 1);
}

/** Local-time equivalent of `time.strftime("%Y{sep}%m{sep}%d_%H%M%S")`. */
function timestamp(dateSeparator: string): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  const now = new Date();
  const date = [now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate())].join(dateSeparator);
  return `${date}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

// ---------------------------------------------------------------------------
// The results envelope
// ---------------------------------------------------------------------------

/**
 * One iteration, in the envelope's row vocabulary.
 *
 * `LoopHistoryEntry` keeps its snake_case names and its duplicated pre-split fields
 * because the report generator and every `results.json` on disk read them. These rows are
 * the same iterations with the duplication dropped: `passed`/`failed`/`total` were only
 * ever aliases of the train columns, kept for a reader that predates the split, and
 * carrying an alias into a brand-new contract would make it permanent.
 */
export interface DescriptionRow {
  readonly iteration: number;
  readonly description: string;
  readonly trainPassed: number;
  readonly trainTotal: number;
  /** Null when the run had no held-out split, which is a different thing from zero. */
  readonly testPassed: number | null;
  readonly testTotal: number | null;
  /** Whether this iteration's description is the one the run selected. */
  readonly selected: boolean;
}

export interface DescriptionEnvelopeInput {
  readonly output: LoopOutput;
  readonly targetName: string;
  readonly artifact: ArtifactKind;
  readonly tally: AttemptTally;
  /** Attempts budgeted: `evalSet.length * runsPerQuery * iterations actually run`. */
  readonly plannedAttempts: number;
  readonly model: string;
  readonly workers: number;
  readonly runsPer: number;
  readonly timeoutSeconds: number;
  readonly evalSetHash: string;
  readonly targetSha: string;
  readonly installState: InstallState;
  /** Folded from the per-attempt proofs across every iteration of the loop. */
  readonly isolation: IsolationState;
  readonly caps?: readonly string[];
  readonly startedAt?: Date;
}

/**
 * Build the envelope for one description-optimization run.
 *
 * Pure and exported for the same reason the trigger one is: every judgement here is about
 * how the result will be read, and none of it should need an hour of API time to exercise.
 */
export function buildDescriptionEnvelope(
  input: DescriptionEnvelopeInput,
): Envelope<DescriptionRow> {
  const history = input.output.history;
  const hasHoldout = input.output.test_size > 0;

  // Matched by description rather than by re-running the selection rule. `scoreOf` and
  // `bestIteration` already decide which iteration wins, and a second implementation here
  // would be free to disagree with the `best_description` the same file just wrote.
  const selectedIndex = history.findIndex(
    (entry) => entry.description === input.output.best_description,
  );

  const rows: DescriptionRow[] = history.map((entry, index) => ({
    iteration: entry.iteration,
    description: entry.description,
    trainPassed: entry.train_passed,
    trainTotal: entry.train_total,
    testPassed: entry.test_passed,
    testTotal: entry.test_total,
    selected: index === selectedIndex,
  }));

  const scoreOfRow = (row: DescriptionRow): { passed: number; total: number } =>
    hasHoldout && row.testTotal !== null && row.testPassed !== null
      ? { passed: row.testPassed, total: row.testTotal }
      : { passed: row.trainPassed, total: row.trainTotal };

  const baseline = rows[0];
  const selected = selectedIndex === -1 ? undefined : rows[selectedIndex];

  const headline: HeadlineMetric[] = [];
  if (selected !== undefined) {
    const best = scoreOfRow(selected);
    headline.push({
      label: hasHoldout ? "held-out queries passed" : "train queries passed",
      value: best.passed,
      unit: `of ${best.total}`,
      // A delta IS legitimate here, and it is the one place in this repository where one
      // can be filled in without a comparability check. Both numbers come from the same
      // run under one `run` block -- same model, same workers, same timeout, same eval
      // set, same install state -- so the only thing that changed between them is the
      // description, which is the variable under test. Any delta against a DIFFERENT run
      // has to go through `compareRuns` first.
      ...(baseline === undefined || selected === baseline
        ? {}
        : { delta: best.passed - scoreOfRow(baseline).passed }),
    });
    if (best.total > 0) {
      headline.push({
        label: hasHoldout ? "held-out pass rate" : "train pass rate",
        value: best.passed / best.total,
        unit: "fraction",
      });
    }
  }
  headline.push({
    label: "iterations scored",
    value: input.output.iterations_run,
    unit: "iterations",
  });

  const attemptsRun =
    input.tally.triggered + input.tally.declined + input.tally.timeout + input.tally.error;

  const caps: string[] = [...(input.caps ?? [])];
  if (!hasHoldout) {
    caps.push(
      "No held-out split (`--holdout 0`), so the winning description was selected on the " +
        "same queries that were shown to the model proposing it. The score above is a " +
        "training score and will be optimistic.",
    );
  }
  caps.push(
    `The same model (\`${input.model}\`) both answered the trigger probes and proposed ` +
      `every candidate description, so the two cannot be separated in this result: a ` +
      `stronger model proposes better wording AND routes better.`,
  );
  const unspent = input.plannedAttempts - attemptsRun;
  if (unspent > 0) {
    caps.push(
      `Early stopping left ${unspent} of ${input.plannedAttempts} planned attempts unspent. ` +
        `Iteration ranking is on pass COUNTS, which stopping cannot change, but the ` +
        `per-query rates inside \`results.json\` are over the attempts actually run.`,
    );
  }
  if (input.tally.timeout > 0) {
    caps.push(
      `${input.tally.timeout} attempt(s) hit the ${input.timeoutSeconds}s budget and were ` +
        `SCORED as non-triggers, inherited from the trigger harness's policy. An iteration ` +
        `that lost by one query may have lost to a slow afternoon.`,
    );
  }
  if (input.tally.error > 0) {
    caps.push(`${input.tally.error} attempt(s) failed to complete and were scored as non-triggers.`);
  }
  if (input.output.improvement_error !== undefined) {
    caps.push(
      `The loop stopped early: the improvement step failed ` +
        `(${input.output.improvement_error}). ${input.output.iterations_run} iteration(s) ` +
        `were scored, which is fewer than the budget.`,
    );
  }

  return buildEnvelope<DescriptionRow>({
    run: {
      ...(input.startedAt === undefined ? {} : { startedAt: input.startedAt }),
      artifact: input.artifact,
      target: input.targetName,
      operation: "optimize-description",
      model: input.model,
      // Nothing grades here. A trigger is read off the tool-call stream, and the model
      // that proposes candidates is the same one recorded above -- see the cap.
      graderModel: null,
      workers: input.workers,
      runsPer: input.runsPer,
      timeoutSeconds: input.timeoutSeconds,
      evalSetHash: input.evalSetHash,
      targetSha: input.targetSha,
      installState: input.installState,
      isolation: input.isolation,
    },
    provenance: {
      tokenizer: "none",
      unit: "query attempt",
      scored: attemptsRun,
      excluded: 0,
      failed: input.tally.timeout + input.tally.error,
      timeoutPolicy: "scored",
      caps,
    },
    headline,
    rows,
    verdicts: rows.map((row) => {
      const score = scoreOfRow(row);
      return {
        subject: `iteration ${row.iteration}`,
        verdict: row.selected ? "selected" : "scored",
        reason:
          `${score.passed}/${score.total} ${hasHoldout ? "held-out" : "train"} queries passed` +
          `${row.selected ? " — the best of the run, and the description returned" : ""}.`,
      };
    }),
  });
}

async function main(): Promise<void> {
  const { flags } = parseCli(
    {
      ...SHARED_EVAL_FLAGS,
      description: { kind: "string", help: "Override starting description" },
      "max-iterations": { kind: "number", default: 5, help: "Max improvement iterations" },
      holdout: {
        kind: "number",
        default: 0.4,
        help: "Fraction of eval set held out for testing (0 to disable)",
      },
      model: { kind: "string", help: "Model for improvement" },
      report: {
        kind: "string",
        default: "auto",
        help: "Generate HTML report at this path ('auto' for temp file, 'none' to disable)",
      },
      "resume-from": {
        kind: "string",
        help: "results.json from a failed run; continues from its scored iterations",
      },
      "results-dir": {
        kind: "string",
        help: "Save results.json, report.html and logs to a timestamped subdirectory here",
      },
      // Additive. `results.json` keeps its shape; the envelope is written beside it, and
      // this flag exists for a caller that wants only the envelope somewhere specific.
      envelope: {
        kind: "string",
        help: "Also write the results envelope here (default: <results-dir>/envelope.json)",
      },
    },
    "Usage: bun shared/operations/optimize-description.ts --eval-set <path> --target-path <path> --model <id> [options]\n\n" +
      "Each iteration scores the current description, then proposes a replacement. Queries\n" +
      "stop early once their verdict is settled, which is safe here because iterations are\n" +
      "ranked on pass COUNTS rather than on mean trigger rate. Pass --no-early-stop if you\n" +
      "intend to read the per-query rates in results.json as full-N figures.",
  );
  const evalSetPath = requireFlag(flags, "eval-set");
  const targetType = requireTargetType(flags);
  const skillPath = requireTargetPath(flags);
  const model = requireFlag(flags, "model");

  const definitionFile = await resolveTargetFile(skillPath, targetType);
  if (!(await Bun.file(definitionFile).exists())) {
    console.error(`Error: no ${targetType} definition found at ${definitionFile}`);
    process.exit(1);
  }

  const evalSet = parseEvalSet(await Bun.file(evalSetPath).json(), evalSetPath);
  const { name } = await readTargetDefinition(skillPath, targetType);

  // Set up the live report path.
  const report = flagString(flags, "report") ?? "auto";
  let liveReportPath: string | undefined;
  if (report !== "none") {
    liveReportPath =
      report === "auto"
        ? `${tempDir()}/skill_description_report_${baseName(skillPath)}_${timestamp("")}.html`
        : report;
    // Open the report immediately so the user can watch. This placeholder is now
    // short-lived rather than the whole of iteration 1: `optimizeDescription` publishes a real
    // report carrying a progress bar as its first action, so the wording below is only
    // ever seen for the milliseconds before that lands.
    await Bun.write(
      liveReportPath,
      "<html><body><h1>Starting optimization loop...</h1><meta http-equiv='refresh' content='5'></body></html>",
    );
    openInBrowser(liveReportPath);
  }

  // Launch the dashboard for this run unless one is already up. Awaited because it
  // probes and polls, but it never throws and never blocks on failure -- a run must not
  // depend on its own observability.
  await ensureDashboard();

  // Determine the output directory. Bun.write creates missing parents on first
  // write, which covers the Python's eager mkdir.
  const resultsRoot = flagString(flags, "results-dir");
  const resultsDir = resultsRoot === undefined ? undefined : `${resultsRoot}/${timestamp("-")}`;

  // Resume seed, when a retry supplied one. Read before the loop starts so a malformed
  // file fails fast with a clear message rather than mid-run.
  const resumePath = flagString(flags, "resume-from");
  const resumeHistory =
    resumePath === undefined ? undefined : await readResumeHistory(resumePath);
  if (resumeHistory !== undefined) {
    console.error(
      `Resuming from ${resumePath}: ${resumeHistory.length} scored iteration(s) will not be re-run.`,
    );
  }

  // Counted here rather than inside the loop because the envelope's `provenance` needs the
  // whole run's tally, and the loop scores each iteration independently. `createAttemptTally`
  // is shared with `measure-triggering.ts` for the reason its own comment gives: two
  // hand-rolled counters that disagree about whether an errored spawn is a failure would
  // make two envelopes incomparable for a reason that has nothing to do with the measurement.
  const tally = createAttemptTally();
  // Folded across EVERY iteration, not just the last. The loop re-measures after each
  // candidate, so a machine that contaminated iteration three contaminated the comparison
  // the whole loop is built on, even if the final iteration happened to come back clean.
  const isolation = createIsolationLedger();
  const envelopeStartedAt = new Date();

  const output = await optimizeDescription({
    evalSet,
    skillPath,
    targetType,
    onAttemptOutcome: tally.record,
    onIsolation: isolation.record,
    descriptionOverride: flagString(flags, "description"),
    numWorkers: flagNumber(flags, "num-workers"),
    timeoutSeconds: flagNumber(flags, "timeout"),
    maxIterations: flagNumber(flags, "max-iterations"),
    runsPerQuery: flagNumber(flags, "runs-per-query"),
    triggerThreshold: flagNumber(flags, "trigger-threshold"),
    earlyStop: !flagBoolean(flags, "no-early-stop"),
    holdout: flagNumber(flags, "holdout"),
    model,
    verbose: flagBoolean(flags, "verbose"),
    liveReportPath,
    logDir: resultsDir === undefined ? undefined : `${resultsDir}/logs`,
    // Passed so the loop persists each iteration as it completes, rather than relying on
    // the single write below -- which a crash never reaches.
    resultsDir,
    resumeHistory,
  });

  const jsonOutput = JSON.stringify(output, null, 2);
  console.log(jsonOutput);
  // Still written at the end: this is the COMPLETE output, with the verdict fields the
  // per-iteration snapshots cannot have. It overwrites the last partial.
  if (resultsDir !== undefined) await Bun.write(`${resultsDir}/results.json`, jsonOutput);

  // The envelope, beside `results.json` rather than instead of it. `results.json` is the
  // wire contract every existing consumer reads; the envelope is the cross-operation one.
  // Written last, from the complete output, for the same reason `results.json` is.
  const envelopeFlag = flagString(flags, "envelope");
  const envelopePath =
    envelopeFlag ?? (resultsDir === undefined ? undefined : `${resultsDir}/envelope.json`);
  if (envelopePath !== undefined) {
    const sighting = await detectInstallState({
      artifact: targetType,
      name,
      sourcePath: skillPath,
    });
    // A triggering sweep needs the artifact reachable by the router, so an ABSENT target is
    // the conflict here -- the mirror of the disclosure case, where an installed target
    // floors every pull rate at zero. Reported rather than thrown: the run already happened
    // and its numbers are still worth reading once a reader knows what they measured.
    const conflict = installConflict({
      operation: "optimize-description",
      needs: "installed",
      found: sighting.state,
    });
    const runsPer = flagNumber(flags, "runs-per-query") ?? 1;
    await writeEnvelope(
      envelopePath,
      buildDescriptionEnvelope({
        output,
        targetName: name,
        artifact: targetType,
        tally: tally.snapshot(),
        // Iterations actually RUN, not the cap: a loop that exited early on `all_passed`
        // budgeted fewer attempts than `--max-iterations` implies, and the difference is a
        // denominator rather than a rounding error.
        plannedAttempts: evalSet.length * runsPer * output.iterations_run,
        model,
        workers: flagNumber(flags, "num-workers") ?? 1,
        runsPer,
        timeoutSeconds: flagNumber(flags, "timeout") ?? 0,
        evalSetHash: hashJsonValue(evalSet),
        targetSha: await hashArtifact(skillPath),
        installState: sighting.state,
        isolation: isolation.state(),
        startedAt: envelopeStartedAt,
        caps: [sighting.cap, conflict, ...isolation.caps()].filter(
          (cap): cap is string => cap !== null,
        ),
      }),
    );
    if (conflict !== null) console.error(`WARNING: ${conflict}`);
    console.error(`Envelope written to: ${envelopePath}`);
  }

  if (liveReportPath !== undefined) {
    await writeReport(liveReportPath, output, false, name);
    console.error(`\nReport: ${liveReportPath}`);
  }
  if (resultsDir !== undefined && liveReportPath !== undefined) {
    await writeReport(`${resultsDir}/report.html`, output, false, name);
  }
  if (resultsDir !== undefined) console.error(`Results saved to: ${resultsDir}`);

  // Non-zero when the loop stopped on a failure rather than converging, so a caller
  // scripting this can tell the difference. The results are still on stdout and on disk --
  // the exit code reports HOW it ended, not that nothing was produced.
  if (output.improvement_error !== undefined) {
    console.error(
      `\nExited early: the improvement step failed (${output.improvement_error}). ` +
        `${output.iterations_run} iteration(s) were scored and saved.`,
    );
    process.exit(1);
  }
}

if (import.meta.main) await main();
