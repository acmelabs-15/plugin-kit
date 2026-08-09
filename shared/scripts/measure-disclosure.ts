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
 *   bun shared/scripts/measure-disclosure.ts --skill-path skills/<name> \
 *     --scenarios evals/disclosure/<name>.json --model opus
 */

import {
  DEFAULT_INLINE_THRESHOLD,
  loadTokenCounter,
  parseScenarioSet,
  scoreRuns,
  type DisclosureScenario,
  type FileStat,
  type TokenMethod,
} from "./lib/disclosure.ts";
import {
  DEFAULT_NUM_WORKERS,
  DEFAULT_RUNS_PER_SCENARIO,
  DEFAULT_TIMEOUT_SECONDS,
  DEFAULT_GRADER_MODEL,
  measureLayout,
  setGraderBare,
  summarizeLayout,
} from "./lib/disclosure-measure.ts";
import { generateDisclosureReport } from "./lib/disclosure-report.ts";
import type { Spec } from "./lib/cli.ts";
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
  readonly token_method: TokenMethod;
  readonly tokens_are_estimated: boolean;
  readonly scenario_count: number;
  readonly runs_per_scenario: number;
  /** Runs that finished without the skill ever reaching context. Excluded from every rate below. */
  readonly runs_without_skill: number;
  readonly body_tokens: number;
  readonly context_tokens: number;
  readonly pass_rate: number;
  readonly assertions_passed: number;
  readonly assertions_total: number;
  readonly files: readonly FileStat[];
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
  });

  if (layout.train.runsWithoutSkill > 0) {
    console.error(
      `Warning: the skill never loaded on ${layout.train.runsWithoutSkill} run(s). Those runs ` +
        `are excluded from every pull rate, so the verdicts rest on less evidence than the ` +
        `run count suggests.`,
    );
  }

  return {
    skill_name: skillName,
    skill_path: params.skillPath,
    token_method: counter.method,
    tokens_are_estimated: counter.estimated,
    scenario_count: params.scenarios.length,
    runs_per_scenario: params.runsPerScenario,
    runs_without_skill: layout.train.runsWithoutSkill,
    body_tokens: layout.bodyTokens,
    context_tokens: layout.train.meanContextTokens,
    pass_rate: layout.train.passRate,
    assertions_passed: layout.train.assertionsPassed,
    assertions_total: layout.train.assertionsTotal,
    files: layout.files,
  };
}

const USAGE =
  "Usage: bun shared/scripts/measure-disclosure.ts --skill-path <path> --scenarios <path> [options]\n\n" +
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
  const runsPerScenario = flagNumber(flags, "runs-per-scenario");
  const verbose = flagBoolean(flags, "verbose");

  const reporter = ProgressReporter.start({
    kind: "disclosure-loop",
    label: `${baseName(skillPath)} — disclosure measurement`,
    total: scenarios.length * runsPerScenario,
    subject: baseName(skillPath),
    detail: { phase: "measurement", ...(resultsDir === undefined ? {} : { resultsDir }) },
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
    });
  } catch (error) {
    await reporter.finish("failed", error instanceof Error ? error.message : String(error));
    throw error;
  }
  await reporter.finish("done");

  if (verbose) {
    for (const file of output.files) {
      console.error(
        `  ${file.verdict.padEnd(9)} ${String(file.pulls).padStart(2)}/${file.countedRuns} ` +
          `${file.path} (${file.tokens} tokens${file.signposted ? "" : ", not signposted"})`,
      );
    }
  }

  const json = JSON.stringify(output, null, 2);
  console.log(json);
  if (resultsDir !== undefined) await Bun.write(`${resultsDir}/results.json`, `${json}\n`);

  // The report renderer speaks the optimizer's vocabulary, so a measurement is shown as the
  // one iteration it is: baseline in, baseline out, no candidates. Better a familiar table
  // with an honest single row than a second renderer to keep in step with this one.
  const reportPath = flagString(flags, "report") ?? "none";
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
