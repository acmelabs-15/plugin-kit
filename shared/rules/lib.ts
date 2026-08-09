/**
 * Reading and frontmatter helpers the rules modules share.
 *
 * Real YAML here, deliberately. `../scripts/lib/frontmatter.ts` is a
 * hand-rolled reader whose quirks reproduce a specific Python parser for skills
 * this plugin owns; a validator reads arbitrary third-party artifacts and wants
 * to see what the loader sees. `../scripts/validate-skill.ts` and
 * `../scripts/check-overlap.ts` both make the same choice for the same reason.
 */

import { readdir, stat } from "node:fs/promises";

const FRONTMATTER = /^---\n([\s\S]*?)\n---/;

export async function pathExists(p: string): Promise<boolean> {
  try {
    // `Bun.file().exists()` reports false for directories, so stat() is required.
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

export async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

export async function readText(p: string): Promise<string | undefined> {
  try {
    return await Bun.file(p).text();
  } catch {
    return undefined;
  }
}

export async function listDirectory(p: string): Promise<readonly string[]> {
  try {
    return (await readdir(p)).sort();
  } catch {
    return [];
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Describe a value's type for error messages. */
export function describeType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

export type FrontmatterOutcome =
  | { readonly ok: true; readonly frontmatter: Record<string, unknown>; readonly body: string }
  | { readonly ok: false; readonly error: string };

/** Parse `---`-delimited YAML frontmatter out of a markdown file's text. */
export function parseFrontmatterBlock(content: string): FrontmatterOutcome {
  if (!content.startsWith("---")) return { ok: false, error: "No YAML frontmatter found." };
  const match = FRONTMATTER.exec(content);
  if (match?.[1] === undefined) return { ok: false, error: "Invalid frontmatter format." };

  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(match[1]);
  } catch (error) {
    return { ok: false, error: `Invalid YAML in frontmatter: ${(error as Error).message}` };
  }
  if (!isRecord(parsed)) return { ok: false, error: "Frontmatter must be a YAML mapping." };
  return { ok: true, frontmatter: parsed, body: content.replace(FRONTMATTER, "").trimStart() };
}

/** Resolve a possibly-relative path to an absolute, normalised one. */
export function resolvePath(p: string): string {
  const absolute = p.startsWith("/") ? p : `${process.cwd()}/${p}`;
  const segments: string[] = [];
  for (const segment of absolute.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return `/${segments.join("/")}`;
}

/** Final path segment, ignoring trailing slashes. */
export function baseName(p: string): string {
  const resolved = resolvePath(p);
  const index = resolved.lastIndexOf("/");
  return index === -1 ? resolved : resolved.slice(index + 1);
}

export function directoryOf(p: string): string {
  const resolved = resolvePath(p);
  const index = resolved.lastIndexOf("/");
  return index <= 0 ? "/" : resolved.slice(0, index);
}

/**
 * The plugin-root anchor, left unexpanded here on purpose.
 *
 * A path inside a plugin is written against this token rather than resolved, so
 * a checker that wants to know whether the file exists has to substitute a real
 * root first. Split across a concatenation because a skill body is injected with
 * shell-style substitution applied, and the literal braced form would arrive
 * already expanded.
 */
export const PLUGIN_ROOT_TOKEN = "$" + "{CLAUDE_PLUGIN_ROOT}";
export const OTHER_ANCHORS = ["$" + "{CLAUDE_SKILL_DIR}", "$" + "{CLAUDE_PROJECT_DIR}"];

/** Substitute the plugin-root anchor so a declared path can be checked on disk. */
export function expandAnchors(value: string, pluginRoot: string): string {
  let out = value.split(PLUGIN_ROOT_TOKEN).join(pluginRoot);
  for (const anchor of OTHER_ANCHORS) out = out.split(anchor).join(pluginRoot);
  return out;
}
