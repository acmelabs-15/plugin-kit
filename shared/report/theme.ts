/**
 * The design tokens every viewer page uses, and the light/dark switch over them.
 *
 * Copied from the Fable/Opus lab reference rather than re-derived, so the two do not drift
 * on a value nobody remembers choosing. Two paired blocks keyed on `html[data-theme]`, over
 * a `:root` that holds only what does not change between themes -- type stacks and radii.
 *
 * WHY THIS LIVES IN THE INJECTION. The app bar is already injected into every served page,
 * so shipping the tokens alongside it means one definition reaches all five surfaces:
 * `dashboard.html`, `run-page.html`, `viewer.html`, the HTML `generate-report.ts` writes to
 * a file, and the bar itself. Each page's own stylesheet then references `var(--text)` and
 * inherits both themes for free. The alternative -- a token block per page -- is five places
 * for one colour to diverge.
 *
 * That inverts an earlier constraint. The bar's CSS used literals because it is a guest on
 * pages whose stylesheets are not ours and which might define no custom properties. Once
 * the injection is what DEFINES them, the guest brings its own host.
 */

/**
 * Token definitions, verbatim from the reference.
 *
 * `color-scheme: light dark` matters beyond the tokens: it is what makes form controls,
 * scrollbars and the canvas background follow the theme rather than staying light under a dark page.
 */
export const THEME_TOKENS = `
  :root{
    color-scheme: light dark;
    --mono: ui-monospace,"SF Mono","SFMono-Regular",Menlo,Consolas,"Liberation Mono",monospace;
    --sans: "Geist","Geist Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    --r-sm:6px; --r:8px; --r-lg:12px;
  }
  html[data-theme="light"]{
    --bg:#ffffff; --surface:#ffffff; --surface-2:#fafafa; --surface-3:#f5f5f5;
    --seg-track:#f5f5f5; --seg-active:#ffffff; --sep:rgba(0,0,0,.06);
    --text:#000000; --muted:#666666; --faint:#8f8f8f; --border:#eaeaea; --hair:#f0f0f0;
    --good:#0070f3; --bad:#e00000; --warn:#f5a623; --accent:#0070f3; --accent-weak:#e8f2ff;
  }
  html[data-theme="dark"]{
    --bg:#000000; --surface:#0c0c0c; --surface-2:#0e0e0e; --surface-3:#161616;
    --seg-track:#0c0c0c; --seg-active:#1f1f1f; --sep:#171717;
    --text:#ededed; --muted:#a1a1a1; --faint:#787878; --border:#2b2b2b; --hair:#171717;
    --good:#3291ff; --bad:#ff4d4d; --warn:#f7b955; --accent:#3291ff; --accent-weak:#0e1b2e;
  }`;


/**
 * The component layer, ported verbatim from the Fable/Opus lab reference.
 *
 * VERBATIM IS THE POINT. Every declaration is copied rather than re-derived, because the
 * values carry decisions that do not survive paraphrase: `font-weight:640` is not 600,
 * `letter-spacing:-.03em` is not -0.03, and the `minmax(0,1.05fr)` in `.sec-head` is a
 * deliberate asymmetry. A port that rounds those is a different design that resembles this
 * one. The suite asserts a sample of these exact strings so a later tidy-up cannot smooth
 * them out.
 *
 * SHIPPED WITH THE TOKENS, for the same reason they are: `injectAppBar` puts this into every
 * served page, so five surfaces share one definition -- including the HTML
 * `generate-report.ts` writes to a file, which has no template to hold a stylesheet of its
 * own.
 *
 * CLASS NAMES ARE THE SOURCE'S OWN, not prefixed. Measured before deciding: the source
 * defines 89 class names, our four pages use 88, and exactly ONE overlapped -- `.legend`,
 * which existed in the report generator as a horizontal row where the source's is a column.
 * That one was renamed on OUR side to `.col-legend` so this rule stays verbatim. Prefixing
 * all 89 would have cost fidelity to avoid a collision that turned out not to exist.
 * The app bar's own chrome keeps its `sc-` prefix: nothing in the source corresponds to it.
 */
export const DESIGN_COMPONENTS = `
  *{ box-sizing:border-box; }
  html,body{ background:var(--bg); }
  body{
    margin:0; color:var(--text); font-family:var(--sans); font-size:14px; line-height:1.6;
    -webkit-font-smoothing:antialiased; letter-spacing:-.006em;
    font-variant-numeric:tabular-nums; font-feature-settings:"tnum" 1;
  }
  .mono,.mv,td.n,th.n,.chip,.badge,.metric .ml,.eyebrow{ font-family:var(--mono); }
  a{ color:var(--accent); text-decoration:none; } a:hover{ text-decoration:underline; }

  /* top bar */
  .topbar{ position:sticky; top:0; z-index:20; display:flex; align-items:center; justify-content:space-between;
    padding:11px 20px; background:color-mix(in srgb,var(--bg) 88%, transparent); backdrop-filter:saturate(180%) blur(8px);
    border-bottom:1px solid var(--border); }
  .topbar .brand{ display:flex; align-items:center; gap:9px; font-weight:600; font-size:14px; letter-spacing:-.01em; }
  .dot{ width:9px; height:9px; border-radius:50%; background:var(--text); }
  .topbar .right{ display:flex; align-items:center; gap:10px; }
  .badge{ font-size:11px; color:var(--muted); border:1px solid var(--border); border-radius:999px; padding:3px 9px; background:var(--surface-2); }
  .iconbtn{ border:1px solid var(--border); background:var(--surface); border-radius:var(--r-sm); width:32px; height:32px; cursor:pointer; color:var(--text); font-size:14px; }
  .iconbtn:hover{ border-color:var(--text); }

  .wrap{ max-width:960px; margin:0 auto; padding:0 20px; }
  .hero{ padding:44px 0 8px; }
  .hero h1{ font-size:34px; line-height:1.1; font-weight:640; letter-spacing:-.03em; margin:10px 0 12px; }
  .hero p{ font-size:16px; color:var(--muted); margin:0; max-width:660px; }
  .eyebrow{ font-size:11px; text-transform:uppercase; letter-spacing:.09em; color:var(--faint); font-weight:600; }

  section.sec{ padding:56px 0; border-top:2px solid var(--sep); }
  .sec-head{ display:grid; grid-template-columns:minmax(0,1.05fr) minmax(0,1fr); gap:18px 48px; align-items:end; margin-bottom:30px; }
  .sec-head h2{ font-size:24px; font-weight:640; letter-spacing:-.025em; margin:8px 0 0; }
  .sec-head .desc{ color:var(--muted); font-size:15px; margin:0; }
  @media (max-width:760px){ .sec-head{ grid-template-columns:1fr; gap:8px; align-items:start; margin-bottom:20px; } }
  section.sec > h2{ font-size:24px; font-weight:640; letter-spacing:-.025em; margin:8px 0 8px; }
  section.sec > .desc{ color:var(--muted); font-size:15px; margin:0 0 22px; max-width:680px; }

  /* buttons + inputs (Geist) */
  button,select,input,textarea{ font:inherit; color:var(--text); }
  .btn{ display:inline-flex; align-items:center; gap:6px; height:32px; padding:0 12px; background:var(--surface);
    border:1px solid var(--border); border-radius:var(--r-sm); cursor:pointer; font-size:13px; transition:.12s border-color,.12s background; }
  .btn:hover{ border-color:var(--text); }
  .btn.pri{ background:var(--text); color:var(--bg); border-color:var(--text); }
  .btn.pri:hover{ opacity:.85; }
  .btn.sm{ height:28px; padding:0 10px; font-size:12px; }
  select,input[type=number],input[type=text],textarea{ background:var(--surface); border:1px solid var(--border);
    border-radius:var(--r-sm); padding:0 9px; height:32px; width:100%; outline:none; transition:.12s border-color,.12s box-shadow; }
  textarea{ height:auto; padding:8px 9px; line-height:1.5; resize:vertical; }
  select{ -webkit-appearance:none; -moz-appearance:none; appearance:none;
    background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23888888' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
    background-repeat:no-repeat; background-position:right 12px center; padding:0 34px 0 11px; }
  select:focus,input:focus,textarea:focus{ border-color:var(--accent); box-shadow:0 0 0 3px var(--accent-weak); }
  select:disabled{ opacity:.5; cursor:not-allowed; }
  input[type=range]{ width:100%; height:24px; accent-color:var(--accent); background:transparent; padding:0; }
  .fld{ display:flex; flex-direction:column; gap:6px; }
  .fld > span{ font-size:12px; color:var(--muted); display:flex; justify-content:space-between; align-items:center; gap:6px; }
  /* segmented effort control (Vercel-style) */
  .seg.eff{ display:flex; width:100%; }
  .seg.eff button{ flex:1; text-align:center; padding:6px 2px; font-size:12px; text-transform:capitalize; }
  .ctrl-row{ display:flex; align-items:flex-start; gap:20px; padding:17px 0; border-top:2px solid var(--sep); }
  .ctrl-row:first-child{ border-top:0; padding-top:2px; }
  .ctrl-row > .lbl{ flex:0 0 88px; font-size:13px; font-weight:600; color:var(--text); letter-spacing:-.01em; padding-top:1px; }
  .ctrl-row > .body{ flex:1 1 auto; min-width:0; }
  @media (max-width:640px){ .ctrl-row{ flex-direction:column; align-items:stretch; gap:8px; } .ctrl-row > .lbl{ flex-basis:auto; padding-top:0; } }

  /* cards + grids */
  .panel{ border:1px solid var(--border); border-radius:var(--r-lg); background:var(--surface); padding:24px; }
  .panel.pad0{ padding:0; overflow:hidden; }
  .g2{ display:grid; grid-template-columns:1fr 1fr; gap:14px; }
  .g3{ display:grid; grid-template-columns:repeat(3,1fr); gap:14px; }
  .g4{ display:grid; grid-template-columns:repeat(4,1fr); gap:14px; }
  @media (max-width:760px){ .g2,.g3,.g4{ grid-template-columns:1fr 1fr; } .hero h1{ font-size:27px; } }
  @media (max-width:480px){ .g2,.g3,.g4{ grid-template-columns:1fr; } }

  /* segmented control (Geist tabs) */
  .seg{ display:inline-flex; background:var(--seg-track); border:1px solid var(--border); border-radius:var(--r); padding:3px; gap:3px; }
  .seg button{ border:0; background:transparent; border-radius:6px; padding:6px 12px; font-size:13px; color:var(--muted); cursor:pointer; line-height:1.2; text-align:left; }
  .seg button em{ display:block; font-style:normal; font-size:11px; color:var(--faint); font-family:var(--mono); margin-top:1px; }
  .seg button.on{ background:var(--seg-active); color:var(--text); box-shadow:0 1px 2px rgba(0,0,0,.06); }
  html[data-theme="dark"] .seg button.on{ box-shadow:none; }
  .seg.full{ display:flex; } .seg.full button{ flex:1; text-align:center; }

  /* Note / callout */
  .note{ display:flex; flex-direction:column; gap:12px; border:1px solid var(--border); border-left:3px solid var(--accent);
    background:var(--surface-2); border-radius:var(--r); padding:24px; font-size:13px; color:var(--muted); }
  .note .nb{ font-size:11px; font-weight:600; color:var(--accent); text-transform:uppercase; letter-spacing:.08em; }
  .note > div{ line-height:1.7; }
  .note .chip{ margin-block:2px; }
  /* stacked definition rows (Vercel list pattern) */
  .legend{ display:flex; flex-direction:column; gap:9px; }
  .legend .lg-row{ display:flex; gap:12px; align-items:center; }
  .legend .lg-term{ flex:0 0 108px; display:flex; }
  .legend .lg-def{ color:var(--muted); line-height:1.5; }
  .lg-foot{ line-height:1.85; margin-top:17px; padding-top:17px; border-top:2px solid var(--sep); }
  @media (max-width:520px){ .legend .lg-row{ flex-direction:column; align-items:flex-start; gap:4px; } .legend .lg-term{ flex-basis:auto; } }
  .note.warn{ border-left-color:var(--opus); } .note.warn .nb{ color:var(--opus); }
  .note b{ color:var(--text); }

  /* chips */
  .chip{ display:inline-flex; align-items:center; gap:5px; padding:2px 8px; border-radius:999px; font-size:11px;
    background:var(--surface-3); color:var(--muted); border:1px solid var(--border); white-space:nowrap; }
  .chip::before{ content:""; width:7px; height:7px; border-radius:50%; background:currentColor; opacity:.9; }
  .chip.nodot::before{ display:none; }
  .chip.m{ color:var(--good); } .chip.i{ color:var(--opus); } .chip.a{ color:var(--faint); }
  .chip.fable{ color:var(--fable); } .chip.opus{ color:var(--opus); } .chip.sonnet{ color:var(--sonnet); } .chip.haiku{ color:var(--haiku); }

  /* metrics */
  .metric{ display:flex; flex-direction:column; gap:3px; border:1px solid var(--border); border-radius:var(--r); background:var(--surface-2); padding:24px; }
  .metric .ml{ font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:.05em; }
  .metric .mv{ font-size:26px; font-weight:640; letter-spacing:-.03em; line-height:1.05; }
  .metric .mf{ font-size:11px; color:var(--faint); }

  /* charts */
  .chart-box{ position:relative; height:280px; width:100%; }
  .chart-box.sm{ height:230px; }
  .clegend{ display:flex; flex-wrap:wrap; gap:8px 14px; margin-top:10px; font-size:12px; color:var(--muted); }
  .clegend span{ display:inline-flex; align-items:center; gap:6px; }
  .swatch{ width:10px; height:10px; border-radius:3px; display:inline-block; }
  .swatch.line{ height:0; border-top:2px dashed currentColor; width:14px; border-radius:0; }
  .swatch.hatch{ background-image:repeating-linear-gradient(45deg,currentColor 0 2px,transparent 2px 4px); }

  /* tables */
  table.tbl{ border-collapse:collapse; width:100%; font-size:13px; }
  table.tbl th,table.tbl td{ text-align:left; padding:8px 12px; border-bottom:1px solid var(--hair); }
  table.tbl thead th{ color:var(--muted); font-weight:500; font-size:11px; text-transform:uppercase; letter-spacing:.05em; background:var(--surface-2); }
  table.tbl tbody tr:hover,table.tbl tr:hover{ background:var(--surface-2); }
  table.tbl td.n,table.tbl th.n{ text-align:right; }
  table.tbl tr:last-child td{ border-bottom:0; }

  /* switch */
  .sw{ display:inline-flex; align-items:center; gap:9px; font-size:13px; font-weight:550; cursor:pointer; user-select:none; }
  .sw input{ position:absolute; opacity:0; width:0; height:0; }
  .sw .track{ width:34px; height:20px; border-radius:999px; background:var(--surface-3); border:1px solid var(--border); position:relative; flex:0 0 auto; transition:.15s; }
  .sw .thumb{ position:absolute; top:2px; left:2px; width:14px; height:14px; border-radius:50%; background:var(--faint); transition:.15s; }
  .sw input:checked + .track{ background:var(--accent); border-color:var(--accent); }
  .sw input:checked + .track .thumb{ transform:translateX(14px); background:#fff; }
  .sw input:focus-visible + .track{ box-shadow:0 0 0 3px var(--accent-weak); }
  .autopick{ font-size:11px; color:var(--accent); font-family:var(--mono); font-weight:600; }

  .row{ display:flex; align-items:center; gap:14px; flex-wrap:wrap; }
  .between{ display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }
  .muted{ color:var(--muted); } .faint{ color:var(--faint); }
  .fine{ font-size:11.5px; color:var(--faint); margin-top:8px; }
  code{ background:var(--surface-3); border:1px solid var(--border); padding:1px 5px; border-radius:5px; font-size:12px; font-family:var(--mono); }
  details.adv{ margin-top:17px; border:1px solid var(--border); border-radius:var(--r); background:var(--surface-2); }
  details.adv>summary{ cursor:pointer; padding:16px 24px; font-size:13px; font-weight:550; list-style:none; display:flex; align-items:center; gap:8px; }
  details.adv>summary::-webkit-details-marker{ display:none; }
  details.adv>summary::before{ content:"+"; color:var(--faint); font-family:var(--mono); }
  details.adv[open]>summary::before{ content:"–"; }
  .adv-body{ padding:0 24px 24px; }
  .verdict{ border:1px solid var(--border); border-radius:var(--r); background:var(--surface-2); padding:24px; font-size:13.5px; }
  .verdict b{ color:var(--text); }
  hr.hair{ border:0; border-top:1px solid var(--border); margin:16px 0; }
  .panel-fill{ display:flex; flex-direction:column; }
  .panel-fill .chart-box{ flex:1 1 auto; height:auto; min-height:230px; }
  /* dashboard-style chart card header (title left, legend/controls right) */
  .card-head{ display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;
    margin:-2px 0 14px; padding-bottom:12px; border-bottom:1px solid var(--hair); }
  .card-title{ font-size:13px; font-weight:600; letter-spacing:-.01em; }
  .card-head .clegend{ margin-top:0; }
  /* routing topology (Vercel-style flow) */
  .diagram{ width:100%; border:1px solid var(--border); border-radius:var(--r-lg); background:var(--surface-2); padding:24px; }
  .diagram .dh{ font-size:11px; text-transform:uppercase; letter-spacing:.09em; color:var(--faint); font-family:var(--mono); margin-bottom:16px; }
  .topo{ display:flex; align-items:stretch; gap:0; flex-wrap:nowrap; }
  .topo .node{ position:relative; flex:0 0 auto; width:238px; border:1px solid var(--border); border-radius:12px; background:var(--surface); padding:15px 16px; display:flex; flex-direction:column; justify-content:center; align-items:flex-start; gap:10px; }
  .topo .node .hd{ display:flex; align-items:center; gap:10px; }
  .topo .ic{ width:30px; height:30px; border-radius:8px; display:flex; align-items:center; justify-content:center; font-family:var(--mono); font-size:12.5px; font-weight:700; color:#fff; flex:0 0 auto; }
  .topo .nm{ font-weight:600; font-size:14.5px; letter-spacing:-.01em; line-height:1.15; }
  .topo .role{ font-size:12px; color:var(--muted); margin-top:1px; }
  .topo .meta{ margin-top:0; }
  .topo .node.dim{ opacity:.55; }
  .topo .dot{ position:absolute; right:-5px; top:50%; transform:translateY(-50%); width:11px; height:11px; border-radius:50%; background:var(--accent); box-shadow:0 0 0 4px color-mix(in srgb,var(--accent) 22%, transparent); z-index:2; }
  .topo .conn{ flex:1 1 auto; min-width:40px; align-self:center; position:relative; height:2px; }
  .topo .conn .ln{ position:absolute; top:0; left:0; right:0; height:2px; background:var(--border); }
  .topo .conn .ar{ position:absolute; right:-1px; top:50%; transform:translateY(-50%); width:0; height:0; border-top:4px solid transparent; border-bottom:4px solid transparent; border-left:6px solid var(--border); }
  .topo .conn .step{ position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); width:20px; height:20px; border-radius:50%; background:var(--border); border:0; font-size:10px; font-family:var(--mono); color:var(--text); display:flex; align-items:center; justify-content:center; z-index:2; }
  @media (max-width:640px){ .topo{ flex-direction:column; align-items:stretch; } .topo .node{ width:100%; min-height:0; } .topo .conn{ flex:0 0 26px; width:2px; height:26px; align-self:center; } .topo .conn .ln{ top:0;bottom:0;left:0;right:auto;width:2px;height:auto; } .topo .conn .ar{ right:auto; left:50%; top:auto; bottom:-1px; transform:translateX(-50%); border-left:4px solid transparent; border-right:4px solid transparent; border-top:6px solid var(--border); border-bottom:0; } .topo .dot{ right:50%; top:auto; bottom:-5px; transform:translateX(50%); } }
`;

/**
 * Deliberate overrides ON TOP of the verbatim port.
 *
 * Kept separate from {@link DESIGN_COMPONENTS} so that block stays byte-identical to the
 * reference and its exact-string assertions keep passing. An override edited INTO the port
 * would look like a transcription error to the next reader, and the verbatim rule would
 * invite them to "fix" it back.
 *
 * Each entry says what it overrides and why the source's value is wrong for us.
 */
export const DESIGN_OVERRIDES = `
  /*
   * .sec-head: align-items end -> flex-start.
   *
   * The source bottom-aligns a heading against its description, which works when the two are
   * a similar height. Ours pairs a two-line eyebrow+h2 stack against a description that runs
   * to four lines, and bottom-aligning that pushes the heading down the page away from the
   * eyebrow it belongs to. Requested directly, and the only place we knowingly diverge.
   */
  .sec-head{ align-items:flex-start; }

  /*
   * table.tbl: 13px/8px 12px -> 12px/13px 14px.
   *
   * Derived from the adjusted render rather than chosen: glyph band height measured 20.1 ->
   * 18.5 CSS px (-8%, which is 13px -> 12px), and the two vertical padding deltas measured
   * +6.4 and +4.8 CSS px against a source value of 8px. Our cells hold wrapped prose queries,
   * not the short figures the source's tables carry, so they need more room per row than a
   * reading-width document does.
   */
  table.tbl{ font-size:12px; }
  table.tbl th, table.tbl td{ padding:13px 14px; }

  /*
   * .metric .mv: no wrapping.
   *
   * Our values include hyphenated identifiers -- eval-sweep, description-loop -- and at
   * .mv's 26px in a 1fr tile the browser breaks on the hyphen, splitting one token across two
   * lines. The adjusted render shows it on one. The source's own .mv values are all short
   * numerics, so it never met this.
   */
  .metric .mv{ white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
`;

/**
 * Storage key for the user's theme choice.
 *
 * Namespaced, because these pages are served from `localhost` and a `file://` snapshot may
 * share an origin with anything else the user has opened from disk.
 */
export const THEME_STORAGE_KEY = "skill-creator.theme";

/**
 * Script that sets `data-theme` BEFORE first paint.
 *
 * Must go in `<head>`, ahead of any stylesheet. Applied later, a page defaulting to light
 * renders white and then flips, which is the flash the reference avoids the same way. It is
 * deliberately tiny and synchronous for that reason -- an async or deferred script is too
 * late by definition.
 *
 * The OS provides only the INITIAL value: once the user has toggled, their stored choice
 * wins on every page and every subsequent run, including after a restart.
 */
export const THEME_PREPAINT_SCRIPT = `<script>
(() => {
  try {
    const stored = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
    const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.setAttribute("data-theme", stored || (prefersDark ? "dark" : "light"));
  } catch {
    // A blocked or unavailable localStorage (some file:// origins) must not leave the page
    // with no theme at all, so fall back to the OS preference and carry on unpersisted.
    try {
      const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
      document.documentElement.setAttribute("data-theme", prefersDark ? "dark" : "light");
    } catch { document.documentElement.setAttribute("data-theme", "light"); }
  }
})();
</script>`;

/**
 * Insert the pre-paint script into a page's `<head>`.
 *
 * Placed immediately after `<head>` so it precedes every stylesheet. Falls back to
 * prepending when a page has no head -- the description report's HTML is hand-assembled,
 * so this cannot depend on its exact shape.
 */
export function injectThemePrepaint(html: string): string {
  const headOpen = /<head[^>]*>/i.exec(html);
  if (headOpen === null) return `${THEME_PREPAINT_SCRIPT}\n${html}`;
  const at = headOpen.index + headOpen[0].length;
  return `${html.slice(0, at)}\n${THEME_PREPAINT_SCRIPT}${html.slice(at)}`;
}
