import { describe, expect, test } from "bun:test";

import { splitEvalSet } from "../optimize-description.ts";
import type { EvalItem } from "../measure-triggering.ts";

interface IndexedItem extends EvalItem {
  readonly index: number;
}

/** 20 items, even indices positive. Stratification therefore splits 10/10. */
function buildEvalSet(size = 20): IndexedItem[] {
  return Array.from({ length: size }, (_, index) => ({
    index,
    query: `q${index}`,
    should_trigger: index % 2 === 0,
  }));
}

const indicesOf = (items: readonly IndexedItem[]): number[] => items.map((item) => item.index);

describe("splitEvalSet", () => {
  test("reproduces CPython's stratified shuffle exactly at holdout 0.4, seed 42", () => {
    const [train, test] = splitEvalSet(buildEvalSet(), 0.4);

    // Membership AND order, verified against CPython random.seed(42) + shuffle.
    expect(indicesOf(train)).toEqual([10, 12, 18, 8, 0, 2, 3, 17, 15, 1, 13, 19]);
    expect(indicesOf(test)).toEqual([14, 6, 4, 16, 7, 11, 5, 9]);
  });

  test("is stratified: each stratum contributes trunc(n * holdout) to the test set", () => {
    const [train, test] = splitEvalSet(buildEvalSet(), 0.4);

    expect(test.filter((item) => item.should_trigger)).toHaveLength(4);
    expect(test.filter((item) => !item.should_trigger)).toHaveLength(4);
    expect(train.filter((item) => item.should_trigger)).toHaveLength(6);
    expect(train.filter((item) => !item.should_trigger)).toHaveLength(6);
  });

  test("emits triggers before non-triggers within each side of the split", () => {
    const [train, test] = splitEvalSet(buildEvalSet(), 0.4);
    const triggerFlags = (items: readonly IndexedItem[]): boolean[] =>
      items.map((item) => item.should_trigger);

    expect(triggerFlags(test)).toEqual([true, true, true, true, false, false, false, false]);
    expect(triggerFlags(train)).toEqual([
      true, true, true, true, true, true, false, false, false, false, false, false,
    ]);
  });

  test("partitions the input with no overlap and no loss", () => {
    const evalSet = buildEvalSet();
    const [train, test] = splitEvalSet(evalSet, 0.4);

    expect(train).toHaveLength(12);
    expect(test).toHaveLength(8);
    expect([...indicesOf(train), ...indicesOf(test)].sort((a, b) => a - b)).toEqual(
      indicesOf(evalSet),
    );
  });

  test("is deterministic across calls for a fixed seed", () => {
    const first = splitEvalSet(buildEvalSet(), 0.4);
    const second = splitEvalSet(buildEvalSet(), 0.4);

    expect(indicesOf(first[0])).toEqual(indicesOf(second[0]));
    expect(indicesOf(first[1])).toEqual(indicesOf(second[1]));
  });

  test("a different seed produces a different draw", () => {
    const [seeded42] = splitEvalSet(buildEvalSet(), 0.4);
    const [seeded7] = splitEvalSet(buildEvalSet(), 0.4, 7);

    expect(indicesOf(seeded7)).not.toEqual(indicesOf(seeded42));
  });

  test("truncates rather than rounds the per-stratum test count", () => {
    // 10 per stratum at 0.39 -> trunc(3.9) === 3, where rounding would give 4.
    const [, test] = splitEvalSet(buildEvalSet(), 0.39);
    expect(test).toHaveLength(6);
  });

  test("always holds out at least one item per stratum", () => {
    // 1 per stratum at 0.4 -> trunc(0.4) === 0, floored up to 1 by max(1, ...).
    const tiny: IndexedItem[] = [
      { index: 0, query: "a", should_trigger: true },
      { index: 1, query: "b", should_trigger: false },
    ];
    const [train, test] = splitEvalSet(tiny, 0.4);

    expect(test).toHaveLength(2);
    expect(train).toHaveLength(0);
  });
});
