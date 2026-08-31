/**
 * The disclosure MEASUREMENT engine: run a skill's scenarios against one layout on disk and
 * report what that layout cost.
 *
 * Extracted from `../optimize-disclosure.ts` because two independent callers were driving the
 * restructure loop with `--max-iterations 1 --holdout 0` to mean "just measure": the driver
 * behind `evals/MEASUREMENTS.md` and the reproduction command in that record. A workaround
 * two people find on their own is a missing entry point, not a preference.
 *
 * Everything here is layout-agnostic. It knows how to install a throwaway copy of a skill,
 * spawn `claude` against it, grade the transcript, and turn a set of runs into a scored
 * layout with a bundled-file table. It knows nothing about candidates, extractions or
 * iterations -- those live in `../optimize-disclosure.ts`, which imports this file, as does
 * `../measure-disclosure.ts`. One implementation, so the two entry points cannot disagree
 * about what a measurement is.
 *
 * Pure Bun throughout. `node:fs/promises` only for the tree operations that have no
 * Bun-native equivalent.
 */

import { cp, readdir, rm } from "node:fs/promises";
import { availableParallelism } from "node:os";

import {
  checkIsolation,
  createSurfaceReader,
  type IsolationVerdict,
} from "../isolation.ts";
import { mapWithConcurrency } from "../util/pool.ts";
import {
  CHILD_ISOLATION_FLAGS,
  runIsolatedHelper,
  runStreamingLines,
  SKILL_EXECUTION_GRANT,
  type CommandOutcome,
} from "../util/subprocess.ts";
import {
  computeFileStats,
  createRunCollector,
  inventoryBundledFiles,
  parseGrading,
  scoreRuns,
  splitSkillMd,
  summarizeGroundTruth,
  trainGate,
  type DisclosureScenario,
  type FileStat,
  type GroundTruth,
  type ScenarioRun,
  type SplitScore,
  type TokenCounter,
} from "./disclosure.ts";
import { installSkillForTrigger, readTargetDefinition } from "./measure-triggering.ts";

/**
 * Runs per scenario.
 *
 * Two, not one, because a pull rate computed from a single run is a boolean wearing a
 * percentage sign -- and the whole decision rule is a threshold on that number. Two is
 * the smallest count that can distinguish "always" from "sometimes"; raise it when the
 * verdicts look unstable between iterations, which is the symptom of too little evidence.
 */
export const DEFAULT_RUNS_PER_SCENARIO = 2;

/**
 * Concurrent scenario runs, and the reason it is no longer four.
 *
 * Four was chosen against the CPU: a scenario run does the skill's actual job and spawns
 * children of its own, so it looked like the kind of work you size to cores. It is not.
 * A worker here holds a `claude -p` child that spends nearly all of its wall clock
 * BLOCKED ON THE API -- measured elsewhere in this harness at an 11-14s floor before the
 * first tool call even arrives -- so the machine is idle for almost the whole of every
 * slot. The limiting resources are the account's API concurrency and the memory each
 * child holds, neither of which is the core count.
 *
 * Twelve, then: above the trigger sweep's 10 because these calls are longer and the
 * per-call fixed cost is amortized worse at low concurrency, and short of anything that
 * would push a typical account into rate limiting -- which is the one failure that
 * corrupts rather than merely slows a measurement, since a rate-limited run is recorded
 * as a failed run. Lower it if you see failures cluster; the number is a default, not a
 * property of the workload.
 *
 * MEASURED 2026-08-24, and the reasoning above holds only up to a point. It is true that
 * a worker spends most of its slot blocked, but there IS a machine ceiling and it is not
 * far away. On a 10-core box, the same 54-run sweep:
 *
 *   12 workers   15.8s per run   43-49% CPU idle -- capacity going unused
 *   24 workers    8.1s per run   the best measured, about a 1.9x throughput gain
 *   48 workers   43.6s per run   0.6% CPU idle, load average 143 -- thrashing
 *
 * So the curve has a peak rather than a plateau, and overshooting it costs far more than
 * undershooting: 48 was roughly five times SLOWER than 24, not merely no better. A fixed
 * 12 left half the machine idle; a fixed 24 would be a number that happens to suit one
 * laptop.
 *
 * Hence twice the core count: floored so a small machine still overlaps its waiting, and
 * capped at the highest value actually measured good. Extrapolating past 24 is precisely
 * what produced the 48-worker result, so the cap stays at the evidence.
 */
export const DEFAULT_NUM_WORKERS = Math.max(4, Math.min(24, availableParallelism() * 2));

/**
 * Per-run wall clock, in seconds.
 *
 * Well above `measure-triggering.ts`'s 180, because that budget covers a routing decision and this
 * one covers a whole task. A timed-out run is excluded from the rates rather than scored
 * as a non-pull, so the cost of setting this too low is a thinner measurement rather than
 * a wrong one -- but a set where most runs time out measures nothing at all.
 *
 * Ten minutes rather than fifteen. The budget is not free even though the run that uses
 * it is doomed: a hung run holds a worker slot for the whole of it, and at fifteen
 * minutes one wedged child could outlast every other run in the sweep put together. Ten
 * still clears any scenario this harness is meant for by a wide margin -- a task that has
 * been going for ten minutes has almost always stopped making progress rather than nearly
 * finished -- and it caps what one stuck child can cost the sweep at a third less. The
 * timeout says the flag to raise, because the honest response to a genuinely long
 * scenario is a bigger number rather than a thinner measurement.
 */
export const DEFAULT_TIMEOUT_SECONDS = 600;

/**
 * The model that grades a run's assertions, DELIBERATELY NOT the model that runs them.
 *
 * The run model is whatever the skill should be measured under, and it is often the most
 * capable one available -- `--model opus` is the documented invocation. Grading inherited
 * that, which meant every scenario paid twice for the heavy model: once to do the work,
 * and once again, serially in the same worker slot, to have a transcript checked.
 *
 * The second call is not the same kind of problem as the first. It is single-turn, with
 * the transcript and the produced files already in the prompt, against an explicit list
 * of expectations, and it answers in fixed-shape JSON. There is nothing to plan, nothing
 * to look up and no tool to call -- which is the shape a small fast model is good at, and
 * the shape where a large one is mostly paying for capability it never uses.
 *
 * The guardrail this feeds survives the swap because it is a COMPARISON, not an absolute:
 * a candidate's pass rate is judged against the baseline's, and both are graded by this
 * same model. A grader that is systematically stricter or slacker than another moves both
 * numbers together and leaves the difference between them -- which is the entire signal --
 * where it was. What would break the comparison is changing graders mid-run, which is why
 * this is one flag for the whole loop rather than a per-phase choice.
 *
 * Override with `--grader-model` if the grading looks wrong; `--model` will not do it.
 *
 * `sonnet` rather than the cheaper `haiku`, and that choice was measured rather than
 * assumed. Graded against a run whose own final response admitted it had left one pointer
 * without a load condition -- so the expectation was plainly unmet -- `haiku` returned
 * `passed: true` on both attempts while `sonnet` and `opus` returned `passed: false` on
 * both. A grader that fails open is worse than a slow one: this is the guardrail that
 * decides whether a restructure broke the skill, and a false pass accepts the breakage.
 *
 * The saving that motivated a cheap grader turned out not to exist. Measured over two
 * attempts each, `opus` averaged 13.1s, `sonnet` 11.0s and `haiku` 11.8s -- haiku was not
 * even the fastest, because the cost here is output generation rather than prompt size.
 * So `sonnet` is both the more reliable and the marginally faster option, and the reason
 * to move off `--model` is opus's 13.1s rather than any haiku advantage.
 *
 * `sonnet` is an alias the `claude` CLI resolves today -- verified by running it, not
 * assumed from the help text, which names aliases by example rather than exhaustively.
 * An unrecognized alias is the quiet failure to avoid: it warns on stderr and carries on,
 * so a typo would grade every run under a fallback nobody chose.
 *
 * n=2 per variant, so treat the latency figures as indicative. The correctness result is
 * what the default rests on, and it wants re-checking on a larger sample before anyone
 * concludes something general about haiku from it.
 */
export const DEFAULT_GRADER_MODEL = "sonnet";
/** Budget for one grading or proposal call, in seconds. Mirrors propose-description.ts. */
const HELPER_CALL_TIMEOUT_SECONDS = 300;

/**
 * The opening words of the `error` a timed-out run carries.
 *
 * A constant rather than a literal in one place, because two things now read it: the
 * message an operator sees, and {@link classifyRun}, which has to separate a run that hit
 * the wall clock from one that failed some other way so the envelope can report the two
 * counts apart. A `ScenarioRun` records only an error STRING -- widening it to a tagged
 * outcome would change the shape `results.json` and `lib/disclosure.ts` both already
 * agree on -- so the string is the seam, and a seam with two readers is a constant.
 */
export const TIMEOUT_ERROR_PREFIX = "timed out after";
// ---------------------------------------------------------------------------
// One scenario run
// ---------------------------------------------------------------------------

interface ScenarioRunParams {
  readonly scenario: DisclosureScenario;
  readonly attempt: number;
  readonly skillDir: string;
  readonly skillName: string;
  /**
   * The layout's own description, read once per layout rather than per attempt.
   *
   * It is the same string for every run of a layout -- nothing here rewrites it, and the
   * installer only substitutes it back so the copy stays internally consistent under its
   * unique alias -- so re-reading and re-parsing SKILL.md for each attempt was a disk
   * round trip per run that could only ever return the same answer.
   */
  readonly description: string;
  readonly timeoutSeconds: number;
  readonly model?: string | undefined;
  /** Never `params.model`. See `DEFAULT_GRADER_MODEL`. */
  readonly graderModel?: string | undefined;
  readonly permissionMode?: string | undefined;
  readonly grade: boolean;
  readonly logDir?: string | undefined;
  /** See {@link MeasureParams.fixtureDir}. */
  readonly fixtureDir?: string | undefined;
  /**
   * Handed this attempt's isolation proof, read from the child's own `init` event.
   *
   * Per ATTEMPT rather than once per sweep, because that is the granularity at which it can
   * be wrong: every attempt here installs its OWN throwaway root and spawns its own child,
   * so a probe of the first says nothing about the four hundredth.
   *
   * Optional so the two entry points and the tests can drive a sweep without one. The
   * envelope is the only place a folded state belongs, and neither this function nor
   * {@link measureLayout} owns an envelope.
   */
  readonly onIsolation?: ((verdict: IsolationVerdict) => void) | undefined;
}

/**
 * Run one scenario against one layout and record what it read, cost and achieved.
 *
 * The skill is installed into a THROWAWAY ROOT PER ATTEMPT, which is where this diverges
 * from `measure-triggering.ts` -- that harness shares one root across every query, on the sound
 * grounds that a routing question changes nothing on disk. A scenario run does change
 * things on disk: it writes the artifact the assertions are about. Sharing a working
 * directory would let one run's output be graded as another's, and two runs of the same
 * scenario would race on the same filename. A directory copy per attempt is negligible
 * beside a call that does real work.
 *
 * The prompt names the skill outright rather than relying on the description to route to
 * it. Whether the description triggers is what `optimize-description.ts` measures; holding invocation
 * constant here is what makes the numbers below about the LAYOUT rather than about
 * routing, and a run that fails to invoke measures nothing at all.
 */
async function runScenario(params: ScenarioRunParams): Promise<ScenarioRun> {
  const startedAt = Date.now();
  const { root, alias } = await installSkillForTrigger(
    params.skillDir,
    params.skillName,
    params.description,
  );
  const installedSkillDir = `${root}/.claude/skills/${alias}`;

  try {
    if (params.fixtureDir !== undefined && params.fixtureDir !== "") {
      await seedFixture(root, params.fixtureDir);
    }
    const collector = createRunCollector({ skillDir: installedSkillDir, projectRoot: root });
    const prompt =
      `Use the ${alias} skill to carry out the task below, then say what you did ` +
      `and where you put any files you produced.\n\n${params.scenario.prompt}`;

    const cmd = [
      "claude",
      "-p",
      prompt,
      "--output-format",
      "stream-json",
      "--verbose",
      // Same isolation as the trigger harness, from the same constant so the two cannot
      // drift apart. Load-bearing here for three reasons: the operator's own plugins would
      // otherwise compete for the work, every configured MCP server would be a connection
      // attempt on every run, and a scenario child doing real work is precisely the one
      // that must not be able to message another session about it. See the constant for
      // what each flag was measured to do, and for the one thing none of them closes.
      ...CHILD_ISOLATION_FLAGS,
      // Without this the skill never loads and every pull rate is a measurement of a
      // model rummaging for the file rather than being handed it. See the constant.
      ...SKILL_EXECUTION_GRANT,
    ];
    if (params.model !== undefined && params.model !== "") cmd.push("--model", params.model);
    // Left off unless asked for. A scenario that only reads and reports needs nothing; one
    // that writes an artifact needs `acceptEdits`, and that is the operator's call to make
    // rather than a default this script quietly applies to their machine.
    if (params.permissionMode !== undefined && params.permissionMode !== "") {
      cmd.push("--permission-mode", params.permissionMode);
    }

    // `--include-partial-messages` is deliberately absent. The trigger harness needs it to
    // decide before a tool executes; this one reads to the end of the stream regardless,
    // and the complete `assistant` event carries a whole `input` object rather than a
    // string of JSON fragments to reassemble.
    //
    // The reader is WRAPPED rather than replaced: the collector owns everything this run
    // reports and stays in the read path untouched. The wrapper only keeps the `init` line
    // on its way past, and that line is one the stream was already delivering.
    const reader = createSurfaceReader(collector.onLine);
    const outcome = await runStreamingLines(
      cmd,
      { cwd: root, timeoutMs: params.timeoutSeconds * 1000 },
      reader.onLine,
    );
    // Reported before the outcome is classified, so a timed-out or errored attempt still
    // contributes what its child managed to say about itself. An attempt that died early is
    // exactly the one whose isolation nobody would otherwise have checked.
    //
    // `alias` rather than `params.skillName`: the child is told to use the skill by that
    // name, so a child that cannot see it under that name reached for nothing, and every
    // pull rate the attempt would have produced is floored rather than measured.
    params.onIsolation?.(
      checkIsolation({
        surface: reader.surface(),
        expected: { name: alias, kind: "skill", expect: "present", root },
      }),
    );

    const observation = collector.observation();
    if (outcome.kind === "timeout") {
      // Names the flag, because the only two things to do about a timeout are raise the
      // budget or accept a thinner measurement, and the message should say which lever
      // exists. A run that hit the ceiling also held a worker slot for the whole of it.
      return failedRun(
        params,
        `${TIMEOUT_ERROR_PREFIX} ${params.timeoutSeconds}s and held a worker slot for all of it; ` +
          `raise --timeout if this scenario genuinely needs longer`,
      );
    }
    if (outcome.kind === "error") return failedRun(params, outcome.message);

    const grading =
      params.grade && params.scenario.expectations.length > 0
        ? await gradeRun({
            scenario: params.scenario,
            observation,
            projectRoot: root,
            // The GRADER model, not the run model. Both calls are serial in this one
            // worker slot, so grading on the run model made every scenario wait on the
            // heavy model twice.
            model: params.graderModel,
          })
        : { passed: 0, total: 0, verdicts: [] };

    if (params.logDir !== undefined && params.logDir !== "") {
      await Bun.write(
        `${params.logDir}/run_${slugForFile(params.scenario.id)}_${params.attempt}.json`,
        `${JSON.stringify({ scenario: params.scenario.id, attempt: params.attempt, observation, grading }, null, 2)}\n`,
      );
    }

    return {
      scenarioId: params.scenario.id,
      attempt: params.attempt,
      durationMs: Date.now() - startedAt,
      filesRead: observation.filesRead,
      skillLoaded: observation.skillLoaded,
      loadedVia: observation.loadedVia,
      contextTokens: observation.contextTokens,
      assertionsPassed: grading.passed,
      assertionsTotal: grading.total,
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/**
 * A run the harness could not complete.
 *
 * Recorded with an `error` rather than as a zero-everything run, because the two mean
 * opposite things to the rates: a run that read nothing is evidence that a reference is
 * unnecessary, while a run that never happened is evidence of nothing. `computeFileStats`
 * and `scoreRuns` both drop these.
 */
function failedRun(params: ScenarioRunParams, error: string, durationMs = 0): ScenarioRun {
  console.error(`Warning: ${params.scenario.id} attempt ${params.attempt}: ${error}`);
  return {
    scenarioId: params.scenario.id,
    attempt: params.attempt,
    durationMs,
    filesRead: [],
    skillLoaded: false,
    loadedVia: null,
    contextTokens: 0,
    assertionsPassed: 0,
    assertionsTotal: 0,
    error,
  };
}

function slugForFile(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 60) || "scenario";
}

// ---------------------------------------------------------------------------
// Grading -- the guardrail
// ---------------------------------------------------------------------------

/** Bytes of a produced file handed to the grader, and how many files. */
const GRADER_FILE_BYTES = 4_000;
const GRADER_FILE_COUNT = 3;

/**
 * Grade one run's assertions.
 *
 * The grader sees the task, the tool calls in order, the final response, and the head of
 * up to three files the run produced. Reading the artifacts matters: a transcript-only
 * grader passes a run that says "I wrote the CSV" and wrote nothing, which is exactly the
 * failure a restructure that broke the skill would produce.
 *
 * Field names are `text`, `passed` and `evidence`, matching `../references/grader.md`. The
 * repository already has one grading contract and a second spelling of the same three
 * fields would be a thing to keep in step forever.
 *
 * `model` is the GRADER model -- `--grader-model`, not `--model`. Everything the judgement
 * needs is already in the prompt below, which is what makes a small fast model the right
 * tool; `DEFAULT_GRADER_MODEL` sets out why the guardrail survives the swap.
 */
async function gradeRun(params: {
  readonly scenario: DisclosureScenario;
  readonly observation: { readonly toolCalls: readonly string[]; readonly filesWritten: readonly string[]; readonly finalText: string };
  readonly projectRoot: string;
  readonly model?: string | undefined;
}): Promise<{ passed: number; total: number; verdicts: readonly unknown[] }> {
  const artifacts: string[] = [];
  for (const path of params.observation.filesWritten.slice(0, GRADER_FILE_COUNT)) {
    try {
      const text = await Bun.file(path).text();
      artifacts.push(
        `<file path="${path}">\n${text.slice(0, GRADER_FILE_BYTES)}${text.length > GRADER_FILE_BYTES ? "\n…truncated…" : ""}\n</file>`,
      );
    } catch {
      // Deleted, binary, or never actually written. Its absence is itself evidence, and
      // the path is still listed below so the grader can weigh that.
    }
  }

  const prompt = `You are grading one run of a Claude Code skill against a fixed list of expectations.

<task>
${params.scenario.prompt}
</task>

<tools_used>
${params.observation.toolCalls.join(", ") || "none"}
</tools_used>

<files_written>
${params.observation.filesWritten.join("\n") || "none"}
</files_written>

${artifacts.join("\n\n")}

<final_response>
${params.observation.finalText.slice(0, 20_000)}
</final_response>

<expectations>
${params.scenario.expectations.map((text, index) => `${index + 1}. ${text}`).join("\n")}
</expectations>

Judge each expectation on the evidence above and nothing else. An expectation you cannot
find evidence for has not been met — a plausible-sounding claim in the final response is
not evidence that the work happened.

Respond with only a JSON array, one object per expectation in the order given:
[{"text": "<the expectation, verbatim>", "passed": true, "evidence": "<what in the run shows it>"}]`;

  const text = await callClaude(prompt, params.model);
  const grading = parseGrading(text, params.scenario.expectations);
  return { passed: grading.passed, total: grading.total, verdicts: grading.verdicts };
}

/**
 * One single-turn `claude -p` call with the prompt on stdin.
 *
 * stdin rather than argv for the reason `propose-description.ts` gives: these prompts
 * embed a whole SKILL.md body or a produced file, and would blow past a comfortable argv
 * length. A failure returns empty text rather than throwing -- a grader that could not be
 * reached scores its assertions as unmet, which fails the guardrail closed.
 */
export async function callClaude(prompt: string, model: string | undefined): Promise<string> {
  const attempt = async (bare: boolean): Promise<CommandOutcome> => {
    const cmd = ["claude", "-p", "--output-format", "text"];
    if (model !== undefined && model !== "") cmd.push("--model", model);
    // `--bare` skips hooks, LSP, plugin sync, keychain reads, auto-memory, background
    // prefetches and CLAUDE.md discovery. A helper call needs none of them: everything
    // the judgement uses is already in the prompt. Worth having because this call happens
    // once per run and the harness makes hundreds.
    if (bare) cmd.push("--bare");
    return runIsolatedHelper(cmd, { stdin: prompt, timeoutMs: HELPER_CALL_TIMEOUT_SECONDS * 1000 });
  };

  // Opt-in, and it degrades rather than failing the run. Under `--bare` the CLI reads
  // auth strictly from ANTHROPIC_API_KEY, an apiKeyHelper supplied via --settings, or a
  // third-party provider's own credentials -- OAuth and the keychain are never consulted.
  // So on a machine authenticated by login rather than by key, every bare call fails, and
  // a grader that cannot be reached scores its expectations unmet: the guardrail would
  // reject every candidate for a reason that has nothing to do with the candidate.
  //
  // Probing once and latching is what keeps that from happening quietly. The first
  // failure under bare retries unbared and turns bare off for the rest of the process, so
  // the cost of a wrong guess is one extra call rather than a whole run of false failures.
  if (graderBare && graderBareUsable) {
    const bareOutcome = await attempt(true);
    if (bareOutcome.kind === "ok" && bareOutcome.exitCode === 0) return bareOutcome.stdout;
    graderBareUsable = false;
    console.error(
      "Warning: --grader-bare could not authenticate, so it is off for the rest of this run. " +
        "Bare mode reads ANTHROPIC_API_KEY, an apiKeyHelper via --settings, or a third-party " +
        "provider's credentials; it never reads OAuth or the keychain.",
    );
  }

  const outcome = await attempt(false);
  if (outcome.kind === "ok" && outcome.exitCode === 0) return outcome.stdout;
  const detail =
    outcome.kind === "ok" ? `exited ${outcome.exitCode}: ${outcome.stderr.slice(0, 200)}` : outcome.kind;
  console.error(`Warning: helper claude -p call failed (${detail})`);
  return "";
}

/** Set from `--grader-bare`; see `callClaude`. */
let graderBare = false;
/** Latched off by the first bare call that cannot authenticate. */
let graderBareUsable = true;

/** Exported for the CLI and for tests, which need to reset the latch between cases. */
export function setGraderBare(enabled: boolean): void {
  graderBare = enabled;
  graderBareUsable = true;
}

// ---------------------------------------------------------------------------
// Measuring a whole layout
// ---------------------------------------------------------------------------

/**
 * The description every scenario copy of `skillDir` will be installed with.
 *
 * Named rather than inlined at its one call site so the loop's read is reachable from a
 * test: the sweep around it spawns `claude`, so an inlined read had no coverage, and that
 * is exactly how it came to be wrong.
 *
 * Through the conformant reader, not `parseSkillMd`. That one ends a block scalar at the
 * first line not opening with two spaces or a tab, and a blank line opens with neither, so
 * a description with a paragraph break was truncated there -- four of five shipped skills,
 * losing 22-40%. This value flows into every scenario copy the loop installs, so the loop
 * was reporting savings and pass rates for an artifact nobody ships.
 */
export async function layoutDescription(skillDir: string): Promise<string> {
  const { description } = await readTargetDefinition(skillDir, "skill");
  return description;
}

export interface MeasureParams {
  readonly skillDir: string;
  readonly skillName: string;
  readonly scenarios: readonly DisclosureScenario[];
  readonly runsPerScenario: number;
  readonly numWorkers: number;
  readonly timeoutSeconds: number;
  readonly model?: string | undefined;
  readonly graderModel?: string | undefined;
  readonly permissionMode?: string | undefined;
  readonly grade: boolean;
  readonly logDir?: string | undefined;
  /**
   * A repository to copy into every throwaway root before its child starts, for a skill
   * whose scenarios need one (a docs tree to read, a git history to gate against). Without
   * it a scenario runs in an empty directory, which is right for a skill that produces a
   * file from a prompt and wrong for one that works on a repo.
   */
  readonly fixtureDir?: string | undefined;
  readonly onProgress?: (settled: number, total: number) => void;
  /** Called as each run STARTS, so a caller can show a busy pool before anything settles. */
  readonly onStarted?: (inFlight: number, started: number, total: number) => void;
  /**
   * Handed every attempt's isolation proof. Point it at an `IsolationLedger`.
   *
   * Threaded rather than folded here for the reason the sweep does not build its own
   * envelope: the caller owns that document, and `run.isolation` is a field on it.
   */
  readonly onIsolation?: ((verdict: IsolationVerdict) => void) | undefined;
  /**
   * Prior wall clock per scenario id, used to schedule the longest work first.
   *
   * Absent on a first sweep, which is why this is optional rather than required: with no
   * history there is nothing to sort by and the file order stands.
   */
  readonly durationHints?: ReadonlyMap<string, number> | undefined;
}

/**
 * Run one set of scenarios against one layout, `runsPerScenario` times each.
 *
 * Whichever scenarios are handed in go through together in ONE pool. The caller decides
 * what that set is: the baseline passes train and held-out together, because two
 * sequential sweeps of half the set each are slower than one sweep of the whole set at
 * the same concurrency, while a candidate passes train first so a losing layout can be
 * retired before its held-out runs are spent. That trade is set out at `measure`.
 */
/**
 * Every attempt to run, longest known work first.
 *
 * A pool that draws work in file order can hand out its longest task last and then
 * finish that task alone while every other worker idles. Measured on this corpus: a
 * scenario taking 254s started at t=122s and set the sweep's whole 376s makespan.
 * Longest-first is the standard remedy for that and costs nothing to apply.
 *
 * Unknown scenarios sort LAST rather than first. An unknown is not evidence of being
 * short, but promoting one above a scenario measured long would be scheduling on a
 * guess, and the cost of guessing wrong is exactly the tail this exists to remove.
 * With no hints at all every key ties; the sort is stable, so the file order stands.
 *
 * Extracted from {@link measureLayout} because that function spawns a process per
 * attempt, and an ordering rule reachable only by spending an hour of API time is an
 * ordering rule with no coverage.
 */
export function orderAttempts(
  scenarios: readonly DisclosureScenario[],
  runsPerScenario: number,
  hints?: ReadonlyMap<string, number> | undefined,
): { scenario: DisclosureScenario; attempt: number }[] {
  const attempts: { scenario: DisclosureScenario; attempt: number }[] = [];
  for (const scenario of scenarios) {
    for (let attempt = 1; attempt <= runsPerScenario; attempt += 1) {
      attempts.push({ scenario, attempt });
    }
  }
  if (hints !== undefined && hints.size > 0) {
    attempts.sort((a, b) => (hints.get(b.scenario.id) ?? 0) - (hints.get(a.scenario.id) ?? 0));
  }
  return attempts;
}

/**
 * Copy a fixture repository into a throwaway root, so a scenario that needs a working
 * repository -- files to read, a git history to gate against, a docs tree to update --
 * finds one under its own cwd rather than an empty directory.
 *
 * The fixture's top-level entries are copied into `root` (its `.git` included, which is
 * what makes `git log` inside the child real), so the skill the run installed under
 * `root/.claude/skills/<alias>` sits beside the fixture's own `.claude/` rather than
 * being replaced by it. `node_modules` is skipped: it is never what a scenario reads, and
 * it is usually the largest thing in the tree.
 */
export async function seedFixture(root: string, fixtureDir: string): Promise<void> {
  for (const entry of await readdir(fixtureDir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    await cp(`${fixtureDir}/${entry.name}`, `${root}/${entry.name}`, {
      recursive: true,
      force: false,
      errorOnExist: false,
    });
  }
}

export async function measureLayout(params: MeasureParams): Promise<readonly ScenarioRun[]> {
  const attempts = orderAttempts(params.scenarios, params.runsPerScenario, params.durationHints);

  // Read once for the whole sweep. Every attempt installs its own throwaway copy of this
  // layout, but they all install the SAME description, so reading it per attempt was one
  // guaranteed-identical disk round trip per run.
  const description = await layoutDescription(params.skillDir);

  return await mapWithConcurrency(
    attempts,
    Math.max(1, params.numWorkers),
    async ({ scenario, attempt }) =>
      await runScenario({
        scenario,
        attempt,
        skillDir: params.skillDir,
        skillName: params.skillName,
        description,
        timeoutSeconds: params.timeoutSeconds,
        model: params.model,
        graderModel: params.graderModel,
        permissionMode: params.permissionMode,
        grade: params.grade,
        logDir: params.logDir,
        fixtureDir: params.fixtureDir,
        onIsolation: params.onIsolation,
      }),
    params.onProgress,
    params.onStarted,
  );
}
// ---------------------------------------------------------------------------
// Train-first gating
// ---------------------------------------------------------------------------

/** What one layout's sweeps produced, before token counts and the file table are added. */
export interface GatedMeasurement {
  readonly trainRuns: readonly ScenarioRun[];
  readonly holdoutRuns: readonly ScenarioRun[];
  readonly train: SplitScore;
  /** Null when no holdout is configured, or when the gate retired this layout. */
  readonly holdout: SplitScore | null;
  /** Why the held-out runs were skipped, or null if they were not. */
  readonly gateReason: string | null;
}

/**
 * Decide which sweeps a layout gets, and run them.
 *
 * The sweeps are INJECTED rather than called directly, and that is the point of this
 * function existing at all: the change worth testing here is which sweeps happen, and a
 * sequencing rule that can only be exercised by spawning `claude` twenty times is a rule
 * with no coverage. The suite passes three recording stubs and asserts that a candidate
 * losing on train never reaches `sweepHoldout`; `optimizeDisclosure` passes the real ones.
 *
 * Three shapes, and the reason each is what it is:
 *
 * - `gateAgainst === null` -- ONE pool over every scenario, via `sweepAll`. This is the
 *   baseline: it is not competing for a slot, its held-out score is what every candidate
 *   is later judged against, and there is nothing to gate it on. Both splits together
 *   because two sequential half-sweeps drain the pool twice, and at high concurrency that
 *   tail is most of the cost.
 * - No holdout configured -- `sweepTrain` alone, which IS every scenario. Nothing is being
 *   withheld, so there is nothing to save and nothing to gate.
 * - Otherwise -- `sweepTrain`, then `sweepHoldout` only if `trainGate` says the layout is
 *   still in contention. At the default `--holdout 0.4` a candidate that loses on train
 *   costs three fifths of what it used to.
 */
export async function measureWithGate(params: {
  readonly sweepAll: () => Promise<readonly ScenarioRun[]>;
  readonly sweepTrain: () => Promise<readonly ScenarioRun[]>;
  readonly sweepHoldout: () => Promise<readonly ScenarioRun[]>;
  readonly partitionRuns: (runs: readonly ScenarioRun[]) => {
    readonly train: readonly ScenarioRun[];
    readonly holdout: readonly ScenarioRun[];
  };
  readonly hasHoldout: boolean;
  /** The incumbent's TRAIN score, or null for a layout that must measure both splits. */
  readonly gateAgainst: SplitScore | null;
  readonly passRateTolerance?: number;
}): Promise<GatedMeasurement> {
  if (params.gateAgainst === null) {
    const runs = await params.sweepAll();
    const { train, holdout } = params.partitionRuns(runs);
    return {
      trainRuns: train,
      holdoutRuns: holdout,
      train: scoreRuns(train),
      holdout: params.hasHoldout ? scoreRuns(holdout) : null,
      gateReason: null,
    };
  }

  const trainRuns = await params.sweepTrain();
  const train = scoreRuns(trainRuns);
  if (!params.hasHoldout) {
    return { trainRuns, holdoutRuns: [], train, holdout: null, gateReason: null };
  }

  const gate = trainGate({
    candidate: train,
    incumbent: params.gateAgainst,
    ...(params.passRateTolerance === undefined
      ? {}
      : { passRateTolerance: params.passRateTolerance }),
  });
  if (!gate.inContention) {
    // `holdout` stays null and `gateReason` is set, and the pairing is load-bearing: the
    // loop selects only on candidates whose `gateReason` is null, because a null holdout
    // would otherwise fall back to the train score inside `selectCandidate`.
    return { trainRuns, holdoutRuns: [], train, holdout: null, gateReason: gate.reason };
  }

  const holdoutRuns = await params.sweepHoldout();
  return { trainRuns, holdoutRuns, train, holdout: scoreRuns(holdoutRuns), gateReason: null };
}

// ---------------------------------------------------------------------------
// Turning a set of runs into a scored layout
// ---------------------------------------------------------------------------

/** One layout, measured: what it costs, what it scored, and which bundled files were read. */
export interface LayoutMeasurement {
  readonly dir: string;
  readonly bodyTokens: number;
  readonly runs: readonly ScenarioRun[];
  readonly train: SplitScore;
  /** Null when no holdout was configured, OR when `gateReason` retired this layout. */
  readonly holdout: SplitScore | null;
  /** Why `trainGate` refused to spend held-out runs on this layout, or null if it did not. */
  readonly gateReason: string | null;
  readonly files: readonly FileStat[];
  /**
   * What the scenario set declared as ground truth, and what its negative rows measured.
   *
   * Always present, including for a set that declared none -- that state is the reason
   * every `recall` in `files` is null, and a reader who cannot see it has no way to tell
   * "nothing was declared" from "nothing was found".
   */
  readonly groundTruth: GroundTruth;
}

/**
 * Fold a layout's sweeps into the record both entry points report from.
 *
 * The single place where runs become body tokens and a file table, which is exactly the
 * step the two entry points must never disagree about: a measurement pass and the
 * optimizer's baseline are the same claim about the same skill, and two implementations of
 * it would drift the first time the verdict rule moved.
 *
 * `files` is computed from the TRAIN runs alone, because in the optimizer the pull rates
 * drive the proposals and the held-out split has to stay out of the question it later
 * judges. A measurement pass holds nothing back, so its train split IS every run and the
 * distinction costs it nothing.
 */
export async function summarizeLayout(params: {
  readonly dir: string;
  readonly counter: TokenCounter;
  readonly measured: GatedMeasurement;
  readonly inlineThreshold: number;
  /**
   * The scenarios behind the train runs, for the ground truth some of them carry.
   *
   * Optional, and defaulting to none. A caller that passes nothing gets exactly today's
   * output with every `recall` null and `groundTruth.annotatedScenarios` zero, which is
   * the truthful description of a measurement with no ground truth to measure against.
   */
  readonly scenarios?: readonly DisclosureScenario[] | undefined;
}): Promise<LayoutMeasurement> {
  const body = splitSkillMd(await Bun.file(`${params.dir}/SKILL.md`).text()).body;
  const inventory = await inventoryBundledFiles(params.dir, body, params.counter);
  const scenarios = params.scenarios ?? [];
  return {
    dir: params.dir,
    bodyTokens: params.counter.count(body),
    runs: [...params.measured.trainRuns, ...params.measured.holdoutRuns],
    train: params.measured.train,
    holdout: params.measured.holdout,
    gateReason: params.measured.gateReason,
    files: computeFileStats(
      inventory,
      params.measured.trainRuns,
      params.inlineThreshold,
      scenarios,
    ),
    // Over the TRAIN runs, matching `files` exactly. The held-out split is withheld from
    // the figures that drive proposals, and an over-fetch rate taken over a different set
    // of runs from the recall printed beside it is two experiments in one table.
    groundTruth: summarizeGroundTruth({
      scenarios,
      runs: params.measured.trainRuns,
      inventory,
    }),
  };
}
