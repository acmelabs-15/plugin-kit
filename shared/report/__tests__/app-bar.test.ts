/**
 * Tests for the shared app bar.
 *
 * The bar is injected into four pages whose own markup and stylesheets are not ours, so the
 * assertions are mostly about NOT breaking a host page: injection placement, class-name
 * scoping, escaping of user-supplied titles, and honesty about polling when there is no
 * server to poll. Behaviour that needs a browser is covered by the served-mode checks.
 */

import { describe, expect, test } from "bun:test";

import { appBarHtml, injectAppBar, type AppBarOptions } from "../app-bar.ts";
import { DESIGN_COMPONENTS, DESIGN_OVERRIDES } from "../theme.ts";

function options(overrides: Partial<AppBarOptions> = {}): AppBarOptions {
  return {
    title: "demo-skill — description optimization",
    active: "report",
    runningCount: 2,
    refreshSeconds: 5,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

describe("appBarHtml", () => {
  test("renders the title, both segments, and the count", () => {
    const html = appBarHtml(options());
    expect(html).toContain("demo-skill — description optimization");
    expect(html).toContain(">Report<");
    expect(html).toContain("In progress");
    expect(html).toContain(">2</span>");
  });

  test("is sticky, so it survives scrolling a long report", () => {
    expect(appBarHtml(options())).toMatch(/position:\s*sticky/);
  });

  test("the selected segment uses the design system's fill token, never a literal", () => {
    // The reference's own `.seg button.on` rule: a pale `--seg-active` fill over a subtle
    // track. Asserted as a TOKEN reference rather than a hex, because the point of adopting
    // the token set is that dark mode comes free -- a literal here would be light-only.
    const html = appBarHtml(options());
    expect(html).toContain("background:var(--seg-active)");
    expect(html).toContain("background:var(--seg-track)");
  });

  test("introduces no hard-coded colours at all", () => {
    // The whole reason to adopt the system. A single literal is one value that will not
    // follow the theme, and it is invisible until someone looks in dark mode.
    const css = appBarHtml(options()).split("</style>")[0] ?? "";
    const body = css.slice(css.indexOf(".sc-appbar{"));
    expect(body.match(/#[0-9a-fA-F]{3,8}\b/g)).toBeNull();
  });

  test("the segmented track carries the border, not the individual segments", () => {
    // One switch, not two buttons: the reference puts a single border on `.sc-seg` and none
    // between its children.
    const html = appBarHtml(options());
    expect(html).toContain(".sc-seg{");
    expect(html).not.toContain("button + button{ border-left");
  });

  test("keeps text labels rather than icons", () => {
    // The reference image showed icons; the instruction was to copy the STYLE, not the
    // iconography.
    const html = appBarHtml(options());
    expect(html).toContain(">Report<");
    expect(html).toContain("In progress");
    expect(html).not.toContain("<svg");
  });

  test("renders a subtitle beside the title when given one", () => {
    // The run's kind moved here from a page heading that repeated the title.
    const html = appBarHtml(options({ subtitle: "eval-sweep" }));
    expect(html).toContain('<span class="sc-appbar-sub">eval-sweep</span>');
  });

  test("omits the subtitle element entirely when there is none", () => {
    // Scoped to the markup, not the whole string: the class is declared in the stylesheet
    // either way, so a document-wide search would match the CSS rule and never fail.
    expect(appBarHtml(options())).not.toContain('<span class="sc-appbar-sub">');
  });

  test("escapes a subtitle carrying HTML", () => {
    expect(appBarHtml(options({ subtitle: "<b>x</b>" }))).not.toContain("<b>x</b>");
  });

  test("marks the active segment with aria-pressed, not just styling", () => {
    // The toggle is a real control: a screen reader has to be able to say which state is
    // current, and `aria-pressed` is what carries that.
    const onReport = appBarHtml(options({ active: "report" }));
    expect(onReport).toContain('id="sc-seg-report" aria-pressed="true"');
    expect(onReport).toContain('id="sc-seg-list" aria-pressed="false"');

    const onList = appBarHtml(options({ active: "list" }));
    expect(onList).toContain('id="sc-seg-list" aria-pressed="true"');
  });

  test("uses real buttons, so they are focusable and actuable without a mouse", () => {
    const html = appBarHtml(options());
    expect(html).toContain('<button type="button" id="sc-seg-report"');
    expect(html).toContain('<button type="button" id="sc-seg-list"');
    expect(html).toContain("focus-visible");
  });

  test("hides the badge at zero rather than showing a nought", () => {
    // A "0" reads as a measured claim that nothing is running; absence is quieter and
    // says the same thing.
    expect(appBarHtml(options({ runningCount: 0 }))).toContain('id="sc-badge" hidden');
    expect(appBarHtml(options({ runningCount: 3 }))).not.toContain('id="sc-badge" hidden');
  });

  test("clamps a negative count rather than rendering it", () => {
    expect(appBarHtml(options({ runningCount: -1 }))).toContain('id="sc-badge" hidden');
  });

  test("carries the badge in the Report state too", () => {
    // The count is the ambient signal that makes the toggle worth having: it has to be
    // visible when you are NOT looking at the list, or there is no reason to open it.
    const html = appBarHtml(options({ active: "report", runningCount: 4 }));
    expect(html).toContain(">4</span>");
  });
});

// ---------------------------------------------------------------------------
// Not breaking the host page
// ---------------------------------------------------------------------------

describe("injectAppBar", () => {
  const page = `<!DOCTYPE html><html><head><title>x</title></head><body>\n<h1>Report</h1>\n</body></html>`;

  test("injects just inside <body>, leaving the page's own content intact", () => {
    const html = injectAppBar(page, options());
    expect(html).toContain("<h1>Report</h1>");
    expect(html.indexOf("sc-appbar")).toBeGreaterThan(html.indexOf("<body>"));
    expect(html.indexOf("sc-appbar")).toBeLessThan(html.indexOf("<h1>Report</h1>"));
  });

  test("handles a body tag with attributes", () => {
    const withAttrs = `<html><body class="dark" data-x="1">\n<p>hi</p>\n</body></html>`;
    const html = injectAppBar(withAttrs, options());
    expect(html).toContain('<body class="dark" data-x="1">');
    expect(html.indexOf("sc-appbar")).toBeLessThan(html.indexOf("<p>hi</p>"));
  });

  test("prepends when there is no body tag at all", () => {
    // The description report's HTML is hand-assembled, so this must not depend on its
    // exact shape.
    const fragment = `<h1>Just a fragment</h1>`;
    const html = injectAppBar(fragment, options());
    expect(html).toContain("sc-appbar");
    expect(html).toContain("Just a fragment");
  });

  test("every class it introduces is prefixed, so it cannot collide with the host", () => {
    // Injected into pages with their own stylesheets -- an unprefixed `.header` or
    // `.badge` would silently restyle the page it is guest on.
    const html = appBarHtml(options());
    const classes = [...html.matchAll(/class="([^"]+)"/g)].flatMap((match) =>
      (match[1] ?? "").split(/\s+/),
    );
    expect(classes.length).toBeGreaterThan(0);
    for (const name of classes) {
      if (name === "") continue;
      expect(name.startsWith("sc-")).toBe(true);
    }
  });

  test("escapes a title carrying HTML", () => {
    const html = appBarHtml(options({ title: `</script><img src=x onerror=alert(1)>` }));
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;/script&gt;");
  });

  test("escapes a title carrying quotes, which would break the attribute context", () => {
    const html = appBarHtml(options({ title: `a " b & c` }));
    expect(html).toContain("&quot;");
    expect(html).toContain("&amp;");
  });
});

// ---------------------------------------------------------------------------
// Honesty about polling
// ---------------------------------------------------------------------------

describe("the bar does not claim to be live when it cannot be", () => {
  test("a served bar polls", () => {
    const html = appBarHtml(options({ refreshSeconds: 5 }));
    expect(html).toContain("REFRESH_MS = 5000");
    expect(html).toContain("setInterval");
  });

  test("a static bar does not poll, and says its list is frozen", () => {
    // `--static` has no server. A live-looking bar that never updates would be worse than
    // one that admits it is a snapshot.
    const html = appBarHtml(options({ refreshSeconds: 0 }));
    expect(html).toContain("REFRESH_MS = 0");
    expect(html).toContain("Snapshot");
    expect(html).toContain("will not update");
  });

  test("a served bar does not carry the snapshot note", () => {
    expect(appBarHtml(options({ refreshSeconds: 5 }))).not.toContain("Snapshot —");
  });

  test("honours a custom interval", () => {
    expect(appBarHtml(options({ refreshSeconds: 30 }))).toContain("REFRESH_MS = 30000");
  });
});

// ---------------------------------------------------------------------------
// Cross-origin, for the eval viewer
// ---------------------------------------------------------------------------

describe("cross-origin feed", () => {
  test("a same-origin bar uses relative paths, so an ephemeral port still works", () => {
    const html = appBarHtml(options());
    expect(html).toContain('const ORIGIN = ""');
    expect(html).toContain('ORIGIN + "/api/runs"');
  });

  test("a cross-origin bar targets the dashboard's origin", () => {
    // `generate-review.ts` serves on 3117 while the dashboard is on 3118, so a relative
    // /api/runs would hit a port that serves no such route.
    const html = appBarHtml(options({ feedOrigin: "http://localhost:3118" }));
    expect(html).toContain('const ORIGIN = "http://localhost:3118"');
  });

  test("run links are made absolute when the feed is cross-origin", () => {
    const html = appBarHtml(options({ feedOrigin: "http://localhost:3118" }));
    expect(html).toContain('run.detailUrl.startsWith("/") ? ORIGIN : ""');
  });
});

// ---------------------------------------------------------------------------
// Agreement with the run page, which describes the same runs
// ---------------------------------------------------------------------------

describe("the overlay row says the same thing the run page says", () => {
  // Caught by rendering both surfaces against one seeded status: the page read
  // "1m 32s · ~5m 3s left" while this row showed "1m 54s" and no projection at all. Both
  // read the same feed, so a reader clicking through saw two different accounts of one run.

  test("a running row carries the projection, joined to the duration", () => {
    const html = appBarHtml(options());
    expect(html).toContain('typeof run.remainingMs === "number"');
    expect(html).toContain('" left"');
  });

  test("the projection is qualified by state, so a finished row shows the duration alone", () => {
    // A terminal run has no remainder to project, and the reference design of a finished run
    // shows exactly the count and the duration.
    expect(appBarHtml(options())).toContain('state === "running" && typeof run.remainingMs');
  });

  test("phase also only appears while running", () => {
    expect(appBarHtml(options())).toContain('state === "running" && run.status.detail && run.status.detail.phase');
  });
});

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

describe("keyboard behaviour", () => {
  test("Escape closes the overlay, as a reader expects of anything covering a page", () => {
    expect(appBarHtml(options())).toContain('event.key === "Escape"');
  });

  test("the overlay starts hidden on a report page", () => {
    expect(appBarHtml(options({ active: "report" }))).toContain('id="sc-runs" hidden');
  });
});

// ---------------------------------------------------------------------------
// The ported design system
// ---------------------------------------------------------------------------

describe("the component layer is ported verbatim, not re-derived", () => {
  test.each([
    // Each of these carries a decision that does not survive paraphrase. 640 is not 600,
    // -.03em is not -0.03, and 1.05fr is a deliberate asymmetry. Asserted as exact strings so
    // a later tidy-up cannot round them without failing.
    ".hero{ padding:44px 0 8px; }",
    "font-size:34px; line-height:1.1; font-weight:640; letter-spacing:-.03em; margin:10px 0 12px;",
    "section.sec{ padding:56px 0; border-top:2px solid var(--sep); }",
    "grid-template-columns:minmax(0,1.05fr) minmax(0,1fr); gap:18px 48px; align-items:end; margin-bottom:30px;",
    ".sec-head h2{ font-size:24px; font-weight:640; letter-spacing:-.025em; margin:8px 0 0; }",
    ".panel{ border:1px solid var(--border); border-radius:var(--r-lg); background:var(--surface); padding:24px; }",
    ".eyebrow{ font-size:11px; text-transform:uppercase; letter-spacing:.09em; color:var(--faint); font-weight:600; }",
  ])("preserves %p exactly", (declaration) => {
    expect(DESIGN_COMPONENTS).toContain(declaration);
  });

  test("carries the responsive collapse, not just the desktop layout", () => {
    // Vertical rhythm includes what happens when it runs out of width.
    expect(DESIGN_COMPONENTS).toContain("@media (max-width:760px){ .sec-head{ grid-template-columns:1fr;");
  });

  test("keeps the source's grid gaps rather than a rounded equivalent", () => {
    expect(DESIGN_COMPONENTS).toContain(".g2{ display:grid; grid-template-columns:1fr 1fr; gap:14px; }");
    expect(DESIGN_COMPONENTS).toContain(".g3{ display:grid; grid-template-columns:repeat(3,1fr); gap:14px; }");
  });

  test("ports the whole layer, not a selected list of components", () => {
    // The instruction was to avoid omission, so this asserts breadth: every component family
    // the source defines is present, including ones our pages do not use yet.
    for (const selector of [
      ".topbar", ".chip", ".iconbtn", ".btn", ".seg", "section.sec", ".sec-head",
      ".eyebrow", ".panel", ".card-head", ".card-title", "table.tbl", ".diagram",
      "code{", ".fine", ".verdict", "hr.hair", ".metric", "details.adv", ".note",
      ".muted", ".faint", ".legend", ".sw", ".chart-box", ".topo",
    ]) {
      expect(DESIGN_COMPONENTS).toContain(selector);
    }
  });

  test("introduces no literal colours beyond the two the source itself uses", () => {
    // Verbatim means verbatim: the source has exactly two `#fff` literals -- the switch
    // thumb and the topology icon glyph -- both deliberately white ON an accent fill, which
    // is correct in either theme. Stripping them to tokens would be re-deriving, not
    // porting. Anything BEYOND those two would be a value that cannot follow the theme.
    const literals = DESIGN_COMPONENTS.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(literals).toEqual(["#fff", "#fff"]);
  });

  test("is shipped by the same injection as the tokens", () => {
    // One definition for five surfaces. If these ever diverge, a page gets components
    // referencing tokens it does not have.
    const html = appBarHtml(options());
    expect(html).toContain(".panel{");
    expect(html).toContain('html[data-theme="dark"]{');
  });
});

// ---------------------------------------------------------------------------
// Deliberate overrides on top of the verbatim port
// ---------------------------------------------------------------------------

describe("overrides are separate from the port and say why they exist", () => {
  test("the verbatim block still carries the source's own values", () => {
    // The port stays byte-identical. An override edited INTO it would read as a
    // transcription error, and the verbatim rule would invite someone to revert it.
    expect(DESIGN_COMPONENTS).toContain("align-items:end");
    expect(DESIGN_COMPONENTS).toContain("table.tbl th,table.tbl td{ text-align:left; padding:8px 12px;");
  });

  test("the warning callout is tinted by severity, not by model identity", () => {
    // `--opus`, `--fable`, `--sonnet` and `--haiku` are referenced by the port and defined
    // nowhere, because the token port carries the semantic colours only. A dangling `var()` is
    // invalid at computed-value time, so the source's rule leaves a `.note.warn` rendering in
    // the muted body colour -- less prominent than the plain `.note` it overrides.
    expect(DESIGN_OVERRIDES).toContain(
      ".note.warn{ border-left-color:var(--warn); } .note.warn .nb{ color:var(--warn); }",
    );
    // Both halves matter: the label is what a reader looks at first.
    expect(DESIGN_OVERRIDES).toContain(".note.warn .nb{ color:var(--warn); }");
    // And the port itself is untouched, which is what makes the override legible as a decision
    // rather than a transcription error.
    expect(DESIGN_COMPONENTS).toContain(
      ".note.warn{ border-left-color:var(--opus); } .note.warn .nb{ color:var(--opus); }",
    );
    // Two rules of equal specificity now target the same selector, so the fix holds only on
    // order. Asserted on the injected page rather than on the exports, because the order that
    // decides it is the injection's, not either block's.
    const injected = appBarHtml(options());
    expect(injected.indexOf(".note.warn{ border-left-color:var(--warn)")).toBeGreaterThan(
      injected.indexOf(".note.warn{ border-left-color:var(--opus)"),
    );
  });

  test("the override layer re-aligns section heads to the top", () => {
    // Requested directly. Our eyebrow+h2 stack pairs against a four-line description, and
    // bottom-aligning that pushes the heading away from the eyebrow it belongs to.
    expect(DESIGN_OVERRIDES).toContain(".sec-head{ align-items:flex-start; }");
  });

  test("the override layer carries the measured table values, not guessed ones", () => {
    // Derived from the adjusted render: glyph band 20.1 -> 18.5 CSS px is 13px -> 12px, and
    // the two vertical padding deltas averaged +5.6px on a source value of 8px.
    expect(DESIGN_OVERRIDES).toContain("table.tbl{ font-size:12px; }");
    expect(DESIGN_OVERRIDES).toContain("table.tbl th, table.tbl td{ padding:13px 14px; }");
  });

  test("metric values do not wrap, because ours are hyphenated identifiers", () => {
    // eval-sweep and description-loop break on the hyphen at .mv's 26px in a 1fr tile. The
    // source never met this: all of its .mv values are short numerics.
    expect(DESIGN_OVERRIDES).toContain(".metric .mv{ white-space:nowrap;");
  });

  test("both CSS blocks are injected, so an override can never ship without its base", () => {
    const html = appBarHtml(options());
    expect(html).toContain(".panel{");
    expect(html).toContain(".sec-head{ align-items:flex-start; }");
  });

  test("the theme toggle sits RIGHT of the segmented group", () => {
    // Requested directly, and NOT something the reference screenshots show -- measured, the
    // app-bar region of the two renders is identical (0 of 57,000 px differ by more than 40
    // grey levels, against a control region differing 2.28%), with the toggle glyph at
    // x2082-2103 in both. Independently re-measured and agreed. So this ordering rests on the
    // stated instruction alone: do not "restore" it on the grounds that a render disagrees.
    // DOM order is also focus order, so the visual arrangement and the tab sequence match.
    const html = appBarHtml(options());
    expect(html.indexOf('class="sc-seg"')).toBeLessThan(html.indexOf('id="sc-theme"'));
  });
});
