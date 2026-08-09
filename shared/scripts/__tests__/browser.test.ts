/**
 * Tests for the browser opener and the dashboard-already-running probe.
 *
 * The probe is tested against real `Bun.serve` instances rather than a mocked fetch:
 * what it has to get right is distinguishing our server from an arbitrary listener and
 * from nothing at all, and only a real socket exercises that.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

import { describe, expect, test } from "bun:test";

import {
  browserCommand,
  DASHBOARD_HEALTH_MARKER,
  DASHBOARD_HEALTH_PATH,
  DASHBOARD_PORT,
  ensureDashboard,
  isDashboardListening,
  openInBrowser,
} from "../lib/browser.ts";
import {
  discoverRuns,
  HEARTBEAT_MS,
  PRUNE_AFTER_MS,
  writeStatusAtomically,
  type RunStatus,
} from "../lib/progress.ts";

const STATUS_DIR_ENV = "SKILL_CREATOR_STATUS_DIR";

/** Serve `handler` on an ephemeral port for the duration of `body`. */
async function withServer(
  handler: (request: Request) => Response,
  body: (port: number) => Promise<void>,
): Promise<void> {
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: handler });
  try {
    // `port` is optional on the type (a unix-socket server has none), but a TCP server
    // bound to port 0 always reports the port the OS assigned.
    const { port } = server;
    if (port === undefined) throw new Error("server bound to no port");
    await body(port);
  } finally {
    server.stop(true);
  }
}

describe("browserCommand", () => {
  test("returns a non-empty command for this platform", () => {
    const command = browserCommand("http://localhost:3118");
    expect(command.length).toBeGreaterThan(0);
    expect(command).toContain("http://localhost:3118");
  });

  test.each([
    ["darwin", "open"],
    ["win32", "cmd"],
    ["linux", "xdg-open"],
  ])("uses the %s opener", (platform, expected) => {
    const original = process.platform;
    try {
      Object.defineProperty(process, "platform", { value: platform, configurable: true });
      expect(browserCommand("http://x")[0]).toBe(expected);
    } finally {
      Object.defineProperty(process, "platform", { value: original, configurable: true });
    }
  });

  test("passes a file path through unchanged, for the local-report case", () => {
    expect(browserCommand("/tmp/report.html")).toContain("/tmp/report.html");
  });
});

describe("openInBrowser", () => {
  test("never throws, even for a target no opener can handle", () => {
    // A machine with no display is an ordinary environment, not an error: every caller
    // prints the URL anyway, so a failure here has to cost nothing.
    expect(() => openInBrowser("not a url at all")).not.toThrow();
  });
});

describe("isDashboardListening", () => {
  test("is false when nothing is listening", async () => {
    // Port 1 is privileged and unused; connection is refused rather than hanging.
    expect(await isDashboardListening(1, 200)).toBe(false);
  });

  test("is true for a server answering with our marker", async () => {
    await withServer(
      (request) =>
        new URL(request.url).pathname === DASHBOARD_HEALTH_PATH
          ? Response.json({ service: DASHBOARD_HEALTH_MARKER, pid: 123 })
          : new Response("nope", { status: 404 }),
      async (port) => {
        expect(await isDashboardListening(port)).toBe(true);
      },
    );
  });

  test("is false for an unrelated server holding the port", async () => {
    // Treating any listener as a dashboard would mean silently never opening the page
    // while reporting success.
    await withServer(
      () => new Response("I am someone else's dev server"),
      async (port) => {
        expect(await isDashboardListening(port)).toBe(false);
      },
    );
  });

  test("is false for a JSON server whose marker does not match", async () => {
    await withServer(
      () => Response.json({ service: "some-other-tool" }),
      async (port) => {
        expect(await isDashboardListening(port)).toBe(false);
      },
    );
  });

  test("is false when the health route errors", async () => {
    await withServer(
      () => new Response("boom", { status: 500 }),
      async (port) => {
        expect(await isDashboardListening(port)).toBe(false);
      },
    );
  });

  test("is false rather than hanging when the server never answers", async () => {
    // The probe gates whether a window opens, so an unresponsive listener must not
    // stall a run's startup.
    await withServer(
      () => new Response(new ReadableStream({ start() {} })),
      async (port) => {
        const started = Bun.nanoseconds();
        expect(await isDashboardListening(port, 300)).toBe(false);
        expect((Bun.nanoseconds() - started) / 1e6).toBeLessThan(3_000);
      },
    );
  });

  test("survives a killed server, so a crash cannot block opening forever", async () => {
    // The reason this is an HTTP probe and not a lock file: a SIGKILLed dashboard never
    // cleans up, and a lock-based check would refuse to open a window from then on.
    let port = 0;
    await withServer(
      () => Response.json({ service: DASHBOARD_HEALTH_MARKER }),
      async (livePort) => {
        port = livePort;
        expect(await isDashboardListening(port)).toBe(true);
      },
    );
    expect(await isDashboardListening(port, 200)).toBe(false);
  });
});

describe("the default port", () => {
  test("is distinct from the review viewer's 3117, so both can run at once", () => {
    expect(DASHBOARD_PORT).toBe(3118);
  });
});

// ---------------------------------------------------------------------------
// Pruning, wired into the reader's entry point
// ---------------------------------------------------------------------------

describe("ensureDashboard prunes the status directory", () => {
  /** Point the status directory at a scratch dir for the duration of `body`. */
  async function withScratchStatusDir(body: (dir: string) => Promise<void>): Promise<void> {
    const previous = Bun.env[STATUS_DIR_ENV];
    const dir = await mkdtemp(`${tmpdir()}/browser-prune-`);
    Bun.env[STATUS_DIR_ENV] = dir;
    try {
      await body(dir);
    } finally {
      if (previous === undefined) delete Bun.env[STATUS_DIR_ENV];
      else Bun.env[STATUS_DIR_ENV] = previous;
      await rm(dir, { recursive: true, force: true });
    }
  }

  function aged(runId: string, updatedAt: number): RunStatus {
    return {
      runId,
      kind: "eval-sweep",
      label: "demo",
      settled: 6,
      total: 6,
      startedAt: updatedAt - 1_000,
      updatedAt,
      state: "done",
      detail: {},
    };
  }

  test("deletes week-old finished runs and keeps recent ones", async () => {
    // `pruneRuns` was implemented and never called for the whole life of the feature, so the
    // wiring is what this asserts -- the pruning logic itself is covered in progress.test.ts.
    // A live server is served so `ensureDashboard` takes the already-running path and returns
    // without spawning anything: the prune runs BEFORE that probe, deliberately, because a
    // dashboard outlives its launcher and gating the prune on spawning one would prune only
    // on the launch where there is nothing yet to prune.
    await withScratchStatusDir(async () => {
      const now = Date.now();
      await writeStatusAtomically(aged("ancient", now - PRUNE_AFTER_MS - 60_000));
      await writeStatusAtomically(aged("recent", now - 60_000));

      await withServer(
        () => Response.json({ service: DASHBOARD_HEALTH_MARKER }),
        async (port) => {
          await ensureDashboard({ port, open: false });
        },
      );

      expect((await discoverRuns()).map((run) => run.status.runId)).toEqual(["recent"]);
    });
  });

  test("a run still writing its status is never pruned, whatever its state", async () => {
    // The hazard the retention decision rests on: pruning must never delete a status file
    // out from under a run that is still writing to it.
    //
    // The property that makes this hold is NOT "a running run is exempt" -- a running run
    // that has gone stale IS eligible, deliberately, because nothing will ever finish it.
    // What makes it safe is the ratio: a genuinely live run refreshes every HEARTBEAT_MS,
    // which puts its `updatedAt` around 5s old against a window of a week. It can never
    // reach the age bound while alive, so no live run is reachable by this code path.
    await withScratchStatusDir(async () => {
      const now = Date.now();
      await writeStatusAtomically({ ...aged("still-going", now - HEARTBEAT_MS), state: "running" });

      await withServer(
        () => Response.json({ service: DASHBOARD_HEALTH_MARKER }),
        async (port) => {
          await ensureDashboard({ port, open: false });
        },
      );

      expect((await discoverRuns()).map((run) => run.status.runId)).toEqual(["still-going"]);
    });
  });

  test("an unreadable status directory does not break a run", async () => {
    // The never-throws contract: housekeeping failing must never cost the work.
    const previous = Bun.env[STATUS_DIR_ENV];
    Bun.env[STATUS_DIR_ENV] = `${tmpdir()}/browser-prune-does-not-exist-${Bun.nanoseconds()}`;
    try {
      await withServer(
        () => Response.json({ service: DASHBOARD_HEALTH_MARKER }),
        async (port) => {
          await ensureDashboard({ port, open: false });
        },
      );
    } finally {
      if (previous === undefined) delete Bun.env[STATUS_DIR_ENV];
      else Bun.env[STATUS_DIR_ENV] = previous;
    }
  });
});
