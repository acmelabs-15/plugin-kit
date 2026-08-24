#!/usr/bin/env bun
/**
 * Measure whether an artifact improves task outcomes, against a per-artifact control.
 *
 * WHAT THIS MECHANISES
 * --------------------
 * `skills/skill-creator/SKILL.md`, "Running and evaluating the evals", describes a
 * procedure a human drives by hand: for each eval, spawn a with-skill run and a baseline
 * run in the same turn (Step 1), write each run's `timing.json` as its notification
 * arrives (Step 3), grade each run against `shared/references/grader.md` (Step 4.1), and
 * aggregate the gradings into per-configuration means (Step 4.2).
 *
 * Those four steps are what this script does. The three that remain human are named in
 * `provenance.caps` of every envelope it writes rather than quietly dropped: drafting the
 * expectations (Step 2), the analyst pass over the aggregates
 * (`shared/references/benchmark-notes.md`), and the human review in the viewer (Steps 4.4
 * and 5). None of the three is a measurement, and mechanising a judgement call would only
 * produce a number with nobody behind it.
 *
 * WHY THE BASELINE IS A SWITCH AND NOT A CONSTANT
 * -----------------------------------------------
 * "Does the artifact help?" is answered by re-running the same work with the artifact's
 * contribution removed, and what "removed" means is different for every artifact kind:
 *
 *   skill    the same prompt with the skill absent
 *   agent    the same task with no delegation available
 *   mcp      the same task with the server removed
 *   plugin   the same task with the plugin uninstalled
 *   command  -- no control of this shape exists --
 *
 * The command row is the reason this script has a {@link Baseline} type rather than a
 * boolean. A command runs because the user typed it. There is no "would it have fired"
 * question, so there is nothing to withhold that leaves the request intact. The only
 * comparison available is the same request WITHOUT the command's body, and that measures
 * what the body's content contributed -- a real question, and a different one. Folding it
 * in beside the other four would put a body-content delta in the same column as an
 * artifact-contribution delta under the same heading, which is how a number comes to mean
 * something other than what its label says.
 *
 * So the command case is labelled everywhere it surfaces: its configuration is named
 * `body_withheld` rather than `artifact_withheld`, its headline metric carries the
 * distinction in the label a reader actually reads, its verdicts state the question they
 * answer, and a cap says in one sentence that this run does not answer whether the command
 * helped. {@link Baseline.answersArtifactContribution} is the machine-readable form of the
 * same fact.
 *
 * WHAT A RUN THAT DID NOT HAPPEN IS WORTH
 * ---------------------------------------
 * Nothing, and that is this operation's timeout policy. `measure-triggering.ts` scores a
 * timed-out query as a non-trigger, which is defensible there -- the router demonstrably
 * did not reach for the artifact inside the budget. Here the unit is a whole task run
 * graded against expectations, and a task that never finished is not evidence that the
 * artifact failed to help; it is evidence of nothing. Scoring it would let a throttled
 * afternoon read as a regression. So `provenance.timeoutPolicy` is `excluded`, and a
 * timeout, a throttle, a spawn error and a grader failure all land in `excluded` while
 * being counted in `failed`.
 *
 * That last point is the live defect this deliberately does not reproduce. In
 * `runSingleQuery` an `exhausted` stream -- one that closed without ever reaching a
 * verdict, which is what an exhausted rate limit looks like from the read side -- is
 * recorded as a legitimate decline, so `provenance.failed` reports 0 on a run the API
 * throttled. Here a stream that closes without a terminal `result` event is a failure by
 * construction ({@link readRunStream}), and text carrying a rate-limit marker is
 * classified as `throttled` ({@link classifyFailureText}). A run that could not complete
 * never becomes a result.
 *
 * A PARTIAL RUN SAYS SO IN ITS OWN OUTPUT
 * ---------------------------------------
 * `exitReason` starts at `"in progress"` and a snapshot is written after every settled
 * cell, so an envelope found on disk after a crash carries an `in-progress` run verdict
 * and a cap saying how many cells of how many had settled. A complete run's envelope says
 * `complete`; a run that finished with cells it could not complete says `partial`. The
 * three are never the same document.
 *
 * Usage:
 *   bun shared/operations/measure-outcomes.ts --target-path skills/<name> \
 *     --artifact skill --evals evals/outcomes/<name>.json --out <dir>
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

import {
  buildEnvelope,
  detectInstallState,
  hashArtifact,
  hashJsonValue,
  installConflict,
  type ArtifactKind,
  type Envelope,
  type HeadlineMetric,
  type InstallState,
  type Verdict,
  writeEnvelope,
} from "../envelope.ts";
import type { Spec } from "../cli.ts";
import { mapWithConcurrency } from "../util/pool.ts";
import { calculateStats, type Stats } from "../util/stats.ts";
import { runIsolatedHelper, runStreamingLines, SKILL_EXECUTION_GRANT } from "../util/subprocess.ts";
import {
  flagNumber,
  flagString,
  installTargetForTrigger,
  isRecord,
  parseCli,
  readTargetDefinition,
  requireFlag,
  type TargetType,
} from "./measure-triggering.ts";

// ---------------------------------------------------------------------------
// Baselines
// ---------------------------------------------------------------------------

/**
 * What was withheld from the baseline arm.
 *
 * Two values rather than five, because four of the five artifact kinds withhold the
 * artifact itself and differ only in what that is called. `body-withheld` is the odd one
 * and the whole reason the distinction is carried in the data instead of in a comment.
 */
export type ControlKind = "artifact-withheld" | "body-withheld";

export interface Baseline {
  /** The configuration name used in rows, so the two arms are never confusable. */
  readonly configuration: string;
  readonly control: ControlKind;
  /** What is actually done differently in the baseline arm, in one sentence. */
  readonly mechanism: string;
  /** The question the treatment-minus-baseline delta answers, in one sentence. */
  readonly question: string;
  /**
   * Whether the delta answers "did the artifact help?".
   *
   * False for `command` and true for everything else. A consumer that puts two runs side
   * by side reads this before it puts two deltas in the same column.
   */
  readonly answersArtifactContribution: boolean;
  /** Coverage caveats this baseline always carries. Non-empty only for `command`. */
  readonly caps: readonly string[];
}

/** The configuration name of the arm the artifact is present in. */
export const TREATMENT_CONFIGURATION = "with_artifact";

/**
 * The control for one artifact kind.
 *
 * Exhaustive over {@link ArtifactKind} by construction -- a new kind is a type error here
 * rather than a silent fall-through to the skill baseline, which is the failure mode that
 * would produce a number labelled like the others and meaning something else.
 */
export function selectBaseline(artifact: ArtifactKind): Baseline {
  switch (artifact) {
    case "skill":
      return {
        configuration: "artifact_withheld",
        control: "artifact-withheld",
        mechanism: "the same prompt run with the skill absent from the run's project root",
        question: "Did the skill improve the outcome, against the same prompt without it?",
        answersArtifactContribution: true,
        caps: [],
      };
    case "agent":
      return {
        configuration: "artifact_withheld",
        control: "artifact-withheld",
        mechanism:
          "the same task run with no delegation available: the agent is absent from the " +
          "run's project root, so there is nothing to delegate to",
        question: "Did delegating to the agent improve the outcome, against doing the task undelegated?",
        answersArtifactContribution: true,
        caps: [],
      };
    case "mcp":
      return {
        configuration: "artifact_withheld",
        control: "artifact-withheld",
        mechanism: "the same task run with the server removed from the run's MCP configuration",
        question: "Did the server improve the outcome, against the same task without it?",
        answersArtifactContribution: true,
        caps: [],
      };
    case "plugin":
      return {
        configuration: "artifact_withheld",
        control: "artifact-withheld",
        mechanism: "the same task run with the plugin uninstalled from the run's project root",
        question: "Did the plugin improve the outcome, against the same task without it?",
        answersArtifactContribution: true,
        caps: [],
      };
    case "command":
      return {
        configuration: "body_withheld",
        control: "body-withheld",
        mechanism: "the same request sent without the command's body prepended",
        question:
          "What did the command's body contribute to the outcome? This is NOT whether the " +
          "command helped: a command runs because the user typed it, so no would-it-have-fired " +
          "control exists.",
        answersArtifactContribution: false,
        caps: [
          "This run measures the CONTENT OF THE COMMAND BODY, not whether the command " +
            "artifact helped. A command has no natural control -- it runs because the user " +
            "typed it -- so the baseline arm is the same request with the body omitted. The " +
            "delta below is not comparable with a skill, agent, mcp or plugin delta, which " +
            "measure artifact contribution.",
        ],
      };
    default: {
      const unreachable: never = artifact;
      throw new TypeError(`no baseline defined for artifact kind ${String(unreachable)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// The eval set
// ---------------------------------------------------------------------------

export interface OutcomeEval {
  readonly id: string | number;
  /** What the eval tests. Used as the row label, per `eval_metadata.json`'s `eval_name`. */
  readonly name: string;
  readonly prompt: string;
  readonly expectations: readonly string[];
}

/**
 * Read an eval set in the shape `evals.json` and `eval_metadata.json` already use.
 *
 * Rejects rather than defaults. An eval with no prompt cannot be run and an eval set that
 * is not an array is a different file than the one that was meant; both are better as an
 * error at parse time than as a zero in a table.
 */
export function parseOutcomeEvalSet(value: unknown, path: string): readonly OutcomeEval[] {
  const items = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value["evals"])
      ? value["evals"]
      : null;
  if (items === null) {
    throw new TypeError(`${path}: expected an array of evals, or an object with an "evals" array`);
  }
  return items.map((raw, index) => {
    if (!isRecord(raw)) throw new TypeError(`${path}: eval ${index} is not an object`);
    const prompt = raw["prompt"];
    if (typeof prompt !== "string" || prompt.trim() === "") {
      throw new TypeError(`${path}: eval ${index} has no "prompt"`);
    }
    const rawId = raw["id"];
    const id = typeof rawId === "string" || typeof rawId === "number" ? rawId : index;
    const rawName = raw["eval_name"] ?? raw["name"];
    const expectations = Array.isArray(raw["expectations"])
      ? raw["expectations"].filter((item): item is string => typeof item === "string")
      : [];
    return {
      id,
      name: typeof rawName === "string" && rawName !== "" ? rawName : `eval-${String(id)}`,
      prompt,
      expectations,
    };
  });
}

// ---------------------------------------------------------------------------
// The model boundary
// ---------------------------------------------------------------------------

/** One planned unit of work: one eval, in one arm, on one repeat. */
export interface RunRequest {
  readonly evalItem: OutcomeEval;
  readonly configuration: string;
  readonly control: ControlKind | null;
  readonly runNumber: number;
  /** What is actually sent. Differs between arms only in the command case. */
  readonly prompt: string;
  /** Whether the artifact is installed in this arm's run root. */
  readonly artifactAvailable: boolean;
  readonly timeoutSeconds: number;
  readonly model: string | undefined;
}

export interface CompletedRun {
  readonly kind: "completed";
  readonly transcript: string;
  readonly durationSeconds: number;
  /** As reported by the runtime's own usage accounting, or null when it reported none. */
  readonly tokens: number | null;
  readonly toolCalls: number | null;
}

/**
 * How one run ended.
 *
 * Four terminal states, three of which are not results. `throttled` is separate from
 * `failed` because a rate-limited sweep is worth naming in the caps as its own thing --
 * the fix is to wait, not to debug -- and because the failure this file exists to avoid is
 * exactly a throttle that arrives looking like an answer.
 */
export type RunOutcome =
  | CompletedRun
  | { readonly kind: "timeout"; readonly seconds: number }
  | { readonly kind: "throttled"; readonly message: string }
  | { readonly kind: "failed"; readonly message: string };

/** The seam the tests substitute. Real execution spawns `claude`; a test does not. */
export type RunExecutor = (request: RunRequest) => Promise<RunOutcome>;

export interface GradedExpectation {
  readonly text: string;
  readonly passed: boolean;
  readonly evidence: string;
}

export type GradeOutcome =
  | { readonly kind: "graded"; readonly expectations: readonly GradedExpectation[] }
  | { readonly kind: "failed"; readonly message: string };

/** The second seam. Grading is a model call in production and a stub under test. */
export type Grader = (params: {
  readonly evalItem: OutcomeEval;
  readonly run: CompletedRun;
  readonly request: RunRequest;
}) => Promise<GradeOutcome>;

/**
 * Markers that mean "the API refused, come back later" rather than "the task failed".
 *
 * Lowercased substrings, matched against whatever text the failure carried. Deliberately
 * narrow: a false positive here mislabels a genuine error, and both outcomes are excluded
 * from the numbers either way, so the only thing at stake is which sentence the caps get.
 */
export const THROTTLE_MARKERS: readonly string[] = [
  "rate limit",
  "rate_limit",
  "429",
  "usage limit",
  "overloaded",
  "quota exceeded",
  "too many requests",
];

/** Whether a failure's text says the API throttled us. */
export function classifyFailureText(text: string): "throttled" | "failed" {
  const haystack = text.toLowerCase();
  return THROTTLE_MARKERS.some((marker) => haystack.includes(marker)) ? "throttled" : "failed";
}

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

export type CellStatus = "scored" | "excluded";

export type FailureKind = "timeout" | "throttled" | "error" | "grader-failed" | "no-expectations";

/** One run cell, in the envelope's row vocabulary. */
export interface OutcomeRow {
  readonly evalId: string | number;
  readonly evalName: string;
  readonly configuration: string;
  readonly control: ControlKind | null;
  readonly runNumber: number;
  readonly status: CellStatus;
  /** Null on every excluded cell. A zero here would be a score nobody measured. */
  readonly passRate: number | null;
  readonly passed: number | null;
  readonly total: number | null;
  readonly durationSeconds: number | null;
  readonly tokens: number | null;
  readonly toolCalls: number | null;
  readonly failureKind: FailureKind | null;
  readonly detail: string | null;
}

/**
 * Run one cell and turn its outcome into a row.
 *
 * The single place a cell becomes `scored`, and it is reachable only from a `completed`
 * run that was graded against at least one expectation. Every other path produces an
 * excluded row carrying why.
 */
export async function runCell(params: {
  readonly request: RunRequest;
  readonly executor: RunExecutor;
  readonly grader: Grader;
}): Promise<OutcomeRow> {
  const { request } = params;
  const base = {
    evalId: request.evalItem.id,
    evalName: request.evalItem.name,
    configuration: request.configuration,
    control: request.control,
    runNumber: request.runNumber,
  } as const;
  const excluded = (failureKind: FailureKind, detail: string, run?: CompletedRun): OutcomeRow => ({
    ...base,
    status: "excluded",
    passRate: null,
    passed: null,
    total: null,
    durationSeconds: run?.durationSeconds ?? null,
    tokens: run?.tokens ?? null,
    toolCalls: run?.toolCalls ?? null,
    failureKind,
    detail,
  });

  // An eval with no expectations is graded against nothing, so its "pass rate" would be a
  // ratio with an empty numerator and denominator. Excluded rather than scored 0 or 1.
  if (request.evalItem.expectations.length === 0) {
    return excluded("no-expectations", "the eval carries no expectations, so nothing was graded");
  }

  let outcome: RunOutcome;
  try {
    outcome = await params.executor(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const kind = classifyFailureText(message);
    return excluded(kind === "throttled" ? "throttled" : "error", message);
  }

  if (outcome.kind === "timeout") {
    return excluded("timeout", `the run hit the ${outcome.seconds}s budget and was cut off`);
  }
  if (outcome.kind === "throttled") return excluded("throttled", outcome.message);
  if (outcome.kind === "failed") {
    const kind = classifyFailureText(outcome.message);
    return excluded(kind === "throttled" ? "throttled" : "error", outcome.message);
  }

  let grading: GradeOutcome;
  try {
    grading = await params.grader({ evalItem: request.evalItem, run: outcome, request });
  } catch (error) {
    return excluded("grader-failed", error instanceof Error ? error.message : String(error), outcome);
  }
  if (grading.kind === "failed") return excluded("grader-failed", grading.message, outcome);
  if (grading.expectations.length === 0) {
    return excluded("grader-failed", "the grader returned no graded expectations", outcome);
  }

  const passed = grading.expectations.filter((item) => item.passed).length;
  const total = grading.expectations.length;
  return {
    ...base,
    status: "scored",
    passRate: passed / total,
    passed,
    total,
    durationSeconds: outcome.durationSeconds,
    tokens: outcome.tokens,
    toolCalls: outcome.toolCalls,
    failureKind: null,
    detail: null,
  };
}

// ---------------------------------------------------------------------------
// The measurement
// ---------------------------------------------------------------------------

export interface MeasureOutcomesParams {
  readonly artifact: ArtifactKind;
  /** The artifact's authored name, as it appears in `run.target`. */
  readonly targetName: string;
  readonly evals: readonly OutcomeEval[];
  readonly runsPerConfiguration: number;
  readonly numWorkers: number;
  readonly timeoutSeconds: number;
  readonly model: string | undefined;
  readonly executor: RunExecutor;
  readonly grader: Grader;
  /**
   * The command's body, prepended to the treatment prompt for a `command` target.
   *
   * Required for `command` and ignored otherwise: it is the thing the baseline arm
   * withholds, so a command measurement without it has no treatment arm at all.
   */
  readonly commandBody?: string | undefined;
  /** Called after every settled cell, so a crash leaves a snapshot on disk. */
  readonly onCell?: ((rows: readonly OutcomeRow[], settled: number, planned: number) => Promise<void> | void) | undefined;
}

export interface OutcomesOutput {
  readonly artifact: ArtifactKind;
  readonly target_name: string;
  readonly baseline: Baseline;
  readonly planned_cells: number;
  readonly rows: readonly OutcomeRow[];
  /**
   * `"in progress"` until the sweep returns.
   *
   * Snapshots carry the literal, so a well-formed file that stops short is legible as one.
   */
  readonly exit_reason: string;
}

/** Build the plan: every eval, in both arms, `runsPerConfiguration` times. */
export function planCells(params: {
  readonly evals: readonly OutcomeEval[];
  readonly baseline: Baseline;
  readonly runsPerConfiguration: number;
  readonly timeoutSeconds: number;
  readonly model: string | undefined;
  readonly commandBody?: string | undefined;
}): readonly RunRequest[] {
  const requests: RunRequest[] = [];
  const body = params.commandBody;
  for (const evalItem of params.evals) {
    for (let runNumber = 1; runNumber <= params.runsPerConfiguration; runNumber += 1) {
      requests.push({
        evalItem,
        configuration: TREATMENT_CONFIGURATION,
        control: null,
        runNumber,
        // The command arm is the one where the two prompts differ: the body IS the
        // artifact's contribution, so the treatment prompt is the body plus the request.
        prompt:
          params.baseline.control === "body-withheld" && body !== undefined && body !== ""
            ? `${body}\n\n${evalItem.prompt}`
            : evalItem.prompt,
        artifactAvailable: params.baseline.control !== "body-withheld",
        timeoutSeconds: params.timeoutSeconds,
        model: params.model,
      });
      requests.push({
        evalItem,
        configuration: params.baseline.configuration,
        control: params.baseline.control,
        runNumber,
        prompt: evalItem.prompt,
        artifactAvailable: false,
        timeoutSeconds: params.timeoutSeconds,
        model: params.model,
      });
    }
  }
  return requests;
}

/**
 * Run every planned cell and return the rows.
 *
 * `exit_reason` is `"in progress"` on every snapshot and is replaced only when the sweep
 * returns. A caller that never sees the return value -- because the process died -- is left
 * with a file that says so.
 */
export async function measureOutcomes(params: MeasureOutcomesParams): Promise<OutcomesOutput> {
  const baseline = selectBaseline(params.artifact);
  if (baseline.control === "body-withheld" && (params.commandBody ?? "") === "") {
    throw new TypeError(
      "a command measurement needs the command body: the baseline arm withholds it, so " +
        "without it both arms send the same prompt and the delta measures nothing",
    );
  }
  const requests = planCells({
    evals: params.evals,
    baseline,
    runsPerConfiguration: params.runsPerConfiguration,
    timeoutSeconds: params.timeoutSeconds,
    model: params.model,
    commandBody: params.commandBody,
  });

  const rows: OutcomeRow[] = [];
  let settled = 0;
  await mapWithConcurrency(requests, Math.max(1, params.numWorkers), async (request) => {
    const row = await runCell({ request, executor: params.executor, grader: params.grader });
    rows.push(row);
    settled += 1;
    await params.onCell?.(rows, settled, requests.length);
    return row;
  });

  const incomplete = rows.filter((row) => row.status === "excluded").length;
  return {
    artifact: params.artifact,
    target_name: params.targetName,
    baseline,
    planned_cells: requests.length,
    rows,
    exit_reason:
      rows.length < requests.length
        ? `partial (${rows.length} of ${requests.length} cells settled)`
        : incomplete === 0
          ? "complete"
          : `partial (${incomplete} of ${requests.length} cells could not be scored)`,
  };
}

// ---------------------------------------------------------------------------
// The results envelope
// ---------------------------------------------------------------------------

export interface ArmSummary {
  readonly configuration: string;
  readonly scored: number;
  readonly passRate: Stats;
  readonly durationSeconds: Stats;
}

/** Per-arm aggregates over scored cells only. */
export function summarizeArm(rows: readonly OutcomeRow[], configuration: string): ArmSummary {
  const scored = rows.filter((row) => row.status === "scored" && row.configuration === configuration);
  return {
    configuration,
    scored: scored.length,
    passRate: calculateStats(scored.map((row) => row.passRate ?? 0)),
    durationSeconds: calculateStats(
      scored.filter((row) => row.durationSeconds !== null).map((row) => row.durationSeconds ?? 0),
    ),
  };
}

export interface OutcomesEnvelopeInput {
  readonly output: OutcomesOutput;
  readonly model: string | null;
  readonly graderModel: string | null;
  readonly workers: number;
  readonly runsPer: number;
  readonly timeoutSeconds: number;
  readonly evalSetHash: string;
  readonly targetSha: string;
  readonly installState: InstallState;
  /** True while the sweep is still running. Snapshots pass true; the final write false. */
  readonly inProgress: boolean;
  readonly caps?: readonly string[];
  readonly startedAt?: Date;
}

/**
 * The headline label for the treatment-minus-baseline delta.
 *
 * Separate function because it is the single place the command case is prevented from
 * looking like the other four to a reader who only reads labels. A consumer lining two
 * runs up in one column has to see different words, not the same words plus a footnote.
 */
export function deltaLabel(baseline: Baseline): string {
  return baseline.answersArtifactContribution
    ? "pass rate delta (artifact withheld)"
    : "pass rate delta (command body withheld — body-content measure, NOT artifact contribution)";
}

/**
 * Build the envelope for one outcome sweep. Pure, so the contract is testable offline.
 */
export function buildOutcomesEnvelope(input: OutcomesEnvelopeInput): Envelope<OutcomeRow> {
  const { output } = input;
  const baseline = output.baseline;
  const rows = output.rows;
  const treatment = summarizeArm(rows, TREATMENT_CONFIGURATION);
  const control = summarizeArm(rows, baseline.configuration);

  const scored = rows.filter((row) => row.status === "scored").length;
  const excluded = rows.filter((row) => row.status === "excluded").length;
  // `no-expectations` is a deliberate exclusion rather than something the harness could
  // not do, so it is counted in `excluded` without inflating `failed`.
  const failed = rows.filter(
    (row) => row.failureKind !== null && row.failureKind !== "no-expectations",
  ).length;

  const headline: HeadlineMetric[] = [];
  if (treatment.scored > 0) {
    headline.push({
      label: `pass rate (${TREATMENT_CONFIGURATION})`,
      value: treatment.passRate.mean,
      unit: "fraction",
    });
  }
  if (control.scored > 0) {
    headline.push({
      label: `pass rate (${baseline.configuration})`,
      value: control.passRate.mean,
      unit: "fraction",
    });
  }
  // A delta needs both arms. Reporting one against an unmeasured zero would read as a
  // total win for whichever arm happened to run.
  if (treatment.scored > 0 && control.scored > 0) {
    headline.push({
      label: deltaLabel(baseline),
      value: treatment.passRate.mean - control.passRate.mean,
      unit: "fraction",
    });
  }

  const caps: string[] = [...(input.caps ?? []), ...baseline.caps];
  if (input.inProgress) {
    caps.push(
      `Run in progress: ${rows.length} of ${output.planned_cells} planned cells had settled ` +
        `when this envelope was written. Every figure above is over that partial set.`,
    );
  } else if (rows.length < output.planned_cells) {
    caps.push(
      `Run ended early: ${rows.length} of ${output.planned_cells} planned cells settled.`,
    );
  }
  const throttled = rows.filter((row) => row.failureKind === "throttled").length;
  if (throttled > 0) {
    caps.push(
      `${throttled} cell(s) were throttled by the API and are EXCLUDED, not scored. A ` +
        `throttled run is not evidence that the artifact failed to help; rerun those cells ` +
        `before reading the delta.`,
    );
  }
  const timedOut = rows.filter((row) => row.failureKind === "timeout").length;
  if (timedOut > 0) {
    caps.push(
      `${timedOut} cell(s) hit the ${input.timeoutSeconds}s budget and are EXCLUDED from ` +
        `every figure above, so both arms rest on fewer runs than the plan.`,
    );
  }
  const ungraded = rows.filter((row) => row.failureKind === "no-expectations").length;
  if (ungraded > 0) {
    caps.push(
      `${ungraded} cell(s) belong to evals carrying no expectations and were excluded: a ` +
        `pass rate over zero expectations is not a measurement.`,
    );
  }
  if (input.model === null) {
    caps.push(
      "No model was pinned for the task runs, so the environment chose one. Two runs that " +
        "both record `model: null` may have been answered by different models.",
    );
  }
  // The three steps of the manual procedure this script does not perform. Named here
  // because their absence is otherwise invisible in a file full of numbers.
  caps.push(
    "Expectations were taken as authored: this run did not draft or critique them, so an " +
      "expectation that passes regardless of the artifact still counts toward both arms.",
    "No analyst pass over the aggregates was run, and no human review of the outputs was " +
      "collected. Both remain manual steps of the eval loop.",
  );

  const verdicts: Verdict[] = [
    {
      subject: "run",
      verdict: input.inProgress ? "in-progress" : rows.length < output.planned_cells || failed > 0 ? "partial" : "complete",
      reason:
        `${scored} scored, ${excluded} excluded, ${failed} failed of ${output.planned_cells} ` +
        `planned cells. exitReason: ${input.inProgress ? "in progress" : output.exit_reason}.`,
    },
    {
      subject: "baseline",
      verdict: baseline.control,
      reason: `${baseline.mechanism}. ${baseline.question}`,
    },
    ...perEvalVerdicts(rows, baseline),
  ];

  return buildEnvelope<OutcomeRow>({
    run: {
      ...(input.startedAt === undefined ? {} : { startedAt: input.startedAt }),
      artifact: output.artifact,
      target: output.target_name,
      operation: "measure-outcomes",
      model: input.model,
      graderModel: input.graderModel,
      workers: input.workers,
      runsPer: input.runsPer,
      timeoutSeconds: input.timeoutSeconds,
      evalSetHash: input.evalSetHash,
      targetSha: input.targetSha,
      installState: input.installState,
    },
    provenance: {
      // Token figures in the rows come from the runtime's own usage accounting; nothing
      // here counts tokens. `none` when no run reported any, so the field never claims a
      // number that does not exist.
      tokenizer: rows.some((row) => row.tokens !== null) ? "estimated" : "none",
      unit: "eval run",
      scored,
      excluded,
      failed,
      // A task run that did not finish says nothing about whether the artifact helped.
      timeoutPolicy: "excluded",
      caps,
    },
    headline,
    rows,
    verdicts,
  });
}

/** One verdict per eval: did the artifact (or the body) move the outcome for this eval? */
function perEvalVerdicts(rows: readonly OutcomeRow[], baseline: Baseline): readonly Verdict[] {
  const names = [...new Set(rows.map((row) => row.evalName))];
  return names.map((name) => {
    const forEval = rows.filter((row) => row.evalName === name);
    const treatment = summarizeArm(forEval, TREATMENT_CONFIGURATION);
    const control = summarizeArm(forEval, baseline.configuration);
    if (treatment.scored === 0 || control.scored === 0) {
      return {
        subject: `eval:${name}`,
        verdict: "undetermined",
        reason:
          `Only one arm produced a scored run (${TREATMENT_CONFIGURATION}: ${treatment.scored}, ` +
          `${baseline.configuration}: ${control.scored}), so no comparison was possible.`,
      };
    }
    const delta = treatment.passRate.mean - control.passRate.mean;
    const verdict = delta > 0 ? "improved" : delta < 0 ? "regressed" : "no-difference";
    return {
      subject: `eval:${name}`,
      verdict: baseline.answersArtifactContribution ? verdict : `${verdict} (body-content)`,
      reason:
        `${treatment.passRate.mean.toFixed(2)} against ${control.passRate.mean.toFixed(2)} ` +
        `over ${treatment.scored} and ${control.scored} scored runs. ${baseline.question}`,
    };
  });
}

// ---------------------------------------------------------------------------
// The default executor and grader
// ---------------------------------------------------------------------------

/** Artifact kinds this script can prepare a run root for without guessing. */
export const INSTALLABLE_KINDS: readonly ArtifactKind[] = ["skill", "agent", "command"];

interface StreamTotals {
  readonly tokens: number | null;
  readonly toolCalls: number;
  readonly transcript: string;
  readonly sawResult: boolean;
  readonly errorText: string | null;
}

/**
 * Fold a `stream-json` transcript into what a graded run needs.
 *
 * The terminal `result` event is required. An exhausted stream that never produced one is
 * a run that did not finish -- which is what an exhausted rate limit looks like from here --
 * and the caller turns that into a failure rather than into a zero-scoring result.
 */
export function readRunStream(lines: readonly string[]): StreamTotals {
  let tokens: number | null = null;
  let toolCalls = 0;
  let sawResult = false;
  let errorText: string | null = null;
  const transcript: string[] = [];

  for (const line of lines) {
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(event)) continue;
    if (event["type"] === "assistant") {
      const message = isRecord(event["message"]) ? event["message"] : {};
      const content = message["content"];
      if (Array.isArray(content)) {
        for (const raw of content) {
          if (!isRecord(raw)) continue;
          if (raw["type"] === "tool_use") toolCalls += 1;
          if (raw["type"] === "text" && typeof raw["text"] === "string") transcript.push(raw["text"]);
        }
      }
      const usage = isRecord(message["usage"]) ? message["usage"] : null;
      if (usage !== null) {
        const input = typeof usage["input_tokens"] === "number" ? usage["input_tokens"] : 0;
        const output = typeof usage["output_tokens"] === "number" ? usage["output_tokens"] : 0;
        tokens = (tokens ?? 0) + input + output;
      }
    }
    if (event["type"] === "result") {
      sawResult = true;
      if (event["is_error"] === true || typeof event["subtype"] === "string" && event["subtype"] !== "success") {
        errorText = typeof event["result"] === "string" ? event["result"] : String(event["subtype"] ?? "error");
      } else if (typeof event["result"] === "string") {
        transcript.push(event["result"]);
      }
    }
  }
  return { tokens, toolCalls, transcript: transcript.join("\n\n"), sawResult, errorText };
}

/**
 * The production executor: one `claude -p` per cell, in a throwaway project root.
 *
 * The treatment arm installs the artifact into that root under a unique alias, reusing the
 * trigger harness's installer rather than opening a second one. The baseline arm installs
 * nothing, which is what all four artifact-withheld controls come down to -- an empty root
 * has no skill, no agent to delegate to, no server configured and no plugin installed --
 * and for a command it is the same empty root with the body left off the prompt.
 */
export function createClaudeExecutor(params: {
  readonly artifact: ArtifactKind;
  readonly targetPath: string;
  readonly targetName: string;
  readonly description: string;
  readonly permissionMode?: string | undefined;
}): RunExecutor {
  /* istanbul ignore next -- @preserve */
  return async (request: RunRequest): Promise<RunOutcome> => {
    let root: string;
    let cleanup = true;
    if (request.artifactAvailable) {
      const installed = await installTargetForTrigger({
        targetPath: params.targetPath,
        targetType: params.artifact as TargetType,
        name: params.targetName,
        description: params.description,
      });
      root = installed.root;
    } else {
      root = await mkdtemp(`${tmpdir()}/measure-outcomes-`);
    }

    const started = Bun.nanoseconds();
    try {
      const cmd = [
        "claude",
        "-p",
        request.prompt,
        "--output-format",
        "stream-json",
        "--verbose",
        "--setting-sources",
        "project",
        "--strict-mcp-config",
        // On BOTH arms deliberately. The control installs no artifact, so the grant is
        // inert there, and giving both arms identical flags keeps the artifact's presence
        // the only difference between them. Without it the treatment arm never loads the
        // skill and collapses into the control, so the delta this operation exists to
        // measure would read as zero for every artifact. See the constant.
        ...SKILL_EXECUTION_GRANT,
      ];
      if (request.model !== undefined && request.model !== "") cmd.push("--model", request.model);
      if (params.permissionMode !== undefined && params.permissionMode !== "") {
        cmd.push("--permission-mode", params.permissionMode);
      }

      const lines: string[] = [];
      const outcome = await runStreamingLines(
        cmd,
        { cwd: root, timeoutMs: request.timeoutSeconds * 1000 },
        (line) => {
          lines.push(line);
          return undefined;
        },
      );
      const seconds = (Bun.nanoseconds() - started) / 1e9;
      if (outcome.kind === "timeout") return { kind: "timeout", seconds: request.timeoutSeconds };
      if (outcome.kind === "error") {
        return classifyFailureText(outcome.message) === "throttled"
          ? { kind: "throttled", message: outcome.message }
          : { kind: "failed", message: outcome.message };
      }

      const totals = readRunStream(lines);
      if (!totals.sawResult) {
        // The defect this file exists not to repeat: a stream that closed without a
        // verdict is NOT an answer. Classified from whatever text arrived, so a throttle
        // says throttle rather than disappearing into the pass rate as a failed task.
        const tail = lines.slice(-5).join("\n");
        // `decided` is unreachable -- the line reader never returns a value -- but the
        // exit code only exists on `exhausted`, and narrowing beats asserting.
        const exitCode = outcome.kind === "exhausted" ? outcome.exitCode : null;
        const message = `the run stream closed without a terminal result event (exit ${String(exitCode)})`;
        return classifyFailureText(`${message}\n${tail}`) === "throttled"
          ? { kind: "throttled", message: `${message}; the tail carries a rate-limit marker` }
          : { kind: "failed", message };
      }
      if (totals.errorText !== null) {
        return classifyFailureText(totals.errorText) === "throttled"
          ? { kind: "throttled", message: totals.errorText }
          : { kind: "failed", message: totals.errorText };
      }
      cleanup = true;
      return {
        kind: "completed",
        transcript: totals.transcript,
        durationSeconds: seconds,
        tokens: totals.tokens,
        toolCalls: totals.toolCalls,
      };
    } finally {
      if (cleanup) await rm(root, { recursive: true, force: true });
    }
  };
}

/**
 * The production grader: one `claude -p` call carrying `shared/references/grader.md`.
 *
 * The reference file IS the grader's instructions, per the manual procedure, so it is
 * handed over rather than paraphrased. Only the `expectations` array is read back, because
 * that is the part this operation scores; the rest of the grader's schema belongs to the
 * viewer and is not this script's to invent.
 */
export function createClaudeGrader(params: {
  readonly graderModel: string;
  readonly instructionsPath: string;
}): Grader {
  /* istanbul ignore next -- @preserve */
  return async ({ evalItem, run }): Promise<GradeOutcome> => {
    const instructions = await Bun.file(params.instructionsPath).text();
    const prompt =
      `${instructions}\n\n---\n\nGrade the transcript below against these expectations. ` +
      `Reply with JSON only: {"expectations": [{"text": ..., "passed": true|false, ` +
      `"evidence": ...}]}.\n\nExpectations:\n` +
      evalItem.expectations.map((text, index) => `${index + 1}. ${text}`).join("\n") +
      `\n\nTranscript:\n${run.transcript}`;

    const cmd = ["claude", "-p", "--output-format", "text"];
    // Guarded so an empty value cannot leave a bare `--model` with nothing after it, which
    // is how `../operations/disclosure-measure.ts` appends the same flag.
    if (params.graderModel !== "") cmd.push("--model", params.graderModel);

    const outcome = await runIsolatedHelper(cmd, {
      timeoutMs: 300_000,
      stdin: prompt,
    });
    if (outcome.kind !== "ok") {
      const message = outcome.kind === "timeout" ? "the grader call timed out" : outcome.message;
      return { kind: "failed", message };
    }
    return parseGrading(outcome.stdout);
  };
}

/** Read a grader reply. A reply that is not gradeable is a failure, never an empty pass. */
export function parseGrading(text: string): GradeOutcome {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) {
    return { kind: "failed", message: "the grader reply carried no JSON object" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch (error) {
    return { kind: "failed", message: `the grader reply was not JSON: ${String(error)}` };
  }
  const items = isRecord(parsed) ? parsed["expectations"] : null;
  if (!Array.isArray(items)) {
    return { kind: "failed", message: "the grader reply had no `expectations` array" };
  }
  const expectations: GradedExpectation[] = [];
  for (const raw of items) {
    if (!isRecord(raw) || typeof raw["passed"] !== "boolean") {
      return { kind: "failed", message: "a graded expectation had no boolean `passed`" };
    }
    expectations.push({
      text: typeof raw["text"] === "string" ? raw["text"] : "",
      passed: raw["passed"],
      evidence: typeof raw["evidence"] === "string" ? raw["evidence"] : "",
    });
  }
  return { kind: "graded", expectations };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export const DEFAULT_RUNS_PER_CONFIGURATION = 1;
export const DEFAULT_NUM_WORKERS = 4;
export const DEFAULT_TIMEOUT_SECONDS = 600;
export const DEFAULT_GRADER_MODEL = "sonnet";

const USAGE =
  "Usage: bun shared/operations/measure-outcomes.ts --target-path <path> --artifact <kind> " +
  "--evals <path> [options]\n\n" +
  "Runs every eval twice — once with the artifact, once against its control — grades both\n" +
  "against the eval's expectations, and writes a results envelope.\n\n" +
  "The control depends on the artifact: a skill is withheld, an agent's delegation is\n" +
  "removed, an mcp server is removed, a plugin is uninstalled. A COMMAND HAS NO CONTROL:\n" +
  "its baseline is the same request without the command's body, which measures the body's\n" +
  "content and not whether the command helped. That run is labelled as such throughout.\n\n" +
  "Output goes to --out, never into evals/results, evals/trigger or evals/disclosure.";

export const OUTCOME_FLAGS: Spec = {
  "target-path": { kind: "string", help: "Path to the artifact under test" },
  artifact: { kind: "string", help: "skill | agent | command | mcp | plugin" },
  evals: { kind: "string", help: "Path to the eval set (evals.json shape)" },
  out: { kind: "string", default: "measurements/outcomes", help: "Directory for outcomes.json and envelope.json" },
  model: { kind: "string", help: "Model for the task runs (NOT the grader)" },
  "grader-model": { kind: "string", default: DEFAULT_GRADER_MODEL, help: "Model that grades expectations" },
  "runs-per-configuration": {
    kind: "number",
    default: DEFAULT_RUNS_PER_CONFIGURATION,
    help: "Repeats per eval per arm",
  },
  "num-workers": { kind: "number", default: DEFAULT_NUM_WORKERS, help: "Concurrent runs" },
  timeout: { kind: "number", default: DEFAULT_TIMEOUT_SECONDS, help: "Per-run wall clock in seconds" },
  "permission-mode": { kind: "string", help: "Passed to claude -p; use acceptEdits for evals that write files" },
  help: { kind: "boolean", short: "h", help: "Show this message" },
};

/** Output paths this script refuses to write into, because they are immutable records. */
export const PROTECTED_OUT_PREFIXES: readonly string[] = [
  "evals/results",
  "evals/trigger",
  "evals/disclosure",
];

export function assertWritableOut(out: string): void {
  const normalized = out.replace(/^\.\//, "").replace(/\/+$/, "");
  for (const prefix of PROTECTED_OUT_PREFIXES) {
    if (normalized === prefix || normalized.startsWith(`${prefix}/`)) {
      throw new TypeError(
        `refusing to write into ${prefix}: those directories hold immutable measurement ` +
          `records. Pass --out somewhere else.`,
      );
    }
  }
}

function parseArtifactKind(value: string): ArtifactKind {
  const kinds: readonly ArtifactKind[] = ["skill", "agent", "command", "mcp", "plugin"];
  const found = kinds.find((kind) => kind === value);
  if (found === undefined) throw new TypeError(`--artifact must be one of ${kinds.join(", ")}`);
  return found;
}

/* istanbul ignore next -- @preserve */
async function main(): Promise<void> {
  const { flags } = parseCli(OUTCOME_FLAGS, USAGE);
  const targetPath = requireFlag(flags, "target-path");
  const evalsPath = requireFlag(flags, "evals");
  const out = flagString(flags, "out") ?? "measurements/outcomes";

  let artifact: ArtifactKind;
  try {
    artifact = parseArtifactKind(requireFlag(flags, "artifact"));
    assertWritableOut(out);
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }

  if (!INSTALLABLE_KINDS.includes(artifact)) {
    console.error(
      `Error: this script can prepare a run root for ${INSTALLABLE_KINDS.join(", ")} only. ` +
        `The baseline for a ${artifact} is defined (see selectBaseline) but installing one ` +
        `into a throwaway project root is not mechanised here, and guessing at it would ` +
        `produce a treatment arm nobody has verified. Drive measureOutcomes() with your own ` +
        `executor for this kind.`,
    );
    process.exit(2);
  }

  const evals = parseOutcomeEvalSet(await Bun.file(evalsPath).json(), evalsPath);
  const definition = await readTargetDefinition(targetPath, artifact as TargetType);
  const model = flagString(flags, "model");
  const graderModel = flagString(flags, "grader-model") ?? DEFAULT_GRADER_MODEL;
  const runsPer = flagNumber(flags, "runs-per-configuration");
  const workers = flagNumber(flags, "num-workers");
  const timeoutSeconds = flagNumber(flags, "timeout");

  const sighting = await detectInstallState({
    artifact,
    name: definition.name,
    sourcePath: targetPath,
  });
  // `needs: "absent"`, which is the baseline arm's requirement rather than the treatment
  // arm's. This operation's whole claim is a DIFFERENCE between two arms, and the baseline
  // arm is defined by the artifact being withheld from it; a copy installed on the machine
  // is a copy both arms could reach, which collapses the difference toward zero and reports
  // that as "the artifact does not help".
  //
  // The three sibling operations all recorded this sentence and this one recorded only the
  // sighting, so a state that could void the delta reached `caps` as a neutral observation
  // and never as a conflict. That is the gap: on a `not-reachable` sweep the observation
  // reads as bookkeeping, and only the conflict says the run has not been shown to measure
  // anything.
  const conflict = installConflict({
    operation: "measure-outcomes",
    needs: "absent",
    found: sighting.state,
  });
  if (conflict !== null) console.error(`\nWARNING: ${conflict}`);
  const shared = {
    model: model ?? null,
    graderModel,
    workers,
    runsPer,
    timeoutSeconds,
    evalSetHash: hashJsonValue(evals),
    targetSha: await hashArtifact(targetPath),
    installState: sighting.state,
    // The conflict FIRST, ahead of the sighting it is derived from: a reader who stops after
    // the first line of `caps` has to have read the one that says the figures may be void.
    caps: [conflict, sighting.cap].filter((cap): cap is string => cap !== null),
    startedAt: new Date(),
  };
  const baseline = selectBaseline(artifact);
  const write = async (output: OutcomesOutput, inProgress: boolean): Promise<void> => {
    await Bun.write(`${out}/outcomes.json`, `${JSON.stringify(output, null, 2)}\n`);
    await writeEnvelope(`${out}/envelope.json`, buildOutcomesEnvelope({ output, inProgress, ...shared }));
  };

  // Written before the first cell settles, so the run is legible as unfinished from the
  // moment it starts rather than from the moment it first produces a row.
  const partialOf = (rows: readonly OutcomeRow[], planned: number): OutcomesOutput => ({
    artifact,
    target_name: definition.name,
    baseline,
    planned_cells: planned,
    rows,
    exit_reason: "in progress",
  });
  const planned = evals.length * runsPer * 2;
  await write(partialOf([], planned), true);

  const output = await measureOutcomes({
    artifact,
    targetName: definition.name,
    evals,
    runsPerConfiguration: runsPer,
    numWorkers: workers,
    timeoutSeconds,
    model,
    commandBody: artifact === "command" ? definition.content : undefined,
    executor: createClaudeExecutor({
      artifact,
      targetPath,
      targetName: definition.name,
      description: definition.description,
      permissionMode: flagString(flags, "permission-mode"),
    }),
    grader: createClaudeGrader({
      graderModel,
      instructionsPath: `${import.meta.dir}/../references/grader.md`,
    }),
    onCell: async (rows, settled, total) => {
      await write(partialOf(rows, total), settled < total);
    },
  });

  await write(output, false);
  console.log(JSON.stringify(output, null, 2));
}

if (import.meta.main) await main();
