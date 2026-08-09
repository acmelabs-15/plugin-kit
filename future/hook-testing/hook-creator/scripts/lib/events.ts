/**
 * The hook event table the harness runs against.
 *
 * This is data a script executes with, not prose a model reads -- the readable
 * version lives in `references/events.md`. Keeping the two apart is deliberate:
 * the reference explains the judgement, this file is the machine-checkable
 * shape, and a defect in either one is visible against the other.
 *
 * Four things are recorded per event, and each one exists because getting it
 * wrong is a silent failure rather than an error:
 *
 *   matcherField  Which payload field the `matcher` is tested against. This
 *                 VARIES BY EVENT. A tool-name matcher on a session event never
 *                 fires and nothing complains.
 *   blocking      What exit code 2 actually does. On several events it does
 *                 nothing at all, so a guard written there is decorative.
 *   decision      Which `hookSpecificOutput` keys the event reads. A key the
 *                 event does not read is dropped without comment.
 *   fixture       Event-specific payload fields, realistic enough that a
 *                 handler written against the real schema runs unmodified.
 */

/** What exit code 2 does on this event. */
export type BlockMode =
  /** Stops the action: the tool call, the prompt, the stop, the config change. */
  | "blocks"
  /** The action already happened; stderr is shown to Claude as feedback. */
  | "feedback"
  /** Exit code and stderr are discarded. A guard here is decorative. */
  | "ignored"
  /** Any non-zero exit aborts. Unique to WorktreeCreate. */
  | "aborts"
  /** Stderr is shown to the user only; Claude never sees it. */
  | "user-only";

/** Which decision shape the event reads out of `hookSpecificOutput`. */
export type DecisionShape =
  | "preToolUse"
  | "permissionRequest"
  | "permissionDenied"
  | "postToolUse"
  | "context"
  | "sessionStart"
  | "messageDisplay"
  | "worktreeCreate"
  | "elicitation"
  | "none";

export interface EventSpec {
  /** Payload field the `matcher` is tested against; `null` when the event takes no matcher. */
  readonly matcherField: string | null;
  readonly blocking: BlockMode;
  /** Plain (non-JSON) stdout on exit 0 is added to Claude's context. */
  readonly stdoutIsContext: boolean;
  /** Whether a top-level `decision: "block"` is read on this event. */
  readonly topLevelDecision: boolean;
  readonly decision: DecisionShape;
  /** Default timeout in seconds for `command`, `http` and `mcp_tool` handlers. */
  readonly defaultTimeoutSeconds: number;
  /** Event-specific payload fields, merged over the common ones. */
  readonly fixture: Readonly<Record<string, unknown>>;
}

const TOOL_INPUT_BASH = { command: "npm test", description: "Run the test suite" };
const TOOL_INPUT_EDIT = {
  file_path: "/repo/src/index.ts",
  old_string: "const a = 1;",
  new_string: "const a = 2;",
};

/** `hookSpecificOutput` keys each decision shape reads, beyond `hookEventName`. */
export const DECISION_KEYS: Readonly<Record<DecisionShape, readonly string[]>> = {
  preToolUse: ["permissionDecision", "permissionDecisionReason", "updatedInput", "additionalContext"],
  permissionRequest: ["decision"],
  permissionDenied: ["retry"],
  postToolUse: ["additionalContext", "updatedToolOutput", "updatedMCPToolOutput"],
  context: ["additionalContext"],
  sessionStart: [
    "additionalContext",
    "initialUserMessage",
    "sessionTitle",
    "watchPaths",
    "reloadSkills",
  ],
  messageDisplay: ["displayContent"],
  worktreeCreate: ["worktreePath"],
  elicitation: ["action", "content"],
  none: [],
};

/** Top-level output fields every event accepts. */
export const UNIVERSAL_OUTPUT_KEYS: readonly string[] = [
  "continue",
  "stopReason",
  "suppressOutput",
  "systemMessage",
  "terminalSequence",
  "hookSpecificOutput",
];

const COMMON = { permission_mode: "default" } as const;

export const EVENTS: Readonly<Record<string, EventSpec>> = {
  SessionStart: {
    matcherField: "source",
    blocking: "user-only",
    stdoutIsContext: true,
    topLevelDecision: false,
    decision: "sessionStart",
    defaultTimeoutSeconds: 600,
    fixture: { source: "startup", model: "claude-opus-4-6" },
  },
  Setup: {
    matcherField: "trigger",
    blocking: "user-only",
    stdoutIsContext: false,
    topLevelDecision: false,
    decision: "context",
    defaultTimeoutSeconds: 600,
    fixture: { trigger: "init" },
  },
  InstructionsLoaded: {
    matcherField: "load_reason",
    blocking: "ignored",
    stdoutIsContext: false,
    topLevelDecision: false,
    decision: "none",
    defaultTimeoutSeconds: 600,
    fixture: {
      file_path: "/repo/CLAUDE.md",
      memory_type: "project",
      load_reason: "session_start",
    },
  },
  UserPromptSubmit: {
    matcherField: null,
    blocking: "blocks",
    stdoutIsContext: true,
    topLevelDecision: true,
    decision: "context",
    defaultTimeoutSeconds: 30,
    fixture: { ...COMMON, prompt: "Add a retry to the upload path" },
  },
  UserPromptExpansion: {
    matcherField: "command_name",
    blocking: "blocks",
    stdoutIsContext: true,
    topLevelDecision: true,
    decision: "context",
    defaultTimeoutSeconds: 600,
    fixture: {
      ...COMMON,
      expansion_type: "command",
      command_name: "deploy",
      command_args: "staging",
      command_source: "project",
      prompt: "Deploy the current branch to staging",
    },
  },
  MessageDisplay: {
    matcherField: null,
    blocking: "ignored",
    stdoutIsContext: false,
    topLevelDecision: false,
    decision: "messageDisplay",
    defaultTimeoutSeconds: 10,
    fixture: {
      turn_id: "turn-1",
      message_id: "msg-1",
      index: 0,
      final: true,
      delta: "Here is the change I made.",
    },
  },
  PreToolUse: {
    matcherField: "tool_name",
    blocking: "blocks",
    stdoutIsContext: false,
    topLevelDecision: false,
    decision: "preToolUse",
    defaultTimeoutSeconds: 600,
    fixture: {
      ...COMMON,
      tool_name: "Bash",
      tool_input: TOOL_INPUT_BASH,
      tool_use_id: "toolu_01TEST",
    },
  },
  PermissionRequest: {
    matcherField: "tool_name",
    blocking: "blocks",
    stdoutIsContext: false,
    topLevelDecision: false,
    decision: "permissionRequest",
    defaultTimeoutSeconds: 600,
    fixture: {
      ...COMMON,
      tool_name: "Bash",
      tool_input: { command: "rm -rf node_modules", description: "Clean install" },
      permission_suggestions: [
        {
          type: "addRules",
          rules: [{ toolName: "Bash", ruleContent: "rm -rf node_modules" }],
          behavior: "allow",
          destination: "localSettings",
        },
      ],
    },
  },
  PermissionDenied: {
    matcherField: "tool_name",
    blocking: "ignored",
    stdoutIsContext: false,
    topLevelDecision: false,
    decision: "permissionDenied",
    defaultTimeoutSeconds: 600,
    fixture: {
      ...COMMON,
      tool_name: "Bash",
      tool_input: TOOL_INPUT_BASH,
      tool_use_id: "toolu_01TEST",
      reason: "Denied by the auto mode classifier",
    },
  },
  PostToolUse: {
    matcherField: "tool_name",
    blocking: "feedback",
    stdoutIsContext: false,
    topLevelDecision: true,
    decision: "postToolUse",
    defaultTimeoutSeconds: 600,
    fixture: {
      ...COMMON,
      tool_name: "Edit",
      tool_input: TOOL_INPUT_EDIT,
      tool_response: { filePath: "/repo/src/index.ts", success: true },
      tool_use_id: "toolu_01TEST",
      duration_ms: 42,
    },
  },
  PostToolUseFailure: {
    matcherField: "tool_name",
    blocking: "feedback",
    stdoutIsContext: false,
    topLevelDecision: true,
    decision: "context",
    defaultTimeoutSeconds: 600,
    fixture: {
      ...COMMON,
      tool_name: "Bash",
      tool_input: TOOL_INPUT_BASH,
      tool_use_id: "toolu_01TEST",
      error: "Command failed with exit code 1",
      is_interrupt: false,
      duration_ms: 1200,
    },
  },
  PostToolBatch: {
    matcherField: null,
    blocking: "blocks",
    stdoutIsContext: false,
    topLevelDecision: true,
    decision: "context",
    defaultTimeoutSeconds: 600,
    fixture: {
      ...COMMON,
      tool_calls: [
        { tool_name: "Read", tool_input: { file_path: "/repo/src/index.ts" } },
        { tool_name: "Edit", tool_input: TOOL_INPUT_EDIT },
      ],
    },
  },
  Notification: {
    matcherField: "notification_type",
    blocking: "user-only",
    stdoutIsContext: false,
    topLevelDecision: false,
    decision: "none",
    defaultTimeoutSeconds: 600,
    fixture: {
      message: "Claude needs your permission",
      title: "Permission needed",
      notification_type: "permission_prompt",
    },
  },
  SubagentStart: {
    matcherField: "agent_type",
    blocking: "user-only",
    stdoutIsContext: false,
    topLevelDecision: false,
    decision: "context",
    defaultTimeoutSeconds: 600,
    fixture: { agent_id: "agent-1", agent_type: "code-reviewer" },
  },
  SubagentStop: {
    matcherField: "agent_type",
    blocking: "blocks",
    stdoutIsContext: false,
    topLevelDecision: true,
    decision: "context",
    defaultTimeoutSeconds: 600,
    fixture: {
      ...COMMON,
      stop_hook_active: false,
      agent_id: "agent-1",
      agent_type: "code-reviewer",
      agent_transcript_path: "/tmp/claude-hook-harness/agent.jsonl",
      last_assistant_message: "Review complete: two findings.",
    },
  },
  TaskCreated: {
    matcherField: null,
    blocking: "blocks",
    stdoutIsContext: false,
    topLevelDecision: true,
    decision: "none",
    defaultTimeoutSeconds: 600,
    fixture: {
      ...COMMON,
      task_id: "task-1",
      task_subject: "Add retry to upload",
      task_description: "Retry transient upload failures three times.",
    },
  },
  TaskCompleted: {
    matcherField: null,
    blocking: "blocks",
    stdoutIsContext: false,
    topLevelDecision: true,
    decision: "none",
    defaultTimeoutSeconds: 600,
    fixture: {
      ...COMMON,
      task_id: "task-1",
      task_subject: "Add retry to upload",
      task_description: "Retry transient upload failures three times.",
    },
  },
  Stop: {
    matcherField: null,
    blocking: "blocks",
    stdoutIsContext: false,
    topLevelDecision: true,
    decision: "context",
    defaultTimeoutSeconds: 600,
    fixture: {
      ...COMMON,
      stop_hook_active: false,
      last_assistant_message: "I have updated the upload path.",
    },
  },
  StopFailure: {
    matcherField: "error",
    blocking: "ignored",
    stdoutIsContext: false,
    topLevelDecision: false,
    decision: "none",
    defaultTimeoutSeconds: 600,
    fixture: {
      error: "rate_limit",
      error_details: "429 Too Many Requests",
      last_assistant_message: "API Error: Rate limit reached",
    },
  },
  TeammateIdle: {
    matcherField: null,
    blocking: "blocks",
    stdoutIsContext: false,
    topLevelDecision: false,
    decision: "none",
    defaultTimeoutSeconds: 600,
    fixture: { ...COMMON, teammate_name: "reviewer", team_name: "release" },
  },
  ConfigChange: {
    matcherField: "source",
    blocking: "blocks",
    stdoutIsContext: false,
    topLevelDecision: true,
    decision: "none",
    defaultTimeoutSeconds: 600,
    fixture: { source: "project_settings", file_path: "/repo/.claude/settings.json" },
  },
  CwdChanged: {
    matcherField: null,
    blocking: "ignored",
    stdoutIsContext: false,
    topLevelDecision: false,
    decision: "none",
    defaultTimeoutSeconds: 600,
    fixture: { old_cwd: "/repo", new_cwd: "/repo/packages/api" },
  },
  DirectoryAdded: {
    matcherField: "source",
    blocking: "ignored",
    stdoutIsContext: false,
    topLevelDecision: false,
    decision: "none",
    defaultTimeoutSeconds: 600,
    fixture: { directory: "/repo/vendor", source: "slash_command" },
  },
  FileChanged: {
    matcherField: "file_path",
    blocking: "ignored",
    stdoutIsContext: false,
    topLevelDecision: false,
    decision: "none",
    defaultTimeoutSeconds: 600,
    fixture: { file_path: "/repo/.envrc", event: "change" },
  },
  WorktreeCreate: {
    matcherField: null,
    blocking: "aborts",
    stdoutIsContext: false,
    topLevelDecision: false,
    decision: "worktreeCreate",
    defaultTimeoutSeconds: 600,
    fixture: { name: "feature-auth" },
  },
  WorktreeRemove: {
    matcherField: null,
    blocking: "ignored",
    stdoutIsContext: false,
    topLevelDecision: false,
    decision: "none",
    defaultTimeoutSeconds: 600,
    fixture: { worktree_path: "/repo/.claude/worktrees/feature-auth" },
  },
  PreCompact: {
    matcherField: "trigger",
    blocking: "blocks",
    stdoutIsContext: false,
    topLevelDecision: true,
    decision: "none",
    defaultTimeoutSeconds: 600,
    fixture: { trigger: "manual", custom_instructions: "" },
  },
  PostCompact: {
    matcherField: "trigger",
    blocking: "ignored",
    stdoutIsContext: false,
    topLevelDecision: false,
    decision: "none",
    defaultTimeoutSeconds: 600,
    fixture: { trigger: "auto", compact_summary: "Summarised 42 messages." },
  },
  Elicitation: {
    matcherField: "mcp_server_name",
    blocking: "blocks",
    stdoutIsContext: false,
    topLevelDecision: false,
    decision: "elicitation",
    defaultTimeoutSeconds: 600,
    fixture: {
      ...COMMON,
      mcp_server_name: "issues",
      message: "Which project should this ticket go to?",
      mode: "form",
      requested_schema: { type: "object", properties: { project: { type: "string" } } },
    },
  },
  ElicitationResult: {
    matcherField: "mcp_server_name",
    blocking: "blocks",
    stdoutIsContext: false,
    topLevelDecision: false,
    decision: "elicitation",
    defaultTimeoutSeconds: 600,
    fixture: {
      ...COMMON,
      mcp_server_name: "issues",
      action: "accept",
      content: { project: "platform" },
      mode: "form",
      elicitation_id: "elicit-1",
    },
  },
  SessionEnd: {
    matcherField: "reason",
    blocking: "user-only",
    stdoutIsContext: false,
    topLevelDecision: false,
    decision: "none",
    defaultTimeoutSeconds: 600,
    fixture: { reason: "prompt_input_exit" },
  },
};

export const EVENT_NAMES: readonly string[] = Object.keys(EVENTS).sort();

/**
 * Two events use a narrower exact-match character set than the rest -- letters,
 * digits, `_` and `|` only. A hyphen or comma in a matcher for either one keeps
 * it on the regular-expression path instead, which is a surprising difference
 * worth encoding rather than remembering.
 */
export const NARROW_MATCHER_EVENTS: ReadonlySet<string> = new Set(["FileChanged", "StopFailure"]);

const BROAD_EXACT = /^[A-Za-z0-9_\- ,|]*$/;
const NARROW_EXACT = /^[A-Za-z0-9_|]*$/;

/**
 * Evaluate a matcher against a value exactly as Claude Code does.
 *
 * Three paths, chosen by the characters in the matcher rather than by any
 * syntax the author opts into -- which is why `mcp__memory` matches nothing
 * (exact string, and no tool is named that) while `mcp__memory__.*` matches
 * every tool on that server.
 */
export function matchesMatcher(
  matcher: string | undefined,
  value: string,
  options: { readonly narrow?: boolean } = {},
): boolean {
  if (matcher === undefined || matcher === "" || matcher === "*") return true;
  const exact = options.narrow === true ? NARROW_EXACT : BROAD_EXACT;
  if (exact.test(matcher)) {
    const separators = options.narrow === true ? /\|/ : /[,|]/;
    return matcher.split(separators).some((part) => part.trim() === value);
  }
  try {
    return new RegExp(matcher).test(value);
  } catch {
    // An unparseable pattern matches nothing rather than throwing: a bad
    // matcher should show up as "the hook never fired", which is the symptom
    // the author will actually see.
    return false;
  }
}

/** Build a realistic default payload for an event. */
export function buildFixture(event: string, cwd: string): Record<string, unknown> {
  const spec = EVENTS[event];
  if (spec === undefined) throw new Error(`unknown hook event: ${event}`);
  return {
    session_id: "test-session-0000",
    transcript_path: "/tmp/claude-hook-harness/transcript.jsonl",
    cwd,
    hook_event_name: event,
    ...spec.fixture,
  };
}
