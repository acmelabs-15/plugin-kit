/**
 * Skill rules: structure, purity, and trigger collisions.
 *
 * The structural half is `../validate-skill.ts` unchanged -- it is
 * called, not reimplemented, so its field set, its messages and its
 * standard-versus-extended tiers stay the single source of truth. Likewise the
 * purity pass calls `../../tools/check-bun-purity.ts`, whose superset pre-filter
 * is what keeps a whole-repository scan in the tens of milliseconds; wrapping it
 * rather than reproducing it is the only way that stays true.
 *
 * The three used to be three commands an author ran in sequence and, in
 * practice, ran one of. They answer one question -- is this skill OK to ship --
 * and the reason they were separate was that the third needs to read the
 * machine, which the other two do not. That difference is now a flag rather than
 * a separate binary.
 */

import { checkDirectory } from "../../tools/check-bun-purity.ts";
import { validateSkill } from "../validate-skill.ts";
import { collisionSection } from "./collisions.ts";
import { isDirectory, pathExists, resolvePath } from "../../parse/lib.ts";
import { RuleAbort, section, type RuleContext, type RuleModule, type Section } from "./types.ts";

/** Purity, but only when the skill ships code -- otherwise it has nothing to say. */
async function puritySection(context: RuleContext): Promise<Section | undefined> {
  const root = resolvePath(context.path);
  if (!(await isDirectory(`${root}/scripts`))) return undefined;

  const { findings, filesScanned } = await checkDirectory(root);
  const errors = findings
    .filter((f) => f.severity === "error")
    .map((f) => `\`${f.line === 0 ? f.file : `${f.file}:${f.line}`}\` — **${f.rule}** — ${f.message} Fix: ${f.fix}`);
  const warnings = findings
    .filter((f) => f.severity === "warning")
    .map((f) => `\`${f.line === 0 ? f.file : `${f.file}:${f.line}`}\` — **${f.rule}** — ${f.message} Fix: ${f.fix}`);
  return section("Bun purity", errors, warnings, `${filesScanned} file(s) scanned.`);
}

export const skillRules: RuleModule = {
  targetType: "skill",
  summary: "SKILL.md frontmatter, body size, dangling references, purity, collisions",
  honoursTier: true,
  honoursEnvironment: true,
  expects: "the skill directory holding SKILL.md",

  async run(context: RuleContext): Promise<readonly Section[]> {
    const root = resolvePath(context.path);
    if (!(await pathExists(root))) throw new RuleAbort(`No such path: ${context.path}`);

    const result = await validateSkill(context.path, context.tier);
    const sections: Section[] = [section("Structure", result.errors, result.warnings)];

    const purity = await puritySection(context);
    if (purity !== undefined) sections.push(purity);

    sections.push(await collisionSection(`${root}/SKILL.md`, context.withEnvironment));
    return sections;
  },
};
