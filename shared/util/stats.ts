/**
 * Summary statistics matching `aggregate_benchmark.py::calculate_stats`
 * bit-for-bit.
 *
 * PINNED REFERENCE: CPython 3.12.8. Since CPython 3.12 the builtin `sum()`
 * accumulates exact-float inputs with the improved Kahan-Babuska (Neumaier)
 * compensated algorithm, so `sum([0.1] * 10)` is exactly `1.0`. A naive left
 * fold -- and CPython <= 3.11 -- yields `0.9999999999999999` instead.
 *
 * Reproducing that is not academic. Measured against CPython over the sample
 * datasets in `__tests__/stats.test.ts`, a naive fold diverged on 7 of 10
 * datasets by up to ~2% relative error, and turned the stddev of a constant
 * dataset from exactly `0.0` into `3.7e-18` -- which surfaces in the report as
 * a spurious uncertainty band on a perfectly stable metric.
 */

import { pyRound } from "./pyfloat.ts";

/** Decimal places `calculate_stats` rounds every statistic to. */
export const STAT_PRECISION = 4;

export interface Stats {
  readonly mean: number;
  readonly stddev: number;
  readonly min: number;
  readonly max: number;
}

/**
 * Equivalent of CPython >= 3.12 `sum(values)` over floats.
 *
 * Improved Kahan-Babuska (Neumaier) compensated summation. `c` carries the
 * rounding error lost by each partial sum; it is folded back in at the end.
 *
 * The `isFinite` guard on the final fold mirrors CPython: once the running
 * total overflows to an infinity the compensation term is meaningless (it goes
 * to +/-inf or NaN), so CPython returns the total unadjusted. Without the
 * guard `sum([1e308, 1e308, -1e308])` returns NaN where CPython returns `inf`.
 */
export function pySum(values: Iterable<number>): number {
  let total = 0;
  let c = 0;
  for (const x of values) {
    const t = total + x;
    if (Math.abs(total) >= Math.abs(x)) {
      c += total - t + x;
    } else {
      c += x - t + total;
    }
    total = t;
  }
  return Number.isFinite(total) ? total + c : total;
}

/** Equivalent of CPython `min(values)`: first minimal element wins. */
function pyMin(values: readonly number[]): number {
  let best = values[0] ?? 0;
  for (const v of values) {
    if (v < best) best = v;
  }
  return best;
}

/** Equivalent of CPython `max(values)`: first maximal element wins. */
function pyMax(values: readonly number[]): number {
  let best = values[0] ?? 0;
  for (const v of values) {
    if (v > best) best = v;
  }
  return best;
}

/**
 * Sample standard deviation with Bessel's correction, exactly `0` when there
 * is a single value (CPython takes the `else` branch rather than dividing by
 * zero).
 *
 * `d * d` rather than `d ** 2`: IEEE multiplication is correctly rounded, so it
 * equals the correctly-rounded `pow(d, 2)` CPython computes, without depending
 * on the platform libm's `pow` accuracy.
 */
function sampleStddev(values: readonly number[], mean: number): number {
  if (values.length <= 1) return 0;
  const squaredDeviations = values.map((v) => {
    const d = v - mean;
    return d * d;
  });
  return Math.sqrt(pySum(squaredDeviations) / (values.length - 1));
}

/** Calculate mean, stddev, min, max for a list of values. */
export function calculateStats(values: readonly number[]): Stats {
  if (values.length === 0) {
    return { mean: 0, stddev: 0, min: 0, max: 0 };
  }

  const mean = pySum(values) / values.length;

  return {
    mean: pyRound(mean, STAT_PRECISION),
    stddev: pyRound(sampleStddev(values, mean), STAT_PRECISION),
    min: pyRound(pyMin(values), STAT_PRECISION),
    max: pyRound(pyMax(values), STAT_PRECISION),
  };
}
