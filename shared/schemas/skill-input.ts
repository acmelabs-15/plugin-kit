/**
 * Assembling the value the schema parses: read SKILL.md, split it, parse the
 * YAML, measure the body.
 *
 * These five failures stay OUT of the schema on purpose. They are fatal and
 * mutually exclusive -- there is no SKILL.md, or the frontmatter is not YAML --
 * and reporting one alongside a list of field findings would be reporting
 * findings about a document that was never read. That is why the original
 * validator fails fast here and enumerates everywhere else, and why this returns
 * a discriminated union rather than throwing.
 */

import { FRONTMATTER_PATTERN, skillBody } from "./content.ts";
import type { SkillCandidate, Tier } from "./skill.ts";

export type LoadOutcome =
  | { readonly ok: true; readonly input: SkillCandidate }
  | { readonly ok: false; readonly error: string };

/** `<skillDir>/SKILL.md`, tolerating a trailing slash and an empty directory. */
export function skillMdPath(skillDir: string): string {
  if (skillDir === "") return "SKILL.md";
  return skillDir.endsWith("/") ? `${skillDir}SKILL.md` : `${skillDir}/SKILL.md`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Count body tokens with a real tokenizer, or return undefined when there is
 * none. Never approximates -- the schema's token check is skipped, and said to
 * be skipped, rather than run against a guess.
 */
export async function countBodyTokens(body: string): Promise<number | undefined> {
  try {
    const { get_encoding } = await import("tiktoken");
    const encoding = get_encoding("cl100k_base");
    const tokens = encoding.encode(body).length;
    encoding.free();
    return tokens;
  } catch {
    return undefined;
  }
}

/** Read and structurally parse a skill directory into a value the schema accepts. */
export async function loadSkillInput(skillDir: string, tier: Tier): Promise<LoadOutcome> {
  const file = Bun.file(skillMdPath(skillDir));
  if (!(await file.exists())) return { ok: false, error: "SKILL.md not found." };

  const content = await file.text();
  if (!content.startsWith("---")) return { ok: false, error: "No YAML frontmatter found." };

  const match = FRONTMATTER_PATTERN.exec(content);
  if (match?.[1] === undefined) return { ok: false, error: "Invalid frontmatter format." };

  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(match[1]);
  } catch (error) {
    return { ok: false, error: `Invalid YAML in frontmatter: ${(error as Error).message}` };
  }
  if (!isRecord(parsed)) return { ok: false, error: "Frontmatter must be a YAML dictionary." };

  const body = skillBody(content);
  const bodyTokens = await countBodyTokens(body);
  const input: SkillCandidate = {
    skillDir,
    content,
    body,
    frontmatter: parsed,
    tier,
    ...(bodyTokens === undefined ? {} : { bodyTokens }),
  };
  return { ok: true, input };
}
