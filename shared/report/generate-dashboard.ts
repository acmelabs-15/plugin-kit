#!/usr/bin/env bun
/**
 * Serve a live dashboard of every long-running skill-creator script.
 *
 * Discovers runs by globbing the status directory that `../util/progress.ts`
 * writes into, then renders one row per run with its progress, and links through to
 * the run's own detail page where one exists.
 *
 * Usage:
 *     bun run generate-dashboard.ts [--port PORT] [--static PATH] [--refresh SECONDS]
 *
 * Nothing beyond the Bun runtime is required.
 *
 * Polling rather than a websocket, matching the description report's existing
 * meta-refresh: the writers are separate processes with no channel back to this one, so
 * a socket would need a filesystem watcher behind it to have anything to push -- more
 * moving parts for a page whose data changes every few seconds at most.
 */

import { injectAppBar } from "./app-bar.ts";
import {
  DASHBOARD_HEALTH_MARKER,
  DASHBOARD_HEALTH_PATH,
  isDashboardListening,
  openInBrowser,
  openingSuppressed,
} from "../util/browser.ts";
import { CliError, formatHelp, parseArgs, type Spec } from "../cli.ts";
import {
  discoverRuns,
  projectRemainingMs,
  statusDir,
  STALE_AFTER_MS,
  type DiscoveredRun,
} from "../util/progress.ts";

/** Comment token in dashboard.html replaced with the embedded data assignment. */
const EMBEDDED_DATA_TOKEN = "/*__EMBEDDED_DATA__*/";

/**
 * Distinct from generate-review.ts's 3117 so both can run at once. They are
 * complementary views -- this one lists runs, that one reviews a finished run's
 * outputs -- and reclaiming each other's port would make them mutually exclusive.
 */
const DEFAULT_PORT = 3118;

const DEFAULT_REFRESH_SECONDS = 5;

const TEXT_ENCODER = new TextEncoder();

/** One run as the page consumes it: the raw status plus what the server derived. */
export interface DashboardRun {
  readonly status: DiscoveredRun["status"];
  readonly stale: boolean;
  /** Projected ms remaining, from observed completions. Omitted when unknowable. */
  readonly remainingMs?: number;
  /**
   * Link to this run's own detail page. Always present: every kind the dashboard can
   * render a bar for has a page, served from `/report/<runId>`.
   */
  readonly detailUrl: string;
  /**
   * Where to POST to retry this run. Present only when it has genuinely stopped and
   * recorded a command line -- a `running` run has nothing to retry, and offering it
   * there invites the mis-click that costs an hour.
   */
  readonly retryUrl?: string;
  /** The invocation a retry would run, so the confirmation can quote it. */
  readonly retryCommand?: string;
  /**
   * What a retry would actually do, stated BEFORE the confirm.
   *
   * "Retry from iteration 3" and "Retry from the start" differ by tens of minutes at
   * roughly 12 minutes an iteration, so the reader has to know which they are agreeing
   * to. Never claims a resume that cannot happen: it is derived from whether persisted
   * iterations were actually found on disk.
   */
  readonly retryPlan?: string;
  /** How many scored iterations a resume would skip. Zero means a clean re-run. */
  readonly retryResumeFrom?: number;
}

export interface DashboardPayload {
  readonly runs: readonly DashboardRun[];
  readonly now: number;
  readonly generatedFrom: string;
  /** True for `--static`, so the page says "snapshot" rather than implying it is live. */
  readonly staticMode: boolean;
}

/**
 * Build the payload the page renders.
 *
 * The projection is computed here rather than in the browser so that a `--static`
 * snapshot carries the same numbers a served page would, instead of recomputing them
 * against the reader's clock hours later.
 */
export function buildPayload(
  runs: readonly DiscoveredRun[],
  now: number,
  options: {
    readonly staticMode: boolean;
    readonly serveReports: boolean;
    /**
     * Iteration counts found on disk, keyed by run id. Passed in rather than read here so
     * `buildPayload` stays synchronous and pure -- and so a retry can never advertise a
     * resume that the filesystem does not support.
     */
    readonly resumable?: ReadonlyMap<string, number>;
  },
): DashboardPayload {
  return {
    runs: runs.map((run) => {
      const remainingMs = run.stale ? null : projectRemainingMs(run.status, now);
      // A snapshot has no server to POST to, so retry is a served-mode affordance.
      const retryable =
        options.serveReports &&
        (run.status.state === "failed" || run.stale) &&
        run.status.commandLine !== undefined &&
        run.status.commandLine !== "";
      return {
        status: run.status,
        stale: run.stale,
        ...(remainingMs === null ? {} : { remainingMs }),
        detailUrl: detailUrlFor(run, options.serveReports),
        ...(retryable ? retryFields(run, options.resumable ?? new Map()) : {}),
      };
    }),
    now,
    generatedFrom: statusDir(),
    staticMode: options.staticMode,
  };
}

/**
 * How many scored iterations each stopped run left on disk.
 *
 * Read once per render rather than per row, and only for runs a retry could apply to.
 * The count is what distinguishes a resume from a re-run, so it comes from the file
 * itself -- never from the presence of a path, which says only that a directory was
 * requested and not that anything was written to it.
 */
export async function readResumableCounts(
  runs: readonly DiscoveredRun[],
): Promise<ReadonlyMap<string, number>> {
  const counts = new Map<string, number>();
  for (const run of runs) {
    if (run.status.state !== "failed" && !run.stale) continue;
    const dir = run.status.detail.resultsDir;
    if (dir === undefined || dir === "") continue;
    try {
      const raw: unknown = await Bun.file(`${dir}/results.json`).json();
      const history = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>)["history"] : undefined;
      if (Array.isArray(history) && history.length > 0) counts.set(run.status.runId, history.length);
    } catch {
      // Absent or malformed: no resume available, which is a legitimate answer.
    }
  }
  return counts;
}

/**
 * Retry fields for a stopped run, including what the retry would actually do.
 *
 * The plan text is the honest part. It says "from iteration N" only when N scored
 * iterations were actually found on disk; otherwise it says "from the start", because
 * implying a resume that cannot happen is worse than admitting a full re-run.
 */
function retryFields(
  run: DiscoveredRun,
  resumable: ReadonlyMap<string, number>,
): {
  retryUrl: string;
  retryCommand: string;
  retryPlan: string;
  retryResumeFrom: number;
} {
  const scored = resumable.get(run.status.runId) ?? 0;
  return {
    retryUrl: `/retry/${encodeURIComponent(run.status.runId)}`,
    retryCommand: run.status.commandLine as string,
    retryPlan:
      scored > 0
        ? `Retry from iteration ${scored + 1} — ${scored} scored iteration(s) already on disk will be reused.`
        : "Retry from the start — no scored iterations were persisted, so everything runs again.",
    retryResumeFrom: scored,
  };
}

/**
 * Where a run's own report can be reached. Total by construction -- every run has one.
 *
 * `/report/<runId>` is the single route for every kind, and the server decides what to
 * serve there: the run's own rich report when it wrote one, otherwise a page rendered
 * from the run's status and artifacts. That indirection is what lets every row be
 * clickable without four scripts each having to produce an HTML file.
 *
 * Served through this server rather than linked as a `file://` URL: a page served over
 * http cannot navigate to `file://` -- browsers block it silently, so the link would
 * simply do nothing. In `--static` mode there is no server, so a recorded local path is
 * the only thing left to offer and a reader can paste it; a run with no such path gets
 * the route anyway, which is inert in a snapshot but correct once served.
 */
function detailUrlFor(run: DiscoveredRun, serveReports: boolean): string {
  const route = `/report/${encodeURIComponent(run.status.runId)}`;
  if (serveReports) return route;
  const reportPath = run.status.detail.reportPath;
  return reportPath === undefined || reportPath === "" ? route : reportPath;
}

/**
 * Serialize for embedding inside an inline `<script>`.
 *
 * The same escaping generate-review.ts applies, and reachable for the same reason: a
 * run label is derived from a skill name and a status file is hand-editable, so `</script>`
 * in either would otherwise terminate the script element and render the page blank
 * with no error pointing at the cause. The `\uXXXX` forms decode back to the identical
 * characters, so the parsed value is unchanged.
 */
function serializeForScriptTag(payload: DashboardPayload): string {
  return JSON.stringify(payload).replace(
    /[<>&\u2028\u2029]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

/**
 * Replace the token with the data assignment.
 *
 * The function-valued replacement is required: a `$&` or `$1` inside the serialized
 * JSON would otherwise be read as a substitution pattern and corrupt the output.
 */
export function injectEmbeddedData(template: string, payload: DashboardPayload): string {
  const dataJson = serializeForScriptTag(payload);
  return template.replaceAll(EMBEDDED_DATA_TOKEN, () => `const EMBEDDED_DATA = ${dataJson};`);
}

/**
 * Add a meta refresh to the served page.
 *
 * Injected here rather than written into the template so the same file serves both
 * modes: a static snapshot that reloaded itself every five seconds would re-fetch a
 * file nothing is updating, forever.
 */
export function withMetaRefresh(html: string, seconds: number): string {
  if (seconds <= 0) return html;
  return html.replace("</head>", `  <meta http-equiv="refresh" content="${seconds}">\n</head>`);
}

/**
 * Reconcile a run's own written report against the live status.
 *
 * THE PROBLEM. A report written by the run is a periodic SNAPSHOT; the status file is the
 * live truth. `optimize-description.ts` writes its report after each iteration, so a crash mid-way
 * leaves the last snapshot claiming the next iteration is in progress -- and it says so
 * forever. Measured on a real failed run: the report contained one "in progress" and zero
 * mentions of failure, while the status said `failed` 4.5s later. The progress bar makes
 * that worse rather than better, because a frozen page now actively asserts something
 * false instead of merely looking static.
 *
 * WHY NOT ANOTHER WRITE ON THE CRASH PATH. It would fix this case and leave the general
 * one broken: a `SIGKILL` still freezes the page mid-claim, and no handler runs. Any fix
 * that lives in the writer has that hole.
 *
 * WHY NOT REGENERATE FROM HISTORY. Considered, and rejected on faithfulness: the loop's
 * history lives in the run's own process, and `results.json` is only written at the end --
 * which is precisely what a crashed run does not reach. Regenerating would mean
 * reconstructing a report from a status file that never carried per-query iteration
 * results, so the page would lose the very table the snapshot preserves.
 *
 * SO: serve the snapshot, and inject a status-derived banner above it. The snapshot keeps
 * the detail it alone has; the banner carries the authority, states the contradiction in
 * words, and removes the meta-refresh so a dead page stops re-polling. That keeps ONE
 * source of truth for liveness -- the status file -- across both surfaces.
 */
export function reconcileSnapshot(html: string, run: DiscoveredRun, now: number): string {
  const state = run.stale ? "stale" : run.status.state;
  // A live run's snapshot is not contradicting anything, so it is served untouched.
  if (state === "running") return html;

  const banner = staleSnapshotBanner(run, state, now);
  // The refresh tag goes first: a finished page must stop re-fetching itself, and the
  // snapshot was written with `autoRefresh: true` when it was still live.
  const withoutRefresh = html.replace(/\s*<meta http-equiv="refresh"[^>]*>/gi, "");
  return withoutRefresh.includes("<body>")
    ? withoutRefresh.replace("<body>", `<body>\n${banner}`)
    : `${banner}\n${withoutRefresh}`;
}

/**
 * The banner injected above a superseded snapshot.
 *
 * Inline styles rather than a class: this is prepended to HTML written by a different
 * generator, whose stylesheet is not ours to depend on.
 */
function staleSnapshotBanner(run: DiscoveredRun, state: string, now: number): string {
  const failed = run.status.state === "failed";
  const background = failed ? "#fceaea" : "#fef3c7";
  const color = failed ? "#c44" : "#d97706";
  const headline = failed
    ? "This run FAILED. The report below is the last snapshot it wrote, and any progress it shows is out of date."
    : `This run stopped reporting ${Math.max(0, Math.round((now - run.status.updatedAt) / 1000))}s ago and was most likely killed. The report below is its last snapshot; any progress it shows will not advance.`;

  const detail = failed && run.status.error !== undefined ? escapeHtml(run.status.error) : "";
  return [
    `<div style="font-family:'Poppins',sans-serif;background:${background};color:${color};`,
    `padding:0.9rem 1.2rem;border-radius:6px;margin:0 0 1rem 0;font-size:0.85rem;line-height:1.5">`,
    `<strong>${escapeHtml(headline)}</strong>`,
    detail === "" ? "" : `<div style="margin-top:0.5rem;font-family:ui-monospace,monospace;font-size:0.8rem;word-break:break-word">${detail}</div>`,
    `<div style="margin-top:0.5rem"><a href="/" style="color:${color}">← all runs</a></div>`,
    `</div>`,
  ].join("");
}

/** Minimal escape for text interpolated into the banner's markup. */
function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** What a per-run page is handed. Rendered client-side from the same status the list uses. */
export interface RunPagePayload {
  readonly status: DiscoveredRun["status"];
  readonly stale: boolean;
  readonly now: number;
  readonly remainingMs?: number;
  /** Artifacts the run wrote, as text, when they are small enough to embed. */
  readonly artifacts: readonly { readonly name: string; readonly content: string }[];
  /** Present on a stopped run with a recorded command line. Same rule as the list view. */
  readonly retryUrl?: string;
  readonly retryCommand?: string;
  readonly retryPlan?: string;
  readonly retryResumeFrom?: number;
}

/**
 * A run's page, rendered from its status.
 *
 * One template for every kind rather than four, because what differs between kinds is
 * which fields are populated, not the shape of the page: all four have progress, a
 * phase, timings and a terminal state, and only the body under that varies. The template
 * renders whatever is present and omits what is not, so a new kind needs no new page.
 */
export async function renderRunPage(
  run: DiscoveredRun,
  now: number,
  refreshSeconds: number,
): Promise<string> {
  const remainingMs = run.stale ? null : projectRemainingMs(run.status, now);
  const retryable =
    (run.status.state === "failed" || run.stale) &&
    run.status.commandLine !== undefined &&
    run.status.commandLine !== "";
  const payload: RunPagePayload = {
    status: run.status,
    stale: run.stale,
    now,
    ...(remainingMs === null ? {} : { remainingMs }),
    artifacts: await readArtifacts(run.status),
    ...(retryable ? retryFields(run, await readResumableCounts([run])) : {}),
  };

  const template = await Bun.file(`${import.meta.dir}/run-page.html`).text();
  const html = injectAppBar(injectPayload(template, payload), {
    title: run.status.label || run.status.runId,
    subtitle: run.status.kind,
    active: "report",
    runningCount: countRunning(await discoverRuns(now)),
    refreshSeconds,
  });
  // Only a live run needs to re-poll; a finished page reloading itself forever is the
  // bug the description report's own `autoRefresh` default exists to avoid.
  return run.status.state === "running" && !run.stale
    ? withMetaRefresh(html, refreshSeconds)
    : html;
}

/** Runs currently in flight, for the bar's count badge. */
function countRunning(runs: readonly DiscoveredRun[]): number {
  return runs.filter((run) => run.status.state === "running" && !run.stale).length;
}

/** Artifacts small enough to embed, so a benchmark's own output shows on its page. */
const MAX_ARTIFACT_BYTES = 256 * 1024;

/**
 * Read the text artifacts a run wrote, when it recorded any.
 *
 * Markdown and JSON only, and size-capped: this is embedded into a page as a string, and
 * an unbounded read would let one large output make every page slow to serve. A file
 * that is missing or too large is skipped rather than reported -- the page's job is to
 * show what exists, not to audit what does not.
 */
async function readArtifacts(
  status: DiscoveredRun["status"],
): Promise<readonly { name: string; content: string }[]> {
  const found: { name: string; content: string }[] = [];
  for (const path of status.detail.artifactPaths ?? []) {
    const file = Bun.file(path);
    try {
      if (!(await file.exists())) continue;
      if (file.size > MAX_ARTIFACT_BYTES) continue;
      found.push({ name: path.split("/").pop() ?? path, content: await file.text() });
    } catch {
      // Unreadable: skip rather than fail the whole page for one artifact.
    }
  }
  return found;
}

function injectPayload(template: string, payload: RunPagePayload): string {
  const json = JSON.stringify(payload).replace(
    /[<>&\u2028\u2029]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
  return template.replaceAll(EMBEDDED_DATA_TOKEN, () => `const EMBEDDED_DATA = ${json};`);
}

export async function renderDashboard(options: {
  readonly now?: number;
  readonly staticMode: boolean;
  readonly serveReports: boolean;
  readonly refreshSeconds: number;
  readonly staleAfterMs?: number;
}): Promise<string> {
  const now = options.now ?? Date.now();
  const runs = await discoverRuns(now, options.staleAfterMs ?? STALE_AFTER_MS);
  // Only meaningful when serving, since a snapshot has no route to POST a retry to.
  const resumable = options.serveReports ? await readResumableCounts(runs) : new Map<string, number>();
  const template = await Bun.file(`${import.meta.dir}/dashboard.html`).text();
  const withData = injectEmbeddedData(
    template,
    buildPayload(runs, now, {
      staticMode: options.staticMode,
      serveReports: options.serveReports,
      resumable,
    }),
  );
  const html = injectAppBar(withData, {
    title: "All runs",
    active: "list",
    runningCount: countRunning(runs),
    // A snapshot has no server to poll, so the bar says it is frozen rather than showing a
    // count that looks live and never moves.
    refreshSeconds: options.staticMode ? 0 : options.refreshSeconds,
  });
  return options.staticMode ? html : withMetaRefresh(html, options.refreshSeconds);
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

interface ServerContext {
  readonly refreshSeconds: number;
  /** Threshold the bar's feed uses, so its list agrees with the page's own. */
  readonly staleAfterMs: number;
}

async function handleRequest(request: Request, context: ServerContext): Promise<Response> {
  const path = new URL(request.url).pathname;

  // Retry is the only mutating route, and it is POST-only for that reason.
  if (request.method === "POST" && path.startsWith("/retry/")) return await retryRun(path);
  if (request.method !== "GET") return new Response("Method Not Allowed", { status: 405 });

  // Answered before anything else and with no filesystem work, because this is what a
  // second launch probes to decide whether a dashboard is already up. A slow or
  // failure-prone health check would produce a duplicate window.
  if (path === DASHBOARD_HEALTH_PATH) {
    return jsonResponse(JSON.stringify({ service: DASHBOARD_HEALTH_MARKER, pid: process.pid }));
  }
  // The bar polls this from every surface. Same payload the dashboard embeds, so the two
  // views cannot drift -- and it means a page on any origin-served surface shows the same
  // run list without each surface reimplementing discovery.
  if (path === "/api/runs") {
    const now = Date.now();
    const runs = await discoverRuns(now, context.staleAfterMs);
    return jsonResponse(
      JSON.stringify(
        buildPayload(runs, now, {
          staticMode: false,
          serveReports: true,
          resumable: await readResumableCounts(runs),
        }),
      ),
      200,
      // `generate-review.ts` serves its viewer on another port, so its bar fetches this
      // cross-origin and the browser blocks the read without this header. Read-only data
      // about local runs on a loopback-bound server, so the permissive value costs nothing
      // that was not already readable by anything able to reach the port.
      { "Access-Control-Allow-Origin": "*" },
    );
  }
  if (path === "/" || path === "/index.html") {
    // Rendered per request rather than cached, so the discovery glob is what makes the
    // page current and a new run appears without restarting the server.
    return htmlResponse(
      await renderDashboard({
        staticMode: false,
        serveReports: true,
        refreshSeconds: context.refreshSeconds,
      }),
    );
  }
  if (path.startsWith("/report/")) return await serveReport(path, context.refreshSeconds);
  return new Response("Not Found", { status: 404 });
}

/**
 * Retry a run: resume from its persisted iterations where possible, re-run where not.
 *
 * RETRY rather than restart, and the distinction is the point. The observed failure had
 * iteration 1's 200 attempts complete and score before the improvement step crashed;
 * beginning again from zero would discard work that was already good. So this passes
 * `--resume-from` when a `results.json` with scored iterations exists, and falls back to a
 * clean re-run when it does not -- never faking a resume it cannot perform.
 *
 * POST, not GET: a browser prefetch or a crawler following a link must not be able to
 * start an hour-long job. The page confirms before posting, quoting what the retry will
 * do, so this is the second of two gates rather than the only one.
 *
 * Offered only for a run that has genuinely stopped -- `failed`, or stale. A `running`
 * run that is merely slow has nothing to retry, and offering it there invites the
 * mis-click that costs the most.
 */
async function retryRun(path: string): Promise<Response> {
  const runId = decodeURIComponent(path.slice("/retry/".length));
  const match = (await discoverRuns()).find((run) => run.status.runId === runId);
  if (match === undefined) return jsonResponse(JSON.stringify({ error: "no such run" }), 404);

  const eligible = match.status.state === "failed" || match.stale;
  if (!eligible) {
    return jsonResponse(
      JSON.stringify({ error: "only a failed or no-longer-reporting run can be retried" }),
      409,
    );
  }

  const commandLine = match.status.commandLine;
  if (commandLine === undefined || commandLine === "") {
    return jsonResponse(JSON.stringify({ error: "this run recorded no command line" }), 422);
  }

  // Re-run through `bun run`, from the recorded script and arguments. The command line is
  // stored as the script's basename plus its arguments, so the script is resolved against
  // this skill's own directory rather than trusting a path from the status file -- a
  // status file is hand-editable, and spawning an arbitrary path from one would be a
  // straightforward way to turn a local dashboard into an execution primitive.
  const [scriptName, ...args] = commandLine.split(" ");
  if (scriptName === undefined) {
    return jsonResponse(JSON.stringify({ error: "unparseable command line" }), 422);
  }
  const resolved = resolveKnownScript(scriptName);
  if (resolved === null) {
    return jsonResponse(
      JSON.stringify({ error: `not a known entrypoint: ${scriptName}` }),
      422,
    );
  }

  // Resume when there is something to resume from. `--resume-from` is appended rather
  // than substituted, so the original invocation is preserved exactly and only the seed
  // is added; a command line that already carries one is left alone rather than doubled.
  const counts = await readResumableCounts([match]);
  const scored = counts.get(runId) ?? 0;
  const resultsDir = match.status.detail.resultsDir;
  const resumeArgs =
    scored > 0 && resultsDir !== undefined && !args.includes("--resume-from")
      ? ["--resume-from", `${resultsDir}/results.json`]
      : [];

  try {
    Bun.spawn(["bun", "run", resolved, ...args, ...resumeArgs], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    }).unref();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse(JSON.stringify({ error: `could not spawn: ${message}` }), 500);
  }

  return jsonResponse(
    JSON.stringify({
      ok: true,
      retried: [scriptName, ...args, ...resumeArgs].join(" "),
      resumedFrom: scored,
    }),
  );
}

/**
 * Resolve a recorded script name to a path, from a fixed allow-list.
 *
 * An allow-list rather than a path join, because the input reaches here from a JSON file
 * on disk. Only the entrypoints that actually report progress are restartable, and each
 * resolves to a location this module already knows.
 */
function resolveKnownScript(scriptName: string): string | null {
  const known: Record<string, string> = {
    "optimize-description.ts": "../operations/optimize-description.ts",
    "measure-triggering.ts": "../operations/measure-triggering.ts",
    "aggregate-results.ts": "../operations/aggregate-results.ts",
    "generate-review.ts": "./generate-review.ts",
  };
  const relative = known[scriptName];
  return relative === undefined ? null : new URL(relative, import.meta.url).pathname;
}

function jsonResponse(
  body: string,
  status = 200,
  extraHeaders: Readonly<Record<string, string>> = {},
): Response {
  const bytes = TEXT_ENCODER.encode(body);
  return new Response(bytes, {
    status,
    headers: {
      "Content-Type": "application/json",
      "Content-Length": String(bytes.byteLength),
      ...extraHeaders,
    },
  });
}

/**
 * Serve a run's own report. Every run has one.
 *
 * Two sources, in order of richness:
 *
 * 1. A report the run WROTE itself, when it wrote one -- `optimize-description.ts` produces a full
 *    per-iteration table with its own in-progress bar, and nothing here could improve
 *    on it, so it is passed through untouched.
 * 2. Otherwise a page rendered from the run's status, which is why every kind has a page
 *    without four scripts each having to emit HTML. The status already carries progress,
 *    phase, timings and per-query tallies; the shared renderer turns that into the same
 *    shape of page.
 *
 * The path carries a run id, NOT a file path, and the file served in case 1 is whatever
 * that run's own status file names. That indirection is the access control: a request
 * cannot name an arbitrary path, so there is no traversal to defend against -- only ids
 * written by a run on this machine resolve to anything.
 */
async function serveReport(path: string, refreshSeconds: number): Promise<Response> {
  const runId = decodeURIComponent(path.slice("/report/".length));
  const match = (await discoverRuns()).find((run) => run.status.runId === runId);
  if (match === undefined) {
    return new Response(`No run recorded with id: ${runId}`, { status: 404 });
  }

  // A run that serves its own page gets redirected to, not reproduced. Only while it is
  // still running: once it stops, the port is closed and the redirect would land on a
  // connection error, so a finished run falls through to the rendered page instead.
  const externalUrl = match.status.detail.externalUrl;
  if (externalUrl !== undefined && externalUrl !== "" && match.status.state === "running") {
    return Response.redirect(externalUrl, 302);
  }

  const reportPath = match.status.detail.reportPath;
  if (reportPath !== undefined && reportPath !== "") {
    const file = Bun.file(reportPath);
    // A live report under the OS temp directory can be reaped while its status file
    // survives. Falling through to the rendered page rather than returning 410 keeps the
    // row clickable: the status is still on disk, so there is still something to show.
    if (await file.exists()) {
      const now = Date.now();
      // The description report is generated HTML written to a file, so it has no template
      // to carry chrome -- and it was the dead end the user actually hit. Injecting here
      // means `generate-report.ts` needs to know nothing about navigation, and the same
      // code path that reconciles a stale snapshot also gives it a way out.
      const reconciled = reconcileSnapshot(await file.text(), match, now);
      return htmlResponse(
        injectAppBar(reconciled, {
          title: match.status.label || match.status.runId,
          subtitle: match.status.kind,
          active: "report",
          runningCount: countRunning(await discoverRuns(now)),
          // A finished run's page does not re-poll, but the bar still does: the count is
          // about OTHER runs, which keep moving after this one has stopped.
          refreshSeconds,
        }),
      );
    }
  }

  return htmlResponse(await renderRunPage(match, Date.now(), refreshSeconds));
}

function htmlResponse(html: string): Response {
  const body = TEXT_ENCODER.encode(html);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Length": String(body.byteLength),
    },
  });
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export const USAGE = "usage: generate-dashboard.ts [options]";

export const CLI_SPEC: Spec = {
  port: { kind: "integer", short: "p", default: DEFAULT_PORT, help: "Server port" },
  static: {
    kind: "string",
    short: "s",
    help: "Write a standalone HTML snapshot here instead of serving",
  },
  refresh: {
    kind: "integer",
    short: "r",
    default: DEFAULT_REFRESH_SECONDS,
    help: "Seconds between page refreshes (0 to disable)",
  },
  "no-open": { kind: "boolean", default: false, help: "Do not open a browser window" },
  help: { kind: "boolean", short: "h", help: "Show this help message and exit" },
};



export interface CliOptions {
  readonly port: number;
  readonly staticPath: string | null;
  readonly refreshSeconds: number;
  readonly openBrowser: boolean;
  readonly help: boolean;
}

export function parseCliOptions(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>> = Bun.env,
): CliOptions {
  const { flags, positionals } = parseArgs(argv, CLI_SPEC);
  if (positionals.length > 0) {
    throw new CliError(`unrecognized arguments: ${positionals.join(" ")}`);
  }

  const refresh = flags["refresh"];
  if (typeof refresh !== "number" || refresh < 0) {
    throw new CliError(`--refresh expects a non-negative integer, got: ${String(refresh)}`);
  }
  const port = flags["port"];
  if (typeof port !== "number") throw new CliError(`--port expects an integer`);
  const staticFlag = flags["static"];
  const staticPath = typeof staticFlag === "string" && staticFlag !== "" ? staticFlag : null;

  // The env var is also enforced inside `openInBrowser`; read here too so `--help` and
  // the printed banner can say honestly whether a window will appear.
  const envSuppressed = openingSuppressed(env);
  return {
    port,
    staticPath,
    refreshSeconds: refresh,
    // `--static` implies no-open: it writes a file and starts no server, so there would
    // be nothing for a browser to connect to.
    openBrowser: flags["no-open"] !== true && !envSuppressed && staticPath === null,
    help: flags["help"] === true,
  };
}

/** Exit 2 on a malformed flag, matching generate-review.ts. */
function readOptionsOrExit(argv: readonly string[]): CliOptions {
  try {
    return parseCliOptions(argv);
  } catch (error) {
    if (!(error instanceof CliError)) throw error;
    console.error(formatHelp(USAGE, CLI_SPEC));
    console.error(`generate-dashboard.ts: error: ${error.message}`);
    process.exit(2);
  }
}

async function main(): Promise<void> {
  const args = readOptionsOrExit(Bun.argv.slice(2));
  if (args.help) {
    console.log(formatHelp(USAGE, CLI_SPEC));
    process.exit(0);
  }

  // `--static` for environments with no display, per references/environments.md. Report
  // links degrade to local paths there, since there is no server to route them through.
  if (args.staticPath !== null) {
    const html = await renderDashboard({
      staticMode: true,
      serveReports: false,
      refreshSeconds: 0,
    });
    await Bun.write(args.staticPath, html);
    console.log(`\n  Dashboard snapshot written to: ${args.staticPath}\n`);
    return;
  }

  // A dashboard is a single shared page, unlike the per-run report: it discovers runs by
  // glob, so an already-open one picks up a new run on its next poll. Launching a second
  // would give the user a second window showing identical content.
  if (await isDashboardListening(args.port)) {
    const existing = `http://localhost:${args.port}`;
    console.log(`\n  Dashboard already running at ${existing} — reusing it.\n`);
    return;
  }

  const context: ServerContext = {
    refreshSeconds: args.refreshSeconds,
    staleAfterMs: STALE_AFTER_MS,
  };
  const handler = (request: Request): Promise<Response> => handleRequest(request, context);

  let server: ReturnType<typeof Bun.serve>;
  try {
    server = Bun.serve({ port: args.port, hostname: "127.0.0.1", fetch: handler });
  } catch {
    // Deliberately NOT reclaiming the port the way generate-review.ts does. That
    // script kills whatever holds its port; doing the same here would make a second
    // dashboard silently terminate the first, and an ephemeral port costs nothing
    // because the URL is printed either way.
    //
    // Reached when something that is NOT a dashboard holds the port -- the probe above
    // already handled the case where one is.
    server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: handler });
  }

  const url = `http://localhost:${server.port}`;
  console.log("\n  Run Dashboard");
  console.log("  ─────────────────────────────────");
  console.log(`  URL:      ${url}`);
  console.log(`  Statuses: ${statusDir()}`);
  console.log(`  Refresh:  ${args.refreshSeconds > 0 ? `${args.refreshSeconds}s` : "off"}`);
  console.log("\n  Press Ctrl+C to stop.\n");

  // After `Bun.serve` returns, which means the socket is already listening -- opening
  // before this races the browser onto a connection error.
  if (args.openBrowser) openInBrowser(url);

  process.on("SIGINT", () => {
    console.log("\nStopped.");
    server.stop(true);
    process.exit(0);
  });
}

if (import.meta.main) await main();
