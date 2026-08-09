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

import { layoutDescription, measureWithGate } from "../disclosure-measure.ts";
import {
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
