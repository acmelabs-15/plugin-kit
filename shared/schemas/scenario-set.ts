/**
 * The disclosure scenario set as a schema: `evals.json`, or a bare array of its rows.
 *
 * The sharpest silent path in the repository ran through here. The hand-written reader
 * in `../operations/disclosure.ts` defaults `expectations` to `[]`, so a scenario set
 * with every `expectations` key misspelled parsed clean and then measured the skill
 * against nothing. `../operations/optimize-disclosure.ts` warns loudly about a set that
 * carries no expectations, precisely because that leaves the loop free to strip a skill
 * to nothing and call it an improvement -- so the silent path defeated the guardrail
 * that exists to catch exactly this.
 *
 * An empty `expectations` is NOT an error. It is legal, it is the documented state of a
 * file before the first runs are in flight, and it is already warned about downstream.
 * The defect is the silent journey from a typo to that default, so the finding is raised
 * where a typo is what produced it.
 *
 * Extra keys are warnings rather than errors because `../references/schemas.md`
 * documents `expected_output` and `files` as part of this format, and every scenario set
 * in this repository carries them. Rejecting unknown keys would break all seven.
 *
 * Validation only; the parsed value is discarded. See `./eval-set.ts` for why.
 */

import { z } from "zod@4.1.0";

import { misspellingHint, unknownKeyMessage, unknownKeysOf } from "./near-miss.ts";
import { addError, addWarning, partitionIssues, type IssueSink } from "./severity.ts";

/**
 * Every key a scenario row may carry.
 *
 * Wider than the three fields that are read. `expected_output` and `files` are the
 * documented `evals.json` fields this reader ignores; `eval_id` and `eval_name` are the
 * `eval_metadata.json` spellings it falls back to; `assertions` is the older spelling of
 * `expectations` in result trees. All five are legitimate, so none of them warns.
 */
export const SCENARIO_KEYS: ReadonlySet<string> = new Set([
  "id",
  "eval_id",
  "eval_name",
  "prompt",
  "expectations",
  "assertions",
  "expected_output",
  "files",
]);

/** Every key the object form may carry at the top level. */
export const SCENARIO_SET_KEYS: ReadonlySet<string> = new Set(["skill_name", "evals"]);

/** The keys a row may use to carry expectations, in the order the reader consults them. */
const EXPECTATION_KEYS = ["expectations", "assertions"] as const;

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** The rows, under either accepted top-level shape. Mirrors the reader exactly. */
function rowsOf(raw: unknown): readonly unknown[] {
  if (Array.isArray(raw)) return raw;
  const evals = asRecord(raw)["evals"];
  return Array.isArray(evals) ? evals : [];
}

/**
 * The finding that closes the reported defect.
 *
 * Raised only when a row both lacks every recognized expectations key AND carries an
 * unrecognized one that is a near miss for it. A row that simply has no expectations
 * yet stays silent: that state is legal, one existing scenario set relies on it
 * parsing clean, and the downstream loop already says so once for the whole set.
 */
function checkExpectations(
  row: Readonly<Record<string, unknown>>,
  unknown: readonly string[],
  index: number,
  source: string,
  ctx: IssueSink,
): void {
  if (EXPECTATION_KEYS.some((key) => key in row)) return;
  const hint = misspellingHint(unknown, "expectations");
  if (hint === "") return;
  addWarning(
    ctx,
    `${source}: scenario ${index} carries no \`expectations\`${hint}, so it defaulted to ` +
      `empty and this scenario is measured against nothing.`,
    [index, "expectations"],
  );
}

/**
 * `id` is stringified unconditionally by the reader, so a value with no useful string
 * form becomes a usable-looking id. Two rows carrying an object both become
 * `[object Object]` and then collide, which is the same defect twice over.
 */
function checkId(
  row: Readonly<Record<string, unknown>>,
  index: number,
  source: string,
  ctx: IssueSink,
): void {
  const id = row["id"] ?? row["eval_id"] ?? row["eval_name"];
  if (id === undefined || typeof id === "string" || typeof id === "number") return;
  addWarning(
    ctx,
    `${source}: scenario ${index} has a non-scalar id, which becomes the string ` +
      `"${String(id)}". Use a unique integer or string.`,
    [index, "id"],
  );
}

function checkScenarioRow(entry: unknown, index: number, source: string, ctx: IssueSink): void {
  const row = asRecord(entry);
  const unknown = unknownKeysOf(row, SCENARIO_KEYS);
  for (const key of unknown) {
    addWarning(ctx, `${source}: ${unknownKeyMessage(key, `scenario ${index}`, SCENARIO_KEYS)}`, [
      index,
      key,
    ]);
  }

  const prompt = row["prompt"];
  if (typeof prompt !== "string" || prompt.trim() === "") {
    addError(
      ctx,
      `${source}: scenario ${index} has no non-empty string "prompt"` +
        misspellingHint(unknown, "prompt"),
      [index, "prompt"],
    );
  }
  checkExpectations(row, unknown, index, source, ctx);
  checkId(row, index, source, ctx);
}

/**
 * Duplicate ids are a warning because they are silently destructive rather than
 * malformed: `optimize-disclosure.ts` puts train ids in a `Set` to decide holdout
 * membership, so a repeated id collapses the split the whole held-out design exists to
 * provide. `../references/schemas.md` documents the field as a unique integer.
 */
function checkUniqueIds(rows: readonly unknown[], source: string, ctx: IssueSink): void {
  const seen = new Set<string>();
  for (const [index, entry] of rows.entries()) {
    const row = asRecord(entry);
    const raw = row["id"] ?? row["eval_id"] ?? row["eval_name"];
    if (raw === undefined) continue;
    const id = String(raw);
    if (seen.has(id)) {
      addWarning(
        ctx,
        `${source}: scenario ${index} repeats the id "${id}", which collapses the ` +
          `train/held-out split. Ids must be unique.`,
        [index, "id"],
      );
    }
    seen.add(id);
  }
}

/** The whole set, top level included. Every row is checked even after one fails. */
export function checkScenarioSet(raw: unknown, source: string, ctx: IssueSink): void {
  if (!Array.isArray(raw)) {
    for (const key of unknownKeysOf(asRecord(raw), SCENARIO_SET_KEYS)) {
      addWarning(ctx, `${source}: ${unknownKeyMessage(key, "the scenario set", SCENARIO_SET_KEYS)}`, [
        key,
      ]);
    }
  }

  const rows = rowsOf(raw);
  if (rows.length === 0) {
    // An empty array is not told about `"evals"`. Both inputs used to get the one message,
    // so someone who passed `[]` was pointed at a key their file never had and had no way
    // to tell whether the shape or the contents was the problem.
    addError(
      ctx,
      Array.isArray(raw)
        ? `${source}: expected a non-empty JSON array of scenarios, and this array is empty`
        : `${source}: expected a JSON array of scenarios, or an object with a non-empty "evals" array`,
    );
    return;
  }

  for (const [index, entry] of rows.entries()) checkScenarioRow(entry, index, source, ctx);
  checkUniqueIds(rows, source, ctx);
}

/** The already-read file plus the path to name in its findings. */
export const ScenarioSetShape = z
  .object({
    source: z.string(),
    raw: z.unknown(),
  })
  .superRefine((value, ctx) => {
    checkScenarioSet(value.raw, value.source, ctx);
  });

/**
 * Findings for one scenario set, split by severity. A warning-only parse still reports
 * `success: false`, so callers read the split rather than the boolean.
 */
export function scenarioSetFindings(
  raw: unknown,
  source: string,
): { readonly errors: readonly string[]; readonly warnings: readonly string[] } {
  const result = ScenarioSetShape.safeParse({ raw, source });
  return result.success ? { errors: [], warnings: [] } : partitionIssues(result.error.issues);
}
