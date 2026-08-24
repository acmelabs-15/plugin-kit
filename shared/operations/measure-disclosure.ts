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
 *     --scenarios evals/disclosure/<name>.json --model opus
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
} from "./disclosure-measure.ts";
import { availableParallelism } from "node:os";

import { generateDisclosureReport } from "../report/disclosure-report.ts";
import { detectInstallState, installConflict, type InstallState } from "../envelope.ts";
import type { Spec } from "../cli.ts";
import { readTargetDefinition } from "./measure-triggering.ts";
import { flagBoolean, flagNumber, flagString, parseCli, requireFlag } from "./measure-triggering.ts";
import { ProgressReporter } from "../util/progress.ts";

export interface MeasureDisclosureParams {
  readonly skillPath: string;
  readonly scenarios: readonly DisclosureScenario[];
  readonly runsPerScenario: number;
  readonly numWorkers: number;
  readonly timeoutSeconds: number;
  readonly inlineThreshold: number;
  readonly model?: string | undefined;
  /** Grades the assertions. Deliberately not `model`; see `DEFAULT_GRADER_MODEL`. */
  readonly graderModel?: string | undefined;
  readonly permissionMode?: string | undefined;
  readonly logDir?: string | undefined;
  readonly onProgress?: ((settled: number, total: number) => void) | undefined;
  readonly onStarted?:
    | ((inFlight: number, started: number, total: number) => void)
    | undefined;
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

  const runs = await measureLayout({
    skillDir: params.skillPath,
    skillName,
    scenarios: params.scenarios,
    runsPerScenario: params.runsPerScenario,
    numWorkers: params.numWorkers,
    timeoutSeconds: params.timeoutSeconds,
    model: params.model,
    graderModel: params.graderModel,
    permissionMode: params.permissionMode,
    grade: true,
    logDir: params.logDir,
    onProgress: params.onProgress,
    onStarted: params.onStarted,
  });

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
  };
}

const USAGE =
  "Usage: bun shared/operations/measure-disclosure.ts --skill-path <path> --scenarios <path> [options]\n\n" +
  "Measures what a skill costs to invoke as authored: body tokens paid on every run, which\n" +
  "bundled files actually get read and on what fraction of runs, total context tokens, and\n" +
  "the assertion pass rate. Nothing is restructured and the skill is never written to.\n\n" +
  "Budget: --scenarios x --runs-per-scenario runs, each doing the skill's real work, plus\n" +
  "one grading call per run on --grader-model.\n\n" +
  "To restructure the layout as well, use optimize-disclosure.ts.";

/** The flag spec, exported so the defaults are reachable from the suite. */
export const MEASURE_FLAGS: Spec = {
  "skill-path": { kind: "string", help: "Path to the skill directory to measure" },
  scenarios: {
    kind: "string",
    help: "Path to scenarios JSON: evals.json, or an array of {id, prompt, expectations}",
  },
  model: { kind: "string", help: "Model for the scenario runs (NOT the grader)" },
  "grader-model": {
    kind: "string",
    default: DEFAULT_GRADER_MODEL,
    help: "Model that grades assertions — measured against --model, not assumed cheaper",
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
  "permission-mode": {
    kind: "string",
    help: "Passed to claude -p; use acceptEdits for scenarios that write files",
  },
  "results-dir": {
    kind: "string",
    help: "Save results.json, report.html and per-run logs here",
  },
  report: { kind: "string", default: "none", help: "Write the HTML report here ('none' to skip)" },
  verbose: { kind: "boolean", default: false, help: "Print per-file verdicts to stderr" },
  help: { kind: "boolean", short: "h", help: "Show this message" },
};

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
  const { flags } = parseCli(MEASURE_FLAGS, USAGE);

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

  setGraderBare(flagBoolean(flags, "grader-bare"));

  const resultsDir = flagString(flags, "results-dir");
  const reportPath = flagString(flags, "report") ?? "none";
  const runsPerScenario = flagNumber(flags, "runs-per-scenario");
  const verbose = flagBoolean(flags, "verbose");

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
    label: `${baseName(skillPath)} — disclosure measurement`,
    total: scenarios.length * runsPerScenario,
    subject: baseName(skillPath),
    detail: {
      phase: "measurement",
      ...(resultsDir === undefined ? {} : { resultsDir }),
      ...(dashboardReport === undefined ? {} : { reportPath: dashboardReport }),
    },
  });

  let output: MeasureOutput;
  try {
    output = await measureDisclosure({
      skillPath,
      scenarios,
      runsPerScenario,
      numWorkers: flagNumber(flags, "num-workers"),
      timeoutSeconds: flagNumber(flags, "timeout"),
      inlineThreshold: flagNumber(flags, "inline-threshold"),
      model: flagString(flags, "model"),
      graderModel: flagString(flags, "grader-model") ?? DEFAULT_GRADER_MODEL,
      permissionMode: flagString(flags, "permission-mode"),
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
            label: "measured (as authored)",
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
        // The install conflict is the only warning this caller has to carry: the renderer
        // derives the rest from the split score it is handed. Passed as `invalidating`
        // because it is — a sweep answered by an installed copy floors every pull rate at
        // zero, so the file table below it is a table of nothing.
        warnings:
          output.install_conflict === null
            ? []
            : [{ severity: "invalidating" as const, text: output.install_conflict }],
      },
      { autoRefresh: false },
    );
    if (reportPath !== "none") await Bun.write(reportPath, html);
    if (resultsDir !== undefined) await Bun.write(`${resultsDir}/report.html`, html);
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
