#!/usr/bin/env bun
/**
 * Optimize a skill's progressive disclosure: minimize what it costs to invoke, without
 * regressing what it achieves.
 *
 * The same architecture as `optimize-description.ts` -- split the scenarios, measure, propose,
 * re-measure, select on the held-out split -- pointed at a different variable. That loop
 * optimizes the description, which decides whether the skill is reached for at all. This
 * one optimizes the LAYOUT: which content sits in the body, paid on every invocation,
 * and which sits behind a pointer in `references/`, paid only when it is needed.
 *
 * What one run measures, per scenario:
 *
 *   - body tokens, the bill every invocation pays whether or not it needs the content
 *   - which bundled files were actually read, and on what fraction of runs
 *   - total context tokens, from the `result` event's usage block
 *   - the assertion pass rate, which is the guardrail rather than the objective
 *
 * The decision rule falls out of the pull rate rather than out of taste, and lives in
 * `lib/disclosure.ts` where it can be driven from fixtures. This file owns the parts that
 * cannot be: spawning `claude`, grading a transcript, materializing a candidate layout on
 * disk, and the loop that ties them together.
 *
 * Pure Bun throughout. `node:fs/promises` for the tree copy and `node:path` for path
 * arithmetic -- the two jobs `../references/pure-bun.md` names as having no Bun-native
 * equivalent -- and `Bun.file` / `Bun.write` / `Bun.spawn` for everything else.
 */

import { cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { ensureDashboard, openInBrowser } from "./lib/browser.ts";
import { mapWithConcurrency } from "./lib/pool.ts";
import { ProgressReporter, projectRemainingMs } from "./lib/progress.ts";
import { formatPercent } from "./lib/pyfloat.ts";
import { runCommand, runStreamingLines, type CommandOutcome } from "./lib/subprocess.ts";
import {
  applyEdits,
  bodySections,
  computeFileStats,
  createRunCollector,
  DEFAULT_INLINE_THRESHOLD,
  DEFAULT_PASS_RATE_TOLERANCE,
  generateCandidates,
  inventoryBundledFiles,
  loadTokenCounter,
  parseExtractionProposal,
  parseGrading,
  parseScenarioSet,
  scoreRuns,
  selectCandidate,
  shortlistExtractions,
  splitScenarios,
  splitSkillMd,
  trainGate,
  type BodySection,
  type DisclosureCandidate,
  type DisclosureScenario,
  type FileStat,
  type FileVerdict,
  type LoadMode,
  type ProposedExtraction,
  type ScenarioRun,
  type ScoredCandidate,
  type SplitScore,
  type TokenCounter,
} from "./lib/disclosure.ts";
import {
  generateDisclosureReport,
  type DisclosureProgress,
  type DisclosureReportInput,
  type IterationRecord,
} from "./lib/disclosure-report.ts";
import type { Spec } from "./lib/cli.ts";
import {
  buildEnvelope,
  detectInstallState,
  ENVELOPE_FILENAME,
  hashArtifact,
  hashJsonValue,
  installConflict,
  writeEnvelope,
  type Envelope,
  type HeadlineMetric,
  type InstallState,
  type TokenizerKind,
  type Verdict,
} from "./lib/envelope.ts";
import { installSkillForTrigger, readTargetDefinition } from "./measure-triggering.ts";
import { flagBoolean, flagNumber, flagString, parseCli, requireFlag } from "./measure-triggering.ts";

// ---------------------------------------------------------------------------
// Defaults, and why each one is where it is
// ---------------------------------------------------------------------------

/**
 * Iterations, default 3 rather than the description loop's 5.
 *
 * A judgement about cost, not about convergence. An iteration of `optimize-description.ts` scores ONE
 * candidate description over the scenario set. An iteration here materializes and scores
 * up to `--max-candidates` whole layouts, so its call count is multiplied by the candidate
 * count -- and each of those calls is a scenario doing real work rather than a routing
 * question that settles in seconds. Three iterations of four candidates is already nine
 * full measurement passes; five would be fifteen, which is more wall clock than a
 * restructure is usually worth before a human looks at the result.
 */
const DEFAULT_MAX_ITERATIONS = 3;

/**
 * Candidates measured per iteration.
 *
 * Three, because the generator orders them by how much unconditional cost they could
 * remove, so the fourth-ranked candidate is by construction the least promising thing
 * still on the list -- and it costs a full scenario sweep to find that out.
 */
const DEFAULT_MAX_CANDIDATES = 3;

/**
 * Runs per scenario.
 *
 * Two, not one, because a pull rate computed from a single run is a boolean wearing a
 * percentage sign -- and the whole decision rule is a threshold on that number. Two is
 * the smallest count that can distinguish "always" from "sometimes"; raise it when the
 * verdicts look unstable between iterations, which is the symptom of too little evidence.
 */
const DEFAULT_RUNS_PER_SCENARIO = 2;

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
 */
const DEFAULT_NUM_WORKERS = 12;

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
const DEFAULT_TIMEOUT_SECONDS = 600;

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

/**
 * The floor on a body section worth pushing out.
 *
 * A judgement. Deferring content costs a round trip and the tool-call overhead that comes
 * with it, so moving a small section out makes the skill slower and barely cheaper. 250
 * tokens is roughly a substantial paragraph or a small table -- the point at which the
 * saving starts to exceed what the pointer and the tool call cost to put back.
 */
const DEFAULT_MIN_EXTRACT_TOKENS = 250;

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
  const { root, alias } = await installSkillForTrigger(
    params.skillDir,
    params.skillName,
    params.description,
  );
  const installedSkillDir = `${root}/.claude/skills/${alias}`;

  try {
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
      // Same isolation as the trigger harness, and load-bearing for the same two reasons:
      // the operator's own plugins would otherwise compete for the work, and every
      // configured MCP server would be a connection attempt on every run.
      "--setting-sources",
      "project",
      "--strict-mcp-config",
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
    const outcome = await runStreamingLines(
      cmd,
      { cwd: root, timeoutMs: params.timeoutSeconds * 1000 },
      collector.onLine,
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
      filesRead: observation.filesRead,
      skillLoaded: observation.skillLoaded,
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
function failedRun(params: ScenarioRunParams, error: string): ScenarioRun {
  console.error(`Warning: ${params.scenario.id} attempt ${params.attempt}: ${error}`);
  return {
    scenarioId: params.scenario.id,
    attempt: params.attempt,
    filesRead: [],
    skillLoaded: false,
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
async function callClaude(prompt: string, model: string | undefined): Promise<string> {
  const attempt = async (bare: boolean): Promise<CommandOutcome> => {
    const cmd = ["claude", "-p", "--output-format", "text"];
    if (model !== undefined && model !== "") cmd.push("--model", model);
    // `--bare` skips hooks, LSP, plugin sync, keychain reads, auto-memory, background
    // prefetches and CLAUDE.md discovery. A helper call needs none of them: everything
    // the judgement uses is already in the prompt. Worth having because this call happens
    // once per run and the harness makes hundreds.
    if (bare) cmd.push("--bare");
    return runCommand(cmd, { stdin: prompt, timeoutMs: HELPER_CALL_TIMEOUT_SECONDS * 1000 });
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

interface MeasureParams {
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
  readonly onProgress?: (settled: number, total: number) => void;
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
async function measureLayout(params: MeasureParams): Promise<readonly ScenarioRun[]> {
  const attempts: { scenario: DisclosureScenario; attempt: number }[] = [];
  for (const scenario of params.scenarios) {
    for (let attempt = 1; attempt <= params.runsPerScenario; attempt += 1) {
      attempts.push({ scenario, attempt });
    }
  }

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
      }),
    params.onProgress,
  );
}

/** Split a measured set back into its two halves, by scenario id. */
function partition(
  runs: readonly ScenarioRun[],
  trainIds: ReadonlySet<string>,
): { readonly train: readonly ScenarioRun[]; readonly holdout: readonly ScenarioRun[] } {
  return {
    train: runs.filter((run) => trainIds.has(run.scenarioId)),
    holdout: runs.filter((run) => !trainIds.has(run.scenarioId)),
  };
}

// ---------------------------------------------------------------------------
// The proposal step
// ---------------------------------------------------------------------------

/**
 * Ask which body sections are needed on a minority of runs.
 *
 * This is the one place judgement enters, and it is worth being plain about why. The
 * file-level half of the decision rule is mechanical: a `Read` inside the skill directory
 * is countable, so "pulled on nearly every run" and "pulled on no run" are measurements.
 * The body half is not directly observable -- the body arrives whole, so nothing in the
 * stream distinguishes the section a run used from the one it skipped past.
 *
 * What makes this a measurement rather than taste is what happens next: an extraction is
 * a HYPOTHESIS, and the next iteration tests it directly. A section pushed out comes back
 * as a bundled file with a pull rate of its own, and if that rate is near one the
 * mechanical rule says to inline it again. The loop corrects its own proposals.
 *
 * Failure is non-fatal and returns no proposals, mirroring how `optimize-description.ts` treats a
 * failed improvement step: the measurements already taken are valid, and a broken helper
 * call is a reason to stop proposing rather than to discard evidence.
 */
async function proposeExtractions(params: {
  readonly skillName: string;
  readonly body: string;
  readonly shortlist: readonly BodySection[];
  /** The measured file table. The pull rates are what tell the model what deferral already works. */
  readonly files: readonly FileStat[];
  readonly scenarios: readonly DisclosureScenario[];
  readonly model?: string | undefined;
  readonly logDir?: string | undefined;
  readonly iteration: number;
}): Promise<readonly ProposedExtraction[]> {
  if (params.shortlist.length === 0) return [];

  const sectionLines = params.shortlist
    .map((section) => `- "${section.heading}" — ${section.tokens} tokens, ${section.lines} lines`)
    .join("\n");
  const fileLines = params.files
    .map(
      (file) =>
        `- ${file.path} (${file.loadMode}, ${file.tokens} tokens) — read on ${file.pulls}/${file.countedRuns} runs`,
    )
    .join("\n");
  const scenarioLines = params.scenarios.map((scenario) => `- ${scenario.prompt}`).join("\n");

  const prompt = `A Claude Code skill called "${params.skillName}" is being restructured to cost less context.

Its SKILL.md body loads on EVERY invocation. Files under references/ load only when the
body points at them and the work needs them. The goal is to move content that only some
runs need out of the body, leaving a sentence saying what moved and when to read it.

These are the training scenarios the skill was measured on:
${scenarioLines}

These bundled files exist, with how often each was actually read:
${fileLines}

These body sections are large enough that moving one out could pay for the extra tool
call it would then cost:
${sectionLines}

Here is the body:
<body>
${params.body}
</body>

Name the sections that only a MINORITY of realistic uses of this skill need — the ones
every invocation is currently paying for and most do not use. Do not name a section that
almost every run would need: moving that out makes the skill slower for no saving. Do not
name a section that is only a pointer already. If nothing qualifies, return an empty array.

Respond with only a JSON array:
[{"heading": "<the section heading, verbatim>", "reason": "<why a minority of runs need it>"}]`;

  const text = await callClaude(prompt, params.model);
  const proposals = parseExtractionProposal(text, params.shortlist);
  if (params.logDir !== undefined && params.logDir !== "") {
    await Bun.write(
      `${params.logDir}/propose_iter_${params.iteration}.json`,
      `${JSON.stringify({ prompt, response: text, proposals }, null, 2)}\n`,
    );
  }
  return proposals;
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
// Materializing a candidate
// ---------------------------------------------------------------------------

/**
 * Write a candidate layout into its own directory, leaving the source untouched.
 *
 * The source skill is never modified by this script, on any path. A loop that edits the
 * artifact it is measuring has destroyed the baseline it would need to tell whether the
 * edit helped, and an interrupted run would leave a half-restructured skill behind.
 *
 * Exported so the copy-write-delete sequence is reachable from the suite. `applyEdits` is
 * covered as data, but "the source tree is still intact afterwards" is a claim about the
 * filesystem and has to be asserted against one.
 */
export async function materializeCandidate(
  sourceDir: string,
  destDir: string,
  candidate: DisclosureCandidate,
): Promise<readonly string[]> {
  await rm(destDir, { recursive: true, force: true });
  await cp(sourceDir, destDir, { recursive: true });

  const fileContents = new Map<string, string>();
  for (const edit of candidate.edits) {
    if (edit.kind !== "inline") continue;
    const file = Bun.file(`${destDir}/${edit.path}`);
    if (await file.exists()) fileContents.set(edit.path, await file.text());
  }

  const result = applyEdits({
    skillMd: await Bun.file(`${destDir}/SKILL.md`).text(),
    fileContents,
    edits: candidate.edits,
  });

  await Bun.write(`${destDir}/SKILL.md`, result.skillMd);
  for (const [relPath, content] of result.writes) await Bun.write(`${destDir}/${relPath}`, content);
  for (const relPath of result.deletes) await rm(`${destDir}/${relPath}`, { force: true });
  return result.notes;
}

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

export interface OptimizeParams {
  readonly skillPath: string;
  readonly scenarios: readonly DisclosureScenario[];
  readonly holdout: number;
  readonly maxIterations: number;
  readonly maxCandidates: number;
  readonly runsPerScenario: number;
  readonly numWorkers: number;
  readonly timeoutSeconds: number;
  readonly inlineThreshold: number;
  readonly passRateTolerance: number;
  readonly minExtractTokens: number;
  readonly propose: boolean;
  readonly model?: string | undefined;
  /** Grades the assertions. Deliberately not `model`; see `DEFAULT_GRADER_MODEL`. */
  readonly graderModel?: string | undefined;
  readonly permissionMode?: string | undefined;
  readonly workspaceDir: string;
  readonly verbose: boolean;
  readonly liveReportPath?: string | undefined;
  readonly resultsDir?: string | undefined;
  readonly logDir?: string | undefined;
  /**
   * Called once per scenario run, whatever became of it. Point it at {@link createRunTally}.
   *
   * The loop's own return value cannot answer "how many runs were spent and how many
   * survived": `OptimizeOutput` reports the SELECTED layout -- its file table, its body
   * tokens, its score -- and every run spent on a candidate that lost is gone by the time
   * it is built. `provenance.scored` is a claim about the whole operation, so it has to be
   * counted as the runs happen rather than reconstructed from the winner afterwards.
   *
   * Adding the field here rather than widening `OptimizeOutput` is deliberate:
   * `results.json` is a wire contract that tests and `../references/schemas.md` assert on,
   * and a new key in it is a change to a file other things read.
   */
  readonly onRunOutcome?: ((run: ScenarioRun) => void) | undefined;
}

export interface OptimizeOutput {
  readonly skill_name: string;
  readonly skill_path: string;
  readonly exit_reason: string;
  readonly token_method: string;
  readonly tokens_are_estimated: boolean;
  readonly holdout: number;
  readonly train_size: number;
  readonly holdout_size: number;
  readonly runs_per_scenario: number;
  readonly baseline_body_tokens: number;
  readonly best_body_tokens: number;
  readonly baseline_context_tokens: number;
  readonly best_context_tokens: number;
  readonly best_layout_path: string;
  readonly applied_edits: readonly string[];
  readonly files: readonly FileStat[];
  readonly iterations: readonly IterationRecord[];
  /** Anything the rewriter did that an author should look at before adopting the result. */
  readonly notes: readonly string[];
}

/** A layout that has been measured -- on both splits, or on train alone if it was gated. */
interface MeasuredLayout {
  readonly dir: string;
  readonly bodyTokens: number;
  readonly runs: readonly ScenarioRun[];
  readonly train: SplitScore;
  /** Null when no holdout was configured, OR when `gateReason` retired this layout. */
  readonly holdout: SplitScore | null;
  /**
   * Why `trainGate` refused to spend held-out runs on this layout, or null if it did not.
   *
   * The two reasons `holdout` can be null are not interchangeable and the difference
   * decides whether the layout can be selected, so it is recorded rather than inferred:
   * "no holdout configured" means train is the selection score, while "gated" means this
   * layout must never reach `selectCandidate` at all.
   */
  readonly gateReason: string | null;
  readonly files: readonly FileStat[];
}

export async function optimizeDisclosure(params: OptimizeParams): Promise<OptimizeOutput> {
  const counter = await loadTokenCounter();
  // Same reader as the description read in `measureLayout`, for the same reason. `name` is
  // a plain scalar so the two readers agree on every skill shipped today, but agreeing by
  // luck is not a property worth keeping: a quoted or folded `name` would diverge silently.
  const { name: skillName } = await readTargetDefinition(params.skillPath, "skill");
  const [trainScenarios, holdoutScenarios] = splitScenarios(params.scenarios, params.holdout);
  const trainIds = new Set(trainScenarios.map((scenario) => scenario.id));
  const hasHoldout = holdoutScenarios.length > 0;

  if (params.scenarios.every((scenario) => scenario.expectations.length === 0)) {
    console.error(
      "Warning: no scenario carries expectations, so the pass-rate guardrail cannot fire. " +
        "The loop will optimize context cost with nothing checking that the skill still works.",
    );
  }
  if (!hasHoldout) {
    console.error(
      "Warning: no held-out scenarios, so candidates are selected on the same scenarios that " +
        "proposed them. Add scenarios, or raise --holdout, before trusting the result.",
    );
  }

  // An UPPER BOUND, and more of one than it used to be. Two things now finish short of
  // it: a candidate `trainGate` retires never runs its held-out scenarios, and the loop
  // still exits early when no candidate improves. Reported against rather than
  // recomputed, because a total that shrank as candidates were gated would make the bar
  // jump backwards and would invalidate every projection extrapolated from it.
  const totalAttempts =
    (1 + Math.max(0, params.maxIterations - 1) * params.maxCandidates) *
    params.scenarios.length *
    params.runsPerScenario;

  const reporter = ProgressReporter.start({
    kind: "disclosure-loop",
    label: `${skillName} — progressive disclosure`,
    total: totalAttempts,
    subject: skillName,
    detail: {
      maxIterations: params.maxIterations,
      phase: "baseline measurement",
      ...(params.liveReportPath === undefined ? {} : { reportPath: params.liveReportPath }),
      ...(params.resultsDir === undefined ? {} : { resultsDir: params.resultsDir }),
    },
  });

  const iterations: IterationRecord[] = [];
  const notes: string[] = [];
  const appliedEdits: string[] = [];
  const alreadyTried = new Set<string>();
  let settledSoFar = 0;
  // "in progress" rather than "unknown": every terminal path below assigns a real reason,
  // and this value is what the live report shows in the window before one exists.
  let exitReason = "in progress";

  /**
   * Rewrite the live report, optionally with a progress row.
   *
   * Serialized through a chain rather than awaited at the call site, for the reason
   * `optimize-description.ts` gives: this is driven from the pool's per-attempt callback, and putting
   * a filesystem round trip on that path would slow every completion. Overlapping writes
   * would also let an older snapshot land last.
   */
  let reportChain: Promise<void> = Promise.resolve();
  let current: MeasuredLayout | null = null;
  let baseline: MeasuredLayout | null = null;

  const publish = (progress?: DisclosureProgress): void => {
    if (params.liveReportPath === undefined) return;
    const snapshot = buildReportInput({
      skillName,
      params,
      counter,
      iterations,
      baseline,
      current,
      trainSize: trainScenarios.length,
      holdoutSize: holdoutScenarios.length,
      exitReason: progress === undefined ? exitReason : "in progress",
      appliedTo: null,
      notes: [...notes],
      ...(progress === undefined ? {} : { inProgress: progress }),
    });
    reportChain = reportChain
      .then(async () => {
        await Bun.write(
          params.liveReportPath as string,
          generateDisclosureReport(snapshot, { autoRefresh: true }),
        );
      })
      .catch(() => undefined);
  };

  /**
   * Measure one layout, spending held-out runs only on a layout that could still win.
   *
   * The sequencing lives in `measureWithGate`, which is where it can be tested; this
   * supplies the three real sweeps, the progress wiring, and the token counts that turn a
   * set of runs into a `MeasuredLayout`.
   *
   * `gateAgainst` is the incumbent's TRAIN score, or null for the baseline -- the layout
   * every candidate is later compared against, which therefore has to have a held-out
   * score of its own whatever it costs.
   */
  const measure = async (
    dir: string,
    phase: string,
    iteration: number,
    gateAgainst: SplitScore | null,
  ): Promise<MeasuredLayout> => {
    const startedAt = Date.now();
    reporter.update({ iteration, phase });
    // The whole scenario set, even for a layout that may only run the train half. One
    // layout gets one progress row, and a row whose denominator changed halfway through
    // would read as the work growing rather than as a candidate being retired early.
    const layoutTotal = params.scenarios.length * params.runsPerScenario;
    publish({ iteration, settled: 0, total: layoutTotal, phase, startedAt });

    const priorAttempts = settledSoFar;
    let settledInLayout = 0;

    /** One sweep, reporting against the whole layout so consecutive sweeps read as one bar. */
    const sweep = async (
      scenarios: readonly DisclosureScenario[],
    ): Promise<readonly ScenarioRun[]> => {
      if (scenarios.length === 0) return [];
      const runs = await measureLayout({
        skillDir: dir,
        skillName,
        scenarios,
        runsPerScenario: params.runsPerScenario,
        numWorkers: params.numWorkers,
        timeoutSeconds: params.timeoutSeconds,
        model: params.model,
        graderModel: params.graderModel,
        permissionMode: params.permissionMode,
        grade: true,
        logDir: params.logDir,
        onProgress: (settled) => {
          const inLayout = settledInLayout + settled;
          reporter.report(priorAttempts + inLayout);
          const remainingMs =
            projectRemainingMs(
              { ...reporter.status, settled: inLayout, total: layoutTotal, startedAt },
              Date.now(),
            ) ?? undefined;
          publish({
            iteration,
            settled: inLayout,
            total: layoutTotal,
            phase,
            startedAt,
            ...(remainingMs === undefined ? {} : { remainingMs }),
          });
        },
      });
      settledInLayout += runs.length;
      settledSoFar += runs.length;
      // Reported per SWEEP rather than per attempt, which is where this differs from the
      // trigger harness's `onAttemptOutcome`. That callback drives a live progress row and
      // has to fire the moment an attempt lands; this one feeds a tally nobody reads until
      // the envelope is built, so putting it on the pool's hot path would buy nothing. It
      // sits in `sweep` rather than in `measureLayout` because every run of every layout --
      // baseline, gated candidate, winner -- passes through here exactly once.
      if (params.onRunOutcome !== undefined) for (const run of runs) params.onRunOutcome(run);
      return runs;
    };

    const measured = await measureWithGate({
      sweepAll: async () => await sweep(params.scenarios),
      sweepTrain: async () => await sweep(trainScenarios),
      sweepHoldout: async () => await sweep(holdoutScenarios),
      partitionRuns: (runs) => partition(runs, trainIds),
      hasHoldout,
      gateAgainst,
      passRateTolerance: params.passRateTolerance,
    });
    if (measured.gateReason !== null && params.verbose) {
      console.error(`\nSkipped held-out runs: ${measured.gateReason}`);
    }

    const body = splitSkillMd(await Bun.file(`${dir}/SKILL.md`).text()).body;
    const inventory = await inventoryBundledFiles(dir, body, counter);
    return {
      dir,
      bodyTokens: counter.count(body),
      runs: [...measured.trainRuns, ...measured.holdoutRuns],
      train: measured.train,
      holdout: measured.holdout,
      gateReason: measured.gateReason,
      // Train runs only, as before. Pull rates drive the proposals, and the proposals are
      // made from what the train split showed; folding in held-out runs would let the
      // split that judges the answer also shape the question.
      files: computeFileStats(inventory, measured.trainRuns, params.inlineThreshold),
    };
  };

  try {
    // Null gate: the baseline runs both splits unconditionally. It is not competing for a
    // slot, it is the yardstick, and `selectCandidate` needs a held-out baseline score.
    baseline = await measure(params.skillPath, "baseline measurement", 1, null);
    current = baseline;
    iterations.push({
      iteration: 1,
      label: "baseline (as authored)",
      candidateId: null,
      rationale: `${baseline.files.length} bundled file(s), ${baseline.bodyTokens} body tokens`,
      bodyTokens: baseline.bodyTokens,
      train: baseline.train,
      holdout: baseline.holdout,
      accepted: true,
      note: "the layout every candidate is measured against",
    });
    publish();
    await persist(params.resultsDir, () =>
      buildOutput({ skillName, params, counter, iterations, baseline, current, trainScenarios, holdoutScenarios, exitReason: "in progress", appliedEdits, notes }),
    );
    if (params.verbose) printLayout("Baseline", baseline);
    // Said once, at the point it is still cheap to act on. Every pull rate below is
    // conditional on the body having reached context, so a run set where it mostly did
    // not is a measurement of almost nothing -- and the usual cause is a scenario prompt
    // the skill has no business answering rather than anything about the layout.
    if (baseline.train.runsWithoutSkill > 0 || (baseline.holdout?.runsWithoutSkill ?? 0) > 0) {
      const missed = baseline.train.runsWithoutSkill + (baseline.holdout?.runsWithoutSkill ?? 0);
      console.error(
        `Warning: the skill never loaded on ${missed} baseline run(s). Those runs are excluded ` +
          `from every pull rate, so the verdicts rest on less evidence than the run count suggests.`,
      );
    }

    exitReason = `max_iterations (${params.maxIterations})`;

    for (let iteration = 2; iteration <= params.maxIterations; iteration += 1) {
      const layout = current;
      // Unreachable in practice -- the baseline above assigns it -- but narrowing it here
      // beats a cast, because a cast would still compile the day someone reorders this.
      if (layout === null) break;
      const body = splitSkillMd(await Bun.file(`${layout.dir}/SKILL.md`).text()).body;
      const sections = bodySections(body, counter);
      const shortlist = shortlistExtractions(sections, params.minExtractTokens);

      reporter.update({ iteration, phase: "proposing restructures" });
      publish({ iteration, settled: 0, total: 0, phase: "proposing restructures", startedAt: Date.now() });
      const extractions = params.propose
        ? await proposeExtractions({
            skillName,
            body,
            shortlist,
            files: layout.files,
            scenarios: trainScenarios,
            model: params.model,
            logDir: params.logDir,
            iteration,
          })
        : [];

      const candidates = generateCandidates({
        files: layout.files,
        sections,
        extractions,
        maxCandidates: params.maxCandidates,
        alreadyTried,
      });
      if (candidates.length === 0) {
        exitReason = `no_candidates (iteration ${iteration})`;
        break;
      }

      const scored: (ScoredCandidate & { readonly dir: string; readonly layout: MeasuredLayout })[] = [];
      for (const [index, candidate] of candidates.entries()) {
        alreadyTried.add(candidate.id);
        const dir = `${params.workspaceDir}/iter-${iteration}/cand-${index + 1}/${skillName}`;
        const rewriteNotes = await materializeCandidate(layout.dir, dir, candidate);
        notes.push(...rewriteNotes);
        // Gated against the INCUMBENT's train score -- the layout this candidate has to
        // beat, which is the previous iteration's winner rather than the original
        // baseline. A candidate that loses to it on train stops here.
        const measured = await measure(
          dir,
          `iteration ${iteration}: ${candidate.summary}`,
          iteration,
          layout.train,
        );
        scored.push({
          candidate,
          bodyTokens: measured.bodyTokens,
          train: measured.train,
          holdout: measured.holdout,
          dir,
          layout: measured,
        });
      }

      // Only candidates with a held-out measurement go to selection. Handing a gated one
      // to `selectCandidate` would be actively wrong rather than merely wasteful: its
      // `holdout ?? train` fallback would score the candidate on the split that just
      // rejected it, so a layout retired on train could win the iteration.
      const contenders = scored.filter((entry) => entry.layout.gateReason === null);
      const baselineScore = layout.holdout ?? layout.train;
      const selection = selectCandidate({
        baseline: baselineScore,
        baselineBodyTokens: layout.bodyTokens,
        candidates: contenders,
        passRateTolerance: params.passRateTolerance,
      });
      // Gate reasons merged in alongside the held-out rejections so every rejected row in
      // the report says why in the same place, whichever split retired it.
      const rejectionById = new Map<string, string>([
        ...selection.rejected.map((entry): [string, string] => [entry.id, entry.reason]),
        ...scored
          .filter((entry) => entry.layout.gateReason !== null)
          .map((entry): [string, string] => [
            entry.candidate.id,
            entry.layout.gateReason as string,
          ]),
      ]);

      for (const entry of scored) {
        const won = selection.chosen?.candidate.id === entry.candidate.id;
        iterations.push({
          iteration,
          label: entry.candidate.summary,
          candidateId: entry.candidate.id,
          rationale: entry.candidate.rationale,
          bodyTokens: entry.bodyTokens,
          train: entry.train,
          holdout: entry.holdout,
          accepted: won,
          note: won
            ? selection.reason
            : (rejectionById.get(entry.candidate.id) ??
              "another candidate cut more context for the same pass rate"),
        });
      }

      publish();
      await persist(params.resultsDir, () =>
        buildOutput({ skillName, params, counter, iterations, baseline, current, trainScenarios, holdoutScenarios, exitReason: "in progress", appliedEdits, notes }),
      );

      if (selection.chosen === null) {
        // `selectCandidate` was handed an empty list when every candidate was gated, and
        // its message for that is "no candidate was proposed" -- which would be a lie
        // here, since three were proposed and three were measured on train.
        const reason =
          contenders.length === 0
            ? `all ${scored.length} candidate(s) regressed on the train split, so none ` +
              `earned a held-out measurement`
            : selection.reason;
        exitReason = `no_improvement (iteration ${iteration}): ${reason}`;
        if (params.verbose) console.error(`\n${reason}`);
        break;
      }

      const winner = scored.find((entry) => entry.candidate.id === selection.chosen?.candidate.id);
      if (winner === undefined) break;
      current = winner.layout;
      appliedEdits.push(winner.candidate.summary);
      if (params.verbose) printLayout(`Iteration ${iteration} — ${winner.candidate.summary}`, winner.layout);
    }
  } catch (error) {
    await reporter.finish("failed", error instanceof Error ? error.message : String(error));
    await reportChain;
    throw error;
  }

  publish();
  await reportChain;
  await reporter.finish("done");

  return buildOutput({
    skillName,
    params,
    counter,
    iterations,
    baseline,
    current,
    trainScenarios,
    holdoutScenarios,
    exitReason,
    appliedEdits,
    notes,
  });
}

function printLayout(label: string, layout: MeasuredLayout): void {
  const score = layout.holdout ?? layout.train;
  console.error(
    `\n${label}: ${layout.bodyTokens} body tokens, ` +
      `${Math.round(score.meanContextTokens)} context tokens/run, ` +
      `pass ${formatPercent(score.passRate, 0)} (${score.assertionsPassed}/${score.assertionsTotal})`,
  );
  for (const file of layout.files) {
    console.error(
      `  ${file.verdict.padEnd(9)} ${String(file.pulls).padStart(2)}/${file.countedRuns} ` +
        `${file.path} (${file.tokens} tokens${file.signposted ? "" : ", not signposted"})`,
    );
  }
}

interface BuildInput {
  readonly skillName: string;
  readonly params: OptimizeParams;
  readonly counter: TokenCounter;
  readonly iterations: readonly IterationRecord[];
  readonly baseline: MeasuredLayout | null;
  readonly current: MeasuredLayout | null;
  readonly trainSize: number;
  readonly holdoutSize: number;
  readonly exitReason: string;
  readonly appliedTo: string | null;
  readonly notes: readonly string[];
  readonly inProgress?: DisclosureProgress;
}

function buildReportInput(input: BuildInput): DisclosureReportInput {
  const baselineScore = input.baseline === null ? null : (input.baseline.holdout ?? input.baseline.train);
  const currentScore = input.current === null ? null : (input.current.holdout ?? input.current.train);
  return {
    skillName: input.skillName,
    skillPath: input.params.skillPath,
    tokenMethod: input.counter.method,
    estimatedTokens: input.counter.estimated,
    baselineBodyTokens: input.baseline?.bodyTokens ?? 0,
    bestBodyTokens: input.current?.bodyTokens ?? 0,
    baselineContextTokens: baselineScore?.meanContextTokens ?? 0,
    bestContextTokens: currentScore?.meanContextTokens ?? 0,
    holdoutFraction: input.params.holdout,
    trainSize: input.trainSize,
    holdoutSize: input.holdoutSize,
    runsPerScenario: input.params.runsPerScenario,
    files: input.current?.files ?? [],
    iterations: input.iterations,
    exitReason: input.exitReason,
    appliedTo: input.appliedTo,
    notes: input.notes,
    ...(input.inProgress === undefined ? {} : { inProgress: input.inProgress }),
  };
}

function buildOutput(input: {
  readonly skillName: string;
  readonly params: OptimizeParams;
  readonly counter: TokenCounter;
  readonly iterations: readonly IterationRecord[];
  readonly baseline: MeasuredLayout | null;
  readonly current: MeasuredLayout | null;
  readonly trainScenarios: readonly DisclosureScenario[];
  readonly holdoutScenarios: readonly DisclosureScenario[];
  readonly exitReason: string;
  readonly appliedEdits: readonly string[];
  readonly notes: readonly string[];
}): OptimizeOutput {
  const baselineScore = input.baseline === null ? null : (input.baseline.holdout ?? input.baseline.train);
  const currentScore = input.current === null ? null : (input.current.holdout ?? input.current.train);
  return {
    skill_name: input.skillName,
    skill_path: input.params.skillPath,
    exit_reason: input.exitReason,
    token_method: input.counter.method,
    tokens_are_estimated: input.counter.estimated,
    holdout: input.params.holdout,
    train_size: input.trainScenarios.length,
    holdout_size: input.holdoutScenarios.length,
    runs_per_scenario: input.params.runsPerScenario,
    baseline_body_tokens: input.baseline?.bodyTokens ?? 0,
    best_body_tokens: input.current?.bodyTokens ?? 0,
    baseline_context_tokens: baselineScore?.meanContextTokens ?? 0,
    best_context_tokens: currentScore?.meanContextTokens ?? 0,
    best_layout_path: input.current?.dir ?? input.params.skillPath,
    applied_edits: input.appliedEdits,
    files: input.current?.files ?? [],
    iterations: input.iterations,
    notes: input.notes,
  };
}

/**
 * Persist the loop's output so far, if a results directory was given.
 *
 * After every measured layout rather than once at the end, for the reason `optimize-description.ts`
 * gives: scored runs cost minutes of API time each, and a measurement that cannot survive
 * the next failure is not a measurement. Errors are swallowed -- a full disk must not kill
 * a run that is otherwise succeeding.
 */
async function persist(resultsDir: string | undefined, build: () => OptimizeOutput): Promise<void> {
  if (resultsDir === undefined) return;
  try {
    await Bun.write(`${resultsDir}/results.json`, `${JSON.stringify(build(), null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Warning: could not persist partial results (${message})`);
  }
}

// ---------------------------------------------------------------------------
// The results envelope
// ---------------------------------------------------------------------------

/**
 * One bundled file, in the envelope's row vocabulary.
 *
 * A distinct type from `FileStat` rather than a re-export of it, even though the two
 * currently carry nearly the same fields. `FileStat` is the loop's internal decision
 * record -- `generateCandidates` and `decideFileVerdict` read it, and it is free to grow a
 * field the day the decision rule needs one. This is a WIRE type: a reporting layer reads
 * it out of a file written weeks ago, so it moves only when someone decides it should.
 * Aliasing them would make every change to the decision rule a silent change to the
 * contract, which is the coupling the envelope exists to break.
 *
 * `bytes` is dropped for the same reason `optimize-description.ts` drops its aliased
 * columns: a reader wants the token cost, and a byte count is a different number that
 * looks like the same one.
 */
export interface DisclosureRow {
  /** Skill-relative, POSIX separators. */
  readonly path: string;
  readonly loadMode: LoadMode;
  /** What this file costs the run that reads it, under `provenance.tokenizer`. */
  readonly tokens: number;
  readonly pulls: number;
  /**
   * The denominator: runs that produced a measurement AND loaded the skill.
   *
   * Not the run count and not `provenance.scored`. A run where the body never reached
   * context never had the chance to follow a pointer, so counting it here would report a
   * low pull rate for a reference that is in fact pulled every time.
   */
  readonly countedRuns: number;
  readonly pullRate: number;
  /** Whether the body names this file at all. A `signpost` verdict turns on it. */
  readonly signposted: boolean;
  readonly verdict: FileVerdict;
}

/**
 * What became of one scenario run, from the rates' point of view.
 *
 * Four outcomes rather than the trigger harness's four attempt outcomes, and they do not
 * line up, which is the point of naming them separately. There, every outcome lands IN the
 * numbers. Here two of the four are dropped, and `unloaded` is dropped from only some of
 * them -- it counts toward the pass rate and the context-token mean, because the run
 * genuinely happened and genuinely cost that much, and away from every pull rate, because
 * a run that never opened SKILL.md could not have followed a pointer.
 */
export type DisclosureRunOutcome = "measured" | "unloaded" | "timeout" | "error";

/**
 * Sort one run into its outcome.
 *
 * Timeouts are separated from other failures by the error's opening words rather than by a
 * field, because {@link TIMEOUT_ERROR_PREFIX} is the only marker a `ScenarioRun` carries --
 * see that constant for why the shape is not widened. The distinction earns its keep: a
 * sweep whose failures are all timeouts wants a bigger `--timeout`, and one whose failures
 * are spawn errors wants a look at the machine, and `failed: 6` cannot tell you which.
 */
export function classifyRun(run: ScenarioRun): DisclosureRunOutcome {
  if (run.error !== undefined) {
    return run.error.startsWith(TIMEOUT_ERROR_PREFIX) ? "timeout" : "error";
  }
  return run.skillLoaded ? "measured" : "unloaded";
}

/** Running counts of how scenario runs ended, for `provenance`. */
export interface RunTally {
  /** Error-free and the body reached context. In every number this operation reports. */
  readonly measured: number;
  /** Error-free but the body never loaded. In the pass rate, out of every pull rate. */
  readonly unloaded: number;
  readonly timeout: number;
  readonly error: number;
}

/**
 * A tally an `onRunOutcome` callback can be pointed straight at.
 *
 * Here rather than at the call site for the reason `createAttemptTally` gives: two
 * hand-rolled counters that disagree about whether an unloaded run counts would make two
 * envelopes incomparable for a reason that has nothing to do with the measurement. It also
 * means the counting rule is exercised by the suite instead of only by an hour of API time.
 */
export function createRunTally(): {
  readonly record: (run: ScenarioRun) => void;
  readonly snapshot: () => RunTally;
} {
  const counts = { measured: 0, unloaded: 0, timeout: 0, error: 0 };
  return {
    record: (run) => {
      counts[classifyRun(run)] += 1;
    },
    snapshot: () => ({ ...counts }),
  };
}

export interface DisclosureEnvelopeInput {
  readonly output: OptimizeOutput;
  readonly tally: RunTally;
  /**
   * Scenario runs the loop budgeted, worst case.
   *
   * The same upper bound `optimizeDisclosure` reports progress against. Two things finish
   * short of it -- a gated candidate never runs its held-out scenarios, and the loop exits
   * when nothing improves -- and the gap is a cap on coverage rather than a rounding error.
   */
  readonly plannedRuns: number;
  readonly model: string | null;
  readonly graderModel: string;
  readonly workers: number;
  readonly timeoutSeconds: number;
  readonly maxIterations: number;
  readonly maxCandidates: number;
  readonly inlineThreshold: number;
  readonly scenarioSetHash: string;
  readonly targetSha: string;
  readonly installState: InstallState;
  /**
   * The conflict sentence from `installConflict`, or null.
   *
   * Passed in rather than recomputed so the builder stays pure, and kept SEPARATE from
   * `caps` so it can be put first and given a verdict of its own. See the builder.
   */
  readonly installConflict?: string | null;
  /** Extra coverage caveats from the caller -- install sightings, an unpinned model. */
  readonly caps?: readonly string[];
  readonly startedAt?: Date;
}

/** The one-sentence justification behind a file's verdict, in the verdict's own terms. */
function verdictReason(row: DisclosureRow, inlineThreshold: number): string {
  const seen = `read on ${row.pulls}/${row.countedRuns} run(s)`;
  const rate = `${(row.pullRate * 100).toFixed(0)}%`;
  switch (row.verdict) {
    case "inline":
      return (
        `${seen} (${rate}), at or above the ${inlineThreshold} inline threshold — this is ` +
        `body content paying an extra tool call for the privilege of arriving late.`
      );
    case "prune":
      return (
        `${seen}, although the body points straight at it. The pointer works and nothing ` +
        `needed the file, so deleting it is a hypothesis the next iteration can test.`
      );
    case "signpost":
      return (
        `${seen}, and nothing in the body names it, so it could never have loaded. The ` +
        `pull rate says nothing about its value yet — the fix is a sentence, not a deletion.`
      );
    case "misfiled":
      return (
        `a \`${row.loadMode}\`-mode file was ${seen}. Scripts are called and assets are ` +
        `copied, so either the body asks for the wrong verb or the file sits in the wrong ` +
        `directory.`
      );
    default:
      if (row.countedRuns === 0) {
        return (
          `no run produced a measurement, so nothing is concluded about this file. A ` +
          `restructure justified by no evidence is the most expensive kind of wrong.`
        );
      }
      // Zero pulls and a `keep` verdict can only mean a load mode whose files are not
      // supposed to be read: `decideFileVerdict` sends an unread READ-mode file to `prune`
      // or `signpost` and never here. Derived from the rule rather than by re-testing the
      // load mode against a copy of `READ_MODES`, which would be a second list to keep in
      // step -- and which would have quietly mishandled a root-level file read on some
      // runs, since `root` is a read mode and does not look like one.
      if (row.pulls === 0) {
        return (
          `a \`${row.loadMode}\`-mode file that no run read, which is what a working ` +
          `\`${row.loadMode}\` file looks like — its text is never meant to enter context.`
        );
      }
      return (
        `${seen} (${rate}), between never and always — genuinely conditional content, ` +
        `which is what deferral is for.`
      );
  }
}

/**
 * Build the envelope for one disclosure sweep.
 *
 * Pure and exported, for the reason `buildTriggeringEnvelope` gives: every judgement here
 * is about how the measurement will be read, and a judgement reachable only by spending an
 * hour of API time is a judgement with no coverage.
 *
 * THE TIMEOUT POLICY IS `excluded`, AND IT IS THE OPPOSITE OF THE TRIGGER HARNESS'S
 * ------------------------------------------------------------------------------
 * `lib/disclosure.ts` `scoreRuns` filters `run.error === undefined`, so a timed-out run is
 * dropped from every rate here, where `measure-triggering.ts` SCORES a timed-out query as
 * a non-trigger. Both stay as they are. A run that never finished says nothing about
 * whether its scenario needed a reference, and treating that silence as evidence of
 * absence would push the loop toward deleting files whose only crime was being needed by a
 * slow scenario. What is new is that the envelope SAYS which policy produced its numbers,
 * and reports `excluded` and `failed` beside each other, so a reader comparing a pull rate
 * against a trigger rate can see that the same failure count landed on opposite sides of
 * the line instead of having to infer it from two source files.
 */
export function buildDisclosureEnvelope(
  input: DisclosureEnvelopeInput,
): Envelope<DisclosureRow> {
  const output = input.output;

  const rows: DisclosureRow[] = output.files.map((file) => ({
    path: file.path,
    loadMode: file.loadMode,
    tokens: file.tokens,
    pulls: file.pulls,
    countedRuns: file.countedRuns,
    pullRate: file.pullRate,
    signposted: file.signposted,
    verdict: file.verdict,
  }));

  // The layout the run ENDED on, found by walking the iteration records rather than by
  // re-deciding anything. The baseline is recorded `accepted: true` and so is each
  // iteration's winner, so the last accepted record is the layout whose files are in
  // `rows` -- and reimplementing the selection rule here would be free to disagree with
  // the `best_layout_path` the same file just wrote.
  const accepted = output.iterations.filter((record) => record.accepted);
  const selected = accepted[accepted.length - 1];
  const baselineRecord = output.iterations[0];
  const selectedScore = selected === undefined ? null : (selected.holdout ?? selected.train);
  const iterationsRun =
    output.iterations.length === 0
      ? 0
      : Math.max(...output.iterations.map((record) => record.iteration));

  const runsSpent =
    input.tally.measured + input.tally.unloaded + input.tally.timeout + input.tally.error;
  const excluded = input.tally.timeout + input.tally.error;

  // Deltas ARE legitimate here, for the reason `optimize-description.ts` sets out: both
  // numbers come from inside one run under one `run` block -- same model, same workers,
  // same timeout, same scenario set, same install state -- so the only thing that changed
  // between them is the layout, which is the variable under test. A delta against a
  // DIFFERENT run still has to go through `compareRuns` first.
  const bodyDelta = output.best_body_tokens - output.baseline_body_tokens;
  const contextDelta = output.best_context_tokens - output.baseline_context_tokens;
  const headline: HeadlineMetric[] = [
    {
      label: "body tokens",
      value: output.best_body_tokens,
      unit: "tokens",
      ...(bodyDelta === 0 ? {} : { delta: bodyDelta }),
    },
    {
      label: "context tokens per run",
      value: output.best_context_tokens,
      unit: "tokens",
      ...(contextDelta === 0 ? {} : { delta: contextDelta }),
    },
  ];
  // Omitted rather than reported as 1 when nothing was asserted. `scoreRuns` returns a
  // pass rate of 1 for a scenario set carrying no expectations, which is a true statement
  // about zero assertions and reads on a dashboard as a perfect score.
  if (selectedScore !== null && selectedScore.assertionsTotal > 0) {
    headline.push({
      label: "assertion pass rate",
      value: selectedScore.passRate,
      unit: "fraction",
      ...(baselineRecord === undefined || selected === baselineRecord
        ? {}
        : {
            delta:
              selectedScore.passRate -
              (baselineRecord.holdout ?? baselineRecord.train).passRate,
          }),
    });
  }
  headline.push({ label: "bundled files measured", value: rows.length, unit: "files" });
  headline.push({ label: "iterations run", value: iterationsRun, unit: "iterations" });

  // The conflict goes FIRST, before the caller's own caps and before every mechanical one
  // below. It is not a caveat about coverage like the rest of this list -- it is the
  // sentence that says the table underneath it means nothing, and a reader who stops after
  // the first line of `caps` has to have read it.
  const caps: string[] = [];
  if (input.installConflict !== undefined && input.installConflict !== null) {
    caps.push(input.installConflict);
  }
  caps.push(...(input.caps ?? []));

  if (output.tokens_are_estimated) {
    caps.push(
      `Token figures are ESTIMATES from the characters-over-four rule of thumb — ` +
        `\`tiktoken\` was not available, so \`${output.token_method}\` produced every count ` +
        `in \`rows\` and in \`headline\`. A body measured at 4,800 estimated tokens against ` +
        `a 5,000-token budget has not been shown to be inside it.`,
    );
  }

  caps.push(
    `The loop was allowed at most ${input.maxIterations} iteration(s) ` +
      `(\`--max-iterations\`) and ran ${iterationsRun}; it stopped for: ${output.exit_reason}.`,
  );
  caps.push(
    `At most ${input.maxCandidates} candidate layout(s) were measured per iteration ` +
      `(\`--max-candidates\`). The generator orders candidates by how much unconditional ` +
      `cost they could remove, so anything past the ${input.maxCandidates}th was never ` +
      `measured — a cheaper layout may exist and was not looked at.`,
  );
  caps.push(
    `Each scenario was run ${output.runs_per_scenario} time(s) per layout ` +
      `(\`--runs-per-scenario\`), so every pull rate in \`rows\` rests on at most that many ` +
      `runs per scenario. A rate from a single run is a boolean wearing a percentage sign.`,
  );

  // The split is a cap on the ROWS specifically, and it is the one most easily missed:
  // `computeFileStats` is handed the train runs alone, so a reference that only the
  // held-out scenarios needed shows a pull rate of zero and a verdict to match.
  if (output.holdout_size > 0) {
    caps.push(
      `${output.holdout_size} of ${output.train_size + output.holdout_size} scenario(s) ` +
        `were held out for selection (\`--holdout ${output.holdout}\`). Pull rates and ` +
        `verdicts in \`rows\` are computed over the ${output.train_size} TRAIN scenario(s) ` +
        `only, so a file needed exclusively by a held-out scenario reads as never pulled.`,
    );
  } else {
    caps.push(
      `No scenarios were held out (\`--holdout ${output.holdout}\`), so the winning layout ` +
        `was selected on the same scenarios that proposed it. Every figure above is a ` +
        `training score and will be optimistic.`,
    );
  }

  if (excluded > 0) {
    caps.push(
      `${excluded} run(s) were EXCLUDED from every rate above — ${input.tally.timeout} hit ` +
        `the ${input.timeoutSeconds}s budget and ${input.tally.error} failed outright. That ` +
        `is this operation's timeout policy and not a bug: a run that never finished says ` +
        `nothing about whether its scenario needed a reference. Note that ` +
        `\`measure-triggering\` does the opposite and SCORES a timeout, so its \`failed\` ` +
        `count is inside its rates and this one is not.`,
    );
  }
  if (input.tally.unloaded > 0) {
    caps.push(
      `${input.tally.unloaded} run(s) completed without the skill body ever reaching ` +
        `context. They are counted in \`provenance.scored\` because they cost what they ` +
        `cost and their assertions were graded, but they are dropped from every pull rate ` +
        `in \`rows\` — a run that never opened SKILL.md could not have followed a pointer.`,
    );
  }
  const unspent = input.plannedRuns - runsSpent;
  if (unspent > 0) {
    caps.push(
      `${unspent} of ${input.plannedRuns} planned run(s) went unspent: a candidate that ` +
        `loses on the train split never earns its held-out runs, and the loop stops early ` +
        `when nothing improves. That is a saving rather than a gap, but the sweep looked at ` +
        `less than the budget implies.`,
    );
  }
  // Two denominators, said out loud. `scored` is every run the loop spent across every
  // layout it tried; `countedRuns` in each row is the selected layout's train runs alone.
  // They are different numbers on purpose and a reader dividing one by the other gets
  // nonsense.
  caps.push(
    `\`provenance.scored\` counts every run the loop spent across all ${iterationsRun} ` +
      `iteration(s) and every candidate it measured. The rows describe the SELECTED layout ` +
      `only, over the runs in their own \`countedRuns\` — the two denominators are not the ` +
      `same and are not meant to be.`,
  );
  if (selectedScore !== null && selectedScore.assertionsTotal === 0) {
    caps.push(
      `No scenario carried expectations, so the pass-rate guardrail could not fire. The ` +
        `loop optimized context cost with nothing checking that the skill still works.`,
    );
  }

  const verdicts: Verdict[] = rows.map((row) => ({
    subject: row.path,
    verdict: row.verdict,
    reason: verdictReason(row, input.inlineThreshold),
  }));
  // The conflict earns a verdict of its own, whose SUBJECT is the skill rather than a file.
  // Loud on purpose, and in three places on purpose: a consumer that renders only
  // `verdicts` still sees it, a consumer that renders only `caps` sees it first, and the
  // CLI prints it to stderr. The alternative -- one line in a list of coverage caveats --
  // is exactly how a sweep whose every pull rate is floored at zero gets read as a skill
  // with nothing worth deferring.
  if (input.installConflict !== undefined && input.installConflict !== null) {
    verdicts.unshift({
      subject: output.skill_name,
      verdict: "unsound",
      reason: input.installConflict,
    });
  }

  const tokenizer: TokenizerKind = output.tokens_are_estimated ? "estimated" : "tiktoken";

  return buildEnvelope<DisclosureRow>({
    run: {
      ...(input.startedAt === undefined ? {} : { startedAt: input.startedAt }),
      // Not a parameter. This operation measures skills and only skills -- it requires a
      // SKILL.md, a body to split and a bundled-file tree to inventory, none of which an
      // agent or a flat command has -- so an `artifact` input would be a knob with exactly
      // one correct setting and one way to be wrong.
      artifact: "skill",
      target: output.skill_name,
      operation: "optimize-disclosure",
      model: input.model,
      // The first producer with a real grader. Disclosure grades every run's assertions
      // with a second call on a DIFFERENT model from the one that did the work, so
      // recording only `model` would hide half of what decided the guardrail.
      graderModel: input.graderModel,
      workers: input.workers,
      runsPer: output.runs_per_scenario,
      timeoutSeconds: input.timeoutSeconds,
      // The scenario set is this operation's question set, so it is what `evalSetHash`
      // names. Hashed from the PARSED scenarios, so reindenting the file does not make two
      // runs look incomparable while editing a prompt correctly does.
      evalSetHash: input.scenarioSetHash,
      targetSha: input.targetSha,
      installState: input.installState,
    },
    provenance: {
      // Not recomputed. `lib/disclosure.ts` already decides this once per run by trying to
      // load `tiktoken` and falling back, and it carries the answer through to the report's
      // estimate warning; asking a second time could get a second answer.
      tokenizer,
      unit: "scenario run",
      // Everything that produced a measurement, including the runs where the body never
      // loaded -- they are in the pass rate and the context-token mean. The narrower
      // denominator the pull rates use is each row's own `countedRuns`, and the cap above
      // says so.
      scored: input.tally.measured + input.tally.unloaded,
      // Dropped from the denominators entirely. `excluded` and `failed` are the same set
      // for this operation, and reporting both anyway is the point: under
      // `timeoutPolicy: "excluded"` they coincide, and under `"scored"` they do not.
      excluded,
      failed: excluded,
      timeoutPolicy: "excluded",
      caps,
    },
    headline,
    rows,
    verdicts,
  });
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/** Duplicated from `optimize-description.ts`, which does not export it and is not ours to edit. */
function tempDir(): string {
  const configured = Bun.env.TMPDIR ?? Bun.env.TMP ?? Bun.env.TEMP;
  return configured === undefined || configured === "" ? tmpdir() : configured.replace(/\/+$/, "");
}

function baseName(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const slash = trimmed.lastIndexOf("/");
  return slash === -1 ? trimmed : trimmed.slice(slash + 1);
}

/** Local-time `YYYY{sep}MM{sep}DD_HHMMSS`, matching what the description loop writes. */
function timestamp(dateSeparator: string): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  const now = new Date();
  const date = [now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate())].join(dateSeparator);
  return `${date}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

const USAGE =
  "Usage: bun shared/scripts/optimize-disclosure.ts --skill-path <path> --scenarios <path> [options]\n\n" +
  "Measures what a skill costs to invoke — body tokens paid on every run, which bundled\n" +
  "files actually get read, total context tokens, and the assertion pass rate — then\n" +
  "restructures the layout to cut the cost and re-measures. Candidates are selected on a\n" +
  "held-out split, and one that breaks the work is rejected however cheap it is.\n\n" +
  "Budget, worst case: one baseline sweep plus (--max-iterations - 1) x --max-candidates\n" +
  "sweeps, each of --scenarios x --runs-per-scenario runs, and each run does the skill's\n" +
  "real work. Usually less — a candidate is measured on the train scenarios first, and\n" +
  "only one still in contention there is measured on the held-out scenarios, so at the\n" +
  "default --holdout 0.4 a losing candidate costs three fifths of a sweep.\n\n" +
  "Each run makes two calls: the scenario itself on --model, then a grader on\n" +
  "--grader-model, which defaults to a small fast model rather than inheriting --model.";

/**
 * The flag spec, exported so the defaults are reachable from the suite.
 *
 * A default is a decision -- which model grades, how many workers, how long a run may
 * hang -- and one buried in a literal inside `main` can only be checked by running the
 * CLI. `measure-triggering.ts` exports `SHARED_EVAL_FLAGS` for the same reason.
 */
export const OPTIMIZE_FLAGS: Spec = {
  "skill-path": { kind: "string", help: "Path to the skill directory to optimize" },
  scenarios: {
    kind: "string",
    help: "Path to scenarios JSON: evals.json, or an array of {id, prompt, expectations}",
  },
  model: {
    kind: "string",
    help: "Model for the scenario runs and the proposal step (NOT the grader)",
  },
  // Its own flag, and a small model by default, because the grader is the one call
  // here that needs no capability: single-turn, transcript already in the prompt,
  // fixed-shape JSON out. Inheriting --model made every scenario pay for the heavy
  // model twice -- once to do the work and once, serially in the same worker slot, to
  // have it marked. The guardrail is a comparison against a baseline graded by this
  // same model, so a different grader moves both numbers and not the gap between them.
  // The proposal step deliberately keeps --model: judging which body sections a
  // minority of runs need is exactly the kind of call a small model gets wrong.
  "grader-model": {
    kind: "string",
    default: DEFAULT_GRADER_MODEL,
    help: "Model that grades assertions — measured against --model, not assumed cheaper",
  },
  // Off by default because it cannot work everywhere: bare mode reads auth strictly from
  // ANTHROPIC_API_KEY, an apiKeyHelper via --settings, or a third-party provider's own
  // credentials, and never from OAuth or the keychain. Defaulting it on would break every
  // grade for anyone authenticated by login, and break it as a guardrail failure rather
  // than as an auth error. `callClaude` probes once and latches off, so the wrong guess
  // costs one call.
  "grader-bare": {
    kind: "boolean",
    default: false,
    help: "Run grader calls with --bare (needs ANTHROPIC_API_KEY or a 3P provider)",
  },
  holdout: {
    kind: "number",
    default: 0.4,
    help: "Fraction of scenarios held out for selection (0 to disable)",
  },
  "max-iterations": {
    kind: "number",
    default: DEFAULT_MAX_ITERATIONS,
    help: "Restructure iterations, baseline included",
  },
  "max-candidates": {
    kind: "number",
    default: DEFAULT_MAX_CANDIDATES,
    help: "Candidate layouts measured per iteration",
  },
  "runs-per-scenario": {
    kind: "number",
    default: DEFAULT_RUNS_PER_SCENARIO,
    help: "Runs per scenario per layout",
  },
  "num-workers": {
    kind: "number",
    default: DEFAULT_NUM_WORKERS,
    help: "Concurrent scenario runs",
  },
  timeout: {
    kind: "number",
    default: DEFAULT_TIMEOUT_SECONDS,
    help: "Per-run wall clock in seconds",
  },
  "inline-threshold": {
    kind: "number",
    default: DEFAULT_INLINE_THRESHOLD,
    help: "Pull rate at or above which a reference is proposed for inlining",
  },
  "pass-rate-tolerance": {
    kind: "number",
    default: DEFAULT_PASS_RATE_TOLERANCE,
    help: "How far the pass rate may fall before a candidate is rejected",
  },
  "min-extract-tokens": {
    kind: "number",
    default: DEFAULT_MIN_EXTRACT_TOKENS,
    help: "Smallest body section worth proposing for extraction",
  },
  "permission-mode": {
    kind: "string",
    help: "Passed to claude -p; use acceptEdits for scenarios that write files",
  },
  "no-propose": {
    kind: "boolean",
    default: false,
    help: "Skip the model step that proposes body sections to push out",
  },
  apply: {
    kind: "string",
    help: "Copy the selected layout here when the loop finishes (never edits the source)",
  },
  report: {
    kind: "string",
    default: "auto",
    help: "Write the HTML report here ('auto' for a temp file, 'none' to disable)",
  },
  "results-dir": {
    kind: "string",
    help: "Save results.json, report.html and per-run logs under a timestamped subdirectory",
  },
  // Additive, and opt-in only in WHERE it lands. `results.json` keeps its exact shape --
  // tests and `../references/schemas.md` assert on it -- and the envelope is a second file
  // beside it carrying the conditions the run was produced under, which `results.json` has
  // never had room for. A caller with no `--results-dir` gets no envelope unless they name
  // a path, matching how the other two producers behave.
  envelope: {
    kind: "string",
    help: `Also write the results envelope here (default: <results-dir>/${ENVELOPE_FILENAME})`,
  },
  verbose: { kind: "boolean", default: false, help: "Print per-file verdicts to stderr" },
  help: { kind: "boolean", short: "h", help: "Show this message" },
};

/**
 * Whether copying the selected layout to `applyTo` would destroy the source skill.
 *
 * `--apply` is destructive by construction: the target is `rm -rf`ed before the layout is
 * copied into it, so a target that overlaps the source deletes the artifact under test.
 * `--apply skills/skill-creator` removed the source; `--apply skills` removed every skill
 * in the repository.
 *
 * Overlap is tested in BOTH directions on RESOLVED ABSOLUTE paths. Both directions because
 * a target containing the source destroys it wholesale and a target inside the source
 * destroys part of it, and the documented invariant -- the source is never written to --
 * has to hold for both. Resolved because `skills/skill-creator`, `./skills/skill-creator`,
 * `skills/skill-creator/` and the absolute spelling are one directory that a string compare
 * reads as four.
 *
 * A genuine output directory is neither inside the skill nor above it, so the normal case
 * -- the default `<results-dir>/best-layout` -- is untouched by this.
 */
export function applyTargetCollidesWithSource(applyTo: string, skillPath: string): boolean {
  const target = resolve(applyTo);
  const source = resolve(skillPath);
  if (target === source) return true;
  // Trailing separator so `/a/bc` is not read as living inside `/a/b`. `resolve` only ever
  // returns a trailing slash for the filesystem root, where the guard still has to hold.
  const contains = (parent: string, child: string): boolean =>
    child.startsWith(parent.endsWith("/") ? parent : `${parent}/`);
  return contains(target, source) || contains(source, target);
}

async function main(): Promise<void> {
  const { flags } = parseCli(OPTIMIZE_FLAGS, USAGE);

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

  const resultsRoot = flagString(flags, "results-dir");
  const resultsDir = resultsRoot === undefined ? undefined : `${resultsRoot}/${timestamp("-")}`;

  // Resolved and checked HERE, before the loop spends a single model call. The copy happens
  // at the end of the run, but an operator who mistyped `--apply` should learn that now
  // rather than after paying for a full sweep.
  const applyTo =
    flagString(flags, "apply") ?? (resultsDir === undefined ? undefined : `${resultsDir}/best-layout`);
  if (applyTo !== undefined && applyTargetCollidesWithSource(applyTo, skillPath)) {
    console.error(
      `Error: --apply ${applyTo} resolves to ${resolve(applyTo)}, which overlaps the source ` +
        `skill at ${resolve(skillPath)}. The apply target is deleted before the selected ` +
        `layout is copied into it, so this would destroy the artifact under test. Name a ` +
        `directory outside the skill.`,
    );
    process.exit(1);
  }

  const report = flagString(flags, "report") ?? "auto";
  let liveReportPath: string | undefined;
  if (report !== "none") {
    liveReportPath =
      report === "auto"
        ? `${tempDir()}/skill_disclosure_report_${baseName(skillPath)}_${timestamp("")}.html`
        : report;
    await Bun.write(
      liveReportPath,
      "<html><body><h1>Measuring the current layout…</h1><meta http-equiv='refresh' content='5'></body></html>",
    );
    openInBrowser(liveReportPath);
  }

  await ensureDashboard();

  // Candidate layouts live outside the repository. They are throwaway copies of a skill,
  // and a workspace inside the repo would be one `git add -A` away from committing three
  // half-restructured duplicates of the artifact under test.
  const workspaceDir = `${tempDir()}/skill-disclosure-${baseName(skillPath)}-${timestamp("")}`;

  // Process-wide rather than a param: every helper call wants the same answer, and the
  // latch in `callClaude` has to survive across calls to be worth having.
  setGraderBare(flagBoolean(flags, "grader-bare"));

  const maxIterations = flagNumber(flags, "max-iterations");
  const maxCandidates = flagNumber(flags, "max-candidates");
  const runsPerScenario = flagNumber(flags, "runs-per-scenario");
  const numWorkers = flagNumber(flags, "num-workers");
  const timeoutSeconds = flagNumber(flags, "timeout");
  const inlineThreshold = flagNumber(flags, "inline-threshold");
  // `flagString` reads an empty string as absent, so `--grader-model ""` falls back to
  // the default rather than passing `--model ""` down to a `claude` invocation.
  const graderModel = flagString(flags, "grader-model") ?? DEFAULT_GRADER_MODEL;
  const tally = createRunTally();

  const output = await optimizeDisclosure({
    skillPath,
    scenarios,
    holdout: flagNumber(flags, "holdout"),
    maxIterations,
    maxCandidates,
    runsPerScenario,
    numWorkers,
    timeoutSeconds,
    inlineThreshold,
    passRateTolerance: flagNumber(flags, "pass-rate-tolerance"),
    minExtractTokens: flagNumber(flags, "min-extract-tokens"),
    propose: !flagBoolean(flags, "no-propose"),
    model: flagString(flags, "model"),
    graderModel,
    permissionMode: flagString(flags, "permission-mode"),
    workspaceDir,
    verbose: flagBoolean(flags, "verbose"),
    liveReportPath,
    resultsDir,
    logDir: resultsDir === undefined ? undefined : `${resultsDir}/logs`,
    onRunOutcome: tally.record,
  });

  // The selected layout is COPIED to wherever the operator asked for it, and `--apply` was
  // refused up front if that target overlaps the source skill in either direction. So the
  // source is never written to, and adopting the result stays a deliberate act -- a diff
  // someone reads -- rather than something that already happened while they watched a bar.
  let appliedTo: string | null = null;
  if (applyTo !== undefined && output.best_layout_path !== skillPath) {
    await rm(applyTo, { recursive: true, force: true });
    await cp(output.best_layout_path, applyTo, { recursive: true });
    appliedTo = applyTo;
  }

  const json = JSON.stringify({ ...output, applied_to: appliedTo }, null, 2);
  console.log(json);
  if (resultsDir !== undefined) await Bun.write(`${resultsDir}/results.json`, `${json}\n`);

  const finalReport = generateDisclosureReport(
    {
      skillName: output.skill_name,
      skillPath: output.skill_path,
      tokenMethod: output.token_method as DisclosureReportInput["tokenMethod"],
      estimatedTokens: output.tokens_are_estimated,
      baselineBodyTokens: output.baseline_body_tokens,
      bestBodyTokens: output.best_body_tokens,
      baselineContextTokens: output.baseline_context_tokens,
      bestContextTokens: output.best_context_tokens,
      holdoutFraction: output.holdout,
      trainSize: output.train_size,
      holdoutSize: output.holdout_size,
      runsPerScenario: output.runs_per_scenario,
      files: output.files,
      iterations: output.iterations,
      exitReason: output.exit_reason,
      appliedTo,
      notes: output.notes,
    },
    { autoRefresh: false },
  );
  if (liveReportPath !== undefined) {
    await Bun.write(liveReportPath, finalReport);
    console.error(`\nReport: ${liveReportPath}`);
  }
  if (resultsDir !== undefined) {
    await Bun.write(`${resultsDir}/report.html`, finalReport);
    console.error(`Results saved to: ${resultsDir}`);
  }
  if (appliedTo !== null) console.error(`Selected layout written to: ${appliedTo}`);

  const envelopePath =
    flagString(flags, "envelope") ??
    (resultsDir === undefined ? undefined : `${resultsDir}/${ENVELOPE_FILENAME}`);
  if (envelopePath !== undefined) {
    // Every scenario run installs its own aliased copy of the layout into a throwaway
    // project root and runs with `--setting-sources project`, so the run is designed to
    // keep the machine out of the measurement. What `detectInstallState` records is the
    // MACHINE's state anyway, and for THIS operation that is the most consequential field
    // in the block: content served to the model through the skill system never produces a
    // `Read`, so a sweep that reached an installed copy instead of the layout under test
    // scores every bundled file at a pull rate of zero. The output is a clean-looking
    // table of `prune` and `signpost` verdicts, and it is a measurement of nothing.
    const sighting = await detectInstallState({
      artifact: "skill",
      name: output.skill_name,
      sourcePath: skillPath,
    });
    const conflict = installConflict({
      operation: "optimize-disclosure",
      needs: "absent",
      found: sighting.state,
    });
    // A run that did not pin `--model` was answered by whatever the operator had
    // configured, and this script cannot find out what that was. Recording `null` and
    // saying so is the only honest option; inventing a name would make two runs on
    // different machines look comparable, which is what the run block exists to prevent.
    const model = flagString(flags, "model") ?? null;
    const unpinned =
      model === null
        ? "No `--model` was pinned, so the scenario runs and the proposal step were " +
          "answered by the operator's configured default and the model is not recorded. " +
          "Runs made this way are not comparable across machines even though their " +
          "`run.model` fields match."
        : null;

    await writeEnvelope(
      envelopePath,
      buildDisclosureEnvelope({
        output,
        tally: tally.snapshot(),
        // The same upper bound the progress bar counts against, computed the same way.
        plannedRuns:
          (1 + Math.max(0, maxIterations - 1) * maxCandidates) *
          scenarios.length *
          runsPerScenario,
        model,
        graderModel,
        workers: numWorkers,
        timeoutSeconds,
        maxIterations,
        maxCandidates,
        inlineThreshold,
        scenarioSetHash: hashJsonValue(scenarios),
        targetSha: await hashArtifact(skillPath),
        installState: sighting.state,
        installConflict: conflict,
        caps: [sighting.cap, unpinned].filter((cap): cap is string => cap !== null),
      }),
    );
    console.error(`Envelope written to: ${envelopePath}`);
    // Third of the three places the conflict appears, and the only one an operator sees
    // without opening a file. A sweep against an installed copy produces a report that
    // looks fine, so the moment to say so is now rather than when someone acts on it.
    if (conflict !== null) console.error(`\nWARNING: ${conflict}`);
  }

  // Named rather than silently left behind. Every candidate layout the loop measured is
  // still in there, which is what you want when a rejection needs explaining and is
  // otherwise a directory nobody knows to delete.
  if (output.iterations.length > 1) console.error(`Candidate layouts kept in: ${workspaceDir}`);
  if (output.tokens_are_estimated) {
    console.error(
      "\nNote: token counts are ESTIMATES (characters over four). Install `tiktoken` for " +
        "real counts before reading a body budget literally.",
    );
  }
}

if (import.meta.main) await main();
