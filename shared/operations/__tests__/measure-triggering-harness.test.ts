/**
 * Trigger-harness tests for measure-triggering.
 *
 * The harness measures a REAL artifact: it copies the skill directory (or the agent's
 * single `.md`) into a throwaway project root, substitutes the candidate description,
 * and asks whether the router names it. These tests cover that installation -- the
 * description substitution in particular, since a candidate can contain colons, quotes
 * and newlines that would corrupt a single-line YAML value -- plus the name matching,
 * plus the sweep that clears artifacts an interrupted run left behind.
 *
 * Nothing here spawns `claude`. The subprocess boundary is covered elsewhere; the
 * file bookkeeping around it had no coverage at all, and is where the bugs lived.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import {
  installFileTargetForTrigger,
  installSkillForTrigger,
  installTargetForTrigger,
  readTargetDefinition,
  resolveTargetFile,
} from "../measure-triggering.ts";

const SKILL = "demo-skill";
const AGENT = "demo-agent";
let root = "";

beforeEach(async () => {
  root = `${process.env["TMPDIR"] ?? "/tmp"}/measure-triggering-stubs-${crypto.randomUUID().slice(0, 8)}`;
  await Bun.write(`${root}/.keep`, "");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("installSkillForTrigger", () => {
  async function install(description: string) {
    const skill = `${root}/src-skill`;
    await Bun.write(`${skill}/SKILL.md`, "---\nname: demo-skill\ndescription: old one\n---\n\n# demo-skill\n\nReal body.\n");
    await Bun.write(`${skill}/references/detail.md`, "reference content\n");
    const { root: installed, alias } = await installSkillForTrigger(skill, SKILL, description);
    const text = await Bun.file(`${installed}/.claude/skills/${alias}/SKILL.md`).text();
    return { installed, alias, text };
  }

  test("installs at .claude/skills/<alias>/, the location Claude loads from", async () => {
    const { installed, alias } = await install("candidate");
    expect(await Bun.file(`${installed}/.claude/skills/${alias}/SKILL.md`).exists()).toBe(true);
    await rm(installed, { recursive: true, force: true });
  });

  test("the alias is unique per install, so nothing already on the machine competes", async () => {
    // Installing under the skill's own name put the copy in direct competition with a
    // plugin-bundled copy of itself -- the normal case, since you install a skill to use
    // it. The router picked the plugin, whose `<plugin>:<name>` form the matcher rejects
    // because it carries the SHIPPED description, and 200 attempts scored zero.
    const a = await install("candidate");
    const b = await install("candidate");
    expect(a.alias).not.toBe(b.alias);
    expect(a.alias.startsWith(`${SKILL}-t`)).toBe(true);
    await rm(a.installed, { recursive: true, force: true });
    await rm(b.installed, { recursive: true, force: true });
  });

  test("the name field is rewritten to the alias, so the artifact stays consistent", async () => {
    // The directory is what Claude Code invokes a project-scoped skill by, so the
    // directory is what must be unique. `name` follows so the file still satisfies the
    // standard's stricter validator, which requires the two to agree.
    const { installed, alias, text } = await install("candidate");
    expect(text).toContain(`name: ${alias}`);
    // Scoped to the frontmatter deliberately: the body's `# demo-skill` heading is part
    // of what installing the real skill preserves, so a whole-file assertion would fail
    // on content that is supposed to be there.
    const frontmatter = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "";
    expect(frontmatter).not.toContain("demo-skill\n");
    await rm(installed, { recursive: true, force: true });
  });

  test("substitutes the candidate description and drops the old one", async () => {
    const { installed, text } = await install("candidate description here");
    expect(text).toContain("candidate description here");
    expect(text).not.toContain("old one");
    await rm(installed, { recursive: true, force: true });
  });

  test("preserves the real body and bundled references", async () => {
    // The whole point of installing the skill rather than a placeholder: what ships
    // is what gets measured, including files a stub never had.
    const { installed, alias, text } = await install("candidate");
    expect(text).toContain("Real body.");
    expect(await Bun.file(`${installed}/.claude/skills/${alias}/references/detail.md`).text())
      .toBe("reference content\n");
    await rm(installed, { recursive: true, force: true });
  });

  test("survives a candidate containing colons, quotes and newlines", async () => {
    // A single-line YAML value would break on any of these; the block scalar does not.
    const nasty = 'Converts X: does "things", and\nspans lines.';
    const { installed, text } = await install(nasty);
    for (const fragment of ['Converts X: does "things", and', "spans lines."]) {
      expect(text).toContain(fragment);
    }
    // Still parseable as frontmatter, which is what the loader requires.
    expect(/^---\r?\n[\s\S]*?\r?\n---/.test(text)).toBe(true);
    await rm(installed, { recursive: true, force: true });
  });

  test("keeps other frontmatter keys, such as name", async () => {
    const { installed, text } = await install("candidate");
    expect(text).toContain("name: demo-skill");
    await rm(installed, { recursive: true, force: true });
  });
});

describe("installFileTargetForTrigger, for an agent", () => {
  const AGENT_SOURCE = [
    "---",
    `name: ${AGENT}`,
    "description: |",
    "  the shipped description",
    "  continued on a second line",
    "tools: [\"Read\", \"Grep\"]",
    "model: inherit",
    "---",
    "",
    `# ${AGENT}`,
    "",
    "You triage flaky specs.",
    "",
  ].join("\n");

  async function install(description: string) {
    const file = `${root}/agents/${AGENT}.md`;
    await Bun.write(file, AGENT_SOURCE);
    const { root: installed, alias } = await installFileTargetForTrigger(
      file,
      AGENT,
      description,
      "agents",
    );
    const text = await Bun.file(`${installed}/.claude/agents/${alias}.md`).text();
    return { installed, alias, text };
  }

  test("installs at .claude/agents/<alias>.md, the location Claude loads from", async () => {
    const { installed, alias } = await install("candidate");
    expect(await Bun.file(`${installed}/.claude/agents/${alias}.md`).exists()).toBe(true);
    await rm(installed, { recursive: true, force: true });
  });

  test("the alias contains no colon, which an agent name may not carry", async () => {
    // `:` is reserved for plugin scoping and a subagent file breaking the rule is
    // SILENTLY not loaded -- so a colon-scoped alias would produce a run in which
    // nothing is installed at all, scoring every query zero and looking exactly like a
    // description that never triggers.
    const { installed, alias } = await install("candidate");
    expect(alias).not.toContain(":");
    expect(alias.startsWith(`${AGENT}-t`)).toBe(true);
    await rm(installed, { recursive: true, force: true });
  });

  test("the alias is unique per install, so no other agent on the machine competes", async () => {
    const a = await install("candidate");
    const b = await install("candidate");
    expect(a.alias).not.toBe(b.alias);
    await rm(a.installed, { recursive: true, force: true });
    await rm(b.installed, { recursive: true, force: true });
  });

  test("the name field is rewritten, because it is what subagent_type matches", async () => {
    // Unlike a skill, whose project-scope identity is its DIRECTORY name, an agent's
    // identity is this field. If it were left alone the delegation would answer as the
    // shipped name and the harness would credit the wrong installation.
    const { installed, alias, text } = await install("candidate");
    expect(text).toContain(`name: ${alias}`);
    const frontmatter = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "";
    expect(frontmatter).not.toContain(`name: ${AGENT}\n`);
    await rm(installed, { recursive: true, force: true });
  });

  test("substitutes the candidate description and drops every line of the old one", async () => {
    // The shipped description is a block scalar spanning two lines, so this also covers
    // the continuation-line rule: an indented line belongs to the key above it.
    const { installed, text } = await install("candidate description here");
    expect(text).toContain("candidate description here");
    expect(text).not.toContain("the shipped description");
    expect(text).not.toContain("continued on a second line");
    await rm(installed, { recursive: true, force: true });
  });

  test("keeps the tool grant and the system prompt as authored", async () => {
    // The agent equivalent of measuring the real skill rather than a stub: the grant
    // and the body are what make the artifact behave the way it ships.
    const { installed, text } = await install("candidate");
    expect(text).toContain('tools: ["Read", "Grep"]');
    expect(text).toContain("You triage flaky specs.");
    await rm(installed, { recursive: true, force: true });
  });

  test("survives a candidate containing colons, quotes and newlines", async () => {
    const nasty = 'Delegates X: does "things", and\nspans lines.';
    const { installed, text } = await install(nasty);
    for (const fragment of ['Delegates X: does "things", and', "spans lines."]) {
      expect(text).toContain(fragment);
    }
    expect(/^---\r?\n[\s\S]*?\r?\n---/.test(text)).toBe(true);
    await rm(installed, { recursive: true, force: true });
  });

  test("installTargetForTrigger routes an agent to the agents directory", async () => {
    const file = `${root}/agents/${AGENT}.md`;
    await Bun.write(file, AGENT_SOURCE);
    const { root: installed, alias } = await installTargetForTrigger({
      targetPath: file,
      targetType: "agent",
      name: AGENT,
      description: "candidate",
    });
    expect(await Bun.file(`${installed}/.claude/agents/${alias}.md`).exists()).toBe(true);
    await rm(installed, { recursive: true, force: true });
  });

  test("installTargetForTrigger routes a bare-.md command to the commands directory", async () => {
    // Commands and skills have merged, so a command spelled as a directory installs as a
    // skill; only the single-file spelling needs its own destination.
    const file = `${root}/commands/ship.md`;
    await Bun.write(file, "---\nname: ship\ndescription: old\n---\n\nShip it.\n");
    const { root: installed, alias } = await installTargetForTrigger({
      targetPath: file,
      targetType: "command",
      name: "ship",
      description: "candidate",
    });
    expect(await Bun.file(`${installed}/.claude/commands/${alias}.md`).exists()).toBe(true);
    await rm(installed, { recursive: true, force: true });
  });

  test("installTargetForTrigger routes a command DIRECTORY through the skill installer", async () => {
    const dir = `${root}/skills/ship`;
    await Bun.write(`${dir}/SKILL.md`, "---\nname: ship\ndescription: old\n---\n\nShip it.\n");
    const { root: installed, alias } = await installTargetForTrigger({
      targetPath: dir,
      targetType: "command",
      name: "ship",
      description: "candidate",
    });
    expect(await Bun.file(`${installed}/.claude/skills/${alias}/SKILL.md`).exists()).toBe(true);
    await rm(installed, { recursive: true, force: true });
  });
});

describe("resolving and reading a target definition", () => {
  test("a skill resolves to its SKILL.md", async () => {
    expect(await resolveTargetFile("/tmp/x/my-skill", "skill")).toBe("/tmp/x/my-skill/SKILL.md");
  });

  test("an agent resolves to the file itself", async () => {
    expect(await resolveTargetFile("/tmp/x/agents/a.md", "agent")).toBe("/tmp/x/agents/a.md");
  });

  test("a command directory resolves to SKILL.md, a command file to itself", async () => {
    const dir = `${root}/cmd-dir`;
    await Bun.write(`${dir}/SKILL.md`, "---\nname: c\ndescription: d\n---\n");
    const file = `${root}/cmd-file.md`;
    await Bun.write(file, "---\nname: c\ndescription: d\n---\n");
    expect(await resolveTargetFile(dir, "command")).toBe(`${dir}/SKILL.md`);
    expect(await resolveTargetFile(file, "command")).toBe(file);
  });

  test("an agent's name and description are read from its frontmatter", async () => {
    const file = `${root}/agents/reader.md`;
    await Bun.write(file, "---\nname: reader\ndescription: reads things\n---\n\nBody.\n");
    const parsed = await readTargetDefinition(file, "agent");
    expect(parsed.name).toBe("reader");
    expect(parsed.description).toBe("reads things");
    // `content` is the WHOLE file, frontmatter included -- that is what the loop hands
    // the improvement model as context about what the artifact does.
    expect(parsed.content).toContain("Body.");
  });

  // The defect this pins: the hand-rolled reader ends a block scalar at the first line
  // not opening with two spaces or a tab. A blank line opens with neither, so it stopped
  // at the paragraph break and returned the opening sentence alone -- about a fifth of
  // every `agents/*-reviewer.md` description, with all `<example>` blocks gone. Nothing
  // asserted the tail survived, so a measurement of a fifth of a description looked fine,
  // and an optimize run would have written that fifth back as the real one.
  test("an agent description keeps everything after a blank line, examples included", async () => {
    const file = `${root}/agents/blank-line.md`;
    await Bun.write(
      file,
      [
        "---",
        "name: blank-line",
        "description: |",
        "  Use when the opening paragraph is only the first of several.",
        "",
        "  Do not use when a later paragraph would change the answer.",
        "",
        "  <example>",
        "  user: 'a question'",
        "  assistant: 'an answer'",
        "  </example>",
        "---",
        "",
        "Body.",
        "",
      ].join("\n"),
    );

    const { description } = await readTargetDefinition(file, "agent");

    expect(description).toContain("Use when the opening paragraph");
    // Everything past the first blank line: the truncation dropped all of this.
    expect(description).toContain("Do not use when a later paragraph");
    expect(description).toContain("<example>");
    expect(description).toContain("assistant: 'an answer'");
    expect(description).toContain("</example>");
    // The blank lines are structure, not padding -- they separate the paragraphs the
    // router reads, so a reader that kept the text but flattened it is not a pass.
    expect(description).toBe(
      "Use when the opening paragraph is only the first of several.\n" +
        "\n" +
        "Do not use when a later paragraph would change the answer.\n" +
        "\n" +
        "<example>\n" +
        "user: 'a question'\n" +
        "assistant: 'an answer'\n" +
        "</example>",
    );
  });

  // The same defect, on the other artifact type that reaches this reader. Four of the
  // five shipped skills lost 22-40% of their description this way -- less spectacular
  // than the agents' 78-81% only because their second paragraph is shorter, not because
  // anything protected them.
  test("a skill description keeps everything after a blank line", async () => {
    const skill = `${root}/src-skill-blank`;
    await Bun.write(
      `${skill}/SKILL.md`,
      [
        "---",
        "name: blank-line-skill",
        "description: |",
        "  Use when the first paragraph is only part of the trigger.",
        "",
        "  Do not use when the second paragraph rules the case out.",
        "---",
        "",
        "Body.",
        "",
      ].join("\n"),
    );

    const { name, description } = await readTargetDefinition(skill, "skill");

    expect(name).toBe("blank-line-skill");
    expect(description).toContain("Use when the first paragraph");
    // The negative clause lives past the blank line, and a description that keeps only
    // the positive half triggers on cases its author explicitly excluded.
    expect(description).toContain("Do not use when the second paragraph");
    expect(description).toBe(
      "Use when the first paragraph is only part of the trigger.\n" +
        "\n" +
        "Do not use when the second paragraph rules the case out.",
    );
  });
});

describe("trigger matching names the real skill", () => {
  // Mirrors the predicate in runSingleQuery. The skill is installed under its real
  // name, so a trigger is the router naming it -- there is no stub infix any more.
  const escape = (l: string) => l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matchesSkill = (value: string, skillName: string): boolean =>
    new RegExp(`(^|[\\s"':/])${escape(skillName)}($|[\\s"',/])`).test(value);

  test("matches the bare name", () => {
    expect(matchesSkill(`{"skill": "${SKILL}"}`, SKILL)).toBe(true);
  });

  test("matches a plugin-qualified name", () => {
    expect(matchesSkill(`{"skill": "mypack:${SKILL}"}`, SKILL)).toBe(true);
  });

  test("does not match a different skill", () => {
    expect(matchesSkill('{"skill": "other-thing"}', SKILL)).toBe(false);
  });

  test("does not match a name that merely starts with ours", () => {
    expect(matchesSkill('{"skill": "demo-skill-helper"}', SKILL)).toBe(false);
  });

  test("does not match a name that contains ours mid-word", () => {
    expect(matchesSkill('{"skill": "predemo-skill"}', SKILL)).toBe(false);
  });
});

