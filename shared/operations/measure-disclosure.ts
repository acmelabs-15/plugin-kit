#!/usr/bin/env bun
/**
 * Measure what a skill costs to invoke, as authored. No restructure loop.
 *
 * This is the baseline sweep and nothing else: install a throwaway copy of the skill per
 * scenario, run it, grade the assertions, and report which bundled files were actually
 * read, on what fraction of runs, and at what token cost.
 *
 * It exists because the measurement was only reachable through `optimize-disclosure.ts`,
 * and two callers independently found the same way to neuter that loop into a measurement:
 * `--max-iterations 1 --holdout 0`. That works, but it is a workaround wearing the
 * optimizer's flag surface -- it accepts `--max-candidates`, `--apply` and
 * `--pass-rate-tolerance`, all of which are meaningless when nothing is being restructured,
 * and one of which is destructive. Ask for a measurement and you should get the flags of a
 * measurement.
 *
 * The engine is shared rather than copied. `lib/disclosure-measure.ts` owns the sweep, the
 * grading and the fold from runs into a scored layout; both this script and
 * `optimize-disclosure.ts` call it. Two implementations of a measurement that must agree is
 * a defect waiting for the day someone changes one verdict rule.
 *
 * Usage:
 *   bun shared/operations/measure-disclosure.ts --skill-path skills/<name> \
 *     --scenarios evals/disclosure/<name>.json
 */

import {
  DEFAULT_INLINE_THRESHOLD,
  formatFileStatLine,
  formatGroundTruthLine,
  loadTokenCounter,
  parseScenarioSet,
  scoreRuns,
  type DisclosureScenario,
  type FileStat,
  type GroundTruth,
  type ScenarioRun,
  type SplitScore,
  type TokenMethod,
} from "./disclosure.ts";
import {
  DEFAULT_NUM_WORKERS,
  DEFAULT_RUNS_PER_SCENARIO,
  DEFAULT_TIMEOUT_SECONDS,
  DEFAULT_GRADER_MODEL,
  measureLayout,
  setGraderBare,
  summarizeLayout,
  type MeasureParams,
} from "./disclosure-measure.ts";
import { availableParallelism } from "node:os";

import {
  createIsolationLedger,
  type IsolationState,
  type IsolationVerdict,
} from "../isolation.ts";
import {
  generateDisclosureReport,
  type DisclosureWarning,
} from "../report/disclosure-report.ts";
import {
  detectInstallState,
  ENVELOPE_FILENAME,
  hashArtifact,
  hashJsonValue,
  installConflict,
  writeEnvelope,
  type Envelope,
  type InstallState,
} from "../envelope.ts";
// The envelope builder is IMPORTED, not reimplemented. It already owns the row vocabulary,
// the per-file verdict reasons and the exclusion accounting, and those are exactly the
// judgements the two entry points must never disagree about -- a forked builder is how two
// producers stop agreeing about what a pull rate means. What differs between them is which
// caps are true, and the builder takes `operation` so it can gate those itself.
import {
  buildDisclosureEnvelope,
  createRunTally,
  type DisclosureRow,
  type OptimizeOutput,
  type RunTally,
} from "./optimize-disclosure.ts";
import {
  parseSelectors,
  selectRowsById,
  SubsetError,
  subsetCap,
  subsetProgressDetail,
  subsetSummaryLine,
  type ScenarioSubsetStamp,
} from "./subset.ts";
import type { Spec } from "../cli.ts";
import { readTargetDefinition } from "./measure-triggering.ts";
import { flagBoolean, flagNumber, flagString, parseCli, requireFlag } from "./measure-triggering.ts";
import { ProgressReporter } from "../util/progress.ts";

/**
 * The model every measurement runs on. Not a flag, and that is the point.
 *
 * The weaker tier IS THE DETECTION INSTRUMENT. A measurement asks whether the body's
 * pointers are good enough to send a model to the right file at the right moment, and a
 * stronger tier answers correctly in spite of a bad pointer -- it infers what was meant,
 * reaches the file anyway, and reports a healthy pull rate for a signposting defect that
 * will still be there when a weaker tier meets it. Measuring on the stronger tier does not
 * make the skill better; it makes the instrument blind. See `disclosure-optimization.md`.
 *
 * Hardcoded rather than defaulted because a default is still a knob, and unset this used to
 * inherit whatever model the environment happened to be configured with -- the worst of all
 * worlds, since the measurement then varied by operator without saying so.
 */
export const MEASUREMENT_MODEL = "sonnet";

/**
 * The permission mode every spawned scenario run uses. Also not a flag.
 *
 * Scenarios do the skill's real work and the real work writes files. The removed flag's own
 * help text said to pass `acceptEdits` for those, which made the correct value a thing you
 * had to remember rather than a thing the tool did -- and forgetting it does not fail
 * loudly, it just produces runs that stopped short of the work being measured.
 */
export const MEASUREMENT_PERMISSION_MODE = "acceptEdits";

export interface MeasureDisclosureParams {
  readonly skillPath: string;
  readonly scenarios: readonly DisclosureScenario[];
  readonly runsPerScenario: number;
  readonly numWorkers: number;
  readonly timeoutSeconds: number;
  readonly inlineThreshold: number;
  /**
   * A model to sweep on INSTEAD of {@link MEASUREMENT_MODEL}, for a tier study.
   *
   * Purpose-named at this boundary and not only at the CLI, so the substitution cannot be
   * made without saying what it is for. A caller that simply wants "a different model" has
   * no field to put it in, which is the whole design.
   */
  readonly tierStudy?: string | undefined;
  /** See `MeasureParams.fixtureDir` in disclosure-measure.ts. */
  readonly fixtureDir?: string | undefined;
  /**
   * Which slice of the scenario set `scenarios` already is, when `--only` narrowed it.
   *
   * Purpose-named at this boundary and not only at the CLI, for the same reason
   * {@link MeasureDisclosureParams.tierStudy} is: a caller that simply wants "fewer
   * scenarios" has no field to put that in, so a narrowed run cannot be made without
   * saying it is one. {@link selectRowsById} hands back the rows and this stamp as one
   * value, which is what keeps the two from being separated on the way here.
   */
  readonly subset?: ScenarioSubsetStamp | undefined;
  /** Grades the assertions. Deliberately not the measurement model; see `DEFAULT_GRADER_MODEL`. */
  readonly graderModel?: string | undefined;
  readonly logDir?: string | undefined;
  /**
   * Called once per scenario run, whatever became of it. Point it at {@link createRunTally}.
   *
   * A callback rather than a field on {@link MeasureOutput}, because `results.json` is a wire
   * contract and the envelope is additive to it: a run that asks for no envelope must produce
   * the same bytes it always did. It is also the only way the CLI can see how runs ENDED —
   * `MeasureOutput` reports how many never loaded the body, and says nothing at all about how
   * many timed out or failed outright, which is half of what `provenance` has to account for.
   */
  readonly onRunOutcome?: ((run: ScenarioRun) => void) | undefined;
  /**
   * Handed every scenario run's isolation proof. Point it at an `IsolationLedger`.
   *
   * Passed straight to the sweep rather than folded here, for the reason `onRunOutcome` is a
   * callback at all: `MeasureOutput` is a wire contract, and the folded state belongs in the
   * envelope beside `installState` -- the other field that says whether this run measured
   * the skill or the machine it ran on.
   */
  readonly onIsolation?: ((verdict: IsolationVerdict) => void) | undefined;
  readonly onProgress?: ((settled: number, total: number) => void) | undefined;
  readonly onStarted?:
    | ((inFlight: number, started: number, total: number) => void)
    | undefined;
  /**
   * The sweep, injected. Defaults to {@link measureLayout}, which spawns `claude`.
   *
   * The same reasoning `measureWithGate` gives for injecting its three sweeps: the thing
   * worth testing here is WHAT THIS FUNCTION HANDS THE SWEEP -- the fixed measurement model
   * and permission mode, or a tier study's substitution -- and a rule reachable only by
   * spending an hour of API time is a rule with no coverage. That is doubly true of these
   * two values, which are hardcoded precisely because they were being got wrong.
   */
  readonly sweep?: ((params: MeasureParams) => Promise<readonly ScenarioRun[]>) | undefined;
}

/**
 * What one measurement pass produced.
 *
 * Its own wire type rather than a reuse of `OptimizeOutput`. That shape reports a
 * SELECTION -- `baseline_` against `best_`, `applied_edits`, an `iterations` array -- and
 * every one of those fields would be a tautology here: nothing was restructured, so the
 * best layout is the only layout. Emitting them filled in with the same number twice would
 * invite a reader to compare them and conclude a restructure had happened.
 */
export interface MeasureOutput {
  readonly skill_name: string;
  readonly skill_path: string;
  /** What the machine's installed set looked like. `unknown` means the sweep ran blind. */
  readonly install_state: InstallState;
  /**
   * Why every figure below is void, or null when there is nothing wrong.
   *
   * Near the top of the shape rather than beside the numbers it invalidates, and carried in
   * the JSON as well as printed to stderr: a terminal gets closed and `results.json` is what
   * a report is built from later, so the sentence has to survive in the file too.
   */
  readonly install_conflict: string | null;
  readonly token_method: TokenMethod;
  readonly tokens_are_estimated: boolean;
  readonly scenario_count: number;
  readonly runs_per_scenario: number;
  /** Runs that finished without the skill ever reaching context. Excluded from every rate below. */
  readonly runs_without_skill: number;
  /**
   * Of the runs that DID load, how many did so by the model reading SKILL.md itself
   * rather than by the skill system injecting it. Healthy is zero; anything else means
   * the numbers describe a model rummaging in the skill directory.
   */
  readonly runs_loaded_via_file: number;
  readonly body_tokens: number;
  readonly context_tokens: number;
  readonly pass_rate: number;
  readonly assertions_passed: number;
  readonly assertions_total: number;
  readonly files: readonly FileStat[];
  /**
   * What the scenario set declared as ground truth, and what its negative rows measured.
   *
   * Additive, and always written. Every field beside it is unchanged, so a consumer that
   * has never heard of recall reads this file exactly as it did before -- and one that has
   * can tell an unannotated set from a layout that answered none of its pointers, which is
   * the distinction a bare rate of zero destroys.
   */
  readonly ground_truth: GroundTruth;
  /**
   * The model a TIER STUDY swept on, when this run was one. Absent otherwise.
   *
   * Absent rather than null for an ordinary run, so a measurement of record is byte-for-byte
   * the shape it always was and no consumer has to learn a new key to keep working. Present,
   * it means exactly one thing: these figures came from a deliberate off-tier sweep and are
   * NOT a signposting measurement of record — the pull rates were produced by a model that
   * is not the detection instrument.
   */
  readonly tier_study?: string;
  /**
   * Which slice of the scenario set ran, when `--only` narrowed it. Absent otherwise.
   *
   * Absent rather than null on a full sweep, exactly as `tier_study` is, and for the same
   * reason: a measurement of record keeps the shape it always had and no consumer has to
   * learn a key to keep working. Present, it means every pull rate above is over a
   * hand-picked set of scenarios — a file needed by two of the three scenarios that ran
   * shows a pull rate a full sweep would never have produced.
   */
  readonly subset?: ScenarioSubsetStamp;
}

/**
 * Narrow a scenario set to the ids `--only` named, or hand it back whole.
 *
 * Exported and pure so the resolution is reachable from the suite: everything downstream
 * of it spawns `claude`, and a selection rule that can only be exercised by spending an
 * hour of API time is a selection rule with no coverage.
 *
 * An unknown id is a hard error listing the ids that exist rather than an empty sweep. A
 * measurement over zero scenarios does not fail — it reports a 0% pass rate over nothing
 * and a file table of `prune` verdicts, which is indistinguishable from a layout nobody
 * reads and is the exact shape of a wrong conclusion.
 */
export function applyScenarioOnly(params: {
  readonly scenarios: readonly DisclosureScenario[];
  readonly only: string | undefined;
}): {
  readonly scenarios: readonly DisclosureScenario[];
  readonly subset: ScenarioSubsetStamp | null;
} {
  if (params.only === undefined) return { scenarios: params.scenarios, subset: null };
  const { rows, stamp } = selectRowsById({
    rows: params.scenarios,
    selectors: parseSelectors(params.only),
    unit: "scenario",
  });
  return { scenarios: rows, subset: stamp };
}

/**
 * Look for a copy of this skill installed on the machine, and say so when there is one.
 *
 * The sweep needs the skill NOT to be installed. Content served to the model through the
 * skill system never produces a `Read`, so a sweep that reached an installed copy instead of
 * the directory under test scores every bundled file at a pull rate of zero -- and the output
 * is a clean-looking table of `prune` verdicts that measures nothing. `optimize-disclosure.ts`
 * has said so since it gained an envelope. This entry point is the one the documentation
 * sends people to FIRST, as the cheaper half, and it said nothing at all.
 *
 * It PRINTS rather than handing a line back for the caller to print, so that the loudness has
 * one home and one test: `measureDisclosure` spends real API time and is unreachable from the
 * suite, and a warning nothing can prove fires is the defect this closes.
 */
export async function warnOnInstallConflict(params: {
  readonly skillPath: string;
  readonly skillName: string;
  /** Where to sweep. Defaults to the process's directory, as every other call site does. */
  readonly projectDir?: string;
}): Promise<{ readonly state: InstallState; readonly conflict: string | null }> {
  const sighting = await detectInstallState({
    artifact: "skill",
    name: params.skillName,
    sourcePath: params.skillPath,
    projectDir: params.projectDir,
  });
  const conflict = installConflict({
    operation: "measure-disclosure",
    needs: "absent",
    found: sighting.state,
  });
  if (conflict !== null) console.error(`\nWARNING: ${conflict}`);
  return { state: sighting.state, conflict };
}

/**
 * Run every scenario against the skill as it stands, once per `runsPerScenario`.
 *
 * One pool over the whole scenario set. There is no train/held-out split here and that is
 * not an omission: a split exists so a layout proposed from one half can be judged on the
 * other, and nothing is being proposed. Every scenario is evidence about the same
 * unmodified layout, so withholding half of it would buy nothing and halve the sample.
 */
export async function measureDisclosure(
  params: MeasureDisclosureParams,
): Promise<MeasureOutput> {
  const counter = await loadTokenCounter();
  const { name: skillName } = await readTargetDefinition(params.skillPath, "skill");

  // Before the sweep, not after it. A conflict floors every pull rate at zero, so an operator
  // told at second zero can stop; the run that motivated this said nothing and spent 144.
  const install = await warnOnInstallConflict({ skillPath: params.skillPath, skillName });

  if (params.scenarios.every((scenario) => scenario.expectations.length === 0)) {
    console.error(
      "Warning: no scenario carries expectations, so the pass rate below is measured against " +
        "nothing and says only that the runs completed.",
    );
  }

  const sweep = params.sweep ?? measureLayout;
  const runs = await sweep({
    skillDir: params.skillPath,
    skillName,
    scenarios: params.scenarios,
    runsPerScenario: params.runsPerScenario,
    numWorkers: params.numWorkers,
    timeoutSeconds: params.timeoutSeconds,
    // Always explicit. Passing nothing here is what used to hand the run to whatever model
    // the environment was configured with, so the sweep silently varied by operator.
    model: params.tierStudy ?? MEASUREMENT_MODEL,
    graderModel: params.graderModel,
    permissionMode: MEASUREMENT_PERMISSION_MODE,
    grade: true,
    logDir: params.logDir,
    fixtureDir: params.fixtureDir,
    onIsolation: params.onIsolation,
    onProgress: params.onProgress,
    onStarted: params.onStarted,
  });

  // After the sweep rather than on the pool's hot path, for the reason the optimizer gives
  // for the same loop: nothing reads the tally until the envelope is built, so counting
  // during the run would buy nothing.
  if (params.onRunOutcome !== undefined) for (const run of runs) params.onRunOutcome(run);

  // `holdout: null` and `gateReason: null` say the same thing they say in the optimizer:
  // no holdout was configured, so the train score IS the score. `summarizeLayout` computes
  // the file table from the train runs, which here is every run.
  const layout = await summarizeLayout({
    dir: params.skillPath,
    counter,
    measured: {
      trainRuns: runs,
      holdoutRuns: [],
      train: scoreRuns(runs),
      holdout: null,
      gateReason: null,
    },
    inlineThreshold: params.inlineThreshold,
    scenarios: params.scenarios,
  });

  if (layout.train.runsLoadedViaFile > 0) {
    console.error(
      `Warning: on ${layout.train.runsLoadedViaFile} run(s) the body reached context because ` +
        `the model READ SKILL.md itself, not because the skill system delivered it. Those runs ` +
        `describe a model already inside the skill directory choosing what to read next, which ` +
        `is not what a pull rate is meant to measure. Check that the Skill tool is granted.`,
    );
  }
  if (layout.train.runsWithoutSkill > 0) {
    console.error(
      `Warning: the skill never loaded on ${layout.train.runsWithoutSkill} run(s). Those runs ` +
        `are excluded from every pull rate, so the verdicts rest on less evidence than the ` +
        `run count suggests.`,
    );
  }

  // Said rather than shown as 0%. A set with no `expects_references` anywhere has not
  // measured a recall of zero, it has measured no recall at all, and the two look identical
  // in a column of dashes to anyone who does not already know which they are reading.
  if (layout.groundTruth.annotatedScenarios === 0) {
    console.error(
      "Note: no scenario declares `expects_references`, so no ground truth exists and recall " +
        "is not reported. The pull rates below stand alone, exactly as they did before — they " +
        "say how often each file was read, never how often it was read when it was needed.",
    );
  } else if (layout.groundTruth.overFetch === null) {
    console.error(
      `Note: ${layout.groundTruth.annotatedScenarios} scenario(s) declare ground truth, but ` +
        `none declares the empty list, so over-fetch is not reported. Recall alone is maximized ` +
        `by a layout that pulls every file on every run; a scenario expecting to reach nothing ` +
        `is what catches that.`,
    );
  }

  // Said a second time on purpose. `ProgressReporter` repaints stderr for the length of the
  // sweep, so the line printed before it started is long gone by now -- and this is the copy
  // that lands beside the table it invalidates, where the person reading the verdicts is.
  if (install.conflict !== null) console.error(`\nWARNING: ${install.conflict}`);

  return {
    skill_name: skillName,
    skill_path: params.skillPath,
    install_state: install.state,
    install_conflict: install.conflict,
    token_method: counter.method,
    tokens_are_estimated: counter.estimated,
    scenario_count: params.scenarios.length,
    runs_per_scenario: params.runsPerScenario,
    runs_without_skill: layout.train.runsWithoutSkill,
    runs_loaded_via_file: layout.train.runsLoadedViaFile,
    body_tokens: layout.bodyTokens,
    context_tokens: layout.train.meanContextTokens,
    pass_rate: layout.train.passRate,
    assertions_passed: layout.train.assertionsPassed,
    assertions_total: layout.train.assertionsTotal,
    files: layout.files,
    ground_truth: layout.groundTruth,
    ...(params.tierStudy === undefined ? {} : { tier_study: params.tierStudy }),
    ...(params.subset === undefined ? {} : { subset: params.subset }),
  };
}

/**
 * The caveats only this caller knows, for the banner the report renders above everything.
 *
 * Extracted and exported so the judgement is reachable from the suite. Every other input
 * `generateDisclosureReport` receives is derived by the renderer from the split score it is
 * handed; these three are decisions THIS entry point makes about how its figures should be
 * read, and a decision reachable only by spending an hour of API time is a decision with no
 * coverage — which is exactly how the install conflict came to be computed and never shown.
 *
 * The severities are not degrees of one thing. `invalidating` says the table below is a
 * table of nothing: a sweep answered by an installed copy floors every pull rate at zero.
 * `qualifying` says the figures are real and the run did what it set out to do — they simply
 * answer a narrower question than a measurement of record answers. A tier study and a subset
 * are both the second kind, for different reasons, and neither collapses into the other.
 */
export function reportWarnings(output: MeasureOutput): readonly DisclosureWarning[] {
  const warnings: DisclosureWarning[] = [];
  if (output.install_conflict !== null) {
    warnings.push({ severity: "invalidating", text: output.install_conflict });
  }
  if (output.tier_study !== undefined) {
    warnings.push({
      severity: "qualifying",
      text:
        `TIER STUDY: this sweep ran on ${output.tier_study}, not the ${MEASUREMENT_MODEL} ` +
        `detection instrument, so it is not a signposting measurement of record. A stronger ` +
        `tier reaches the right file in spite of a bad pointer, so the pull rates below ` +
        `describe the model as much as the layout.`,
    });
  }
  if (output.subset !== undefined) {
    // The pull rate is the figure a hand-picked scenario mix distorts most, because the
    // scenario set IS the denominator: a file two of the three scenarios that ran happen to
    // need shows a rate a full sweep would never have produced.
    warnings.push({ severity: "qualifying", text: output.subset.note });
  }
  return warnings;
}

// ---------------------------------------------------------------------------
// The results envelope
// ---------------------------------------------------------------------------

export interface MeasurementEnvelopeInput {
  readonly output: MeasureOutput;
  /**
   * How the runs ended, from `onRunOutcome`.
   *
   * The only source for two of the four outcomes. `MeasureOutput` reports how many runs
   * never loaded the body and says nothing whatever about how many timed out or failed
   * outright, and `provenance` has to account for all four.
   */
  readonly tally: RunTally;
  readonly workers: number;
  readonly timeoutSeconds: number;
  readonly inlineThreshold: number;
  readonly graderModel: string;
  /** From `hashJsonValue` over the scenarios that RAN. See the CLI for why that matters. */
  readonly scenarioSetHash: string;
  readonly targetSha: string;
  /**
   * Folded from the per-run proofs, from the caller's ledger.
   *
   * Not derived here, unlike the tier-study and subset caps below, because it is not a
   * property of `MeasureOutput`: the proofs are read off each child's `init` event during
   * the sweep and are gone by the time this builder runs. Required for the reason the field
   * is required on `DisclosureEnvelopeInput` -- see there.
   */
  readonly isolation: IsolationState;
  /** Extra caveats. The tier-study and subset caps are derived here, not passed. */
  readonly caps?: readonly string[];
  readonly startedAt?: Date;
}

/**
 * Build the results envelope for one measurement pass.
 *
 * Pure and exported, for the reason `buildTriggeringEnvelope` and `buildDisclosureEnvelope`
 * both give: every judgement here is about how the measurement will be read, and a judgement
 * reachable only by spending an hour of API time is a judgement with no coverage.
 *
 * IT ADAPTS RATHER THAN BUILDS
 * ----------------------------
 * `MeasureOutput` is this entry point's own wire shape and `buildDisclosureEnvelope` speaks
 * the optimizer's, so the work here is stating a measurement in that vocabulary -- one
 * iteration, accepted, nothing held out, baseline equal to best -- which is the same
 * translation `main` already performs to reach the HTML report. The alternative is a second
 * builder, and two builders are free to disagree about what a pull rate means, what a
 * `prune` verdict is grounded in, and which runs belong in a denominator. Those are the
 * judgements that must not fork; which CAPS are true is the part that genuinely differs, and
 * the builder gates that on `operation` rather than making this file restate it.
 */
export function buildMeasurementEnvelope(
  input: MeasurementEnvelopeInput,
): Envelope<DisclosureRow> {
  const output = input.output;

  // Error-free runs, which is what `SplitScore.runs` counts. `classifyRun` marks a run
  // `unloaded` in exactly the case `scoreRuns` counts as `runsWithoutSkill` -- both ask
  // whether the body reached context on a run that did not error, and `skillLoaded` and
  // `loadedVia` are assigned together -- so the two agree by construction and their sum is
  // the error-free population.
  const errorFreeRuns = input.tally.measured + input.tally.unloaded;
  const delivered = errorFreeRuns - output.runs_without_skill - output.runs_loaded_via_file;

  const train: SplitScore = {
    scenarios: output.scenario_count,
    runs: errorFreeRuns,
    assertionsPassed: output.assertions_passed,
    assertionsTotal: output.assertions_total,
    passRate: output.pass_rate,
    meanContextTokens: output.context_tokens,
    runsWithoutSkill: output.runs_without_skill,
    runsLoadedViaFile: output.runs_loaded_via_file,
    loadRate: errorFreeRuns === 0 ? 1 : delivered / errorFreeRuns,
  };

  // Baseline equal to best on every paired field, on purpose. The builder omits a headline
  // delta when the two are equal, so a measurement reports NO saving rather than a saving of
  // zero -- and a reader never has two numbers side by side inviting the conclusion that a
  // restructure was attempted and achieved nothing.
  const asOptimized: OptimizeOutput = {
    skill_name: output.skill_name,
    skill_path: output.skill_path,
    exit_reason: "measurement_only",
    token_method: output.token_method,
    tokens_are_estimated: output.tokens_are_estimated,
    holdout: 0,
    train_size: output.scenario_count,
    holdout_size: 0,
    runs_per_scenario: output.runs_per_scenario,
    baseline_body_tokens: output.body_tokens,
    best_body_tokens: output.body_tokens,
    baseline_context_tokens: output.context_tokens,
    best_context_tokens: output.context_tokens,
    best_layout_path: output.skill_path,
    applied_edits: [],
    files: output.files,
    iterations: [
      {
        iteration: 1,
        label: "measured (as authored)",
        candidateId: null,
        rationale: `${output.files.length} bundled file(s), ${output.body_tokens} body tokens`,
        bodyTokens: output.body_tokens,
        train,
        holdout: null,
        accepted: true,
        note: "measurement only — no restructure was attempted",
      },
    ],
    notes: [],
    ground_truth: output.ground_truth,
  };

  // Derived here rather than accepted from the caller, which is the same fence the rest of
  // this file keeps: a caveat available to whoever remembered to pass it is a caveat that
  // goes missing. Neither sentence is the one `reportWarnings` renders, and that is
  // deliberate -- the banner explains what the run is, while a `caps` entry explains why the
  // tooling will refuse a comparison, and only one of those is useful next to a hash.
  const derivedCaps: string[] = [];
  if (output.subset !== undefined) derivedCaps.push(subsetCap(output.subset));
  if (output.tier_study !== undefined) {
    derivedCaps.push(
      `TIER STUDY: this run swept on ${output.tier_study} rather than the ${MEASUREMENT_MODEL} ` +
        `detection instrument, so it is not a signposting measurement of record — a stronger ` +
        `tier reaches the right file in spite of a bad pointer. \`run.model\` carries the ` +
        `substitution and is a comparability key, so the tooling will refuse a delta against ` +
        `a run of record rather than reporting a change of instrument as a change of layout.`,
    );
  }

  return buildDisclosureEnvelope({
    output: asOptimized,
    operation: "measure-disclosure",
    tally: input.tally,
    // No early stop, no gating and no candidate budget: a measurement asks for exactly this
    // many runs, so anything unspent is a run that failed to report rather than one saved.
    plannedRuns: output.scenario_count * output.runs_per_scenario,
    // Never null, which is this operation's strongest comparability property and comes free
    // from the model being hardcoded rather than defaulted. Two measurement runs cannot
    // silently differ by whatever each operator had configured, and a tier study — the only
    // thing that moves this value — therefore FAILS `compareRuns` against a run of record
    // instead of quietly producing a delta across two different instruments.
    model: output.tier_study ?? MEASUREMENT_MODEL,
    graderModel: input.graderModel,
    workers: input.workers,
    timeoutSeconds: input.timeoutSeconds,
    inlineThreshold: input.inlineThreshold,
    scenarioSetHash: input.scenarioSetHash,
    targetSha: input.targetSha,
    // Both already decided, before the sweep, by `warnOnInstallConflict`. Reusing them
    // rather than sweeping the machine a second time is what stops the envelope disagreeing
    // with the warning the operator was shown and with the banner on the report.
    installState: output.install_state,
    installConflict: output.install_conflict,
    isolation: input.isolation,
    caps: [...derivedCaps, ...(input.caps ?? [])],
    ...(input.startedAt === undefined ? {} : { startedAt: input.startedAt }),
  });
}

const USAGE =
  "Usage: bun shared/operations/measure-disclosure.ts --skill-path <path> --scenarios <path> [options]\n\n" +
  "Measures what a skill costs to invoke as authored: body tokens paid on every run, which\n" +
  "bundled files actually get read and on what fraction of runs, total context tokens, and\n" +
  "the assertion pass rate. Nothing is restructured and the skill is never written to.\n\n" +
  "Budget: --scenarios x --runs-per-scenario runs, each doing the skill's real work, plus\n" +
  "one grading call per run on --grader-model.\n\n" +
  `Runs sweep on ${MEASUREMENT_MODEL} with --permission-mode ${MEASUREMENT_PERMISSION_MODE}, and\n` +
  "neither is configurable. The weaker tier is the detection instrument: a stronger one\n" +
  "reaches the right file in spite of a bad pointer and hides the signposting defect. To\n" +
  "sweep another tier deliberately, use --tier-study, which marks the run as a study rather\n" +
  "than a measurement of record.\n\n" +
  "--only <id>[,<id>...] runs a named slice of the scenario set instead of all of it, so a\n" +
  "small change can be checked against the scenarios it was about without paying for the\n" +
  "rest. A subset run is STAMPED not-of-record in results.json and said out loud: its pull\n" +
  "rates are over a hand-picked set and must never be quoted against a full sweep.\n\n" +
  `--results-dir also writes ${ENVELOPE_FILENAME} beside results.json: the conditions the run\n` +
  "was produced under, the counted-versus-all totals with the cause of every excluded run,\n" +
  "and a scenario-set hash taken over the rows that RAN. The hash and the model are\n" +
  "comparability keys, so a subset run and a tier study are mechanically refused a delta\n" +
  "against a measurement of record rather than being compared by whoever is squinting at two\n" +
  "files. results.json is unchanged; --envelope names a different path for it.\n\n" +
  "To restructure the layout as well, use optimize-disclosure.ts.";

/** The flag spec, exported so the defaults are reachable from the suite. */
export const MEASURE_FLAGS: Spec = {
  "skill-path": { kind: "string", help: "Path to the skill directory to measure" },
  fixture: {
    kind: "string",
    help:
      "A repository to copy into every throwaway root before its child starts (its .git included, node_modules skipped), for a skill whose scenarios work on a repo",
  },
  scenarios: {
    kind: "string",
    help: "Path to scenarios JSON: evals.json, or an array of {id, prompt, expectations}",
  },
  "tier-study": {
    kind: "string",
    help:
      `Sweep on this model INSTEAD of ${MEASUREMENT_MODEL}, for an over-fetch study or a ` +
      "tier comparison. Marks the run as a tier study, not a measurement of record",
  },
  only: {
    kind: "string",
    help:
      "Run only these scenario ids (comma-separated), for iterating on a slice. Marks the " +
      "run as a SUBSET, not a measurement of record",
  },
  "grader-model": {
    kind: "string",
    default: DEFAULT_GRADER_MODEL,
    help: `Model that grades assertions — measured against ${MEASUREMENT_MODEL}, not assumed cheaper`,
  },
  "grader-bare": {
    kind: "boolean",
    default: false,
    help: "Run grader calls with --bare (needs ANTHROPIC_API_KEY or a 3P provider)",
  },
  "runs-per-scenario": {
    kind: "number",
    default: DEFAULT_RUNS_PER_SCENARIO,
    help: "Runs per scenario",
  },
  "num-workers": { kind: "number", default: DEFAULT_NUM_WORKERS, help: "Concurrent scenario runs" },
  timeout: {
    kind: "number",
    default: DEFAULT_TIMEOUT_SECONDS,
    help: "Per-run wall clock in seconds",
  },
  "inline-threshold": {
    kind: "number",
    default: DEFAULT_INLINE_THRESHOLD,
    help: "Pull rate at or above which a reference is reported as worth inlining",
  },
  "results-dir": {
    kind: "string",
    help: "Save results.json, report.html and per-run logs here",
  },
  report: { kind: "string", default: "none", help: "Write the HTML report here ('none' to skip)" },
  // Additive, and DEFAULTED ON whenever a run is already saving its output. `results.json`
  // is unchanged to the byte -- the envelope is a second file beside it -- so nothing is
  // traded by writing it, and this file's own doctrine settles which way the default falls:
  // the removed flags were removed because correct behaviour available to whoever remembered
  // to ask for it is behaviour that goes missing, and a run whose conditions were never
  // recorded is exactly the run nobody can interpret six weeks later. An operator saving
  // results wants the conditions those results were produced under; making them type a
  // second flag to get them is the habit-flag pattern, not a guard against one.
  //
  // Same spelling and same default as `optimize-disclosure.ts`, which is the sibling that
  // also has a `--results-dir`. `measure-triggering.ts` is `--envelope`-only because it has
  // no results directory to hang one off, not because it decided differently.
  envelope: {
    kind: "string",
    help: `Also write the results envelope here (default: <results-dir>/${ENVELOPE_FILENAME})`,
  },
  verbose: { kind: "boolean", default: false, help: "Print per-file verdicts to stderr" },
  help: { kind: "boolean", short: "h", help: "Show this message" },
};

/**
 * Said once at the top of every run, whether or not anyone asked.
 *
 * The removed flag's fence was a quiet default: correct behaviour available to whoever
 * remembered to ask for it. Honouring that fence means being LOUD instead of optional --
 * the run states what it does to the sandbox and why, so the operator learns the rule from
 * the tool rather than from its help text.
 */
export const ACCEPT_EDITS_NOTICE =
  `Scenario runs spawn with --permission-mode ${MEASUREMENT_PERMISSION_MODE}. Scenarios do the ` +
  "skill's real work and the real work writes files, so a run that cannot write stops short " +
  "of what is being measured. Not configurable.";

/**
 * The flags that used to live here, and what to reach for instead.
 *
 * Checked BEFORE `parseCli`, because the parser's answer to a retired flag is `unknown
 * flag: --model` -- true, unhelpful, and identical to the answer for a typo. A habit that
 * outlives its flag should meet an education, not a mystery.
 *
 * Exported and pure so the suite can drive it, which matters more here than usual: the
 * whole reason these flags are gone is that they were passed repeatedly against a standing
 * ruling, so the message that intercepts them is the load-bearing part of the change.
 */
export function removedFlagError(argv: readonly string[]): string | null {
  for (const [index, token] of argv.entries()) {
    if (!token.startsWith("--")) continue;
    const equals = token.indexOf("=");
    // Split on `=` so `--model=opus` is recognized, and compare the NAME exactly so
    // `--grader-model`, which is still a flag, is not swept up by a substring match.
    const name = equals === -1 ? token.slice(2) : token.slice(2, equals);
    const inline = equals === -1 ? undefined : token.slice(equals + 1);
    if (name === "model") {
      const next = inline ?? argv[index + 1];
      const suggestion = next === undefined || next.startsWith("-") ? "<model>" : next;
      return (
        `--model is removed; the measurement model is ${MEASUREMENT_MODEL} — for over-fetch ` +
        `or tier comparison use --tier-study ${suggestion}`
      );
    }
    if (name === "permission-mode") {
      return `--permission-mode is removed; runs always use ${MEASUREMENT_PERMISSION_MODE}`;
    }
  }
  return null;
}

/* istanbul ignore next -- @preserve */
/**
 * Where the dashboard should look for this run's report.
 *
 * `serveReport` serves the real report when `detail.reportPath` is set and falls back to
 * the progress page when it is not. A measurement run only ever published `resultsDir`,
 * so although it writes `report.html` it never said where, and every link from the
 * dashboard dead-ended on a status table. The two optimizer loops set it and did not
 * have the problem.
 *
 * Resolved BEFORE the file exists, which is safe: the dashboard checks the file and falls
 * through while it is missing. One run therefore links to its progress while measuring
 * and to its report once written, with no second status write to keep in step.
 *
 * An explicit `--report` wins over the copy in `--results-dir`, because it is the path
 * the caller asked for by name. Both receive identical HTML.
 */
export function liveReportPath(
  reportFlag: string,
  resultsDir: string | undefined,
): string | undefined {
  if (reportFlag !== "none") return reportFlag;
  return resultsDir === undefined ? undefined : `${resultsDir}/report.html`;
}

async function main(): Promise<void> {
  // Before the parser, so a retired flag gets its replacement rather than `unknown flag`.
  const removed = removedFlagError(Bun.argv.slice(2));
  if (removed !== null) {
    console.error(`Error: ${removed}`);
    process.exit(2);
  }
  const { flags } = parseCli(MEASURE_FLAGS, USAGE);

  // First thing every run says, before any input validation can send it home. The removed
  // flag's fence was a quiet default; honouring it means the rule is stated whether or not
  // the run goes on to succeed.
  console.error(`Note: ${ACCEPT_EDITS_NOTICE}`);

  const skillPath = requireFlag(flags, "skill-path");
  const scenariosPath = requireFlag(flags, "scenarios");

  if (!(await Bun.file(`${skillPath}/SKILL.md`).exists())) {
    console.error(`Error: No SKILL.md found at ${skillPath}`);
    process.exit(1);
  }

  let scenarios: readonly DisclosureScenario[];
  try {
    scenarios = parseScenarioSet(await Bun.file(scenariosPath).json(), scenariosPath);
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  // Narrowed before anything is sized against it: the progress total, the report's train
  // size and the sweep itself all have to agree about which scenarios exist. An unknown id
  // exits(2) with the listing rather than sweeping nothing.
  let subset: ScenarioSubsetStamp | null;
  try {
    ({ scenarios, subset } = applyScenarioOnly({ scenarios, only: flagString(flags, "only") }));
  } catch (error) {
    console.error(`Error: ${error instanceof SubsetError ? error.message : String(error)}`);
    process.exit(2);
  }

  setGraderBare(flagBoolean(flags, "grader-bare"));

  const resultsDir = flagString(flags, "results-dir");
  const reportPath = flagString(flags, "report") ?? "none";
  const runsPerScenario = flagNumber(flags, "runs-per-scenario");
  const verbose = flagBoolean(flags, "verbose");
  const tierStudy = flagString(flags, "tier-study");

  // Said BEFORE `ProgressReporter.start`, which repaints stderr for the length of the
  // sweep. A line printed after it is a line nobody reads.
  if (tierStudy !== undefined) {
    console.error(
      `TIER STUDY: sweeping on ${tierStudy} instead of ${MEASUREMENT_MODEL}. This run is NOT a ` +
        `signposting measurement of record — a stronger tier reaches the right file in spite ` +
        `of a bad pointer, so its pull rates describe the model rather than the layout. Use it ` +
        `for over-fetch study or tier comparison only.`,
    );
  }

  // Beside the tier-study line and for the same reason: after `ProgressReporter.start` is
  // after the repaint, which is nowhere. The long form goes here, where nothing has been
  // measured yet and no figures compete with it; one line goes beside the results later.
  if (subset !== null) {
    console.error(
      `\n${subsetSummaryLine(subset)}\nScenarios: ${subset.ids.join(", ")}.\n${subset.note}\n`,
    );
  }

  // The default is derived from the machine; an explicit value still overrides it,
  // deliberately, because an account being rate limited is a reason to turn this DOWN
  // that no machine measurement can see. Overshooting is the direction that hurts and it
  // hurts hard: measured on a 10-core box, 48 workers ran about five times SLOWER per run
  // than 24, at 0.6% CPU idle and load average 143. So the escape hatch stays and the
  // cliff gets a sign.
  const requestedWorkers = flagNumber(flags, "num-workers");
  if (requestedWorkers !== undefined && requestedWorkers > availableParallelism() * 3) {
    console.error(
      `Warning: --num-workers ${requestedWorkers} is more than three times this machine's ` +
        `${availableParallelism()} cores. Measured on a 10-core box, 48 workers ran about ` +
        `five times SLOWER per run than 24 — past its peak the machine thrashes rather ` +
        `than saturating. The default here is ${DEFAULT_NUM_WORKERS}, twice the core count.`,
    );
  }

  const dashboardReport = liveReportPath(reportPath, resultsDir);

  const reporter = ProgressReporter.start({
    kind: "disclosure-loop",
    label:
      (tierStudy === undefined
        ? `${baseName(skillPath)} — disclosure measurement`
        : `${baseName(skillPath)} — tier study on ${tierStudy}`) +
      (subset === null ? "" : ` — SUBSET ${subset.selected}/${subset.of}`),
    total: scenarios.length * runsPerScenario,
    subject: baseName(skillPath),
    detail: {
      phase: "measurement",
      ...(resultsDir === undefined ? {} : { resultsDir }),
      ...(dashboardReport === undefined ? {} : { reportPath: dashboardReport }),
      // Fields the dashboard can branch on rather than prose in the label. The bar's
      // `total` above is already the subset's, so the live page counts against what runs.
      ...(subset === null ? {} : { subset: subsetProgressDetail(subset) }),
      // The older of the two not-of-record classes, and the one that has been invisible in
      // the listing since it was built: it reached `results.json` and the report and stopped
      // there, so a tier study has always looked like a measurement of record on the
      // dashboard. Same field mechanism, same chip, one line.
      ...(tierStudy === undefined ? {} : { tierStudy }),
    },
  });

  const tally = createRunTally();
  // Beside the tally it parallels, and read below when the envelope is built. The tally says
  // how many runs each rate is really over; this says whether those runs measured the skill
  // under test or the operator's machine -- the same question `installState` asks of the
  // machine, asked of each child instead, and asked per run rather than once.
  const isolation = createIsolationLedger();

  let output: MeasureOutput;
  try {
    output = await measureDisclosure({
      skillPath,
      scenarios,
      runsPerScenario,
      onRunOutcome: tally.record,
      onIsolation: isolation.record,
      numWorkers: flagNumber(flags, "num-workers"),
      timeoutSeconds: flagNumber(flags, "timeout"),
      inlineThreshold: flagNumber(flags, "inline-threshold"),
      tierStudy,
      fixtureDir: flagString(flags, "fixture"),
      ...(subset === null ? {} : { subset }),
      graderModel: flagString(flags, "grader-model") ?? DEFAULT_GRADER_MODEL,
      logDir: resultsDir === undefined ? undefined : `${resultsDir}/logs`,
      onProgress: (settled) => reporter.report(settled),
      // Reported so the dashboard can distinguish a busy pool from a hung one. Nothing
      // settles until the first run finishes, which on a real sweep is about 90 seconds
      // of a bar reading 0/N while every worker is in fact working.
      onStarted: (inFlight) => reporter.update({ inFlight }),
    });
  } catch (error) {
    await reporter.finish("failed", error instanceof Error ? error.message : String(error));
    throw error;
  }
  await reporter.finish("done");

  if (verbose) {
    for (const file of output.files) console.error(formatFileStatLine(file));
    const truth = formatGroundTruthLine(output.ground_truth);
    if (truth !== null) console.error(truth);
  }

  // Unconditional, because `--verbose` is off by default and the caveat is not optional.
  // A pull rate is the figure a hand-picked scenario mix distorts most -- the scenario set
  // IS the denominator -- so this belongs against every reading of the table above.
  if (subset !== null) console.error(`\n${subsetSummaryLine(subset)}\n`);

  const json = JSON.stringify(output, null, 2);
  console.log(json);
  if (resultsDir !== undefined) await Bun.write(`${resultsDir}/results.json`, `${json}\n`);

  // The report renderer speaks the optimizer's vocabulary, so a measurement is shown as the
  // one iteration it is: baseline in, baseline out, no candidates. Better a familiar table
  // with an honest single row than a second renderer to keep in step with this one.
  if (reportPath !== "none" || resultsDir !== undefined) {
    const html = generateDisclosureReport(
      {
        skillName: output.skill_name,
        skillPath: output.skill_path,
        tokenMethod: output.token_method,
        estimatedTokens: output.tokens_are_estimated,
        baselineBodyTokens: output.body_tokens,
        bestBodyTokens: output.body_tokens,
        baselineContextTokens: output.context_tokens,
        bestContextTokens: output.context_tokens,
        holdoutFraction: 0,
        trainSize: output.scenario_count,
        holdoutSize: 0,
        runsPerScenario: output.runs_per_scenario,
        files: output.files,
        groundTruth: output.ground_truth,
        iterations: [
          {
            iteration: 1,
            label:
              (output.tier_study === undefined
                ? "measured (as authored)"
                : `tier study on ${output.tier_study} (as authored)`) +
              (output.subset === undefined
                ? ""
                : ` — subset, ${output.subset.selected}/${output.subset.of} scenarios`),
            candidateId: null,
            rationale: `${output.files.length} bundled file(s), ${output.body_tokens} body tokens`,
            bodyTokens: output.body_tokens,
            train: {
              scenarios: output.scenario_count,
              runs: output.scenario_count * output.runs_per_scenario,
              runsWithoutSkill: output.runs_without_skill,
              runsLoadedViaFile: output.runs_loaded_via_file,
              // Recomputed rather than carried: `output` is the JSON shape and has no
              // load-rate field, and inventing one there would be a second place for the
              // same fact to drift. Error-free runs are the planned count less the runs
              // the harness could not complete, which `runs_without_skill` is already net
              // of, so the ratio is over what the sweep actually produced.
              loadRate:
                output.scenario_count * output.runs_per_scenario === 0
                  ? 1
                  : (output.scenario_count * output.runs_per_scenario -
                      output.runs_without_skill) /
                    (output.scenario_count * output.runs_per_scenario),
              passRate: output.pass_rate,
              assertionsPassed: output.assertions_passed,
              assertionsTotal: output.assertions_total,
              meanContextTokens: output.context_tokens,
            },
            holdout: null,
            accepted: true,
            note: "measurement only — no restructure was attempted",
          },
        ],
        exitReason: "measurement_only",
        appliedTo: null,
        notes: [],
        // The three caveats this caller alone knows; the renderer derives the rest from the
        // split score it is handed. See `reportWarnings` for why they carry two severities.
        warnings: reportWarnings(output),
      },
      { autoRefresh: false },
    );
    if (reportPath !== "none") await Bun.write(reportPath, html);
    if (resultsDir !== undefined) await Bun.write(`${resultsDir}/report.html`, html);
  }

  const envelopePath =
    flagString(flags, "envelope") ??
    (resultsDir === undefined ? undefined : `${resultsDir}/${ENVELOPE_FILENAME}`);
  if (envelopePath !== undefined) {
    await writeEnvelope(
      envelopePath,
      buildMeasurementEnvelope({
        output,
        tally: tally.snapshot(),
        workers: flagNumber(flags, "num-workers"),
        timeoutSeconds: flagNumber(flags, "timeout"),
        inlineThreshold: flagNumber(flags, "inline-threshold"),
        graderModel: flagString(flags, "grader-model") ?? DEFAULT_GRADER_MODEL,
        // Over the scenarios that RAN, not over the file. `evalSetHash` is a comparability
        // key, so a subset hashes differently from the full set and from every other
        // subset, and `compareRuns` refuses a delta that would otherwise be a change of
        // denominator reported as a change of result. `scenarios` is already the narrowed
        // set by this point -- `applyScenarioOnly` ran before anything was sized against it
        // -- so this is the enforcement rather than a second place to remember the rule.
        scenarioSetHash: hashJsonValue(scenarios),
        targetSha: await hashArtifact(skillPath),
        isolation: isolation.state(),
        // Deduplicated and counted by the ledger, so a machine that contaminated every run
        // contributes one sentence rather than one per run.
        caps: isolation.caps(),
      }),
    );
    console.error(`Envelope written to: ${envelopePath}`);
  }

  if (output.tokens_are_estimated) {
    console.error(
      "\nNote: token counts are ESTIMATES (characters over four). Install `tiktoken` for " +
        "real counts before reading a body budget literally.",
    );
  }
}

function baseName(path: string): string {
  const parts = path.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] ?? path;
}

if (import.meta.main) await main();
