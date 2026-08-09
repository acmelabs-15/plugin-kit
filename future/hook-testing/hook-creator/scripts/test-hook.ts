#!/usr/bin/env bun
/**
 * Payload harness for Claude Code hooks.
 *
 * A hook fires deterministically, so it can be tested rather than sampled. This
 * script is the mechanism: it feeds a synthetic event payload to a handler on
 * stdin and asserts the contract that handler is supposed to hold up -- exit
 * code, stdout JSON shape, stderr.
 *
 * Two ways to name the handler:
 *
 *   --command "<shell command>"     the shell form, as `sh -c` would run it
 *   --command bun --arg script.ts   the exec form, one argv element per --arg
 *   --config hooks/hooks.json       every command handler registered on the event
 *
 * Two ways to supply the payload:
 *
 *   --payload <file.json>           a payload you captured or wrote
 *   --fixture <EventName>           a realistic default for that event
 *
 * Exit codes are three-way, matching `validate-skill.ts`: 0 every expectation
 * passed, 1 at least one failed, 2 a usage error. A mistyped flag must never be
 * mistaken for a verdict about the hook.
 *
 * Usage: bun scripts/test-hook.ts --event <EventName> (--command <cmd> | --config <path>) [options]
 */

import {
  CliError,
  formatHelp,
  parseArgs,
  type ParsedArgs,
  type Spec,
} from "../../../../shared/scripts/lib/cli.ts";
import {
  DECISION_KEYS,
  EVENTS,
  EVENT_NAMES,
  NARROW_MATCHER_EVENTS,
  UNIVERSAL_OUTPUT_KEYS,
  buildFixture,
  matchesMatcher,
  type EventSpec,
} from "./lib/events.ts";

export { EVENTS, EVENT_NAMES, buildFixture, matchesMatcher };

// ---------------------------------------------------------------------------
// Running a handler
// ---------------------------------------------------------------------------

export interface HandlerSpec {
  /** Shell command, or the executable when `args` is present. */
  readonly command: string;
  /** Present means exec form: spawned directly, no shell, no tokenization. */
  readonly args?: readonly string[];
  readonly timeoutMs: number;
  /** How the handler is described in the report. */
  readonly label: string;
}

export interface RunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly durationMs: number;
}

/**
 * Substitute the path placeholders Claude Code resolves before spawning.
 *
 * Without this, testing a plugin's own `hooks.json` fails on the first
 * `${CLAUDE_PLUGIN_ROOT}` -- which would make the harness useless for exactly
 * the configuration most worth testing.
 */
export function substitutePlaceholders(
  text: string,
  vars: Readonly<Record<string, string>>,
): string {
  return text.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (whole, name: string) => vars[name] ?? whole);
}

function mergedEnv(extra: Readonly<Record<string, string>>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(Bun.env)) {
    if (value !== undefined) env[key] = value;
  }
  return { ...env, ...extra };
}

/**
 * Drain a stream, giving up promptly when the deadline fires.
 *
 * Killing the handler is not enough to end the read. A grandchild inherits the
 * stdout pipe, so the write end stays open after its parent dies and the
 * pending `read()` never settles -- `sh -c "sleep 30"` reproduces it exactly,
 * and a real handler that shells out to a linter has the same shape. Cancelling
 * our own reader is what actually bounds the wait.
 */
async function readAll(stream: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<string> {
  const reader = stream.getReader();
  const onAbort = (): void => {
    void reader.cancel().catch(() => undefined);
  };
  if (signal.aborted) onAbort();
  else signal.addEventListener("abort", onAbort, { once: true });

  const decoder = new TextDecoder();
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
  } catch {
    // Cancelled or errored mid-read: keep whatever arrived before that.
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
  return text;
}

/**
 * Run one handler with the payload on stdin.
 *
 * The deadline is enforced with an AbortController we own and a forced SIGKILL,
 * rather than Bun's soft `timeout` option: a handler that traps SIGTERM would
 * otherwise run past its limit and report as a normal exit, which is precisely
 * the failure mode a timeout assertion exists to catch.
 */
export async function runHandler(
  handler: HandlerSpec,
  payload: unknown,
  env: Readonly<Record<string, string>>,
): Promise<RunResult> {
  const cmd =
    handler.args === undefined
      ? ["sh", "-c", handler.command]
      : [handler.command, ...handler.args];

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, handler.timeoutMs);

  const started = Bun.nanoseconds();
  try {
    const proc = Bun.spawn(cmd, {
      stdin: new TextEncoder().encode(`${JSON.stringify(payload)}\n`),
      stdout: "pipe",
      stderr: "pipe",
      env: mergedEnv(env),
      signal: controller.signal,
    });
    controller.signal.addEventListener(
      "abort",
      () => {
        if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
      },
      { once: true },
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      readAll(proc.stdout, controller.signal),
      readAll(proc.stderr, controller.signal),
      proc.exited,
    ]);
    return {
      exitCode,
      stdout,
      stderr,
      timedOut,
      durationMs: Math.round((Bun.nanoseconds() - started) / 1e6),
    };
  } catch (error) {
    // A spawn failure is itself a finding -- "command not found" is the most
    // common way a hook does nothing -- so it is reported as a result rather
    // than thrown.
    return {
      exitCode: 127,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
      timedOut,
      durationMs: Math.round((Bun.nanoseconds() - started) / 1e6),
    };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Asserting the contract
// ---------------------------------------------------------------------------

export interface Assertion {
  readonly name: string;
  readonly passed: boolean;
  readonly note: string;
}

export interface Expectations {
  readonly exitCode?: number;
  readonly decision?: string;
}

/** The decision a handler effectively returned, normalised across both channels. */
export type EffectiveDecision = "none" | "allow" | "deny" | "ask" | "defer" | "block" | "error";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(text: string): { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: string } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Reduce a run to a single decision.
 *
 * `deny` and `block` are treated as the same answer when comparing against
 * `--expect-decision`, because they are the same answer: a PreToolUse hook that
 * exits 2 denies the call, and one that returns `permissionDecision: "deny"`
 * denies the same call by the other channel.
 */
export function effectiveDecision(result: RunResult, spec: EventSpec): EffectiveDecision {
  if (result.exitCode === 2) return spec.blocking === "blocks" || spec.blocking === "aborts" ? "block" : "none";
  if (result.exitCode !== 0) return "error";
  const trimmed = result.stdout.trim();
  if (!trimmed.startsWith("{")) return "none";
  const parsed = parseJson(trimmed);
  if (!parsed.ok || !isRecord(parsed.value)) return "none";
  const body = parsed.value;
  if (body["continue"] === false) return "block";
  const hso = body["hookSpecificOutput"];
  if (isRecord(hso) && typeof hso["permissionDecision"] === "string") {
    return hso["permissionDecision"] as EffectiveDecision;
  }
  if (isRecord(hso) && isRecord(hso["decision"]) && typeof hso["decision"]["behavior"] === "string") {
    return hso["decision"]["behavior"] === "deny" ? "deny" : "allow";
  }
  if (body["decision"] === "block") return "block";
  return "none";
}

function sameDecision(actual: EffectiveDecision, expected: string): boolean {
  const normalise = (d: string): string => (d === "deny" ? "block" : d);
  return normalise(actual) === normalise(expected);
}

const BLOCK_MODE_NOTE: Readonly<Record<EventSpec["blocking"], string>> = {
  blocks: "exit 2 stops the action",
  feedback: "the action already happened; exit 2 only shows stderr to Claude",
  ignored: "exit 2 is discarded on this event",
  aborts: "any non-zero exit aborts worktree creation",
  "user-only": "exit 2 shows stderr to the user; Claude never sees it",
};

/**
 * Check a run against the hook contract for its event.
 *
 * Every assertion here corresponds to a failure that is silent in production:
 * nothing warns you that your JSON went to stdout on exit 2, or that
 * `hookEventName` names the wrong event, or that the guard you wrote lives on
 * an event where exit 2 does nothing.
 */
export function checkContract(
  event: string,
  result: RunResult,
  expect: Expectations = {},
): readonly Assertion[] {
  const spec = EVENTS[event];
  if (spec === undefined) throw new CliError(`unknown hook event: ${event}`);
  const out: Assertion[] = [];
  const add = (name: string, passed: boolean, note: string): void => {
    out.push({ name, passed, note });
  };

  add(
    "handler completed within the timeout",
    !result.timedOut,
    result.timedOut
      ? "killed at the deadline. Claude Code cancels a hook the same way, and the handler's decision is lost"
      : `finished in ${result.durationMs} ms`,
  );

  if (expect.exitCode !== undefined) {
    add(
      `exit code is ${expect.exitCode}`,
      result.exitCode === expect.exitCode,
      `got ${result.exitCode}`,
    );
  } else {
    add(
      "exit code is 0 or 2",
      result.exitCode === 0 || result.exitCode === 2,
      result.exitCode === 0
        ? "0 — stdout is parsed for JSON"
        : result.exitCode === 2
          ? `2 — blocking error; ${BLOCK_MODE_NOTE[spec.blocking]}`
          : `${result.exitCode} — a non-blocking error. The action proceeds and the user sees a hook error notice`,
    );
  }

  if (result.exitCode === 2) {
    add(
      "exit 2 carries a reason on stderr",
      result.stderr.trim().length > 0,
      result.stderr.trim().length > 0
        ? `${result.stderr.trim().split("\n")[0] ?? ""}`
        : "stderr is empty, so the block arrives with no explanation attached",
    );
    const stdout = result.stdout.trim();
    add(
      "no JSON written to stdout on exit 2",
      !stdout.startsWith("{"),
      stdout.startsWith("{")
        ? "stdout holds JSON, and JSON is only read on exit 0. Whatever this decided was discarded — move the reason to stderr, or exit 0 and keep the JSON"
        : "stdout carries nothing that would be ignored",
    );
    add(
      "exit 2 does something on this event",
      spec.blocking !== "ignored",
      BLOCK_MODE_NOTE[spec.blocking],
    );
  }

  if (result.exitCode === 0 && result.stdout.trim().length > 0) {
    out.push(...checkStdout(event, spec, result.stdout));
  }

  if (expect.decision !== undefined) {
    const actual = effectiveDecision(result, spec);
    add(
      `decision is ${expect.decision}`,
      sameDecision(actual, expect.decision),
      `handler returned ${actual}`,
    );
  }

  return out;
}

/** Assertions that only apply to a successful run's stdout. */
function checkStdout(event: string, spec: EventSpec, stdout: string): readonly Assertion[] {
  const out: Assertion[] = [];
  const trimmed = stdout.trim();

  if (!trimmed.startsWith("{")) {
    const brace = trimmed.indexOf("\n{");
    out.push({
      name: "stdout contains nothing before the JSON",
      passed: brace === -1,
      note:
        brace === -1
          ? spec.stdoutIsContext
            ? "plain text, which this event adds to Claude's context"
            : "plain text, which goes to the debug log and no further on this event"
          : "there is text before the first `{`. Claude Code parses the whole of stdout, so a shell profile that echoes on startup breaks the JSON",
    });
    return out;
  }

  const parsed = parseJson(trimmed);
  out.push({
    name: "stdout parses as JSON",
    passed: parsed.ok,
    note: parsed.ok ? "valid JSON object" : parsed.error,
  });
  if (!parsed.ok || !isRecord(parsed.value)) return out;

  const body = parsed.value;
  const unknownTop = Object.keys(body).filter(
    (key) => !UNIVERSAL_OUTPUT_KEYS.includes(key) && key !== "decision" && key !== "reason",
  );
  out.push({
    name: "top-level output fields are recognised",
    passed: unknownTop.length === 0,
    note:
      unknownTop.length === 0
        ? "every key is one Claude Code reads"
        : `unrecognised: ${unknownTop.join(", ")}. An unknown key is dropped without a warning`,
  });

  if ("decision" in body) {
    out.push({
      name: `${event} reads a top-level \`decision\``,
      passed: spec.topLevelDecision,
      note: spec.topLevelDecision
        ? 'accepted; the only value is "block"'
        : `this event does not read a top-level decision. ${
            spec.decision === "preToolUse"
              ? "PreToolUse uses hookSpecificOutput.permissionDecision instead"
              : "the field is ignored"
          }`,
    });
    if (spec.topLevelDecision && body["decision"] === "block") {
      out.push({
        name: "a blocking decision carries a reason",
        passed: typeof body["reason"] === "string" && body["reason"].length > 0,
        note:
          typeof body["reason"] === "string" && body["reason"].length > 0
            ? "reason present"
            : "`reason` is what Claude is told; without it the block is unexplained",
      });
    }
  }

  const hso = body["hookSpecificOutput"];
  if (hso !== undefined) {
    out.push(...checkHookSpecificOutput(event, spec, hso));
  }
  return out;
}

function checkHookSpecificOutput(
  event: string,
  spec: EventSpec,
  hso: unknown,
): readonly Assertion[] {
  const out: Assertion[] = [];
  if (!isRecord(hso)) {
    out.push({
      name: "hookSpecificOutput is an object",
      passed: false,
      note: `got ${Array.isArray(hso) ? "array" : typeof hso}`,
    });
    return out;
  }

  out.push({
    name: "hookSpecificOutput.hookEventName matches the event",
    passed: hso["hookEventName"] === event,
    note:
      hso["hookEventName"] === event
        ? event
        : `got ${JSON.stringify(hso["hookEventName"])}, expected "${event}". A mismatch makes the whole object inert`,
  });

  const allowed = new Set(["hookEventName", ...DECISION_KEYS[spec.decision]]);
  const unknown = Object.keys(hso).filter((key) => !allowed.has(key));
  out.push({
    name: `hookSpecificOutput keys are read on ${event}`,
    passed: unknown.length === 0,
    note:
      unknown.length === 0
        ? [...allowed].filter((k) => k !== "hookEventName").join(", ") || "hookEventName only"
        : `${event} does not read: ${unknown.join(", ")}`,
  });

  const decision = hso["permissionDecision"];
  if (typeof decision === "string") {
    const valid = ["allow", "deny", "ask", "defer"];
    out.push({
      name: "permissionDecision is a valid value",
      passed: valid.includes(decision),
      note: valid.includes(decision) ? decision : `got "${decision}", expected one of ${valid.join(", ")}`,
    });
    if (decision === "deny") {
      out.push({
        name: "a deny explains itself to Claude",
        passed: typeof hso["permissionDecisionReason"] === "string",
        note:
          typeof hso["permissionDecisionReason"] === "string"
            ? "permissionDecisionReason present"
            : "without permissionDecisionReason, Claude is refused with no way to adapt",
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reading handlers out of a hooks.json
// ---------------------------------------------------------------------------

export interface ConfigHandler {
  readonly matcher: string | undefined;
  readonly type: string;
  readonly command?: string;
  readonly args?: readonly string[];
  readonly timeout?: number;
  readonly if?: string;
}

/**
 * Collect the handlers a config registers on one event, keeping the ones whose
 * matcher accepts `value`.
 *
 * Non-command handlers are collected too rather than filtered out: a config
 * whose only handler on the event is an `http` hook should report that plainly,
 * not look like an event with no hooks at all.
 */
export function handlersFor(
  config: unknown,
  event: string,
  value: string | undefined,
): readonly ConfigHandler[] {
  if (!isRecord(config)) return [];
  const hooks = config["hooks"];
  if (!isRecord(hooks)) return [];
  const entries = hooks[event];
  if (!Array.isArray(entries)) return [];

  const narrow = NARROW_MATCHER_EVENTS.has(event);
  const found: ConfigHandler[] = [];
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const matcher = typeof entry["matcher"] === "string" ? entry["matcher"] : undefined;
    if (value !== undefined && !matchesMatcher(matcher, value, { narrow })) continue;
    const inner = entry["hooks"];
    if (!Array.isArray(inner)) continue;
    for (const handler of inner) {
      if (!isRecord(handler)) continue;
      found.push({
        matcher,
        type: typeof handler["type"] === "string" ? handler["type"] : "command",
        ...(typeof handler["command"] === "string" ? { command: handler["command"] } : {}),
        ...(Array.isArray(handler["args"]) ? { args: handler["args"].map(String) } : {}),
        ...(typeof handler["timeout"] === "number" ? { timeout: handler["timeout"] } : {}),
        ...(typeof handler["if"] === "string" ? { if: handler["if"] } : {}),
      });
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export interface HandlerReport {
  readonly label: string;
  readonly form: "shell" | "exec" | "skipped";
  readonly result?: RunResult;
  readonly assertions: readonly Assertion[];
  readonly skipReason?: string;
}

export interface Report {
  readonly event: string;
  readonly payloadSource: string;
  readonly matcherNote: string;
  readonly handlers: readonly HandlerReport[];
}

/** Render a report as markdown, matching this plugin's markdown-first CLI output. */
export function formatReport(report: Report): string {
  const lines = [`# Hook test: \`${report.event}\``, "", `- **Payload**: ${report.payloadSource}`];
  lines.push(`- **Matcher**: ${report.matcherNote}`, "");

  let total = 0;
  let failed = 0;
  for (const handler of report.handlers) {
    lines.push(`## ${handler.label}`, "");
    if (handler.form === "skipped") {
      lines.push(`Skipped: ${handler.skipReason ?? "not runnable"}`, "");
      continue;
    }
    if (handler.result !== undefined) {
      lines.push(
        `- form: ${handler.form}`,
        `- exit ${handler.result.exitCode} in ${handler.result.durationMs} ms`,
        "",
      );
    }
    for (const assertion of handler.assertions) {
      total += 1;
      if (!assertion.passed) failed += 1;
      lines.push(`- ${assertion.passed ? "PASS" : "FAIL"} — ${assertion.name}: ${assertion.note}`);
    }
    lines.push("");
  }

  if (report.handlers.length === 0) {
    lines.push(`No command handlers matched on \`${report.event}\`.`, "");
  }
  lines.push(
    failed === 0
      ? `**${total} expectation(s), all passed.**`
      : `**${total} expectation(s), ${failed} failed.**`,
  );
  return lines.join("\n");
}

export function reportFailed(report: Report): boolean {
  return report.handlers.some((h) => h.assertions.some((a) => !a.passed));
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE =
  "Usage: bun scripts/test-hook.ts --event <EventName> (--command <cmd> | --config <hooks.json>) [--payload <file> | --fixture <EventName>]";

export const CLI_SPEC: Spec = {
  event: { kind: "string", help: "hook event the handler is registered on" },
  fixture: { kind: "string", help: "generate a realistic default payload for this event" },
  payload: { kind: "string", help: "read the payload from a JSON file" },
  command: { kind: "string", help: "handler command to run" },
  arg: { kind: "string", repeat: true, help: "argv element; switches to exec form" },
  config: { kind: "string", help: "hooks.json to read handlers from" },
  matcher: { kind: "string", help: "value the config's matcher is tested against" },
  set: { kind: "string", repeat: true, help: "override a payload field: a.b=value" },
  "expect-exit": { kind: "integer", help: "assert the handler's exit code" },
  "expect-decision": { kind: "string", help: "assert the decision: none|allow|deny|ask|defer|block" },
  timeout: { kind: "number", default: 30, help: "seconds before the handler is killed" },
  "plugin-root": { kind: "string", help: "value for CLAUDE_PLUGIN_ROOT" },
  "project-dir": { kind: "string", help: "value for CLAUDE_PROJECT_DIR" },
  help: { kind: "boolean", default: false, help: "show this message" },
};

function stringFlag(flags: ParsedArgs["flags"], name: string): string | undefined {
  const value = flags[name];
  return typeof value === "string" ? value : undefined;
}

function listFlag(flags: ParsedArgs["flags"], name: string): readonly string[] {
  const value = flags[name];
  if (Array.isArray(value)) return value.map(String);
  return typeof value === "string" ? [value] : [];
}

/** Apply one `a.b=value` override, parsing the value as JSON when it is valid JSON. */
export function applyOverride(payload: Record<string, unknown>, assignment: string): void {
  const eq = assignment.indexOf("=");
  if (eq === -1) throw new CliError(`--set expects key=value, got: ${assignment}`);
  const path = assignment.slice(0, eq).split(".");
  const raw = assignment.slice(eq + 1);
  const parsed = parseJson(raw);
  const value: unknown = parsed.ok ? parsed.value : raw;

  let cursor: Record<string, unknown> = payload;
  for (const segment of path.slice(0, -1)) {
    const next = cursor[segment];
    if (!isRecord(next)) {
      const fresh: Record<string, unknown> = {};
      cursor[segment] = fresh;
      cursor = fresh;
    } else {
      cursor = next;
    }
  }
  const last = path[path.length - 1];
  if (last !== undefined) cursor[last] = value;
}

/** Resolve which event is under test from `--event` and `--fixture`. */
export function resolveEvent(flags: ParsedArgs["flags"]): string {
  const event = stringFlag(flags, "event");
  const fixture = stringFlag(flags, "fixture");
  const chosen = event ?? fixture;
  if (chosen === undefined) throw new CliError(`missing --event\n${USAGE}`);
  if (event !== undefined && fixture !== undefined && event !== fixture) {
    throw new CliError(`--event ${event} and --fixture ${fixture} name different events`);
  }
  if (EVENTS[chosen] === undefined) {
    throw new CliError(
      `unknown hook event: ${chosen}. A name that is not a real event silently never fires.\n` +
        `Known events: ${EVENT_NAMES.join(", ")}`,
    );
  }
  return chosen;
}

async function loadPayload(
  flags: ParsedArgs["flags"],
  event: string,
): Promise<{ readonly payload: Record<string, unknown>; readonly source: string }> {
  const path = stringFlag(flags, "payload");
  let payload: Record<string, unknown>;
  let source: string;
  if (path === undefined) {
    payload = buildFixture(event, process.cwd());
    source = `fixture for \`${event}\``;
  } else {
    const file = Bun.file(path);
    if (!(await file.exists())) throw new CliError(`payload file not found: ${path}`);
    const parsed = parseJson(await file.text());
    if (!parsed.ok) throw new CliError(`payload is not valid JSON: ${parsed.error}`);
    if (!isRecord(parsed.value)) throw new CliError("payload must be a JSON object");
    payload = parsed.value;
    source = `\`${path}\``;
  }
  for (const assignment of listFlag(flags, "set")) applyOverride(payload, assignment);
  return { payload, source };
}

async function buildHandlers(
  flags: ParsedArgs["flags"],
  event: string,
  payload: Record<string, unknown>,
  vars: Readonly<Record<string, string>>,
  timeoutMs: number,
): Promise<{ readonly handlers: readonly HandlerReport[]; readonly specs: readonly (HandlerSpec | undefined)[]; readonly matcherNote: string }> {
  const spec = EVENTS[event]!;
  const command = stringFlag(flags, "command");
  const configPath = stringFlag(flags, "config");
  if (command === undefined && configPath === undefined) {
    throw new CliError(`give either --command or --config\n${USAGE}`);
  }
  if (command !== undefined && configPath !== undefined) {
    throw new CliError("--command and --config are mutually exclusive");
  }

  const matcherField = spec.matcherField;
  const matcherValue =
    stringFlag(flags, "matcher") ??
    (matcherField === null ? undefined : String(payload[matcherField] ?? ""));
  const matcherNote =
    matcherField === null
      ? "this event takes no matcher — every registered hook fires"
      : `\`${matcherField}\` = \`${matcherValue ?? ""}\``;

  if (command !== undefined) {
    const args = listFlag(flags, "arg");
    const resolved = substitutePlaceholders(command, vars);
    const handler: HandlerSpec = {
      command: resolved,
      ...(args.length > 0 ? { args: args.map((a) => substitutePlaceholders(a, vars)) } : {}),
      timeoutMs,
      label: `Handler: \`${[resolved, ...args].join(" ")}\``,
    };
    return {
      handlers: [{ label: handler.label, form: args.length > 0 ? "exec" : "shell", assertions: [] }],
      specs: [handler],
      matcherNote,
    };
  }

  const file = Bun.file(configPath!);
  if (!(await file.exists())) throw new CliError(`config not found: ${configPath}`);
  const parsed = parseJson(await file.text());
  if (!parsed.ok) throw new CliError(`config is not valid JSON: ${parsed.error}`);

  const found = handlersFor(parsed.value, event, matcherValue);
  const reports: HandlerReport[] = [];
  const specs: (HandlerSpec | undefined)[] = [];
  for (const entry of found) {
    const label = `Handler: \`${entry.command ?? entry.type}\`${entry.matcher === undefined ? "" : ` (matcher \`${entry.matcher}\`)`}`;
    if (entry.type !== "command" || entry.command === undefined) {
      reports.push({
        label,
        form: "skipped",
        assertions: [],
        skipReason: `\`${entry.type}\` handlers are not run by this harness — it drives stdin, stdout and exit codes`,
      });
      specs.push(undefined);
      continue;
    }
    const resolved = substitutePlaceholders(entry.command, vars);
    const args = entry.args?.map((a) => substitutePlaceholders(a, vars));
    reports.push({ label, form: args === undefined ? "shell" : "exec", assertions: [] });
    specs.push({
      command: resolved,
      ...(args === undefined ? {} : { args }),
      timeoutMs: entry.timeout === undefined ? timeoutMs : entry.timeout * 1000,
      label,
    });
  }
  return { handlers: reports, specs, matcherNote };
}

/** Run everything and produce the report. Exported so tests drive the same path the CLI does. */
export async function main(argv: readonly string[]): Promise<{ readonly text: string; readonly ok: boolean }> {
  const { flags } = parseArgs(argv, CLI_SPEC);
  if (flags["help"] === true) return { text: formatHelp(USAGE, CLI_SPEC), ok: true };

  const event = resolveEvent(flags);
  const { payload, source } = await loadPayload(flags, event);

  const vars: Record<string, string> = {
    CLAUDE_PROJECT_DIR: stringFlag(flags, "project-dir") ?? process.cwd(),
    CLAUDE_PLUGIN_ROOT: stringFlag(flags, "plugin-root") ?? process.cwd(),
    CLAUDE_PLUGIN_DATA: `${stringFlag(flags, "plugin-root") ?? process.cwd()}/.plugin-data`,
  };
  const timeoutFlag = flags["timeout"];
  const timeoutMs = (typeof timeoutFlag === "number" ? timeoutFlag : 30) * 1000;

  const { handlers, specs, matcherNote } = await buildHandlers(flags, event, payload, vars, timeoutMs);

  const expectExit = flags["expect-exit"];
  const expect: Expectations = {
    ...(typeof expectExit === "number" ? { exitCode: expectExit } : {}),
    ...(stringFlag(flags, "expect-decision") === undefined
      ? {}
      : { decision: stringFlag(flags, "expect-decision")! }),
  };

  const finished: HandlerReport[] = [];
  for (const [index, handlerSpec] of specs.entries()) {
    const base = handlers[index]!;
    if (handlerSpec === undefined) {
      finished.push(base);
      continue;
    }
    const result = await runHandler(handlerSpec, payload, vars);
    finished.push({ ...base, result, assertions: checkContract(event, result, expect) });
  }

  const report: Report = { event, payloadSource: source, matcherNote, handlers: finished };
  return { text: formatReport(report), ok: !reportFailed(report) };
}

if (import.meta.main) {
  try {
    const { text, ok } = await main(Bun.argv.slice(2));
    console.log(text);
    process.exit(ok ? 0 : 1);
  } catch (error) {
    if (!(error instanceof CliError)) throw error;
    console.log(`Error: ${error.message}`);
    process.exit(2);
  }
}
