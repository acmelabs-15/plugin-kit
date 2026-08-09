/**
 * The SKILL artifact as a schema, in two layers.
 *
 * `SkillShape` is pure: it is handed the already-read text and the already-parsed
 * frontmatter, and it decides everything that can be decided from those -- field
 * presence, types, limits, tier-dependent severity. A test of the description
 * ceiling needs no filesystem, no YAML, and no tokenizer. The rules themselves
 * live in `./skill-fields.ts`; this file only composes them.
 *
 * `SkillFull` adds what only the disk can answer: whether the paths SKILL.md
 * points at exist, and whether the token target was measurable at all. It is the
 * same schema plus a second refinement, so a full parse still reports every pure
 * finding -- refinements chain, they do not replace.
 */

import { z } from "zod@4.1.0";

import { extractReferences } from "./content.ts";
import { resolvePath } from "./paths.ts";
import { addError, addWarning, type IssueSink } from "./severity.ts";
import {
  TIERS,
  checkAllowedKeys,
  checkBodySize,
  checkCompatibility,
  checkDescription,
  checkDirectoryName,
  checkName,
  tokenCountSkippedMessage,
} from "./skill-fields.ts";

export {
  BODY_LINES_MAX,
  BODY_TOKENS_MAX,
  CLAUDE_CODE_EXTENSIONS,
  COMPATIBILITY_MAX,
  DESCRIPTION_HARD_MAX,
  DESCRIPTION_MAX,
  NAME_MAX,
  STANDARD_FIELDS,
  TIERS,
  bodyLineCount,
  tokenCountSkippedMessage,
} from "./skill-fields.ts";
export type { Tier } from "./skill-fields.ts";

/**
 * Everything the two layers need, with nothing they have to go and fetch.
 *
 * `content` is the whole file because references are extracted from the whole
 * file; `body` is derived from it by `./content.ts`. `bodyTokens` is optional
 * because a real tokenizer may not be installed, and the pure layer must not
 * care either way.
 */
export const SkillShape = z
  .object({
    skillDir: z.string().min(1),
    content: z.string(),
    body: z.string(),
    frontmatter: z.record(z.string(), z.unknown()),
    tier: z.enum(TIERS),
    bodyTokens: z.number().int().nonnegative().optional(),
  })
  .superRefine((value, ctx) => {
    checkAllowedKeys(value.frontmatter, value.tier, ctx);
    const name = checkName(value.frontmatter, ctx);
    checkDescription(value.frontmatter, value.tier, ctx);
    checkCompatibility(value.frontmatter, ctx);
    checkDirectoryName(name, value.skillDir, ctx);
    checkBodySize(value.body, value.bodyTokens, ctx);
  });

export type SkillCandidate = z.output<typeof SkillShape>;

/** `Bun.file().exists()` reports false for directories, so `stat()` is required. */
async function pathExists(p: string): Promise<boolean> {
  try {
    await Bun.file(p).stat();
    return true;
  } catch {
    return false;
  }
}

async function checkDanglingReferences(
  content: string,
  skillDir: string,
  ctx: IssueSink,
): Promise<void> {
  const root = resolvePath(skillDir);
  const { links, candidates } = extractReferences(content);

  for (const link of links) {
    if (!(await pathExists(`${root}/${link}`))) {
      addError(ctx, `Dangling reference: SKILL.md links to \`${link}\`, which does not exist.`, [
        "content",
      ]);
    }
  }
  for (const candidate of candidates) {
    const firstSegment = candidate.split("/")[0] ?? "";
    if (!(await pathExists(`${root}/${firstSegment}`))) continue;
    if (!(await pathExists(`${root}/${candidate}`))) {
      addError(
        ctx,
        `Dangling reference: SKILL.md mentions \`${candidate}\`, which does not exist.`,
        ["content"],
      );
    }
  }
}

/**
 * The pure layer plus the checks that read the disk. Async by construction, so
 * it must be parsed with `parseAsync` / `safeParseAsync`.
 */
export const SkillFull = SkillShape.superRefine(async (value, ctx) => {
  if (value.bodyTokens === undefined) {
    addWarning(ctx, tokenCountSkippedMessage(value.body), ["bodyTokens"]);
  }
  await checkDanglingReferences(value.content, value.skillDir, ctx);
});
