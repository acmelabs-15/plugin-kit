/**
 * Tests for the run dashboard.
 *
 * Driven by writing real status files into a disposable directory and rendering the
 * page from them, rather than by mocking discovery: the dashboard's whole job is to
 * report what is on disk, so a mocked filesystem would test nothing that matters.
 * Timestamps are supplied explicitly so staleness and elapsed readings are
 * deterministic instead of racing the clock.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

import {
  buildPayload,
  CLI_SPEC,
  injectEmbeddedData,
  parseCliOptions,
  renderDashboard,
  USAGE,
  withMetaRefresh,
  type DashboardPayload,
} from "../../eval-viewer/generate-dashboard.ts";
import { CliError, formatHelp } from "../lib/cli.ts";
import {
  classify,
  STALE_AFTER_MS,
  writeStatusAtomically,
  type DiscoveredRun,
  type RunStatus,
} from "../../util/progress.ts";

const STATUS_DIR_ENV = "SKILL_CREATOR_STATUS_DIR";
const NOW = 5_000_000;

let scratch: string;
let previousDir: string | undefined;

beforeEach(async () => {
  previousDir = Bun.env[STATUS_DIR_ENV];
  scratch = await mkdtemp(`${tmpdir()}/dashboard-test-`);
  Bun.env[STATUS_DIR_ENV] = scratch;
});

afterEach(async () => {
  if (previousDir === undefined) delete Bun.env[STATUS_DIR_ENV];
  else Bun.env[STATUS_DIR_ENV] = previousDir;
  await rm(scratch, { recursive: true, force: true });
});

function status(overrides: Partial<RunStatus> = {}): RunStatus {
  return {
    runId: "eval-sweep-demo",
    kind: "eval-sweep",
    label: "demo — 20 queries × 3",
    settled: 12,
    total: 60,
    startedAt: NOW - 150_000,
    updatedAt: NOW - 1_000,
    state: "running",
    detail: {},
    ...overrides,
  };
}

function discovered(overrides: Partial<RunStatus> = {}): DiscoveredRun {
  return classify(status(overrides), NOW);
}

/** Recover the embedded payload the way the browser's parser would. */
function parseEmbedded(html: string): DashboardPayload {
  const match = /const EMBEDDED_DATA = (\{[\s\S]*?\});\n/.exec(html);
  if (match?.[1] === undefined) throw new Error("no EMBEDDED_DATA assignment in output");
  return JSON.parse(match[1]) as DashboardPayload;
}

const SERVED = { staticMode: false, serveReports: true } as const;
const STATIC = { staticMode: true, serveReports: false } as const;

// ---------------------------------------------------------------------------
// Payload
// ---------------------------------------------------------------------------

describe("buildPayload", () => {
  test("carries every discovered run", () => {
    const payload = buildPayload(
      [discovered({ runId: "a" }), discovered({ runId: "b" })],
      NOW,
      SERVED,
    );
    expect(payload.runs.map((run) => run.status.runId)).toEqual(["a", "b"]);
  });

  test("projects remaining time for a live run", () => {
    // 12 of 60 in 150s -> 12.5s per item -> 600s for the remaining 48.
    const payload = buildPayload([discovered()], NOW, SERVED);
    expect(payload.runs[0]?.remainingMs).toBe(600_000);
  });

  test("omits the projection for a stale run", () => {
    // Extrapolating from a dead run's last known rate would present a countdown for
    // work that will never finish.
    const payload = buildPayload(
      [classify(status({ updatedAt: NOW - STALE_AFTER_MS - 1 }), NOW)],
      NOW,
      SERVED,
    );
    expect(payload.runs[0]?.stale).toBe(true);
    expect(payload.runs[0]?.remainingMs).toBeUndefined();
  });

  test("omits the projection when nothing has settled yet", () => {
    const payload = buildPayload([discovered({ settled: 0 })], NOW, SERVED);
    expect(payload.runs[0]?.remainingMs).toBeUndefined();
  });

  test("routes a report through the server when serving", () => {
    // A page served over http cannot navigate to file://, so a served link has to be
    // a server route or it silently does nothing.
    const payload = buildPayload(
      [discovered({ detail: { reportPath: "/tmp/report.html" } })],
      NOW,
      SERVED,
    );
    expect(payload.runs[0]?.detailUrl).toBe("/report/eval-sweep-demo");
  });

  test("offers the local path in static mode, where there is no server to route through", () => {
    const payload = buildPayload(
      [discovered({ detail: { reportPath: "/tmp/report.html" } })],
      NOW,
      STATIC,
    );
    expect(payload.runs[0]?.detailUrl).toBe("/tmp/report.html");
  });

  test("reads reportPath from detail, NOT from the status root", () => {
    // Asserts the field's LOCATION, not just that a round trip works. The two are one
    // level apart, and a writer that hangs reportPath on the status root produces a page
    // that silently falls back -- a failure with no error attached to it. Asserted in
    // STATIC mode because that is the only mode where the value is read verbatim; served
    // mode returns the shared route either way, so it cannot distinguish the two.
    const rootOnly = {
      ...discovered(),
      status: { ...status(), reportPath: "/tmp/wrong-place.html" },
    } as DiscoveredRun;
    expect(buildPayload([rootOnly], NOW, STATIC).runs[0]?.detailUrl).not.toBe(
      "/tmp/wrong-place.html",
    );

    const inDetail = discovered({ detail: { reportPath: "/tmp/right-place.html" } });
    expect(buildPayload([inDetail], NOW, STATIC).runs[0]?.detailUrl).toBe("/tmp/right-place.html");
  });

  test("every run is linkable, including a kind that writes no file of its own", () => {
    // The rule: anything the dashboard renders a bar for must have a page. The route is
    // shared, so a run with no reportPath still links -- the server decides what to serve
    // there. A row that looked clickable and did nothing is what this replaced.
    const payload = buildPayload([discovered()], NOW, SERVED);
    expect(payload.runs[0]?.detailUrl).toBe("/report/eval-sweep-demo");
  });

  test("a run's own report still wins when it wrote one", () => {
    const payload = buildPayload(
      [discovered({ detail: { reportPath: "/tmp/r.html" } })],
      NOW,
      SERVED,
    );
    expect(payload.runs[0]?.detailUrl).toBe("/report/eval-sweep-demo");
  });
});

describe("injectEmbeddedData", () => {
  // The token sits on its own line, as it does in dashboard.html. That matters: the
  // assignment it becomes is newline-terminated, which is what a reader parsing the
  // page back out keys on.
  const template = ["<html><head></head><body><script>", "/*__EMBEDDED_DATA__*/", "</script></body></html>"].join("\n");

  test("replaces the token with a parseable assignment", () => {
    const payload = buildPayload([discovered()], NOW, SERVED);
    const html = injectEmbeddedData(template, payload);
    expect(html).not.toContain("/*__EMBEDDED_DATA__*/");
    expect(parseEmbedded(html).runs.length).toBe(1);
  });

  test("escapes a label that would otherwise close the script element", () => {
    // A run label is derived from a skill name, so this is reachable rather than
    // theoretical -- and it renders the page blank with no error pointing at the cause.
    const payload = buildPayload([discovered({ label: "</script><h1>pwned" })], NOW, SERVED);
    const html = injectEmbeddedData(template, payload);
    expect(html).not.toContain("</script><h1>");
    expect(html.match(/<\/script>/g)?.length).toBe(1);
  });

  test("the escaped label decodes back to the identical string", () => {
    const label = "</script> & <b>a</b>";
    const html = injectEmbeddedData(template, buildPayload([discovered({ label })], NOW, SERVED));
    expect(parseEmbedded(html).runs[0]?.status.label).toBe(label);
  });

  test("a label containing a substitution pattern survives verbatim", () => {
    // The function-valued replacement exists for this: `$&` in the JSON would
    // otherwise be interpreted as a backreference.
    const label = "cost $& $1 $$";
    const html = injectEmbeddedData(template, buildPayload([discovered({ label })], NOW, SERVED));
    expect(parseEmbedded(html).runs[0]?.status.label).toBe(label);
  });

  test("escapes the line-terminator code points that are legal in JSON but not in JS", () => {
    // Built from escapes rather than pasted: written literally these are invisible in
    // review, so the assertion would read as a tautology against an empty string.
    const label = `a\u2028b\u2029c`;
    const html = injectEmbeddedData(template, buildPayload([discovered({ label })], NOW, SERVED));
    expect(html).not.toContain("\u2028");
    expect(html).not.toContain("\u2029");
    expect(html).toContain("\\u2028");
    expect(parseEmbedded(html).runs[0]?.status.label).toBe(label);
  });
});

// ---------------------------------------------------------------------------
// Refresh
// ---------------------------------------------------------------------------

describe("withMetaRefresh", () => {
  test("adds the tag for a served page", () => {
    expect(withMetaRefresh("<html><head></head></html>", 5)).toContain(
      '<meta http-equiv="refresh" content="5">',
    );
  });

  test("adds nothing for a refresh of zero, so it can be turned off", () => {
    expect(withMetaRefresh("<html><head></head></html>", 0)).not.toContain("refresh");
  });

  test("honours the configured interval", () => {
    expect(withMetaRefresh("<html><head></head></html>", 30)).toContain('content="30"');
  });
});

// ---------------------------------------------------------------------------
// Rendering end to end
// ---------------------------------------------------------------------------

describe("renderDashboard", () => {
  test("renders an empty page when nothing has ever run", async () => {
    const html = await renderDashboard({ now: NOW, refreshSeconds: 5, ...SERVED });
    expect(parseEmbedded(html).runs).toEqual([]);
    expect(html).toContain("</html>");
  });

  test("renders every state a run can be in", async () => {
    await writeStatusAtomically(status({ runId: "live", updatedAt: NOW - 1_000 }));
    await writeStatusAtomically(
      status({ runId: "killed", updatedAt: NOW - STALE_AFTER_MS - 1 }),
    );
    await writeStatusAtomically(status({ runId: "ok", state: "done", updatedAt: NOW - 60_000 }));
    await writeStatusAtomically(
      status({ runId: "bad", state: "failed", updatedAt: NOW - 30_000, error: "spawn failed" }),
    );

    const payload = parseEmbedded(await renderDashboard({ now: NOW, refreshSeconds: 5, ...SERVED }));
    const byId = new Map(payload.runs.map((run) => [run.status.runId, run]));

    expect(byId.get("live")?.stale).toBe(false);
    expect(byId.get("killed")?.stale).toBe(true);
    expect(byId.get("ok")?.status.state).toBe("done");
    expect(byId.get("bad")?.status.error).toBe("spawn failed");
  });

  test("a served page refreshes itself; a static snapshot does not", async () => {
    // A snapshot that reloaded every five seconds would re-fetch a file nothing is
    // updating, forever.
    const served = await renderDashboard({ now: NOW, refreshSeconds: 5, ...SERVED });
    const snapshot = await renderDashboard({ now: NOW, refreshSeconds: 5, ...STATIC });
    expect(served).toContain('http-equiv="refresh"');
    expect(snapshot).not.toContain('http-equiv="refresh"');
  });

  test("marks a static snapshot as such, so it does not read as live", async () => {
    const payload = parseEmbedded(await renderDashboard({ now: NOW, refreshSeconds: 0, ...STATIC }));
    expect(payload.staticMode).toBe(true);
  });

  test("skips a malformed status file rather than failing the whole page", async () => {
    await writeStatusAtomically(status({ runId: "good" }));
    await Bun.write(`${scratch}/broken.json`, "{ truncated");

    const payload = parseEmbedded(await renderDashboard({ now: NOW, refreshSeconds: 5, ...SERVED }));
    expect(payload.runs.map((run) => run.status.runId)).toEqual(["good"]);
  });

  test("carries the render timestamp, so elapsed readings do not use the reader's clock", async () => {
    const payload = parseEmbedded(await renderDashboard({ now: NOW, refreshSeconds: 5, ...SERVED }));
    expect(payload.now).toBe(NOW);
  });

  test("honours a custom staleness threshold", async () => {
    await writeStatusAtomically(status({ runId: "recent", updatedAt: NOW - 10_000 }));
    const payload = parseEmbedded(
      await renderDashboard({ now: NOW, refreshSeconds: 5, staleAfterMs: 5_000, ...SERVED }),
    );
    expect(payload.runs[0]?.stale).toBe(true);
  });

  test("the template's placeholder is fully substituted", async () => {
    const html = await renderDashboard({ now: NOW, refreshSeconds: 5, ...SERVED });
    expect(html).not.toContain("__EMBEDDED_DATA__");
  });
});

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

describe("parseCliOptions", () => {
  test("defaults to serving on its own port, distinct from the review viewer's", () => {
    // Sharing 3117 would make the two viewers mutually exclusive.
    const options = parseCliOptions([], {});
    expect(options.port).toBe(3118);
    expect(options.staticPath).toBeNull();
    expect(options.refreshSeconds).toBe(5);
    expect(options.openBrowser).toBe(true);
  });

  test.each([
    [["--port", "4000"], 4000],
    [["-p", "4000"], 4000],
    [["--port=4000"], 4000],
  ])("accepts %p as a port", (argv, expected) => {
    expect(parseCliOptions(argv).port).toBe(expected);
  });

  test("rejects a fractional port rather than handing one to the server", () => {
    expect(() => parseCliOptions(["--port", "3.7"])).toThrow(CliError);
  });

  test.each([["--static", "/tmp/out.html"], ["-s", "/tmp/out.html"]])(
    "accepts %p for a snapshot path",
    (flag, value) => {
      expect(parseCliOptions([flag, value]).staticPath).toBe("/tmp/out.html");
    },
  );

  test("treats an empty --static as absent, so it does not write to the cwd", () => {
    expect(parseCliOptions(["--static", ""]).staticPath).toBeNull();
  });

  test("accepts a refresh of zero to disable polling", () => {
    expect(parseCliOptions(["--refresh", "0"]).refreshSeconds).toBe(0);
  });

  test("rejects a negative refresh", () => {
    expect(() => parseCliOptions(["--refresh", "-5"])).toThrow(CliError);
  });

  test("--no-open suppresses the launch, for a headless environment", () => {
    expect(parseCliOptions(["--no-open"], {}).openBrowser).toBe(false);
  });

  test("opens by default, since a dashboard nobody looks at is a slower log file", () => {
    expect(parseCliOptions([], {}).openBrowser).toBe(true);
  });

  test("the env var suppresses opening, for a box where no flag reaches this script", () => {
    expect(parseCliOptions([], { SKILL_CREATOR_NO_OPEN: "1" }).openBrowser).toBe(false);
  });

  test("an empty env var does not suppress, so an unset-looking value behaves as unset", () => {
    expect(parseCliOptions([], { SKILL_CREATOR_NO_OPEN: "" }).openBrowser).toBe(true);
  });

  test("--static implies no-open, since it starts no server to point a browser at", () => {
    expect(parseCliOptions(["--static", "/tmp/out.html"], {}).openBrowser).toBe(false);
  });

  test("rejects an unknown flag rather than ignoring it", () => {
    expect(() => parseCliOptions(["--nope"])).toThrow(CliError);
  });

  test("rejects a positional, since this command takes none", () => {
    // generate-review.ts takes a workspace path; this one discovers its own input, so a
    // path here means the caller confused the two.
    expect(() => parseCliOptions(["/some/workspace"])).toThrow(CliError);
  });

  test.each([["--help"], ["-h"]])("%p surfaces as help", (flag) => {
    expect(parseCliOptions([flag]).help).toBe(true);
  });
});

describe("help text", () => {
  test("documents every flag the parser accepts", () => {
    const help = formatHelp(USAGE, CLI_SPEC);
    for (const flag of ["--port", "--static", "--refresh", "--no-open", "--help"]) {
      expect(help).toContain(flag);
    }
  });
});
