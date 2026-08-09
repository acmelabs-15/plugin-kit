/**
 * Opening a URL in the user's browser, and deciding whether to.
 *
 * Extracted because three call sites had grown their own copy of the same platform
 * switch -- `optimize-description.ts`, `eval-viewer/generate-review.ts` and now the dashboard. The
 * duplication was pre-existing and harmless until the `unref()` mattered: a batch
 * script that does not unref its opener cannot exit, which is the difference between a
 * detached run finishing and a detached run appearing to hang forever.
 */

import { PRUNE_AFTER_MS, pruneRuns } from "./progress.ts";

/**
 * Platform-appropriate command to hand a URL or file path to the desktop.
 *
 * Returns a mutable array because `Bun.spawn` declares `string[]`; a `readonly` return
 * would force every caller to copy it.
 */
export function browserCommand(target: string): string[] {
  if (process.platform === "darwin") return ["open", target];
  if (process.platform === "win32") return ["cmd", "/c", "start", "", target];
  return ["xdg-open", target];
}

/**
 * Env var suppressing every window this codebase would open.
 *
 * Checked inside {@link openInBrowser} rather than at each call site. That placement is
 * the fix for a real defect: it was previously honoured by two of four callers, so
 * `SKILL_CREATOR_NO_OPEN=1` still let the description report and the eval viewer open
 * windows. A per-call-site check is a rule every future caller has to remember; a check
 * in the one function they all go through is a rule they cannot forget.
 */
export const NO_OPEN_ENV = "SKILL_CREATOR_NO_OPEN";

/** Whether opening windows is suppressed for this process. */
export function openingSuppressed(
  env: Readonly<Record<string, string | undefined>> = Bun.env,
): boolean {
  return (env[NO_OPEN_ENV] ?? "") !== "";
}

/**
 * Open a target in the browser, detached.
 *
 * Every stream is ignored and the handle is `unref`'d, so the opener is not a child
 * this process waits on. Both matter for a batch script: an inherited stdout keeps the
 * pipe open, and a ref'd handle keeps the event loop alive, either of which turns a
 * finished run into one that never exits.
 *
 * Never throws. A machine with no display or no opener is an ordinary environment
 * (see ../../references/environments.md), not an error -- callers print the URL regardless,
 * so a failure here costs nothing.
 *
 * Returns whether a window was actually opened, so a caller can adjust what it prints.
 */
export function openInBrowser(target: string): boolean {
  if (openingSuppressed()) return false;
  try {
    Bun.spawn(browserCommand(target), {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    }).unref();
    return true;
  } catch {
    // No opener available. The URL is already printed by every caller.
    return false;
  }
}

/**
 * Marker served by a live dashboard, so a probe can tell OUR server from whatever else
 * might hold the port.
 */
export const DASHBOARD_HEALTH_PATH = "/healthz";
export const DASHBOARD_HEALTH_MARKER = "skill-creator-dashboard";

/** Where the dashboard serves by default. Shared so launchers and the server cannot disagree. */
export const DASHBOARD_PORT = 3118;

/**
 * Start a dashboard for this run unless one is already up, and open a window.
 *
 * Called by the batch scripts, so a detached run is watchable without the operator
 * remembering to start anything. Idempotent by probe: three runs launched in sequence
 * produce one server and one window, because the second and third find the first
 * answering and do nothing.
 *
 * The child is spawned fully detached and `unref`'d, and outlives its launcher
 * deliberately -- a dashboard that died with the run it was started for would go dark at
 * exactly the moment the operator wants to read the final state. `--no-open` is passed
 * to the child because this function opens the window itself, after confirming the
 * server answers; letting the child open it would race its own startup.
 *
 * Also prunes status files older than {@link PRUNE_AFTER_MS}, and this is the READER's entry
 * point: pruning belongs with the thing that walks the directory rather than with the thing
 * that writes one file into it. A run that pruned on its own startup would delete history
 * while an unrelated job was mid-flight, for reasons having nothing to do with that job.
 * Not behind a flag -- an unbounded directory that needs an opt-in to bound is the same
 * defect with an extra step.
 *
 * Deliberately BEFORE the probe, so it runs on every launch rather than only on the one that
 * starts a server. A dashboard outlives its launcher by design, so gating the prune on
 * spawning one would mean a dashboard left up for a fortnight prunes exactly once -- at the
 * start, when there is nothing yet to prune -- and the directory grows unbounded for as long
 * as it serves. Once per run launch is the cadence that actually holds the bound, and it is
 * cheap precisely because this call is what keeps the directory to a week's worth. Measured at
 * 17ms in that steady state, against an 11-14s time-to-first-tool-call floor per run.
 *
 * Never throws, and never blocks the run: a failure here loses observability, which
 * must never cost the work itself.
 */
export async function ensureDashboard(
  options: { readonly port?: number; readonly open?: boolean } = {},
): Promise<void> {
  // AWAITED rather than fired and forgotten, on measurement: 17ms over a steady-state week
  // (168 files), 42ms clearing a fortnight's backlog, and 327ms over a deliberately absurd
  // 2000 -- against the 11-14s time-to-first-tool-call every one of these runs then pays.
  // Awaiting keeps the ordering legible and cannot leak work past the caller's exit; a
  // detached prune would race the run's own first status write into the same directory.
  //
  // Wrapped even though `pruneRuns` swallows its own per-file failures, because the
  // never-throws contract above is load-bearing and a future edit inside it must not be able
  // to break a run. Housekeeping failing is not a reason to lose the work.
  try {
    await pruneRuns(PRUNE_AFTER_MS);
  } catch {
    // A directory we cannot read is a directory with nothing to prune.
  }

  const port = options.port ?? DASHBOARD_PORT;
  // No env check here: `openInBrowser` applies it, so one placement covers every caller.
  const shouldOpen = options.open !== false;
  const url = `http://localhost:${port}`;

  if (await isDashboardListening(port)) {
    // Already serving: its next poll will discover this run. Opening again would add a
    // duplicate window showing the same page.
    return;
  }

  try {
    Bun.spawn(
      [
        "bun",
        "run",
        new URL("../../eval-viewer/generate-dashboard.ts", import.meta.url).pathname,
        "--port",
        String(port),
        "--no-open",
      ],
      { stdin: "ignore", stdout: "ignore", stderr: "ignore" },
    ).unref();
  } catch {
    return; // No `bun` on PATH, somehow. Nothing to open.
  }

  // Poll for the socket rather than sleeping a fixed interval: startup is fast but not
  // instant, and opening early lands the browser on a connection error.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await Bun.sleep(100);
    if (await isDashboardListening(port, 200)) {
      if (shouldOpen) openInBrowser(url);
      return;
    }
  }
}

/**
 * Whether a dashboard is already serving on this port.
 *
 * Probed over HTTP rather than tracked in a pid or lock file, and that is the whole
 * design. A lock file records an INTENTION; a successful probe proves a server is
 * answering right now. The failure mode being avoided is specific: a dashboard killed
 * with SIGKILL never removes its lock file, so a lock-based check would refuse to open
 * a window forever after the first crash -- worse than an occasional extra window,
 * because the fix requires knowing to delete a file nobody documented.
 *
 * The marker check matters too. Something unrelated may hold the port, and treating
 * any listener as a dashboard would mean silently never opening the page while
 * reporting success.
 */
export async function isDashboardListening(port: number, timeoutMs = 500): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}${DASHBOARD_HEALTH_PATH}`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return false;
    const body: unknown = await response.json();
    return (
      typeof body === "object" &&
      body !== null &&
      (body as Record<string, unknown>)["service"] === DASHBOARD_HEALTH_MARKER
    );
  } catch {
    // Connection refused, a non-JSON body, or the probe timed out. Nothing is serving
    // a dashboard here as far as anyone can tell, which is the answer.
    return false;
  }
}
