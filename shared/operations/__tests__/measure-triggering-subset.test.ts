/**
 * `--only` and `--groups` on the triggering sweep: the wiring, not the vocabulary.
 *
 * The resolution rules themselves are covered against the shared module in
 * `subset.test.ts`. What is checked here is what this tool does with them -- that a
 * sidecar path reaches the parser, that a subset request and the stamp saying it was one
 * arrive together, and above all that a run WITHOUT `--only` is untouched.
 *
 * That last one is the reason the file is weighted the way it is. Every measurement this
 * repository has ever recorded came off the unnarrowed path, so the feature's real risk is
 * not that a subset measures the wrong rows -- it is that adding the ability to narrow
 * quietly changed what a full sweep produces. `withEvalSubset` returning the SAME OBJECT
 * on the null branch is what makes "nothing changed" assertable by identity rather than by
 * a field-by-field comparison that could miss a key nobody thought to check.
 *
 * Nothing here spawns `claude`.
 */

import { describe, expect, test } from "bun:test";

import { parseArgs } from "../../cli.ts";
import {
  announceSubset,
  applyEvalOnly,
  SHARED_EVAL_FLAGS,
  SUBSET_FLAGS,
  withEvalSubset,
  type EvalItem,
  type EvalOutput,
} from "../measure-triggering.ts";
import { SubsetError, subsetSummaryLine } from "../subset.ts";

/** Six rows, matching `fixtures/trigger-groups.sidecar.json`. */
const EVAL_SET: readonly EvalItem[] = [
  { query: "q0 — what does each option cost", should_trigger: true },
  { query: "q1 — unannotated", should_trigger: true },
  { query: "q2 — cost again", should_trigger: true },
  { query: "q3 — should not trigger", should_trigger: false },
  { query: "q4 — unannotated", should_trigger: false },
  { query: "q5 — should not trigger either", should_trigger: false },
];

const SIDECAR = `${import.meta.dir}/fixtures/trigger-groups.sidecar.json`;

/** An `EvalOutput` with nothing interesting in it, for the shape assertions. */
function output(): EvalOutput {
  return {
    skill_name: "demo",
    description: "A description.",
    results: [],
    summary: { total: 0, passed: 0, failed: 0 },
  };
}

async function only(
  selectors: string | undefined,
  groupsPath?: string,
): Promise<Awaited<ReturnType<typeof applyEvalOnly>>> {
  return await applyEvalOnly({ evalSet: EVAL_SET, only: selectors, groupsPath });
}

describe("no --only leaves the sweep exactly as it was", () => {
  test("the eval set comes back as the very same array, and there is no stamp", async () => {
    const result = await only(undefined);
    // Identity, not equality. A copy would pass a deep comparison while proving nothing
    // about whether the rows were touched on the way through.
    expect(result.evalSet).toBe(EVAL_SET);
    expect(result.subset).toBeNull();
  });

  test("the output object is handed back untouched, with no subset key at all", () => {
    const before = output();
    const after = withEvalSubset(before, null);
    expect(after).toBe(before);
    // ABSENT, not false. A consumer written before subsets existed reads a full run
    // byte-for-byte as it always did.
    expect(after).not.toHaveProperty("subset");
    expect(Object.keys(after)).toEqual(["skill_name", "description", "results", "summary"]);
  });
});

describe("--only names the rows that run", () => {
  test("plain indices select exactly those rows, in set order", async () => {
    const { evalSet, subset } = await only("3,0");
    expect(evalSet.map((item) => item.query)).toEqual([EVAL_SET[0]!.query, EVAL_SET[3]!.query]);
    expect(subset?.indices).toEqual([0, 3]);
    expect(subset?.selected).toBe(2);
    expect(subset?.excluded).toBe(4);
    expect(subset?.of).toBe(6);
  });

  test("a group resolves through the sidecar to the rows carrying its name", async () => {
    const { evalSet, subset } = await only("group:gap-cost", SIDECAR);
    expect(evalSet.map((item) => item.query)).toEqual([EVAL_SET[0]!.query, EVAL_SET[2]!.query]);
    expect(subset?.indices).toEqual([0, 2]);
    expect(subset?.groups_file).toBe(SIDECAR);
  });

  test("indices and groups compose in one flag", async () => {
    const { subset } = await only("5,group:gap-cost", SIDECAR);
    expect(subset?.indices).toEqual([0, 2, 5]);
  });

  test("the stamp reaches the output, and says the run is not of record", async () => {
    const { subset } = await only("group:bounding-negative", SIDECAR);
    const stamped = withEvalSubset(output(), subset);
    expect(stamped.subset?.not_of_record).toBe(true);
    expect(stamped.subset?.indices).toEqual([3, 5]);
    expect(stamped.subset?.note).toContain("NOT A MEASUREMENT OF RECORD");
    expect(stamped.subset?.selectors).toEqual(["group:bounding-negative"]);
  });
});

describe("a selector that names nothing is refused, never swept", () => {
  test("an unknown group lists the groups that exist", async () => {
    // A silent empty run reports 0/0, which renders as a finished measurement.
    await expect(only("group:gap-costs", SIDECAR)).rejects.toThrow(SubsetError);
    // Alphabetical, so the same listing reads the same way whatever order the sidecar
    // happened to declare its groups in.
    await expect(only("group:gap-costs", SIDECAR)).rejects.toThrow(
      /no such group.*bounding-negative \(2 row\(s\)\), gap-cost \(2 row\(s\)\)/s,
    );
  });

  test("an unknown index lists the range that exists", async () => {
    await expect(only("42")).rejects.toThrow(/no such row.*6 row\(s\).*0-5/s);
  });

  test("a group selector without a sidecar names the flag that resolves it", async () => {
    await expect(only("group:gap-cost")).rejects.toThrow(/--groups <sidecar.json>/);
  });

  test("a sidecar that cannot be read names --groups rather than surfacing a bare error", async () => {
    await expect(only("group:gap-cost", `${SIDECAR}.missing`)).rejects.toThrow(
      /--groups .*missing: could not be read as JSON/,
    );
  });

  test("a sidecar written against a longer set is refused rather than joined blindly", async () => {
    // The real hazard of a positional join: a stale sidecar selects the WRONG rows under
    // the right names, and nothing downstream could detect it.
    const stale = `${import.meta.dir}/fixtures/trigger-groups.sidecar.json`;
    await expect(
      applyEvalOnly({
        evalSet: EVAL_SET.slice(0, 3),
        only: "group:bounding-negative",
        groupsPath: stale,
      }),
    ).rejects.toThrow(/names index 3.*3 row\(s\)/s);
  });
});

describe("--groups on its own", () => {
  test("is refused, because a flag that silently does nothing reads as being ignored", async () => {
    await expect(only(undefined, SIDECAR)).rejects.toThrow(
      /--groups was given without --only/,
    );
  });
});

describe("the flags themselves", () => {
  test("both parse as strings off the spec", () => {
    const { flags } = parseArgs(["--only", "3,group:x", "--groups", "s.json"], SUBSET_FLAGS);
    expect(flags["only"]).toBe("3,group:x");
    expect(flags["groups"]).toBe("s.json");
  });

  test("neither leaks into the shared spec, so the optimizer cannot advertise them", () => {
    // `optimize-description.ts` spreads SHARED_EVAL_FLAGS too. A subset there would change
    // what every iteration of its loop is selected on, so `--only` must not parse cleanly
    // and do nothing -- the exact failure `parseArgs` rejects unknown flags to avoid.
    expect(SHARED_EVAL_FLAGS).not.toHaveProperty("only");
    expect(SHARED_EVAL_FLAGS).not.toHaveProperty("groups");
    expect(SUBSET_FLAGS["only"]?.help).toContain("not a measurement of record");
  });

  test("the announcement leads with the one-line caveat, then the rows, then the note", async () => {
    const { subset } = await only("group:gap-cost", SIDECAR);
    const said = announceSubset(subset!);
    const lines = said.split("\n");
    // The compact line FIRST. An operator who reads one line of a pre-sweep banner should
    // get the denominators, not the opening clause of a paragraph.
    expect(lines[0]).toBe(subsetSummaryLine(subset!));
    expect(lines[0]).toContain("2 of 6 rows");
    expect(lines[1]).toBe("Rows: 0, 2.");
    expect(said).toContain("NOT A MEASUREMENT OF RECORD");
  });
});
