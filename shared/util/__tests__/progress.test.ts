/**
 * Tests for the run-status layer behind the dashboard.
 *
 * Driven with synthetic statuses and real files in a disposable directory rather than
 * with mocks: the two properties worth testing here are both filesystem properties --
 * a reader never sees a torn file, and a killed writer reads as stale -- and a mocked
 * filesystem would assert neither.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

import {
  classify,
  discoverRuns,
  newRunId,
  parseRunStatus,
  ProgressReporter,
  projectRemainingMs,
  PRUNE_AFTER_MS,
  pruneRuns,
  STALE_AFTER_MS,
  statusDir,
  writeStatusAtomically,
  type RunStatus,
} from "../progress.ts";

const STATUS_DIR_ENV = "SKILL_CREATOR_STATUS_DIR";

let scratch: string;
let previousDir: string | undefined;

beforeEach(async () => {
  previousDir = Bun.env[STATUS_DIR_ENV];
  scratch = await mkdtemp(`${tmpdir()}/progress-test-`);
  Bun.env[STATUS_DIR_ENV] = scratch;
});

afterEach(async () => {
  if (previousDir === undefined) delete Bun.env[STATUS_DIR_ENV];
  else Bun.env[STATUS_DIR_ENV] = previousDir;
  await rm(scratch, { recursive: true, force: true });
});

function status(overrides: Partial<RunStatus> = {}): RunStatus {
  return {
    runId: "eval-sweep-demo-20260802-120000-abcdef",
    kind: "eval-sweep",
    label: "demo",
    settled: 0,
    total: 60,
    startedAt: 1_000_000,
    updatedAt: 1_000_000,
    state: "running",
    detail: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Status directory and ids
// ---------------------------------------------------------------------------

describe("statusDir", () => {
  test("honours the env override so a test never writes beside a real run", () => {
    expect(statusDir()).toBe(scratch);
  });

  test("strips trailing slashes, so a path join cannot double them", () => {
    Bun.env[STATUS_DIR_ENV] = `${scratch}///`;
    expect(statusDir()).toBe(scratch);
  });
});

describe("newRunId", () => {
  test("carries the kind and a sanitized subject", () => {
    const id = newRunId("description-loop", "skill-creator", new Date(2026, 7, 2, 13, 4, 5));
    expect(id.startsWith("description-loop-skill-creator-20260802-130405-")).toBe(true);
  });

  test("collapses path separators, so a skill path cannot escape the directory", () => {
    const id = newRunId("eval-sweep", "../../etc/passwd");
    expect(id).not.toContain("/");
    expect(id).not.toContain("..");
  });

  test("two runs started in the same second get different ids", () => {
    const now = new Date(2026, 7, 2, 13, 4, 5);
    expect(newRunId("eval-sweep", "x", now)).not.toBe(newRunId("eval-sweep", "x", now));
  });
});

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

describe("parseRunStatus", () => {
  test("accepts a well-formed status", () => {
    expect(parseRunStatus(JSON.parse(JSON.stringify(status())))).toEqual(status());
  });

  test.each([
    ["a non-object", "nope"],
    ["null", null],
    ["an array", [1, 2]],
  ])("rejects %s", (_label, value) => {
    expect(parseRunStatus(value)).toBeNull();
  });

  test.each(["runId", "kind", "label", "settled", "total", "startedAt", "updatedAt", "state"])(
    "rejects a status missing %s",
    (field) => {
      const partial: Record<string, unknown> = JSON.parse(JSON.stringify(status()));
      delete partial[field];
      expect(parseRunStatus(partial)).toBeNull();
    },
  );

  test("rejects an unknown kind rather than rendering an unlinkable row", () => {
    expect(parseRunStatus({ ...status(), kind: "something-else" })).toBeNull();
  });

  test("rejects an unknown state", () => {
    expect(parseRunStatus({ ...status(), state: "stale" })).toBeNull();
  });

  test("keeps an error string when present", () => {
    const parsed = parseRunStatus({ ...status({ state: "failed" }), error: "boom" });
    expect(parsed?.error).toBe("boom");
  });

  test("drops a non-string error rather than passing it through to the page", () => {
    const parsed = parseRunStatus({ ...status({ state: "failed" }), error: 7 });
    expect(parsed?.error).toBeUndefined();
  });

  test("keeps recognized detail fields and ignores the rest", () => {
    const parsed = parseRunStatus({
      ...status(),
      detail: { iteration: 2, maxIterations: 5, trainScore: "8/12", junk: { nested: true } },
    });
    expect(parsed?.detail).toEqual({ iteration: 2, maxIterations: 5, trainScore: "8/12" });
  });

  test("degrades a malformed detail to an empty one instead of failing the whole status", () => {
    expect(parseRunStatus({ ...status(), detail: "nonsense" })?.detail).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Staleness
// ---------------------------------------------------------------------------

describe("classify", () => {
  test("a freshly updated running run is live", () => {
    const now = 5_000_000;
    expect(classify(status({ updatedAt: now - 1_000 }), now).stale).toBe(false);
  });

  test("a running run whose heartbeat stopped is stale", () => {
    // The killed-process case: nothing rewrote the file, so `state` still says running.
    const now = 5_000_000;
    const run = classify(status({ updatedAt: now - STALE_AFTER_MS - 1 }), now);
    expect(run.status.state).toBe("running");
    expect(run.stale).toBe(true);
  });

  test("exactly at the threshold is not yet stale", () => {
    const now = 5_000_000;
    expect(classify(status({ updatedAt: now - STALE_AFTER_MS }), now).stale).toBe(false);
  });

  test("a finished run is never stale, however old", () => {
    // Staleness names a run that stopped reporting while claiming to run. A done run
    // is not claiming anything, so age alone must not relabel it.
    const now = 9_000_000_000;
    expect(classify(status({ state: "done", updatedAt: 1 }), now).stale).toBe(false);
    expect(classify(status({ state: "failed", updatedAt: 1 }), now).stale).toBe(false);
  });

  test("the threshold clears the measured per-call ceiling", () => {
    // Individual `claude -p` calls were measured at up to 124s. A threshold at or
    // below that would flag a healthy run waiting on one slow child.
    expect(STALE_AFTER_MS).toBeGreaterThan(124_000);
  });
});

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

describe("projectRemainingMs", () => {
  test("is null before anything has settled, since there is nothing to project from", () => {
    expect(projectRemainingMs(status({ settled: 0 }), 1_010_000)).toBeNull();
  });

  test("extrapolates linearly from observed completions", () => {
    // 10 of 60 in 100s -> 10s per item -> 500s left.
    const projected = projectRemainingMs(
      status({ settled: 10, total: 60, startedAt: 1_000_000 }),
      1_100_000,
    );
    expect(projected).toBe(500_000);
  });

  test("is null once everything has settled", () => {
    expect(projectRemainingMs(status({ settled: 60, total: 60 }), 1_100_000)).toBeNull();
  });

  test("is null for a zero-total run rather than dividing by it", () => {
    expect(projectRemainingMs(status({ settled: 0, total: 0 }), 1_100_000)).toBeNull();
  });

  test("is null when now precedes startedAt, rather than reporting negative time", () => {
    expect(projectRemainingMs(status({ settled: 5 }), 999_000)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Atomic writes
// ---------------------------------------------------------------------------

describe("writeStatusAtomically", () => {
  test("writes a file a reader can parse", async () => {
    await writeStatusAtomically(status());
    expect(parseRunStatus(await Bun.file(`${scratch}/${status().runId}.json`).json())).toEqual(status());
  });

  test("leaves no temp file behind", async () => {
    await writeStatusAtomically(status());
    const names = await Array.fromAsync(new Bun.Glob("*").scan({ cwd: scratch, onlyFiles: true }));
    expect(names).toEqual([`${status().runId}.json`]);
  });

  test("replaces an existing file rather than appending to it", async () => {
    await writeStatusAtomically(status({ settled: 1 }));
    await writeStatusAtomically(status({ settled: 2 }));
    const parsed = parseRunStatus(await Bun.file(`${scratch}/${status().runId}.json`).json());
    expect(parsed?.settled).toBe(2);
  });

  test("every interleaved read sees a complete status, never a fragment", async () => {
    // The property the temp-then-rename dance exists for. A plain overwrite is
    // readable mid-write, and a reader polling a large file catches a prefix of it.
    const writes = Array.from({ length: 40 }, (_, i) =>
      writeStatusAtomically(status({ settled: i, detail: { phase: "x".repeat(4_000) } })),
    );
    const reads = Array.from({ length: 40 }, async () => {
      await Bun.sleep(1);
      try {
        return parseRunStatus(await Bun.file(`${scratch}/${status().runId}.json`).json());
      } catch {
        return "TORN" as const;
      }
    });

    const [, observed] = await Promise.all([Promise.all(writes), Promise.all(reads)]);
    expect(observed).not.toContain("TORN");
    // A null would mean a parsed-but-invalid file, which is the other torn shape.
    expect(observed.filter((value) => value === null)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

describe("discoverRuns", () => {
  test("returns nothing when the directory has never been created", async () => {
    Bun.env[STATUS_DIR_ENV] = `${scratch}/never-made`;
    expect(await discoverRuns()).toEqual([]);
  });

  test("finds every status file", async () => {
    await writeStatusAtomically(status({ runId: "a", updatedAt: 10 }));
    await writeStatusAtomically(status({ runId: "b", updatedAt: 20 }));
    expect((await discoverRuns()).map((run) => run.status.runId)).toEqual(["b", "a"]);
  });

  test("orders newest-updated first", async () => {
    await writeStatusAtomically(status({ runId: "old", updatedAt: 100 }));
    await writeStatusAtomically(status({ runId: "new", updatedAt: 300 }));
    await writeStatusAtomically(status({ runId: "mid", updatedAt: 200 }));
    expect((await discoverRuns()).map((run) => run.status.runId)).toEqual(["new", "mid", "old"]);
  });

  test("skips a malformed file rather than failing the whole discovery", async () => {
    await writeStatusAtomically(status({ runId: "good" }));
    await Bun.write(`${scratch}/broken.json`, "{ not json");
    await Bun.write(`${scratch}/wrong-shape.json`, JSON.stringify({ hello: "world" }));

    const found = await discoverRuns();
    expect(found.map((run) => run.status.runId)).toEqual(["good"]);
  });

  test("ignores non-JSON files in the directory", async () => {
    await writeStatusAtomically(status({ runId: "good" }));
    await Bun.write(`${scratch}/notes.txt`, "ignore me");
    expect((await discoverRuns()).length).toBe(1);
  });

  test("marks a run stale by its own updatedAt, per run", async () => {
    const now = 5_000_000;
    await writeStatusAtomically(status({ runId: "live", updatedAt: now - 1_000 }));
    await writeStatusAtomically(status({ runId: "dead", updatedAt: now - STALE_AFTER_MS - 1 }));

    const byId = new Map((await discoverRuns(now)).map((run) => [run.status.runId, run.stale]));
    expect(byId.get("live")).toBe(false);
    expect(byId.get("dead")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Pruning
// ---------------------------------------------------------------------------

describe("pruneRuns", () => {
  test("removes a finished run past the age limit", async () => {
    const now = 5_000_000;
    await writeStatusAtomically(status({ runId: "old-done", state: "done", updatedAt: now - 10_000 }));
    expect(await pruneRuns(5_000, now)).toBe(1);
    expect(await discoverRuns(now)).toEqual([]);
  });

  test("keeps a finished run inside the age limit", async () => {
    const now = 5_000_000;
    await writeStatusAtomically(status({ runId: "fresh-done", state: "done", updatedAt: now - 1_000 }));
    expect(await pruneRuns(5_000, now)).toBe(0);
    expect((await discoverRuns(now)).length).toBe(1);
  });

  test("never removes a running run that is still refreshing its status", async () => {
    // A run legitimately taking hours must not be pruned out from under its own dashboard.
    // Note it is the refreshing that spares it, not the state: the run below is well past
    // the age window and survives only because it is not yet stale.
    const now = 5_000_000;
    await writeStatusAtomically(status({ runId: "long", state: "running", updatedAt: now - 1_000 }));
    expect(await pruneRuns(500, now)).toBe(0);
    expect((await discoverRuns(now)).length).toBe(1);
  });

  test("removes a stale running run, since nothing will ever finish it", async () => {
    const now = 9_000_000;
    await writeStatusAtomically(status({ runId: "killed", state: "running", updatedAt: 1_000 }));
    expect(await pruneRuns(5_000, now)).toBe(1);
  });

  test("the retention window is a week, and comfortably outlives staleness", async () => {
    // A judgement rather than a measurement, so this asserts the decision itself. The second
    // assertion is the invariant that matters: a window shorter than the stale threshold would
    // delete runs while they were still being classified as merely slow.
    expect(PRUNE_AFTER_MS).toBe(604_800_000);
    expect(PRUNE_AFTER_MS).toBeGreaterThan(STALE_AFTER_MS);
  });

  test("prunes at exactly a week's age under the shipped window", async () => {
    // The window is only meaningful if a real week-old run is actually eligible, so this
    // exercises the shipped constant rather than a convenient small one.
    const now = 2_000_000_000_000;
    await writeStatusAtomically(
      status({ runId: "week-old", state: "done", updatedAt: now - PRUNE_AFTER_MS - 1 }),
    );
    await writeStatusAtomically(
      status({ runId: "six-days", state: "done", updatedAt: now - PRUNE_AFTER_MS + 1 }),
    );

    expect(await pruneRuns(PRUNE_AFTER_MS, now)).toBe(1);
    expect((await discoverRuns(now)).map((run) => run.status.runId)).toEqual(["six-days"]);
  });
});

// ---------------------------------------------------------------------------
// Reporter lifecycle
// ---------------------------------------------------------------------------

describe("ProgressReporter", () => {
  test("writes a running status as soon as it starts", async () => {
    const reporter = ProgressReporter.start({ kind: "eval-sweep", label: "demo", total: 60 });
    await reporter.finish("done");

    const found = await discoverRuns();
    expect(found.length).toBe(1);
    expect(found[0]?.status.total).toBe(60);
  });

  test("report() advances the counters", async () => {
    const reporter = ProgressReporter.start({ kind: "eval-sweep", label: "demo", total: 4 });
    reporter.report(1);
    reporter.report(2);
    await reporter.finish("done");

    expect((await discoverRuns())[0]?.status.settled).toBe(2);
  });

  test("the last report wins even when several are queued back to back", async () => {
    // Serialized writes: without the chain two renames can land out of order and the
    // file keeps the older snapshot.
    const reporter = ProgressReporter.start({ kind: "eval-sweep", label: "demo", total: 50 });
    for (let i = 1; i <= 50; i += 1) reporter.report(i);
    await reporter.finish("done");

    expect((await discoverRuns())[0]?.status.settled).toBe(50);
  });

  test("update() merges detail without disturbing the counters", async () => {
    const reporter = ProgressReporter.start({ kind: "description-loop", label: "loop", total: 10 });
    reporter.report(3);
    reporter.update({ iteration: 2 });
    reporter.update({ trainScore: "7/12" });
    await reporter.finish("done");

    const found = (await discoverRuns())[0]?.status;
    expect(found?.settled).toBe(3);
    expect(found?.detail).toEqual({ iteration: 2, trainScore: "7/12" });
  });

  test("update() can retarget the total, for a run whose size is not known up front", async () => {
    const reporter = ProgressReporter.start({ kind: "description-loop", label: "loop", total: 0 });
    reporter.update({ phase: "iteration 1" }, { total: 36, settled: 0 });
    await reporter.finish("done");

    expect((await discoverRuns())[0]?.status.total).toBe(36);
  });

  test("finish() records the terminal state", async () => {
    const reporter = ProgressReporter.start({ kind: "eval-sweep", label: "demo", total: 1 });
    await reporter.finish("failed", "spawn failed");

    const found = (await discoverRuns())[0]?.status;
    expect(found?.state).toBe("failed");
    expect(found?.error).toBe("spawn failed");
  });

  test("the final write has landed by the time finish() resolves", async () => {
    // The exit race: a CLI that exits on the heels of finish() must not leave the
    // dashboard showing a run frozen one item short.
    const reporter = ProgressReporter.start({ kind: "eval-sweep", label: "demo", total: 3 });
    reporter.report(3);
    await reporter.finish("done");

    const parsed = parseRunStatus(await Bun.file(reporter.statusPath).json());
    expect(parsed?.settled).toBe(3);
    expect(parsed?.state).toBe("done");
  });

  test("reports after finish() are ignored, so a late callback cannot revive the run", async () => {
    const reporter = ProgressReporter.start({ kind: "eval-sweep", label: "demo", total: 3 });
    await reporter.finish("done");
    reporter.report(99);
    reporter.update({ phase: "should not appear" });
    await Bun.sleep(10);

    const parsed = parseRunStatus(await Bun.file(reporter.statusPath).json());
    expect(parsed?.state).toBe("done");
    expect(parsed?.settled).toBe(0);
    expect(parsed?.detail).toEqual({});
  });

  test("a second finish() is a no-op rather than an error", async () => {
    const reporter = ProgressReporter.start({ kind: "eval-sweep", label: "demo", total: 1 });
    await reporter.finish("done");
    await reporter.finish("failed", "late");

    expect((await discoverRuns())[0]?.status.state).toBe("done");
  });

  test("an explicit runId is used verbatim, so a caller can pre-allocate one", async () => {
    const reporter = ProgressReporter.start({
      kind: "review",
      label: "viewer",
      total: 1,
      runId: "chosen-id",
    });
    expect(reporter.runId).toBe("chosen-id");
    expect(reporter.statusPath).toBe(`${scratch}/chosen-id.json`);
    await reporter.finish("done");
  });

  test("records the writing pid, so a stuck run can be checked with ps", async () => {
    const reporter = ProgressReporter.start({ kind: "eval-sweep", label: "demo", total: 1 });
    await reporter.finish("done");
    expect((await discoverRuns())[0]?.status.pid).toBe(process.pid);
  });

  test("records the command line, which is unrecoverable once the launching shell is gone", async () => {
    const reporter = ProgressReporter.start({ kind: "eval-sweep", label: "demo", total: 1 });
    await reporter.finish("done");
    const commandLine = (await discoverRuns())[0]?.status.commandLine;
    // Bun runs this suite, so the recorded line names the test runner rather than a
    // script -- what matters is that something was captured and the runtime's absolute
    // path was not.
    expect(typeof commandLine).toBe("string");
    expect(commandLine).not.toContain("/bin/bun");
  });

  test("detaches its signal handlers on finish, so a stopped run cannot be reopened", async () => {
    // A listener outliving its reporter both leaks it and lets a later Ctrl-C overwrite
    // a `done` with `failed`.
    const before = process.listenerCount("SIGINT");
    const reporter = ProgressReporter.start({ kind: "eval-sweep", label: "demo", total: 1 });
    expect(process.listenerCount("SIGINT")).toBe(before + 1);
    await reporter.finish("done");
    expect(process.listenerCount("SIGINT")).toBe(before);
  });

  test("a write failure does not propagate to the run it is describing", async () => {
    // Observability must never be able to fail the work. Pointing the directory at a
    // path that cannot hold files makes every write throw.
    await Bun.write(`${scratch}/not-a-dir`, "x");
    Bun.env[STATUS_DIR_ENV] = `${scratch}/not-a-dir`;

    const reporter = ProgressReporter.start({ kind: "eval-sweep", label: "demo", total: 2 });
    reporter.report(1);
    await reporter.finish("done");
    expect(reporter.status.state).toBe("done");
  });
});
