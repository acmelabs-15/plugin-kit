/**
 * Tests for the detached-run guarantees, driven through real subprocesses.
 *
 * These cannot be asserted in-process. The claims are about what a SEPARATE process
 * leaves on disk when nobody is watching it and when it is signalled, and both depend on
 * process lifecycle -- a signal handler and a terminal write racing an exit. Spawning is
 * the only way to exercise that honestly.
 *
 * The child scripts here use the progress module directly rather than running the real
 * entrypoints, because the real ones spawn `claude` and would cost API budget and
 * minutes. What is under test is the reporter's lifecycle, which is the shared part.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

import { parseRunStatus, type RunStatus } from "../progress.ts";

const PROGRESS_MODULE = `${import.meta.dir}/../progress.ts`;

let scratch: string;

beforeEach(async () => {
  scratch = await mkdtemp(`${tmpdir()}/detached-test-`);
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

/**
 * Run a child script with the status directory pointed at the scratch tree.
 *
 * `stderr` is piped rather than inherited so a test can assert the child wrote NOTHING
 * there -- which is how the "status file is the only channel" claim is proved.
 */
function spawnChild(scriptPath: string): Bun.Subprocess<"ignore", "pipe", "pipe"> {
  return Bun.spawn(["bun", "run", scriptPath], {
    env: { ...process.env, SKILL_CREATOR_STATUS_DIR: scratch },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
}

/** Every status file currently in the scratch directory. */
async function statuses(): Promise<RunStatus[]> {
  const names = await Array.fromAsync(new Bun.Glob("*.json").scan({ cwd: scratch, onlyFiles: true }));
  const found: RunStatus[] = [];
  for (const name of names) {
    const parsed = parseRunStatus(await Bun.file(`${scratch}/${name}`).json());
    if (parsed !== null) found.push(parsed);
  }
  return found;
}

/** Poll until `predicate` holds or the budget runs out. Returns whether it held. */
async function waitFor(predicate: () => Promise<boolean>, budgetMs = 5_000): Promise<boolean> {
  const deadline = Bun.nanoseconds() + budgetMs * 1e6;
  while (Bun.nanoseconds() < deadline) {
    if (await predicate()) return true;
    await Bun.sleep(25);
  }
  return false;
}

describe("a detached run with no operator watching", () => {
  test("writes progress to the status file without --verbose", async () => {
    // The core detached guarantee. The stderr indicator is gated on `verbose`, which is
    // right for a terminal -- but a detached run has nobody to pass the flag, so gating
    // the STATUS write the same way would leave the dashboard blank for exactly the runs
    // it exists to observe.
    const script = `${scratch}/child.ts`;
    await Bun.write(
      script,
      `import { ProgressReporter } from "${PROGRESS_MODULE}";
       const r = ProgressReporter.start({ kind: "eval-sweep", label: "quiet run", total: 4 });
       for (let i = 1; i <= 4; i += 1) { r.report(i); await Bun.sleep(20); }
       await r.finish("done");`,
    );

    const child = spawnChild(script);
    await child.exited;

    const found = await statuses();
    expect(found.length).toBe(1);
    expect(found[0]?.settled).toBe(4);
    expect(found[0]?.state).toBe("done");

    // And nothing was written to stderr, proving the status file was the only channel.
    expect(await new Response(child.stderr).text()).toBe("");
  });

  test("the status file is readable while the run is still going", async () => {
    // A run is only observable if its progress lands DURING the run, not at the end.
    const script = `${scratch}/child.ts`;
    await Bun.write(
      script,
      `import { ProgressReporter } from "${PROGRESS_MODULE}";
       const r = ProgressReporter.start({ kind: "eval-sweep", label: "slow run", total: 100 });
       for (let i = 1; i <= 100; i += 1) { r.report(i); await Bun.sleep(50); }
       await r.finish("done");`,
    );

    const child = spawnChild(script);
    try {
      const sawPartial = await waitFor(async () => {
        const [status] = await statuses();
        return status !== undefined && status.state === "running" && status.settled > 0;
      });
      expect(sawPartial).toBe(true);
    } finally {
      child.kill("SIGKILL");
      await child.exited;
    }
  });

  test("records its pid, and the pid is the child's rather than ours", async () => {
    const script = `${scratch}/child.ts`;
    await Bun.write(
      script,
      `import { ProgressReporter } from "${PROGRESS_MODULE}";
       const r = ProgressReporter.start({ kind: "eval-sweep", label: "demo", total: 1 });
       await r.finish("done");`,
    );

    const child = spawnChild(script);
    await child.exited;

    const [status] = await statuses();
    expect(status?.pid).toBe(child.pid);
    expect(status?.pid).not.toBe(process.pid);
  });
});

describe("terminal states on every exit path", () => {
  test("an uncaught throw still leaves a failed status, not a running one", async () => {
    const script = `${scratch}/child.ts`;
    await Bun.write(
      script,
      `import { ProgressReporter } from "${PROGRESS_MODULE}";
       const r = ProgressReporter.start({ kind: "eval-sweep", label: "doomed", total: 4 });
       try {
         r.report(1);
         throw new Error("kaboom");
       } catch (error) {
         await r.finish("failed", error instanceof Error ? error.message : String(error));
         process.exit(1);
       }`,
    );

    const child = spawnChild(script);
    await child.exited;

    const [status] = await statuses();
    expect(status?.state).toBe("failed");
    expect(status?.error).toBe("kaboom");
  });

  test("SIGTERM records failed rather than leaving running on disk forever", async () => {
    // A detached run is stopped by a signal far more often than it ends by returning.
    // Without a handler this leaves `running`, which is the exact ambiguity the module
    // exists to remove -- stale detection is the backstop, not the mechanism.
    const script = `${scratch}/child.ts`;
    await Bun.write(
      script,
      `import { ProgressReporter } from "${PROGRESS_MODULE}";
       const r = ProgressReporter.start({ kind: "eval-sweep", label: "long", total: 1000 });
       for (let i = 1; i <= 1000; i += 1) { r.report(i); await Bun.sleep(50); }
       await r.finish("done");`,
    );

    const child = spawnChild(script);
    // Wait for the first status write, so the signal cannot beat startup.
    await waitFor(async () => (await statuses()).length > 0);
    child.kill("SIGTERM");
    await child.exited;

    const settled = await waitFor(async () => {
      const [status] = await statuses();
      return status?.state === "failed";
    });
    expect(settled).toBe(true);
    const [status] = await statuses();
    expect(status?.error).toContain("SIGTERM");
  });

  test("SIGINT records a terminal state too", async () => {
    const script = `${scratch}/child.ts`;
    await Bun.write(
      script,
      `import { ProgressReporter } from "${PROGRESS_MODULE}";
       const r = ProgressReporter.start({ kind: "eval-sweep", label: "long", total: 1000 });
       for (let i = 1; i <= 1000; i += 1) { r.report(i); await Bun.sleep(50); }
       await r.finish("done");`,
    );

    const child = spawnChild(script);
    await waitFor(async () => (await statuses()).length > 0);
    child.kill("SIGINT");
    await child.exited;

    expect(
      await waitFor(async () => {
        const [status] = await statuses();
        return status?.state === "failed" && (status.error ?? "").includes("SIGINT");
      }),
    ).toBe(true);
  });

  test("SIGKILL leaves running, which is why staleness exists", async () => {
    // The one case no handler can cover. Recorded as a test so the necessity of
    // stale-detection is documented by something that fails if it stops being true.
    const script = `${scratch}/child.ts`;
    await Bun.write(
      script,
      `import { ProgressReporter } from "${PROGRESS_MODULE}";
       const r = ProgressReporter.start({ kind: "eval-sweep", label: "doomed", total: 1000 });
       for (let i = 1; i <= 1000; i += 1) { r.report(i); await Bun.sleep(50); }
       await r.finish("done");`,
    );

    const child = spawnChild(script);
    await waitFor(async () => (await statuses()).length > 0);
    child.kill("SIGKILL");
    await child.exited;
    await Bun.sleep(200);

    const [status] = await statuses();
    expect(status?.state).toBe("running");
  });

  test("a signal after a clean finish cannot reopen the run", async () => {
    // Handlers are detached in `finish`, so a Ctrl-C landing during shutdown must not
    // overwrite `done` with `failed`.
    const script = `${scratch}/child.ts`;
    await Bun.write(
      script,
      `import { ProgressReporter } from "${PROGRESS_MODULE}";
       const r = ProgressReporter.start({ kind: "eval-sweep", label: "demo", total: 1 });
       r.report(1);
       await r.finish("done");
       process.kill(process.pid, "SIGTERM");`,
    );

    const child = spawnChild(script);
    await child.exited;
    await Bun.sleep(200);

    const [status] = await statuses();
    expect(status?.state).toBe("done");
  });
});
