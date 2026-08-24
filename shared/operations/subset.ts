/**
 * Naming a slice of an eval set, and marking what a run over that slice is not.
 *
 * Both iterative measurement tools grew the same need at the same time: an operator
 * making a small change to a description or a layout wants to see whether the six rows
 * that change was about moved, without paying for the other forty-eight. Spending a full
 * sweep per edit is what makes an edit expensive, and an expensive edit is one nobody
 * makes twice.
 *
 * The hazard is not the filtering. It is the number that comes out of it. A rate over six
 * rows and a rate over fifty-four are two different estimates of two different things, and
 * they look identical on the page: both are a percentage with one decimal place. Quote one
 * against the other and you have reported a change in DENOMINATOR as a change in RESULT.
 * That failure is silent, it is plausible, and it survives being written down -- which is
 * why the stamp below is not optional, not a flag, and not phrased gently.
 *
 * So this module owns two things and deliberately not a third:
 *
 * - RESOLUTION. Turning what the operator typed into the exact rows that will run, or into
 *   a hard error naming what exists. Never an empty run: a selector that matches nothing
 *   is a typo, and a sweep of zero rows reports 0/0 and looks like a finished measurement.
 * - THE STAMP. One shape, written into both tools' results files and printed in both tools'
 *   output, saying what ran, what did not, and that the figures are not of record.
 *
 * It does NOT own the filtering decision itself. Neither tool filters unless asked, and the
 * resolver hands back the rows and the stamp AS ONE VALUE, so a caller cannot come away
 * holding a narrowed set without also holding the sentence that says it is narrow. That
 * pairing is the whole mechanism -- the same reasoning `--tier-study` uses in
 * `measure-disclosure.ts`, where the substituted model and the marker that says a
 * substitution happened are set by one field rather than by two.
 *
 * Pure. Nothing here reads a file, spawns anything, or prints -- so every rule it encodes
 * is reachable from the suite rather than only from an hour of API time.
 */

/**
 * A selector naming a group rather than a row, e.g. `group:gap-cost`.
 *
 * A prefix rather than a separate flag because the two kinds of selector are the same
 * KIND of thing -- a way of saying which rows -- and an operator mixing them in one list
 * (`--only 3,group:gap-cost`) is the normal case rather than an exotic one.
 */
export const GROUP_PREFIX = "group:";

/**
 * A subset request that cannot be honoured.
 *
 * Its own type so a CLI can catch it and exit with the message alone. A stack trace here
 * would bury the listing of what exists, and that listing is the entire value of the
 * error: "no such group" tells an operator they were wrong, and the names beside it tell
 * them what to type instead.
 */
export class SubsetError extends Error {}

/**
 * What a subset run says about itself, in both tools' results files.
 *
 * snake_case because both wire contracts it lands in are snake_case -- `EvalOutput` since
 * the Python era, `MeasureOutput` beside `tier_study`. A camelCase block wedged into
 * either would make a reader guess per key.
 */
export interface SubsetStamp {
  /**
   * Always `true`, never `false`.
   *
   * The block is ABSENT on a full run rather than present with a false flag, exactly as
   * `tier_study` is absent on a measurement of record. Two reasons: a consumer written
   * before subsets existed reads a full run byte-for-byte as it always did, and a reader
   * grepping a directory of results files for `not_of_record` finds every compromised run
   * without having to know that `false` means fine.
   */
  readonly not_of_record: true;
  /** Exactly what the operator typed, in the order they typed it. */
  readonly selectors: readonly string[];
  readonly selected: number;
  readonly excluded: number;
  /** Rows in the file the selection was made from. `selected + excluded`. */
  readonly of: number;
  /**
   * The warning, in words, carried in the file as well as printed.
   *
   * Duplicated on purpose, for the reason `install_conflict` is: a terminal gets closed,
   * and the results file is what somebody builds a table from three weeks later. A caveat
   * that lived only on stderr is a caveat that expires when the scrollback does.
   */
  readonly note: string;
}

/** A subset of an eval set, which is addressed by row index. */
export interface EvalSubsetStamp extends SubsetStamp {
  /** The rows that ran, by their index in the eval-set file, ascending. */
  readonly indices: readonly number[];
  /** The sidecar `group:` selectors were resolved through, or null when none was used. */
  readonly groups_file: string | null;
}

/** A subset of a scenario set, which is addressed by scenario id. */
export interface ScenarioSubsetStamp extends SubsetStamp {
  /** The scenarios that ran, by id, in set order. */
  readonly ids: readonly string[];
}

/**
 * Split what followed `--only` into selectors.
 *
 * Commas rather than repetition (`--only a --only b`) because the flag parser supports
 * both and one of them survives being pasted into a note: `--only group:gap-cost,group:gap-evidence`
 * is a thing an operator can copy out of a report and back into a shell, and a repeated
 * flag is a thing they have to reassemble.
 *
 * Whitespace around a selector is dropped, so a list copied out of prose still works.
 * A list that is nothing but separators is an error rather than a full run: `--only ,,`
 * asked for a subset and got everything, which is the one outcome the operator cannot
 * have meant.
 */
export function parseSelectors(raw: string): readonly string[] {
  const selectors = raw
    .split(",")
    .map((selector) => selector.trim())
    .filter((selector) => selector !== "");
  if (selectors.length === 0) {
    throw new SubsetError(
      "--only was given no selectors. Name at least one row, or leave --only off entirely " +
        "to measure the whole set.",
    );
  }
  return selectors;
}

/**
 * An eval set's rows grouped by name, as read from an annotation sidecar.
 *
 * A sidecar rather than columns in the eval set itself, because the eval-set schema warns
 * once per unrecognized key per row: fifty-four annotated rows would print fifty-four
 * benign warnings and bury a real one. The join is by index.
 */
export interface GroupIndex {
  /** Where it came from. Named in every error, so a mismatch says which file to look at. */
  readonly source: string;
  /** Group name to the row indices carrying it, ascending. */
  readonly byGroup: ReadonlyMap<string, readonly number[]>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Read a group sidecar, and check it describes the set it is being joined to.
 *
 * `rowCount` is not decoration. The join is positional, so a sidecar written against a
 * different revision of the eval set does not fail -- it selects the WRONG ROWS, silently,
 * and reports them under names that sound right. That is the worst failure available here
 * and nothing downstream could detect it, so an index past the end of the set is a hard
 * error naming both files.
 *
 * A sidecar may describe FEWER rows than the set: annotating some rows and not others is
 * the normal state of a set that is still growing, and a group selection is defined as the
 * rows that appear under that name rather than as a partition of everything.
 *
 * A bare array is rejected with a specific message rather than a generic one, because the
 * bare-array file sitting next to the sidecar is the eval set itself -- so `--groups
 * <the eval set>` is the mistake most likely to be made, and the least likely to be
 * understood from "expected an object".
 */
export function parseGroupSidecar(raw: unknown, source: string, rowCount: number): GroupIndex {
  if (Array.isArray(raw)) {
    throw new SubsetError(
      `${source}: a group sidecar is an object with an \`items\` array, not a bare array. ` +
        `A bare array is the shape of an eval set — check that --groups points at the ` +
        `sidecar rather than at the set itself.`,
    );
  }
  const record = asRecord(raw);
  const items = record?.["items"];
  if (!Array.isArray(items)) {
    throw new SubsetError(
      `${source}: no \`items\` array. A group sidecar maps eval-set rows to group names ` +
        `as {"items": [{"index": 0, "group": "some-name"}, …]}.`,
    );
  }

  const byGroup = new Map<string, number[]>();
  for (const [position, entry] of items.entries()) {
    const item = asRecord(entry);
    const index = item?.["index"];
    const group = item?.["group"];
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0) {
      throw new SubsetError(
        `${source}: items[${position}] has no whole-number \`index\`. Every row of the ` +
          `sidecar joins to the eval set by position, so an index is not optional.`,
      );
    }
    if (typeof group !== "string" || group.trim() === "") {
      throw new SubsetError(`${source}: items[${position}] has no non-empty \`group\`.`);
    }
    if (index >= rowCount) {
      throw new SubsetError(
        `${source}: items[${position}] names index ${index}, but the eval set has ` +
          `${rowCount} row(s) — valid indices are 0-${rowCount - 1}. The join is positional, ` +
          `so a sidecar written against a different revision of the set would select the ` +
          `wrong rows under the right names rather than fail. Point --groups at the sidecar ` +
          `for THIS set.`,
      );
    }
    const bucket = byGroup.get(group);
    if (bucket === undefined) byGroup.set(group, [index]);
    else if (!bucket.includes(index)) bucket.push(index);
  }

  return {
    source,
    byGroup: new Map([...byGroup].map(([name, indices]) => [name, [...indices].sort((a, b) => a - b)])),
  };
}

/** `gap-cost (3 rows), gap-evidence (3 rows), …` — what an unknown group is measured against. */
function describeGroups(groups: GroupIndex): string {
  const names = [...groups.byGroup.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return names.map(([name, indices]) => `${name} (${indices.length} row(s))`).join(", ");
}

/**
 * Turn selectors into the row indices they name, or refuse and say what exists.
 *
 * Every unresolvable selector is collected and reported together rather than the first one
 * alone, matching how the eval-set schema reports a file's problems: an operator fixing a
 * typo'd list one round trip per typo is an operator who stops using the flag.
 *
 * The result is ASCENDING and deduplicated, whatever order the selectors arrived in. Two
 * reasons, and both are about the numbers rather than about tidiness: `--only 3,3` must not
 * run row three twice and report a denominator of two, and a row named by both an index and
 * a group it belongs to must not be counted twice either. Ascending keeps the rows in the
 * order every other part of both tools reports them in, so a subset's table reads as a
 * sub-table of the full one rather than as a reshuffle.
 */
export function resolveIndexSelectors(params: {
  readonly rowCount: number;
  readonly selectors: readonly string[];
  readonly groups: GroupIndex | null;
}): readonly number[] {
  const { rowCount, selectors, groups } = params;
  const chosen = new Set<number>();
  const problems: string[] = [];

  for (const selector of selectors) {
    if (selector.startsWith(GROUP_PREFIX)) {
      const name = selector.slice(GROUP_PREFIX.length);
      if (groups === null) {
        problems.push(
          `${selector}: no group sidecar was given. Pass --groups <sidecar.json>, a file ` +
            `with an \`items\` array of {index, group} rows mapping this eval set to group names.`,
        );
        continue;
      }
      const indices = groups.byGroup.get(name);
      if (indices === undefined) {
        problems.push(
          `${selector}: no such group in ${groups.source}. The groups that exist are: ` +
            `${describeGroups(groups)}.`,
        );
        continue;
      }
      for (const index of indices) chosen.add(index);
      continue;
    }

    if (!/^\d+$/.test(selector)) {
      problems.push(
        `${selector}: not a selector. A selector is a row index (0-${Math.max(0, rowCount - 1)}) ` +
          `or ${GROUP_PREFIX}<name>.`,
      );
      continue;
    }
    const index = Number(selector);
    if (index >= rowCount) {
      problems.push(
        `${selector}: no such row. The set has ${rowCount} row(s), so the valid indices are ` +
          `0-${rowCount - 1}.`,
      );
      continue;
    }
    chosen.add(index);
  }

  if (problems.length > 0) throw new SubsetError(formatProblems(problems));
  // Unreachable while every selector must resolve to at least one row, and kept anyway:
  // a group declared in a sidecar with an empty index list would otherwise sweep nothing
  // and report 0/0, which reads as a finished measurement rather than as a miss.
  if (chosen.size === 0) {
    throw new SubsetError(
      `--only ${selectors.join(",")} matched no rows. A subset run that measures nothing ` +
        `reports 0/0, which reads as a finished measurement rather than as a mistake.`,
    );
  }
  return [...chosen].sort((a, b) => a - b);
}

/** One problem on its own line, several under a heading, so a list is readable in a terminal. */
function formatProblems(problems: readonly string[]): string {
  const first = problems[0];
  if (problems.length === 1 && first !== undefined) return `--only ${first}`;
  return `--only could not resolve ${problems.length} selector(s):\n  - ${problems.join("\n  - ")}`;
}

/**
 * The sentence a subset run carries, built from the numbers it actually ran.
 *
 * Generated rather than fixed, because a caveat that states the wrong figures is worse
 * than none: a reader who checks one number against the table and finds it wrong stops
 * reading the rest of the warning.
 */
export function subsetNote(params: {
  readonly selected: number;
  readonly excluded: number;
  readonly of: number;
  /** What one row is, in words -- "query" or "scenario". */
  readonly unit: string;
}): string {
  const { selected, excluded, of, unit } = params;
  const scope =
    excluded === 0
      ? `every one of the ${of} ${unit}(s) was named explicitly, so the denominators happen ` +
        `to match a full run — but the selection was hand-made and may not stay complete`
      : `${selected} of ${of} ${unit}(s) ran and ${excluded} were excluded, so every rate here ` +
        `is over a different denominator from a full-set run`;
  return (
    `SUBSET RUN — NOT A MEASUREMENT OF RECORD. ${scope}. Never quote these figures against a ` +
    `full-set baseline or against another subset: a difference in which rows ran would be ` +
    `reported as a difference in result. A subset exists to iterate quickly on a slice; ` +
    `re-run without --only before recording anything.`
  );
}

/**
 * Select rows by index, and hand back the stamp that says the set is narrow.
 *
 * Generic over the row type so one implementation serves the eval set today and anything
 * else addressed by position later. The two tools must not grow two spellings of "a subset
 * of what you asked for", because the moment they disagree about what `excluded` counts,
 * two results files stop being readable side by side.
 */
export function selectRowsByIndex<Row>(params: {
  readonly rows: readonly Row[];
  readonly selectors: readonly string[];
  readonly groups: GroupIndex | null;
}): { readonly rows: readonly Row[]; readonly stamp: EvalSubsetStamp } {
  const indices = resolveIndexSelectors({
    rowCount: params.rows.length,
    selectors: params.selectors,
    groups: params.groups,
  });
  // Non-null by construction: every index came from a bounds check against this array.
  const rows = indices.map((index) => params.rows[index] as Row);
  return {
    rows,
    stamp: {
      not_of_record: true,
      selectors: [...params.selectors],
      selected: rows.length,
      excluded: params.rows.length - rows.length,
      of: params.rows.length,
      indices,
      groups_file: params.groups?.source ?? null,
      note: subsetNote({
        selected: rows.length,
        excluded: params.rows.length - rows.length,
        of: params.rows.length,
        unit: "query",
      }),
    },
  };
}

/**
 * Select rows by id, and hand back the stamp that says the set is narrow.
 *
 * Ids rather than indices for scenarios, because a scenario set already carries a stable
 * name for each row and the tool prints it in every table -- so an operator naming one has
 * something to copy, where an index would have to be counted off by hand.
 *
 * Set order is preserved rather than selector order, for the reason the index resolver
 * gives: a subset's table should read as a sub-table of the full one.
 */
export function selectRowsById<Row extends { readonly id: string }>(params: {
  readonly rows: readonly Row[];
  readonly selectors: readonly string[];
  /** What one row is, for the error text -- "scenario". */
  readonly unit: string;
}): { readonly rows: readonly Row[]; readonly stamp: ScenarioSubsetStamp } {
  const known = new Set(params.rows.map((row) => row.id));
  const wanted = new Set<string>();
  const problems: string[] = [];
  for (const selector of params.selectors) {
    if (!known.has(selector)) {
      problems.push(
        `${selector}: no such ${params.unit} id. The set declares ${known.size}: ` +
          `${[...known].join(", ")}.`,
      );
      continue;
    }
    wanted.add(selector);
  }
  if (problems.length > 0) throw new SubsetError(formatProblems(problems));

  const rows = params.rows.filter((row) => wanted.has(row.id));
  return {
    rows,
    stamp: {
      not_of_record: true,
      selectors: [...params.selectors],
      selected: rows.length,
      excluded: params.rows.length - rows.length,
      of: params.rows.length,
      ids: rows.map((row) => row.id),
      note: subsetNote({
        selected: rows.length,
        excluded: params.rows.length - rows.length,
        of: params.rows.length,
        unit: params.unit,
      }),
    },
  };
}

/**
 * The one-line form, for the summary block a reader actually looks at.
 *
 * The long {@link subsetNote} is an EDUCATION and belongs where a run starts, once. This is
 * the CAVEAT, and it belongs immediately beside the pass rate -- so it has to survive being
 * read in a quarter of a second, next to numbers, in a terminal that has been scrolling.
 * Hence one line, hence the denominators in it: `11 of 54` is the whole argument, and a
 * reader who takes nothing else from the line has still taken the part that stops them
 * quoting the figure.
 *
 * Both tools print the same shape. Two spellings of "this run is narrow" would let a reader
 * who learned one fail to recognize the other.
 */
export function subsetSummaryLine(stamp: SubsetStamp): string {
  return (
    `subset: ${stamp.selectors.join(", ")} — ${stamp.selected} of ${stamp.of} rows; ` +
    `rates are not comparable to full-set baselines`
  );
}

/**
 * The subset facts a run's status file carries, for the dashboard and the live page.
 *
 * Deliberately smaller than the stamp. A status file is rewritten on every heartbeat and
 * polled by a browser, so it carries what a LISTING needs to label the run -- the counts
 * and the selectors -- rather than the paragraph, which belongs in the results file that is
 * written once.
 */
export function subsetProgressDetail(stamp: SubsetStamp): {
  readonly selected: number;
  readonly of: number;
  readonly selectors: readonly string[];
} {
  return { selected: stamp.selected, of: stamp.of, selectors: [...stamp.selectors] };
}

/**
 * The coverage cap a subset run declares in its results envelope.
 *
 * `provenance.caps` is the envelope's field for "anything that bounded coverage, one plain
 * sentence each", and a subset is the most literal possible instance of one. It matters
 * more here than the printed warning does: `evalSetHash` is computed over the rows that
 * ran, so two subsets of one file already compare as incomparable -- this is the sentence
 * that tells a reader WHY the comparison was refused.
 */
export function subsetCap(stamp: SubsetStamp): string {
  return (
    `--only ran ${stamp.selected} of ${stamp.of} row(s), leaving ${stamp.excluded} unmeasured: ` +
    `${stamp.selectors.join(", ")}. This run is a subset and NOT a measurement of record.`
  );
}
