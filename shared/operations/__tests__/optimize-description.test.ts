import { describe, expect, test } from "bun:test";
import { bestIteration, gateOnTrain, type LoopHistoryEntry } from "../optimize-description.ts";

const entry = (iteration: number, train: number, test: number | null, gate?: string): LoopHistoryEntry => ({
  iteration,
  description: `d${iteration}`,
  train_passed: train,
  train_failed: 10 - train,
  train_total: 10,
  train_results: [],
  test_passed: test,
  test_failed: test === null ? null : 6 - test,
  test_total: test === null ? null : 6,
  test_results: test === null ? null : [],
  passed: train,
  failed: 10 - train,
  total: 10,
  results: [],
  ...(gate === undefined ? {} : { gate_reason: gate }),
});

describe("gateOnTrain", () => {
  test("a candidate below the incumbent on train is retired with the scores in the reason", () => {
    expect(gateOnTrain(8, 7, 10)).toMatch(/7\/10 against 8\/10/);
  });
  test("a tie or a win goes through to the held-out split", () => {
    expect(gateOnTrain(8, 8, 10)).toBeNull();
    expect(gateOnTrain(8, 9, 10)).toBeNull();
  });
});

describe("bestIteration", () => {
  test("selects on the held-out score and never a gated candidate, whatever its train score", () => {
    const history = [entry(1, 8, 4), entry(2, 9, 5), entry(3, 7, null, "lost on train"), entry(4, 10, null, "lost on train")];
    expect(bestIteration(history, true).iteration).toBe(2);
  });
  test("with no held-out split, train decides", () => {
    expect(bestIteration([entry(1, 8, null), entry(2, 9, null)], false).iteration).toBe(2);
  });
});
