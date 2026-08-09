/**
 * The app bar every served page carries: page title, and a segmented Report / In progress
 * toggle with a live count of running runs.
 *
 * INJECTED AT SERVE TIME, not written into each template. That is the whole design, and it
 * is the same call already made for `reportPath` reconciliation: there are four surfaces
 * (`dashboard.html`, `run-page.html`, `viewer.html`, and the HTML `generate-report.ts`
 * writes to a file) and they share no chrome -- zero `<header>` elements between them. The
 * generated report is the one that matters most, because it is the dead end the user
 * actually hit, and it is generated rather than templated. Injecting on the way out means
 * one implementation covers all of them, including the generated one, without
 * `generate-report.ts` learning anything about navigation.
 *
 * The "In progress" state is an OVERLAY on the page you are already on, not a second
 * destination. That is what removes the back-navigation problem rather than solving it:
 * there is nothing to navigate back FROM, because the run list opens over the current page
 * and closes again. It also means the toggle works identically on all four surfaces without
 * any of them needing to know where "back" would be.
 */

import {
  DESIGN_COMPONENTS,
  DESIGN_OVERRIDES,
  injectThemePrepaint,
  THEME_STORAGE_KEY,
  THEME_TOKENS,
} from "./theme.ts";

/** What the bar needs to render itself. */
export interface AppBarOptions {
  /** Left-hand title. The run's label on a report; "All runs" in the list state. */
  readonly title: string;
  /**
   * Quiet qualifier after the title -- the run's kind, for instance.
   *
   * Folded into the bar rather than left in a page heading: a heading that repeated the
   * title produced the same run name twice, once here and again in a band beneath. This
   * keeps the one thing that heading carried which the bar did not.
   */
  readonly subtitle?: string;
  /** Which segment starts active. `list` for the dashboard, `report` everywhere else. */
  readonly active: "report" | "list";
  /**
   * Runs currently in progress, for the count badge.
   *
   * Rendered into the markup so the first paint is correct rather than briefly empty, then
   * refreshed by polling. In a `--static` snapshot polling is off and this frozen number is
   * all there is -- which is why the bar labels it as a snapshot rather than leaving a
   * stale figure looking live.
   */
  readonly runningCount: number;
  /**
   * Poll interval in seconds for the count and the list. Zero disables polling, which is
   * the `--static` case: no server to poll, so a live-looking bar would be a lie.
   */
  readonly refreshSeconds: number;
  /**
   * Origin serving the run feed, when it is not the page's own.
   *
   * `generate-review.ts` serves on 3117 while the dashboard is on 3118, so its bar has to
   * reach across origins for both the feed and the links. Same-origin pages leave this
   * unset and use relative paths, which keeps them working on an ephemeral port.
   */
  readonly feedOrigin?: string;
}

/**
 * Escape text interpolated into the bar's markup.
 *
 * The title is a run label derived from a skill name, so it is user-supplied.
 */
function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Styles for the bar and its overlay.
 *
 * Scoped under `.sc-appbar` / `.sc-runs` prefixes because this is injected into pages whose
 * own stylesheets are not ours -- `viewer.html` and the description report each have their
 * own, and an unprefixed `.bar` or `.toggle` would collide silently. Colours are literals
 * rather than `var(--...)` for the same reason: the injected markup cannot assume the host
 * page defines any custom properties.
 */
const STYLE = `
<style>
${THEME_TOKENS}
${DESIGN_COMPONENTS}
${DESIGN_OVERRIDES}

  /*
   * The bar and its overlay. Every colour is a token, so both themes come from the block
   * above rather than from a second set of literals here -- which is the whole reason the
   * tokens ship with the injection instead of per page.
   *
   * Class names stay sc- prefixed: the bar is a guest on pages with their own stylesheets
   * (viewer.html alone has 50 classes), and an unprefixed .topbar or .badge would
   * silently restyle its host. The token NAMES are deliberately shared -- that is the point
   * -- but every selector is namespaced.
   */
  .sc-appbar{
    position:sticky; top:0; z-index:9999;
    display:flex; align-items:center; justify-content:space-between; gap:14px;
    padding:11px 20px;
    background:var(--bg);
    border-bottom:1px solid var(--border);
    font-family:var(--sans); font-size:14px; color:var(--text);
    letter-spacing:-.006em;
  }
  .sc-appbar-heading{ display:flex; align-items:baseline; gap:9px; min-width:0; }
  .sc-appbar-title{ font-weight:600; letter-spacing:-.01em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .sc-appbar-sub{ font-family:var(--mono); font-size:11px; color:var(--faint); white-space:nowrap; flex-shrink:0; }
  .sc-appbar-right{ display:flex; align-items:center; gap:10px; flex-shrink:0; }

  /* Segmented control, from the reference's .seg rule: pale fill on the selected segment over
     a subtle track, never a solid dark block. */
  .sc-seg{
    display:inline-flex; background:var(--seg-track);
    border:1px solid var(--border); border-radius:var(--r); padding:3px; gap:3px;
  }
  .sc-seg button{
    border:0; background:transparent; border-radius:6px;
    padding:6px 12px; font-size:13px; color:var(--muted);
    cursor:pointer; line-height:1.2;
    display:inline-flex; align-items:center; gap:6px; white-space:nowrap;
  }
  .sc-seg button[aria-pressed="true"]{ background:var(--seg-active); color:var(--text); box-shadow:0 1px 2px rgba(0,0,0,.06); }
  html[data-theme="dark"] .sc-seg button[aria-pressed="true"]{ box-shadow:none; }
  .sc-seg button:focus-visible{ outline:2px solid var(--accent); outline-offset:1px; }

  /* Theme toggle, from the reference's .iconbtn rule. */
  .sc-iconbtn{
    border:1px solid var(--border); background:var(--surface);
    border-radius:var(--r-sm); width:32px; height:32px;
    cursor:pointer; color:var(--text); font-size:14px;
    display:inline-flex; align-items:center; justify-content:center;
  }
  .sc-iconbtn:hover{ border-color:var(--text); }
  .sc-iconbtn:focus-visible{ outline:2px solid var(--accent); outline-offset:1px; }

  /* Count badge. On --surface-2 in both themes, so --text carries the contrast rather
     than an accent that only reads on one of them. */
  .sc-badge{
    font-family:var(--mono); font-size:11px;
    min-width:18px; padding:1px 7px; border-radius:999px;
    background:var(--surface-2); border:1px solid var(--border);
    color:var(--text); text-align:center;
  }

  /* The list state: an overlay over the current page, not a separate destination. */
  .sc-runs{
    position:fixed; inset:0; z-index:9998;
    background:var(--bg); overflow-y:auto;
    padding:72px 20px 48px; font-family:var(--sans);
  }
  .sc-runs[hidden]{ display:none; }
  .sc-runs-inner{ max-width:960px; margin:0 auto; }
  .sc-run{
    display:block; background:var(--surface);
    border:1px solid var(--border); border-radius:var(--r-lg);
    padding:14px 16px; margin-bottom:10px;
    text-decoration:none; color:var(--text);
    transition:.12s border-color;
  }
  .sc-run:hover{ border-color:var(--text); text-decoration:none; }
  .sc-run:focus-visible{ outline:2px solid var(--accent); outline-offset:2px; }
  .sc-run-label{ font-weight:600; font-size:14px; letter-spacing:-.01em; }
  .sc-run-kind{ font-family:var(--mono); font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--faint); margin-top:3px; }
  /* Matching the run page's progress card: 40px chip-to-bar, 19px bar-to-meta. */
  .sc-track{ background:var(--surface-3); border-radius:999px; height:5px; margin:40px 0 19px; overflow:hidden; }
  .sc-run-meta{ display:flex; align-items:center; justify-content:space-between; gap:12px; font-size:12px; }
  .sc-meta-count{ font-family:var(--mono); font-weight:600; color:var(--accent); }
  .sc-meta-phase{ color:var(--muted); }
  .sc-meta-time{ font-family:var(--mono); color:var(--muted); }
  .sc-track div{ height:100%; background:var(--accent); }
  .sc-chip{
    display:inline-flex; align-items:center; gap:5px;
    padding:2px 8px; border-radius:999px; font-family:var(--mono); font-size:11px;
    background:var(--surface-3); border:1px solid var(--border); color:var(--muted);
    margin-left:8px; white-space:nowrap;
  }
  .sc-chip::before{ content:""; width:7px; height:7px; border-radius:50%; background:currentColor; }
  .sc-chip-running{ color:var(--accent); }
  .sc-chip-done{ color:var(--good); }
  .sc-chip-failed{ color:var(--bad); }
  .sc-chip-stale{ color:var(--warn); }
  .sc-empty{ color:var(--muted); font-size:14px; text-align:center; padding:48px 0; }
  .sc-note{ font-size:11.5px; color:var(--faint); text-align:center; margin-bottom:14px; }
</style>`;

/**
 * The bar's behaviour.
 *
 * Plain DOM and `fetch`, no framework: this is injected into four pages whose own scripts
 * are unknown, so it must add nothing to the global namespace beyond one IIFE and must not
 * assume any library is present.
 */
function script(options: AppBarOptions): string {
  return `
<script>
(() => {
  const REFRESH_MS = ${options.refreshSeconds > 0 ? options.refreshSeconds * 1000 : 0};
  // Empty for a same-origin page, so relative paths keep working on an ephemeral port.
  const ORIGIN = ${JSON.stringify(options.feedOrigin ?? "")};
  const bar = document.getElementById("sc-appbar");
  if (bar === null) return;
  const overlay = document.getElementById("sc-runs");
  const reportButton = document.getElementById("sc-seg-report");
  const listButton = document.getElementById("sc-seg-list");
  const badge = document.getElementById("sc-badge");
  const listBody = document.getElementById("sc-runs-body");
  const onListPage = ${options.active === "list" ? "true" : "false"};

  function formatDuration(ms) {
    const total = Math.max(0, Math.round(ms / 1000));
    const h = Math.trunc(total / 3600);
    const m = Math.trunc((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return h + "h " + m + "m";
    if (m > 0) return m + "m " + s + "s";
    return s + "s";
  }

  function stateOf(run) {
    return run.stale ? "stale" : run.status.state;
  }

  /** Render the run list into the overlay. Text nodes only: labels are user-supplied. */
  function renderList(runs, now) {
    listBody.textContent = "";
    if (runs.length === 0) {
      const empty = document.createElement("div");
      empty.className = "sc-empty";
      empty.textContent = "No runs recorded yet.";
      listBody.appendChild(empty);
      return;
    }
    for (const run of runs) {
      const state = stateOf(run);
      const card = document.createElement("a");
      card.className = "sc-run";
      // Absolute when the feed is cross-origin: a relative /report/... would resolve
      // against the viewer's own port, which serves no such route.
      card.href = (run.detailUrl.startsWith("/") ? ORIGIN : "") + run.detailUrl;

      const label = document.createElement("div");
      label.className = "sc-run-label";
      label.textContent = run.status.label || run.status.runId;
      const chip = document.createElement("span");
      chip.className = "sc-chip sc-chip-" + state;
      chip.textContent = state === "stale" ? "no longer reporting" : state;
      label.appendChild(chip);
      card.appendChild(label);

      const kind = document.createElement("div");
      kind.className = "sc-run-kind";
      kind.textContent = run.status.kind;
      card.appendChild(kind);

      // Same treatment as the run page's progress card: bar first, then a space-between row
      // with the count anchored left and the duration right. Phase only while there is one.
      const track = document.createElement("div");
      track.className = "sc-track";
      const fill = document.createElement("div");
      const percent = run.status.total > 0
        ? Math.min(100, Math.round((run.status.settled / run.status.total) * 100))
        : 0;
      fill.style.width = (state === "done" ? 100 : percent) + "%";
      track.appendChild(fill);
      card.appendChild(track);

      const meta = document.createElement("div");
      meta.className = "sc-run-meta";
      const mLeft = document.createElement("span");
      mLeft.className = "sc-meta-count";
      mLeft.textContent = run.status.total > 0 ? run.status.settled + "/" + run.status.total : "";
      meta.appendChild(mLeft);
      if (state === "running" && run.status.detail && run.status.detail.phase) {
        const mid = document.createElement("span");
        mid.className = "sc-meta-phase";
        mid.textContent = run.status.detail.phase;
        meta.appendChild(mid);
      }
      const mRight = document.createElement("span");
      mRight.className = "sc-meta-time";
      // The remainder qualifies the duration, so it joins it rather than taking its own slot --
      // and it comes from the same feed field the run page reads, so the two surfaces cannot
      // disagree about the same run. Measured before this: the page said "~5m 3s left" while
      // this row showed the elapsed time alone.
      const elapsed = formatDuration((state === "running" ? now : run.status.updatedAt) - run.status.startedAt);
      mRight.textContent = state === "running" && typeof run.remainingMs === "number"
        ? elapsed + "  ·  ~" + formatDuration(run.remainingMs) + " left"
        : elapsed;
      meta.appendChild(mRight);
      card.appendChild(meta);
      listBody.appendChild(card);
    }
  }

  async function poll() {
    try {
      const response = await fetch(ORIGIN + "/api/runs", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      const runs = Array.isArray(data.runs) ? data.runs : [];
      const running = runs.filter((run) => run.status.state === "running" && !run.stale).length;
      // The badge is the ambient signal that makes the toggle worth having, so it updates
      // in the Report state too rather than only when the list is open.
      badge.textContent = String(running);
      badge.hidden = running === 0;
      if (overlay !== null && !overlay.hidden) renderList(runs, data.now || Date.now());
    } catch {
      // A dashboard that stopped answering leaves the last known count rather than
      // blanking the bar: a zero would read as "nothing is running", which is a claim.
    }
  }

  function show(which) {
    const list = which === "list";
    reportButton.setAttribute("aria-pressed", String(!list));
    listButton.setAttribute("aria-pressed", String(list));
    if (overlay !== null) overlay.hidden = !list;
    // On the dashboard itself the page content IS the list, so switching to Report has
    // nowhere to go: the toggle navigates to the most recent run instead of dead-ending.
    if (!list && onListPage) {
      const first = listBody.querySelector("a.sc-run");
      if (first !== null) window.location.href = first.getAttribute("href");
    }
    if (list) void poll();
  }

  reportButton.addEventListener("click", () => show("report"));
  listButton.addEventListener("click", () => show("list"));

  // Theme toggle. The initial value was already applied by the pre-paint script in <head>;
  // this only flips and persists, so the two never disagree about who owns first paint.
  const themeButton = document.getElementById("sc-theme");
  if (themeButton !== null) {
    themeButton.addEventListener("click", () => {
      const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try {
        localStorage.setItem(${JSON.stringify(THEME_STORAGE_KEY)}, next);
      } catch {
        // A file:// origin may refuse storage. The flip still applies for this page; it just
        // will not survive a reload, which is better than the toggle appearing to do nothing.
      }
    });
  }

  // Escape closes the overlay, which is what a reader expects of anything covering a page.
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && overlay !== null && !overlay.hidden) show("report");
  });

  if (REFRESH_MS > 0) {
    void poll();
    setInterval(poll, REFRESH_MS);
  }
  // Deliberately NOT opening the overlay on the dashboard. Its own body already renders the
  // run list, so the overlay would stack a second copy over the first -- and an unreachable
  // feed (a --static snapshot, or a saved page) would leave that copy EMPTY while still
  // covering the real content. The segment reads pressed because the page IS the list.
  if (onListPage && overlay !== null) overlay.remove();
})();
</script>`;
}

/**
 * Build the bar, its overlay and its script as one injectable string.
 *
 * The overlay markup is emitted even in the list state, because the dashboard page renders
 * its own list into the body and the overlay is what every OTHER page uses -- one shape of
 * markup for every surface rather than two.
 */
export function appBarHtml(options: AppBarOptions): string {
  const count = Math.max(0, options.runningCount);
  const frozen = options.refreshSeconds <= 0;
  return `${STYLE}
<div class="sc-appbar" id="sc-appbar">
  <span class="sc-appbar-heading">
    <span class="sc-appbar-title">${escapeHtml(options.title)}</span>${
      options.subtitle === undefined || options.subtitle === ""
        ? ""
        : `<span class="sc-appbar-sub">${escapeHtml(options.subtitle)}</span>`
    }
  </span>
  <span class="sc-appbar-right">
    <span class="sc-seg" role="group" aria-label="View">
      <button type="button" id="sc-seg-report" aria-pressed="${options.active === "report"}">Report</button>
      <button type="button" id="sc-seg-list" aria-pressed="${options.active === "list"}">In progress<span class="sc-badge" id="sc-badge"${count === 0 ? " hidden" : ""}>${count}</span></button>
    </span>
    <button class="sc-iconbtn" type="button" id="sc-theme" title="Toggle theme" aria-label="Toggle light or dark theme">◐</button>
  </span>
</div>
<div class="sc-runs" id="sc-runs" hidden>
  <div class="sc-runs-inner">
    ${frozen ? '<div class="sc-note">Snapshot — this list was frozen when the page was written and will not update.</div>' : ""}
    <div id="sc-runs-body"></div>
  </div>
</div>
${script(options)}`;
}

/**
 * Inject the bar into a page's `<body>`.
 *
 * Falls back to prepending when there is no `<body>` tag, which keeps this safe against the
 * description report's hand-assembled HTML rather than depending on its exact shape.
 */
export function injectAppBar(html: string, options: AppBarOptions): string {
  // The pre-paint script goes in first, into <head>. Doing both here means a caller cannot
  // inject the bar and forget the theme, which would leave a page flashing light before
  // settling into dark.
  const themed = injectThemePrepaint(html);
  const bar = appBarHtml(options);
  const bodyOpen = /<body[^>]*>/i.exec(themed);
  if (bodyOpen === null) return `${bar}\n${themed}`;
  const at = bodyOpen.index + bodyOpen[0].length;
  return `${themed.slice(0, at)}\n${bar}\n${themed.slice(at)}`;
}
