import { afterAll, describe, expect, test } from "bun:test";
import { chmod, rm } from "node:fs/promises";

import { CliError, parseArgs } from "../../../../../shared/scripts/lib/cli.ts";
import {
  DECISION_KEYS,
  EVENTS,
  EVENT_NAMES,
  NARROW_MATCHER_EVENTS,
  buildFixture,
  matchesMatcher,
} from "../lib/events.ts";
import {
  CLI_SPEC,
  applyOverride,
  checkContract,
  effectiveDecision,
  formatReport,
  handlersFor,
  main,
  reportFailed,
  resolveEvent,
  runHandler,
  substitutePlaceholders,
  type Assertion,
  type RunResult,
} from "../test-hook.ts";

const TMP_ROOT = `${Bun.env.TMPDIR ?? "/tmp"}/hook-creator-harness-${Bun.nanoseconds()}`;
const CLI = `${import.meta.dir}/../test-hook.ts`;

afterAll(async () => {
  await rm(TMP_ROOT, { recursive: true, force: true });
});

let counter = 0;
async function tmpFile(name: string, contents: string): Promise<string> {
  counter += 1;
  const path = `${TMP_ROOT}/case-${counter}/${name}`;
  await Bun.write(path, contents);
  return path;
}

/**
 * A handler script that echoes a fixed response, for driving the runner.
 *
 * POSIX sh rather than Bun on purpose, and the one place in this repository
 * that is right: shell form is what Claude Code hands to `sh -c`, so the path
 * under test here is the shell one. A Bun handler would exercise exec form and
 * leave the branch this suite exists to cover untested. The mode bit is set
 * through `node:fs/promises` rather than by spawning `chmod`.
 */
async function handlerScript(body: string): Promise<string> {
  const path = await tmpFile("handler.sh", `#!/bin/sh\ncat >/dev/null\n${body}\n`);
  await chmod(path, 0o755);
  return path;
}

function result(overrides: Partial<RunResult> = {}): RunResult {
  return { exitCode: 0, stdout: "", stderr: "", timedOut: false, durationMs: 1, ...overrides };
}

function find(assertions: readonly Assertion[], fragment: string): Assertion {
  const hit = assertions.find((a) => a.name.includes(fragment));
  if (hit === undefined) {
    throw new Error(`no assertion matching "${fragment}" in: ${assertions.map((a) => a.name).join(" | ")}`);
  }
  return hit;
}

describe("the event table", () => {
  test("covers all 31 documented events", () => {
    expect(EVENT_NAMES).toHaveLength(31);
  });

  test.each([...EVENT_NAMES])("%s builds a fixture carrying the common fields", (event) => {
    const payload = buildFixture(event, "/repo");
    expect(payload["hook_event_name"]).toBe(event);
    expect(payload["session_id"]).toBeString();
    expect(payload["transcript_path"]).toBeString();
    expect(payload["cwd"]).toBe("/repo");
  });

  test.each([...EVENT_NAMES])("%s fixture carries the field its matcher tests", (event) => {
    const spec = EVENTS[event]!;
    if (spec.matcherField === null) return;
    const payload = buildFixture(event, "/repo");
    expect(payload[spec.matcherField]).toBeString();
  });

  test("rejects an event name that is not real", () => {
    expect(() => buildFixture("PreToolUseX", "/repo")).toThrow("unknown hook event");
  });

  test("every decision shape names keys the checker can allow", () => {
    for (const event of EVENT_NAMES) {
      expect(DECISION_KEYS[EVENTS[event]!.decision]).toBeArray();
    }
  });
});

describe("matcher evaluation", () => {
  test("an absent, empty or star matcher fires on everything", () => {
    expect(matchesMatcher(undefined, "Bash")).toBe(true);
    expect(matchesMatcher("", "Bash")).toBe(true);
    expect(matchesMatcher("*", "Bash")).toBe(true);
  });

  test("a plain name is an exact string, not a substring", () => {
    expect(matchesMatcher("Edit", "Edit")).toBe(true);
    expect(matchesMatcher("Edit", "NotebookEdit")).toBe(false);
  });

  test.each([
    ["Edit|Write", "Write", true],
    ["Edit, Write", "Write", true],
    ["Edit , Write", "Edit", true],
    ["Edit|Write", "Bash", false],
  ])("alternation %s against %s", (matcher, value, expected) => {
    expect(matchesMatcher(matcher, value)).toBe(expected);
  });

  test("a pattern with regex characters becomes an unanchored regex", () => {
    expect(matchesMatcher("^Notebook", "NotebookEdit")).toBe(true);
    expect(matchesMatcher("Edit.*", "NotebookEdit")).toBe(true);
    expect(matchesMatcher("^Edit$", "NotebookEdit")).toBe(false);
  });

  test("a bare MCP server prefix matches nothing, because it is an exact string", () => {
    expect(matchesMatcher("mcp__memory", "mcp__memory__create_entities")).toBe(false);
    expect(matchesMatcher("mcp__memory__.*", "mcp__memory__create_entities")).toBe(true);
  });

  test("a plugin-bundled server needs the scoped name", () => {
    const tool = "mcp__plugin_my-plugin_db__query";
    expect(matchesMatcher("mcp__db__.*", tool)).toBe(false);
    expect(matchesMatcher("mcp__plugin_my-plugin_db__.*", tool)).toBe(true);
  });

  test("FileChanged and StopFailure use the narrow exact set, so a comma is regex", () => {
    expect(NARROW_MATCHER_EVENTS.has("FileChanged")).toBe(true);
    expect(matchesMatcher(".envrc|.env", "/repo/.envrc", { narrow: true })).toBe(true);
    expect(matchesMatcher("rate_limit|overloaded", "overloaded", { narrow: true })).toBe(true);
    // A comma is outside the narrow set, so the whole thing is a regex and the
    // comma is a literal character rather than a separator.
    expect(matchesMatcher("rate_limit, overloaded", "overloaded", { narrow: true })).toBe(false);
  });

  test("an unparseable pattern matches nothing rather than throwing", () => {
    expect(matchesMatcher("[unclosed", "Bash")).toBe(false);
  });
});

describe("placeholder substitution", () => {
  test("resolves the plugin anchors", () => {
    expect(
      substitutePlaceholders("bun ${CLAUDE_PLUGIN_ROOT}/hooks/guard.ts", {
        CLAUDE_PLUGIN_ROOT: "/plugins/demo",
      }),
    ).toBe("bun /plugins/demo/hooks/guard.ts");
  });

  test("leaves an unknown placeholder verbatim, so the failure stays visible", () => {
    expect(substitutePlaceholders("${NOPE}/x", {})).toBe("${NOPE}/x");
  });
});

describe("running a handler", () => {
  test("feeds the payload to the handler on stdin", async () => {
    const out = await runHandler(
      { command: "cat", timeoutMs: 5000, label: "cat" },
      { hook_event_name: "PreToolUse", tool_name: "Bash" },
      {},
    );
    expect(out.exitCode).toBe(0);
    expect(JSON.parse(out.stdout)["tool_name"]).toBe("Bash");
  });

  test("captures exit code, stdout and stderr separately", async () => {
    const script = await handlerScript('echo out; echo err >&2; exit 2');
    const out = await runHandler({ command: script, timeoutMs: 5000, label: "s" }, {}, {});
    expect(out.exitCode).toBe(2);
    expect(out.stdout.trim()).toBe("out");
    expect(out.stderr.trim()).toBe("err");
  });

  test("exec form passes each arg verbatim, with no shell tokenization", async () => {
    const out = await runHandler(
      { command: "sh", args: ["-c", 'printf %s "$1"', "sh", "a b'c$d"], timeoutMs: 5000, label: "s" },
      {},
      {},
    );
    expect(out.stdout).toBe("a b'c$d");
  });

  test("exports the plugin anchors into the handler's environment", async () => {
    const out = await runHandler(
      { command: 'cat >/dev/null; printf %s "$CLAUDE_PLUGIN_ROOT"', timeoutMs: 5000, label: "s" },
      {},
      { CLAUDE_PLUGIN_ROOT: "/plugins/demo" },
    );
    expect(out.stdout).toBe("/plugins/demo");
  });

  test("kills a handler that overruns its deadline", async () => {
    const out = await runHandler(
      { command: "cat >/dev/null; sleep 5", timeoutMs: 150, label: "s" },
      {},
      {},
    );
    expect(out.timedOut).toBe(true);
  });

  test("a command that does not exist is reported, not thrown", async () => {
    const out = await runHandler(
      { command: "/nonexistent/hook-handler", args: [], timeoutMs: 5000, label: "s" },
      {},
      {},
    );
    expect(out.exitCode).not.toBe(0);
  });
});

describe("the exit-code contract", () => {
  test("exit 0 with no output is a clean no-decision", () => {
    const checks = checkContract("PreToolUse", result());
    expect(checks.every((c) => c.passed)).toBe(true);
  });

  test("exit 1 fails, because only 2 blocks and everything else is an error", () => {
    const checks = checkContract("PreToolUse", result({ exitCode: 1, stderr: "boom" }));
    expect(find(checks, "exit code is 0 or 2").passed).toBe(false);
    expect(find(checks, "exit code is 0 or 2").note).toContain("non-blocking error");
  });

  test("exit 2 with an empty stderr blocks with no explanation", () => {
    const checks = checkContract("PreToolUse", result({ exitCode: 2 }));
    expect(find(checks, "carries a reason on stderr").passed).toBe(false);
  });

  test("exit 2 with JSON on stdout is flagged, because the JSON is ignored", () => {
    const checks = checkContract(
      "PreToolUse",
      result({ exitCode: 2, stderr: "no", stdout: '{"decision":"block"}' }),
    );
    expect(find(checks, "no JSON written to stdout").passed).toBe(false);
  });

  test("exit 2 on an event that discards it is flagged", () => {
    const checks = checkContract("PermissionDenied", result({ exitCode: 2, stderr: "no" }));
    expect(find(checks, "does something on this event").passed).toBe(false);
  });

  test("exit 2 on a post-hoc event passes, and says the action already ran", () => {
    const checks = checkContract("PostToolUse", result({ exitCode: 2, stderr: "lint failed" }));
    const assertion = find(checks, "does something on this event");
    expect(assertion.passed).toBe(true);
    expect(assertion.note).toContain("already happened");
  });

  test("a timeout fails its own assertion", () => {
    const checks = checkContract("PreToolUse", result({ timedOut: true, exitCode: 137 }));
    expect(find(checks, "within the timeout").passed).toBe(false);
  });

  test("--expect-exit replaces the default exit assertion", () => {
    const checks = checkContract("PreToolUse", result({ exitCode: 1, stderr: "x" }), { exitCode: 1 });
    expect(find(checks, "exit code is 1").passed).toBe(true);
  });

  test("an unknown event is a usage error, not a silent pass", () => {
    expect(() => checkContract("PreToolUseX", result())).toThrow(CliError);
  });
});

describe("the JSON output contract", () => {
  const json = (body: unknown): RunResult => result({ stdout: JSON.stringify(body) });

  test("malformed JSON is caught", () => {
    const checks = checkContract("PreToolUse", result({ stdout: "{not json" }));
    expect(find(checks, "parses as JSON").passed).toBe(false);
  });

  test("text before the JSON is caught — the shell-profile echo defect", () => {
    const checks = checkContract("PreToolUse", result({ stdout: 'Shell ready\n{"continue":true}' }));
    expect(find(checks, "nothing before the JSON").passed).toBe(false);
  });

  test("plain text on a context event is fine and says so", () => {
    const checks = checkContract("SessionStart", result({ stdout: "Current branch: main" }));
    const assertion = find(checks, "nothing before the JSON");
    expect(assertion.passed).toBe(true);
    expect(assertion.note).toContain("context");
  });

  test("plain text on a non-context event says where it goes", () => {
    const checks = checkContract("PostToolUse", result({ stdout: "formatted" }));
    expect(find(checks, "nothing before the JSON").note).toContain("debug log");
  });

  test("an unrecognised top-level key is flagged", () => {
    const checks = checkContract("PreToolUse", json({ permission_decision: "deny" }));
    expect(find(checks, "top-level output fields").passed).toBe(false);
  });

  test("a mismatched hookEventName is flagged", () => {
    const checks = checkContract(
      "PostToolUse",
      json({ hookSpecificOutput: { hookEventName: "PreToolUse" } }),
    );
    expect(find(checks, "hookEventName matches").passed).toBe(false);
  });

  test("a key the event does not read is flagged", () => {
    const checks = checkContract(
      "PostToolUse",
      json({ hookSpecificOutput: { hookEventName: "PostToolUse", permissionDecision: "deny" } }),
    );
    expect(find(checks, "keys are read on PostToolUse").passed).toBe(false);
  });

  test("a top-level decision on PreToolUse is flagged as the deprecated shape", () => {
    const checks = checkContract("PreToolUse", json({ decision: "block", reason: "no" }));
    const assertion = find(checks, "top-level `decision`");
    expect(assertion.passed).toBe(false);
    expect(assertion.note).toContain("permissionDecision");
  });

  test("a top-level decision on PostToolUse is accepted", () => {
    const checks = checkContract("PostToolUse", json({ decision: "block", reason: "lint failed" }));
    expect(find(checks, "top-level `decision`").passed).toBe(true);
  });

  test("a block with no reason is flagged", () => {
    const checks = checkContract("Stop", json({ decision: "block" }));
    expect(find(checks, "carries a reason").passed).toBe(false);
  });

  test("an invalid permissionDecision value is flagged", () => {
    const checks = checkContract(
      "PreToolUse",
      json({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "reject" } }),
    );
    expect(find(checks, "permissionDecision is a valid value").passed).toBe(false);
  });

  test("a deny without a reason leaves Claude unable to adapt", () => {
    const checks = checkContract(
      "PreToolUse",
      json({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny" } }),
    );
    expect(find(checks, "explains itself to Claude").passed).toBe(false);
  });

  test("a well-formed PreToolUse deny passes every assertion", () => {
    const checks = checkContract(
      "PreToolUse",
      json({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: "Writes to .env are not allowed",
        },
      }),
    );
    expect(checks.filter((c) => !c.passed)).toEqual([]);
  });
});

describe("effective decision", () => {
  const spec = EVENTS["PreToolUse"]!;

  test.each([
    [result(), "none"],
    [result({ exitCode: 2 }), "block"],
    [result({ exitCode: 1 }), "error"],
    [result({ stdout: '{"continue":false}' }), "block"],
    [
      result({ stdout: '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask"}}' }),
      "ask",
    ],
  ])("%o resolves to %s", (run, expected) => {
    expect(effectiveDecision(run as RunResult, spec)).toBe(expected as never);
  });

  test("exit 2 on an event that ignores it is not a block", () => {
    expect(effectiveDecision(result({ exitCode: 2 }), EVENTS["PermissionDenied"]!)).toBe("none");
  });

  test("deny and block compare equal, since they are the same answer", () => {
    const checks = checkContract("PreToolUse", result({ exitCode: 2, stderr: "no" }), {
      decision: "deny",
    });
    expect(find(checks, "decision is deny").passed).toBe(true);
  });
});

describe("reading handlers from a hooks.json", () => {
  const config = {
    hooks: {
      PostToolUse: [
        {
          matcher: "Edit|Write",
          hooks: [
            { type: "command", command: "fmt.sh" },
            { type: "http", url: "https://example.com/hook" },
          ],
        },
        { matcher: "Bash", hooks: [{ type: "command", command: "log.sh" }] },
      ],
    },
  };

  test("keeps only the entries whose matcher accepts the value", () => {
    expect(handlersFor(config, "PostToolUse", "Edit").map((h) => h.command)).toEqual([
      "fmt.sh",
      undefined,
    ]);
    expect(handlersFor(config, "PostToolUse", "Bash").map((h) => h.command)).toEqual(["log.sh"]);
  });

  test("returns every handler when no value is supplied", () => {
    expect(handlersFor(config, "PostToolUse", undefined)).toHaveLength(3);
  });

  test("an event with no entries returns nothing", () => {
    expect(handlersFor(config, "PreToolUse", "Bash")).toEqual([]);
  });

  test("keeps non-command handlers so they can be reported rather than hidden", () => {
    const http = handlersFor(config, "PostToolUse", "Write").find((h) => h.type === "http");
    expect(http).toBeDefined();
  });

  test("tolerates a config with no hooks key at all", () => {
    expect(handlersFor({ description: "x" }, "PreToolUse", "Bash")).toEqual([]);
    expect(handlersFor(null, "PreToolUse", "Bash")).toEqual([]);
  });
});

describe("payload overrides", () => {
  test("sets a top-level field", () => {
    const payload: Record<string, unknown> = {};
    applyOverride(payload, "tool_name=Bash");
    expect(payload["tool_name"]).toBe("Bash");
  });

  test("sets a nested field, creating the parent", () => {
    const payload: Record<string, unknown> = {};
    applyOverride(payload, "tool_input.command=rm -rf /");
    expect(payload["tool_input"]).toEqual({ command: "rm -rf /" });
  });

  test("parses a JSON value when the right-hand side is JSON", () => {
    const payload: Record<string, unknown> = {};
    applyOverride(payload, "tool_input={\"command\":\"ls\"}");
    expect(payload["tool_input"]).toEqual({ command: "ls" });
  });

  test("keeps a value with an = in it intact", () => {
    const payload: Record<string, unknown> = {};
    applyOverride(payload, "tool_input.command=FOO=bar git push");
    expect((payload["tool_input"] as Record<string, unknown>)["command"]).toBe("FOO=bar git push");
  });

  test("rejects a --set with no =", () => {
    expect(() => applyOverride({}, "tool_name")).toThrow(CliError);
  });
});

describe("resolveEvent", () => {
  const flagsFor = (argv: string[]): ReturnType<typeof parseArgs>["flags"] =>
    parseArgs(argv, CLI_SPEC).flags;

  test("takes the event from --event", () => {
    expect(resolveEvent(flagsFor(["--event", "PreToolUse"]))).toBe("PreToolUse");
  });

  test("infers the event from --fixture alone", () => {
    expect(resolveEvent(flagsFor(["--fixture", "SessionStart"]))).toBe("SessionStart");
  });

  test("rejects a disagreement rather than picking one", () => {
    expect(() => resolveEvent(flagsFor(["--event", "Stop", "--fixture", "SessionStart"]))).toThrow(
      "name different events",
    );
  });

  test("rejects an event name that is not real, and lists the real ones", () => {
    expect(() => resolveEvent(flagsFor(["--event", "PostToolCall"]))).toThrow("silently never fires");
  });

  test("requires an event", () => {
    expect(() => resolveEvent(flagsFor([]))).toThrow("missing --event");
  });
});

describe("report rendering", () => {
  const base = {
    event: "PreToolUse",
    payloadSource: "fixture",
    matcherNote: "`tool_name` = `Bash`",
  };

  test("renders a passing run with a total", () => {
    const text = formatReport({
      ...base,
      handlers: [
        {
          label: "Handler: `guard.sh`",
          form: "shell",
          result: result({ exitCode: 2, stderr: "no" }),
          assertions: [{ name: "a", passed: true, note: "fine" }],
        },
      ],
    });
    expect(text).toContain("# Hook test: `PreToolUse`");
    expect(text).toContain("- PASS — a: fine");
    expect(text).toContain("**1 expectation(s), all passed.**");
  });

  test("counts failures", () => {
    const report = {
      ...base,
      handlers: [
        {
          label: "h",
          form: "shell" as const,
          assertions: [
            { name: "a", passed: true, note: "" },
            { name: "b", passed: false, note: "" },
          ],
        },
      ],
    };
    expect(formatReport(report)).toContain("1 failed");
    expect(reportFailed(report)).toBe(true);
  });

  test("says plainly when nothing matched", () => {
    expect(formatReport({ ...base, handlers: [] })).toContain("No command handlers matched");
  });

  test("emits no ANSI escape codes", () => {
    expect(formatReport({ ...base, handlers: [] })).not.toContain("\u001b[");
  });
});

describe("end to end", () => {
  test("runs a handler named on the command line", async () => {
    const script = await handlerScript('echo "Blocked: .env is protected" >&2; exit 2');
    const { text, ok } = await main(["--event", "PreToolUse", "--command", script]);
    expect(ok).toBe(true);
    expect(text).toContain("all passed");
  });

  test("--set reaches the handler's stdin", async () => {
    const { text, ok } = await main([
      "--event",
      "PreToolUse",
      "--command",
      'grep -q "rm -rf /" && echo "Blocked" >&2 && exit 2; exit 0',
      "--set",
      "tool_input.command=rm -rf /",
    ]);
    expect(ok).toBe(true);
    expect(text).toContain("exit 2");
  });

  test("a payload file is used in place of the fixture", async () => {
    const payload = await tmpFile(
      "payload.json",
      JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Write", tool_input: {} }),
    );
    const { text } = await main([
      "--event",
      "PreToolUse",
      "--payload",
      payload,
      "--command",
      "cat >/dev/null",
    ]);
    expect(text).toContain("`tool_name` = `Write`");
  });

  test("reads every matching command handler out of a hooks.json", async () => {
    const script = await handlerScript("exit 0");
    const config = await tmpFile(
      "hooks.json",
      JSON.stringify({
        hooks: {
          PostToolUse: [
            {
              matcher: "Edit|Write",
              hooks: [
                { type: "command", command: script },
                { type: "http", url: "https://example.com" },
              ],
            },
          ],
        },
      }),
    );
    const { text } = await main([
      "--event",
      "PostToolUse",
      "--config",
      config,
      "--set",
      "tool_name=Write",
    ]);
    expect(text).toContain("Skipped:");
    expect(text).toContain("all passed");
  });

  test("resolves ${CLAUDE_PLUGIN_ROOT} in a config command", async () => {
    const script = await handlerScript("exit 0");
    const dir = script.slice(0, script.lastIndexOf("/"));
    const config = await tmpFile(
      "hooks.json",
      JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: "Bash", hooks: [{ type: "command", command: "${CLAUDE_PLUGIN_ROOT}/handler.sh" }] },
          ],
        },
      }),
    );
    const { ok } = await main(["--event", "PreToolUse", "--config", config, "--plugin-root", dir]);
    expect(ok).toBe(true);
  });

  test("a matcher that does not accept the payload yields no handlers", async () => {
    const config = await tmpFile(
      "hooks.json",
      JSON.stringify({
        hooks: { PreToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command: "true" }] }] },
      }),
    );
    const { text } = await main(["--event", "PreToolUse", "--config", config]);
    expect(text).toContain("No command handlers matched");
  });

  test("--command and --config together is a usage error", async () => {
    await expect(main(["--event", "Stop", "--command", "true", "--config", "x"])).rejects.toThrow(
      "mutually exclusive",
    );
  });

  test("neither --command nor --config is a usage error", async () => {
    await expect(main(["--event", "Stop"])).rejects.toThrow("either --command or --config");
  });

  test("a missing payload file is a usage error", async () => {
    await expect(
      main(["--event", "Stop", "--command", "true", "--payload", "/nope.json"]),
    ).rejects.toThrow("payload file not found");
  });
});

describe("CLI", () => {
  test("exits 0 when every assertion passes", async () => {
    const script = await handlerScript('echo reason >&2; exit 2');
    const proc = Bun.spawnSync(["bun", CLI, "--event", "PreToolUse", "--command", script]);
    expect(proc.exitCode).toBe(0);
  });

  test("exits 1 when an assertion fails", async () => {
    const script = await handlerScript("exit 2");
    const proc = Bun.spawnSync(["bun", CLI, "--event", "PreToolUse", "--command", script]);
    expect(proc.exitCode).toBe(1);
    expect(proc.stdout.toString()).toContain("FAIL");
  });

  test("exits 2 for an unknown event, never mistaking it for a verdict", () => {
    const proc = Bun.spawnSync(["bun", CLI, "--event", "PostToolCall", "--command", "true"]);
    expect(proc.exitCode).toBe(2);
    expect(proc.stdout.toString()).toContain("silently never fires");
  });

  test("exits 2 for an unknown flag", () => {
    const proc = Bun.spawnSync(["bun", CLI, "--event", "Stop", "--bogus"]);
    expect(proc.exitCode).toBe(2);
    expect(proc.stdout.toString()).toContain("unknown flag");
  });

  test("--help exits 0 and renders the options", () => {
    const proc = Bun.spawnSync(["bun", CLI, "--help"]);
    expect(proc.exitCode).toBe(0);
    expect(proc.stdout.toString()).toContain("--fixture");
    expect(proc.stdout.toString()).toContain("--expect-decision");
  });
});
