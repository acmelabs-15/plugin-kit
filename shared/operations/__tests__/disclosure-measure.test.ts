/**
 * Tests for the disclosure measurement engine.
 *
 * Moved here with the code they cover when measurement was split out of
 * `../../optimize-disclosure.ts`. `layoutDescription`'s test is the load-bearing one: it
 * pins the read to the conformant reader, which is what a hand-rolled parser got wrong by
 * truncating four of five shipped descriptions into every scenario copy the loop measured.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  layoutDescription,
  measureWithGate,
  orderAttempts,
  summarizeLayout,
  type GatedMeasurement,
} from "../disclosure-measure.ts";
import {
  estimatingCounter,
  loadModeOf,
  scoreRuns,
  type BundledFile,
  type DisclosureCandidate,
  type ScenarioRun,
  type SplitScore,
} from "../disclosure.ts";

function run(overrides: Partial<ScenarioRun> = {}): ScenarioRun {
  return {
    scenarioId: "s1",
    attempt: 1,
    filesRead: [],
    skillLoaded: true,
    loadedVia: "skill",
    durationMs: 1000,
    contextTokens: 1000,
    assertionsPassed: 2,
    assertionsTotal: 2,
    ...overrides,
  };
}

function bundled(path: string, overrides: Partial<BundledFile> = {}): BundledFile {
  return {
    path,
    loadMode: loadModeOf(path),
    bytes: 100,
    tokens: 250,
    signposted: true,
    ...overrides,
  };
}

function score(overrides: Partial<SplitScore> = {}): SplitScore {
  return {
    scenarios: 2,
    runs: 4,
    assertionsPassed: 8,
    assertionsTotal: 8,
    passRate: 1,
    meanContextTokens: 10_000,
    runsWithoutSkill: 0,
    runsLoadedViaFile: 0,
  loadRate: 1,
    ...overrides,
  };
}

function candidate(id: string): DisclosureCandidate {
  return { id, summary: id, rationale: "because", edits: [] };
}


describe("measureWithGate", () => {
  /** Runs whose score is whatever the test needs the split to look like. */
  function runsAt(scenarioId: string, contextTokens: number, passed: number): ScenarioRun[] {
    return [
      run({ scenarioId, attempt: 1, contextTokens, assertionsPassed: passed, assertionsTotal: 2 }),
      run({ scenarioId, attempt: 2, contextTokens, assertionsPassed: passed, assertionsTotal: 2 }),
    ];
  }

  /** Three recording sweeps, so "which sweeps ran" is a fact the test can assert. */
  function sweeps(parts: {
    all?: ScenarioRun[];
    train?: ScenarioRun[];
    holdout?: ScenarioRun[];
  }) {
    const calls: string[] = [];
    return {
      calls,
      sweepAll: async (): Promise<readonly ScenarioRun[]> => {
        calls.push("all");
        return parts.all ?? [];
      },
      sweepTrain: async (): Promise<readonly ScenarioRun[]> => {
        calls.push("train");
        return parts.train ?? [];
      },
      sweepHoldout: async (): Promise<readonly ScenarioRun[]> => {
        calls.push("holdout");
        return parts.holdout ?? [];
      },
      partitionRuns: (runs: readonly ScenarioRun[]) => ({
        train: runs.filter((entry) => entry.scenarioId.startsWith("train")),
        holdout: runs.filter((entry) => !entry.scenarioId.startsWith("train")),
      }),
    };
  }

  const incumbent = score({ passRate: 1, meanContextTokens: 10_000 });

  test("the baseline runs both splits in ONE pool, ungated", async () => {
    // Not two half-sweeps: the baseline has to measure both whatever it scores, and two
    // sequential pools drain twice. It is also the thing every candidate is compared
    // against, so there is nothing to gate it on.
    const fakes = sweeps({
      all: [...runsAt("train-1", 10_000, 2), ...runsAt("hold-1", 9_000, 2)],
    });
    const measured = await measureWithGate({ ...fakes, hasHoldout: true, gateAgainst: null });

    expect(fakes.calls).toEqual(["all"]);
    expect(measured.gateReason).toBeNull();
    expect(measured.train.meanContextTokens).toBe(10_000);
    expect(measured.holdout?.meanContextTokens).toBe(9_000);
  });

  test("a candidate that loses on train never spends a held-out run", async () => {
    // The whole point of the change. At --holdout 0.4 these are two runs in five, and
    // each one does the skill's real work.
    const fakes = sweeps({ train: runsAt("train-1", 12_000, 2) });
    const measured = await measureWithGate({
      ...fakes,
      hasHoldout: true,
      gateAgainst: incumbent,
    });

    expect(fakes.calls).toEqual(["train"]);
    expect(fakes.calls).not.toContain("holdout");
    expect(measured.gateReason).not.toBeNull();
    expect(measured.holdoutRuns).toHaveLength(0);
  });

  test("a gated candidate reports a null held-out score, which is what keeps it unselectable", async () => {
    const fakes = sweeps({ train: runsAt("train-1", 12_000, 2) });
    const measured = await measureWithGate({
      ...fakes,
      hasHoldout: true,
      gateAgainst: incumbent,
    });
    expect(measured.holdout).toBeNull();
    expect(measured.gateReason).not.toBeNull();
  });

  test("a candidate still in contention gets its held-out runs, in that order", async () => {
    const fakes = sweeps({
      train: runsAt("train-1", 8_000, 2),
      holdout: runsAt("hold-1", 7_500, 2),
    });
    const measured = await measureWithGate({
      ...fakes,
      hasHoldout: true,
      gateAgainst: incumbent,
    });

    expect(fakes.calls).toEqual(["train", "holdout"]);
    expect(measured.gateReason).toBeNull();
    expect(measured.holdout?.meanContextTokens).toBe(7_500);
    expect(measured.train.meanContextTokens).toBe(8_000);
  });

  test("with no holdout configured nothing is gated, because train IS the selection split", async () => {
    // Gating here would delete candidates rather than save anything: there is no second
    // sweep to skip, and a filtered candidate would simply vanish from the iteration.
    const fakes = sweeps({ train: runsAt("train-1", 12_000, 1) });
    const measured = await measureWithGate({
      ...fakes,
      hasHoldout: false,
      gateAgainst: incumbent,
    });

    expect(fakes.calls).toEqual(["train"]);
    expect(measured.gateReason).toBeNull();
    expect(measured.holdout).toBeNull();
  });

  test("a tie on train is measured on the held-out split rather than assumed to lose", async () => {
    const fakes = sweeps({
      train: runsAt("train-1", 10_000, 2),
      holdout: runsAt("hold-1", 6_000, 2),
    });
    const measured = await measureWithGate({
      ...fakes,
      hasHoldout: true,
      gateAgainst: incumbent,
    });
    expect(fakes.calls).toEqual(["train", "holdout"]);
    expect(measured.holdout?.meanContextTokens).toBe(6_000);
  });

  test("the gate uses --pass-rate-tolerance, so widening it buys held-out measurements", async () => {
    const broken = runsAt("train-1", 5_000, 1);
    const tight = await measureWithGate({
      ...sweeps({ train: broken }),
      hasHoldout: true,
      gateAgainst: incumbent,
      passRateTolerance: 0.05,
    });
    expect(tight.gateReason).not.toBeNull();

    const wide = await measureWithGate({
      ...sweeps({ train: broken, holdout: runsAt("hold-1", 5_000, 1) }),
      hasHoldout: true,
      gateAgainst: incumbent,
      passRateTolerance: 0.75,
    });
    expect(wide.gateReason).toBeNull();
    expect(wide.holdout).not.toBeNull();
  });
});

describe("layoutDescription", () => {
  let root = "";

  beforeEach(async () => {
    root = `${process.env["TMPDIR"] ?? "/tmp"}/disclosure-desc-${crypto.randomUUID().slice(0, 8)}`;
    await Bun.write(`${root}/.keep`, "");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  // The read this pins reaches every scenario copy the loop installs, so a truncated one
  // makes the whole run describe an artifact nobody ships. It had no coverage because the
  // sweep around it spawns `claude`; naming the read is what made it reachable.
  test("keeps everything after a blank line, so scenarios install the shipped description", async () => {
    const skill = `${root}/blank-line-skill`;
    await Bun.write(
      `${skill}/SKILL.md`,
      [
        "---",
        "name: blank-line-skill",
        "description: |",
        "  Use when the first paragraph is only part of the trigger.",
        "",
        "  Do not use when the second paragraph rules the case out.",
        "---",
        "",
        "Body.",
        "",
      ].join("\n"),
    );

    expect(await layoutDescription(skill)).toBe(
      "Use when the first paragraph is only part of the trigger.\n" +
        "\n" +
        "Do not use when the second paragraph rules the case out.",
    );
  });
});

/**
 * The fold both entry points share, which is the path `results.json` actually takes.
 *
 * `measureDisclosure` and `optimizeDisclosure` both spawn `claude`, so neither is reachable
 * from the suite -- but everything between the runs and the file on disk goes through here,
 * so this is where the shape a consumer reads can be pinned without an hour of API time.
 */
describe("summarizeLayout and ground truth", () => {
  let root = "";

  beforeEach(async () => {
    root = `${process.env["TMPDIR"] ?? "/tmp"}/disclosure-ground-truth-${crypto.randomUUID().slice(0, 8)}`;
    await Bun.write(`${root}/SKILL.md`, ["---", "name: demo", "description: Demo.", "---", "", "See references/deep.md.", ""].join("\n"));
    await Bun.write(`${root}/references/deep.md`, "Deep detail.\n");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const measured = (runs: readonly ScenarioRun[]): GatedMeasurement => ({
    trainRuns: [...runs],
    holdoutRuns: [],
    train: scoreRuns(runs),
    holdout: null,
    gateReason: null,
  });

  test("recall and over-fetch reach the record a consumer reads", async () => {
    const layout = await summarizeLayout({
      dir: root,
      counter: estimatingCounter(),
      inlineThreshold: 0.8,
      measured: measured([
        run({ scenarioId: "needs", filesRead: ["references/deep.md"] }),
        run({ scenarioId: "needs", attempt: 2 }),
        run({ scenarioId: "negative", attempt: 3, filesRead: ["references/deep.md"] }),
      ]),
      scenarios: [
        { id: "needs", prompt: "p", expectations: [], expectsReferences: ["references/deep.md"] },
        { id: "negative", prompt: "p", expectations: [], expectsReferences: [] },
      ],
    });
    const deep = layout.files.find((file) => file.path === "references/deep.md");
    expect(deep?.pulls).toBe(2);
    expect(deep?.recall).toEqual({ reads: 1, expectedRuns: 2, rate: 0.5 });
    expect(layout.groundTruth.overFetch).toEqual({
      scenarios: 1,
      runs: 1,
      runsThatRead: 1,
      rate: 1,
    });
  });

  test("a caller passing no scenarios gets today's output plus a stated absence", async () => {
    // The backward-compatible path. Every pull rate is what it always was, `recall` is null
    // rather than zero, and `groundTruth` says no scenario declared anything -- which is
    // the difference between "not measured" and "measured and found wanting".
    const layout = await summarizeLayout({
      dir: root,
      counter: estimatingCounter(),
      inlineThreshold: 0.8,
      measured: measured([run({ filesRead: ["references/deep.md"] })]),
    });
    const deep = layout.files.find((file) => file.path === "references/deep.md");
    expect(deep?.pullRate).toBe(1);
    expect(deep?.recall).toBeNull();
    expect(layout.groundTruth.annotatedScenarios).toBe(0);
    expect(layout.groundTruth.overFetch).toBeNull();
  });
});

// Scheduling. A pool drawing work in file order can hand out its longest task last and
// then finish it alone while every other worker idles: measured on the real corpus, a
// 254s scenario that started at t=122s set the sweep's whole 376s makespan.

const sc = (id: string) => ({ id, prompt: "p", expectations: [] }) as never;

test("with no history the file order is preserved exactly", () => {
  expect(orderAttempts([sc("a"), sc("b"), sc("c")], 1).map((o) => o.scenario.id)).toEqual([
    "a",
    "b",
    "c",
  ]);
});

test("an empty hint map is treated as no history rather than as all-zero", () => {
  expect(orderAttempts([sc("a"), sc("b")], 1, new Map()).map((o) => o.scenario.id)).toEqual([
    "a",
    "b",
  ]);
});

test("known-long scenarios are scheduled first", () => {
  const hints = new Map([
    ["a", 10_000],
    ["b", 254_000],
    ["c", 51_000],
  ]);
  expect(orderAttempts([sc("a"), sc("b"), sc("c")], 1, hints).map((o) => o.scenario.id)).toEqual([
    "b",
    "c",
    "a",
  ]);
});

test("an unknown scenario sorts last, because unknown is not evidence of being short", () => {
  const hints = new Map([["known", 5_000]]);
  expect(orderAttempts([sc("unknown"), sc("known")], 1, hints).map((o) => o.scenario.id)).toEqual([
    "known",
    "unknown",
  ]);
});

test("every attempt of a scenario is still produced", () => {
  const hints = new Map([
    ["a", 1],
    ["b", 2],
  ]);
  const order = orderAttempts([sc("a"), sc("b")], 3, hints);
  expect(order.length).toBe(6);
  expect(order.filter((o) => o.scenario.id === "a").map((o) => o.attempt)).toEqual([1, 2, 3]);
});

