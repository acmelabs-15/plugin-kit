/**
 * Every `var(--token)` that ships resolves to a token that exists — or is on a list.
 *
 * WHY THIS GUARD EXISTS. `DESIGN_COMPONENTS` is a verbatim port of the Fable/Opus lab
 * reference, which defines model-identity tokens in its own token block. `THEME_TOKENS` is a
 * port of that same reference's tokens and carries the semantic colours only. So the component
 * layer arrived referencing four tokens this repository never defines, and nothing noticed for
 * the life of the port.
 *
 * THE FAILURE MODE, which is worse than a wrong colour. A `var()` naming an undefined custom
 * property with no fallback is invalid at computed-value time: the declaration is not ignored,
 * it resolves to `unset`. For a non-inherited property that means the initial value, and for an
 * inherited one it means the parent's. So `.note.warn{ border-left-color:var(--opus) }` did not
 * fall back to the `.note` accent border it was overriding — it fell back to `currentColor`,
 * which is `--muted` there. **A rule written to emphasise ended up de-emphasising**, and the
 * warning callout rendered fainter than the plain note it was meant to escalate.
 *
 * WHY AN ALLOWLIST RATHER THAN ZERO. Resolving the four needs a decision this test cannot make
 * — port the reference's model-token definitions, or assign each rule a semantic colour — so a
 * green-today guard that ratchets is worth more than a red one making a point. It fails if a
 * fifth appears, which is the regression worth preventing. It also fails when one is FIXED,
 * which is deliberate: whoever fixes it updates the list, and the debt shrinks where a reader
 * can see it rather than silently.
 */

import { describe, expect, test } from "bun:test";

import { DESIGN_COMPONENTS, DESIGN_OVERRIDES, THEME_TOKENS } from "../theme.ts";

/**
 * Comments are stripped BEFORE matching, and that is not tidiness.
 *
 * The override that fixed `.note.warn` explains itself by naming `var(--opus)` in prose. Match
 * without stripping and the guard reports a dangling reference in a layer that is clean — a
 * phantom produced by the very comment describing the bug. Measured: one false positive in
 * `DESIGN_OVERRIDES`, which is otherwise empty.
 */
function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function captures(css: string, pattern: RegExp): readonly string[] {
  return [...css.matchAll(pattern)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

/** Every custom property `THEME_TOKENS` defines, in any of its three blocks. */
const DEFINED: ReadonlySet<string> = new Set(
  captures(withoutComments(THEME_TOKENS), /(--[a-z0-9-]+)\s*:/g),
);

/** Distinct tokens a stylesheet references and the token block does not define. */
function danglingIn(css: string): readonly string[] {
  const referenced = captures(withoutComments(css), /var\(\s*(--[a-z0-9-]+)/g);
  return [...new Set(referenced)].filter((token) => !DEFINED.has(token)).sort();
}

/** `var()` references carrying a fallback, which the dangling check does not model. */
function fallbacksIn(css: string): number {
  return withoutComments(css).match(/var\(\s*--[a-z0-9-]+\s*,/g)?.length ?? 0;
}

/**
 * Retained deliberately. Not debt awaiting payment.
 *
 * All four are model-identity colours from the reference's own token block: `--opus` at
 * `.note.warn` (twice, now overridden by `DESIGN_OVERRIDES`) and at `.chip.i` and `.chip.opus`,
 * and one apiece for `--fable`, `--sonnet` and `--haiku` on the model chips. Seven occurrences,
 * four names.
 *
 * No class in this repository emits `chip i`, `chip opus`, `chip fable`, `chip sonnet` or
 * `chip haiku` today — checked exhaustively, including dynamic construction, which only ever
 * appends a run state. Deleting them was proposed and REJECTED: plugin-kit is still under
 * development, the reference's pages did have model-identity chips, and a rule for a chip
 * nothing renders yet is as consistent with scaffolding as with dead weight. The asymmetry
 * decides it — a rule that cannot match cannot mis-render, so keeping it costs nothing at
 * runtime, while deleting a planned rule costs someone rediscovering both the rule and the
 * reason. "Nothing references this" is the evidence that looks sufficient and is not.
 *
 * So this guard exists to catch a FIFTH name, not to pressure anyone into removing these four.
 * A fifth is a new bug. If one of the four does legitimately go — because the tokens get
 * ported, or because their author retires the chips — this list should lose it, and failing
 * then is the point rather than a nuisance.
 */
const KNOWN_DANGLING_IN_PORT = ["--fable", "--haiku", "--opus", "--sonnet"] as const;

describe("every shipped var() resolves to a defined token, or is known debt", () => {
  test("the token block defines what the rest of the theme claims to use", () => {
    // Guards the extractor as much as the theme: a regex that silently matched nothing would
    // make every assertion below vacuously true.
    expect(DEFINED.size).toBeGreaterThan(15);
    expect(DEFINED.has("--warn")).toBe(true);
    expect(DEFINED.has("--opus")).toBe(false);
  });

  test("the ported component layer dangles on exactly the four known tokens", () => {
    expect(danglingIn(DESIGN_COMPONENTS)).toEqual([...KNOWN_DANGLING_IN_PORT]);
  });

  test("the override layer dangles on nothing", () => {
    // Authored here rather than ported, so it has no debt to inherit and no excuse for any.
    expect(danglingIn(DESIGN_OVERRIDES)).toEqual([]);
  });

  test("no var() carries a fallback, which is what makes a dangling reference fatal", () => {
    // `var(--x, red)` resolves cleanly and would make a dangling `--x` harmless. None exists
    // today, so "dangling" and "broken" are the same set. If that changes, this fails and the
    // dangling check above needs to learn the difference rather than being widened.
    expect(fallbacksIn(DESIGN_COMPONENTS)).toBe(0);
    expect(fallbacksIn(DESIGN_OVERRIDES)).toBe(0);
  });
});

/**
 * `template.html` gets a second ratchet rather than a row in the first, and this one is closed.
 *
 * Its stylesheet is authored here rather than ported, and it resolves against the tokens the app
 * bar injects — so it is checked against the same `THEME_TOKENS`, but its dangling references
 * were its own choice rather than anything inherited from the reference. That is the distinction
 * that decided the two files differently: a rule authored here, live, and rendering wrongly is a
 * defect to fix, where a ported rule nothing renders is a judgement about someone's roadmap.
 *
 * All four occurrences were live and all four were wrong. `.vt.warn` rendered rgb(0,0,0),
 * identical to a verdict the page has no opinion about; `.caps li` rendered a grey border on a
 * grey card; `.unwritten` rendered as an ordinary paragraph directly beneath a comment insisting
 * it must read as unfinished. All three now carry `--warn`, and nothing here dangles.
 */
describe("the report template's own stylesheet", () => {
  test("dangles on nothing", async () => {
    const html = await Bun.file(`${import.meta.dir}/../template.html`).text();
    const styles = captures(html, /<style>([\s\S]*?)<\/style>/g).join("\n");
    expect(styles.length).toBeGreaterThan(0);
    expect(danglingIn(styles)).toEqual([]);
    expect(fallbacksIn(styles)).toBe(0);
  });
});
