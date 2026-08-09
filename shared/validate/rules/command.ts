/**
 * Command rules: a slash command's frontmatter, in either layout it ships in.
 *
 * A command is a skill wearing a different hat -- `skills/<name>/SKILL.md` with
 * `user-invocable`, or the older flat `commands/<name>.md`. The tier flags mean
 * the same thing they mean for a skill, because the six-field restriction bites
 * a command author from the packaging direction: a file headed for claude.ai
 * carries the six standard fields and nothing else.
 */

import { collisionSection } from "./collisions.ts";
import { describeType, isDirectory, parseFrontmatterBlock, pathExists, readText, resolvePath } from "../../parse/lib.ts";
import { RuleAbort, section, type RuleContext, type RuleModule, type Section } from "./types.ts";

const STANDARD_FIELDS: ReadonlySet<string> = new Set([
  "name", "description", "license", "allowed-tools", "metadata", "compatibility",
]);

/** Claude Code extensions a command actually uses. */
const COMMAND_EXTENSIONS: ReadonlySet<string> = new Set([
  "argument-hint", "arguments", "user-invocable", "disable-model-invocation",
  "model", "effort", "context", "agent", "background", "disallowed-tools",
  "when_to_use", "paths", "shell", "hooks", "version",
]);

/**
 * Extensions that fail open: ignored by another runtime, the guardrail vanishes
 * rather than degrading. Worth naming on a command specifically, because
 * `disable-model-invocation` is the field a destructive `/deploy` leans on.
 */
const FAIL_OPEN: readonly string[] = ["disable-model-invocation", "disallowed-tools", "paths"];

const DESCRIPTION_MAX = 1024;

export const commandRules: RuleModule = {
  targetType: "command",
  summary: "slash-command frontmatter, argument contract, and fail-open guardrails",
  honoursTier: true,
  honoursEnvironment: true,
  expects: "the command's SKILL.md, its skill directory, or a flat commands/<name>.md",

  async run(context: RuleContext): Promise<readonly Section[]> {
    let file = resolvePath(context.path);
    if (!(await pathExists(file))) throw new RuleAbort(`No such path: ${context.path}`);
    if (await isDirectory(file)) {
      const nested = `${file}/SKILL.md`;
      if (!(await pathExists(nested))) throw new RuleAbort(`No SKILL.md in ${context.path}`);
      file = nested;
    }

    const text = await readText(file);
    if (text === undefined) throw new RuleAbort(`Cannot read ${file}`);

    const loaded = parseFrontmatterBlock(text);
    if (!loaded.ok) return [section("Frontmatter", [loaded.error], [])];

    const { frontmatter, body } = loaded;
    const errors: string[] = [];
    const warnings: string[] = [];

    const description = frontmatter["description"];
    if (description === undefined) {
      warnings.push(
        "No `description`. A command a person only ever types works without one, but " +
          "Claude cannot invoke it on its own and it shows blank in the `/` menu.",
      );
    } else if (typeof description !== "string") {
      errors.push(`\`description\` must be a string, got ${describeType(description)}.`);
    } else if (description.length > DESCRIPTION_MAX) {
      warnings.push(`\`description\` is ${description.length} characters, past the ${DESCRIPTION_MAX} the standard allows.`);
    }

    for (const key of Object.keys(frontmatter).sort()) {
      if (STANDARD_FIELDS.has(key)) continue;
      if (COMMAND_EXTENSIONS.has(key)) {
        if (context.tier === "standard") {
          errors.push(
            `\`${key}\` is a Claude Code extension, not part of the portable field set. ` +
              `A file carrying it is rejected by claude.ai upload and the Skills API. ` +
              `Re-run with --extended when the command is staying in Claude Code.`,
          );
        }
        continue;
      }
      warnings.push(`\`${key}\` is not a field Claude Code reads on a command, so it is ignored.`);
    }

    const failOpen = FAIL_OPEN.filter((f) => frontmatter[f] !== undefined);
    if (failOpen.length > 0) {
      warnings.push(
        `${failOpen.map((f) => `\`${f}\``).join(", ")} fail open: another runtime that ignores ` +
          `the key loads the command without the restriction. OpenCode and VS Code both scan ` +
          `\`.claude/skills/\` directly, so this is live rather than hypothetical. Where one of ` +
          `these is the only thing standing between a user and a destructive action, the ` +
          `guardrail also has to exist in the body and in permission settings.`,
      );
    }

    // `argument-hint` is what the user reads in the `/` menu before deciding.
    // A command taking arguments without one leaves them guessing.
    const takesArguments = /\$ARGUMENTS|\$[1-9]/.test(body);
    if (takesArguments && frontmatter["argument-hint"] === undefined) {
      warnings.push(
        "The body substitutes arguments but there is no `argument-hint`, so the `/` menu " +
          "shows no clue what to type after the command name.",
      );
    }
    if (!takesArguments && frontmatter["argument-hint"] !== undefined) {
      warnings.push(
        "`argument-hint` promises arguments the body never substitutes — nothing reads " +
          "`$ARGUMENTS` or a positional, so whatever the user types is discarded.",
      );
    }

    if (body.trim() === "") errors.push("The body is empty, so the command does nothing.");

    // A command competes for triggers exactly as a skill does, so the same
    // check applies -- but only in the skill-shaped layout, which is where the
    // description lives that a neighbour would be absorbing.
    const skillMd = file.endsWith("/SKILL.md") ? file : undefined;
    return [
      section("Frontmatter", errors, warnings),
      await collisionSection(skillMd, context.withEnvironment),
    ];
  },
};
