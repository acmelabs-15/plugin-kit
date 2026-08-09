/**
 * The one place that knows which artifacts exist.
 *
 * Adding a sixth is a module in this directory and a line here. The entry
 * point never learns the difference, and `--help` is generated from this map, so
 * a new artifact documents itself.
 */

import { agentRules } from "./agent.ts";
import { commandRules } from "./command.ts";
import { mcpRules } from "./mcp.ts";
import { pluginRules } from "./plugin.ts";
import { skillRules } from "./skill.ts";
import type { RuleModule } from "./types.ts";

export const RULES: Readonly<Record<string, RuleModule>> = {
  skill: skillRules,
  agent: agentRules,
  command: commandRules,
  mcp: mcpRules,
  plugin: pluginRules,
};

/** Declaration order, which is also the order `--help` lists them. */
export const TARGET_TYPES: readonly string[] = Object.keys(RULES);
