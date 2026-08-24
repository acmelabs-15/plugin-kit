/**
 * Port reclamation, and the guard that keeps it from killing strangers.
 *
 * NOTHING here signals a real process. The whole point of the injected
 * {@link PortReclaimer} is that the decision -- kill this PID, or name it and walk away --
 * is reachable without producing a victim to be wrong about. A test that proved a foreign
 * process is spared by starting one and hoping would be a worse test and a worse idea.
 */

import { describe, expect, spyOn, test } from "bun:test";

import {
  isOwnViewerProcess,
  parsePortHolders,
  reclaimPort,
  type PortReclaimer,
} from "../generate-review.ts";

const OURS = "bun /Users/dev/plugin-kit/shared/report/generate-review.ts evals/results/iteration-3";

/** A reclaimer over a fixed pid-to-command map, recording every PID it was told to kill. */
function fake(holders: Readonly<Record<number, string | undefined>>): PortReclaimer & {
  readonly killed: number[];
} {
  const killed: number[] = [];
  return {
    killed,
    listHolders: async () => Object.keys(holders).map(Number),
    describe: async (pid) => holders[pid],
    terminate: (pid) => {
      killed.push(pid);
    },
  };
}

/** Run `reclaimPort` against a fake, returning what was killed and what was said. */
async function reclaim(
  holders: Readonly<Record<number, string | undefined>>,
): Promise<{ readonly killed: readonly number[]; readonly said: string }> {
  const reclaimer = fake(holders);
  const stderr = spyOn(console, "error").mockImplementation(() => {});
  try {
    await reclaimPort(3117, reclaimer);
    return {
      killed: reclaimer.killed,
      said: stderr.mock.calls.map((call) => call.join(" ")).join("\n"),
    };
  } finally {
    stderr.mockRestore();
  }
}

describe("a foreign process holding the port is not killed", () => {
  test("an unrelated server is left running, and said to have been", async () => {
    const { killed, said } = await reclaim({ 4242: "/usr/local/bin/postgres -D /var/data" });

    // The defect, in one assertion.
    expect(killed).toEqual([]);
    // Not killed AND not silent: an obscure bind failure later is the other half of it.
    expect(said).toContain("4242");
    expect(said).toContain("postgres");
    expect(said).toContain("not an eval viewer");
    expect(said).toContain("ephemeral port");
  });

  test("an editor with the script open is not mistaken for the script", async () => {
    // The reason the guard checks the runtime and not just the script name. This command
    // line contains `generate-review.ts` and would satisfy a name-only guard.
    const { killed } = await reclaim({ 5150: "nvim shared/report/generate-review.ts" });
    expect(killed).toEqual([]);
  });

  test("a process whose command line cannot be read is left alone", async () => {
    // A PID owned by another user reads as blank rather than as absent. Unidentifiable is
    // not the same as ours, and the tie breaks toward not killing it.
    const { killed, said } = await reclaim({ 6001: undefined });
    expect(killed).toEqual([]);
    expect(said).toContain("could not be read");
  });

  test("every holder is judged on its own, so ours dies and the stranger does not", async () => {
    const { killed, said } = await reclaim({ 7001: OURS, 7002: "redis-server *:3117" });
    expect(killed).toEqual([7001]);
    expect(said).toContain("7002");
    expect(said).toContain("not an eval viewer");
  });
});

describe("our own viewer is still reclaimed", () => {
  test("a viewer holding the port is terminated, silently", async () => {
    const { killed, said } = await reclaim({ 8080: OURS });
    expect(killed).toEqual([8080]);
    // Nothing to report: reclaiming our own viewer is the expected path.
    expect(said).toBe("");
  });

  test("a terminate that throws because the process already exited is not fatal", async () => {
    const stderr = spyOn(console, "error").mockImplementation(() => {});
    try {
      await reclaimPort(3117, {
        listHolders: async () => [9001],
        describe: async () => OURS,
        terminate: () => {
          throw new Error("ESRCH");
        },
      });
    } finally {
      stderr.mockRestore();
    }
  });
});

describe("nothing to reclaim", () => {
  test("a free port does nothing and says nothing", async () => {
    const { killed, said } = await reclaim({});
    expect(killed).toEqual([]);
    expect(said).toBe("");
  });

  test("no lsof reports that the check could not be made, and kills nothing", async () => {
    const stderr = spyOn(console, "error").mockImplementation(() => {});
    try {
      await reclaimPort(3117, {
        listHolders: async () => {
          throw new Error("ENOENT");
        },
        describe: async () => OURS,
        terminate: () => {
          throw new Error("must not be reached");
        },
      });
      expect(stderr.mock.calls.map((call) => call.join(" ")).join("\n")).toContain("lsof");
    } finally {
      stderr.mockRestore();
    }
  });
});

describe("isOwnViewerProcess", () => {
  test("recognizes the launch forms the toolchain actually uses", () => {
    expect(isOwnViewerProcess(OURS)).toBe(true);
    expect(isOwnViewerProcess("bun run shared/report/generate-review.ts ws --no-open")).toBe(true);
    expect(isOwnViewerProcess("/opt/homebrew/bin/bun ../../shared/report/generate-review.ts ws")).toBe(true);
    expect(isOwnViewerProcess("bunx /x/generate-review.ts")).toBe(true);
    // A shipped plugin runs from the cache directory, which is a path like any other.
    expect(
      isOwnViewerProcess("bun /Users/d/.claude/plugins/cache/kit/shared/report/generate-review.ts w"),
    ).toBe(true);
  });

  test("refuses anything it cannot positively identify", () => {
    expect(isOwnViewerProcess("nvim shared/report/generate-review.ts")).toBe(false);
    expect(isOwnViewerProcess("grep -r generate-review.ts .")).toBe(false);
    expect(isOwnViewerProcess("bun shared/report/generate-dashboard.ts")).toBe(false);
    expect(isOwnViewerProcess("postgres -D /var/data")).toBe(false);
    expect(isOwnViewerProcess("")).toBe(false);
    expect(isOwnViewerProcess("   ")).toBe(false);
    expect(isOwnViewerProcess("bun")).toBe(false);
  });

  test("a runtime outside Bun is not accepted, since nothing here is launched by one", () => {
    // Widening this would widen what may be killed in exchange for a launch form this
    // repository does not have. `check-bun-purity` rejects naming one at all.
    expect(isOwnViewerProcess("deno run /x/generate-review.ts")).toBe(false);
  });

  test("a script whose name merely ends with ours is not ours", () => {
    // `endsWith` alone would accept this, and it is a different program.
    expect(isOwnViewerProcess("bun tools/my-generate-review.ts")).toBe(false);
  });
});

describe("parsePortHolders", () => {
  test("reads the lsof output shape and deduplicates", () => {
    // One process holding several sockets is listed once per socket.
    expect(parsePortHolders("4242\n4242\n5150\n")).toEqual([4242, 5150]);
  });

  test("empty output yields no holders", () => {
    expect(parsePortHolders("")).toEqual([]);
    expect(parsePortHolders("\n  \n")).toEqual([]);
  });

  test("drops 0, which would signal this process's whole group rather than a process", () => {
    // `process.kill(0, ...)` signals every process in the caller's process group, and
    // `Number.isInteger(0)` is true, so nothing upstream of this rejects it.
    expect(parsePortHolders("0\n")).toEqual([]);
    expect(parsePortHolders("-1\n")).toEqual([]);
  });

  test("drops this process, which has not bound the port and must not be signalled", () => {
    expect(parsePortHolders(`${process.pid}\n`)).toEqual([]);
  });

  test("ignores lines that are not PIDs", () => {
    expect(parsePortHolders("lsof: illegal option\n4242\n")).toEqual([4242]);
  });
});
