/**
 * Concurrency-limited promise pool.
 *
 * Replaces `concurrent.futures.ProcessPoolExecutor` from run_eval.py. The swap
 * is exactly equivalent for this workload: the only use of `random` in the whole
 * pipeline is inside `split_eval_set`, which runs in the main process before any
 * pool work is submitted, so there is no per-worker RNG state to emulate. Each
 * unit of work is an out-of-process `claude -p` invocation, so the pool only
 * needs to cap in-flight children -- it does not need OS processes of its own.
 *
 * Two guarantees the executor did not give us:
 *
 * - OUTPUT ORDER IS INPUT ORDER, regardless of completion order. The Python
 *   collected via `as_completed` and keyed a dict by completion, making its
 *   result order nondeterministic.
 * - EVERY ITEM IS ATTEMPTED even if one worker throws. The first failure is
 *   re-thrown only after all runners have settled, so no work is left dangling.
 *
 * `onSettled` reports each completion as it happens. Results are collected in input
 * order and returned only once every item has settled, so without it a long run prints
 * nothing until the end and is indistinguishable from a hung one -- which is what makes
 * callers reach for a guessed wall-clock estimate.
 */

interface Failure {
  readonly error: unknown;
}

/**
 * Apply `worker` to every item with at most `concurrency` calls in flight.
 *
 * @param onSettled called once per item as it settles, with the number settled so far
 *   and the total. Fires in completion order, not input order.
 * @throws RangeError if `concurrency` is not a positive integer.
 * @throws the first error thrown by any worker, after all runners have settled.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  onSettled?: (settled: number, total: number) => void,
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError(`concurrency must be a positive integer, got ${concurrency}`);
  }

  const results = new Array<R>(items.length);
  let failure: Failure | undefined;
  let settled = 0;

  // One iterator shared by every runner. `next()` is atomic on a single thread,
  // so this hands out each index exactly once with no cursor bookkeeping.
  const queue = items.entries();

  const runner = async (): Promise<void> => {
    for (const [index, item] of queue) {
      // Caught here rather than around the loop: letting the body throw would
      // close the shared iterator and starve the other runners.
      try {
        results[index] = await worker(item, index);
      } catch (error) {
        failure ??= { error };
      } finally {
        settled += 1;
        onSettled?.(settled, items.length);
      }
    }
  };

  const runnerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: runnerCount }, () => runner()));

  if (failure !== undefined) throw failure.error;
  return results;
}
