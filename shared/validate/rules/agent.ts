/**
 * Agent rules: the frontmatter an agent definition actually carries.
 *
 * The standard does not cover agents at all, so there is no portable subset to
 * check against and the tier flags mean nothing here. What there is instead is a
 * casing fork worth catching mechanically: agent frontmatter is camelCase while
 * skill frontmatter is kebab-case, and a kebab-case key in an agent file is
 * silently ignored rather than rejected. `../references/portability.md` has the
 * argument; this module is the check.
 */

import { describeType, parseFrontmatterBlock, pathExists, readText, resolvePath } from "../../parse/lib.ts";
import { RuleAbort, section, type RuleContext, type RuleModule, type Section } from "./types.ts";

/** Fields Claude Code reads on an agent definition. */
export const AGENT_FIELDS: ReadonlySet<string> = new Set([
  "name", "description", "tools", "disallowedTools", "model", "permissionMode",
  "maxTurns", "mcpServers", "initialPrompt", "skills", "color", "hooks",
]);

/**
 * Fields that are meaningful in a standalone agent file and ignored inside a
 * plugin. They buy nothing while looking like they bought something, which is
 * the worst way for a setting to fail.
 */
export const PLUGIN_IGNORED_FIELDS: readonly string[] = ["permissionMode", "mcpServers", "hooks"];

/** The kebab spellings authors reach for, and the camelCase key each one means. */
const KEBAB_CONFUSIONS: Readonly<Record<string, string>> = {
  "disallowed-tools": "disallowedTools",
  "allowed-tools": "tools",
  "permission-mode": "permissionMode",
  "max-turns": "maxTurns",
  "mcp-servers": "mcpServers",
  "initial-prompt": "initialPrompt",
  "argument-hint": "(no agent equivalent)",
  when_to_use: "description",
};

const NAME_PATTERN = /^[a-z0-9-]+$/;
const DESCRIPTION_MAX = 1024;

export const agentRules: RuleModule = {
  targetType: "agent",
  summary: "agent frontmatter: required fields, camelCase keys, plugin-ignored settings",
  honoursTier: false,
  honoursEnvironment: false,
  expects: "the agent's markdown file",

  async run(context: RuleContext): Promise<readonly Section[]> {
    const file = resolvePath(context.path);
    if (!(await pathExists(file))) throw new RuleAbort(`No such path: ${context.path}`);

    const text = await readText(file);
    if (text === undefined) throw new RuleAbort(`Cannot read ${file}`);

    const loaded = parseFrontmatterBlock(text);
    if (!loaded.ok) return [section("Frontmatter", [loaded.error], [])];

    const { frontmatter, body } = loaded;
    const errors: string[] = [];
    const warnings: string[] = [];

    // Unlike a skill, both of these are required and neither defaults from the
    // filename. An agent missing either is not delegated to at all.
    const name = frontmatter["name"];
    if (name === undefined) {
      errors.push("Missing `name`. Unlike a skill, an agent does not fall back to its filename.");
    } else if (typeof name !== "string") {
      errors.push(`\`name\` must be a string, got ${describeType(name)}.`);
    } else if (!NAME_PATTERN.test(name.trim())) {
      errors.push(`\`name\` '${name}' should be kebab-case (lowercase letters, digits, hyphens).`);
    }

    const description = frontmatter["description"];
    if (description === undefined) {
      errors.push(
        "Missing `description`. It is the entire delegation surface — Claude reads it and " +
          "nothing else when deciding whether to hand work to this agent.",
      );
    } else if (typeof description !== "string") {
      errors.push(`\`description\` must be a string, got ${describeType(description)}.`);
    } else if (description.trim() === "") {
      errors.push("`description` is empty, so nothing will ever delegate to this agent.");
    } else if (description.length > DESCRIPTION_MAX) {
      warnings.push(`\`description\` is ${description.length} characters; past ${DESCRIPTION_MAX} the tail stops being read.`);
    }

    for (const key of Object.keys(frontmatter).sort()) {
      if (AGENT_FIELDS.has(key)) continue;
      const meant = KEBAB_CONFUSIONS[key];
      if (meant !== undefined) {
        errors.push(
          `\`${key}\` is skill frontmatter spelling. Agent frontmatter is camelCase, and an ` +
            `unrecognised key here is ignored rather than rejected — write \`${meant}\`.`,
        );
      } else {
        warnings.push(`\`${key}\` is not a field Claude Code reads on an agent, so it is ignored.`);
      }
    }

    const ignored = PLUGIN_IGNORED_FIELDS.filter((f) => frontmatter[f] !== undefined);
    if (ignored.length > 0) {
      warnings.push(
        `${ignored.map((f) => `\`${f}\``).join(", ")} ${ignored.length === 1 ? "is" : "are"} ` +
          `ignored for a plugin-bundled agent. Meaningful in a standalone \`agents/\` file, ` +
          `silently inert inside a plugin — check which this is before relying on it.`,
      );
    }

    if (body.trim() === "") {
      errors.push("The body is empty. It is the agent's system prompt; without it there is no agent.");
    }

    return [section("Frontmatter", errors, warnings)];
  },
};
