/**
 * Tests for the in-progress row in the description-optimization report.
 *
 * The behaviour under test is a SWAP: a bar occupies the position an iteration's
 * results row will take, and the next report replaces it with the real row. So the
 * assertions are mostly about position and disappearance rather than about styling,
 * and they are driven with hand-built loop-output snapshots -- the same shapes
 * `optimize-description.ts` publishes -- rather than by running a loop.
 */

import { describe, expect, test } from "bun:test";

import { generateHtml, type LoopOutput } from "../generate-report.ts";

const QUERIES = [
  { query: "refactor this function", shouldTrigger: true },
  { query: "what is the capital of France", shouldTrigger: false },
];

/** One finished history entry, in the shape optimize-description pushes. */
function historyEntry(iteration: number, description: string): Record<string, unknown> {
  return {
    iteration,
    description,
    train_passed: 1,
    train_failed: 1,
    train_total: 2,
    train_results: [
      { query: QUERIES[0]?.query, should_trigger: true, triggers: 3, runs: 3, pass: true },
      { query: QUERIES[1]?.query, should_trigger: false, triggers: 3, runs: 3, pass: false },
    ],
    test_passed: null,
    test_failed: null,
    test_total: null,
    test_results: null,
  };
}

/**
 * The rendered table body.
 *
 * Every assertion about the bar goes through this rather than the whole document,
 * because the class names it looks for are also declared in the page's stylesheet --
 * a document-wide `toContain("progress-fill")` matches the CSS rule and is therefore
 * true whether or not a bar was rendered. That is a test that cannot fail.
 */
function body(html: string): string {
  return /<tbody>([\s\S]*?)<\/tbody>/.exec(html)?.[1] ?? "";
}

/** True when a progress bar was actually rendered into the table. */
function hasBar(html: string): boolean {
  return body(html).includes("progress-fill");
}

/** Count of rows in the table body: one per iteration, plus any bar. */
function rowCount(html: string): number {
  return (body(html).match(/<tr class="/g) ?? []).length;
}

/** Row classes in document order, so position can be asserted. */
function rowClasses(html: string): string[] {
  return [...body(html).matchAll(/<tr class="([^"]*)">/g)].map((match) => match[1] ?? "");
}

function fillWidth(html: string): string | null {
  return /class="progress-fill" style="width:(\d+)%"/.exec(body(html))?.[1] ?? null;
}

const PLANNED = { train: QUERIES, test: [] as typeof QUERIES };

// ---------------------------------------------------------------------------
// The blind window before iteration 1
// ---------------------------------------------------------------------------

describe("the baseline window", () => {
  test("renders a bar with no history at all", () => {
    // This is the case that previously showed "Starting optimization loop..." for the
    // whole of iteration 1. There is no history to render, so the bar is the only row.
    const output: LoopOutput = {
      history: [],
      in_progress: {
        iteration: 1,
        settled: 0,
        total: 36,
        phase: "baseline evaluation",
        startedAt: 1_000_000,
      },
    };

    const html = generateHtml(output, { plannedQueries: PLANNED, now: 1_000_000 });
    expect(hasBar(html)).toBe(true);
    expect(body(html)).toContain("baseline evaluation");
    expect(rowCount(html)).toBe(1);
  });

  test("shows the planned query columns, so the table does not reflow on the swap", () => {
    // Headers normally come from history[0], which does not exist yet. Without the
    // planned set the bar would render beside no columns and the table would jump
    // once results landed.
    const html = generateHtml(
      { history: [], in_progress: { iteration: 1, settled: 0, total: 36, phase: "baseline" } },
      { plannedQueries: PLANNED },
    );
    expect(html).toContain("refactor this function");
    expect(html).toContain("what is the capital of France");
  });

  test("renders one pending cell per planned query, matching the results row's width", () => {
    const html = generateHtml(
      { history: [], in_progress: { iteration: 1, settled: 0, total: 36, phase: "baseline" } },
      { plannedQueries: PLANNED },
    );
    expect((body(html).match(/class="pending-cell/g) ?? []).length).toBe(QUERIES.length);
  });

  test("a finished history wins over the planned set, so a mid-run change cannot desync headers", () => {
    const html = generateHtml({ history: [historyEntry(1, "first")] }, { plannedQueries: PLANNED });
    // Both happen to name the same queries here; what matters is that the cells and
    // headers are derived from the same source once one exists.
    expect(html).toContain("refactor this function");
    expect(rowCount(html)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The swap
// ---------------------------------------------------------------------------

describe("the swap from bar to results", () => {
  test("the bar carries the iteration number its results row will carry", () => {
    const html = generateHtml(
      { history: [], in_progress: { iteration: 1, settled: 5, total: 36, phase: "evaluating" } },
      { plannedQueries: PLANNED },
    );
    expect(/<tr class="in-progress-row">\s*<td>1<\/td>/.test(body(html))).toBe(true);
  });

  test("publishing the finished iteration removes the bar and leaves one results row", () => {
    // The swap itself: same iteration, now present in history and absent from
    // in_progress. One row in, one row out, at the same position.
    const before = generateHtml(
      { history: [], in_progress: { iteration: 1, settled: 36, total: 36, phase: "evaluating" } },
      { plannedQueries: PLANNED },
    );
    const after = generateHtml({ history: [historyEntry(1, "first")] }, { plannedQueries: PLANNED });

    expect(hasBar(before)).toBe(true);
    expect(hasBar(after)).toBe(false);
    expect(rowCount(before)).toBe(1);
    expect(rowCount(after)).toBe(1);
  });

  test("the bar sits after every finished row, where the next results row will land", () => {
    const html = generateHtml(
      {
        history: [historyEntry(1, "first"), historyEntry(2, "second")],
        in_progress: { iteration: 3, settled: 4, total: 36, phase: "evaluating iteration 3" },
      },
      { plannedQueries: PLANNED },
    );

    const classes = rowClasses(html);
    expect(classes.length).toBe(3);
    expect(classes[2]).toBe("in-progress-row");
    expect(classes.slice(0, 2)).not.toContain("in-progress-row");
  });

  test("the final report has no bar", () => {
    // A finished run whose page still showed a bar would be the same lie in reverse.
    const html = generateHtml({
      history: [historyEntry(1, "first")],
      best_description: "first",
      best_score: "2/2",
    });
    expect(hasBar(html)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// What the bar reports
// ---------------------------------------------------------------------------

describe("the bar's readings", () => {
  test.each([
    [0, 36, "0"],
    [9, 36, "25"],
    [18, 36, "50"],
    [36, 36, "100"],
  ])("fills to the settled fraction (%p of %p)", (settled, total, expected) => {
    const html = generateHtml({
      history: [],
      in_progress: { iteration: 1, settled, total, phase: "evaluating" },
    });
    expect(fillWidth(html)).toBe(expected);
  });

  test("clamps a settled count above the total rather than overflowing the track", () => {
    const html = generateHtml({
      history: [],
      in_progress: { iteration: 1, settled: 40, total: 36, phase: "evaluating" },
    });
    expect(fillWidth(html)).toBe("100");
  });

  test("renders a zero-total phase without dividing by it", () => {
    // The improve step: one `claude -p` call, so there is nothing to count. The bar
    // still names the phase, which is what says the run is alive.
    const html = generateHtml({
      history: [historyEntry(1, "first")],
      in_progress: { iteration: 2, settled: 0, total: 0, phase: "improving description" },
    });
    expect(fillWidth(html)).toBe("0");
    expect(body(html)).toContain("improving description");
    expect(body(html)).not.toContain("NaN");
    expect(body(html)).not.toContain("Infinity");
  });

  test("shows elapsed time from startedAt", () => {
    const html = generateHtml(
      {
        history: [],
        in_progress: { iteration: 1, settled: 5, total: 36, phase: "evaluating", startedAt: 1_000_000 },
      },
      { now: 1_100_000 },
    );
    expect(body(html)).toContain("1m 40s elapsed");
  });

  test("marks the projection approximate, since per-item duration varies widely", () => {
    // Measured 13s to 124s per call, so a bare countdown would imply precision the
    // measurement does not have.
    const html = generateHtml({
      history: [],
      in_progress: {
        iteration: 1,
        settled: 5,
        total: 36,
        phase: "evaluating",
        remainingMs: 310_000,
      },
    });
    expect(body(html)).toContain("~5m 10s left");
  });

  test("omits the projection when there is none rather than showing a zero", () => {
    const html = generateHtml({
      history: [],
      in_progress: { iteration: 1, settled: 0, total: 36, phase: "evaluating" },
    });
    expect(body(html)).not.toContain("left");
  });

  test("shows the description under test, so the row says something before it has a score", () => {
    const html = generateHtml({
      history: [],
      in_progress: {
        iteration: 1,
        settled: 1,
        total: 36,
        phase: "evaluating",
        description: "Use when refactoring code",
      },
    });
    expect(body(html)).toContain("Use when refactoring code");
  });

  test("escapes a phase and description carrying HTML", () => {
    const html = generateHtml({
      history: [],
      in_progress: {
        iteration: 1,
        settled: 1,
        total: 2,
        phase: "<script>alert(1)</script>",
        description: "a & b <tag>",
      },
    });
    expect(body(html)).not.toContain("<script>alert(1)</script>");
    expect(body(html)).toContain("&lt;script&gt;");
    expect(body(html)).toContain("a &amp; b &lt;tag&gt;");
  });
});

// ---------------------------------------------------------------------------
// Tolerating a partial block
// ---------------------------------------------------------------------------

describe("a malformed in_progress block", () => {
  test("is ignored when it carries no iteration number", () => {
    // `optimize-description.ts` resolves this module at runtime, so a shape mismatch has to
    // degrade to no bar rather than to a broken page.
    const html = generateHtml({ history: [], in_progress: { settled: 1 } } as unknown as LoopOutput);
    expect(hasBar(html)).toBe(false);
  });

  test.each([["a string", "nope"], ["null", null], ["an array", [1]]])(
    "is ignored when it is %s",
    (_label, value) => {
      const html = generateHtml({ history: [], in_progress: value } as unknown as LoopOutput);
      expect(hasBar(html)).toBe(false);
    },
  );

  test("falls back to a generic phase when the phase is missing", () => {
    const html = generateHtml({ history: [], in_progress: { iteration: 1 } } as unknown as LoopOutput);
    expect(hasBar(html)).toBe(true);
    expect(body(html)).toContain("working");
  });
});

// ---------------------------------------------------------------------------
// Regressions guarded
// ---------------------------------------------------------------------------

describe("existing report behaviour is unchanged", () => {
  test("a report with no in_progress renders exactly as before", () => {
    const html = generateHtml({ history: [historyEntry(1, "first")] });
    expect(rowClasses(html)).not.toContain("in-progress-row");
    expect(html).toContain("Skill Description Optimization");
    expect(rowCount(html)).toBe(1);
  });

  test("autoRefresh still controls the meta refresh tag", () => {
    const live = generateHtml({ history: [] }, { autoRefresh: true });
    const final = generateHtml({ history: [] }, { autoRefresh: false });
    expect(live).toContain('http-equiv="refresh"');
    expect(final).not.toContain('http-equiv="refresh"');
  });

  test("an empty output still renders a page", () => {
    expect(generateHtml({})).toContain("</html>");
  });
});

// ---------------------------------------------------------------------------
// The ported page layout
// ---------------------------------------------------------------------------

describe("the report composes pages the way the source does", () => {
  test("wraps content in the 960px reading column", () => {
    const html = generateHtml({ history: [historyEntry(1, "first")] });
    expect(html).toContain('<div class="wrap">');
    expect(html).toContain(".wrap { max-width: 960px;");
  });

  test("uses sections with an eyebrow, a heading and a right-hand description", () => {
    // The source pairs every heading with an explanation of what the reader is looking at.
    // Our pages previously presented numbers with no interpretation at all.
    const html = generateHtml({ history: [historyEntry(1, "first")] });
    expect(html).toContain('<section class="sec">');
    expect(html).toContain('<div class="sec-head">');
    expect(html).toContain('<div class="eyebrow">outcome</div>');
    expect(html).toContain('<p class="desc">');
  });

  test("renders headline figures as .metric tiles with footnotes", () => {
    const html = generateHtml({
      history: [historyEntry(1, "first")],
      best_score: "3/4",
      iterations_run: 3,
      train_size: 4,
      test_size: 2,
    });
    expect(html).toContain('<div class="metric">');
    expect(html).toContain('<div class="ml">selected score</div>');
    expect(html).toContain('<div class="mv">3/4</div>');
    // .mf is where the qualification goes -- the number alone does not say which split.
    expect(html).toContain('<div class="mf">');
  });

  test("states the held-out caveat on the score itself, not only in prose", () => {
    // The distinction the whole loop turns on: a train score is not evidence of generality.
    const withHoldout = generateHtml({ history: [], best_test_score: "4/4" });
    expect(withHoldout).toContain("held-out queries the optimizer never saw");
    const trainOnly = generateHtml({ history: [] });
    expect(trainOnly).toContain("no held-out split was run");
  });

  test("puts the explainer in a .note with an uppercase label, not a bespoke box", () => {
    const html = generateHtml({ history: [] });
    expect(html).toContain('<div class="note">');
    expect(html).toContain('<div class="nb">how to read this</div>');
    // The old one-off wrapper is gone.
    expect(html).not.toContain('class="explainer"');
  });

  test("follows the data with .fine small print saying how to read it", () => {
    // The source pairs every data panel with a note or fine line. Ours says which half of
    // the eval set is the hard half, which the ticks alone do not convey.
    const html = generateHtml({ history: [historyEntry(1, "first")] });
    expect(html).toContain('<p class="fine">');
    expect(html).toContain("A negative query is the harder half");
  });

  test("lets the query table break out of the reading column, as a stated exception", () => {
    // Four fixed columns plus one per query: at 20 queries that is 24 columns, which 960px
    // would make unreadable. The exception is deliberate and documented in the CSS.
    const html = generateHtml({ history: [historyEntry(1, "first")] });
    expect(html).toContain("width: 100vw");
    expect(html).toContain("THE ONE EXCEPTION to the 960px reading column");
  });
});
