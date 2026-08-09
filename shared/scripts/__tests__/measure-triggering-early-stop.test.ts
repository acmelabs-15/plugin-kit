/**
 * Early-stopping tests for the trigger sweep.
 *
 * The sweep used to schedule every attempt of every query into one flat pool, so the
 * third attempt of a query whose first two already agreed was in flight before anything
 * could notice it was pointless. It now schedules one pool item per query and stops that
 * query as soon as its verdict is settled.
 *
 * The claim that has to hold, and the reason most of this file exists, is that stopping
 * early never changes a verdict. That is asserted EXHAUSTIVELY rather than by example --
 * every trigger sequence, at several thresholds and run counts, scored through the same
 * `summarizeQuery` the harness ships -- because "the shortcut agrees with the long way
 * round" is the kind of claim that is true for the cases someone thought of and false at
 * a boundary they did not.
 *
 * Nothing here spawns `claude`. `runQueryAttempts` takes the attempt as a parameter for
 * exactly that reason, so the scheduling can be driven with a canned sequence.
 */

import { describe, expect, test } from "bun:test";

import { parseArgs } from "../lib/cli.ts";
import {
  decideTrigger,
  runQueryAttempts,
  SHARED_EVAL_FLAGS,
  summarizeQuery,
  type EvalItem,
  type TriggerDecision,
} from "../measure-triggering.ts";

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function item(shouldTrigger: boolean): EvalItem {
  return { query: "make me a chart", should_trigger: shouldTrigger };
}

/** Feed a fixed sequence of outcomes, and record how many were consumed. */
function canned(outcomes: readonly boolean[]): {
  attempt: (index: number) => Promise<boolean>;
  consumed: () => number;
} {
  let consumed = 0;
  return {
    attempt: async (index: number): Promise<boolean> => {
      consumed += 1;
      return outcomes[index] ?? false;
    },
    consumed: () => consumed,
  };
}

/** Every boolean sequence of the given length, as a plain enumeration. */
function allSequences(length: number): boolean[][] {
  const sequences: boolean[][] = [];
  for (let mask = 0; mask < 2 ** length; mask += 1) {
    const sequence: boolean[] = [];
    for (let bit = 0; bit < length; bit += 1) sequence.push((mask & (1 << bit)) !== 0);
    sequences.push(sequence);
  }
  return sequences;
}

// ---------------------------------------------------------------------------
// The decision rule
// ---------------------------------------------------------------------------

describe("decideTrigger", () => {
  const decide = (
    triggers: number,
    settled: number,
    planned: number,
    threshold: number,
  ): TriggerDecision => decideTrigger({ triggers, settled, planned, threshold });

  test("nothing is decided before an attempt has been run", () => {
    // The guard matters at threshold 0, where `0/n >= 0` is true on arithmetic alone. A
    // query decided before it ran anything would report zero runs and be dropped from the
    // results entirely, which is a silently missing row rather than a fast one.
    expect(decide(0, 0, 3, 0)).toBe("undecided");
    expect(decide(0, 0, 3, 0.5)).toBe("undecided");
  });

  test("at the CLI defaults, two concordant attempts settle a query", () => {
    // Three runs, threshold 0.5: two triggers put the rate at 2/3 whatever the third
    // does, and two non-triggers cap it at 1/3. This is where the saving comes from.
    expect(decide(2, 2, 3, 0.5)).toBe("at-threshold");
    expect(decide(0, 2, 3, 0.5)).toBe("below-threshold");
  });

  test("a split first two attempts leaves the verdict genuinely open", () => {
    expect(decide(1, 1, 3, 0.5)).toBe("undecided");
    expect(decide(1, 2, 3, 0.5)).toBe("undecided");
    expect(decide(0, 1, 3, 0.5)).toBe("undecided");
  });

  test("the third attempt always settles it, whichever way it lands", () => {
    expect(decide(2, 3, 3, 0.5)).toBe("at-threshold");
    expect(decide(1, 3, 3, 0.5)).toBe("below-threshold");
  });

  test("a single-run query is settled by its only attempt", () => {
    expect(decide(1, 1, 1, 0.5)).toBe("at-threshold");
    expect(decide(0, 1, 1, 0.5)).toBe("below-threshold");
  });

  test("threshold 1 needs a clean sweep, so one miss ends it", () => {
    expect(decide(1, 1, 3, 1)).toBe("undecided");
    expect(decide(1, 2, 3, 1)).toBe("below-threshold");
    expect(decide(3, 3, 3, 1)).toBe("at-threshold");
  });

  test("threshold 0 is met by anything, so the first attempt settles it", () => {
    expect(decide(0, 1, 3, 0)).toBe("at-threshold");
  });

  test("a fractional threshold rounds the way the pass rule does", () => {
    // 0.75 of 4 is exactly 3, so three triggers decide it and two cannot.
    expect(decide(2, 2, 4, 0.75)).toBe("undecided");
    expect(decide(3, 3, 4, 0.75)).toBe("at-threshold");
    // Two misses cap the best case at 2/4, under the bar.
    expect(decide(0, 2, 4, 0.75)).toBe("below-threshold");
  });

  test("a threshold that is not a clean fraction of the run count still decides", () => {
    // 1/3 of 3 is 1, so one trigger is enough -- the boundary a `ceil(threshold * n)`
    // spelling gets wrong when the product lands a hair below an integer.
    expect(decide(1, 1, 3, 1 / 3)).toBe("at-threshold");
    expect(decide(0, 3, 3, 1 / 3)).toBe("below-threshold");
  });

  test("a zero budget decides nothing rather than dividing by it", () => {
    expect(decide(0, 0, 0, 0.5)).toBe("undecided");
  });
});

// ---------------------------------------------------------------------------
// The scheduling
// ---------------------------------------------------------------------------

describe("runQueryAttempts", () => {
  test("two concordant attempts retire the query and the third is never made", async () => {
    const source = canned([true, true, true]);
    const outcome = await runQueryAttempts({
      planned: 3,
      threshold: 0.5,
      earlyStop: true,
      attempt: source.attempt,
    });
    expect(source.consumed()).toBe(2);
    expect(outcome).toEqual({ triggers: 2, runs: 2, planned: 3 });
  });

  test("a split verdict spends the whole budget", async () => {
    const source = canned([true, false, false]);
    const outcome = await runQueryAttempts({
      planned: 3,
      threshold: 0.5,
      earlyStop: true,
      attempt: source.attempt,
    });
    expect(source.consumed()).toBe(3);
    expect(outcome).toEqual({ triggers: 1, runs: 3, planned: 3 });
  });

  test("earlyStop false spends every attempt however concordant they are", async () => {
    const source = canned([true, true, true]);
    const outcome = await runQueryAttempts({
      planned: 3,
      threshold: 0.5,
      earlyStop: false,
      attempt: source.attempt,
    });
    expect(source.consumed()).toBe(3);
    expect(outcome).toEqual({ triggers: 3, runs: 3, planned: 3 });
  });

  test("progress fires once per attempt actually run, not once per planned attempt", async () => {
    // The pool's own `onSettled` now fires once per QUERY, so this callback is the only
    // thing keeping the progress bar counting attempts. A bar that jumped by three when a
    // query finished would be useless on a set of twenty queries and ten workers.
    const seen: boolean[] = [];
    await runQueryAttempts({
      planned: 3,
      threshold: 0.5,
      earlyStop: true,
      attempt: canned([false, false, false]).attempt,
      onAttempt: (triggered) => seen.push(triggered),
    });
    expect(seen).toEqual([false, false]);
  });

  test("the attempt is never called more times than the budget allows", async () => {
    const source = canned([true, false, true, false]);
    const outcome = await runQueryAttempts({
      planned: 4,
      threshold: 0.9,
      earlyStop: true,
      attempt: source.attempt,
    });
    expect(source.consumed()).toBeLessThanOrEqual(4);
    expect(outcome.runs).toBeLessThanOrEqual(4);
  });

  test("a zero budget runs nothing, which is what drops the query from the results", async () => {
    const source = canned([]);
    const outcome = await runQueryAttempts({
      planned: 0,
      threshold: 0.5,
      earlyStop: true,
      attempt: source.attempt,
    });
    expect(source.consumed()).toBe(0);
    expect(outcome.runs).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The claim the whole change rests on
// ---------------------------------------------------------------------------

describe("early stopping never changes a verdict", () => {
  const THRESHOLDS = [0, 0.25, 1 / 3, 0.5, 0.6, 2 / 3, 0.75, 1] as const;

  test("exhaustively, for every sequence at every threshold and run count", async () => {
    let compared = 0;
    let saved = 0;
    let attemptsStopped = 0;
    let attemptsFull = 0;

    for (let planned = 1; planned <= 6; planned += 1) {
      for (const sequence of allSequences(planned)) {
        for (const threshold of THRESHOLDS) {
          for (const shouldTrigger of [true, false]) {
            const stopped = await runQueryAttempts({
              planned,
              threshold,
              earlyStop: true,
              attempt: canned(sequence).attempt,
            });
            const full = await runQueryAttempts({
              planned,
              threshold,
              earlyStop: false,
              attempt: canned(sequence).attempt,
            });

            // Scored through the shipped summariser, not a reimplementation of it: the
            // claim is about the pass rule and the stopping rule agreeing with each
            // other, and a test that recomputes either proves nothing about the code.
            const stoppedResult = summarizeQuery({
              item: item(shouldTrigger),
              outcome: stopped,
              threshold,
            });
            const fullResult = summarizeQuery({
              item: item(shouldTrigger),
              outcome: full,
              threshold,
            });

            expect({
              planned,
              sequence: sequence.join(""),
              threshold,
              shouldTrigger,
              pass: stoppedResult.pass,
            }).toEqual({
              planned,
              sequence: sequence.join(""),
              threshold,
              shouldTrigger,
              pass: fullResult.pass,
            });

            expect(full.runs).toBe(planned);
            expect(stopped.runs).toBeLessThanOrEqual(planned);
            expect(stoppedResult.early_stopped).toBe(stopped.runs < planned);
            expect(fullResult.early_stopped).toBe(false);

            compared += 1;
            attemptsStopped += stopped.runs;
            attemptsFull += full.runs;
            if (stopped.runs < full.runs) saved += 1;
          }
        }
      }
    }

    // A guard on the guard: an equivalence test passes trivially if the shortcut never
    // fires, so assert that it fired on most of the cases and actually removed attempts.
    expect(compared).toBe(2 * THRESHOLDS.length * (2 + 4 + 8 + 16 + 32 + 64));
    expect(saved / compared).toBeGreaterThan(0.5);
    expect(attemptsStopped).toBeLessThan(attemptsFull);
  });

  test("at the CLI defaults, a query costs two attempts unless its first two disagree", async () => {
    // The saving, stated as a number rather than as a hope, and the number depends on the
    // query rather than on the harness. Three runs at threshold 0.5: the first attempt can
    // never decide anything, the second decides whenever it agrees with the first, and the
    // third is only ever spent on a query that is genuinely split.
    //
    // So over ALL eight sequences -- which is the p=0.5 coin-flip query, the worst case --
    // four stop at two and the set costs 20 attempts instead of 24. A real eval set does
    // considerably better than that, because its useful queries score 0/3 or 3/3 and
    // therefore always agree on the first two: those cost two attempts flat, a third off.
    const consumed: number[] = [];
    for (const sequence of allSequences(3)) {
      const outcome = await runQueryAttempts({
        planned: 3,
        threshold: 0.5,
        earlyStop: true,
        attempt: canned(sequence).attempt,
      });
      consumed.push(outcome.runs);
    }
    expect(consumed.filter((runs) => runs === 2)).toHaveLength(4);
    expect(consumed.filter((runs) => runs === 3)).toHaveLength(4);
    expect(consumed.reduce((total, runs) => total + runs, 0)).toBe(20);

    // The two extremes, which is where a real set lives.
    for (const sequence of [[true, true, true], [false, false, false]]) {
      const outcome = await runQueryAttempts({
        planned: 3,
        threshold: 0.5,
        earlyStop: true,
        attempt: canned(sequence).attempt,
      });
      expect(outcome.runs).toBe(2);
    }
  });
});

// ---------------------------------------------------------------------------
// What the row says afterwards
// ---------------------------------------------------------------------------

describe("summarizeQuery", () => {
  test("the rate is over attempts RUN, and the row says so", () => {
    // The honest consequence of stopping early: 2/2 rather than 2/3. `early_stopped` is
    // what lets a reader tell one from the other, which is why it is on the row rather
    // than inferred from `runs` against a budget the row does not carry.
    const result = summarizeQuery({
      item: item(true),
      outcome: { triggers: 2, runs: 2, planned: 3 },
      threshold: 0.5,
    });
    expect(result.trigger_rate).toBe(1);
    expect(result.runs).toBe(2);
    expect(result.early_stopped).toBe(true);
    expect(result.pass).toBe(true);
  });

  test("a full-budget row is not marked as stopped", () => {
    const result = summarizeQuery({
      item: item(true),
      outcome: { triggers: 2, runs: 3, planned: 3 },
      threshold: 0.5,
    });
    expect(result.trigger_rate).toBeCloseTo(2 / 3, 10);
    expect(result.early_stopped).toBe(false);
  });

  test("a negative query passes by staying under the threshold", () => {
    const result = summarizeQuery({
      item: item(false),
      outcome: { triggers: 0, runs: 2, planned: 3 },
      threshold: 0.5,
    });
    expect(result.pass).toBe(true);
    expect(result.early_stopped).toBe(true);
  });

  test("a negative query that triggered fails, stopped early or not", () => {
    const stopped = summarizeQuery({
      item: item(false),
      outcome: { triggers: 2, runs: 2, planned: 3 },
      threshold: 0.5,
    });
    const full = summarizeQuery({
      item: item(false),
      outcome: { triggers: 2, runs: 3, planned: 3 },
      threshold: 0.5,
    });
    expect(stopped.pass).toBe(false);
    expect(full.pass).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The flag
// ---------------------------------------------------------------------------

describe("--no-early-stop", () => {
  test("stopping early is the default, so the flag is absent-means-false", () => {
    const { flags } = parseArgs([], SHARED_EVAL_FLAGS);
    expect(flags["no-early-stop"]).toBe(false);
  });

  test("the flag takes no value and turns full-N rates back on", () => {
    const { flags } = parseArgs(["--no-early-stop"], SHARED_EVAL_FLAGS);
    expect(flags["no-early-stop"]).toBe(true);
  });

  test("it is on the shared spec, so optimize-description.ts inherits it rather than redeclaring it", () => {
    // Both entrypoints run the same sweep, and a flag declared twice is a flag whose
    // default drifts. The help text is the contract for why anyone would reach for it.
    expect(SHARED_EVAL_FLAGS["no-early-stop"]?.kind).toBe("boolean");
    expect(SHARED_EVAL_FLAGS["no-early-stop"]?.help).toContain("full-N");
  });
});
