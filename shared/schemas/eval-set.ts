/**
 * The trigger eval set as a schema: a bare array of `{query, should_trigger}`.
 *
 * The failure this exists to close is SILENT ACCEPTANCE. The hand-written reader in
 * `../operations/measure-triggering.ts` looked up two keys and ignored the rest, so
 * `shouldTrigger` written alongside a correct `should_trigger` passed clean, and a
 * typo written INSTEAD of it threw a message naming only the row index -- which tells
 * an author that something is missing and not that they are looking straight at it.
 *
 * Two layers, as `./skill.ts` does it: the schema is handed already-read values and
 * decides everything from those, and every finding goes through the `./severity.ts`
 * carrier so an unknown key can be a WARNING while a missing one stays an error. An
 * unknown key must not be fatal here: `../references/schemas.md` documents extra keys
 * on the sibling scenario-set format, and a reader that rejected an annotated file
 * would be a worse defect than the one being fixed.
 *
 * Validation only. The parsed value is deliberately not the output -- see
 * `../envelope.ts`'s `assertEnvelope` for the same choice and the same reason. Adding
 * a schema must not change what a legitimate file parses to, and the surest way to
 * guarantee that is for the schema to produce nothing.
 */

import { z } from "zod@4.1.0";

import { misspellingHint, unknownKeyMessage, unknownKeysOf } from "./near-miss.ts";
import { addError, addWarning, partitionIssues, type IssueSink } from "./severity.ts";

/** Every key a row may carry. Nothing else is read, so nothing else may pass silently. */
export const EVAL_ITEM_KEYS: ReadonlySet<string> = new Set(["query", "should_trigger"]);

/** Matches the reader being validated: a non-object row has no keys rather than throwing. */
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function checkEvalRow(entry: unknown, index: number, source: string, ctx: IssueSink): void {
  const row = asRecord(entry);
  const unknown = unknownKeysOf(row, EVAL_ITEM_KEYS);
  for (const key of unknown) {
    addWarning(ctx, `${source}: ${unknownKeyMessage(key, `item ${index}`, EVAL_ITEM_KEYS)}`, [
      index,
      key,
    ]);
  }

  if (typeof row["query"] !== "string") {
    addError(
      ctx,
      `${source}: item ${index} has no string "query"${misspellingHint(unknown, "query")}`,
      [index, "query"],
    );
  }
  if (typeof row["should_trigger"] !== "boolean") {
    addError(
      ctx,
      `${source}: item ${index} has no boolean "should_trigger"` +
        misspellingHint(unknown, "should_trigger"),
      [index, "should_trigger"],
    );
  }
}

/**
 * Every row is checked even after one fails, unlike the reader this replaces.
 *
 * A file with five typos cost five runs to clean up, one message at a time. The whole
 * value of validating at the boundary is spending one run instead of thirty; spending
 * five is most of the defect still in place.
 */
export function checkEvalSet(raw: unknown, source: string, ctx: IssueSink): void {
  if (!Array.isArray(raw)) {
    addError(ctx, `${source}: expected a JSON array of eval items`);
    return;
  }
  for (const [index, entry] of raw.entries()) checkEvalRow(entry, index, source, ctx);
}

/** The already-read file plus the path to name in its findings. */
export const EvalSetShape = z
  .object({
    source: z.string(),
    raw: z.unknown(),
  })
  .superRefine((value, ctx) => {
    checkEvalSet(value.raw, value.source, ctx);
  });

/**
 * Findings for one eval set, split by severity.
 *
 * A warning-only parse still reports `success: false` -- that is Zod's contract, not
 * something to fight -- so callers must read the split rather than the boolean.
 */
export function evalSetFindings(
  raw: unknown,
  source: string,
): { readonly errors: readonly string[]; readonly warnings: readonly string[] } {
  const result = EvalSetShape.safeParse({ raw, source });
  return result.success ? { errors: [], warnings: [] } : partitionIssues(result.error.issues);
}
