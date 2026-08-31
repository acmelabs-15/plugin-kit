import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { readResumeFile, readResumeState } from "../optimize-disclosure.ts";

const split = (passed: number) => ({
  scenarios: 4, runs: 8, assertionsPassed: passed, assertionsTotal: 27, passRate: passed / 27,
  meanContextTokens: 90_000, runsWithoutSkill: 0, runsLoadedViaFile: 0,
});
const record = (iteration: number, candidateId: string | null, accepted: boolean, bodyTokens = 4_000) => ({
  iteration, label: candidateId ?? "baseline", candidateId, rationale: "", bodyTokens,
  train: split(20), holdout: split(5), accepted, note: "",
});

describe("readResumeState", () => {
  test("rebuilds the loop state from a results.json whose layouts still exist", async () => {
    const dir = await mkdtemp(`${tmpdir()}/resume-`);
    try {
      const state = readResumeState({
        skill_path: `${dir}/skill`,
        best_layout_path: dir,
        baseline_body_tokens: 4_100,
        best_body_tokens: 3_600,
        train_size: 3, holdout_size: 2, runs_per_scenario: 2,
        applied_edits: ["moved rules out"],
        notes: ["a note"],
        files: [{ path: "references/a.md", loadMode: "read", bytes: 4_000, tokens: 1_000, signposted: true, pulls: 0, countedRuns: 8, pullRate: 0, verdict: "signpost", recall: { reads: 0, expectedRuns: 2, rate: 0 } }],
        ground_truth: { annotatedScenarios: 1, negativeScenarios: 0, annotatedRuns: 2, overFetch: null },
        iterations: [record(1, null, true, 4_100), record(2, "cand-a", false), record(2, "cand-b", true, 3_600)],
      }, "test");
      expect(state.nextIteration).toBe(3);
      expect(state.alreadyTried).toEqual(["cand-a", "cand-b"]);
      expect(state.current.dir).toBe(dir);
      expect(state.current.bodyTokens).toBe(3_600);
      expect(state.baseline.bodyTokens).toBe(4_100);
      expect(state.baseline.dir).toBe(`${dir}/skill`);
      expect(state.current.runs).toEqual([]);
      expect(state.appliedEdits).toEqual(["moved rules out"]);
      expect(state.settledAttempts).toBe(3 * 5 * 2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("refuses a file whose layout directory is gone, and one with no scored layouts", () => {
    expect(() => readResumeState({ iterations: [record(1, null, true)], best_layout_path: "/nonexistent/x" }, "t")).toThrow(/does not exist on disk/);
    expect(() => readResumeState({ iterations: [], best_layout_path: "/" }, "t")).toThrow(/no scored layouts/);
    expect(() => readResumeState({ iterations: [{ iteration: 1 }], best_layout_path: "/" }, "t")).toThrow(/not a scored layout record/);
  });

  test("refuses a file row missing what the report renders, instead of crashing the report later", () => {
    expect(() => readResumeState({ skill_path: "/", best_layout_path: "/", files: [{ path: "references/a.md" }], iterations: [record(1, null, true)] }, "t")).toThrow(/files\[0\] is not a file record/);
  });

  test("a missing or non-JSON resume file is one plain refusal, not a stack", async () => {
    await expect(readResumeFile("/nonexistent/results.json")).rejects.toThrow(/cannot read it as JSON .*refusing a partial resume/);
    const dir = await mkdtemp(`${tmpdir()}/resume-`);
    try {
      await Bun.write(`${dir}/results.json`, "{ not json");
      await expect(readResumeFile(`${dir}/results.json`)).rejects.toThrow(/cannot read it as JSON/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("when the baseline is the only accepted layout, current is the baseline itself", () => {
    const state = readResumeState({ skill_path: "/", best_layout_path: "/", iterations: [record(1, null, true), record(2, "c", false)] }, "t");
    expect(state.current).toBe(state.baseline);
    expect(state.nextIteration).toBe(3);
  });
});
