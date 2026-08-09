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

/** Anything env-shaped. Injectable so the merge is testable without mutating the real env. */
export type EnvSource = Readonly<Record<string, string | undefined>>;

/**
 * Set by Claude Code to guard against interactive terminal conflicts. Dropping it
 * is what makes a nested `claude -p` call legal; programmatic subprocess use is safe.
 */
const NESTED_SESSION_GUARD = "CLAUDECODE";

/**
 * The full parent environment minus the nested-session guard.
 *
 * Mirrors `{k: v for k, v in os.environ.items() if k != "CLAUDECODE"}`. Keys whose
 * value is `undefined` are dropped, since `Bun.spawn` wants a string-valued record.
 */
export function claudeEnv(source: EnvSource = Bun.env): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (key === NESTED_SESSION_GUARD) continue;
    if (value === undefined) continue;
    merged[key] = value;
  }
  return merged;
}

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
