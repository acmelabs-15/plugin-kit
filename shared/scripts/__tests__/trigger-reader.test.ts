/**
 * Tests for the trigger decision rule.
 *
 * This rule decides every verdict the harness reports, so it is the part of the harness
 * that most needs coverage: a change to it moves every number without necessarily
 * breaking anything else in the suite.
 *
 * The cases are written as event streams rather than mocks, so they assert against the
 * wire format `claude --output-format stream-json --include-partial-messages` actually
 * emits.
 */

import { describe, expect, test } from "bun:test";

import { createTriggerReader, type TriggerTarget } from "../measure-triggering.ts";

const SKILL = "code-simplifier";
const AGENT = "flake-triager";

/** The same matcher `runSingleQuery` builds: bare name, never plugin-qualified. */
function matcher(skillName: string = SKILL): (value: string) => boolean {
  const pattern = new RegExp(`(^|[\\s"'])${skillName}($|[\\s"',])`);
  return (value: string) => pattern.test(value);
}

/**
 * Feed lines until the reader returns a verdict; `null` means it never decided.
 *
 * Passes the BARE PREDICATE deliberately, which is the pre-generalization signature.
 * Every existing case below therefore doubles as the regression test that the older
 * shape still normalizes to a skill target and behaves exactly as it used to.
 */
function readAll(lines: readonly string[], skillName: string = SKILL): boolean | null {
  const read = createTriggerReader(matcher(skillName));
  for (const line of lines) {
    const verdict = read(line);
    if (verdict !== undefined) return verdict;
  }
  return null;
}

/** The descriptor form, for the target types that need one. */
function readTarget(target: TriggerTarget, lines: readonly string[]): boolean | null {
  const read = createTriggerReader(target);
  for (const line of lines) {
    const verdict = read(line);
    if (verdict !== undefined) return verdict;
  }
  return null;
}

const agentTarget = (name: string = AGENT): TriggerTarget => ({
  type: "agent",
  matches: matcher(name),
});

const skillTarget = (name: string = SKILL): TriggerTarget => ({
  type: "skill",
  matches: matcher(name),
});

const toolStart = (name: string): string =>
  JSON.stringify({
    type: "stream_event",
    event: { type: "content_block_start", content_block: { type: "tool_use", name } },
  });

const toolInput = (partial: string): string =>
  JSON.stringify({
    type: "stream_event",
    event: { type: "content_block_delta", delta: { type: "input_json_delta", partial_json: partial } },
  });

const blockStop = (): string =>
  JSON.stringify({ type: "stream_event", event: { type: "content_block_stop" } });

const messageStop = (): string =>
  JSON.stringify({ type: "stream_event", event: { type: "message_stop" } });

const result = (): string => JSON.stringify({ type: "result", subtype: "success" });

/** One complete tool call: start, streamed input, stop. */
function call(name: string, input: Record<string, unknown>): string[] {
  return [toolStart(name), toolInput(JSON.stringify(input)), blockStop()];
}

describe("trigger reader: the consult itself", () => {
  test("Skill naming the skill at the first call is a trigger", () => {
    expect(readAll([...call("Skill", { skill: SKILL }), result()])).toBe(true);
  });

  test("Read matches only when the name is delimited the way the matcher expects", () => {
    // The Read branch is near-unreachable in practice and this records why rather than
    // asserting a capability that does not exist. The production matcher delimits on
    // whitespace and quotes, NOT on `/` or `:` -- deliberately, so a plugin-qualified
    // `<plugin>:<name>` cannot be credited to the candidate description. A real skill
    // path is slash-delimited, so it does not match.
    const realPath = `/tmp/x/.claude/skills/${SKILL}/SKILL.md`;
    expect(readAll([...call("Read", { file_path: realPath }), result()])).toBe(false);

    // Quote-delimited, as it appears in the streamed JSON of a bare-name reference.
    expect(readAll([...call("Read", { file_path: SKILL }), result()])).toBe(true);
  });

  test("a Skill call naming a different skill is not a trigger", () => {
    expect(readAll([...call("Skill", { skill: "brain:---memory" }), result()])).toBe(false);
  });
});

describe("trigger reader: reconnaissance does not close the window", () => {
  test("a consult after three Bash calls still counts", () => {
    // The measured shape this change exists for: Bash > Bash > Bash > Skill at call 4.
    const lines = [
      ...call("Bash", { command: "git status --short" }),
      ...call("Bash", { command: "git diff --stat" }),
      ...call("Bash", { command: "cat package.json" }),
      ...call("Skill", { skill: SKILL }),
      result(),
    ];
    expect(readAll(lines)).toBe(true);
  });

  test("a turn boundary between recon and the consult does not end the read", () => {
    // One tool call per turn was measured, so message_stop lands mid-sequence. Treating
    // it as a verdict would reintroduce the first-call window one turn out.
    const lines = [
      ...call("Bash", { command: "git status" }),
      messageStop(),
      ...call("Skill", { skill: SKILL }),
      result(),
    ];
    expect(readAll(lines)).toBe(true);
  });

  test("Grep and Glob are reconnaissance too", () => {
    const lines = [
      ...call("Grep", { pattern: "function" }),
      ...call("Glob", { pattern: "**/*.ts" }),
      ...call("Skill", { skill: SKILL }),
      result(),
    ];
    expect(readAll(lines)).toBe(true);
  });

  test("a Read of some other file does not consume the window", () => {
    const lines = [
      ...call("Read", { file_path: "/repo/src/cart.js" }),
      ...call("Skill", { skill: SKILL }),
      result(),
    ];
    expect(readAll(lines)).toBe(true);
  });
});

describe("trigger reader: a mutation closes the window", () => {
  test("Edit before any consult is a non-trigger", () => {
    // The real negative: the model committed to doing the work itself.
    expect(readAll([...call("Edit", { file_path: "/repo/a.js" }), result()])).toBe(false);
  });

  test("Write before any consult is a non-trigger", () => {
    expect(readAll([...call("Write", { file_path: "/repo/a.js" }), result()])).toBe(false);
  });

  test("NotebookEdit before any consult is a non-trigger", () => {
    expect(readAll([...call("NotebookEdit", { notebook_path: "/repo/a.ipynb" }), result()])).toBe(
      false,
    );
  });

  test("recon then Edit then a late consult is still a non-trigger", () => {
    // The window is already shut at the Edit, so a consult afterwards cannot reopen it.
    const lines = [
      ...call("Bash", { command: "git status" }),
      ...call("Edit", { file_path: "/repo/a.js" }),
      ...call("Skill", { skill: SKILL }),
      result(),
    ];
    expect(readAll(lines)).toBe(false);
  });

  test("a consult before an edit is a trigger, since order is what matters", () => {
    const lines = [
      ...call("Skill", { skill: SKILL }),
      ...call("Edit", { file_path: "/repo/a.js" }),
      result(),
    ];
    expect(readAll(lines)).toBe(true);
  });
});

describe("trigger reader: runs that never consult", () => {
  test("recon then a plain answer is a non-trigger", () => {
    const lines = [...call("Bash", { command: "ls" }), messageStop(), result()];
    expect(readAll(lines)).toBe(false);
  });

  test("no tool calls at all is a non-trigger", () => {
    // The case the removed `--max-turns 1` was kept for. The result event covers it.
    expect(readAll([messageStop(), result()])).toBe(false);
  });

  test("a stream that ends without a result event reaches no verdict", () => {
    // The caller maps this to false via the `exhausted` branch; the reader itself
    // must not invent a decision.
    expect(readAll([...call("Bash", { command: "ls" })])).toBe(null);
  });
});

describe("trigger reader: the plugin-qualified form must not count", () => {
  test("a plugin-qualified consult is not credited to the candidate", () => {
    // That is a different installation carrying its own shipped description, so
    // crediting it would measure the wrong artifact.
    expect(readAll([...call("Skill", { skill: `${SKILL}:${SKILL}` }), result()])).toBe(false);
  });

  test("a name that merely starts with ours is not a match", () => {
    expect(readAll([...call("Skill", { skill: "code-simplifier-pro" }), result()], SKILL)).toBe(
      false,
    );
  });
});

describe("trigger reader: malformed input", () => {
  test("a non-JSON line is skipped rather than throwing", () => {
    const lines = ["not json at all", ...call("Skill", { skill: SKILL }), result()];
    expect(readAll(lines)).toBe(true);
  });

  test("a JSON line that is not an object is skipped", () => {
    const lines = ["[1,2,3]", "null", ...call("Skill", { skill: SKILL }), result()];
    expect(readAll(lines)).toBe(true);
  });

  test("input split across several deltas still matches", () => {
    // Real streams fragment the JSON arbitrarily, so matching must survive a split
    // that lands mid-name.
    const lines = [
      toolStart("Skill"),
      toolInput('{"skill": "code-'),
      toolInput('simplifier"}'),
      blockStop(),
      result(),
    ];
    expect(readAll(lines)).toBe(true);
  });
});

describe("trigger reader: the agent path", () => {
  test("an Agent call naming the target agent is a delegation", () => {
    const lines = [
      ...call("Agent", { subagent_type: AGENT, prompt: "triage the failing spec" }),
      result(),
    ];
    expect(readTarget(agentTarget(), lines)).toBe(true);
  });

  test("the Task alias counts the same as Agent", () => {
    // Both names appear on the wire depending on the runtime's vintage, and they name
    // the same capability -- watching only one would score half the runs as refusals.
    const lines = [...call("Task", { subagent_type: AGENT, prompt: "triage" }), result()];
    expect(readTarget(agentTarget(), lines)).toBe(true);
  });

  test("a delegation to a different agent is not a trigger", () => {
    const lines = [...call("Agent", { subagent_type: "doc-writer" }), result()];
    expect(readTarget(agentTarget(), lines)).toBe(false);
  });

  test("the agent's name inside the PROMPT is not a delegation", () => {
    // The precision case the field extraction exists for. An `Agent` input carries a
    // whole prompt, and a prompt restating the user's request will often name the agent
    // in passing. Matching the accumulated blob -- which is what the skill path does,
    // safely, because a Skill input is small -- would credit this as a delegation the
    // description never won.
    const lines = [
      ...call("Agent", {
        subagent_type: "doc-writer",
        prompt: `the user asked whether ${AGENT} should handle this`,
      }),
      result(),
    ];
    expect(readTarget(agentTarget(), lines)).toBe(false);
  });

  test("reconnaissance before the delegation does not close the window", () => {
    // Same reasoning as the skill path: the model often cannot tell whether the agent
    // applies until it has seen the repository, so recon then delegate is the same
    // routing decision made a beat later.
    const lines = [
      ...call("Bash", { command: "git status --short" }),
      messageStop(),
      ...call("Grep", { pattern: "flaky" }),
      ...call("Agent", { subagent_type: AGENT }),
      result(),
    ];
    expect(readTarget(agentTarget(), lines)).toBe(true);
  });

  test("an Edit before the delegation is a non-trigger", () => {
    const lines = [
      ...call("Edit", { file_path: "/repo/spec.ts" }),
      ...call("Agent", { subagent_type: AGENT }),
      result(),
    ];
    expect(readTarget(agentTarget(), lines)).toBe(false);
  });

  test("reading the agent's own definition is inspection, not delegation", () => {
    // Crediting a Read here would score the description for provoking curiosity rather
    // than for winning the routing decision, so `Read` is absent from the agent's
    // consult set even though it is present in the skill's.
    const lines = [
      ...call("Read", { file_path: `.claude/agents/${AGENT}.md` }),
      messageStop(),
      result(),
    ];
    expect(readTarget(agentTarget(), lines)).toBe(false);
  });

  test("a Skill call naming the agent is not a delegation either", () => {
    const lines = [...call("Skill", { skill: AGENT }), result()];
    expect(readTarget(agentTarget(), lines)).toBe(false);
  });

  test("a plugin-qualified subagent_type is not credited to the candidate", () => {
    // That is a different installation carrying its own shipped description. The same
    // rejection the skill path makes, and it matters more here: an agent `name` may not
    // contain `:` at all, so a qualified form can only be another copy.
    const lines = [...call("Agent", { subagent_type: `mypack:${AGENT}` }), result()];
    expect(readTarget(agentTarget(), lines)).toBe(false);
  });

  test("an agent name that merely starts with ours is not a match", () => {
    const lines = [...call("Agent", { subagent_type: `${AGENT}-pro` }), result()];
    expect(readTarget(agentTarget(), lines)).toBe(false);
  });

  test("subagent_type split across deltas still matches", () => {
    const lines = [
      toolStart("Agent"),
      toolInput('{"subagent_type": "flake-'),
      toolInput('triager", "prompt": "go"}'),
      blockStop(),
      result(),
    ];
    expect(readTarget(agentTarget(), lines)).toBe(true);
  });

  test("a delegation in a complete assistant message is a trigger", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", name: "Bash", input: { command: "git status" } },
          { type: "tool_use", name: "Task", input: { subagent_type: AGENT, prompt: "go" } },
        ],
      },
    });
    expect(readTarget(agentTarget(), [line, result()])).toBe(true);
  });

  test("a mutation before the delegation in one message is a non-trigger", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", name: "Write", input: { file_path: "/repo/a.ts" } },
          { type: "tool_use", name: "Agent", input: { subagent_type: AGENT } },
        ],
      },
    });
    expect(readTarget(agentTarget(), [line, result()])).toBe(false);
  });

  test("a delegation is not a skill consult", () => {
    // The mirror of the case above, and the reason the descriptor carries a type at all:
    // an `Agent` call naming a skill must not be credited to that skill's description.
    const lines = [...call("Agent", { subagent_type: SKILL }), result()];
    expect(readTarget(skillTarget(), lines)).toBe(false);
  });
});

describe("trigger reader: a command reads exactly as a skill", () => {
  // Commands and skills have merged -- `.claude/commands/deploy.md` and
  // `.claude/skills/deploy/SKILL.md` both produce `/deploy` -- so the trigger signal is
  // the same `Skill` call, and this records that as an intended equivalence rather than
  // an accident of the implementation.
  test("a Skill call naming the command is a trigger", () => {
    const target: TriggerTarget = { type: "command", matches: matcher(SKILL) };
    expect(readTarget(target, [...call("Skill", { skill: SKILL }), result()])).toBe(true);
  });

  test("an Edit before it is a non-trigger", () => {
    const target: TriggerTarget = { type: "command", matches: matcher(SKILL) };
    expect(readTarget(target, [...call("Edit", { file_path: "/repo/a.js" }), result()])).toBe(
      false,
    );
  });
});

describe("trigger reader: the full-assistant-message fallback", () => {
  test("a consult in a complete assistant message is a trigger", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", name: "Skill", input: { skill: SKILL } }] },
    });
    expect(readAll([line, result()])).toBe(true);
  });

  test("recon before the consult in one message does not block it", () => {
    // The old rule returned at the first tool_use block whatever it decided, so this
    // scored false. Every block is now scanned in order.
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", name: "Bash", input: { command: "git status" } },
          { type: "tool_use", name: "Skill", input: { skill: SKILL } },
        ],
      },
    });
    expect(readAll([line, result()])).toBe(true);
  });

  test("a mutation before the consult in one message is a non-trigger", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", name: "Edit", input: { file_path: "/repo/a.js" } },
          { type: "tool_use", name: "Skill", input: { skill: SKILL } },
        ],
      },
    });
    expect(readAll([line, result()])).toBe(false);
  });
});
