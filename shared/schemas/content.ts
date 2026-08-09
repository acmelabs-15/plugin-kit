/**
 * Pure readings of SKILL.md text: where the body starts, and what the body
 * claims exists on disk.
 *
 * Both are mirrored from `../scripts/validate-skill.ts` rather than imported,
 * for the reason given in `./paths.ts`. Nothing here touches the filesystem --
 * `extractReferences` says what was referenced; deciding whether those
 * references resolve is the full layer's job.
 */

/**
 * The anchored `\n` is load-bearing and mirrored as-is: it means a
 * CRLF-terminated SKILL.md fails to match, exactly as the ported original does.
 */
export const FRONTMATTER_PATTERN = /^---\n([\s\S]*?)\n---/;

/**
 * The instruction body, with frontmatter removed.
 *
 * Size targets count this and not the whole file, because frontmatter is
 * metadata that loads separately from the instructions.
 */
export function skillBody(content: string): string {
  return content.replace(FRONTMATTER_PATTERN, "").trimStart();
}

/**
 * Relative path references extracted from SKILL.md.
 *
 * Two precision tiers, because a false "dangling reference" is worse than a
 * missed one: markdown link targets are unambiguous file references and are
 * always checked, whereas a backticked path is only checked when its first
 * segment is a directory that actually exists in the skill -- which anchors it
 * to real layout and skips illustrative placeholders like `path/to/your.md`.
 */
export function extractReferences(content: string): {
  readonly links: readonly string[];
  readonly candidates: readonly string[];
} {
  const links = new Set<string>();
  for (const match of content.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const target = cleanTarget(match[1]);
    if (target !== undefined) links.add(target);
  }
  const candidates = new Set<string>();
  for (const match of content.matchAll(/`([^`\n]+)`/g)) {
    const raw = match[1];
    if (raw === undefined) continue;
    if (!/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+$/.test(raw)) continue;
    if (raw.includes("..") || !/\.[A-Za-z0-9]{1,8}$/.test(raw)) continue;
    if (!links.has(raw)) candidates.add(raw);
  }
  return { links: [...links].sort(), candidates: [...candidates].sort() };
}

/** Normalise a markdown link target, or return undefined if it is not a local path. */
function cleanTarget(target: string | undefined): string | undefined {
  if (target === undefined || target === "") return undefined;
  if (target.startsWith("#") || target.startsWith("/") || target.startsWith("~")) return undefined;
  if (target.startsWith("//") || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(target)) return undefined;
  const withoutFragment = target.split("#")[0]?.split("?")[0] ?? "";
  if (withoutFragment === "" || withoutFragment.includes("..")) return undefined;
  try {
    return decodeURIComponent(withoutFragment);
  } catch {
    return withoutFragment;
  }
}
