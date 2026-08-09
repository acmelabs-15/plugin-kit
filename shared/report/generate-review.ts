#!/usr/bin/env bun
/**
 * Generate and serve a review page for eval results.
 *
 * Reads the workspace directory, discovers runs (directories with outputs/),
 * embeds all output data into a self-contained HTML page, and serves it via
 * a tiny HTTP server. Feedback auto-saves to feedback.json in the workspace.
 *
 * Usage:
 *     bun run generate-review.ts <workspace-path> [--port PORT] [--skill-name NAME]
 *     bun run generate-review.ts <workspace-path> --previous-workspace /path/to/old
 *
 * Nothing beyond the Bun runtime is required.
 *
 * The eval workspace is a sibling of the skill directory. Inside it are
 * iteration subdirectories, each holding descriptively-named per-eval
 * directories, each holding per-run configuration subdirectories. A
 * directory is a run exactly when it contains an `outputs/` subdirectory.
 */

import { CliError, formatHelp, parseArgs, type Spec } from "../cli.ts";
import { extensionOf, getMimeType } from "../util/mime.ts";
import { injectAppBar } from "./app-bar.ts";
import { DASHBOARD_PORT, ensureDashboard, openInBrowser } from "../util/browser.ts";
import { ProgressReporter } from "../util/progress.ts";

/** Files to exclude from output listings */
const METADATA_FILES: ReadonlySet<string> = new Set([
  "transcript.md",
  "user_notes.md",
  "metrics.json",
]);

/**
 * Extensions we render as inline text.
 *
 * Preserved verbatim from the original. These are the extensions of files an
 * eval run may PRODUCE, so the list is data about eval outputs, not about
 * this script's own toolchain.
 */
const TEXT_EXTENSIONS: ReadonlySet<string> = new Set([
  ".txt", ".md", ".json", ".csv", ".py", ".js", ".ts", ".tsx", ".jsx",
  ".yaml", ".yml", ".xml", ".html", ".css", ".sh", ".rb", ".go", ".rs",
  ".java", ".c", ".cpp", ".h", ".hpp", ".sql", ".r", ".toml",
]);

/** Extensions we render as inline images */
const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp",
]);

/**
 * Directory names never descended into during run discovery. Preserved
 * verbatim from the original -- these are names that appear inside eval
 * workspaces, and dropping any one of them would change which directories
 * are reported as runs.
 */
const SKIP_DIRECTORIES: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  "__pycache__",
  "skill",
  "inputs",
]);

/** Comment token in viewer.html replaced with the embedded data assignment. */
const EMBEDDED_DATA_TOKEN = "/*__EMBEDDED_DATA__*/";

const DEFAULT_PORT = 3117;

const TEXT_ENCODER = new TextEncoder();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EmbeddedFile =
  | { readonly name: string; readonly type: "text"; readonly content: string }
  | { readonly name: string; readonly type: "error"; readonly content: string }
  | {
      readonly name: string;
      readonly type: "image" | "binary";
      readonly mime: string;
      readonly data_uri: string;
    }
  | { readonly name: string; readonly type: "pdf"; readonly data_uri: string }
  | { readonly name: string; readonly type: "xlsx"; readonly data_b64: string };

/** One discovered run. Field names are the viewer's data contract. */
export type Run = {
  readonly id: string;
  readonly prompt: string;
  readonly eval_id: unknown;
  readonly outputs: readonly EmbeddedFile[];
  readonly grading: unknown;
};

/** Previous-iteration context for a single run id. */
export type PreviousEntry = {
  readonly feedback: string;
  readonly outputs: readonly EmbeddedFile[];
};

/**
 * The object injected into viewer.html. The viewer reads exactly these five
 * top-level keys; `benchmark` is omitted when there is no benchmark data.
 */
export type EmbeddedPayload = {
  readonly skill_name: string;
  readonly runs: readonly Run[];
  readonly previous_feedback: Readonly<Record<string, string>>;
  readonly previous_outputs: Readonly<Record<string, readonly EmbeddedFile[]>>;
  readonly benchmark?: unknown;
};

type ServerContext = {
  readonly workspace: string;
  readonly skillName: string;
  readonly feedbackPath: string;
  readonly previous: ReadonlyMap<string, PreviousEntry>;
  readonly benchmarkPath: string | null;
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Truthiness as the original evaluated it: empty containers and empty strings
 * are false. Load-bearing for `benchmark` (an empty object must not be
 * injected) and for grading fallback (an empty grading.json must not stop the
 * search at the run directory).
 */
function isNonEmpty(value: unknown): boolean {
  if (value === null || value === undefined || value === false) return false;
  if (typeof value === "string") return value.length > 0;
  if (typeof value === "number") return value !== 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

/** Code-point ordering, matching the original's string comparison. */
function compareStrings(a: string, b: string): number {
  if (a === b) return 0;
  const left = Array.from(a);
  const right = Array.from(b);
  const shared = Math.min(left.length, right.length);
  for (let i = 0; i < shared; i += 1) {
    const l = left[i];
    const r = right[i];
    if (l === undefined || r === undefined) break;
    const lc = l.codePointAt(0) ?? 0;
    const rc = r.codePointAt(0) ?? 0;
    if (lc !== rc) return lc < rc ? -1 : 1;
  }
  if (left.length === right.length) return 0;
  return left.length < right.length ? -1 : 1;
}

function baseName(path: string): string {
  const separator = path.lastIndexOf("/");
  return separator < 0 ? path : path.slice(separator + 1);
}

function parentOf(path: string): string {
  const separator = path.lastIndexOf("/");
  if (separator < 0) return ".";
  if (separator === 0) return "/";
  return path.slice(0, separator);
}

/**
 * Absolute, normalized path. Unlike the original this does not resolve
 * symlinks -- Bun exposes no realpath without a Node import. Discovery walks
 * downward from this path, so run ids are unaffected; only the default skill
 * name (taken from the final path segment) can differ, and only when the
 * workspace argument is itself a symlink.
 */
function resolvePath(input: string): string {
  const raw = input.startsWith("/") ? input : `${process.cwd()}/${input}`;
  const segments: string[] = [];
  for (const part of raw.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      segments.pop();
      continue;
    }
    segments.push(part);
  }
  return `/${segments.join("/")}`;
}

// ---------------------------------------------------------------------------
// Filesystem
// ---------------------------------------------------------------------------

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await Bun.file(path).stat()).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Best-effort skill name from a workspace path, for the page header.
 *
 * The old derivation stripped a `-workspace` suffix, which was right when a workspace was
 * a sibling of the skill directory. Eval evidence now lives at `evals/results/iteration-N`,
 * so that produced "iteration-3" as a skill name -- masked only because every documented
 * invocation passes `--skill-name`.
 *
 * Walks up past iteration and results markers to the first segment that could plausibly be
 * a name, and returns "" rather than a guess when there is none. The viewer already treats
 * "" as "use the fallback", so an honest blank beats a confident wrong answer in a header.
 */
export function deriveSkillName(workspace: string): string {
  const ignored = /^(iteration|run|eval)[-_]?\d*$|^(results|evals|workspace|tmp|temp)$/i;
  const segments = workspace.split("/").filter((segment) => segment !== "");
  for (const segment of segments.reverse()) {
    const cleaned = segment.replaceAll("-workspace", "");
    if (cleaned !== "" && !ignored.test(cleaned)) return cleaned;
  }
  return "";
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await Bun.file(path).stat()).isFile();
  } catch {
    return false;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await Bun.file(path).stat();
    return true;
  } catch {
    return false;
  }
}

/** Immediate children of a directory, dotfiles included, sorted by name. */
async function listChildren(directory: string): Promise<readonly string[]> {
  const names: string[] = [];
  try {
    const glob = new Bun.Glob("*");
    for await (const name of glob.scan({ cwd: directory, onlyFiles: false, dot: true })) {
      names.push(name);
    }
  } catch {
    return [];
  }
  return names.sort(compareStrings);
}

async function readJson(path: string): Promise<unknown> {
  try {
    return await Bun.file(path).json();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Run discovery
// ---------------------------------------------------------------------------

/**
 * Run id: the run directory's path relative to the workspace root with both
 * separators flattened to dashes. This is the JOIN KEY against feedback.json,
 * so the derivation must not drift.
 */
export function deriveRunId(root: string, runDir: string): string {
  const prefix = root.endsWith("/") ? root : `${root}/`;
  const relative = runDir === root ? "." : runDir.startsWith(prefix) ? runDir.slice(prefix.length) : runDir;
  return relative.replaceAll("/", "-").replaceAll("\\", "-");
}

/** Recursively find directories that contain an outputs/ subdirectory. */
export async function findRuns(workspace: string): Promise<readonly Run[]> {
  const runs: Run[] = [];
  await collectRuns(workspace, workspace, runs);
  runs.sort(compareRuns);
  return runs;
}

async function collectRuns(root: string, current: string, runs: Run[]): Promise<void> {
  if (!(await isDirectory(current))) return;

  if (await isDirectory(`${current}/outputs`)) {
    runs.push(await buildRun(root, current));
    return;
  }

  for (const name of await listChildren(current)) {
    if (SKIP_DIRECTORIES.has(name)) continue;
    const child = `${current}/${name}`;
    if (await isDirectory(child)) await collectRuns(root, child, runs);
  }
}

/**
 * Sort by eval_id, then run id. A run with no numeric eval_id sorts last,
 * which is what the original's `float("inf")` default intended.
 */
function compareRuns(a: Run, b: Run): number {
  const left = evalSortKey(a);
  const right = evalSortKey(b);
  if (left !== right) return left < right ? -1 : 1;
  return compareStrings(a.id, b.id);
}

function evalSortKey(run: Run): number {
  return typeof run.eval_id === "number" ? run.eval_id : Number.POSITIVE_INFINITY;
}

/** Build a run with prompt, outputs, and grading data. */
async function buildRun(root: string, runDir: string): Promise<Run> {
  const metadata = await readEvalMetadata(runDir);
  let prompt = metadata.prompt;
  if (!prompt) prompt = await readPromptFromTranscript(runDir);
  if (!prompt) prompt = "(No prompt found)";

  return {
    id: deriveRunId(root, runDir),
    prompt,
    eval_id: metadata.evalId,
    outputs: await collectOutputs(`${runDir}/outputs`),
    grading: await readGrading(runDir),
  };
}

async function readEvalMetadata(runDir: string): Promise<{ prompt: string; evalId: unknown }> {
  let prompt = "";
  let evalId: unknown = null;

  for (const candidate of [
    `${runDir}/eval_metadata.json`,
    `${parentOf(runDir)}/eval_metadata.json`,
  ]) {
    if (!(await pathExists(candidate))) continue;
    const metadata = await readJson(candidate);
    if (isRecord(metadata)) {
      prompt = typeof metadata.prompt === "string" ? metadata.prompt : "";
      evalId = metadata.eval_id ?? null;
    }
    if (prompt) break;
  }

  return { prompt, evalId };
}

/**
 * `$` here is deliberately un-anchored to line ends. The original's `$`
 * additionally matched before a single trailing newline, but the captured
 * text is trimmed either way, so the results are identical.
 */
const EVAL_PROMPT_PATTERN = /## Eval Prompt\n\n([\s\S]*?)(?=\n##|$)/;

async function readPromptFromTranscript(runDir: string): Promise<string> {
  for (const candidate of [`${runDir}/transcript.md`, `${runDir}/outputs/transcript.md`]) {
    if (!(await pathExists(candidate))) continue;
    let prompt = "";
    try {
      const match = EVAL_PROMPT_PATTERN.exec(await Bun.file(candidate).text());
      const captured = match?.[1];
      if (captured !== undefined) prompt = captured.trim();
    } catch {
      // Unreadable transcript -- fall through to the next candidate.
    }
    if (prompt) return prompt;
  }
  return "";
}

async function collectOutputs(outputsDir: string): Promise<readonly EmbeddedFile[]> {
  if (!(await isDirectory(outputsDir))) return [];

  const files: EmbeddedFile[] = [];
  for (const name of await listChildren(outputsDir)) {
    if (METADATA_FILES.has(name)) continue;
    const path = `${outputsDir}/${name}`;
    if (!(await isFile(path))) continue;
    files.push(await embedFile(path));
  }
  return files;
}

/**
 * An unparseable grading.json leaves the previous candidate's value in place,
 * and an EMPTY one does not stop the search -- both match the original.
 */
async function readGrading(runDir: string): Promise<unknown> {
  let grading: unknown = null;
  for (const candidate of [`${runDir}/grading.json`, `${parentOf(runDir)}/grading.json`]) {
    if (!(await pathExists(candidate))) continue;
    try {
      grading = await Bun.file(candidate).json();
    } catch {
      // Keep whatever the earlier candidate yielded.
    }
    if (isNonEmpty(grading)) break;
  }
  return grading;
}

// ---------------------------------------------------------------------------
// File embedding
// ---------------------------------------------------------------------------

/** Read a file and return the embedded representation the viewer consumes. */
async function embedFile(path: string): Promise<EmbeddedFile> {
  const name = baseName(path);
  const extension = extensionOf(path);
  const mime = getMimeType(path);

  if (TEXT_EXTENSIONS.has(extension)) {
    return { name, type: "text", content: await readTextLossy(path) };
  }

  const base64 = await readBase64(path);
  if (base64 === null) return { name, type: "error", content: "(Error reading file)" };

  if (IMAGE_EXTENSIONS.has(extension)) {
    return { name, type: "image", mime, data_uri: `data:${mime};base64,${base64}` };
  }
  if (extension === ".pdf") {
    return { name, type: "pdf", data_uri: `data:${mime};base64,${base64}` };
  }
  if (extension === ".xlsx") {
    return { name, type: "xlsx", data_b64: base64 };
  }
  return { name, type: "binary", mime, data_uri: `data:${mime};base64,${base64}` };
}

/** UTF-8 decode with replacement characters, as the original did. */
async function readTextLossy(path: string): Promise<string> {
  try {
    return await Bun.file(path).text();
  } catch {
    return "(Error reading file)";
  }
}

async function readBase64(path: string): Promise<string | null> {
  try {
    return (await Bun.file(path).bytes()).toBase64();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Previous iteration
// ---------------------------------------------------------------------------

/** Load the previous iteration's feedback and outputs, keyed by run id. */
export async function loadPreviousIteration(
  workspace: string,
): Promise<ReadonlyMap<string, PreviousEntry>> {
  const result = new Map<string, PreviousEntry>();
  const feedbackByRun = await readFeedbackFile(`${workspace}/feedback.json`);

  for (const run of await findRuns(workspace)) {
    result.set(run.id, { feedback: feedbackByRun.get(run.id) ?? "", outputs: run.outputs });
  }

  // Feedback can outlive its run directory; keep it so the viewer still shows it.
  for (const [runId, feedback] of feedbackByRun) {
    if (!result.has(runId)) result.set(runId, { feedback, outputs: [] });
  }

  return result;
}

async function readFeedbackFile(path: string): Promise<ReadonlyMap<string, string>> {
  if (!(await pathExists(path))) return new Map();

  const data = await readJson(path);
  if (!isRecord(data) || !Array.isArray(data.reviews)) return new Map();

  const feedbackByRun = new Map<string, string>();
  for (const review of data.reviews) {
    if (!isRecord(review)) return new Map();
    const runId = review.run_id;
    const feedback = review.feedback;
    if (typeof feedback !== "string" || feedback.trim() === "") continue;
    if (typeof runId !== "string") return new Map();
    feedbackByRun.set(runId, feedback);
  }
  return feedbackByRun;
}

// ---------------------------------------------------------------------------
// HTML generation
// ---------------------------------------------------------------------------

/** Assemble the object injected into the viewer. */
export function buildEmbeddedPayload(
  runs: readonly Run[],
  skillName: string,
  previous: ReadonlyMap<string, PreviousEntry>,
  benchmark: unknown,
): EmbeddedPayload {
  const previousFeedback: Record<string, string> = {};
  const previousOutputs: Record<string, readonly EmbeddedFile[]> = {};

  for (const [runId, entry] of previous) {
    if (isNonEmpty(entry.feedback)) previousFeedback[runId] = entry.feedback;
    if (isNonEmpty(entry.outputs)) previousOutputs[runId] = entry.outputs;
  }

  const base = {
    skill_name: skillName,
    runs,
    previous_feedback: previousFeedback,
    previous_outputs: previousOutputs,
  };
  return isNonEmpty(benchmark) ? { ...base, benchmark } : base;
}

/** Generate the complete standalone HTML page with embedded data. */
export async function generateHtml(
  runs: readonly Run[],
  skillName: string,
  previous: ReadonlyMap<string, PreviousEntry>,
  benchmark: unknown,
): Promise<string> {
  const template = await Bun.file(`${import.meta.dir}/viewer.html`).text();
  return injectEmbeddedData(template, buildEmbeddedPayload(runs, skillName, previous, benchmark));
}

/**
 * Serialize a payload for embedding inside an inline `<script>` block.
 *
 * DELIBERATE FIX, not a port bug. The original interpolated raw
 * `json.dumps(...)`, so an eval output containing the literal text
 * `</script>` terminated the script element early and broke the entire page --
 * and eval outputs are arbitrary user content, so this is reachable rather than
 * theoretical. It is also the most confusing possible failure, because the
 * viewer renders blank with no error pointing at the data.
 *
 * The escapes below are `\uXXXX` sequences, which JSON decodes back to the
 * identical characters. The parsed value is therefore unchanged and the data
 * contract is preserved exactly; only the bytes on the wire differ, and only
 * for content that would otherwise have broken the page.
 *
 * U+2028 and U+2029 are included because they are legal in JSON strings but
 * were line terminators in JavaScript before ES2019, which is the same class of
 * bug reached through a different door.
 */
function serializeForScriptTag(payload: EmbeddedPayload): string {
  return JSON.stringify(payload).replace(
    /[<>&\u2028\u2029]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

/**
 * Replace the comment token with the data assignment. The function-valued
 * replacement is required: a `$&` or `$1` inside the serialized JSON would
 * otherwise be interpreted as a substitution pattern and corrupt the output.
 */
export function injectEmbeddedData(template: string, payload: EmbeddedPayload): string {
  const dataJson = serializeForScriptTag(payload);
  return template.replaceAll(EMBEDDED_DATA_TOKEN, () => `const EMBEDDED_DATA = ${dataJson};`);
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

/**
 * Serves the review HTML and handles feedback saves.
 *
 * Regenerates the HTML on each page load so that refreshing the browser
 * picks up new eval outputs without restarting the server.
 */
async function handleRequest(request: Request, context: ServerContext): Promise<Response> {
  const path = new URL(request.url).pathname;

  if (request.method === "GET") {
    if (path === "/" || path === "/index.html") return await serveViewer(context);
    if (path === "/api/feedback") return await serveFeedback(context);
  }
  if (request.method === "POST" && path === "/api/feedback") {
    return await saveFeedback(request, context);
  }
  return new Response("Not Found", { status: 404 });
}

async function serveViewer(context: ServerContext): Promise<Response> {
  const runs = await findRuns(context.workspace);
  const benchmark = await readBenchmark(context.benchmarkPath);
  const generated = await generateHtml(runs, context.skillName, context.previous, benchmark);
  // Same bar as every other surface. This viewer runs on its own port, so the bar is told
  // where the dashboard lives -- otherwise its feed and links would resolve against 3117,
  // which serves neither.
  const html = injectAppBar(generated, {
    title: `${context.skillName} — eval review`,
    active: "report",
    runningCount: 0,
    refreshSeconds: 5,
    feedOrigin: `http://localhost:${DASHBOARD_PORT}`,
  });
  const body = TEXT_ENCODER.encode(html);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Length": String(body.byteLength),
    },
  });
}

async function serveFeedback(context: ServerContext): Promise<Response> {
  const file = Bun.file(context.feedbackPath);
  const body = (await file.exists()) ? await file.bytes() : TEXT_ENCODER.encode("{}");
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Length": String(body.byteLength),
    },
  });
}

async function saveFeedback(request: Request, context: ServerContext): Promise<Response> {
  try {
    const data: unknown = await request.json();
    if (!isRecord(data) || !("reviews" in data)) {
      throw new Error("Expected JSON object with 'reviews' key");
    }
    await Bun.write(context.feedbackPath, `${JSON.stringify(data, null, 2)}\n`);
    return jsonResponse('{"ok":true}', 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse(JSON.stringify({ error: message }), 500);
  }
}

function jsonResponse(body: string, status: number): Response {
  const bytes = TEXT_ENCODER.encode(body);
  return new Response(bytes, {
    status,
    headers: {
      "Content-Type": "application/json",
      "Content-Length": String(bytes.byteLength),
    },
  });
}

async function readBenchmark(benchmarkPath: string | null): Promise<unknown> {
  if (benchmarkPath === null || !(await pathExists(benchmarkPath))) return null;
  return await readJson(benchmarkPath);
}

// ---------------------------------------------------------------------------
// Port reclamation and browser launch
// ---------------------------------------------------------------------------

/** Terminate any process listening on the given port. */
async function reclaimPort(port: number): Promise<void> {
  let stdout: string;
  try {
    const proc = Bun.spawn(["lsof", "-ti", `:${port}`], {
      stdout: "pipe",
      stderr: "ignore",
      timeout: 5_000,
    });
    stdout = await new Response(proc.stdout).text();
    await proc.exited;
  } catch {
    console.error("Note: lsof not found, cannot check if port is in use");
    return;
  }

  if (stdout.trim() === "") return;
  for (const line of stdout.trim().split("\n")) {
    const pid = Number.parseInt(line.trim(), 10);
    if (!Number.isInteger(pid)) continue;
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Process already gone.
    }
  }
  await Bun.sleep(500);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export type CliOptions = {
  readonly workspace: string;
  readonly port: number;
  readonly skillName: string | null;
  readonly previousWorkspace: string | null;
  readonly benchmark: string | null;
  readonly staticPath: string | null;
  readonly openBrowser: boolean;
  readonly help: boolean;
};

export const USAGE = "usage: generate-review.ts [options] <workspace-path>";

/**
 * Flag names and defaults are carried over verbatim from the original's
 * argument parser, including the short aliases -p, -n and -s. Renaming any of
 * them would break the invocations already written into the skill body.
 */
export const CLI_SPEC: Spec = {
  port: { kind: "number", short: "p", default: DEFAULT_PORT, help: "Server port" },
  "skill-name": { kind: "string", short: "n", help: "Skill name for the header" },
  "previous-workspace": {
    kind: "string",
    help: "Previous iteration's workspace, shown as context",
  },
  benchmark: { kind: "string", help: "benchmark.json to show in the Benchmark tab" },
  static: {
    kind: "string",
    short: "s",
    help: "Write standalone HTML here instead of serving",
  },
  "no-open": { kind: "boolean", default: false, help: "Do not open a browser window" },
  help: { kind: "boolean", short: "h", help: "Show this help message and exit" },
};

/** Parse argv into viewer options. Throws {@link CliError} on malformed input. */
export function parseCliOptions(argv: string[]): CliOptions {
  const { flags, positionals } = parseArgs(argv, CLI_SPEC);
  const help = flags.help === true;

  return {
    workspace: help ? "" : requireWorkspace(positionals),
    port: readPort(flags.port),
    skillName: readString(flags["skill-name"]),
    previousWorkspace: readString(flags["previous-workspace"]),
    benchmark: readString(flags.benchmark),
    staticPath: readString(flags.static),
    openBrowser: flags["no-open"] !== true,
    help,
  };
}

function requireWorkspace(positionals: readonly string[]): string {
  const [workspace, ...extra] = positionals;
  if (workspace === undefined) throw new CliError("the following arguments are required: workspace");
  if (extra.length > 0) throw new CliError(`unrecognized arguments: ${extra.join(" ")}`);
  return workspace;
}

/** The shared parser accepts any finite number; the port must be a whole one. */
function readPort(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new CliError(`--port expects an integer, got: ${String(value)}`);
  }
  return value;
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Exit 2 on a malformed flag, distinct from the exit 1 the viewer uses for
 * workspace problems -- so a mistyped flag is never read as a viewer failure.
 */
function readOptionsOrExit(argv: string[]): CliOptions {
  try {
    return parseCliOptions(argv);
  } catch (error) {
    if (!(error instanceof CliError)) throw error;
    console.error(formatHelp(USAGE, CLI_SPEC));
    console.error(`generate-review.ts: error: ${error.message}`);
    process.exit(2);
  }
}

async function main(): Promise<void> {
  const args = readOptionsOrExit(Bun.argv.slice(2));
  if (args.help) {
    console.log(formatHelp(USAGE, CLI_SPEC));
    process.exit(0);
  }

  const workspace = resolvePath(args.workspace);
  if (!(await isDirectory(workspace))) {
    console.error(`Error: ${workspace} is not a directory`);
    process.exit(1);
  }

  // Discovery walks the whole workspace and base64-embeds every output file, which on a
  // benchmark workspace is the slow part and prints nothing while it runs. Started
  // before the walk so the dashboard shows the run during it, not after.
  const reporter = ProgressReporter.start({
    kind: "review",
    label: `review — ${baseName(workspace)}`,
    total: 0,
    subject: baseName(workspace),
    detail: { phase: "discovering runs" },
    // Ctrl-C is how SKILL.md says to stop this viewer, so a signal is its normal end
    // rather than a failure. Without this a documented shutdown showed a red row.
    signalMeans: "done",
  });

  // This is on the MAIN eval path -- SKILL.md tells the reader to launch this detached --
  // so a status file with nothing displaying it is the common case rather than the edge.
  // Idempotent by probe, so it reuses a dashboard another run already started.
  await ensureDashboard();

  let runs: readonly Run[];
  try {
    runs = await findRuns(workspace);
  } catch (error) {
    await reporter.finish("failed", error instanceof Error ? error.message : String(error));
    throw error;
  }
  if (runs.length === 0) {
    // Recorded as failed rather than left running: the process is about to exit, and a
    // `running` status with nothing behind it would sit there until it went stale.
    await reporter.finish("failed", `No runs found in ${workspace}`);
    console.error(`No runs found in ${workspace}`);
    process.exit(1);
  }
  reporter.update({ phase: "serving" }, { total: runs.length, settled: runs.length });

  // A workspace is now an iteration directory (`evals/results/iteration-N`), so the old
  // derivation yields "iteration-3" rather than a skill name. Walk up for a segment that
  // is not an iteration marker, and fall back to a placeholder the header can show
  // without asserting something false.
  const skillName = args.skillName ?? deriveSkillName(workspace);
  const feedbackPath = `${workspace}/feedback.json`;
  const previous =
    args.previousWorkspace === null
      ? new Map<string, PreviousEntry>()
      : await loadPreviousIteration(resolvePath(args.previousWorkspace));
  const benchmarkPath = args.benchmark === null ? null : resolvePath(args.benchmark);
  const benchmark = await readBenchmark(benchmarkPath);

  if (args.staticPath !== null) {
    const html = await generateHtml(runs, skillName, previous, benchmark);
    await Bun.write(args.staticPath, html);
    await reporter.finish("done");
    console.log(`\n  Static viewer written to: ${args.staticPath}\n`);
    process.exit(0);
  }

  const context: ServerContext = { workspace, skillName, feedbackPath, previous, benchmarkPath };
  // The server runs until interrupted, so the status stays `running` and its heartbeat
  // is what keeps it live on the dashboard. `serve` marks it done on SIGINT.
  await serve(context, args, previous.size, reporter);
}

async function serve(
  context: ServerContext,
  args: CliOptions,
  previousCount: number,
  reporter: ProgressReporter,
): Promise<void> {
  await reclaimPort(args.port);

  const handler = (request: Request): Promise<Response> => handleRequest(request, context);
  let server: ReturnType<typeof Bun.serve>;
  try {
    server = Bun.serve({ port: args.port, hostname: "127.0.0.1", fetch: handler });
  } catch {
    // Port still in use after the reclaim attempt -- take an ephemeral one.
    server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: handler });
  }

  const url = `http://localhost:${server.port}`;
  // This script serves its own page, so the dashboard redirects to it rather than
  // reproducing it. Recorded after `Bun.serve` returns, when the port is actually known
  // -- an ephemeral fallback port would otherwise be recorded wrong.
  reporter.update({ externalUrl: url });
  console.log("\n  Eval Viewer");
  console.log("  ─────────────────────────────────");
  console.log(`  URL:       ${url}`);
  console.log(`  Workspace: ${context.workspace}`);
  console.log(`  Feedback:  ${context.feedbackPath}`);
  if (previousCount > 0) console.log(`  Previous:  ${args.previousWorkspace} (${previousCount} runs)`);
  if (context.benchmarkPath !== null) console.log(`  Benchmark: ${context.benchmarkPath}`);
  console.log("\n  Press Ctrl+C to stop.\n");

  if (args.openBrowser) openInBrowser(url);

  // The reporter's own SIGINT handler records `done` (see `signalMeans`) and re-raises,
  // so this one only needs to stop the socket and say so. It must not call
  // `reporter.finish` -- listeners run in registration order, the reporter's is already
  // registered, and a second call is a no-op that only looked like it was doing the work.
  process.on("SIGINT", () => {
    console.log("\nStopped.");
    server.stop(true);
  });
}

if (import.meta.main) await main();
