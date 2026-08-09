/**
 * Fidelity tests for `lib/stats.ts` against CPython 3.12.8.
 *
 * Every `expected` block below is literal output from running
 * `aggregate_benchmark.py::calculate_stats` on the same `values` under CPython
 * 3.12.8. They are committed as data rather than regenerated, so this
 * repository needs only Bun to run its tests.
 *
 * Why this is worth testing at all: since 3.12 CPython's builtin `sum()`
 * accumulates floats with Neumaier compensated summation, and a naive left fold
 * is indistinguishable from a correct port by eye -- both produce
 * plausible-looking numbers. A naive fold diverged on 7 of the 15 datasets
 * here, by up to ~2% relative error on `catastrophic`, and reported a stddev of
 * 3.7e-18 for a dataset whose values are all identical. `divergesFromNaive`
 * records which datasets discriminate, and one test asserts a naive fold really
 * would fail them -- so this file cannot quietly stop testing anything.
 */

import { expect, test } from "bun:test";
import { calculateStats, pySum, type Stats } from "../lib/stats.ts";

interface Dataset {
  readonly name: string;
  readonly values: readonly number[];
  /** CPython `sum(values)`. */
  readonly pySum: number;
  readonly expected: Stats;
  /** True when a naive left fold produces a different sum. */
  readonly divergesFromNaive: boolean;
}

const DATASETS: readonly Dataset[] = [
  {
    name: "empty",
    values: [],
    pySum: 0,
    expected: { mean: 0.0, stddev: 0.0, min: 0.0, max: 0.0 },
    divergesFromNaive: false,
  },
  {
    name: "single value has zero stddev, not NaN",
    values: [0.85],
    pySum: 0.85,
    expected: { mean: 0.85, stddev: 0.0, min: 0.85, max: 0.85 },
    divergesFromNaive: false,
  },
  {
    name: "constant dataset: stddev is exactly 0.0, not 3.7e-18",
    values: [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1],
    pySum: 1.0,
    expected: { mean: 0.1, stddev: 0.0, min: 0.1, max: 0.1 },
    divergesFromNaive: true,
  },
  {
    name: "constant dataset, 100 values",
    values: Array.from({ length: 100 }, () => 0.1),
    pySum: 10.0,
    expected: { mean: 0.1, stddev: 0.0, min: 0.1, max: 0.1 },
    divergesFromNaive: true,
  },
  {
    name: "constant thirds",
    values: Array.from({ length: 7 }, () => 1 / 3),
    pySum: 2.333333333333333,
    expected: { mean: 0.3333, stddev: 0.0, min: 0.3333, max: 0.3333 },
    divergesFromNaive: false,
  },
  {
    name: "pass rates",
    values: [0.85, 0.9, 0.8, 0.67, 0.75],
    pySum: 3.97,
    expected: { mean: 0.794, stddev: 0.0891, min: 0.67, max: 0.9 },
    divergesFromNaive: true,
  },
  {
    name: "durations",
    values: [42.5, 31.25, 58.125, 44.0],
    pySum: 175.875,
    expected: { mean: 43.9688, stddev: 11.02, min: 31.25, max: 58.125 },
    divergesFromNaive: false,
  },
  {
    name: "token counts (integers)",
    values: [3800, 4100, 3200, 3900, 3700],
    pySum: 18700,
    expected: { mean: 3740.0, stddev: 336.1547, min: 3200, max: 4100 },
    divergesFromNaive: false,
  },
  {
    name: "sub-precision values round to zero",
    values: [1e-8, 2e-8, 3e-8],
    pySum: 6e-8,
    expected: { mean: 0.0, stddev: 0.0, min: 0.0, max: 0.0 },
    divergesFromNaive: true,
  },
  {
    name: "mixed signs",
    values: [-1.5, 2.5, -3.5, 4.5],
    pySum: 2.0,
    expected: { mean: 0.5, stddev: 3.6515, min: -3.5, max: 4.5 },
    divergesFromNaive: false,
  },
  {
    name: "catastrophic cancellation at 1e16",
    values: [1e16, 1.0, -1e16, 1.0],
    pySum: 2.0,
    expected: { mean: 0.5, stddev: 8164965809277260.0, min: -1e16, max: 1e16 },
    divergesFromNaive: true,
  },
  {
    name: "catastrophic cancellation at 1e100",
    values: [1.0, 1e100, 1.0, -1e100],
    pySum: 2.0,
    expected: { mean: 0.5, stddev: 8.164965809277261e99, min: -1e100, max: 1e100 },
    divergesFromNaive: true,
  },
  {
    name: "banker's rounding ties at the 4th decimal",
    values: [5e-5, 0.00015, 0.00025],
    pySum: 0.00045,
    expected: { mean: 0.0001, stddev: 0.0001, min: 0.0001, max: 0.0003 },
    divergesFromNaive: false,
  },
  {
    name: "two values",
    values: [0.6666666666666666, 0.3333333333333333],
    pySum: 1.0,
    expected: { mean: 0.5, stddev: 0.2357, min: 0.3333, max: 0.6667 },
    divergesFromNaive: false,
  },
  {
    name: "alternating magnitudes",
    values: [1e17, -1e17, 1.0, 1.0, 1.0],
    pySum: 3.0,
    expected: { mean: 0.6, stddev: 7.071067811865475e16, min: -1e17, max: 1e17 },
    divergesFromNaive: false,
  },
];

/** The wrong implementation this module exists to avoid. */
function naiveSum(values: readonly number[]): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

test("pySum reproduces CPython 3.12 sum() exactly", () => {
  for (const dataset of DATASETS) {
    expect(pySum(dataset.values), dataset.name).toBe(dataset.pySum);
  }
});

test("calculateStats reproduces CPython calculate_stats exactly", () => {
  for (const dataset of DATASETS) {
    expect(calculateStats(dataset.values), dataset.name).toEqual(dataset.expected);
  }
});

test("a constant dataset has stddev of exactly zero", () => {
  // Not toBeCloseTo: 3.7e-18 passes toBeCloseTo and is the exact bug in scope.
  expect(calculateStats([0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1]).stddev).toBe(0);
  expect(Object.is(calculateStats(Array.from({ length: 100 }, () => 0.1)).stddev, 0)).toBe(true);
});

test("the datasets flagged as discriminating really do defeat a naive fold", () => {
  for (const dataset of DATASETS) {
    const diverges = naiveSum(dataset.values) !== dataset.pySum;
    expect(diverges, dataset.name).toBe(dataset.divergesFromNaive);
  }
  expect(DATASETS.some((dataset) => dataset.divergesFromNaive)).toBe(true);
});

test("compensation is skipped once the running total overflows, as CPython does", () => {
  // Without the isFinite guard this is NaN; CPython returns inf.
  expect(pySum([1e308, 1e308, -1e308])).toBe(Number.POSITIVE_INFINITY);
  expect(pySum([Number.POSITIVE_INFINITY, 1.0])).toBe(Number.POSITIVE_INFINITY);
  expect(pySum([1.0, Number.NaN])).toBeNaN();
});

test("min and max take the first extremal element, as CPython does", () => {
  // CPython `min([0.0, -0.0])` is 0.0 because -0.0 < 0.0 is False;
  // Math.min(0, -0) would return -0.
  expect(Object.is(calculateStats([0.0, -0.0]).min, 0)).toBe(true);
  expect(Object.is(calculateStats([0.0, -0.0]).max, 0)).toBe(true);
});
