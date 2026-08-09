/**
 * `shared/util/` is the bottom of the dependency stack, and this test is what keeps it
 * there.
 *
 * A module here may import runtime builtins and its own siblings. Nothing else -- not
 * `shared/scripts/`, not `shared/rules/`, not any layer added later. The rule is not
 * stylistic: a utility that reaches upward into domain code stops being reusable, and
 * the cycle it creates is discovered much later and much more expensively than here.
 *
 * The directory is SCANNED rather than checked against a list of known files, so a module
 * added to `util/` tomorrow is covered without anyone remembering to enrol it. That is the
 * whole point -- the rule has to hold for the person who has never read this file.
 */

import { describe, expect, test } from "bun:test";

import { Glob } from "bun";
import { dirname, relative, resolve } from "node:path";

const UTIL_ROOT = resolve(import.meta.dir, "..");

/**
 * Module specifiers imported, re-exported or dynamically imported by `source`.
 *
 * Anchored at the start of a line, which is where every import in this repository begins.
 * Anchoring is deliberate: an unanchored scan matches the word "from" inside the prose of
 * a docblock and reports a violation nobody can act on, and a guard that cries wolf is
 * turned off. The `}` alternative catches the closing line of a multi-line named import,
 * which is the form most of this codebase uses.
 */
function specifiersOf(source: string): readonly string[] {
  const found: string[] = [];
  for (const line of source.split("\n")) {
    const fromClause = /^\s*(?:import|export|\})[^"']*\bfrom\s*["']([^"']+)["']/.exec(line);
    if (fromClause?.[1] !== undefined) found.push(fromClause[1]);
    const bareImport = /^\s*import\s*["']([^"']+)["']/.exec(line);
    if (bareImport?.[1] !== undefined) found.push(bareImport[1]);
  }
  // Dynamic imports can appear mid-expression, so these are not line-anchored.
  for (const match of source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) {
    if (match[1] !== undefined) found.push(match[1]);
  }
  return found;
}

/**
 * Whether `specifier`, imported from `fromFile`, is one this layer is allowed to reach.
 *
 * Two categories only. Runtime builtins -- `node:*`, `bun:*`, and the bare `bun` module --
 * are beneath every layer and cannot create a cycle. A relative specifier is allowed only
 * when it lands inside `util/`; `../scripts/x.ts` resolves outside and is refused. Anything
 * else, including a bare npm package, is refused: this layer has no runtime dependencies
 * and adding one is a decision that should not pass silently.
 */
export function importIsAllowed(specifier: string, fromFile: string): boolean {
  if (specifier.startsWith("node:") || specifier.startsWith("bun:") || specifier === "bun") {
    return true;
  }
  if (!specifier.startsWith(".")) return false;
  const target = resolve(dirname(fromFile), specifier);
  return target === UTIL_ROOT || target.startsWith(`${UTIL_ROOT}/`);
}

async function utilFiles(): Promise<readonly string[]> {
  const files: string[] = [];
  // Read through the filesystem rather than shelling out to a text search. One module in
  // this repository carries a literal NUL byte, which makes `grep` treat it as binary and
  // skip it silently -- a scan that can be opted out of by accident is not a guard.
  for await (const rel of new Glob("**/*.ts").scan(UTIL_ROOT)) files.push(resolve(UTIL_ROOT, rel));
  return files.sort();
}

describe("shared/util is the bottom of the stack", () => {
  test("the scan actually finds the modules, so a green result means something", async () => {
    const files = await utilFiles();
    expect(files.length).toBeGreaterThanOrEqual(10);
    // A sample of the ten, to catch a scan that silently matched nothing.
    const names = files.map((f) => relative(UTIL_ROOT, f));
    expect(names).toContain("pool.ts");
    expect(names).toContain("browser.ts");
    expect(names).toContain("zipwriter.ts");
  });

  test("no module imports anything outside util or the runtime", async () => {
    const violations: string[] = [];
    for (const file of await utilFiles()) {
      const source = await Bun.file(file).text();
      for (const specifier of specifiersOf(source)) {
        if (!importIsAllowed(specifier, file)) {
          violations.push(`${relative(UTIL_ROOT, file)} imports ${specifier}`);
        }
      }
    }
    // Named in the failure so the fix is obvious without re-running anything by hand.
    expect(violations).toEqual([]);
  });
});

describe("importIsAllowed", () => {
  const aFile = `${UTIL_ROOT}/pool.ts`;

  test("runtime builtins are allowed", () => {
    expect(importIsAllowed("node:fs/promises", aFile)).toBe(true);
    expect(importIsAllowed("node:path", aFile)).toBe(true);
    expect(importIsAllowed("bun:test", aFile)).toBe(true);
    expect(importIsAllowed("bun", aFile)).toBe(true);
  });

  test("siblings inside util are allowed, including from the test subdirectory", () => {
    expect(importIsAllowed("./pyfloat.ts", aFile)).toBe(true);
    expect(importIsAllowed("../pool.ts", `${UTIL_ROOT}/__tests__/pool.test.ts`)).toBe(true);
  });

  test("reaching up into any domain layer is refused", () => {
    expect(importIsAllowed("../scripts/measure-triggering.ts", aFile)).toBe(false);
    expect(importIsAllowed("../scripts/lib/envelope.ts", aFile)).toBe(false);
    expect(importIsAllowed("../rules/registry.ts", aFile)).toBe(false);
    // Layers that do not exist yet are refused by the same rule, without naming them.
    expect(importIsAllowed("../operations/run.ts", aFile)).toBe(false);
    expect(importIsAllowed("../validate/skill.ts", aFile)).toBe(false);
    expect(importIsAllowed("../schemas/plan.ts", aFile)).toBe(false);
  });

  test("an npm package is refused, since this layer has no runtime dependencies", () => {
    expect(importIsAllowed("zod", aFile)).toBe(false);
    expect(importIsAllowed("@types/node", aFile)).toBe(false);
  });

  // A sibling directory whose name merely starts with "util" must not be read as inside it.
  test("a path that only looks like it is inside util is refused", () => {
    expect(importIsAllowed("../util-extra/thing.ts", aFile)).toBe(false);
  });
});

describe("specifiersOf", () => {
  test("finds every import form the codebase uses", () => {
    const source = [
      'import { a } from "node:path";',
      'import "./side-effect.ts";',
      "import {",
      "  b,",
      '} from "./multi-line.ts";',
      'export { c } from "./re-export.ts";',
      'export type { D } from "./type-only.ts";',
      "const mod = await import(\"./dynamic.ts\");",
    ].join("\n");

    expect(specifiersOf(source)).toEqual([
      "node:path",
      "./side-effect.ts",
      "./multi-line.ts",
      "./re-export.ts",
      "./type-only.ts",
      "./dynamic.ts",
    ]);
  });

  test("prose in a docblock is not mistaken for an import", () => {
    const source = [
      "/**",
      ' * Ported from "../scripts/legacy.ts", which used to own this.',
      " * import { thing } from \"../rules/registry.ts\" was the old call site.",
      " */",
      'import { real } from "./pool.ts";',
    ].join("\n");

    expect(specifiersOf(source)).toEqual(["./pool.ts"]);
  });
});
