/**
 * Subprocess helpers for invoking `claude -p`.
 *
 * Ported from the `subprocess.Popen` / `subprocess.run` call sites in
 * run_eval.py and improve_description.py. Two behaviours from the Python are
 * load-bearing and are preserved exactly; one is a deliberate improvement.
 *
 * 1. ENV IS MERGED, NOT REPLACED (preserved). Both Python call sites build
 *    `{k: v for k, v in os.environ.items() if k != "CLAUDECODE"}` -- the FULL
 *    parent environment minus one key -- so that `claude -p` can nest inside a
 *    Claude Code session. `Bun.spawn` REPLACES the environment when `env` is
 *    passed, so the parent env must be spread explicitly. Getting this wrong
 *    silently loses auth.
 *
 * 2. STDIN, NOT ARGV (preserved). The improvement prompt embeds a whole
 *    SKILL.md body and would blow past a comfortable argv length.
 *
 * 3. EXPLICIT TIMEOUT + TYPED OUTCOME (deliberate improvement over the source).
 *    Bun's `timeout` spawn option is NOT a hard timeout: a SIGTERM-trapping
 *    child runs to completion against a shorter limit, and `proc.killed` reads
 *    true even when the timeout never fired -- so a timeout is indistinguishable
 *    from a manual kill. We therefore drive the deadline from an AbortController
 *    we own, force SIGKILL on abort, and record the fact in a flag only the
 *    timer sets. The result is a discriminated union so a caller cannot silently
 *    treat a timeout as a normal exit.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

/** Anything env-shaped. Injectable so the merge is testable without mutating the real env. */
export type EnvSource = Readonly<Record<string, string | undefined>>;

/**
 * Set by Claude Code to guard against interactive terminal conflicts. Dropping it
 * is what makes a nested `claude -p` call legal; programmatic subprocess use is safe.
 */
const NESTED_SESSION_GUARD = "CLAUDECODE";

/**
 * Keeps the operator's own auto-memory out of the child's system prompt.
 *
 * NOT redundant with `--setting-sources project`, which is what everyone assumes and what
 * cost this repository months of contaminated runs. Measured 2026-08-24 at CLI 2.1.241, in
 * an empty temporary root with the isolation flags already applied, the child reported
 * `"memory_paths": {"auto": "/Users/<operator>/.claude/memory/"}` and quoted that file's
 * first heading back when asked. The auto-memory directory is not resolved through the
 * setting-source allow-list, so no value of that flag closes it.
 *
 * What lands in the child is not a path but content: `MEMORY.md` is read and inlined into
 * the system prompt verbatim. On the machine this was found on, that was a couple of hundred
 * lines of behavioural instruction accumulated over months -- none of it about the artifact
 * under test, all of it in the context every measurement was taken in.
 *
 * `--bare` also closes it, and is the wrong instrument: it authenticates strictly from an
 * API key or helper and never from OAuth or the keychain, so on a login-authenticated
 * machine it fails the run outright. Measured -- a probe with `--bare`'s auth conditions
 * returned `Not logged in`. This variable is checked BEFORE bare mode's own gate, so it
 * closes auto-memory without touching anything else. Verified: the same probe with this set
 * emits no `memory_paths` key at all and the child answers that it has no memory in context.
 */
const DISABLE_AUTO_MEMORY = "CLAUDE_CODE_DISABLE_AUTO_MEMORY";

/**
 * The full parent environment minus the nested-session guard, plus the auto-memory fence.
 *
 * Mirrors `{k: v for k, v in os.environ.items() if k != "CLAUDECODE"}`. Keys whose
 * value is `undefined` are dropped, since `Bun.spawn` wants a string-valued record.
 *
 * The fence is applied AFTER the merge so an inherited value cannot re-enable it. Every
 * `claude` this repository spawns is a measurement child or a grader, and not one of them
 * has a legitimate use for the operator's memory -- so the fence belongs here, where no call
 * site can forget it, rather than in each command builder.
 */
export function claudeEnv(source: EnvSource = Bun.env): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (key === NESTED_SESSION_GUARD) continue;
    if (value === undefined) continue;
    merged[key] = value;
  }
  merged[DISABLE_AUTO_MEMORY] = "1";
  return merged;
}

/**
 * Flags every spawned run needs when it must actually EXECUTE a skill.
 *
 * Without this the skill NEVER loads, and the run measures something else entirely
 * while looking healthy. The mechanism, read from the shipped binary at 2.1.241:
 * the Skill tool's permission ladder is deny rules, then allow rules, then an
 * auto-allow predicate, then a fallthrough returning `behavior: "ask"` whose message
 * is the string `Execute skill: <name>`. That string is the PERMISSION PROMPT LABEL,
 * not an error. The binary's own SDK schema doc for `permission_denied` says of the
 * headless case: "Without one (bare -p / SDK query() with no canUseTool), 'ask'
 * decisions are terminal, so this event also covers those implicit denials." So in
 * `-p` the ask cannot be answered, resolves as a denial, and comes back to the model
 * as a tool error carrying the prompt's own text.
 *
 * Measured on one skill: 0 of 4 runs loaded without this, 4 of 4 with it, and only
 * the granted runs carry the real success payload `Launching skill:`.
 *
 * Two properties worth knowing before changing this:
 *
 *   - `--allowedTools` is ADDITIVE, not a restriction. Checked, because the opposite
 *     would floor every pull rate at zero: granted runs still made 3, 3, 0 and 2
 *     reference reads, so `Read` survives.
 *   - A project `settings.json` carrying `permissions.allow: ["Skill"]` does NOT
 *     work, measured 0 of 4, even under `--setting-sources project`. Only the flag
 *     does. Do not "simplify" this into the settings file.
 *
 * What made it invisible: a strong model often reads SKILL.md itself after the
 * refusal, which looks like a load and is not one. Measured, same prompt: opus fell
 * back 3 of 4, sonnet 0 of 4. So the failure's visibility depended on which model
 * was under test, which is why it read as an intermittent 30% rather than as total.
 */
export const SKILL_EXECUTION_GRANT: readonly string[] = ["--allowedTools", "Skill"];

/**
 * Denies the child every instrument for reaching a DIFFERENT Claude Code session.
 *
 * The channel this closes was observed live on 2026-08-24: a spawned eval worker messaged
 * the session orchestrating its own sweep and escalated its scenario's fictional dilemma as
 * though it were real work. The receiving session had no idea a scenario existed. That is
 * contamination in the expensive direction -- not the child seeing too much, but the child
 * acting on the operator's real workspace while role-playing.
 *
 * Environment scrubbing does not touch it. Measured against the shipped binary: a child
 * unsets the parent's messaging socket and token on its first line of setup, binds an inbox
 * of its OWN, registers itself in a peer directory under `HOME`, and finds its neighbours by
 * scanning that directory. Nothing inherited enrols it, so nothing removed disenrols it.
 *
 * Denying the tools is what works, and the form matters. MEASURED at CLI 2.1.241: with these
 * bare names denied, the child's own `init` event lists neither tool among its `tools` -- it
 * is never told they exist, rather than being told and refused. READ from the shipped binary
 * and not measured here: a SCOPED rule such as `SendMessage(...)` is skipped by that filter
 * and only denies at call time. Hence bare names. The distinction matters because the
 * measured effect is the one `../isolation.ts` asserts per run, off the same `init` line.
 *
 * `ListAgents` rides along with `SendMessage` because it is the discovery half: a child that
 * cannot enumerate the operator's live sessions has no name to address even if it found an
 * instrument. Neither tool has any bearing on whether a skill triggers or which of its files
 * get read, so denying them costs the measurement nothing.
 *
 * What this does NOT close, and cannot from here: the child still binds its own inbox and
 * still appears in the peer directory, so another session could address IT. Severing that
 * needs `--bare` (which breaks OAuth auth) or a redirected `HOME` (which also breaks it) --
 * see the report accompanying this change for the upstream ask.
 */
export const MESSAGING_TOOLS: readonly string[] = ["SendMessage", "ListAgents"];

/**
 * {@link MESSAGING_TOOLS} as the argv pair that denies them.
 *
 * DERIVED rather than written out, because the deny and the check that the deny worked --
 * `../isolation.ts` reads the child's advertised tool list and asserts these are absent --
 * are two encodings of one list, and a third tool added to one and not the other fails in
 * the direction that is invisible: a check that passes because it is looking for the wrong
 * name. `isolation.ts` imports this constant rather than restating it.
 *
 * Comma-separated in ONE argv token rather than space-separated across two. Both forms are
 * accepted and both were verified live, but the variadic option consumes following tokens
 * until the next `--flag`, so the space form's correctness depends on nothing ever being
 * appended after it. The comma form has no such dependency, and callers do append.
 */
export const CROSS_SESSION_DENY: readonly string[] = [
  "--disallowedTools",
  MESSAGING_TOOLS.join(","),
];

/**
 * Everything a spawned child needs to see the artifact under test and nothing else.
 *
 * ONE constant for every spawn -- the three measurement harnesses and the four helper call
 * sites -- because they had each grown their own copy of the same two flags, with their own
 * comments, and the cross-session deny would have been a fourth thing to remember in seven
 * places. A flag that is correct in six of seven spawns is not isolation.
 *
 * `--setting-sources project` is the flag that closes the skill inventory. Measured against
 * a temporary root holding one skill: with the flag the run saw that skill plus Claude
 * Code's own built-ins and NOTHING else -- no plugin skills, and no user-level skills
 * either, which is more than its name promises. Without it the same root saw 118, the
 * operator's whole inventory. Measured on a helper spawned without it from a bare working
 * directory, the router selected the plugin skill `skill-creator:skill-creator` and issued a
 * `Read` nobody asked for; a grader that goes on side quests is not a guardrail, and its
 * verdicts stop being comparable across machines the moment they depend on which plugins the
 * operator happens to have enabled.
 *
 * Its reach has a documented LIMIT, which is why `../isolation.ts` exists and why
 * {@link claudeEnv} carries a fence of its own: the flag does not govern the auto-memory
 * directory, so the operator's `MEMORY.md` reached every child despite it.
 *
 * `--strict-mcp-config` rides along because no MCP server is needed to answer a routing
 * question or judge a transcript, and each is a connection attempt on every call, on paths
 * that make hundreds. It is also simply the combination that was measured; shipping one of
 * the two would ship an arrangement no evidence covers.
 *
 * The cross-session deny rides along for the reason given on {@link CROSS_SESSION_DENY}. A
 * grader asked to judge a transcript has even less business reaching another session than a
 * scenario child does, and it is the same one-line flag either way.
 *
 * Note what is NOT here. `--allowedTools Skill` is a per-harness decision -- a triggering
 * sweep measures whether the router REACHES for a skill and must not grant execution, while
 * a disclosure sweep measures what an executing skill reads and must. See
 * {@link SKILL_EXECUTION_GRANT}.
 */
export const CHILD_ISOLATION_FLAGS: readonly string[] = [
  "--setting-sources",
  "project",
  "--strict-mcp-config",
  ...CROSS_SESSION_DENY,
];

export interface CommandOptions {
  /** Hard deadline in milliseconds. Enforced by SIGKILL, not by Bun's soft `timeout`. */
  readonly timeoutMs: number;
  readonly cwd?: string;
  /** Written to the child's stdin. Preferred over argv for large payloads. */
  readonly stdin?: string;
}

/** Outcome of a buffered run. A timeout is a distinct case, not an exit code. */
export type CommandOutcome =
  | { readonly kind: "ok"; readonly exitCode: number; readonly stdout: string; readonly stderr: string }
  | { readonly kind: "timeout"; readonly timeoutMs: number }
  | { readonly kind: "error"; readonly message: string };

export interface StreamOptions {
  readonly timeoutMs: number;
  readonly cwd?: string;
}

/**
 * Outcome of a line-streamed run.
 *
 * `decided` means the line handler short-circuited (the Python `return`s from
 * inside its read loop); `exhausted` means the child closed stdout without the
 * handler ever deciding.
 */
export type StreamOutcome<T> =
  | { readonly kind: "decided"; readonly value: T }
  | { readonly kind: "exhausted"; readonly exitCode: number | null }
  | { readonly kind: "timeout"; readonly timeoutMs: number }
  | { readonly kind: "error"; readonly message: string };

interface Deadline {
  readonly signal: AbortSignal;
  readonly expired: () => boolean;
  readonly clear: () => void;
}

/** An abort deadline we own outright, so `expired()` is unambiguous. */
function startDeadline(timeoutMs: number): Deadline {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  return {
    signal: controller.signal,
    expired: () => timedOut,
    clear: () => {
      clearTimeout(timer);
    },
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Structural so it accepts any `Bun.Subprocess`, whatever its stdio generics are. */
interface Killable {
  readonly exitCode: number | null;
  readonly signalCode: string | null;
  kill(signal?: number | NodeJS.Signals): void;
}

function hasExited(proc: Killable): boolean {
  return proc.exitCode !== null || proc.signalCode !== null;
}

type Spawned<T> = { readonly ok: true; readonly proc: T } | { readonly ok: false; readonly message: string };

/** Spawn without losing the inferred stdio generics, which vary with the options. */
function trySpawn<T>(spawn: () => T): Spawned<T> {
  try {
    return { ok: true, proc: spawn() };
  } catch (error) {
    return { ok: false, message: describe(error) };
  }
}

/** Bun's `signal` support is belt; the explicit SIGKILL is braces. */
function killOnAbort(signal: AbortSignal, proc: Killable): void {
  signal.addEventListener(
    "abort",
    () => {
      if (!hasExited(proc)) proc.kill("SIGKILL");
    },
    { once: true },
  );
}

/**
 * Cancel `reader` when the deadline fires.
 *
 * Killing the child is NOT sufficient to end a read. A grandchild inherits the
 * stdout pipe, so the write end stays open after its parent dies and the pending
 * `read()` never settles -- a child that spawns a sleeping grandchild reproduces
 * this, and `claude -p` spawns children of its own. Cancelling our reader is
 * what actually bounds the wait. Returns the detach function.
 */
function cancelOnAbort(signal: AbortSignal, reader: { cancel(): Promise<void> }): () => void {
  const onAbort = (): void => {
    void reader.cancel().catch(() => undefined);
  };
  if (signal.aborted) onAbort();
  else signal.addEventListener("abort", onAbort, { once: true });
  return () => {
    signal.removeEventListener("abort", onAbort);
  };
}

/** Drain a stream to a string, giving up promptly if the deadline fires. */
async function readAll(stream: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<string> {
  const reader = stream.getReader();
  const detach = cancelOnAbort(signal, reader);
  const decoder = new TextDecoder();
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
  } catch {
    // Cancelled or errored mid-read: return whatever arrived before that.
  } finally {
    detach();
  }
  return text;
}

/** Run to completion, buffering stdout and stderr. Mirrors `subprocess.run(...)`. */
export async function runCommand(
  cmd: readonly string[],
  options: CommandOptions,
): Promise<CommandOutcome> {
  const deadline = startDeadline(options.timeoutMs);
  const spawned = trySpawn(() =>
    Bun.spawn([...cmd], {
      cwd: options.cwd,
      env: claudeEnv(),
      stdin: options.stdin === undefined ? "ignore" : new TextEncoder().encode(options.stdin),
      stdout: "pipe",
      stderr: "pipe",
      signal: deadline.signal,
    }),
  );
  if (!spawned.ok) {
    deadline.clear();
    return { kind: "error", message: spawned.message };
  }
  const proc = spawned.proc;

  // A trapping child must not be able to outlive its deadline.
  killOnAbort(deadline.signal, proc);

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      readAll(proc.stdout, deadline.signal),
      readAll(proc.stderr, deadline.signal),
      proc.exited,
    ]);
    if (deadline.expired()) return { kind: "timeout", timeoutMs: options.timeoutMs };
    return { kind: "ok", exitCode, stdout, stderr };
  } catch (error) {
    if (deadline.expired()) return { kind: "timeout", timeoutMs: options.timeoutMs };
    return { kind: "error", message: describe(error) };
  } finally {
    deadline.clear();
    if (!hasExited(proc)) proc.kill("SIGKILL");
  }
}

/**
 * Run a single-turn helper call -- a grader, a description improver, a scenario
 * synthesizer -- isolated from whatever is installed on the operator's machine.
 *
 * Everything such a call needs to reach a judgement is already in its prompt, which is
 * what makes the isolation free: these prompts embed the artifact, the transcript and the
 * files the run produced, read by the PARENT before the call. Nothing downstream of here
 * resolves a path, so the child has no legitimate use for the operator's working directory.
 *
 * `--grader-bare` is not a substitute, even though `--bare` does empty the inventory as a
 * side effect -- measured: bare alone, with no isolation flags, reported zero skills. Three
 * things stop it being the mechanism. It is OFF by default, so the ordinary path was
 * unisolated. It exists at ONE of the four helper call sites, so it could never have
 * covered the other three. And it authenticates strictly from `ANTHROPIC_API_KEY`, an
 * apiKeyHelper, or a third-party provider -- never OAuth or the keychain -- so on a
 * login-authenticated machine it latches off mid-run and every call after that is exposed
 * again. It also switches off hooks, LSP, auto-memory and CLAUDE.md discovery, which is a
 * great deal more than isolation asks for.
 *
 * The cwd is a fresh empty directory per call, removed on the way out. Per call rather
 * than one root for the process because a shared root has to be cleaned up at exit, `rm`
 * cannot be awaited from an exit handler, and no handler covers `SIGKILL` at all -- so the
 * shared version leaks exactly where it must not. Two syscalls against a call measured at
 * 13-124 seconds of network is not a cost worth trading a leak for.
 *
 * Flags are appended, so a caller's own `--model` or `--bare` is preserved.
 */
export async function runIsolatedHelper(
  cmd: readonly string[],
  options: Omit<CommandOptions, "cwd">,
): Promise<CommandOutcome> {
  const root = await mkdtemp(`${tmpdir()}/claude-helper-`);
  try {
    return await runCommand([...cmd, ...CHILD_ISOLATION_FLAGS], { ...options, cwd: root });
  } finally {
    // Best-effort: a helper's verdict must not be lost to a failed directory removal.
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Stream the child's stdout line by line, stopping as soon as `onLine` returns a
 * value. Mirrors the `select`-driven read loop in run_eval.py, including its
 * detail that a trailing fragment with no newline is never parsed.
 *
 * stderr is discarded, matching the Python's `stderr=subprocess.DEVNULL`.
 */
export async function runStreamingLines<T>(
  cmd: readonly string[],
  options: StreamOptions,
  onLine: (line: string) => T | undefined,
): Promise<StreamOutcome<T>> {
  const deadline = startDeadline(options.timeoutMs);
  const spawned = trySpawn(() =>
    Bun.spawn([...cmd], {
      cwd: options.cwd,
      env: claudeEnv(),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
      signal: deadline.signal,
    }),
  );
  if (!spawned.ok) {
    deadline.clear();
    return { kind: "error", message: spawned.message };
  }
  const proc = spawned.proc;

  killOnAbort(deadline.signal, proc);

  try {
    return await readLines(proc, deadline, options.timeoutMs, onLine);
  } finally {
    deadline.clear();
    // The Python kills the child on every exit path -- early decision included.
    if (!hasExited(proc)) proc.kill("SIGKILL");
  }
}

interface LineSource {
  readonly stdout: ReadableStream<Uint8Array>;
  readonly exited: Promise<number>;
}

async function readLines<T>(
  proc: LineSource,
  deadline: Deadline,
  timeoutMs: number,
  onLine: (line: string) => T | undefined,
): Promise<StreamOutcome<T>> {
  const reader = proc.stdout.getReader();
  const detach = cancelOnAbort(deadline.signal, reader);
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      for (let newline = buffer.indexOf("\n"); newline !== -1; newline = buffer.indexOf("\n")) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line.length === 0) continue;
        const decision = onLine(line);
        if (decision !== undefined) return { kind: "decided", value: decision };
      }
    }
    if (deadline.expired()) return { kind: "timeout", timeoutMs };
    return { kind: "exhausted", exitCode: await proc.exited };
  } catch (error) {
    if (deadline.expired()) return { kind: "timeout", timeoutMs };
    return { kind: "error", message: describe(error) };
  } finally {
    detach();
    void reader.cancel().catch(() => undefined);
  }
}
