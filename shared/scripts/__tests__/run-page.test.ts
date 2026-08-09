/**
 * Tests for the shared per-run page, and for the per-attempt progress signal that makes
 * an eval sweep's page live rather than empty until the end.
 *
 * The page is asserted through its embedded payload and its rendered body, because the
 * requirement is about what a reader sees mid-run: a bar and rows that fill in. Driven
 * from real status files, as the rest of this suite is.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

import { renderRunPage, type RunPagePayload } from "../../eval-viewer/generate-dashboard.ts";
import { mapWithConcurrency } from "../../util/pool.ts";
import { classify, type DiscoveredRun, type RunStatus } from "../../util/progress.ts";

const NOW = 5_000_000;

let scratch: string;

beforeEach(async () => {
  scratch = await mkdtemp(`${tmpdir()}/run-page-test-`);
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

function status(overrides: Partial<RunStatus> = {}): RunStatus {
  return {
    runId: "eval-sweep-demo",
    kind: "eval-sweep",
    label: "demo — 4 queries × 3",
    settled: 6,
    total: 12,
    startedAt: NOW - 60_000,
    updatedAt: NOW - 1_000,
    state: "running",
    detail: {},
    pid: 4242,
    commandLine: "measure-triggering.ts --eval-set evals/trigger.json",
    ...overrides,
  };
}

function discovered(overrides: Partial<RunStatus> = {}): DiscoveredRun {
  return classify(status(overrides), NOW);
}

/** Recover the payload the way the browser's parser would. */
function parsePayload(html: string): RunPagePayload {
  const match = /const EMBEDDED_DATA = (\{[\s\S]*?\});\n/.exec(html);
  if (match?.[1] === undefined) throw new Error("no EMBEDDED_DATA assignment in output");
  return JSON.parse(match[1]) as RunPagePayload;
}

const QUERY_ROWS = [
  { query: "refactor this function", should_trigger: true, triggered: 2, settled: 3, total: 3 },
  { query: "capital of France", should_trigger: false, triggered: 0, settled: 1, total: 3 },
  { query: "not started yet", should_trigger: true, triggered: 0, settled: 0, total: 3 },
];

// ---------------------------------------------------------------------------
// The page exists for every kind
// ---------------------------------------------------------------------------

describe("renderRunPage", () => {
  test("renders a page for a run that wrote no file of its own", async () => {
    // The rule: anything the dashboard renders a bar for has a page. An eval sweep writes
    // its results to stdout, so its page has to come from the status alone.
    const html = await renderRunPage(discovered(), NOW, 5);
    expect(html).toContain("</html>");
    expect(parsePayload(html).status.runId).toBe("eval-sweep-demo");
  });

  test.each(["eval-sweep", "review", "benchmark", "description-loop"] as const)(
    "renders a page for kind %s",
    async (kind) => {
      const html = await renderRunPage(discovered({ kind }), NOW, 5);
      expect(parsePayload(html).status.kind).toBe(kind);
    },
  );

  test("carries progress, so the page shows a bar rather than a blank shell", async () => {
    const payload = parsePayload(await renderRunPage(discovered(), NOW, 5));
    expect(payload.status.settled).toBe(6);
    expect(payload.status.total).toBe(12);
  });

  test("projects remaining time for a live run", async () => {
    // 6 of 12 in 60s -> 60s left.
    expect(parsePayload(await renderRunPage(discovered(), NOW, 5)).remainingMs).toBe(60_000);
  });

  test("omits the projection for a stale run, which will never finish", async () => {
    const stale = classify(status({ updatedAt: NOW - 400_000 }), NOW);
    const payload = parsePayload(await renderRunPage(stale, NOW, 5));
    expect(payload.stale).toBe(true);
    expect(payload.remainingMs).toBeUndefined();
  });

  test("carries pid and command line, so a stuck run can be traced from its own page", async () => {
    const payload = parsePayload(await renderRunPage(discovered(), NOW, 5));
    expect(payload.status.pid).toBe(4242);
    expect(payload.status.commandLine).toContain("measure-triggering.ts");
  });

  test("a failed run's page carries the error", async () => {
    const failed = discovered({ state: "failed", error: "spawn failed" });
    expect(parsePayload(await renderRunPage(failed, NOW, 5)).status.error).toBe("spawn failed");
  });
});

// ---------------------------------------------------------------------------
// Refresh, which is what makes it live
// ---------------------------------------------------------------------------

describe("the page re-polls only while it needs to", () => {
  test("a running run's page refreshes itself", async () => {
    expect(await renderRunPage(discovered(), NOW, 5)).toContain('http-equiv="refresh"');
  });

  test.each(["done", "failed"] as const)("a %s run's page does not", async (state) => {
    // A finished page reloading itself every five seconds forever is the bug the
    // description report's own autoRefresh default exists to avoid.
    const html = await renderRunPage(discovered({ state }), NOW, 5);
    expect(html).not.toContain('http-equiv="refresh"');
  });

  test("a stale run's page does not refresh, since nothing will update it", async () => {
    const stale = classify(status({ updatedAt: NOW - 400_000 }), NOW);
    expect(await renderRunPage(stale, NOW, 5)).not.toContain('http-equiv="refresh"');
  });
});

// ---------------------------------------------------------------------------
// Per-query rows
// ---------------------------------------------------------------------------

describe("per-query rows for an eval sweep", () => {
  test("every row reaches the page, including one with nothing settled", async () => {
    // Seeded rows are what make the page show the sweep's full shape from the first poll
    // instead of a table that grows and reflows under the reader.
    const payload = parsePayload(
      await renderRunPage(discovered({ detail: { queries: QUERY_ROWS } }), NOW, 5),
    );
    expect(payload.status.detail.queries?.length).toBe(3);
    expect(payload.status.detail.queries?.[2]?.settled).toBe(0);
  });

  test("rows carry expectation and observed counts, not a verdict", async () => {
    // The verdict depends on triggerThreshold and is not decided until every attempt for
    // a query has landed, so a pass/fail shown mid-run could flip.
    const payload = parsePayload(
      await renderRunPage(discovered({ detail: { queries: QUERY_ROWS } }), NOW, 5),
    );
    const row = payload.status.detail.queries?.[0];
    expect(row?.should_trigger).toBe(true);
    expect(row?.triggered).toBe(2);
    expect(row?.settled).toBe(3);
    expect(row).not.toHaveProperty("pass");
  });

  test("the query text is rendered", async () => {
    const html = await renderRunPage(discovered({ detail: { queries: QUERY_ROWS } }), NOW, 5);
    expect(html).toContain("refactor this function");
  });

  test("a query containing HTML is escaped by the embedding", async () => {
    const rows = [
      { query: "</script><h1>x", should_trigger: true, triggered: 0, settled: 0, total: 3 },
    ];
    const html = await renderRunPage(discovered({ detail: { queries: rows } }), NOW, 5);
    expect(html).not.toContain("</script><h1>");
    expect(parsePayload(html).status.detail.queries?.[0]?.query).toBe("</script><h1>x");
  });
});

// ---------------------------------------------------------------------------
// Artifacts
// ---------------------------------------------------------------------------

describe("artifacts", () => {
  test("a recorded artifact is embedded, so a benchmark's output shows on its page", async () => {
    const path = `${scratch}/benchmark.md`;
    await Bun.write(path, "# Benchmark\n\nPass rate: 80%\n");
    const payload = parsePayload(
      await renderRunPage(
        discovered({ kind: "benchmark", detail: { artifactPaths: [path] } }),
        NOW,
        5,
      ),
    );
    expect(payload.artifacts.length).toBe(1);
    expect(payload.artifacts[0]?.name).toBe("benchmark.md");
    expect(payload.artifacts[0]?.content).toContain("Pass rate: 80%");
  });

  test("a missing artifact is skipped rather than failing the page", async () => {
    const payload = parsePayload(
      await renderRunPage(
        discovered({ detail: { artifactPaths: [`${scratch}/never-written.md`] } }),
        NOW,
        5,
      ),
    );
    expect(payload.artifacts).toEqual([]);
  });

  test("an oversized artifact is skipped, so one large output cannot slow every page", async () => {
    const path = `${scratch}/huge.json`;
    await Bun.write(path, "x".repeat(300 * 1024));
    const payload = parsePayload(
      await renderRunPage(discovered({ detail: { artifactPaths: [path] } }), NOW, 5),
    );
    expect(payload.artifacts).toEqual([]);
  });

  test("artifacts are read at serve time, so the page shows the current file", async () => {
    // Paths rather than copied content: an artifact rewritten after the path was recorded
    // must render as it is now, not as it was.
    const path = `${scratch}/out.md`;
    await Bun.write(path, "first");
    const run = discovered({ detail: { artifactPaths: [path] } });
    expect(parsePayload(await renderRunPage(run, NOW, 5)).artifacts[0]?.content).toBe("first");

    await Bun.write(path, "second");
    expect(parsePayload(await renderRunPage(run, NOW, 5)).artifacts[0]?.content).toBe("second");
  });
});

// ---------------------------------------------------------------------------
// The per-attempt signal
// ---------------------------------------------------------------------------

describe("the completion-ordered join behind per-query rows", () => {
  test("a count-only callback can name each attempt via a completion-ordered queue", async () => {
    // This is the mechanism `measure-triggering.ts` relies on: the pool hands `onSettled` a COUNT,
    // not an index, so the outcome that just landed is found at `settled - 1` in a queue
    // pushed by the workers. Safe because the pool fires from a `finally` immediately
    // after the worker body, on a single thread, so nothing interleaves between the push
    // and the read. Asserted against the real pool rather than a mock.
    const queue: string[] = [];
    const observed: Array<[number, string | undefined]> = [];

    await mapWithConcurrency(
      ["a", "b", "c", "d"],
      2,
      async (item) => {
        // Uneven delays, so completion order differs from input order.
        await Bun.sleep(item === "a" ? 30 : 5);
        queue.push(item);
        return item;
      },
      (settled) => observed.push([settled, queue[settled - 1]]),
    );

    // Every callback saw a defined entry, and each one exactly once.
    expect(observed.map(([, item]) => item).filter((item) => item === undefined)).toEqual([]);
    expect(new Set(observed.map(([, item]) => item)).size).toBe(4);
    expect(observed.map(([count]) => count)).toEqual([1, 2, 3, 4]);
  });

  test("the completion-ordered queue does not disturb input-ordered results", async () => {
    // `mapWithConcurrency` guarantees output order is input order regardless of
    // completion order, and its doc comment calls that out as a deliberate improvement
    // over the Python it replaced. The progress queue is a SEPARATE side-channel in
    // completion order; aggregation still indexes the returned array by input position.
    // Asserting both in one test is the point: a future change that fed aggregation from
    // the queue would pass a progress test and silently reorder every result.
    const queue: string[] = [];
    const items = ["first", "second", "third", "fourth"];

    const results = await mapWithConcurrency(
      items,
      4,
      async (item, index) => {
        // Reverse-ordered delays, so completion order is the exact reverse of input.
        await Bun.sleep((items.length - index) * 15);
        queue.push(item);
        return item.toUpperCase();
      },
      () => undefined,
    );

    expect(results).toEqual(["FIRST", "SECOND", "THIRD", "FOURTH"]);
    expect(queue).toEqual(["fourth", "third", "second", "first"]);
  });

  test("a failing item still reports its attempt, so a row cannot stall", async () => {
    // The pool reports from a `finally`, and `measure-triggering.ts` records a failure as a
    // non-trigger. A skipped failure would leave a row that never fills in.
    const queue: string[] = [];
    const seen: Array<string | undefined> = [];

    await expect(
      mapWithConcurrency(
        ["ok", "boom", "fine"],
        1,
        async (item) => {
          queue.push(item);
          if (item === "boom") throw new Error("boom");
          return item;
        },
        (settled) => seen.push(queue[settled - 1]),
      ),
    ).rejects.toThrow("boom");

    expect(seen).toEqual(["ok", "boom", "fine"]);
  });
});

// ---------------------------------------------------------------------------
// Retry eligibility
// ---------------------------------------------------------------------------

describe("retry is offered only where there is something to retry", () => {
  test("a failed run with a recorded command line is retryable", async () => {
    const payload = parsePayload(
      await renderRunPage(discovered({ state: "failed", error: "boom" }), NOW, 5),
    );
    expect(payload.retryUrl).toBe("/retry/eval-sweep-demo");
    expect(payload.retryCommand).toContain("measure-triggering.ts");
  });

  test("a stale run is retryable, since nothing will ever finish it", async () => {
    const stale = classify(status({ updatedAt: NOW - 400_000 }), NOW);
    expect(parsePayload(await renderRunPage(stale, NOW, 5)).retryUrl).toBeDefined();
  });

  test("a running run is NOT retryable, however slow it looks", async () => {
    // The mis-click this guards against costs an hour. A slow run has nothing to retry.
    expect(parsePayload(await renderRunPage(discovered(), NOW, 5)).retryUrl).toBeUndefined();
  });

  test("a finished run is NOT retryable", async () => {
    const done = discovered({ state: "done" });
    expect(parsePayload(await renderRunPage(done, NOW, 5)).retryUrl).toBeUndefined();
  });

  test("a failed run with no recorded command line is not retryable", async () => {
    // Nothing to re-run. Offering a button that cannot work is worse than omitting it.
    const noCommand = classify(
      { ...status({ state: "failed" }), commandLine: undefined },
      NOW,
    );
    expect(parsePayload(await renderRunPage(noCommand, NOW, 5)).retryUrl).toBeUndefined();
  });
});

describe("a retry states what it will do before it is confirmed", () => {
  test("says 'from the start' when nothing was persisted", async () => {
    // Never claims a resume that cannot happen: the plan text is derived from what is on
    // disk, not from the presence of a results directory.
    const payload = parsePayload(await renderRunPage(discovered({ state: "failed" }), NOW, 5));
    expect(payload.retryResumeFrom).toBe(0);
    expect(payload.retryPlan).toContain("from the start");
  });

  test("says which iteration it resumes from when scored iterations exist", async () => {
    // "Retry from iteration 3" and "Retry from the start" differ by tens of minutes at
    // ~12 minutes an iteration, so the reader has to know which they are agreeing to.
    const dir = `${scratch}/results`;
    await Bun.write(
      `${dir}/results.json`,
      JSON.stringify({
        history: [
          { iteration: 1, description: "a", train_passed: 1, train_total: 2 },
          { iteration: 2, description: "b", train_passed: 2, train_total: 2 },
        ],
      }),
    );
    const run = discovered({ state: "failed", detail: { resultsDir: dir } });
    const payload = parsePayload(await renderRunPage(run, NOW, 5));
    expect(payload.retryResumeFrom).toBe(2);
    expect(payload.retryPlan).toContain("from iteration 3");
  });

  test("falls back to from-the-start when the results file is malformed", async () => {
    const dir = `${scratch}/broken`;
    await Bun.write(`${dir}/results.json`, "{ truncated");
    const run = discovered({ state: "failed", detail: { resultsDir: dir } });
    const payload = parsePayload(await renderRunPage(run, NOW, 5));
    expect(payload.retryResumeFrom).toBe(0);
    expect(payload.retryPlan).toContain("from the start");
  });

  test("a recorded results directory with no file yet does not promise a resume", async () => {
    // A path says a directory was requested, not that anything was written to it.
    const run = discovered({ state: "failed", detail: { resultsDir: `${scratch}/never` } });
    expect(parsePayload(await renderRunPage(run, NOW, 5)).retryResumeFrom).toBe(0);
  });
});
