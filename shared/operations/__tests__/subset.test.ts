/**
 * The subset vocabulary both measurement tools share.
 *
 * Everything here is pure, which is the reason it exists as its own module: the rules it
 * encodes decide WHICH ROWS RUN and what the resulting file says about itself, and every
 * one of them would otherwise be reachable only by spending an hour of API time.
 *
 * Two properties get the most attention below, because they are the two that make a subset
 * safe rather than merely convenient. First, a selector that matches nothing is an error
 * with a listing attached, never an empty sweep -- 0/0 renders as a finished measurement.
 * Second, the narrowed rows and the stamp saying they are narrow come back as ONE value,
 * so no caller can hold the first without the second.
 */

import { describe, expect, test } from "bun:test";

import {
  GROUP_PREFIX,
  parseGroupSidecar,
  parseSelectors,
  resolveIndexSelectors,
  selectRowsById,
  selectRowsByIndex,
  subsetCap,
  SubsetError,
  subsetNote,
  subsetProgressDetail,
  subsetSummaryLine,
} from "../subset.ts";

/** Six rows, addressed by index, matching `fixtures/trigger-groups.sidecar.json`. */
const ROWS = ["q0", "q1", "q2", "q3", "q4", "q5"] as const;

/** The fixture sidecar, parsed against a six-row set. */
async function fixtureGroups(rowCount = ROWS.length) {
  const path = `${import.meta.dir}/fixtures/trigger-groups.sidecar.json`;
  return parseGroupSidecar(await Bun.file(path).json(), path, rowCount);
}

describe("parseSelectors", () => {
  test("splits on commas and tolerates the whitespace a copy-paste brings with it", () => {
    expect(parseSelectors("3, 7 ,group:gap-cost")).toEqual(["3", "7", "group:gap-cost"]);
  });

  test("a single selector needs no comma", () => {
    expect(parseSelectors("group:gap-cost")).toEqual(["group:gap-cost"]);
  });

  test("a list of nothing but separators is refused, not read as the whole set", () => {
    // The one outcome the operator cannot have meant: they asked to narrow the run and
    // silently got everything.
    expect(() => parseSelectors(",,")).toThrow(SubsetError);
    expect(() => parseSelectors("  ")).toThrow(/no selectors/);
  });
});

describe("parseGroupSidecar", () => {
  test("reads the index-to-group mapping and ignores the prose around it", async () => {
    // Real annotation files carry a `note` and a prose `groups` block beside `items`. A
    // parser that objected to them would reject every sidecar anyone actually writes.
    const groups = await fixtureGroups();
    expect([...groups.byGroup.keys()].sort()).toEqual(["bounding-negative", "gap-cost"]);
    expect(groups.byGroup.get("gap-cost")).toEqual([0, 2]);
    expect(groups.byGroup.get("bounding-negative")).toEqual([3, 5]);
  });

  test("a sidecar may describe fewer rows than the set", async () => {
    // Rows 1 and 4 carry no annotation. A group is the rows that appear under its name,
    // not a partition of everything -- otherwise a set that grew a row would stop working.
    const groups = await fixtureGroups();
    const annotated = [...groups.byGroup.values()].flat();
    expect(annotated).not.toContain(1);
    expect(annotated).not.toContain(4);
  });

  test("indices come back ascending whatever order the file listed them in", () => {
    const groups = parseGroupSidecar(
      { items: [{ index: 5, group: "g" }, { index: 1, group: "g" }] },
      "s.json",
      6,
    );
    expect(groups.byGroup.get("g")).toEqual([1, 5]);
  });

  test("a row may sit in two groups, because the file can say so twice", () => {
    const groups = parseGroupSidecar(
      { items: [{ index: 1, group: "a" }, { index: 1, group: "b" }] },
      "s.json",
      6,
    );
    expect(groups.byGroup.get("a")).toEqual([1]);
    expect(groups.byGroup.get("b")).toEqual([1]);
  });

  test("the same row listed twice under one group counts once", () => {
    const groups = parseGroupSidecar(
      { items: [{ index: 1, group: "a" }, { index: 1, group: "a" }] },
      "s.json",
      6,
    );
    // A duplicate that survived into the group would make the row run twice and report a
    // denominator one larger than the rows that exist.
    expect(groups.byGroup.get("a")).toEqual([1]);
  });

  test("an index past the end of the set is refused, naming the mismatch", () => {
    // The join is positional, so a sidecar written against a different revision does not
    // fail -- it selects the WRONG rows under names that sound right, and nothing
    // downstream could ever detect it.
    expect(() => parseGroupSidecar({ items: [{ index: 9, group: "g" }] }, "s.json", 6)).toThrow(
      /names index 9.*6 row\(s\).*0-5/s,
    );
  });

  test("a bare array is refused with the mistake it most likely is", () => {
    // The bare-array file sitting next to a sidecar is the eval set itself, so pointing
    // --groups at it is the error worth naming rather than answering with "expected an object".
    expect(() => parseGroupSidecar([{ query: "q", should_trigger: true }], "set.json", 6)).toThrow(
      /not a bare array.*eval set/s,
    );
  });

  test("a file with no items array says what the shape is", () => {
    expect(() => parseGroupSidecar({ note: "hello" }, "s.json", 6)).toThrow(/no `items` array/);
  });

  test("an item with no whole-number index names its position in the file", () => {
    expect(() => parseGroupSidecar({ items: [{ group: "g" }] }, "s.json", 6)).toThrow(
      /items\[0\].*whole-number/s,
    );
    expect(() => parseGroupSidecar({ items: [{ index: 1.5, group: "g" }] }, "s.json", 6)).toThrow(
      /items\[0\]/,
    );
    expect(() => parseGroupSidecar({ items: [{ index: -1, group: "g" }] }, "s.json", 6)).toThrow(
      /items\[0\]/,
    );
  });

  test("an item with no group names its position too", () => {
    expect(() => parseGroupSidecar({ items: [{ index: 0, group: "  " }] }, "s.json", 6)).toThrow(
      /items\[0\].*non-empty `group`/s,
    );
  });
});

describe("resolveIndexSelectors", () => {
  test("plain indices resolve to themselves", () => {
    expect(resolveIndexSelectors({ rowCount: 6, selectors: ["3", "1"], groups: null })).toEqual([
      1, 3,
    ]);
  });

  test("a group resolves to every row carrying its name", async () => {
    const groups = await fixtureGroups();
    expect(
      resolveIndexSelectors({ rowCount: 6, selectors: ["group:gap-cost"], groups }),
    ).toEqual([0, 2]);
  });

  test("indices and groups mix in one list, ascending and deduplicated", async () => {
    const groups = await fixtureGroups();
    // Row 0 is named twice -- once outright and once through its group. Counting it twice
    // would report a denominator larger than the rows that ran.
    expect(
      resolveIndexSelectors({ rowCount: 6, selectors: ["5", "group:gap-cost", "0"], groups }),
    ).toEqual([0, 2, 5]);
  });

  test("an unknown index is refused with the range that exists", () => {
    expect(() => resolveIndexSelectors({ rowCount: 6, selectors: ["9"], groups: null })).toThrow(
      /no such row.*6 row\(s\).*0-5/s,
    );
  });

  test("an unknown group is refused with every group that exists and its size", async () => {
    const groups = await fixtureGroups();
    // "no such group" alone tells an operator they were wrong. The names beside it tell
    // them what to type instead, which is the entire value of the error.
    let message = "";
    try {
      resolveIndexSelectors({ rowCount: 6, selectors: ["group:gap-costs"], groups });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("no such group");
    expect(message).toContain("gap-cost (2 row(s))");
    expect(message).toContain("bounding-negative (2 row(s))");
  });

  test("a group selector with no sidecar names the flag that would resolve it", () => {
    expect(() =>
      resolveIndexSelectors({ rowCount: 6, selectors: ["group:gap-cost"], groups: null }),
    ).toThrow(/--groups <sidecar.json>/);
  });

  test("a selector that is neither an index nor a group says what a selector is", () => {
    expect(() => resolveIndexSelectors({ rowCount: 6, selectors: ["gap-cost"], groups: null })).toThrow(
      /not a selector.*row index \(0-5\).*group:<name>/s,
    );
  });

  test("every unresolvable selector is reported at once, not one per round trip", () => {
    let message = "";
    try {
      resolveIndexSelectors({ rowCount: 6, selectors: ["9", "nope", "group:x"], groups: null });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("3 selector(s)");
    expect(message).toContain("9:");
    expect(message).toContain("nope:");
    expect(message).toContain("group:x:");
  });

  test("the group prefix is the one the errors advertise", () => {
    expect(GROUP_PREFIX).toBe("group:");
  });
});

describe("selectRowsByIndex", () => {
  test("returns exactly the named rows, and the stamp that says the set is narrow", async () => {
    const groups = await fixtureGroups();
    const { rows, stamp } = selectRowsByIndex({
      rows: [...ROWS],
      selectors: ["group:gap-cost"],
      groups,
    });

    expect(rows).toEqual(["q0", "q2"]);
    expect(stamp.selected).toBe(2);
    expect(stamp.excluded).toBe(4);
    expect(stamp.of).toBe(6);
    expect(stamp.indices).toEqual([0, 2]);
    expect(stamp.selectors).toEqual(["group:gap-cost"]);
    expect(stamp.groups_file).toContain("trigger-groups.sidecar.json");
  });

  test("the marker is `true`, never `false` -- absence is how a full run says so", () => {
    const { stamp } = selectRowsByIndex({ rows: [...ROWS], selectors: ["1"], groups: null });
    // A consumer grepping a directory of results for `not_of_record` finds every
    // compromised run without having to know that `false` means fine.
    expect(stamp.not_of_record).toBe(true);
    expect(stamp.groups_file).toBeNull();
  });

  test("the note carries the run's own figures, so a reader can check them", () => {
    const { stamp } = selectRowsByIndex({ rows: [...ROWS], selectors: ["1", "2"], groups: null });
    // A caveat stating the wrong numbers is worse than none: a reader who checks one
    // against the table and finds it wrong stops reading the rest of the warning.
    expect(stamp.note).toContain("2 of 6");
    expect(stamp.note).toContain("4 were excluded");
    expect(stamp.note).toContain("NOT A MEASUREMENT OF RECORD");
  });
});

describe("selectRowsById", () => {
  const SCENARIOS = [{ id: "alpha" }, { id: "beta" }, { id: "gamma" }] as const;

  test("returns exactly the named rows, in SET order rather than selector order", () => {
    // A subset's table should read as a sub-table of the full one. Selector order would
    // make the same two scenarios render differently depending on how they were typed.
    const { rows, stamp } = selectRowsById({
      rows: [...SCENARIOS],
      selectors: ["gamma", "alpha"],
      unit: "scenario",
    });
    expect(rows.map((row) => row.id)).toEqual(["alpha", "gamma"]);
    expect(stamp.ids).toEqual(["alpha", "gamma"]);
    expect(stamp.selected).toBe(2);
    expect(stamp.excluded).toBe(1);
    expect(stamp.of).toBe(3);
    expect(stamp.not_of_record).toBe(true);
  });

  test("a repeated id runs once", () => {
    const { rows } = selectRowsById({
      rows: [...SCENARIOS],
      selectors: ["alpha", "alpha"],
      unit: "scenario",
    });
    expect(rows.map((row) => row.id)).toEqual(["alpha"]);
  });

  test("an unknown id is refused with the ids that exist", () => {
    let message = "";
    try {
      selectRowsById({ rows: [...SCENARIOS], selectors: ["delta"], unit: "scenario" });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("no such scenario id");
    expect(message).toContain("alpha, beta, gamma");
  });
});

describe("the note and the cap", () => {
  test("a selection that happens to name everything still says it was hand-made", () => {
    // The denominators match a full run, which is exactly when a reader is most likely to
    // treat the figures as of record. The selection was still hand-made and may not stay
    // complete as the set grows.
    const note = subsetNote({ selected: 6, excluded: 0, of: 6, unit: "query" });
    expect(note).toContain("NOT A MEASUREMENT OF RECORD");
    expect(note).toContain("hand-made");
    expect(note).not.toContain("0 were excluded");
  });

  test("the note forbids the comparison rather than merely describing the run", () => {
    const note = subsetNote({ selected: 2, excluded: 4, of: 6, unit: "scenario" });
    expect(note).toContain("Never quote these figures against a full-set baseline");
    expect(note).toContain("scenario(s)");
  });

  test("the one-line form carries both denominators and forbids the comparison", () => {
    // What lands beside the pass rate, where it has about a quarter of a second to work.
    // `11 of 54` is the whole argument: a reader who takes nothing else has still taken
    // the part that stops them quoting the figure.
    const { stamp } = selectRowsByIndex({ rows: [...ROWS], selectors: ["1", "2"], groups: null });
    const line = subsetSummaryLine(stamp);
    expect(line).toBe(
      "subset: 1, 2 — 2 of 6 rows; rates are not comparable to full-set baselines",
    );
    // One line, so it cannot push the figures it qualifies off a terminal.
    expect(line).not.toContain("\n");
  });

  test("both tools produce the same one-line shape, so a reader learns it once", () => {
    const byIndex = selectRowsByIndex({ rows: [...ROWS], selectors: ["0"], groups: null }).stamp;
    const byId = selectRowsById({
      rows: [{ id: "alpha" }, { id: "beta" }],
      selectors: ["alpha"],
      unit: "scenario",
    }).stamp;
    for (const line of [subsetSummaryLine(byIndex), subsetSummaryLine(byId)]) {
      expect(line.startsWith("subset: ")).toBe(true);
      expect(line).toContain("rates are not comparable to full-set baselines");
    }
  });

  test("the progress detail carries the counts and selectors, and nothing else", () => {
    // Smaller than the stamp on purpose: a status file is rewritten every heartbeat and
    // polled by a browser, so it carries what a LISTING needs rather than the paragraph.
    const { stamp } = selectRowsByIndex({ rows: [...ROWS], selectors: ["1"], groups: null });
    expect(subsetProgressDetail(stamp)).toEqual({ selected: 1, of: 6, selectors: ["1"] });
  });

  test("the envelope cap names the selectors and the rows left unmeasured", () => {
    const { stamp } = selectRowsByIndex({ rows: [...ROWS], selectors: ["1"], groups: null });
    const cap = subsetCap(stamp);
    expect(cap).toContain("1 of 6 row(s)");
    expect(cap).toContain("leaving 5 unmeasured");
    expect(cap).toContain("NOT a measurement of record");
  });
});
