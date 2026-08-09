import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  buildEmbeddedPayload,
  CLI_SPEC,
  deriveRunId,
  findRuns,
  generateHtml,
  injectEmbeddedData,
  loadPreviousIteration,
  parseCliOptions,
  USAGE,
  type EmbeddedPayload,
  type PreviousEntry,
  type Run,
} from "../../eval-viewer/generate-review.ts";
import { CliError, formatHelp } from "../lib/cli.ts";
import { DEFAULT_MIME_TYPE, extensionOf, getMimeType } from "../../util/mime.ts";

const SHARED_ROOT = `${import.meta.dir}/../..`;
const VIEWER_HTML = `${SHARED_ROOT}/eval-viewer/viewer.html`;
// The sign-off harness is skill-creator's own asset rather than shared tooling,
// so it stayed behind when scripts/ and eval-viewer/ moved up to shared/.
const EVAL_REVIEW_HTML = `${SHARED_ROOT}/../skills/skill-creator/assets/eval_review.html`;

const NO_PREVIOUS: ReadonlyMap<string, PreviousEntry> = new Map();

/** Recover the injected payload the way the browser's parser would. */
function parseEmbedded(html: string): EmbeddedPayload {
  const match = /const EMBEDDED_DATA = (\{[\s\S]*?\});/.exec(html);
  if (match?.[1] === undefined) throw new Error("no EMBEDDED_DATA assignment in output");
  return JSON.parse(match[1]) as EmbeddedPayload;
}

function run(overrides: Partial<Run> = {}): Run {
  return {
    id: "iteration-1-eval-a-with_skill",
    prompt: "do the thing",
    eval_id: 1,
    outputs: [],
    grading: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Placeholder tokens
// ---------------------------------------------------------------------------

describe("placeholder tokens", () => {
  test("assets/eval_review.html keeps all three hand-substituted tokens", async () => {
    const html = await Bun.file(EVAL_REVIEW_HTML).text();

    expect(html).toContain("__EVAL_DATA_PLACEHOLDER__");
    expect(html).toContain("__SKILL_NAME_PLACEHOLDER__");
    expect(html).toContain("__SKILL_DESCRIPTION_PLACEHOLDER__");
  });

  test("eval_review.html tokens sit where the model must substitute them", async () => {
    const html = await Bun.file(EVAL_REVIEW_HTML).text();

    expect(html).toContain("const EVAL_DATA = __EVAL_DATA_PLACEHOLDER__;");
    expect(html).toContain('<span id="skill-name">__SKILL_NAME_PLACEHOLDER__</span>');
    expect(html).toContain('<span id="skill-desc">__SKILL_DESCRIPTION_PLACEHOLDER__</span>');
  });

  test("eval-viewer/viewer.html keeps the generator's comment token", async () => {
    const html = await Bun.file(VIEWER_HTML).text();

    expect(html).toContain("/*__EMBEDDED_DATA__*/");
    expect(html.split("/*__EMBEDDED_DATA__*/")).toHaveLength(2);
  });

  test("the two files use different placeholder conventions and do not cross over", async () => {
    const viewer = await Bun.file(VIEWER_HTML).text();
    const evalReview = await Bun.file(EVAL_REVIEW_HTML).text();

    expect(viewer).not.toContain("__EVAL_DATA_PLACEHOLDER__");
    expect(evalReview).not.toContain("/*__EMBEDDED_DATA__*/");
  });
});

// ---------------------------------------------------------------------------
// Injected data contract
// ---------------------------------------------------------------------------

describe("injected data contract", () => {
  test("omits benchmark when there is none, keeping the four required keys", () => {
    const payload = buildEmbeddedPayload([run()], "my-skill", NO_PREVIOUS, null);

    expect(Object.keys(payload)).toEqual([
      "skill_name",
      "runs",
      "previous_feedback",
      "previous_outputs",
    ]);
  });

  test("adds benchmark as the fifth key when benchmark data exists", () => {
    const payload = buildEmbeddedPayload([run()], "my-skill", NO_PREVIOUS, { run_summary: {} });

    expect(Object.keys(payload)).toEqual([
      "skill_name",
      "runs",
      "previous_feedback",
      "previous_outputs",
      "benchmark",
    ]);
  });

  test("an empty benchmark object is not injected", () => {
    const payload = buildEmbeddedPayload([run()], "my-skill", NO_PREVIOUS, {});

    expect("benchmark" in payload).toBe(false);
  });

  test("run objects carry the field names the viewer reads", () => {
    const payload = buildEmbeddedPayload([run()], "my-skill", NO_PREVIOUS, null);
    const [first] = payload.runs;

    expect(first).toBeDefined();
    expect(Object.keys(first ?? {})).toEqual(["id", "prompt", "eval_id", "outputs", "grading"]);
  });

  test("previous feedback and outputs are keyed by run id, empties dropped", () => {
    const previous = new Map<string, PreviousEntry>([
      ["run-a", { feedback: "too terse", outputs: [] }],
      ["run-b", { feedback: "", outputs: [{ name: "o.txt", type: "text", content: "hi" }] }],
      ["run-c", { feedback: "", outputs: [] }],
    ]);

    const payload = buildEmbeddedPayload([run()], "my-skill", previous, null);

    expect(payload.previous_feedback).toEqual({ "run-a": "too terse" });
    expect(Object.keys(payload.previous_outputs)).toEqual(["run-b"]);
  });
});

// ---------------------------------------------------------------------------
// Data injection into the template
// ---------------------------------------------------------------------------

describe("injectEmbeddedData", () => {
  test("replaces the comment token with the EMBEDDED_DATA assignment", () => {
    const payload = buildEmbeddedPayload([run()], "my-skill", NO_PREVIOUS, null);

    const html = injectEmbeddedData("before\n/*__EMBEDDED_DATA__*/\nafter", payload);

    expect(html).not.toContain("/*__EMBEDDED_DATA__*/");
    expect(html).toContain("const EMBEDDED_DATA = {");
    expect(html.endsWith("};\nafter")).toBe(true);
  });

  test("dollar sequences in run data survive the replacement verbatim", () => {
    const prompt = "cost is $& and $1 and $$ and $`";
    const payload = buildEmbeddedPayload([run({ prompt })], "my-skill", NO_PREVIOUS, null);

    const html = injectEmbeddedData("/*__EMBEDDED_DATA__*/", payload);

    // Asserted through a parse rather than a substring: the escaping below
    // rewrites some characters on the wire, but never the decoded value.
    expect(parseEmbedded(html).runs[0]?.prompt).toBe(prompt);
  });

  test("output containing </script> cannot terminate the script block early", () => {
    const prompt = "the model emitted </script><img src=x onerror=alert(1)> mid-answer";
    const payload = buildEmbeddedPayload([run({ prompt })], "my-skill", NO_PREVIOUS, null);

    const html = injectEmbeddedData("/*__EMBEDDED_DATA__*/", payload);

    expect(html).not.toContain("</script>");
    expect(html).not.toContain("<img");
    expect(parseEmbedded(html).runs[0]?.prompt).toBe(prompt);
  });

  test("angle brackets and ampersands are escaped on the wire, not in the value", () => {
    const prompt = "a < b && c > d";
    const payload = buildEmbeddedPayload([run({ prompt })], "my-skill", NO_PREVIOUS, null);

    const html = injectEmbeddedData("/*__EMBEDDED_DATA__*/", payload);

    expect(html).toContain("\\u003c");
    expect(html).toContain("\\u0026");
    expect(html).toContain("\\u003e");
    expect(parseEmbedded(html).runs[0]?.prompt).toBe(prompt);
  });

  test("U+2028 and U+2029 are escaped, since JSON allows them raw but older JS did not", () => {
    // Written as escapes on purpose: a raw U+2028 in a source literal is the
    // very hazard under test, and it is invisible in a diff.
    const prompt = "line\u2028separated\u2029paragraph";
    const payload = buildEmbeddedPayload([run({ prompt })], "my-skill", NO_PREVIOUS, null);

    const html = injectEmbeddedData("/*__EMBEDDED_DATA__*/", payload);

    expect(html).not.toContain("\u2028");
    expect(html).not.toContain("\u2029");
    expect(html).toContain("\\u2028");
    expect(parseEmbedded(html).runs[0]?.prompt).toBe(prompt);
  });

  test("escaping leaves ordinary content untouched", () => {
    const payload = buildEmbeddedPayload([run({ prompt: "plain ascii" })], "s", NO_PREVIOUS, null);

    expect(injectEmbeddedData("/*__EMBEDDED_DATA__*/", payload)).toContain('"prompt":"plain ascii"');
  });

  test("the real viewer template parses back to the payload it was given", async () => {
    const payload = buildEmbeddedPayload([run()], "my-skill", NO_PREVIOUS, { notes: ["ok"] });

    const html = await generateHtml([run()], "my-skill", NO_PREVIOUS, { notes: ["ok"] });
    const match = /const EMBEDDED_DATA = (\{[\s\S]*?\});\n/.exec(html);

    expect(match?.[1]).toBeDefined();
    expect(JSON.parse(match?.[1] ?? "null")).toEqual(JSON.parse(JSON.stringify(payload)));
  });
});

// ---------------------------------------------------------------------------
// Run id derivation (join key with feedback.json)
// ---------------------------------------------------------------------------

describe("deriveRunId", () => {
  test("flattens the path relative to the workspace root", () => {
    expect(deriveRunId("/w", "/w/iteration-1/pdf-report/with_skill")).toBe(
      "iteration-1-pdf-report-with_skill",
    );
  });

  test("a single level yields the bare directory name", () => {
    expect(deriveRunId("/w", "/w/with_skill")).toBe("with_skill");
  });

  test("the workspace root itself derives to a single dot", () => {
    expect(deriveRunId("/w", "/w")).toBe(".");
  });

  test("backslashes are flattened too", () => {
    expect(deriveRunId("/w", "/w/iteration-1\\run-2")).toBe("iteration-1-run-2");
  });

  test("a trailing slash on the root does not leak into the id", () => {
    expect(deriveRunId("/w/", "/w/iteration-1/run-2")).toBe("iteration-1-run-2");
  });

  test("dashes already in directory names are preserved", () => {
    expect(deriveRunId("/w", "/w/iteration-1/eval-a/run-1")).toBe("iteration-1-eval-a-run-1");
  });
});

// ---------------------------------------------------------------------------
// MIME table
// ---------------------------------------------------------------------------

describe("getMimeType", () => {
  test.each([
    [".html", "text/html"],
    [".css", "text/css"],
    [".js", "text/javascript"],
    [".json", "application/json"],
    [".md", "text/markdown"],
    [".txt", "text/plain"],
    [".csv", "text/csv"],
    [".png", "image/png"],
    [".jpg", "image/jpeg"],
    [".gif", "image/gif"],
    [".svg", "image/svg+xml"],
    [".webp", "image/webp"],
    [".pdf", "application/pdf"],
    [".zip", "application/zip"],
  ])("maps %s to %s", (extension, expected) => {
    expect(getMimeType(`/tmp/output${extension}`)).toBe(expected);
  });

  test("maps the Office formats the original hard-coded as overrides", () => {
    expect(getMimeType("a.docx")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(getMimeType("a.xlsx")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(getMimeType("a.pptx")).toBe(
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    );
  });

  test("is case-insensitive on the extension", () => {
    expect(getMimeType("/tmp/CHART.PNG")).toBe("image/png");
  });

  test("falls back to octet-stream for unknown and absent extensions", () => {
    expect(getMimeType("/tmp/output.qqq")).toBe(DEFAULT_MIME_TYPE);
    expect(getMimeType("/tmp/README")).toBe(DEFAULT_MIME_TYPE);
    expect(getMimeType("/tmp/.gitignore")).toBe(DEFAULT_MIME_TYPE);
    expect(DEFAULT_MIME_TYPE).toBe("application/octet-stream");
  });

  test("only the final extension counts", () => {
    expect(getMimeType("/tmp/bundle.tar.gz")).toBe(DEFAULT_MIME_TYPE);
    expect(getMimeType("/tmp/report.draft.pdf")).toBe("application/pdf");
  });
});

describe("extensionOf", () => {
  test("matches the original's suffix semantics", () => {
    expect(extensionOf("report.pdf")).toBe(".pdf");
    expect(extensionOf("/a/b/REPORT.PDF")).toBe(".pdf");
    expect(extensionOf("bundle.tar.gz")).toBe(".gz");
    expect(extensionOf(".gitignore")).toBe("");
    expect(extensionOf("README")).toBe("");
    expect(extensionOf("archive.")).toBe("");
    expect(extensionOf("/a.b/plain")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

describe("parseCliOptions", () => {
  test("defaults the port to 3117 and leaves every other option unset", () => {
    const options = parseCliOptions(["/w"]);

    expect(options).toEqual({
      workspace: "/w",
      port: 3117,
      skillName: null,
      previousWorkspace: null,
      benchmark: null,
      staticPath: null,
      openBrowser: true,
      help: false,
    });
  });

  test("accepts every flag name carried over from the original", () => {
    const options = parseCliOptions([
      "/w",
      "--port",
      "4000",
      "--skill-name",
      "my-skill",
      "--previous-workspace",
      "/prev",
      "--benchmark",
      "/w/benchmark.json",
      "--static",
      "/out/review.html",
    ]);

    expect(options.port).toBe(4000);
    expect(options.skillName).toBe("my-skill");
    expect(options.previousWorkspace).toBe("/prev");
    expect(options.benchmark).toBe("/w/benchmark.json");
    expect(options.staticPath).toBe("/out/review.html");
  });

  test("accepts the short aliases and the equals form", () => {
    const options = parseCliOptions(["-p", "4100", "-n", "skill", "-s", "/out.html", "/w"]);

    expect(options).toMatchObject({
      workspace: "/w",
      port: 4100,
      skillName: "skill",
      staticPath: "/out.html",
    });
    expect(parseCliOptions(["/w", "--port=4200"]).port).toBe(4200);
  });

  test("every flag name and short alias the original had is still present", () => {
    // The point of this test is that no ORIGINAL flag was renamed or dropped -- the skill
    // body has those invocations written into it. Additions are a separate matter, so it
    // asserts a superset rather than an exact set: `--no-open` was added deliberately, and
    // an exact-set assertion would fail on every future addition without saying anything
    // about the thing it exists to protect.
    for (const flag of [
      "benchmark",
      "help",
      "port",
      "previous-workspace",
      "skill-name",
      "static",
    ]) {
      expect(Object.keys(CLI_SPEC)).toContain(flag);
    }
    expect(CLI_SPEC.port?.default).toBe(3117);
    expect(CLI_SPEC.port?.short).toBe("p");
    expect(CLI_SPEC["skill-name"]?.short).toBe("n");
    expect(CLI_SPEC.static?.short).toBe("s");
  });

  test("--help needs no workspace so help can always be shown", () => {
    expect(parseCliOptions(["--help"]).help).toBe(true);
    expect(parseCliOptions(["-h"]).help).toBe(true);
  });

  test("raises CliError rather than exiting, so the caller controls exit 2", () => {
    expect(() => parseCliOptions([])).toThrow(CliError);
    expect(() => parseCliOptions(["/w", "--nope"])).toThrow(CliError);
    expect(() => parseCliOptions(["/w", "/extra"])).toThrow(CliError);
    expect(() => parseCliOptions(["/w", "--port", "abc"])).toThrow(CliError);
  });

  test("rejects a non-integer port the shared parser would otherwise accept", () => {
    expect(() => parseCliOptions(["/w", "--port", "3.7"])).toThrow(CliError);
  });

  test("help text is rendered from the spec, so it cannot drift from parsing", () => {
    const help = formatHelp(USAGE, CLI_SPEC);

    expect(help).toContain("--port, -p");
    expect(help).toContain("(default: 3117)");
    expect(help).toContain("--previous-workspace");
    expect(help).toContain("--static, -s");
  });
});

// ---------------------------------------------------------------------------
// Discovery against a real workspace tree
// ---------------------------------------------------------------------------

describe("findRuns", () => {
  const workspace = `${process.env.TMPDIR ?? "/tmp"}/skill-creator-viewer-${crypto.randomUUID()}`;
  const iteration = `${workspace}/iteration-1`;

  beforeAll(async () => {
    // Eval "b" sorts before "a" by name but has the higher eval_id, so the
    // eval_id-then-id ordering is observable.
    await Bun.write(`${iteration}/b-charts/eval_metadata.json`, JSON.stringify({ eval_id: 2 }));
    await Bun.write(`${iteration}/b-charts/with_skill/outputs/chart.png`, new Uint8Array([1, 2, 3]));
    await Bun.write(`${iteration}/b-charts/with_skill/transcript.md`, "## Eval Prompt\n\nMake a chart.\n\n## Notes\n\nignored\n");
    await Bun.write(`${iteration}/b-charts/without_skill/outputs/chart.png`, new Uint8Array([4]));

    await Bun.write(
      `${iteration}/a-summary/eval_metadata.json`,
      JSON.stringify({ eval_id: 1, prompt: "Summarize the report." }),
    );
    await Bun.write(`${iteration}/a-summary/with_skill/outputs/summary.md`, "# Summary\n");
    await Bun.write(`${iteration}/a-summary/with_skill/outputs/transcript.md`, "excluded metadata");
    await Bun.write(`${iteration}/a-summary/with_skill/outputs/metrics.json`, "{}");
    await Bun.write(`${iteration}/a-summary/with_skill/outputs/blob.bin`, new Uint8Array([255, 0]));
    await Bun.write(
      `${iteration}/a-summary/with_skill/grading.json`,
      JSON.stringify({ summary: { pass_rate: 1 } }),
    );

    // Directories the walker must never descend into.
    await Bun.write(`${iteration}/inputs/outputs/decoy.txt`, "not a run");
    await Bun.write(`${iteration}/skill/outputs/decoy.txt`, "not a run");
    await Bun.write(`${iteration}/node_modules/pkg/outputs/decoy.txt`, "not a run");
  });

  afterAll(async () => {
    await Bun.$`rm -rf ${workspace}`.quiet();
  });

  test("discovers exactly the directories holding outputs/, skipping the decoys", async () => {
    const runs = await findRuns(workspace);

    expect(runs.map((r) => r.id)).toEqual([
      "iteration-1-a-summary-with_skill",
      "iteration-1-b-charts-with_skill",
      "iteration-1-b-charts-without_skill",
    ]);
  });

  test("discovered ids are exactly what deriveRunId produces for those paths", async () => {
    const runs = await findRuns(workspace);

    expect(runs.map((r) => r.id)).toEqual([
      deriveRunId(workspace, `${iteration}/a-summary/with_skill`),
      deriveRunId(workspace, `${iteration}/b-charts/with_skill`),
      deriveRunId(workspace, `${iteration}/b-charts/without_skill`),
    ]);
  });

  test("reads the prompt from eval_metadata.json when present", async () => {
    const runs = await findRuns(workspace);

    expect(runs[0]?.prompt).toBe("Summarize the report.");
    expect(runs[0]?.eval_id).toBe(1);
  });

  test("falls back to the transcript's Eval Prompt section", async () => {
    const runs = await findRuns(workspace);

    expect(runs[1]?.prompt).toBe("Make a chart.");
  });

  test("uses the sentinel prompt when neither source has one", async () => {
    const runs = await findRuns(workspace);

    expect(runs[2]?.prompt).toBe("(No prompt found)");
  });

  test("excludes metadata files from outputs", async () => {
    const runs = await findRuns(workspace);

    expect(runs[0]?.outputs.map((f) => f.name)).toEqual(["blob.bin", "summary.md"]);
  });

  test("embeds text inline and binaries as base64 data URIs", async () => {
    const runs = await findRuns(workspace);
    const [blob, summary] = runs[0]?.outputs ?? [];

    expect(summary).toEqual({ name: "summary.md", type: "text", content: "# Summary\n" });
    expect(blob).toEqual({
      name: "blob.bin",
      type: "binary",
      mime: "application/octet-stream",
      data_uri: "data:application/octet-stream;base64,/wA=",
    });
  });

  test("embeds images with their image mime type", async () => {
    const runs = await findRuns(workspace);
    const [chart] = runs[1]?.outputs ?? [];

    expect(chart).toEqual({
      name: "chart.png",
      type: "image",
      mime: "image/png",
      data_uri: "data:image/png;base64,AQID",
    });
  });

  test("attaches grading.json when the run directory has one", async () => {
    const runs = await findRuns(workspace);

    expect(runs[0]?.grading).toEqual({ summary: { pass_rate: 1 } });
    expect(runs[1]?.grading).toBeNull();
  });

  test("previous-iteration load joins feedback to runs on the run id", async () => {
    await Bun.write(
      `${workspace}/feedback.json`,
      JSON.stringify({
        reviews: [
          { run_id: "iteration-1-a-summary-with_skill", feedback: "too terse" },
          { run_id: "iteration-1-deleted-run", feedback: "kept anyway" },
          { run_id: "iteration-1-b-charts-with_skill", feedback: "   " },
        ],
      }),
    );

    const previous = await loadPreviousIteration(workspace);

    expect(previous.get("iteration-1-a-summary-with_skill")?.feedback).toBe("too terse");
    expect(previous.get("iteration-1-b-charts-with_skill")?.feedback).toBe("");
    expect(previous.get("iteration-1-deleted-run")).toEqual({ feedback: "kept anyway", outputs: [] });
  });
});
