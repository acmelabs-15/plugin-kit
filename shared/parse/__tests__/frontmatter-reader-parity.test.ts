import { describe, expect, test } from "bun:test";

import { parseFrontmatter } from "../frontmatter.ts";
import { parseFrontmatterBlock } from "../lib.ts";

/**
 * Every shipped SKILL.md must read identically through both frontmatter readers.
 *
 * This repo runs two on purpose. `parseFrontmatterBlock` is real `Bun.YAML.parse`;
 * `parseFrontmatter` is the hand-rolled reader kept bug-compatible with the Python
 * original, because callers depend on its exact flattening. Two readers are fine.
 * Two ANSWERS are not: when they disagree, one half of the codebase measures,
 * packages or proposes against a string the other half never sees, and nothing in
 * the build surfaces the split.
 *
 * That disagreement has happened. All five descriptions were `|` block scalars
 * containing a blank line, and the hand-rolled reader ends a block scalar at the
 * first line not opening with two spaces or a tab -- a blank line opens with
 * neither -- so it returned between 60% and 78% of the text, dropping the negatives
 * block in every case. `evals/MEASUREMENT-CAVEATS.md` records what that cost.
 *
 * Skills are discovered from disk rather than listed here, so a sixth skill is
 * covered the day it lands rather than the day someone remembers this file.
 */

const SKILLS_ROOT = `${import.meta.dir}/../../../skills`;

/**
 * The keys on which the two readers can be compared at all: the hand-rolled reader
 * extracts `name` and `description` and returns the rest of the file only as
 * `content`, so there is nothing else of its own to disagree about.
 */
const COMPARABLE_KEYS = ["name", "description"] as const;

const IDENTICAL = "identical";

/**
 * A readable account of how two strings differ, or `IDENTICAL` when they do not.
 *
 * Asserted as a string rather than by comparing the values directly: `toBe` on two
 * 900-character descriptions prints two walls of prose and leaves the reader to
 * find the difference by eye. Whoever trips this in a year needs the index and the
 * surrounding text, not the haystack.
 */
function describeDifference(label: string, real: string, hand: string): string {
  if (real === hand) return IDENTICAL;

  let at = 0;
  while (at < real.length && at < hand.length && real[at] === hand[at]) at += 1;

  const from = Math.max(0, at - 20);
  const window = (s: string): string => JSON.stringify(s.slice(from, at + 40));

  return [
    `${label} differs between the frontmatter readers`,
    `  real YAML:   ${real.length} chars`,
    `  hand-rolled: ${hand.length} chars`,
    `  diverges at index ${at}, shown from ${from}:`,
    `  real YAML:   ${window(real)}`,
    `  hand-rolled: ${window(hand)}`,
  ].join("\n");
}

/** Both readers' view of one SKILL.md, keyed alike so they can be compared. */
async function readBothWays(
  path: string,
): Promise<{ readonly real: Record<string, unknown>; readonly hand: Record<string, string> }> {
  const content = await Bun.file(path).text();
  const outcome = parseFrontmatterBlock(content);
  if (!outcome.ok) throw new Error(`${path}: real YAML rejected the frontmatter -- ${outcome.error}`);
  const parsed = parseFrontmatter(content);
  return { real: outcome.frontmatter, hand: { name: parsed.name, description: parsed.description } };
}

const SHIPPED = (
  await Array.fromAsync(
    new Bun.Glob("*/SKILL.md").scan({ cwd: SKILLS_ROOT, onlyFiles: true, followSymlinks: false }),
  )
).sort();

describe("shipped skills read the same through both frontmatter readers", () => {
  test("discovery found the shipped skills", () => {
    // Without this the parity assertions below pass vacuously if the glob or the
    // relative path to `skills/` ever breaks.
    expect(SHIPPED.length).toBeGreaterThan(0);
  });

  test.each(SHIPPED)("%s", async (relative) => {
    const { real, hand } = await readBothWays(`${SKILLS_ROOT}/${relative}`);

    for (const key of COMPARABLE_KEYS) {
      const fromYaml = real[key];
      expect(typeof fromYaml).toBe("string");
      expect(describeDifference(key, fromYaml as string, hand[key] as string)).toBe(IDENTICAL);
    }
  });

  /**
   * The single-line double-quoted form the descriptions use is safe only while the
   * text needs no escapes -- the second divergence test below shows what happens
   * when it does. This is what keeps that precondition true, because a description
   * gaining a quoted phrase would otherwise reintroduce the split silently, with no
   * blank line to make it visible.
   */
  test.each(SHIPPED)("%s needs no YAML escapes", async (relative) => {
    const { real } = await readBothWays(`${SKILLS_ROOT}/${relative}`);
    const description = real["description"] as string;

    expect(description.includes('"')).toBe(false);
    expect(description.includes("\\")).toBe(false);
  });
});

/**
 * The two mechanisms by which the readers can disagree, pinned as fixtures so the
 * reason outlives any shipped file's current shape. If the assertions above ever
 * fail, one of these is why.
 */
describe("the divergences the shipped-skill parity assertions catch", () => {
  function fixture(...frontmatter: readonly string[]): string {
    return ["---", ...frontmatter, "---", "", "# Body"].join("\n");
  }

  function bothWays(content: string): { readonly real: string; readonly hand: string } {
    const outcome = parseFrontmatterBlock(content);
    if (!outcome.ok) throw new Error(outcome.error);
    return {
      real: String(outcome.frontmatter["description"]),
      hand: parseFrontmatter(content).description,
    };
  }

  test("a blank line inside a block scalar truncates the hand-rolled reader", () => {
    const { real, hand } = bothWays(
      fixture("name: split", "description: |", "  First paragraph.", "", "  Second paragraph."),
    );

    expect(real).toContain("Second paragraph.");
    expect(hand).toBe("First paragraph.");
    expect(hand).not.toBe(real);
  });

  test("an escaped quote diverges because the hand-rolled reader unescapes nothing", () => {
    const { real, hand } = bothWays(fixture("name: quoted", 'description: "She said \\"hello\\" and left."'));

    // Real YAML resolves the escape. `stripQuotes` only removes repeated quote
    // characters from each end, so the backslashes survive into the value -- which
    // is why the double-quoted form is conditionally safe rather than simply safe.
    expect(real).toBe('She said "hello" and left.');
    expect(hand).toBe('She said \\"hello\\" and left.');
    expect(hand).not.toBe(real);
  });
});
