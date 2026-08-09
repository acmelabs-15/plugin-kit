#!/usr/bin/env bun
/**
 * Run trigger evaluation for a skill, subagent or slash-command description.
 *
 * Tests whether a description causes Claude to reach for the artifact -- consult
 * the skill, delegate to the agent -- for a set of queries. Outputs results as JSON.
 *
 * Port of run_eval.py. Field names in the emitted JSON stay snake_case because
 * they are the wire contract shared with the report generator and with any eval
 * artifacts produced by the Python era. `skill_name` keeps its name for the same
 * reason even when the artifact under test is an agent: renaming the field would
 * break every reader of an existing results file to gain nothing measurable.
 */

import { cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

import { ensureDashboard } from "./lib/browser.ts";
import { CliError, formatHelp, parseArgs, type ParsedArgs, type Spec } from "./lib/cli.ts";
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
} from "./lib/envelope.ts";
import { parseFrontmatterBlock } from "../rules/lib.ts";
import { FrontmatterError, parseFrontmatter, skillMdPath, type ParsedSkill } from "./lib/frontmatter.ts";
import { mapWithConcurrency } from "./lib/pool.ts";
import { ProgressReporter, type QueryProgress } from "./lib/progress.ts";
import { runStreamingLines } from "./lib/subprocess.ts";

/**
 * Which kind of artifact is under test.
 *
 * The three differ in exactly two places -- where a copy has to be installed for
 * the router to see it, and which tool call counts as the router reaching for it.
 * Everything else in this harness (the before-first-mutation window, the unique
 * alias, the scoring) is shared, because the reasoning behind those is about how
 * a routing decision unfolds rather than about what is being routed to.
 *
 * `command` is not a typo for `skill`. Slash commands and skills have merged in
 * Claude Code: `.claude/commands/deploy.md` and `.claude/skills/deploy/SKILL.md`
 * both produce `/deploy`, with the same frontmatter and the same behaviour. So a
 * command's trigger signal IS a skill's, and the only thing the harness has to do
 * differently is install a bare `.md` where the loader looks for commands.
 */
export type TargetType = "skill" | "agent" | "command";

/**
 * What the trigger reader is watching for.
 *
 * A descriptor rather than a bare predicate, because "does this string name the
 * target" is only half the question -- the other half is which tool call the
 * string has to appear in, and that differs by artifact type. A `Skill` call
 * naming an agent is not a delegation, and an `Agent` call naming a skill is not
 * a consult; conflating them would credit the wrong behaviour to the description.
 */
export interface TriggerTarget {
  readonly type: TargetType;
  /**
   * Whether a value taken from a tool call's input names the target. Built by
   * `runSingleQuery` from the unique install alias, so nothing else can match.
   */
  readonly matches: (value: string) => boolean;
}

/** One row of an eval set file. */
export interface EvalItem {
  readonly query: string;
  readonly should_trigger: boolean;
}

/** Per-query verdict, aggregated across the attempts actually run. */
export interface QueryResult {
  readonly query: string;
  readonly should_trigger: boolean;
  /**
   * Triggers over attempts ACTUALLY RUN, which early stopping can make fewer than
   * `runs_per_query`.
   *
   * So this is not always the full-N rate, and the difference is real: a query that
   * triggered on its first two attempts of three stops there and reports 1.0, where the
   * third attempt might have made it 0.67. `pass` is unaffected -- see `decideTrigger`
   * for why the stopping rule cannot change a verdict -- but a reader comparing rates
   * across runs should look at `early_stopped` before treating this as a full-N figure,
   * or use `--no-early-stop` to get one.
   */
  readonly trigger_rate: number;
  readonly triggers: number;
  /** Attempts actually run. Equal to the budget unless `early_stopped` is true. */
  readonly runs: number;
  readonly pass: boolean;
  /** Whether the remaining attempts were skipped because the verdict was already settled. */
  readonly early_stopped: boolean;
}

export interface EvalSummary {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
}

export interface EvalOutput {
  readonly skill_name: string;
  readonly description: string;
  readonly results: readonly QueryResult[];
  readonly summary: EvalSummary;
}

export interface MeasureTriggeringParams {
  readonly evalSet: readonly EvalItem[];
  readonly skillName: string;
  readonly description: string;
  /**
   * Path to the real artifact. Copied per run, with `description` substituted.
   *
   * A directory for a skill, the `.md` file for an agent, and either for a
   * command. Named `skillPath` rather than `targetPath` because it is a public
   * field with existing callers, and the rename would buy legibility at the cost
   * of breaking them.
   */
  readonly skillPath: string;
  /** Defaults to `skill`, so every pre-existing caller keeps its behaviour. */
  readonly targetType?: TargetType;
  readonly numWorkers: number;
  /** Per-query wall clock budget, in seconds. */
  readonly timeoutSeconds: number;
  /**
   * Library default is 1. The CLI default is 3. That divergence exists in the
   * Python and is preserved deliberately -- do not unify them.
   */
  readonly runsPerQuery?: number;
  readonly triggerThreshold?: number;
  /**
   * Stop a query's attempts once its verdict can no longer change. Defaults to true.
   *
   * Set false to spend the full `runsPerQuery` on every query, which is what you want
   * when the trigger RATE is the number you are reading rather than the pass/fail
   * verdict. See `decideTrigger` for why the verdict itself is identical either way.
   */
  readonly earlyStop?: boolean;
  readonly model?: string | undefined;
  /**
   * Report each attempt to stderr as it settles. A full set is dozens of `claude -p`
   * calls at a ~11-14s floor each, so without progress the run looks hung and the
   * operator has no basis for judging how long is left.
   */
  readonly verbose?: boolean;
  /**
   * Called as each attempt settles, alongside the stderr indicator, so the dashboard
   * sees the same signal the terminal does.
   *
   * A callback rather than a `ProgressReporter`, because who owns the run differs by
   * caller: the CLI's run IS one sweep, while `optimize-description.ts` owns a status spanning
   * every iteration and only wants the counters routed into it. Handing this module a
   * reporter would force the second caller to nest one run inside another.
   *
   * `attempt` carries the outcome that just landed, so a live page can show WHICH query
   * settled and how, not merely how many have. Without it the only mid-run signal is a
   * pair of counts, and per-query rows cannot be rendered until the whole pool resolves
   * -- which is the end of the run, when a live page is no longer needed.
   */
  readonly onProgress?: (settled: number, total: number, attempt?: SettledAttempt) => void;
  /**
   * Told how each attempt ended, before scoring flattens it.
   *
   * Separate from `onProgress` because the two answer different questions and have
   * different audiences. `onProgress` feeds a live page and reports the SCORED outcome,
   * which is what a reader watching a sweep wants. This one reports the RAW outcome, and
   * exists so a caller can fill in `provenance.failed` — the count of attempts that
   * timed out or failed to spawn, every one of which this harness folds into the rates
   * as a non-trigger. Without it that count is unrecoverable after the run.
   */
  readonly onAttemptOutcome?: (outcome: AttemptOutcome) => void;
}

/** One `claude -p` attempt that has just settled, reported as it happens. */
export interface SettledAttempt {
  readonly query: string;
  readonly should_trigger: boolean;
  /** Whether this single attempt triggered. Aggregation across attempts happens later. */
  readonly triggered: boolean;
}

interface SingleQueryParams {
  readonly query: string;
  /** The unique install alias, not the artifact's authored name. */
  readonly skillName: string;
  readonly timeoutSeconds: number;
  /**
   * Root containing the real artifact under test, installed where the loader
   * looks for its kind -- `.claude/skills/<alias>/` for a skill, `.claude/agents/
   * <alias>.md` for an agent -- as produced by `installTargetForTrigger`. One root
   * is shared by every query in a run: the artifact is identical for all of them,
   * so per-query installs would copy the same tree N times and reintroduce the
   * concurrency hazard that per-query stub files had.
   */
  readonly projectRoot: string;
  readonly targetType?: TargetType;
  readonly model?: string | undefined;
  /**
   * Told how this attempt actually ended, as distinct from how it was scored.
   *
   * Additive and optional, so no existing caller changes. It exists because the return
   * value is a `boolean` and three different things collapse into `false` -- the router
   * declined, the stream ended without a decision, and the call hit the wall clock. The
   * third is the one a reader has to be able to see: this harness deliberately SCORES a
   * timeout as a non-trigger, and a run whose recall figure is really a timeout count
   * looks exactly like a description nobody wants. Widening the return type would have
   * been the tidier change and would have broken every caller for no gain.
   */
  readonly onOutcome?: (outcome: AttemptOutcome) => void;
}

/**
 * How one `claude -p` attempt ended, before scoring is applied.
 *
 * `declined` and `timeout` are both scored as non-triggers and are NOT the same event.
 * Separating them here is what lets `provenance.failed` be reported alongside
 * `provenance.scored` in the results envelope, which is the only place the difference
 * becomes visible to someone reading a rate.
 */
export type AttemptOutcome = "triggered" | "declined" | "timeout" | "error";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Narrow to a record, or an empty one -- mirrors Python's `.get(k, {})` chains. */
function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

/** Narrow to a string, or empty -- mirrors Python's `.get(k, "")`. */
function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Escape a literal for embedding in a RegExp. */
function escapeForRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await Bun.file(path).stat()).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Build the unique alias a run installs its copy under, and the throwaway root
 * to install it into.
 *
 * Installing as `<name>` put the copy in direct competition with any same-named
 * artifact already on the machine -- and a plugin-bundled copy is the normal case for
 * something being measured, since you install it to use it. The router then picks the
 * plugin, which answers as `<plugin>:<name>`, and the matcher deliberately rejects
 * that form because that copy carries its SHIPPED description rather than the
 * candidate under test. Measured: 200 attempts across 20 queries, every one
 * `rate=0/10`, which reads as a broken description and is really a name collision.
 *
 * The suffix is appended with a hyphen rather than scoped with a colon, and that
 * detail is load-bearing for the agent path: a subagent `name` may not contain `:`
 * since v2.1.218 -- the character is reserved for plugin scoping -- and a file
 * breaking the rule is SILENTLY not loaded. A colon-scoped alias would therefore
 * produce a run in which nothing is installed at all, scoring every query zero and
 * looking exactly like a description that never triggers.
 */
function aliasFor(name: string): { readonly root: string; readonly alias: string } {
  const suffix = crypto.randomUUID().slice(0, 8);
  return { root: `${tmpdir()}/skill-trigger-${suffix}`, alias: `${name}-t${suffix}` };
}

/**
 * Replace `description` and `name` in a frontmatter block, leaving every other
 * field and the whole body as authored.
 *
 * Rewriting only those two is what keeps the measurement honest: the body,
 * references and scripts are exactly what ships, so the run measures the real
 * artifact rather than a placeholder that happens to carry the candidate text.
 *
 * A block scalar sidesteps quoting entirely: the candidate may contain colons,
 * quotes or newlines, and folding it into a single-line YAML value would corrupt it.
 *
 * @param sourceLabel path used in the error message, so a failure names the file.
 */
export function rewriteFrontmatter(
  source: string,
  alias: string,
  description: string,
  sourceLabel: string,
): string {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (match === null) throw new Error(`No frontmatter in ${sourceLabel}`);
  const body = source.slice(match[0].length);
  const kept = (match[1] ?? "")
    .split("\n")
    // Drop the old description and any continuation lines it owned. A YAML mapping
    // key starts at column zero, so indented lines belong to the previous key.
    .reduce<{ lines: string[]; inDescription: boolean }>(
      (acc, line) => {
        if (/^description\s*:/.test(line)) return { lines: acc.lines, inDescription: true };
        if (acc.inDescription && (line.trim() === "" || /^\s/.test(line))) return acc;
        return { lines: [...acc.lines, line], inDescription: false };
      },
      { lines: [], inDescription: false },
    ).lines;

  const indented = description
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
  const renamed = kept.map((line) => (/^name\s*:/.test(line) ? `name: ${alias}` : line));
  return `---\n${renamed.join("\n")}\ndescription: |\n${indented}\n---\n${body}`;
}

/**
 * Install the real skill into a throwaway project root, with `description` replaced
 * by the candidate under test.
 *
 * This is what makes the measurement about a skill rather than about a placeholder.
 * The earlier approach wrote a `.claude/commands/` file carrying only the candidate
 * description and a one-line synthetic body, which is a different artifact from the
 * one that ships: it registers as a command rather than a skill, and it has no body,
 * no `references/` and no `scripts/`. Triggering is description-driven so the proxy
 * mostly agreed -- but "mostly" was doing real work, and every failure mode it
 * produced traced back to the substitution. Copying the skill costs one directory
 * copy per run and removes the whole class.
 *
 * The directory name is what Claude Code invokes a project-scoped skill by -- `name`
 * is only a display name at that scope, per ../../skills/skill-creator/references/skill-frontmatter.md -- so the
 * directory is what has to be unique. `name` is rewritten to match anyway, so the
 * artifact stays internally consistent and still satisfies the standard's stricter
 * validator, which requires the two to agree.
 *
 * Returns the temporary root. Delete it when the run ends.
 */
export async function installSkillForTrigger(
  skillPath: string,
  skillName: string,
  description: string,
): Promise<{ readonly root: string; readonly alias: string }> {
  const { root, alias } = aliasFor(skillName);
  const dest = `${root}/.claude/skills/${alias}`;
  await cp(skillPath, dest, { recursive: true });

  const source = await Bun.file(`${dest}/SKILL.md`).text();
  await Bun.write(
    `${dest}/SKILL.md`,
    rewriteFrontmatter(source, alias, description, `${skillPath}/SKILL.md`),
  );
  return { root, alias };
}

/**
 * Install a single-file artifact -- a subagent, or a command written as a bare
 * `.md` -- into a throwaway project root under a unique alias.
 *
 * The same reasoning as the skill installer, with one difference that matters. A
 * skill's identity at project scope is its DIRECTORY name; a subagent's identity is
 * its `name` frontmatter field, which is what `subagent_type` has to match for a
 * delegation to be credited. So for an agent the field is not merely kept consistent
 * with the filename -- it is the thing being aliased, and the filename follows it
 * because that is the convention `/doctor` and duplicate-name detection assume.
 *
 * Only the one file is copied. A subagent is a single file by construction: what it
 * can reach beyond itself is named in frontmatter (`skills`, `mcpServers`) rather
 * than sitting in a sibling directory, so there is no bundled tree to preserve the
 * way a skill has.
 *
 * @param subdir the loader's directory under `.claude/` -- `agents` or `commands`.
 */
export async function installFileTargetForTrigger(
  filePath: string,
  targetName: string,
  description: string,
  subdir: "agents" | "commands",
): Promise<{ readonly root: string; readonly alias: string }> {
  const { root, alias } = aliasFor(targetName);
  const source = await Bun.file(filePath).text();
  await Bun.write(
    `${root}/.claude/${subdir}/${alias}.md`,
    rewriteFrontmatter(source, alias, description, filePath),
  );
  return { root, alias };
}

/**
 * Install whichever artifact is under test, under an alias nothing else can claim.
 *
 * The dispatch is here rather than at the call site so `measureTriggering` stays one function
 * for every target type. A command is the interesting case: because commands and
 * skills have merged, a command authored as a directory with a SKILL.md installs
 * exactly as a skill does, and only the bare-`.md` spelling needs the file path.
 */
export async function installTargetForTrigger(params: {
  readonly targetPath: string;
  readonly targetType: TargetType;
  readonly name: string;
  readonly description: string;
}): Promise<{ readonly root: string; readonly alias: string }> {
  const { targetPath, targetType, name, description } = params;
  if (targetType === "agent") {
    return installFileTargetForTrigger(targetPath, name, description, "agents");
  }
  if (targetType === "command" && !(await isDirectory(targetPath))) {
    return installFileTargetForTrigger(targetPath, name, description, "commands");
  }
  return installSkillForTrigger(targetPath, name, description);
}

/**
 * The file carrying the artifact's frontmatter -- the one to read a name and
 * description out of, and the one whose absence means the target does not exist.
 */
export async function resolveTargetFile(
  targetPath: string,
  targetType: TargetType,
): Promise<string> {
  if (targetType === "agent") return targetPath;
  if (targetType === "command" && !(await isDirectory(targetPath))) return targetPath;
  return skillMdPath(targetPath);
}

/** A frontmatter scalar as a string, matching `ParsedSkill`'s "empty when absent". */
function stringField(value: unknown): string {
  // `|` clips the block scalar to one trailing newline, which the write path would
  // re-indent into a trailing blank line. The description does not end in one.
  return typeof value === "string" ? value.trimEnd() : "";
}

/**
 * Read the artifact's `name`, `description` and full text.
 *
 * The measurement path reads frontmatter with a conformant YAML parser. It wants the
 * string that ships, and `parseSkillMd`'s hand-rolled reader -- bug-compatible with
 * the Python original on purpose, and left that way for every other caller that
 * depends on its flattening -- does not return it.
 *
 * That reader ends a block scalar at the first line not opening with two spaces or a
 * tab. A blank line opens with neither, so it stopped at the first paragraph break.
 * Agent descriptions lost 78-81%, every `<example>` block with them; four of five
 * skills lost 22-40%. Measuring a fifth of a description and then writing that fifth
 * back through `rewriteFrontmatter` as the new one is the failure this removes, so
 * it is not a style preference about line breaks.
 *
 * `command` is the single exception, and it is a deliberate non-change rather than a
 * judgement that the legacy reader suits it: this repo ships no command artifact --
 * no `commands/` directory, none declared in the plugin manifest -- so the branch is
 * dead in practice and a speculative fix to it would be unexercised and unverified.
 * `command-creator` is a skill and `command-reviewer` an agent; both already read
 * conformantly. Ship a command artifact and this is the line to revisit.
 */
export async function readTargetDefinition(
  targetPath: string,
  targetType: TargetType,
): Promise<ParsedSkill> {
  const file = await resolveTargetFile(targetPath, targetType);
  const content = await Bun.file(file).text();
  if (targetType === "command") return parseFrontmatter(content);

  // Raised as the same error type the hand-rolled reader throws, so a caller's
  // failure handling does not have to branch on which reader ran.
  const outcome = parseFrontmatterBlock(content);
  if (!outcome.ok) throw new FrontmatterError(`${file}: ${outcome.error}`);
  return {
    name: stringField(outcome.frontmatter["name"]),
    description: stringField(outcome.frontmatter["description"]),
    content,
  };
}

/**
 * Tool calls whose input can name the target, by target type.
 *
 * For a skill or a command: `Skill` carries the name in `skill`, and `Read` can name
 * the file. For an agent: `Agent` and its `Task` alias carry it in `subagent_type`.
 *
 * `Read` is deliberately absent from the agent set. Reading `.claude/agents/<name>.md`
 * is inspection, not delegation -- the model is looking at the definition rather than
 * handing work to it -- and crediting it would score a description for provoking
 * curiosity instead of for winning a routing decision.
 */
const CONSULT_TOOLS: Readonly<Record<TargetType, ReadonlySet<string>>> = {
  skill: new Set(["Skill", "Read"]),
  command: new Set(["Skill", "Read"]),
  agent: new Set(["Agent", "Task"]),
};

/**
 * Pull `subagent_type` out of a possibly-incomplete streamed JSON input.
 *
 * A targeted extraction rather than testing the whole accumulated blob, because an
 * `Agent` call's input also carries a `prompt`, and a prompt restating the user's
 * request will often contain the agent's name in passing. Matching the blob would
 * credit that as a delegation. Waiting for a complete `"subagent_type": "..."` pair
 * costs nothing -- the deltas keep arriving, and `content_block_stop` is the backstop.
 */
const SUBAGENT_TYPE_PATTERN = /"subagent_type"\s*:\s*"((?:[^"\\]|\\.)*)"/;

function subagentTypeOf(json: string): string | undefined {
  return SUBAGENT_TYPE_PATTERN.exec(json)?.[1];
}

/**
 * Build the stream reader that decides whether a run counts as a trigger.
 *
 * A named function rather than a closure inside `runSingleQuery`, so the decision rule
 * can be driven with synthetic event lines in a test instead of only by spawning
 * `claude`. This rule decides every verdict the harness reports, so it is the part of
 * the harness that most needs to be reachable from the suite.
 *
 * Returns a line handler: `true` or `false` is a verdict that ends the read,
 * `undefined` means keep going.
 *
 * A trigger is the router reaching for the artifact at any point BEFORE the model
 * starts doing the work itself. The window closes on the first mutating tool.
 *
 * Read-only reconnaissance does not close it. For a skill whose domain is a working
 * repository the model often cannot tell whether the skill applies until it has seen
 * what changed, so recon then route is the same routing decision made a beat later with
 * more information. Measured, one such run reached `Skill` at call 4 with each call
 * landing in its own turn; treating that as a refusal would measure turn-ordering
 * rather than description quality, and would score every candidate for this class of
 * skill at zero -- leaving nothing for the optimization loop to discriminate on.
 *
 * The first `Edit`, `Write` or `NotebookEdit` is the real negative signal: at that point
 * the model has committed to doing the job without consulting.
 *
 * All of that reasoning carries over to a subagent unchanged, which is why the agent
 * path reuses this window rather than defining its own. Delegation is a routing
 * decision made under the same pressure: the model can reconnoitre first and delegate
 * afterwards, and once it has started editing, it has decided to do the job itself and
 * the agent's description lost. What differs is only which tool call counts as the
 * reach -- `Agent`/`Task` with a matching `subagent_type` rather than `Skill`.
 *
 * `target` accepts a bare predicate as well as a descriptor. The predicate form is the
 * pre-generalization signature and is normalized to a skill target, so a caller written
 * against the older shape keeps the behaviour it had.
 */
export function createTriggerReader(
  target: TriggerTarget | ((value: string) => boolean),
): (line: string) => boolean | undefined {
  const spec: TriggerTarget =
    typeof target === "function" ? { type: "skill", matches: target } : target;
  const consultTools = CONSULT_TOOLS[spec.type];
  const isAgent = spec.type === "agent";

  /**
   * Whether a tool input names the target. For an agent this reads one field; for
   * a skill it tests the accumulated JSON directly, which is the pre-existing rule
   * and stays as it was -- a skill's input is small enough that a stray match is
   * not a live hazard the way an `Agent` prompt is.
   */
  const namesTarget = (json: string): boolean => {
    if (!isAgent) return spec.matches(json);
    const value = subagentTypeOf(json);
    return value !== undefined && spec.matches(value);
  };

  const MUTATING_TOOLS = new Set(["Edit", "Write", "NotebookEdit"]);
  let pendingToolName: string | null = null;
  let accumulatedJson = "";

  return (line: string): boolean | undefined => {
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      return undefined;
    }
    if (!isRecord(event)) return undefined;

    // Early detection via stream events, so a decision lands as soon as the deciding
    // tool name streams through rather than after it executes.
    if (event["type"] === "stream_event") {
      const streamEvent = asRecord(event["event"]);
      const streamEventType = asString(streamEvent["type"]);

      if (streamEventType === "content_block_start") {
        const block = asRecord(streamEvent["content_block"]);
        if (block["type"] === "tool_use") {
          const toolName = asString(block["name"]);
          // A mutation closes the window: the model is editing without having
          // reached for the artifact, which is the outcome a non-trigger names.
          if (MUTATING_TOOLS.has(toolName)) return false;
          // Only a tool that can name THIS kind of target is worth accumulating.
          // Anything else is read-only reconnaissance: it neither decides nor
          // closes the window, so let the stream continue.
          pendingToolName = consultTools.has(toolName) ? toolName : null;
          accumulatedJson = "";
        }
      } else if (streamEventType === "content_block_delta" && pendingToolName !== null) {
        const delta = asRecord(streamEvent["delta"]);
        if (delta["type"] === "input_json_delta") {
          accumulatedJson += asString(delta["partial_json"]);
          if (namesTarget(accumulatedJson)) return true;
        }
      } else if (streamEventType === "content_block_stop") {
        if (pendingToolName !== null && namesTarget(accumulatedJson)) return true;
        pendingToolName = null;
        accumulatedJson = "";
      }
      // `message_stop` is deliberately NOT a verdict. One tool call per turn was
      // measured, so a turn boundary arrives between recon and a later consult;
      // ending the run there would reintroduce the first-call window one turn out.
      return undefined;
    }

    // Fallback for a runtime that does not emit partial messages: the same rule applied
    // to a complete assistant message, scanning every tool_use block in order rather
    // than returning at the first.
    if (event["type"] === "assistant") {
      const message = asRecord(event["message"]);
      const content = message["content"];
      if (!Array.isArray(content)) return undefined;
      for (const raw of content) {
        const item = asRecord(raw);
        if (item["type"] !== "tool_use") continue;
        const toolName = asString(item["name"]);
        if (MUTATING_TOOLS.has(toolName)) return false;
        if (!consultTools.has(toolName)) continue;
        const toolInput = asRecord(item["input"]);
        // Read the field the tool actually carries the name in, rather than
        // re-serializing the input and reusing the streaming matcher. Here the
        // input is already parsed, so the precise field is available for free.
        if (isAgent && spec.matches(asString(toolInput["subagent_type"]))) return true;
        if (toolName === "Skill" && spec.matches(asString(toolInput["skill"]))) return true;
        if (toolName === "Read" && spec.matches(asString(toolInput["file_path"]))) return true;
      }
      return undefined;
    }

    // The turn ended with no consult and no mutation: the model answered, or
    // reconnoitred and stopped. Either way it never reached for the artifact.
    if (event["type"] === "result") return false;
    return undefined;
  };
}

/**
 * Run a single query and return whether the artifact was triggered.
 *
 * Runs `claude -p` with the raw query, in a root where the artifact is already installed
 * by `installTargetForTrigger`. Uses `--include-partial-messages` to decide from stream
 * events as soon as the chosen skill's name streams through, rather than waiting for
 * the full assistant message, which only arrives after tool execution.
 *
 * There is no `--max-turns` cap. It was `1`, and it made a post-reconnaissance consult
 * unreachable: one tool call per turn was measured, so a cap of one turn ends the run
 * after one call and reports `error_max_turns`. A query that would have consulted the
 * skill at call 2 was killed before it could. The window below is bounded by the first
 * mutating tool and by `timeoutSeconds`, which together cover the case the cap existed
 * for -- a query that calls no tool at all.
 *
 * What governs wall clock: time-to-first-tool-call (~11-14s on Opus, an irreducible
 * floor), `numWorkers`, `runsPerQuery`, and the model. Removing the cap lets a
 * non-triggering run continue to its natural end, so raise `numWorkers` toward the API
 * rate limit rather than expecting a single call to get shorter -- and not past it, since
 * a rate-limited call is scored as a non-trigger and corrupts the measurement.
 *
 * @throws if `claude` could not be spawned -- the caller downgrades that to a
 *   warning plus a non-trigger, matching the Python's per-future `except`.
 */
export async function runSingleQuery(params: SingleQueryParams): Promise<boolean> {
  // A trigger is the router naming the copy installed for this run, which answers as
  // its unique alias. `installTargetForTrigger` guarantees no other artifact on the
  // machine shares that name, so there is nothing to disambiguate from and no way for
  // another installation's description to be credited to the candidate.
  //
  // The boundaries still matter for a subtler reason: they keep a name from matching
  // inside a longer one, so `research` is not credited when the router said
  // `research-helper`. The leading class excludes `:` so a qualified form cannot match
  // by its tail either. That last property is what makes the same pattern correct for
  // an agent: a plugin-scoped `<plugin>:<agent>` is a different installation carrying
  // its own shipped description, and the `^` anchor also makes the pattern exact
  // against a bare extracted `subagent_type` value.
  const namePattern = new RegExp(
    `(^|[\\s"'])${escapeForRegExp(params.skillName)}($|[\\s"',])`,
  );
  const target: TriggerTarget = {
    type: params.targetType ?? "skill",
    matches: (value: string): boolean => namePattern.test(value),
  };

  try {
    const cmd = [
      "claude",
      "-p",
      params.query,
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      // Load settings from the temporary project root only. This is a correctness fix
      // as much as a speed one: without it the measurement inherits the operator's
      // user-level config -- every enabled plugin, and on a developer machine that can
      // be 149 slash commands and 13 MCP servers -- so the candidate description
      // competes against a skill inventory that has nothing to do with the skill under
      // test, and the result is not reproducible on another machine.
      "--setting-sources",
      "project",
      // Same reasoning for MCP: none are needed to answer a routing question, and each
      // is a connection attempt on every call.
      "--strict-mcp-config",
    ];
    if (params.model !== undefined && params.model !== "") cmd.push("--model", params.model);

    const outcome = await runStreamingLines(
      cmd,
      { cwd: params.projectRoot, timeoutMs: params.timeoutSeconds * 1000 },
      createTriggerReader(target),
    );

    switch (outcome.kind) {
      case "decided":
        params.onOutcome?.(outcome.value ? "triggered" : "declined");
        return outcome.value;
      case "exhausted":
        // Stream closed without reaching a verdict, so the artifact was never reached
        // for and nothing was mutated either. Not a trigger.
        params.onOutcome?.("declined");
        return false;
      case "timeout":
        // Scored as a non-trigger, because nothing consulted the skill -- but WARNED
        // about, which is what makes a too-tight budget visible. The previous comment
        // here claimed the distinction was already visible; both branches returned
        // `false` identically, so it was not. A timeout and a genuine decline are
        // indistinguishable in the score, and the only honest fix is to say so out loud.
        //
        // `onOutcome` is what carries that admission into the results envelope:
        // `provenance.timeoutPolicy` says `scored` and `provenance.failed` says how many,
        // so a reader can subtract them from a rate the terminal warning has long since
        // scrolled away from.
        console.error(
          `Warning: query timed out after ${params.timeoutSeconds}s and is scored as a ` +
            `non-trigger. If this recurs, raise --timeout: measured calls reached 124s.`,
        );
        params.onOutcome?.("timeout");
        return false;
      case "error":
        throw new Error(outcome.message);
      default: {
        const unreachable: never = outcome;
        throw new Error(`unhandled stream outcome: ${JSON.stringify(unreachable)}`);
      }
    }
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

/**
 * Whether a query's verdict is already settled, or another attempt could still move it.
 *
 * `at-threshold` and `below-threshold` both mean DECIDED; they are distinguished only so
 * a caller can say which way. Which of them counts as a pass depends on the query's
 * `should_trigger`, and that mapping stays in one place, at the point the result is built.
 */
export type TriggerDecision = "at-threshold" | "below-threshold" | "undecided";

/**
 * Decide whether the remaining attempts for one query could still change its verdict.
 *
 * The verdict is a threshold on a rate over a FIXED denominator -- `triggers / planned`
 * against `threshold` -- so it is monotone in the trigger count from both directions.
 * Triggers only ever accumulate, so once `triggers / planned` has reached the threshold
 * no later attempt can pull it back under; and once even a clean sweep of what is left
 * (`triggers + remaining`) would fall short, no later attempt can push it over. Between
 * those two the verdict is genuinely open and the attempt has to be spent.
 *
 * The saving is not marginal, and it is worth being precise about its size because it
 * depends on the eval set rather than on the harness. At the CLI's defaults -- three runs
 * per query, threshold 0.5 -- the first attempt can never decide anything, the second
 * decides whenever it agrees with the first, and the third is only ever spent on a query
 * that is genuinely split. A query scoring 0/3 or 3/3, which is what the useful queries in
 * an eval set look like, therefore costs two attempts instead of three: a third off. A
 * query that is a coin flip costs 2.5 on average, which is the floor.
 *
 * **Stopping early cannot change a verdict.** Worth showing rather than asserting, because
 * the reported rate is over attempts RUN while the rule above is over attempts PLANNED,
 * and those differ:
 *
 * - Stopped at-threshold, after `k` of `n` attempts: `triggers/n >= threshold`, and
 *   `k <= n`, so the reported `triggers/k >= triggers/n >= threshold`. The full-n run
 *   would have ended at least as high, since triggers only grow. Both say at-threshold.
 * - Stopped below-threshold: `triggers + (n - k) < threshold * n`, so
 *   `triggers < k - n(1 - threshold) <= k * threshold` for any `k <= n` and
 *   `threshold <= 1` -- hence `triggers/k < threshold`. The full-n run cannot exceed
 *   `triggers + (n - k)` either. Both say below-threshold.
 *
 * Expressed as the same division the verdict uses rather than as
 * `triggers >= Math.ceil(threshold * planned)`. The two agree for every sane threshold,
 * but only one of them is guaranteed to agree with the comparison actually performed
 * downstream, floating point included, and that is the one to write.
 *
 * @param settled attempts completed so far. Consulted AFTER an attempt; at zero the
 *   answer is always `undecided`, so a threshold of 0 cannot decide a query that has
 *   run nothing and leave it out of the results entirely.
 */
export function decideTrigger(params: {
  readonly triggers: number;
  readonly settled: number;
  readonly planned: number;
  readonly threshold: number;
}): TriggerDecision {
  const { triggers, settled, planned, threshold } = params;
  if (settled <= 0 || planned <= 0) return "undecided";
  if (triggers / planned >= threshold) return "at-threshold";
  const remaining = Math.max(0, planned - settled);
  if ((triggers + remaining) / planned < threshold) return "below-threshold";
  return "undecided";
}

/** One distinct query and the attempt budget the eval set gives it. */
interface QueryPlan {
  readonly item: EvalItem;
  /**
   * Attempts budgeted: `runsPerQuery` for EACH eval-set row naming this query.
   *
   * Counted per row rather than fixed at `runsPerQuery` so a set that lists the same
   * query twice keeps the attempt count it had under the old flat pool, where both rows
   * pushed into one bucket. Duplicate rows are pathological, but a scheduling change
   * that quietly halves their sample is the kind of thing nobody notices until a number
   * moves for no reason.
   */
  readonly planned: number;
}

/** What one query's worker returns once its attempts are done or its verdict is settled. */
export interface QueryOutcome {
  readonly triggers: number;
  /** Attempts actually run, which `earlyStop` can make fewer than the budget. */
  readonly runs: number;
  readonly planned: number;
}

/**
 * Run one query's attempts in sequence, stopping as soon as the verdict is settled.
 *
 * The attempt is INJECTED rather than called directly, for the reason `createTriggerReader`
 * is a named export: what changed here is the scheduling, and a scheduling rule that can
 * only be exercised by spawning `claude` is a scheduling rule with no test coverage. A
 * caller in the suite hands in a canned sequence of outcomes and reads back how many were
 * consumed; the caller in `measureTriggering` hands in a real `claude -p` call.
 *
 * Sequential by construction, and that is the point rather than an accident. Attempts of
 * one query have to be siblings for `decideTrigger` to see them at all -- the flat pool
 * this replaced had the third attempt in flight before the first two had been compared.
 *
 * @param onAttempt fired after every attempt, settled or not, so progress counts attempts
 *   rather than queries.
 */
export async function runQueryAttempts(params: {
  readonly planned: number;
  readonly threshold: number;
  readonly earlyStop: boolean;
  readonly attempt: (index: number) => Promise<boolean>;
  readonly onAttempt?: (triggered: boolean, runs: number) => void;
}): Promise<QueryOutcome> {
  let triggers = 0;
  let runs = 0;
  while (runs < params.planned) {
    const triggered = await params.attempt(runs);
    runs += 1;
    if (triggered) triggers += 1;
    params.onAttempt?.(triggered, runs);
    if (!params.earlyStop) continue;
    const decision = decideTrigger({
      triggers,
      settled: runs,
      planned: params.planned,
      threshold: params.threshold,
    });
    if (decision !== "undecided") break;
  }
  return { triggers, runs, planned: params.planned };
}

/**
 * Turn one query's attempt tally into the row the output carries.
 *
 * A named function rather than an inline object literal so the pass rule and the early
 * stopping rule can be checked against EACH OTHER in the suite -- "stopping early never
 * changes a verdict" is a claim about these two together, and a test that reimplements
 * either of them proves nothing about the code that ships.
 */
export function summarizeQuery(params: {
  readonly item: EvalItem;
  readonly outcome: QueryOutcome;
  readonly threshold: number;
}): QueryResult {
  const { item, outcome, threshold } = params;
  const triggerRate = outcome.triggers / outcome.runs;
  return {
    query: item.query,
    should_trigger: item.should_trigger,
    trigger_rate: triggerRate,
    triggers: outcome.triggers,
    runs: outcome.runs,
    pass: item.should_trigger ? triggerRate >= threshold : triggerRate < threshold,
    early_stopped: outcome.runs < outcome.planned,
  };
}

/** Run the full eval set and return results. */
export async function measureTriggering(params: MeasureTriggeringParams): Promise<EvalOutput> {
  const runsPerQuery = params.runsPerQuery ?? 1;
  const triggerThreshold = params.triggerThreshold ?? 0.5;
  const targetType = params.targetType ?? "skill";
  const earlyStop = params.earlyStop ?? true;

  // Install the real artifact once, under the candidate description, into a throwaway
  // root. Every query shares it: the artifact is identical for all of them, so a
  // per-query install would copy the same tree N times for no gain.
  const { root: installedRoot, alias } = await installTargetForTrigger({
    targetPath: params.skillPath,
    targetType,
    name: params.skillName,
    description: params.description,
  });

  try {
    // ONE POOL ITEM PER DISTINCT QUERY, not one per attempt.
    //
    // The old flat pool scheduled every attempt of every query independently, which meant
    // the third attempt of a query whose first two already agreed was in flight before
    // anything could notice it was pointless. A query's attempts have to be siblings for
    // the stopping rule to see them, and the cheapest way to make them siblings is to run
    // them in one worker.
    //
    // The cost is coarser scheduling: a worker holds a query for up to `planned` attempts
    // rather than one, so with far fewer workers than queries a slow query can extend the
    // tail in a way the flat pool would have spread out. The worst case is the same either
    // way -- the same total attempts over the same workers -- and once `--num-workers`
    // reaches the query count the coarseness costs nothing at all. So the exchange is
    // "possibly a slightly longer tail" for "a third of the attempts on any query whose
    // first two agree", which is most of them.
    const plannedByQuery = new Map<string, number>();
    const itemByQuery = new Map<string, EvalItem>();
    for (const item of params.evalSet) {
      plannedByQuery.set(item.query, (plannedByQuery.get(item.query) ?? 0) + runsPerQuery);
      // First row wins, so a set naming one query twice with conflicting expectations
      // resolves the same way it did when the results were grouped after the fact.
      if (!itemByQuery.has(item.query)) itemByQuery.set(item.query, item);
    }
    const plans: QueryPlan[] = [...itemByQuery.values()].map((item) => ({
      item,
      planned: plannedByQuery.get(item.query) ?? runsPerQuery,
    }));

    // The MAXIMUM number of attempts, which is what both progress channels are told.
    //
    // Reported against rather than recomputed as queries settle, and the choice matters
    // for what the operator sees: a total that shrank every time a query stopped early
    // would make the bar jump backwards, invalidate the projection it feeds, and disagree
    // with the total the CLI already handed `ProgressReporter.start`. So the bar simply
    // finishes short -- `28/40 runs` and done -- which reads as "twelve attempts were not
    // needed" rather than as a run that was cut off.
    const plannedTotal = plans.reduce((total, plan) => total + plan.planned, 0);

    const startedAt = Bun.nanoseconds();
    let settledAttempts = 0;

    /**
     * Announce one settled attempt on both channels.
     *
     * Reported from inside the worker rather than through the pool's `onSettled`, which
     * now fires once per QUERY. That also retires the completion-order queue this used to
     * need: the attempt that just landed is the one in hand, so there is nothing to
     * reconstruct from a count.
     */
    const reportAttempt = (item: EvalItem, triggered: boolean): void => {
      settledAttempts += 1;
      if (params.verbose === true) {
        // Elapsed and a projected total, so the remaining wait is a measurement
        // rather than a guess. Carriage return keeps it on one line.
        const elapsed = (Bun.nanoseconds() - startedAt) / 1e9;
        const projected = (elapsed / settledAttempts) * plannedTotal;
        const line =
          `  ${settledAttempts}/${plannedTotal} runs  ${elapsed.toFixed(0)}s elapsed  ` +
          `~${Math.max(0, projected - elapsed).toFixed(0)}s left`;
        process.stderr.write(`\r${line.padEnd(64)}`);
        if (settledAttempts === plannedTotal) process.stderr.write("\n");
      }
      params.onProgress?.(settledAttempts, plannedTotal, {
        query: item.query,
        should_trigger: item.should_trigger,
        triggered,
      });
    };

    const attempt = async (item: EvalItem): Promise<boolean> => {
      try {
        return await runSingleQuery({
          query: item.query,
          skillName: alias,
          timeoutSeconds: params.timeoutSeconds,
          projectRoot: installedRoot,
          targetType,
          model: params.model,
          ...(params.onAttemptOutcome === undefined
            ? {}
            : { onOutcome: params.onAttemptOutcome }),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Warning: query failed: ${message}`);
        // A failed attempt is scored as a non-trigger, and reported as one -- a live page
        // that silently skipped failures would show a stalled row rather than a result.
        // It is also reported as a FAILURE on the outcome channel, because "the router
        // declined" and "the call never happened" are the same `false` here and must not
        // be the same number in the envelope.
        params.onAttemptOutcome?.("error");
        return false;
      }
    };

    const outcomes = await mapWithConcurrency(
      plans,
      params.numWorkers,
      async (plan): Promise<QueryOutcome> =>
        await runQueryAttempts({
          planned: plan.planned,
          threshold: triggerThreshold,
          earlyStop,
          attempt: async () => await attempt(plan.item),
          onAttempt: (triggered) => reportAttempt(plan.item, triggered),
        }),
    );

    // The per-attempt line above only closes itself on the last PLANNED attempt, which
    // early stopping means it may never reach. Closed here so the next thing written to
    // stderr does not land on top of it.
    if (params.verbose === true && settledAttempts > 0 && settledAttempts < plannedTotal) {
      process.stderr.write("\n");
    }

    // In eval-set order rather than completion order, because the pool returns results in
    // input order and `plans` was built by walking the eval set. The Python keyed a dict
    // by `as_completed`, so its output order varied run to run; ours does not.
    const results: QueryResult[] = [];
    for (const [index, outcome] of outcomes.entries()) {
      const plan = plans[index];
      // A query with zero runs never reaches the Python's results list either.
      if (plan === undefined || outcome === undefined || outcome.runs === 0) continue;
      results.push(summarizeQuery({ item: plan.item, outcome, threshold: triggerThreshold }));
    }

    const passed = results.filter((result) => result.pass).length;
    const total = results.length;

    return {
      skill_name: params.skillName,
      description: params.description,
      results,
      summary: { total, passed, failed: total - passed },
    };
  } finally {
    await rm(installedRoot, { recursive: true, force: true });
  }
}

/** Validate an eval set file at the boundary rather than failing deep in the pool. */
export function parseEvalSet(raw: unknown, source: string): EvalItem[] {
  if (!Array.isArray(raw)) throw new TypeError(`${source}: expected a JSON array of eval items`);
  return raw.map((entry, index) => {
    const item = asRecord(entry);
    const query = item["query"];
    const shouldTrigger = item["should_trigger"];
    if (typeof query !== "string") {
      throw new TypeError(`${source}: item ${index} has no string "query"`);
    }
    if (typeof shouldTrigger !== "boolean") {
      throw new TypeError(`${source}: item ${index} has no boolean "should_trigger"`);
    }
    return { query, should_trigger: shouldTrigger };
  });
}

// ---------------------------------------------------------------------------
// The results envelope
// ---------------------------------------------------------------------------

/**
 * One query, in the envelope's row vocabulary.
 *
 * camelCase, where `QueryResult` is snake_case. That is not an oversight and not a
 * migration: `EvalOutput` is the wire contract shared with the report generator and with
 * every results file produced since the Python era, so it keeps its spelling forever. The
 * envelope is a new contract whose neighbours -- `run.evalSetHash`, `provenance.timeoutPolicy`
 * -- are camelCase, and a payload that mixed both conventions would make every consumer
 * guess per field. The two shapes carry the same numbers and are written side by side.
 */
export interface TriggerRow {
  readonly query: string;
  readonly shouldTrigger: boolean;
  readonly triggers: number;
  /** Attempts actually run, which early stopping can make fewer than the budget. */
  readonly runs: number;
  /** Triggers over attempts RUN. See `QueryResult.trigger_rate` for why that matters. */
  readonly triggerRate: number;
  readonly pass: boolean;
  readonly earlyStopped: boolean;
}

/** Running counts of how attempts ended, for `provenance`. */
export interface AttemptTally {
  readonly triggered: number;
  readonly declined: number;
  readonly timeout: number;
  readonly error: number;
}

/**
 * A tally an `onAttemptOutcome` callback can be pointed straight at.
 *
 * Here rather than at the call site so the CLI and `optimize-description.ts` count the
 * same events the same way. Two hand-rolled counters that disagree about whether an
 * errored spawn is a failure would make two envelopes incomparable for a reason that has
 * nothing to do with the measurement.
 */
export function createAttemptTally(): {
  readonly record: (outcome: AttemptOutcome) => void;
  readonly snapshot: () => AttemptTally;
} {
  const counts = { triggered: 0, declined: 0, timeout: 0, error: 0 };
  return {
    record: (outcome) => {
      counts[outcome] += 1;
    },
    snapshot: () => ({ ...counts }),
  };
}

export interface TriggeringEnvelopeInput {
  readonly output: EvalOutput;
  readonly tally: AttemptTally;
  /**
   * Attempts the sweep budgeted, `evalSet.length * runsPerQuery`.
   *
   * Needed alongside the tally because early stopping means the two differ, and the
   * difference is a cap on coverage rather than a rounding error: at the CLI defaults a
   * query whose first two attempts agree never runs its third, so a third of the planned
   * calls can go unspent and every `triggerRate` in the table is over a smaller
   * denominator than the header implies.
   */
  readonly plannedAttempts: number;
  readonly artifact: ArtifactKind;
  readonly model: string | null;
  readonly workers: number;
  readonly runsPer: number;
  readonly timeoutSeconds: number;
  readonly evalSetHash: string;
  readonly targetSha: string;
  readonly installState: InstallState;
  readonly triggerThreshold: number;
  /** Extra coverage caveats from the caller — install sightings, mostly. */
  readonly caps?: readonly string[];
  readonly startedAt?: Date;
}

/**
 * Build the envelope for one triggering sweep.
 *
 * Pure, and exported, so the contract can be tested without spending an hour of API time.
 * Every judgement it encodes -- which figures are headline, what a verdict's reason says,
 * which caps are declared -- is a decision about how the measurement will be read, and a
 * decision reachable only by spawning `claude` is a decision with no coverage.
 */
export function buildTriggeringEnvelope(
  input: TriggeringEnvelopeInput,
): Envelope<TriggerRow> {
  const results = input.output.results;
  const rows: TriggerRow[] = results.map((result) => ({
    query: result.query,
    shouldTrigger: result.should_trigger,
    triggers: result.triggers,
    runs: result.runs,
    triggerRate: result.trigger_rate,
    pass: result.pass,
    earlyStopped: result.early_stopped,
  }));

  const attemptsRun =
    input.tally.triggered + input.tally.declined + input.tally.timeout + input.tally.error;

  // Recall and false-trigger rate rather than one blended "trigger rate". A single mean
  // over every row adds the queries that SHOULD trigger to the ones that should not, so
  // improving one and wrecking the other leaves it unmoved -- the one summary number that
  // can hide the failure it exists to surface.
  const positives = rows.filter((row) => row.shouldTrigger);
  const negatives = rows.filter((row) => !row.shouldTrigger);
  const rateOver = (subset: readonly TriggerRow[]): number | null => {
    const attempts = subset.reduce((total, row) => total + row.runs, 0);
    if (attempts === 0) return null;
    return subset.reduce((total, row) => total + row.triggers, 0) / attempts;
  };
  const recall = rateOver(positives);
  const falseTriggers = rateOver(negatives);

  const headline: HeadlineMetric[] = [
    {
      label: "queries passed",
      value: input.output.summary.passed,
      unit: `of ${input.output.summary.total}`,
    },
  ];
  if (input.output.summary.total > 0) {
    headline.push({
      label: "pass rate",
      value: input.output.summary.passed / input.output.summary.total,
      unit: "fraction",
    });
  }
  // Omitted rather than reported as zero when the eval set has no rows of that kind. A
  // zero recall from an empty numerator reads as a total failure to trigger.
  if (recall !== null) headline.push({ label: "recall", value: recall, unit: "fraction" });
  if (falseTriggers !== null) {
    headline.push({ label: "false triggers", value: falseTriggers, unit: "fraction" });
  }

  const caps: string[] = [...(input.caps ?? [])];
  const unspent = input.plannedAttempts - attemptsRun;
  if (unspent > 0) {
    caps.push(
      `Early stopping left ${unspent} of ${input.plannedAttempts} planned attempts unspent: ` +
        `a query stops once its remaining attempts cannot change its verdict. Every ` +
        `pass/fail is identical to a full sweep, but each \`triggerRate\` is over the ` +
        `attempts actually run rather than over ${input.runsPer}. Use --no-early-stop when ` +
        `the rates are what you are reading.`,
    );
  }
  if (input.tally.timeout > 0) {
    caps.push(
      `${input.tally.timeout} attempt(s) hit the ${input.timeoutSeconds}s budget and were ` +
        `SCORED as non-triggers. That is this operation's timeout policy, not a bug — but ` +
        `the rates above are that many notches lower than a run with a longer budget.`,
    );
  }
  if (input.tally.error > 0) {
    caps.push(
      `${input.tally.error} attempt(s) failed to complete and were scored as non-triggers.`,
    );
  }

  return buildEnvelope<TriggerRow>({
    run: {
      ...(input.startedAt === undefined ? {} : { startedAt: input.startedAt }),
      artifact: input.artifact,
      target: input.output.skill_name,
      operation: "measure-triggering",
      model: input.model,
      // No grading step exists: a trigger is decided by reading the tool-call stream, not
      // by asking a model. `null` says that; it does not mean "unrecorded".
      graderModel: null,
      workers: input.workers,
      runsPer: input.runsPer,
      timeoutSeconds: input.timeoutSeconds,
      evalSetHash: input.evalSetHash,
      targetSha: input.targetSha,
      installState: input.installState,
    },
    provenance: {
      // This operation counts no tokens at all, so claiming either tokenizer would be a
      // statement about a number that does not exist.
      tokenizer: "none",
      unit: "query attempt",
      // Everything that ran counted. Timeouts and spawn failures included -- that is what
      // `timeoutPolicy: "scored"` means, and it is why `failed` is reported beside it.
      scored: attemptsRun,
      excluded: 0,
      failed: input.tally.timeout + input.tally.error,
      timeoutPolicy: "scored",
      caps,
    },
    headline,
    rows,
    verdicts: results.map((result) => ({
      subject: result.query,
      verdict: result.pass ? "pass" : "fail",
      reason:
        `${result.triggers}/${result.runs} attempts triggered ` +
        `(${result.trigger_rate.toFixed(2)}) against a ${input.triggerThreshold} threshold; ` +
        `expected ${result.should_trigger ? "a trigger" : "no trigger"}` +
        `${result.early_stopped ? ", stopped early once the verdict was settled" : ""}.`,
    })),
  });
}

type Flags = ParsedArgs["flags"];

/**
 * Typed readers over `lib/cli.ts` output.
 *
 * They live here rather than in `lib/cli.ts` because that module is shared with
 * other workstreams in this port; these three entrypoints are the only callers.
 *
 * An empty string reads as absent, matching Python's `args.x or fallback`, which
 * treats `--description ""` as no override.
 */
export function flagString(flags: Flags, name: string): string | undefined {
  const value = flags[name];
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** Numeric flags always carry a spec default, so a miss is a spec bug, not user error. */
export function flagNumber(flags: Flags, name: string): number {
  const value = flags[name];
  if (typeof value !== "number") throw new TypeError(`--${name} expects a number`);
  return value;
}

export function flagBoolean(flags: Flags, name: string): boolean {
  return flags[name] === true;
}

export function requireFlag(flags: Flags, name: string): string {
  const value = flagString(flags, name);
  if (value === undefined) {
    console.error(`Error: --${name} is required`);
    process.exit(2);
  }
  return value;
}

const TARGET_TYPES: readonly TargetType[] = ["skill", "agent", "command"];

/**
 * Read `--target-type`, defaulting to `skill`.
 *
 * Rejected rather than coerced when it is not one of the three: a typo like
 * `--target-type agents` would otherwise silently measure a skill, and the run
 * would come back all-zeros with nothing to point at.
 */
export function requireTargetType(flags: Flags): TargetType {
  const raw = flagString(flags, "target-type");
  if (raw === undefined) return "skill";
  const match = TARGET_TYPES.find((type) => type === raw);
  if (match === undefined) {
    console.error(`Error: --target-type must be one of ${TARGET_TYPES.join(", ")}, got: ${raw}`);
    process.exit(2);
  }
  return match;
}

/**
 * Read the artifact's path from either spelling.
 *
 * `--skill-path` is kept because every existing invocation, script and doc uses it.
 * `--target-path` is the type-neutral name, and reads honestly when the path is an
 * `agents/reviewer.md`. They mean the same thing; `--target-path` wins if both appear.
 */
export function requireTargetPath(flags: Flags): string {
  const value = flagString(flags, "target-path") ?? flagString(flags, "skill-path");
  if (value === undefined) {
    console.error("Error: --target-path (or --skill-path) is required");
    process.exit(2);
  }
  return value;
}

/** Parse argv, honour `--help`, and exit(2) with usage on malformed input. */
export function parseCli(spec: Spec, usage: string): ParsedArgs {
  try {
    const parsed = parseArgs(Bun.argv.slice(2), spec);
    if (parsed.flags["help"] === true) {
      console.log(formatHelp(usage, spec));
      process.exit(0);
    }
    return parsed;
  } catch (error) {
    console.error(`Error: ${error instanceof CliError ? error.message : String(error)}`);
    console.error(formatHelp(usage, spec));
    process.exit(2);
  }
}

/** Flags every entrypoint in this port shares, defaults included. */
export const SHARED_EVAL_FLAGS: Spec = {
  "eval-set": { kind: "string", help: "Path to eval set JSON file" },
  "skill-path": { kind: "string", help: "Path to skill directory" },
  "target-path": {
    kind: "string",
    help: "Path to the artifact under test (alias for --skill-path; a .md file for an agent)",
  },
  "target-type": {
    kind: "string",
    default: "skill",
    help: "Artifact under test: skill, agent or command",
  },
  description: { kind: "string", help: "Override description to test" },
  "num-workers": { kind: "number", default: 10, help: "Number of parallel workers" },
  // 180s, not 30. Calls were measured at up to 124s, and a timeout is scored as a
  // non-trigger, so a 30s ceiling silently converted slow calls into failures -- the
  // measurement corruption documented for rate limits, reached by the DEFAULT invocation.
  timeout: { kind: "number", default: 180, help: "Timeout per query in seconds" },
  "runs-per-query": { kind: "number", default: 3, help: "Number of runs per query" },
  "trigger-threshold": { kind: "number", default: 0.5, help: "Trigger rate threshold" },
  // Off by default, because the verdict is what almost every caller reads and the
  // stopping rule cannot change one. The flag exists for the callers that read the RATE:
  // a run being used to compare trigger rates across descriptions or models, or to fill
  // in a measurements table, wants every rate over the same denominator, and an early
  // stop reports 2/2 where the full sweep would have reported 2/3.
  "no-early-stop": {
    kind: "boolean",
    default: false,
    help: "Run every attempt even once the verdict is settled (exact full-N trigger rates)",
  },
  verbose: { kind: "boolean", default: false, help: "Print progress to stderr" },
  // Opt-in and additive. The existing stdout JSON is the wire contract and does not
  // change; the envelope is a second file carrying the conditions the run was produced
  // under, which stdout has never had room for.
  envelope: {
    kind: "string",
    help: "Also write the results envelope (run conditions + provenance) to this path",
  },
  help: { kind: "boolean", short: "h", help: "Show this message" },
};

/** CPython prints booleans as True/False; kept so verbose output diffs cleanly. */
export function pyBool(value: boolean): string {
  return value ? "True" : "False";
}

async function main(): Promise<void> {
  const { flags } = parseCli(
    {
      ...SHARED_EVAL_FLAGS,
      model: { kind: "string", help: "Model to use for claude -p (default: user's configured)" },
    },
    "Usage: bun shared/scripts/measure-triggering.ts --eval-set <path> --target-path <path> [options]\n\n" +
      "Each query is run --runs-per-query times and passes when its trigger rate clears\n" +
      "--trigger-threshold (or stays under it, for a should_trigger=false query).\n\n" +
      "By default a query stops as soon as its remaining attempts cannot change that\n" +
      "verdict. At the defaults that means two concordant attempts settle it, so a query\n" +
      "scoring 0/3 or 3/3 — which is most of a useful eval set — costs two calls rather\n" +
      "than three, and every pass/fail is identical either way. What it does change is\n" +
      "the reported trigger_rate, which becomes a rate over the attempts actually run\n" +
      "(2/2 rather than 2/3); results carry early_stopped so you can tell.\n" +
      "Pass --no-early-stop when the RATE is the number you are reading — comparing\n" +
      "descriptions or models against each other, or publishing a measurements table —\n" +
      "since those need every rate over the same denominator.",
  );
  const evalSetPath = requireFlag(flags, "eval-set");
  const targetType = requireTargetType(flags);
  const targetPath = requireTargetPath(flags);
  const verbose = flagBoolean(flags, "verbose");

  const definitionFile = await resolveTargetFile(targetPath, targetType);
  if (!(await Bun.file(definitionFile).exists())) {
    console.error(`Error: no ${targetType} definition found at ${definitionFile}`);
    process.exit(1);
  }

  const evalSet = parseEvalSet(await Bun.file(evalSetPath).json(), evalSetPath);
  const { name, description: originalDescription } = await readTargetDefinition(
    targetPath,
    targetType,
  );
  const description = flagString(flags, "description") ?? originalDescription;

  if (verbose) console.error(`Evaluating: ${description}`);

  // The dashboard's unit is a run, and a bare `measure-triggering.ts` invocation is exactly one,
  // so the CLI owns the status rather than `measureTriggering` -- which is also called
  // per-iteration by `optimize-description.ts`, where the run being reported is the whole loop.
  const runsPerQuery = flagNumber(flags, "runs-per-query");
  await ensureDashboard();
  // Every query starts as a zero row, so the page shows the sweep's full shape from the
  // first poll rather than growing a table as results arrive. A sweep with nothing
  // rendered yet is indistinguishable from one that has not started.
  const tallies = new Map<string, QueryProgress>();
  for (const item of evalSet) {
    if (tallies.has(item.query)) continue;
    tallies.set(item.query, {
      query: item.query,
      should_trigger: item.should_trigger,
      triggered: 0,
      settled: 0,
      total: runsPerQuery,
    });
  }

  const reporter = ProgressReporter.start({
    kind: "eval-sweep",
    label: `${name} — ${evalSet.length} queries × ${runsPerQuery}`,
    total: evalSet.length * runsPerQuery,
    subject: name,
    detail: { phase: "evaluating", queries: [...tallies.values()] },
  });

  const numWorkers = flagNumber(flags, "num-workers");
  const timeoutSeconds = flagNumber(flags, "timeout");
  const triggerThreshold = flagNumber(flags, "trigger-threshold");
  const tally = createAttemptTally();

  let output: EvalOutput;
  try {
    output = await measureTriggering({
      evalSet,
      skillName: name,
      description,
      skillPath: targetPath,
      targetType,
      numWorkers,
      timeoutSeconds,
      runsPerQuery,
      triggerThreshold,
      earlyStop: !flagBoolean(flags, "no-early-stop"),
      model: flagString(flags, "model"),
      verbose,
      onAttemptOutcome: tally.record,
      onProgress: (settled, total, attempt) => {
        if (attempt !== undefined) {
          const row = tallies.get(attempt.query);
          if (row !== undefined) {
            tallies.set(attempt.query, {
              ...row,
              triggered: row.triggered + (attempt.triggered ? 1 : 0),
              settled: row.settled + 1,
            });
          }
        }
        // Counters and rows in one write, so the row tallies can never disagree with the
        // headline count the same page shows.
        reporter.update({ queries: [...tallies.values()] }, { settled, total });
      },
    });
  } catch (error) {
    // Recorded before rethrowing, so a crashed sweep reads as failed on the dashboard
    // rather than sitting at `running` until the staleness threshold catches it.
    await reporter.finish("failed", error instanceof Error ? error.message : String(error));
    throw error;
  }
  await reporter.finish("done");

  if (verbose) {
    console.error(`Results: ${output.summary.passed}/${output.summary.total} passed`);
    for (const result of output.results) {
      const status = result.pass ? "PASS" : "FAIL";
      const rate = `${result.triggers}/${result.runs}`;
      console.error(
        `  [${status}] rate=${rate} expected=${pyBool(result.should_trigger)}: ${result.query.slice(0, 70)}`,
      );
    }
  }

  console.log(JSON.stringify(output, null, 2));

  const envelopePath = flagString(flags, "envelope");
  if (envelopePath !== undefined) {
    // The sweep needs the artifact reachable by the router, which is why it installs its
    // own copy under a unique alias into a throwaway project root and runs with
    // `--setting-sources project`. So what `detectInstallState` reports here is the
    // MACHINE's state, not the run's: a second copy answering to this name is the
    // documented way a sweep comes back reading 0% for a description that is fine.
    const sighting = await detectInstallState({
      artifact: targetType,
      name,
      sourcePath: targetPath,
    });
    const conflict = installConflict({
      operation: "measure-triggering",
      needs: "installed",
      found: sighting.state,
    });
    // A run that did not pin `--model` was answered by whatever the operator had
    // configured, and this script has no way to find out what that was. Recording `null`
    // and saying so is the only honest option: inventing a name would make two runs on
    // different machines look comparable, which is the exact failure the run block exists
    // to prevent.
    const model = flagString(flags, "model") ?? null;
    const unpinned =
      model === null
        ? "No `--model` was pinned, so the run was answered by the operator's configured " +
          "default and the model is not recorded. Runs made this way are not comparable " +
          "across machines even though their `run.model` fields match."
        : null;
    await writeEnvelope(
      envelopePath,
      buildTriggeringEnvelope({
        output,
        tally: tally.snapshot(),
        plannedAttempts: evalSet.length * runsPerQuery,
        artifact: targetType,
        model,
        workers: numWorkers,
        runsPer: runsPerQuery,
        timeoutSeconds,
        evalSetHash: hashJsonValue(evalSet),
        targetSha: await hashArtifact(targetPath),
        installState: sighting.state,
        triggerThreshold,
        caps: [sighting.cap, conflict, unpinned].filter((cap): cap is string => cap !== null),
      }),
    );
    console.error(`Envelope written to: ${envelopePath}`);
  }
}

if (import.meta.main) await main();
