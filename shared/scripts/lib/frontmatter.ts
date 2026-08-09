/**
 * Port of skill-creator's `utils.parse_skill_md` (scripts/utils.py).
 *
 * This is a HAND-ROLLED frontmatter reader, NOT a YAML parser, and every one of
 * its quirks is load-bearing -- callers depend on the exact values it produces
 * for skills that a real YAML parser would read differently. Substituting
 * `Bun.YAML.parse` here would be a silent behaviour change. (`validate-skill.ts`
 * deliberately uses real YAML instead; the two parsers coexist on purpose.)
 *
 * Preserved quirks, each covered by a test in __tests__/frontmatter.test.ts:
 *
 *   1. Key lookup is a RAW-LINE PREFIX test (`line.startswith("name:")`), so an
 *      indented `  name:` misses, `name : v` misses, and `name:v` matches. The
 *      colon is part of the prefix, so `name_extra:` does not match either.
 *   2. The loop never breaks, so the LAST occurrence of a key wins.
 *   3. Value cleaning is Python's `.strip().strip('"').strip("'")` -- each of
 *      those removes REPEATED characters, so `""double""` -> `double`, and the
 *      fixed order means `'"mixed"'` -> `"mixed"`.
 *   4. Block scalars are recognised only for the exact values `>`, `|`, `>-`
 *      and `|-` (not `|+`, `>+` or `|2`), and continuation lines are joined
 *      with a single space -- so newlines are lost even for literal `|`.
 *
 * Whitespace trimming uses `pyStrip`, not JS `.trim()`. The two disagree on
 * U+FEFF (JS strips it, Python does not) and on U+001C-U+001F / U+0085 (Python
 * strips them, JS does not). The BOM case is reachable in practice: a
 * BOM-prefixed SKILL.md is rejected by CPython, so it must be rejected here too.
 */

/**
 * Characters for which CPython's `str.isspace()` returns true.
 *
 * Differs from the set JS `.trim()` removes in both directions: U+001C-U+001F
 * and U+0085 are Python-only, U+FEFF is JS-only and deliberately absent here.
 */
const PY_WHITESPACE_CODEPOINTS: readonly number[] = [
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x85, 0xa0,
  0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007,
  0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
];

const PY_WHITESPACE: ReadonlySet<string> = new Set(
  PY_WHITESPACE_CODEPOINTS.map((c) => String.fromCharCode(c)),
);

/** Equivalent of CPython `str.strip()` (no argument). */
export function pyStrip(s: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && PY_WHITESPACE.has(s[start] as string)) start += 1;
  while (end > start && PY_WHITESPACE.has(s[end - 1] as string)) end -= 1;
  return s.slice(start, end);
}

/**
 * Equivalent of CPython `str.strip(chars)`. Removes every leading and trailing
 * character present in `chars` -- repeatedly, which is why `""double""` loses
 * both pairs of quotes where a single regex replace would strip only one.
 */
export function pyStripChars(s: string, chars: string): string {
  const set = new Set(chars);
  let start = 0;
  let end = s.length;
  while (start < end && set.has(s[start] as string)) start += 1;
  while (end > start && set.has(s[end - 1] as string)) end -= 1;
  return s.slice(start, end);
}

/** Equivalent of the source's `.strip('"').strip("'")` chain. Order matters. */
function stripQuotes(value: string): string {
  return pyStripChars(pyStripChars(value, '"'), "'");
}

/** The only block-scalar headers the source recognises. */
const BLOCK_SCALAR_HEADERS: ReadonlySet<string> = new Set([">", "|", ">-", "|-"]);

const NAME_KEY = "name:";
const DESCRIPTION_KEY = "description:";

/** Raised for the two structural failures the source signals with `ValueError`. */
export class FrontmatterError extends Error {
  public override readonly name = "FrontmatterError";
}

export interface ParsedSkill {
  /** Value of the last `name:` line, quote-stripped. Empty string if absent. */
  readonly name: string;
  /** Value of the last `description:` line, block scalars flattened. */
  readonly description: string;
  /** The ENTIRE file, frontmatter included. */
  readonly content: string;
}

/**
 * Consume continuation lines -- those opening with two spaces or a tab -- from
 * `start`, stripping each and joining them with a single space.
 */
function collectBlockScalar(
  lines: readonly string[],
  start: number,
): { readonly text: string; readonly nextIndex: number } {
  const collected: string[] = [];
  let i = start;
  for (;;) {
    const line = lines[i];
    if (line === undefined) break;
    if (!line.startsWith("  ") && !line.startsWith("\t")) break;
    collected.push(pyStrip(line));
    i += 1;
  }
  return { text: collected.join(" "), nextIndex: i };
}

/**
 * Equivalent of `parse_skill_md`, operating on already-read text.
 *
 * @throws {FrontmatterError} when the opening or closing `---` is missing.
 */
export function parseFrontmatter(content: string): ParsedSkill {
  const lines = content.split("\n");

  // `.strip()` semantics, so a padded `  ---  ` opens the frontmatter fine.
  if (pyStrip(lines[0] ?? "") !== "---") {
    throw new FrontmatterError("SKILL.md missing frontmatter (no opening ---)");
  }

  // The first line from index 1 whose stripped form is `---` closes it.
  let endIdx = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (pyStrip(lines[i] as string) === "---") {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) {
    throw new FrontmatterError("SKILL.md missing frontmatter (no closing ---)");
  }

  const frontmatterLines = lines.slice(1, endIdx);
  let name = "";
  let description = "";
  let i = 0;

  while (i < frontmatterLines.length) {
    const line = frontmatterLines[i];
    if (line === undefined) break;

    if (line.startsWith(NAME_KEY)) {
      name = stripQuotes(pyStrip(line.slice(NAME_KEY.length)));
    } else if (line.startsWith(DESCRIPTION_KEY)) {
      const value = pyStrip(line.slice(DESCRIPTION_KEY.length));
      if (BLOCK_SCALAR_HEADERS.has(value)) {
        const block = collectBlockScalar(frontmatterLines, i + 1);
        description = block.text;
        i = block.nextIndex;
        continue;
      }
      description = stripQuotes(value);
    }
    i += 1;
  }

  return { name, description, content };
}

/** Join a directory with `SKILL.md` the way `Path(dir) / "SKILL.md"` does. */
export function skillMdPath(skillDir: string): string {
  if (skillDir === "") return "SKILL.md";
  return skillDir.endsWith("/") ? `${skillDir}SKILL.md` : `${skillDir}/SKILL.md`;
}

/**
 * Equivalent of `parse_skill_md(skill_path)`: read `<skillDir>/SKILL.md` and
 * parse it.
 *
 * @throws {FrontmatterError} when the frontmatter delimiters are missing.
 * @throws when the file does not exist, as CPython's `read_text` does.
 */
export async function parseSkillMd(skillDir: string): Promise<ParsedSkill> {
  const content = await Bun.file(skillMdPath(skillDir)).text();
  return parseFrontmatter(content);
}
