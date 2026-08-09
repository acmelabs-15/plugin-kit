/**
 * Per-run status files, so a long script in progress is distinguishable from a hung one.
 *
 * Every long-running entrypoint writes one JSON file per run into a predictable
 * directory; the dashboard discovers them by glob. That is deliberately a filesystem
 * convention rather than a registry: a registry has to be updated on both sides of
 * every run, and a run killed with SIGKILL never gets to deregister, so the registry
 * drifts and the drift is invisible. A glob over a directory cannot drift -- what is
 * on disk IS the answer -- and the same property makes the writer and the reader
 * independent processes with no shared handle.
 *
 * Two hazards this module exists to handle:
 *
 * - A HALF-WRITTEN FILE. The dashboard polls while the run writes, so a plain
 *   overwrite is readable mid-write and parses as malformed JSON. Every write here
 *   goes to a temp path and is then `rename`d, which is atomic within a filesystem:
 *   a reader sees either the whole previous file or the whole new one.
 * - A DEAD `running` FILE. A killed process cannot mark itself failed, so its status
 *   says `running` forever. Liveness is therefore derived from `updatedAt` rather
 *   than believed from `state`: past a threshold the run reads as stale. That makes
 *   the heartbeat load-bearing, which is why `report` rewrites the file even when no
 *   counter moved.
 */

import { rename, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";

import { mapWithConcurrency } from "./pool.ts";

/**
 * Terminal state of a run, as the run itself understands it.
 *
 * `stale` is deliberately NOT here. It is not something a run can claim about itself
 * -- a run that could write "I died" would not have died -- so it is derived at read
 * time by {@link classify} and lives on {@link DiscoveredRun} instead.
 */
export type RunState = "running" | "done" | "failed";

/**
 * Which script produced a status file. Drives the dashboard's grouping and links.
 *
 * `disclosure-loop` is `optimize-disclosure.ts`. It is its own kind rather than reusing
 * `description-loop` because the two optimize different variables and their rows carry
 * different detail -- one shows a train/test score over queries, the other shows body
 * tokens against a pass rate -- and a shared label would make a dashboard row lie about
 * which one is running.
 */
export type OperationKind =
  | "description-loop"
  | "disclosure-loop"
  | "eval-sweep"
  | "review"
  | "benchmark";

/**
 * Per-operation detail. Open-ended by design: the dashboard renders whatever is
 * present and nothing here is required, so a new operation kind can carry its own
 * fields without a schema change rippling through every writer.
 *
 * `iteration`/`maxIterations` and the score strings are what the description loop
 * hangs here; `label`-level summary belongs on the status itself.
 */
export interface RunDetail {
  readonly iteration?: number;
  readonly maxIterations?: number;
  readonly trainScore?: string;
  readonly testScore?: string;
  /** Free-form phase name, e.g. "baseline evaluation" or "improving description". */
  readonly phase?: string;
  /**
   * Absolute path to this run's own detail page.
   *
   * NOTE THE NESTING: this is `status.detail.reportPath`, not `status.reportPath`. The
   * dashboard's link helper reads it from here, so a writer that hangs it on the status
   * root instead produces a row with no link and no error -- the failure is silent,
   * which is why {@link RunDetail} is asserted by location in the test suite rather
   * than only by round trip.
   */
  readonly reportPath?: string;
  /**
   * Per-query tallies for an eval sweep, accumulated as attempts settle.
   *
   * Held on the status rather than in a separate file because the status is already
   * written atomically and polled, so a sweep's live page comes for free. A sweep is a
   * few dozen queries, so the size is bounded by the eval set rather than by run length
   * -- unlike an event log, which would grow without limit.
   */
  readonly queries?: readonly QueryProgress[];
  /**
   * Files the run produced, shown on its page once they exist.
   *
   * Paths rather than content: a benchmark's markdown is written once at the end, and
   * copying it into every heartbeat write would multiply the status file's size by the
   * number of ticks. The page reads them at serve time, so it shows the current file
   * rather than a snapshot taken when the path was recorded.
   */
  readonly artifactPaths?: readonly string[];
  /**
   * A URL this run already serves its own page at, when it is itself a server.
   *
   * `generate-review.ts` is one: it runs `Bun.serve` on port 3117 and renders the eval
   * viewer there, so its page exists and needs redirecting to rather than reproducing.
   * Distinct from `reportPath`, which names a FILE on disk -- a running server's page
   * has no file to read.
   */
  readonly externalUrl?: string;
  /**
   * Where this run persisted its results, when it was given somewhere to persist them.
   *
   * Recorded so a RETRY can resume rather than start over. The path is timestamped per
   * run, so it is not derivable from the command line -- without it recorded here, a
   * retry could only re-run from zero, which at roughly 12 minutes per iteration is
   * tens of minutes re-deriving answers already on disk.
   */
  readonly resultsDir?: string;
}

/**
 * One eval-set query's running tally.
 *
 * `triggered`/`settled` are counts rather than a verdict because the verdict depends on
 * `triggerThreshold` and is not decided until every attempt for the query has landed.
 * Reporting the raw counts lets the page show a rate that sharpens as evidence arrives,
 * instead of a pass/fail that could flip.
 */
export interface QueryProgress {
  readonly query: string;
  readonly should_trigger: boolean;
  readonly triggered: number;
  readonly settled: number;
  readonly total: number;
}

/**
 * One run's status, as serialized.
 *
 * Timestamps are epoch milliseconds rather than ISO strings: staleness is arithmetic
 * on them, and a numeric field cannot be compared wrongly the way two differently
 * offset ISO strings can.
 */
export interface RunStatus {
  /** Stable for the whole run, and the status file's basename. */
  readonly runId: string;
  readonly kind: OperationKind;
  /** Human-readable, shown as the dashboard's row title. */
  readonly label: string;
  readonly settled: number;
  readonly total: number;
  readonly startedAt: number;
  readonly updatedAt: number;
  readonly state: RunState;
  readonly detail: RunDetail;
  /** Set when `state` is `failed`, so the dashboard can show why. */
  readonly error?: string;
  /**
   * Writing process id, and the argv that started it.
   *
   * The first question about an apparently-stuck run is whether its process is still
   * alive, and a pid answers that directly -- `ps -p <pid>` or a kill. The command line
   * answers the second question, which is what the run was actually invoked with; a
   * label is a summary, and a detached run's real flags are otherwise unrecoverable
   * once the launching shell is gone.
   */
  readonly pid?: number;
  readonly commandLine?: string;
}

/** A discovered status plus the liveness the reader derived from it. */
export interface DiscoveredRun {
  readonly status: RunStatus;
  /** True when `state` is `running` but `updatedAt` is older than the threshold. */
  readonly stale: boolean;
  readonly path: string;
}

/**
 * How long a `running` status may go unrefreshed before it reads as stale.
 *
 * Sized against the slowest thing that legitimately blocks a heartbeat. Individual
 * `claude -p` calls were measured at 13s to 124s, and the description loop's improve
 * step is another such call, so a threshold near the measured ceiling would flag a
 * healthy run that is simply waiting on a slow child. 90s of slack past that ceiling
 * buys quiet at the cost of a dead run showing live for at most 90s -- the right
 * trade, since a false "hung" reading is what this whole module exists to prevent.
 */
export const STALE_AFTER_MS = 214_000;

/** Heartbeat period. Comfortably inside {@link STALE_AFTER_MS} so one slow tick cannot trip it. */
export const HEARTBEAT_MS = 5_000;

/**
 * How long a finished or stale run's status file is kept before {@link pruneRuns} deletes it.
 *
 * A JUDGEMENT, not a measurement -- there is no derivation to go looking for. A week keeps a
 * working fortnight's recent runs visible (you come back on a Monday and last Thursday's sweep
 * is still there) while bounding a directory that otherwise grows for the life of the machine.
 * Nothing reads a status file older than this: the report a run wrote lives in its own results
 * directory and outlives its status.
 *
 * A live run cannot reach this age: it rewrites its status every {@link HEARTBEAT_MS}, so its
 * `updatedAt` stays seconds old against a window of days. That ratio, rather than any exemption
 * for the `running` state, is what stops a prune deleting a file out from under a working
 * process -- see {@link pruneRuns}, which does prune a `running` run once it has gone stale.
 */
export const PRUNE_AFTER_MS = 7 * 24 * 60 * 60 * 1_000;

const STATUS_DIR_ENV = "SKILL_CREATOR_STATUS_DIR";

/**
 * Directory holding status files.
 *
 * Under the OS temp directory because a status file is per-run scratch that must not
 * land in the repository -- a dashboard is not evidence. The env var exists so tests
 * can point it somewhere disposable without racing a real run on the same machine.
 */
export function statusDir(): string {
  const configured = Bun.env[STATUS_DIR_ENV];
  if (configured !== undefined && configured !== "") return configured.replace(/\/+$/, "");
  return `${tmpdir()}/skill-creator-progress`;
}

/**
 * Sanitize a string for use in a filename.
 *
 * A run id reaches the filesystem as a path segment, so anything that could traverse
 * or escape has to go. Collapsing rather than rejecting keeps this usable for labels
 * derived from user-supplied skill paths.
 */
function slug(value: string): string {
  const cleaned = value
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    // Runs of dots collapse even though a separator-free `..` could not traverse:
    // a filename carrying `..` reads as a traversal attempt to anyone auditing the
    // directory, and a single dot is enough to keep names like `v1.2` legible.
    .replace(/\.{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return cleaned === "" ? "run" : cleaned.slice(0, 80);
}

/** Local-time `YYYYMMDD-HHMMSS`, matching the timestamp shape the loop already writes. */
function timestamp(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  return `${date}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/**
 * Build a run id that is unique per run and readable in a directory listing.
 *
 * The random suffix is what makes it unique: two runs of the same script started in
 * the same second are ordinary under a shell loop, and without the suffix the second
 * would overwrite the first's status and the dashboard would show one run where there
 * are two.
 */
export function newRunId(kind: OperationKind, subject: string, now: Date = new Date()): string {
  return `${kind}-${slug(subject)}-${timestamp(now)}-${crypto.randomUUID().slice(0, 6)}`;
}

/**
 * The command line that started this process, for the dashboard to display.
 *
 * Script path and arguments only -- the runtime's absolute path is dropped, because it
 * is identical for every run and long enough to push the interesting part off the row.
 * Truncated because an eval set can be passed as a long inline argument and an
 * unbounded field would dominate the status file.
 */
function currentCommandLine(): string {
  const [, script, ...args] = Bun.argv;
  const name = script === undefined ? "" : (script.split("/").pop() ?? script);
  const line = [name, ...args].join(" ").trim();
  return line.length > 500 ? `${line.slice(0, 497)}...` : line;
}

/** Validate one parsed status file. Returns null rather than throwing: a bad file is skipped, not fatal. */
export function parseRunStatus(value: unknown): RunStatus | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;

  const runId = record["runId"];
  const kind = record["kind"];
  const label = record["label"];
  const settled = record["settled"];
  const total = record["total"];
  const startedAt = record["startedAt"];
  const updatedAt = record["updatedAt"];
  const state = record["state"];

  if (typeof runId !== "string" || runId === "") return null;
  if (
    kind !== "description-loop" &&
    kind !== "disclosure-loop" &&
    kind !== "eval-sweep" &&
    kind !== "review" &&
    kind !== "benchmark"
  ) {
    return null;
  }
  if (typeof label !== "string") return null;
  if (typeof settled !== "number" || !Number.isFinite(settled)) return null;
  if (typeof total !== "number" || !Number.isFinite(total)) return null;
  if (typeof startedAt !== "number" || !Number.isFinite(startedAt)) return null;
  if (typeof updatedAt !== "number" || !Number.isFinite(updatedAt)) return null;
  if (state !== "running" && state !== "done" && state !== "failed") return null;

  const error = record["error"];
  const pid = record["pid"];
  const commandLine = record["commandLine"];
  return {
    runId,
    kind,
    label,
    settled,
    total,
    startedAt,
    updatedAt,
    state,
    detail: parseDetail(record["detail"]),
    ...(typeof error === "string" ? { error } : {}),
    ...(typeof pid === "number" && Number.isInteger(pid) ? { pid } : {}),
    ...(typeof commandLine === "string" ? { commandLine } : {}),
  };
}

/** Every field optional, so an unknown or partial detail degrades to an empty one. */
function parseDetail(value: unknown): RunDetail {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const num = (key: string): number | undefined => {
    const raw = record[key];
    return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
  };
  const str = (key: string): string | undefined => {
    const raw = record[key];
    return typeof raw === "string" ? raw : undefined;
  };

  const iteration = num("iteration");
  const maxIterations = num("maxIterations");
  const trainScore = str("trainScore");
  const testScore = str("testScore");
  const phase = str("phase");
  const reportPath = str("reportPath");
  const queries = parseQueries(record["queries"]);
  const externalUrl = str("externalUrl");
  const persistedResultsDir = str("resultsDir");
  const rawPaths = record["artifactPaths"];
  const artifactPaths = Array.isArray(rawPaths)
    ? rawPaths.filter((entry): entry is string => typeof entry === "string")
    : undefined;

  return {
    ...(iteration === undefined ? {} : { iteration }),
    ...(maxIterations === undefined ? {} : { maxIterations }),
    ...(trainScore === undefined ? {} : { trainScore }),
    ...(testScore === undefined ? {} : { testScore }),
    ...(phase === undefined ? {} : { phase }),
    ...(reportPath === undefined ? {} : { reportPath }),
    ...(queries === undefined ? {} : { queries }),
    ...(artifactPaths === undefined ? {} : { artifactPaths }),
    ...(externalUrl === undefined ? {} : { externalUrl }),
    ...(persistedResultsDir === undefined ? {} : { resultsDir: persistedResultsDir }),
  };
}

/** Drop any row that is not fully well-formed, rather than rendering a half-row. */
function parseQueries(value: unknown): readonly QueryProgress[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const rows: QueryProgress[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) continue;
    const row = raw as Record<string, unknown>;
    const query = row["query"];
    const shouldTrigger = row["should_trigger"];
    const triggered = row["triggered"];
    const settled = row["settled"];
    const total = row["total"];
    if (typeof query !== "string" || typeof shouldTrigger !== "boolean") continue;
    if (typeof triggered !== "number" || typeof settled !== "number" || typeof total !== "number") {
      continue;
    }
    rows.push({ query, should_trigger: shouldTrigger, triggered, settled, total });
  }
  return rows;
}

/** Derive liveness from `updatedAt`. A `running` status that stopped being refreshed is stale. */
export function classify(status: RunStatus, now: number, staleAfterMs = STALE_AFTER_MS): DiscoveredRun {
  return {
    status,
    stale: status.state === "running" && now - status.updatedAt > staleAfterMs,
    path: `${statusDir()}/${status.runId}.json`,
  };
}

/**
 * Time remaining, projected from observed completions.
 *
 * Returns null until at least one item has settled, because there is nothing to
 * project from and a wall-clock guess is exactly what this replaces. Per-item
 * durations were measured at 13s to 124s, so the linear extrapolation below is
 * approximate by nature -- present it as such rather than as a countdown.
 */
export function projectRemainingMs(status: RunStatus, now: number): number | null {
  if (status.settled <= 0 || status.total <= 0 || status.settled >= status.total) return null;
  const elapsed = now - status.startedAt;
  if (elapsed <= 0) return null;
  const perItem = elapsed / status.settled;
  return Math.max(0, Math.round(perItem * (status.total - status.settled)));
}

/**
 * Live handle on one run's status file.
 *
 * Holds the current status in memory and rewrites the whole file on every change, so
 * the file is always a complete snapshot rather than a log to be replayed. Writes are
 * fire-and-forget from the caller's perspective ({@link report} is synchronous) so
 * that instrumenting a hot callback cannot add an await to it; the write is serialized
 * internally, so a burst of reports cannot interleave into a torn file.
 */
export class ProgressReporter {
  #status: RunStatus;
  /** Chained so two overlapping reports cannot rename out of order. */
  #writing: Promise<void> = Promise.resolve();
  #heartbeat: ReturnType<typeof setInterval> | null = null;
  #closed = false;
  /** Retained so `finish` can detach them; a listener outliving its run leaks the reporter. */
  #signalHandlers: [NodeJS.Signals, () => void][] = [];
  /** What a signal means for this run: the end of a server, or the interruption of a job. */
  #signalState: "done" | "failed" = "failed";

  private constructor(status: RunStatus) {
    this.#status = status;
  }

  /**
   * Open a status file for a new run and start its heartbeat.
   *
   * The heartbeat is `unref`'d, so it never holds the process open at exit -- a
   * progress reporter that keeps a finished CLI alive would be a worse bug than the
   * one this module fixes.
   */
  static start(params: {
    readonly kind: OperationKind;
    readonly label: string;
    readonly total: number;
    readonly subject?: string;
    readonly detail?: RunDetail;
    readonly runId?: string;
    /**
     * What a SIGINT/SIGTERM means for this run.
     *
     * `"done"` for a server whose documented way to stop is Ctrl-C -- otherwise a
     * shutdown exactly as documented shows up as a red `failed` row. `"failed"` (the
     * default) for a batch job, where a signal partway through is a real interruption.
     */
    readonly signalMeans?: "done" | "failed";
  }): ProgressReporter {
    const now = Date.now();
    const reporter = new ProgressReporter({
      runId: params.runId ?? newRunId(params.kind, params.subject ?? params.label),
      kind: params.kind,
      label: params.label,
      settled: 0,
      total: params.total,
      startedAt: now,
      updatedAt: now,
      state: "running",
      detail: params.detail ?? {},
      pid: process.pid,
      commandLine: currentCommandLine(),
    });

    reporter.#signalState = params.signalMeans ?? "failed";
    reporter.#flush();
    const timer = setInterval(() => reporter.#beat(), HEARTBEAT_MS);
    timer.unref();
    reporter.#heartbeat = timer;
    reporter.#installSignalHandlers();
    return reporter;
  }

  /**
   * Record a terminal state when the process is signalled.
   *
   * A detached run is stopped by a signal far more often than it ends by returning, and
   * without this it leaves `running` on disk -- the exact ambiguity the whole module
   * exists to remove. Stale detection would eventually catch it, but that takes minutes
   * and reports "no longer reporting" rather than the truth, which is that someone
   * stopped it deliberately.
   *
   * The default disposition of both signals is to terminate, and adding a listener
   * SUPPRESSES that, so each handler must exit explicitly or a Ctrl-C would leave the
   * process running and unkillable by ordinary means. Re-raising after `finish` rather
   * than calling `process.exit` preserves the conventional 128+signal exit code.
   *
   * The recorded state depends on {@link signalState}. A long-running SERVER is stopped
   * by a signal as its normal end -- that is how the docs say to stop it -- so recording
   * `failed` there paints a deliberate shutdown red. A batch job interrupted partway
   * genuinely did fail. Callers declare which they are; the default is `failed`, because
   * a batch job is the common case and a wrong `done` would hide a real interruption.
   */
  #installSignalHandlers(): void {
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      const handler = (): void => {
        const [state, error] =
          this.#signalState === "done"
            ? (["done", undefined] as const)
            : (["failed", `terminated by ${signal}`] as const);
        void this.finish(state, error).then(() => {
          process.removeListener(signal, handler);
          process.kill(process.pid, signal);
        });
      };
      this.#signalHandlers.push([signal, handler]);
      process.once(signal, handler);
    }
  }

  get runId(): string {
    return this.#status.runId;
  }

  get statusPath(): string {
    return `${statusDir()}/${this.#status.runId}.json`;
  }

  /** Current in-memory status. Exposed for tests and for callers that log a summary. */
  get status(): RunStatus {
    return this.#status;
  }

  /**
   * Record progress. Synchronous by design: this is called from `onSettled`, inside a
   * `finally` in the concurrency pool, where returning a promise would make every
   * completion await a filesystem write.
   */
  report(settled: number, total: number = this.#status.total): void {
    if (this.#closed) return;
    this.#status = { ...this.#status, settled, total, updatedAt: Date.now() };
    this.#flush();
  }

  /** Merge per-operation detail, leaving counters alone. */
  update(detail: RunDetail, overrides: { readonly total?: number; readonly settled?: number } = {}): void {
    if (this.#closed) return;
    this.#status = {
      ...this.#status,
      ...(overrides.total === undefined ? {} : { total: overrides.total }),
      ...(overrides.settled === undefined ? {} : { settled: overrides.settled }),
      detail: { ...this.#status.detail, ...detail },
      updatedAt: Date.now(),
    };
    this.#flush();
  }

  /**
   * Mark the run finished and stop the heartbeat.
   *
   * Awaits the pending write chain, which is the one place that matters: without it a
   * CLI can exit between the final rename being queued and it landing, leaving the
   * dashboard showing a run that stopped at 59/60 and then went stale.
   */
  async finish(state: Exclude<RunState, "running">, error?: string): Promise<void> {
    if (this.#closed) return;
    if (this.#heartbeat !== null) {
      clearInterval(this.#heartbeat);
      this.#heartbeat = null;
    }
    // Detached before the write, so a signal arriving during a normal shutdown cannot
    // re-enter and overwrite a `done` with `failed`.
    for (const [signal, handler] of this.#signalHandlers) process.removeListener(signal, handler);
    this.#signalHandlers = [];
    this.#status = {
      ...this.#status,
      state,
      updatedAt: Date.now(),
      ...(error === undefined ? {} : { error }),
    };
    this.#closed = true;
    this.#flush();
    await this.#writing;
  }

  /** Refresh `updatedAt` with no other change, so a run blocked on a slow child stays live. */
  #beat(): void {
    if (this.#closed) return;
    this.#status = { ...this.#status, updatedAt: Date.now() };
    this.#flush();
  }

  /**
   * Queue an atomic write of the current status.
   *
   * Serialized through `#writing` rather than fired in parallel: two concurrent
   * renames onto the same target can land in either order, so a burst could leave the
   * OLDER snapshot in place. Errors are swallowed deliberately -- progress reporting
   * is observability, and a full disk or a pruned directory must not take down the
   * run it is only describing.
   */
  #flush(): void {
    const snapshot = this.#status;
    this.#writing = this.#writing.then(() => writeStatusAtomically(snapshot)).catch(() => undefined);
  }
}

/**
 * Write a status file atomically: full write to a unique temp path, then rename.
 *
 * The temp name carries a random suffix so two writers -- the heartbeat and an
 * in-flight `report` -- can never share a temp path. `Bun.write` creates the parent
 * directory on first write, which covers directory creation without a separate mkdir.
 */
export async function writeStatusAtomically(status: RunStatus): Promise<void> {
  const directory = statusDir();
  const target = `${directory}/${status.runId}.json`;
  const temporary = `${target}.${crypto.randomUUID().slice(0, 8)}.tmp`;

  await Bun.write(temporary, `${JSON.stringify(status, null, 2)}\n`);
  try {
    await rename(temporary, target);
  } catch (error) {
    // Leave nothing behind if the rename failed; an orphaned .tmp would otherwise be
    // globbed forever. The glob filters by extension, so this is belt and braces.
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

/**
 * Read every status file, newest first, with liveness derived per run.
 *
 * A missing directory yields an empty list rather than an error: no runs have ever
 * been recorded is a normal state for a fresh checkout, not a failure. Bun's glob
 * throws ENOENT on a missing cwd, so that case is caught rather than assumed.
 */
export async function discoverRuns(
  now: number = Date.now(),
  staleAfterMs = STALE_AFTER_MS,
): Promise<readonly DiscoveredRun[]> {
  const directory = statusDir();
  let names: string[];
  try {
    names = await Array.fromAsync(new Bun.Glob("*.json").scan({ cwd: directory, onlyFiles: true }));
  } catch {
    return [];
  }

  // Read overlapped rather than one after another. The reads are independent and each is
  // a few kilobytes, so serializing them was pure latency: measured on this box, 168
  // status files took 18.5ms serially and 2,000 took 198ms, against 8.5ms and 70ms
  // overlapped. That matters twice over -- `ensureDashboard` awaits a prune on every run
  // launch, and the dashboard re-reads the whole directory on every poll.
  //
  // Input order is preserved by `mapWithConcurrency`, which the sort below depends on:
  // `Array.prototype.sort` is stable, so runs with equal `updatedAt` keep the order the
  // glob produced rather than whichever read happened to land first.
  const payloads = await mapWithConcurrency(names, READ_CONCURRENCY, (name) =>
    readJson(`${directory}/${name}`),
  );

  const runs: DiscoveredRun[] = [];
  for (const payload of payloads) {
    const status = parseRunStatus(payload);
    // A file mid-rename or hand-edited into nonsense is skipped rather than rendered
    // as a broken row, since the dashboard has nothing useful to say about it.
    if (status !== null) runs.push(classify(status, now, staleAfterMs));
  }

  runs.sort((a, b) => b.status.updatedAt - a.status.updatedAt);
  return runs;
}

/**
 * Status files read at once.
 *
 * Bounded because a status directory has no ceiling -- a machine left running for a
 * fortnight accumulates thousands -- and a few thousand simultaneous opens is how a
 * dashboard poll turns into `EMFILE`.
 */
const READ_CONCURRENCY = 32;

async function readJson(path: string): Promise<unknown> {
  try {
    return await Bun.file(path).json();
  } catch {
    return null;
  }
}

/**
 * Delete status files for finished or stale runs older than `maxAgeMs`.
 *
 * Without this the directory grows without bound and the dashboard's "recently
 * finished" list becomes a full history nobody asked for.
 *
 * A run still `running` is eligible only once it has ALSO gone stale, since nothing will
 * finish it. What keeps this from deleting a status file out from under a live process is
 * the ratio rather than the state: a live run rewrites its status every
 * {@link HEARTBEAT_MS}, so its `updatedAt` sits seconds old against a window measured in
 * days, and it cannot reach the age bound while alive.
 */
export async function pruneRuns(maxAgeMs: number, now: number = Date.now()): Promise<number> {
  let removed = 0;
  for (const run of await discoverRuns(now)) {
    const finished = run.status.state !== "running" || run.stale;
    if (!finished || now - run.status.updatedAt <= maxAgeMs) continue;
    try {
      await unlink(run.path);
      removed += 1;
    } catch {
      // Already gone, or not ours to delete. Either way there is nothing to report.
    }
  }
  return removed;
}
