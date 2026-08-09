import { describe, expect, test } from "bun:test";

import { mapWithConcurrency } from "../pool.ts";
import { claudeEnv, runCommand, runStreamingLines } from "../subprocess.ts";

/**
 * Test children are `bun -e` rather than a shell, so the suite needs nothing on
 * the machine that the plugin does not already require. It also makes the
 * children behave identically on Windows, where `sleep` and `printf` are not
 * necessarily anything.
 */
function child(source: string): readonly string[] {
  return ["bun", "-e", source];
}

/** Ignores SIGTERM and outlives any reasonable deadline. Nothing but SIGKILL stops it. */
const TRAPPING_CHILD = child(
  'process.on("SIGTERM", () => {}); await Bun.sleep(30_000); console.log("done");',
);

describe("mapWithConcurrency", () => {
  test("caps in-flight work at the concurrency limit", async () => {
    const items = Array.from({ length: 20 }, (_, index) => index);
    let active = 0;
    let peak = 0;

    const results = await mapWithConcurrency(items, 5, async (item) => {
      active += 1;
      peak = Math.max(peak, active);
      await Bun.sleep(5);
      active -= 1;
      return item * 2;
    });

    expect(peak).toBe(5);
    expect(results).toEqual(items.map((item) => item * 2));
  });

  test("never starts more runners than there are items", async () => {
    let peak = 0;
    let active = 0;

    await mapWithConcurrency([1, 2], 10, async (item) => {
      active += 1;
      peak = Math.max(peak, active);
      await Bun.sleep(5);
      active -= 1;
      return item;
    });

    expect(peak).toBe(2);
  });

  test("preserves input order regardless of completion order", async () => {
    const items = [0, 1, 2, 3, 4, 5];
    const completionOrder: number[] = [];

    const results = await mapWithConcurrency(items, items.length, async (item, index) => {
      await Bun.sleep((items.length - index) * 10);
      completionOrder.push(index);
      return `r${item}`;
    });

    expect(results).toEqual(["r0", "r1", "r2", "r3", "r4", "r5"]);
    expect(completionOrder).toEqual([5, 4, 3, 2, 1, 0]);
  });

  test("passes the input index to the worker", async () => {
    const seen = await mapWithConcurrency(["a", "b", "c"], 2, async (item, index) =>
      Promise.resolve(`${index}:${item}`),
    );

    expect(seen).toEqual(["0:a", "1:b", "2:c"]);
  });

  test("attempts every item even when a worker throws, then rethrows the first error", async () => {
    const attempted: number[] = [];

    const pending = mapWithConcurrency([0, 1, 2, 3], 2, async (item) => {
      attempted.push(item);
      await Bun.sleep(1);
      if (item === 1) throw new Error("boom");
      return item;
    });

    await expect(pending).rejects.toThrow("boom");
    expect([...attempted].sort()).toEqual([0, 1, 2, 3]);
  });

  test("returns an empty array for an empty input", async () => {
    expect(await mapWithConcurrency([], 4, async (item) => item)).toEqual([]);
  });

  test.each([0, -1, 1.5, Number.NaN])("rejects a concurrency of %p", (concurrency) => {
    expect(() => mapWithConcurrency([1], concurrency, async (item) => item)).toThrow(RangeError);
  });
});

describe("claudeEnv", () => {
  test("keeps every parent variable and drops only CLAUDECODE", () => {
    const merged = claudeEnv({
      PATH: "/usr/bin",
      HOME: "/home/me",
      ANTHROPIC_API_KEY: "sk-test",
      CLAUDECODE: "1",
    });

    expect(merged).toEqual({ PATH: "/usr/bin", HOME: "/home/me", ANTHROPIC_API_KEY: "sk-test" });
    expect(Object.hasOwn(merged, "CLAUDECODE")).toBe(false);
  });

  test("drops keys whose value is undefined", () => {
    expect(claudeEnv({ SET: "yes", UNSET: undefined })).toEqual({ SET: "yes" });
  });

  test("is a merge, not a replacement: an unrelated var survives", () => {
    const merged = claudeEnv({ CLAUDECODE: "1", CLAUDE_CODE_ENTRYPOINT: "cli" });
    expect(merged["CLAUDE_CODE_ENTRYPOINT"]).toBe("cli");
  });

  test("defaults to the real environment, minus the guard", () => {
    const merged = claudeEnv();

    expect(Object.keys(merged).length).toBeGreaterThan(0);
    expect(Object.hasOwn(merged, "CLAUDECODE")).toBe(false);
    expect(merged["PATH"]).toBe(Bun.env.PATH);
  });
});

describe("runCommand", () => {
  test("buffers stdout and stderr on a clean exit", async () => {
    const outcome = await runCommand(child('console.log("out"); console.error("err");'), {
      timeoutMs: 5000,
    });

    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") return;
    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toBe("out\n");
    expect(outcome.stderr).toBe("err\n");
  });

  test("delivers the payload over stdin rather than argv", async () => {
    const payload = "x".repeat(200_000);
    const outcome = await runCommand(child("process.stdout.write(await Bun.stdin.text());"), {
      stdin: payload,
      timeoutMs: 5000,
    });

    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") return;
    expect(outcome.stdout).toBe(payload);
  });

  test("surfaces a non-zero exit as ok, leaving the verdict to the caller", async () => {
    const outcome = await runCommand(child("process.exit(3);"), { timeoutMs: 5000 });

    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") return;
    expect(outcome.exitCode).toBe(3);
  });

  test("reports a timeout as its own case, killing a child that traps SIGTERM", async () => {
    const started = Bun.nanoseconds();
    const outcome = await runCommand([...TRAPPING_CHILD], { timeoutMs: 300 });
    const elapsedMs = (Bun.nanoseconds() - started) / 1e6;

    // Bun's soft `timeout` option would let this child run its full 30s.
    expect(outcome.kind).toBe("timeout");
    expect(elapsedMs).toBeLessThan(5000);
  });

  test("reports a missing binary as an error, not a timeout", async () => {
    const outcome = await runCommand(["definitely-not-a-real-binary-xyz"], { timeoutMs: 5000 });

    expect(outcome.kind).toBe("error");
  });
});

describe("runStreamingLines", () => {
  test("short-circuits on the first deciding line", async () => {
    const seen: string[] = [];
    const outcome = await runStreamingLines(
      child('console.log("a\\nb\\nc"); await Bun.sleep(30_000);'),
      { timeoutMs: 10_000 },
      (line) => {
        seen.push(line);
        return line === "b" ? "found-b" : undefined;
      },
    );

    expect(outcome).toEqual({ kind: "decided", value: "found-b" });
    expect(seen).toEqual(["a", "b"]);
  });

  test("returns exhausted with the exit code when no line decides", async () => {
    const outcome = await runStreamingLines(
      child('console.log("one\\ntwo");'),
      { timeoutMs: 5000 },
      () => undefined,
    );

    expect(outcome).toEqual({ kind: "exhausted", exitCode: 0 });
  });

  test("skips blank lines and never parses a trailing fragment", async () => {
    const seen: string[] = [];
    await runStreamingLines(
      child('process.stdout.write("first\\n\\n   \\nno-newline-tail");'),
      { timeoutMs: 5000 },
      (line) => {
        seen.push(line);
        return undefined;
      },
    );

    expect(seen).toEqual(["first"]);
  });

  test("reports a timeout rather than hanging on a trapping child", async () => {
    const started = Bun.nanoseconds();
    const outcome = await runStreamingLines([...TRAPPING_CHILD], { timeoutMs: 300 }, () => undefined);
    const elapsedMs = (Bun.nanoseconds() - started) / 1e6;

    expect(outcome.kind).toBe("timeout");
    expect(elapsedMs).toBeLessThan(5000);
  });
});

describe("onSettled progress reporting", () => {
  test("fires once per item, counting up to the total", async () => {
    const seen: Array<[number, number]> = [];
    await mapWithConcurrency([1, 2, 3, 4], 2, async (n) => n * 2, (settled, total) =>
      seen.push([settled, total]),
    );
    expect(seen).toEqual([
      [1, 4],
      [2, 4],
      [3, 4],
      [4, 4],
    ]);
  });

  test("fires for a failing item too, so progress cannot stall on an error", async () => {
    // Reported from a `finally`, because a run that stops counting partway through looks
    // identical to a hung one.
    const seen: number[] = [];
    await expect(
      mapWithConcurrency(
        [1, 2, 3],
        1,
        async (n) => {
          if (n === 2) throw new Error("boom");
          return n;
        },
        (settled) => seen.push(settled),
      ),
    ).rejects.toThrow("boom");
    expect(seen).toEqual([1, 2, 3]);
  });

  test("is optional", async () => {
    expect(await mapWithConcurrency([1, 2], 2, async (n) => n + 1)).toEqual([2, 3]);
  });
});
