/**
 * Discovery, ordering and the empty-workspace case for `aggregate-results.ts`.
 *
 * Two shapes of workspace reach this script and both have to work. The harness
 * writes `eval-N/<config>/run-1/grading.json`; the manual loop in SKILL.md
 * writes `<descriptive-name>/<config>/grading.json`, with no `run-*` level and
 * no `eval-` prefix. Only the first was ever read, so the documented layout
 * aggregated to nothing and said so only in a line of stdout nobody was reading.
 *
 * The ordering tests exist because the sign of every delta depends on which
 * configuration is counted first, and sorting the names lexically gets
 * `new_skill` versus `old_skill` backwards -- reporting an improvement as a
 * regression in exactly the mode whose question is "did my change help".
 */

import { afterAll, expect, test } from "bun:test";

import { DASHBOARD_HEALTH_MARKER, DASHBOARD_HEALTH_PATH, DASHBOARD_PORT } from "../lib/browser.ts";
import {
  aggregateResults,
  generateBenchmark,
  isBaselineConfig,
  loadRunResults,
  orderConfigs,
  type RunResult,
} from "../aggregate-results.ts";

const TMP_ROOT = `${Bun.env["TMPDIR"] ?? "/tmp"}/skill-creator-aggregate-${Bun.nanoseconds()}`;
const CLI = `${import.meta.dir}/../aggregate-results.ts`;

let counter = 0;

function tempDir(): string {
  counter += 1;
  return `${TMP_ROOT}/case-${counter}`;
}

afterAll(async () => {
  await Bun.$`rm -rf ${TMP_ROOT}`.quiet().nothrow();
});

// ---------------------------------------------------------------------------
// Workspace fixtures
// ---------------------------------------------------------------------------

/** A grading.json with one expectation, scoring `passRate`. */
function grading(passRate: number, seconds: number): string {
  return JSON.stringify({
    summary: { pass_rate: passRate, passed: passRate, failed: 1 - passRate, total: 1 },
    timing: { total_duration_seconds: seconds },
    expectations: [{ text: "Produces the artifact", passed: passRate === 1, evidence: "checked" }],
  });
}

interface EvalSpec {
  readonly dir: string;
  readonly name?: string;
  /** Pass rate per configuration; one entry per run. */
  readonly configs: Readonly<Record<string, readonly number[]>>;
  /** Write `<config>/run-N/` rather than putting grading.json in `<config>/`. */
  readonly nested: boolean;
}

async function writeWorkspace(root: string, evals: readonly EvalSpec[]): Promise<string> {
  for (const spec of evals) {
    const evalDir = `${root}/${spec.dir}`;
    if (spec.name !== undefined) {
      await Bun.write(
        `${evalDir}/eval_metadata.json`,
        JSON.stringify({ eval_id: 0, eval_name: spec.name, prompt: "do the thing", assertions: [] }),
      );
    }
    for (const [config, passRates] of Object.entries(spec.configs)) {
      for (const [index, passRate] of passRates.entries()) {
        const runDir = spec.nested ? `${evalDir}/${config}/run-${index + 1}` : `${evalDir}/${config}`;
        await Bun.write(`${runDir}/outputs/report.md`, "# output\n");
        await Bun.write(`${runDir}/grading.json`, grading(passRate, 10 + index));
      }
    }
  }
  return root;
}

function passRates(runs: readonly RunResult[]): number[] {
  return runs.map((run) => run.passRate);
}

// ---------------------------------------------------------------------------
// Layouts
// ---------------------------------------------------------------------------

test("reads the harness layout: eval-N with numbered runs under each config", async () => {
  const root = await writeWorkspace(tempDir(), [
    { dir: "eval-1", configs: { with_skill: [1, 1], without_skill: [0, 1] }, nested: true },
  ]);

  const results = await loadRunResults(root);
  expect([...results.keys()]).toEqual(["with_skill", "without_skill"]);
  expect(passRates(results.get("with_skill") ?? [])).toEqual([1, 1]);
  expect((results.get("with_skill") ?? []).map((run) => run.runNumber)).toEqual([1, 2]);
});

test("reads the layout SKILL.md prescribes: descriptive names, no run-* level", async () => {
  const root = await writeWorkspace(tempDir(), [
    {
      dir: "pdf-table-extraction",
      name: "pdf-table-extraction",
      configs: { with_skill: [1], without_skill: [0] },
      nested: false,
    },
  ]);

  const results = await loadRunResults(root);
  expect([...results.keys()]).toEqual(["with_skill", "without_skill"]);

  const withSkill = results.get("with_skill") ?? [];
  expect(passRates(withSkill)).toEqual([1]);
  // A configuration directory that is itself the run is run 1, not run 0.
  expect(withSkill[0]?.runNumber).toBe(1);
  expect(withSkill[0]?.evalName).toBe("pdf-table-extraction");
});

test("reads a workspace mixing both layouts, since iterations accumulate", async () => {
  const root = await writeWorkspace(tempDir(), [
    { dir: "eval-1", configs: { with_skill: [1], without_skill: [0] }, nested: true },
    {
      dir: "chart-colours",
      name: "chart-colours",
      configs: { with_skill: [0.5], without_skill: [0] },
      nested: false,
    },
  ]);

  const results = await loadRunResults(root);
  expect(passRates(results.get("with_skill") ?? []).sort()).toEqual([0.5, 1]);
  expect(results.get("without_skill")).toHaveLength(2);
});

test("still reads the legacy runs/ subdirectory", async () => {
  const root = tempDir();
  await writeWorkspace(`${root}/runs`, [
    { dir: "eval-1", configs: { with_skill: [1], without_skill: [0] }, nested: true },
  ]);

  const results = await loadRunResults(root);
  expect([...results.keys()]).toEqual(["with_skill", "without_skill"]);
});

test("ignores directories that hold no gradings, so a snapshot is not read as an eval", async () => {
  const root = await writeWorkspace(tempDir(), [
    {
      dir: "pdf-table-extraction",
      name: "pdf-table-extraction",
      configs: { with_skill: [1], without_skill: [0] },
      nested: false,
    },
  ]);
  await Bun.write(`${root}/skill-snapshot/SKILL.md`, "---\nname: x\n---\n");
  await Bun.write(`${root}/skill-snapshot/references/notes.md`, "notes\n");
  await Bun.write(`${root}/benchmark.json`, "{}\n");

  const results = await loadRunResults(root);
  expect([...results.keys()]).toEqual(["with_skill", "without_skill"]);
});

test("a config directory with no grading.json contributes no entry, not an entry of zeros", async () => {
  const root = await writeWorkspace(tempDir(), [
    { dir: "eval-1", configs: { with_skill: [1] }, nested: false },
  ]);
  await Bun.write(`${root}/eval-1/without_skill/outputs/report.md`, "# ungraded\n");

  const results = await loadRunResults(root);
  expect([...results.keys()]).toEqual(["with_skill"]);
});

// ---------------------------------------------------------------------------
// Configuration ordering and the sign of the delta
// ---------------------------------------------------------------------------

test("the configuration under test sorts before its baseline, whichever pair is used", () => {
  expect(orderConfigs(["without_skill", "with_skill"])).toEqual(["with_skill", "without_skill"]);
  expect(orderConfigs(["with_skill", "without_skill"])).toEqual(["with_skill", "without_skill"]);
  // "old_skill" < "new_skill" lexically, which is the pair the old sort inverted.
  expect(orderConfigs(["old_skill", "new_skill"])).toEqual(["new_skill", "old_skill"]);
  expect(orderConfigs(["new_skill", "old_skill"])).toEqual(["new_skill", "old_skill"]);
});

test("unknown configuration names keep their lexical order and sit ahead of a baseline", () => {
  expect(orderConfigs(["zeta", "alpha"])).toEqual(["alpha", "zeta"]);
  expect(orderConfigs(["old_skill", "candidate_b", "candidate_a"])).toEqual([
    "candidate_a",
    "candidate_b",
    "old_skill",
  ]);
});

test("only the two baseline names are baselines", () => {
  expect(isBaselineConfig("without_skill")).toBe(true);
  expect(isBaselineConfig("old_skill")).toBe(true);
  expect(isBaselineConfig("with_skill")).toBe(false);
  expect(isBaselineConfig("new_skill")).toBe(false);
});

const NAMING_PAIRS: readonly (readonly [string, string])[] = [
  ["with_skill", "without_skill"],
  ["new_skill", "old_skill"],
];

test("an improvement reports a positive delta under either naming pair", async () => {
  for (const [primary, baseline] of NAMING_PAIRS) {
    const root = await writeWorkspace(tempDir(), [
      { dir: "eval-1", configs: { [primary]: [1], [baseline]: [0.4] }, nested: true },
    ]);

    const benchmark = await generateBenchmark(root, "demo", root);
    expect([...benchmark.summaries.keys()], primary).toEqual([primary, baseline]);
    expect(benchmark.delta.passRate, primary).toBe("+0.60");
  }
});

test("a regression reports a negative delta under either naming pair", async () => {
  for (const [primary, baseline] of NAMING_PAIRS) {
    const root = await writeWorkspace(tempDir(), [
      { dir: "eval-1", configs: { [primary]: [0.4], [baseline]: [1] }, nested: true },
    ]);

    const benchmark = await generateBenchmark(root, "demo", root);
    expect(benchmark.delta.passRate, primary).toBe("-0.60");
  }
});

test("the delta is recomputed from the classification, not from the order it is handed", () => {
  const run = (configuration: string, passRate: number): RunResult => ({
    evalId: 0,
    evalName: "demo",
    configuration,
    runNumber: 1,
    passRate,
    passed: passRate,
    failed: 1 - passRate,
    total: 1,
    timeSeconds: 10,
    tokens: 100,
    toolCalls: 0,
    errors: 0,
    expectations: [],
    notes: [],
  });

  // Baseline first, as a hand-built map or an older workspace would give it.
  const { summaries, delta } = aggregateResults(
    new Map([
      ["old_skill", [run("old_skill", 0.4)]],
      ["new_skill", [run("new_skill", 1)]],
    ]),
  );

  expect([...summaries.keys()]).toEqual(["new_skill", "old_skill"]);
  expect(delta.passRate).toBe("+0.60");
});

// ---------------------------------------------------------------------------
// Nothing to aggregate
// ---------------------------------------------------------------------------

test("a workspace with no gradings yields no runs", async () => {
  const root = tempDir();
  await Bun.write(`${root}/notes.md`, "nothing measured yet\n");

  expect([...(await loadRunResults(root)).keys()]).toEqual([]);
  expect((await generateBenchmark(root)).runs).toHaveLength(0);
});

/**
 * Occupy the dashboard port so the CLI does not spawn a real one.
 *
 * `ensureDashboard()` returns straight away when something is already
 * listening. If the port is already taken -- a dashboard running on the
 * developer's machine -- that serves the same purpose, so a failed bind is
 * fine and the stub is skipped.
 */
function stubDashboard(): { stop: () => void } {
  try {
    // The health endpoint has to answer like a dashboard, not merely hold the
    // port. `ensureDashboard` probes `/healthz` for a JSON marker; a stub that
    // returns anything else reads as "nothing is serving", so the CLI tries to
    // spawn a real dashboard, fails to bind against this very stub, and then
    // spends its whole 20 x 100ms poll loop waiting for a server that can never
    // appear -- pushing the run past this file's 5s timeout. Answering the probe
    // is what makes the stub a stub.
    const server = Bun.serve({
      port: DASHBOARD_PORT,
      fetch: (request) =>
        new URL(request.url).pathname === DASHBOARD_HEALTH_PATH
          ? Response.json({ service: DASHBOARD_HEALTH_MARKER })
          : new Response("stub"),
    });
    return { stop: () => void server.stop(true) };
  } catch {
    return { stop: () => {} };
  }
}

/**
 * Run the CLI without blocking this process's event loop.
 *
 * `Bun.spawnSync` cannot be used while `stubDashboard` is up. The stub answers
 * the health probe from *this* process, and a synchronous spawn parks the loop
 * that would serve it -- so the child's probe times out, the child then tries to
 * start a real dashboard, fails to bind against the stub, and spends its full
 * retry budget waiting for a server this process is holding but cannot answer
 * for. Six seconds, against a five-second test timeout. Spawning asynchronously
 * keeps the loop turning, the probe is answered immediately, and the child
 * returns in milliseconds.
 */
async function runCli(root: string): Promise<{ exitCode: number; stdout: string }> {
  const proc = Bun.spawn(["bun", CLI, root, "--skill-name", "demo"], {
    env: { ...process.env, SKILL_CREATOR_STATUS_DIR: `${root}/status`, SKILL_CREATOR_NO_OPEN: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  return { exitCode: await proc.exited, stdout };
}

test("finding nothing exits non-zero, says why, and writes no benchmark", async () => {
  const root = tempDir();
  await Bun.write(`${root}/notes.md`, "nothing measured yet\n");

  const dashboard = stubDashboard();
  try {
    const { exitCode, stdout } = await runCli(root);

    expect(exitCode).toBe(1);
    expect(stdout).toContain("No runs found");
    expect(stdout).toContain("grading.json");
    expect(await Bun.file(`${root}/benchmark.json`).exists()).toBe(false);
    expect(await Bun.file(`${root}/benchmark.md`).exists()).toBe(false);
  } finally {
    dashboard.stop();
  }
});

test("finding runs in the documented layout exits zero and writes both artifacts", async () => {
  const root = await writeWorkspace(tempDir(), [
    {
      dir: "pdf-table-extraction",
      name: "pdf-table-extraction",
      configs: { with_skill: [1], without_skill: [0.4] },
      nested: false,
    },
  ]);

  const dashboard = stubDashboard();
  try {
    const { exitCode } = await runCli(root);

    expect(exitCode).toBe(0);
    const written = (await Bun.file(`${root}/benchmark.json`).json()) as {
      runs: readonly unknown[];
      run_summary: Record<string, unknown>;
    };
    expect(written.runs).toHaveLength(2);
    expect(Object.keys(written.run_summary)).toEqual(["with_skill", "without_skill", "delta"]);

    const markdown = await Bun.file(`${root}/benchmark.md`).text();
    expect(markdown).toContain("| Pass Rate | 100% ± 0% | 40% ± 0% | +0.60 |");
  } finally {
    dashboard.stop();
  }
});
