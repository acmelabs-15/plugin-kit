/**
 * The one environment-dependent check, shared by the artifacts that have a
 * trigger surface to lose.
 *
 * A slash command competes for triggers exactly as a skill does -- it is a
 * SKILL.md with `user-invocable` on it -- so the check is the same check, and
 * duplicating it per artifact is how the two would drift.
 *
 * The refusal behaviour is the point of the module. `--with-environment` is a
 * claim that the answer accounts for what is installed. When the sweep could not
 * read a root that exists, the claim is false, and the honest response is to
 * fail rather than to print a clean report the author will believe.
 */

import {
  domainTerms,
  findNeighboursWithStatus,
  parseSkillFrontmatter,
  stripPushy,
  type Discovery,
} from "../../tools/check-overlap.ts";
import { baseName, readText } from "../../parse/lib.ts";
import { RuleAbort, section, type Section } from "./types.ts";

export const TITLE = "Trigger collisions";

export const NOT_CHECKED =
  "Collision checking was not performed. Whether an installed artifact will absorb this " +
  "one's triggers depends on what is installed, which this run did not read. Pass " +
  "`--with-environment` to include it.";

/**
 * Describe what the sweep saw, in the words a reader needs to judge it.
 *
 * Printed on success as well as failure. A collision report whose value depends
 * entirely on how much of the machine it managed to read should say how much of
 * the machine it managed to read.
 */
export function describeEnvironment(discovery: Discovery): string {
  const parts = discovery.roots.map(({ root, status, found }) =>
    status === "scanned" ? `\`${root}\` (${found} found)` : `\`${root}\` (${status})`,
  );
  return `Search roots: ${parts.join(", ")}.`;
}

/** Roots that exist and refuse to enumerate -- the blind spots worth refusing over. */
export function unreadableRoots(discovery: Discovery): readonly string[] {
  return discovery.roots.filter((r) => r.status === "unreadable").map((r) => r.root);
}

/**
 * Run the collision check against a SKILL.md, or say it was not run.
 *
 * `skillMd` is the path to the definition whose description is the trigger
 * surface; for a command in the flat `commands/<name>.md` layout there is none,
 * and the caller passes `undefined` so this can say so rather than guess.
 */
export async function collisionSection(
  skillMd: string | undefined,
  withEnvironment: boolean,
): Promise<Section> {
  if (!withEnvironment) return section(TITLE, [], [], NOT_CHECKED);
  if (skillMd === undefined) {
    throw new RuleAbort(
      "`--with-environment` needs a SKILL.md to read the trigger surface from, and this " +
        "target is a flat command file. Copy it into a skill-shaped directory first — the " +
        "measured loops need that shape anyway.",
    );
  }

  const text = await readText(skillMd);
  if (text === undefined) throw new RuleAbort(`Cannot read ${skillMd}`);

  const parsed = parseSkillFrontmatter(text);
  if (!parsed?.description) {
    throw new RuleAbort(`${skillMd} has no description in its frontmatter — nothing to compare.`);
  }

  const name = parsed.name || baseName(`${skillMd}/..`);
  const targetTerms = domainTerms(`${name} ${stripPushy(parsed.description)}`);
  const { neighbours, scanned, discovery } = await findNeighboursWithStatus({
    targetTerms,
    excludePath: skillMd,
  });

  if (discovery.homeless) {
    throw new RuleAbort(
      "`--with-environment` was requested but `HOME` is unset, so the user and plugin " +
        "skill roots cannot be located. Refusing to report a collision result that would " +
        "only mean 'nothing was read'.",
    );
  }
  const blind = unreadableRoots(discovery);
  if (blind.length > 0) {
    throw new RuleAbort(
      `\`--with-environment\` was requested but ${blind.length} search root(s) exist and ` +
        `could not be read: ${blind.join(", ")}. An artifact installed under one of those ` +
        `would not appear below, so this run cannot say whether the triggers are contested.`,
    );
  }

  // Shared vocabulary alone would flag every artifact in a domain, most of which
  // coexist fine. A collision needs pushy phrasing too.
  const collisions = neighbours.filter((n) => n.pushy.length > 0);
  const where = describeEnvironment(discovery);
  if (collisions.length === 0) {
    return section(
      TITLE,
      [],
      [],
      `No collisions. Scanned ${scanned} installed skill(s); none both shares this artifact's ` +
        `domain vocabulary and uses universal-quantifier phrasing. ${where}`,
    );
  }

  const errors = collisions.map(({ skill, shared, pushy }) => {
    const quotes = pushy.map((p) => `\`${p.label}\``).join(", ");
    return (
      `\`${skill.name}\` (${skill.origin}, \`${skill.path}\`) shares ${shared.length} domain ` +
      `term(s) — ${shared.map((t) => `\`${t}\``).join(", ")} — and claims triggers past its ` +
      `scope via ${quotes}. Expect it to win contested queries. The fix is on the neighbour: ` +
      `narrow it, drop the universal-quantifier clause, or uninstall it — rewriting this ` +
      `artifact's own description was measured and did not recover the triggers.`
    );
  });
  return section(TITLE, errors, [], `Scanned ${scanned} installed skill(s). ${where}`);
}
