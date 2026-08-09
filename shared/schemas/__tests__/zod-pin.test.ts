/**
 * The zod version is pinned in three places, and nothing else makes them agree.
 *
 * 1. The import specifier, `zod@X`, which is what a SHIPPED plugin resolves through:
 *    a skill's scripts run under `~/.claude/plugins/cache/...` with no `node_modules`
 *    above them, so Bun auto-installs exactly the pinned version.
 * 2. `devDependencies` in package.json, which is what `bun install` puts in
 *    `node_modules` for this repository.
 * 3. The `paths` entry in tsconfig.json, which is where `tsc` reads the types from.
 *
 * The trap is that they are not consulted together. Whenever `node_modules/zod`
 * exists, Bun resolves `zod@4.1.0` to THAT COPY and ignores the version in the
 * string -- measured, not assumed. So every in-repo `bun test` and every `tsc` run
 * uses the installed version while shipped users get the pinned one, and if the two
 * drift apart nothing errors. The suite would go green against one version while the
 * plugin ships another.
 *
 * That is the same between-run drift the exact pin exists to prevent, relocated
 * rather than removed. This test is what closes it.
 */
import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "..", "..", "..");

/** Every `zod@<version>` specifier imported anywhere under `shared/`. */
async function pinnedSpecifierVersions(): Promise<ReadonlyMap<string, readonly string[]>> {
  const byVersion = new Map<string, string[]>();
  const shared = resolve(REPO_ROOT, "shared");
  for await (const rel of new Glob("**/*.ts").scan(shared)) {
    const file = resolve(shared, rel);
    const source = await Bun.file(file).text();
    for (const match of source.matchAll(/from\s+["']zod@([^"']+)["']/g)) {
      const version = match[1];
      if (version === undefined) continue;
      byVersion.set(version, [...(byVersion.get(version) ?? []), rel]);
    }
  }
  return byVersion;
}

async function jsonAt(path: string): Promise<Record<string, unknown>> {
  return (await Bun.file(resolve(REPO_ROOT, path)).json()) as Record<string, unknown>;
}

describe("the zod pin agrees across every place it is written", () => {
  test("every import specifier names the same version", async () => {
    const versions = await pinnedSpecifierVersions();
    // A second version appearing here means shipped users load two copies of zod.
    expect([...versions.keys()].sort()).toHaveLength(1);
  });

  test("the specifier is exact, not a range", async () => {
    const [version] = [...(await pinnedSpecifierVersions()).keys()];
    // A range resolves to whatever satisfies it at install time, which is the drift
    // the pin exists to stop. `^4.1.0` admits 4.9.x.
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("devDependencies matches the specifier exactly", async () => {
    const [version] = [...(await pinnedSpecifierVersions()).keys()];
    const pkg = await jsonAt("package.json");
    const dev = (pkg["devDependencies"] ?? {}) as Record<string, string>;
    // Not `toContain`: a caret here would let `bun install` put a different version
    // in node_modules than the one shipped users get, silently.
    expect(dev["zod"]).toBe(version);
  });

  test("the installed copy matches the specifier", async () => {
    const [version] = [...(await pinnedSpecifierVersions()).keys()];
    const installed = await jsonAt("node_modules/zod/package.json");
    // This is the one that actually runs in this repo, because Bun prefers
    // node_modules over the pinned specifier whenever it exists.
    expect(installed["version"]).toBe(version);
  });

  test("tsconfig maps the specifier tsc actually sees", async () => {
    const versions = await pinnedSpecifierVersions();
    const [version] = [...versions.keys()];
    const tsconfig = await jsonAt("tsconfig.json");
    const options = (tsconfig["compilerOptions"] ?? {}) as Record<string, unknown>;
    const paths = (options["paths"] ?? {}) as Record<string, readonly string[]>;
    // Keyed by the literal specifier, so bumping the pin without bumping this key
    // silently loses type resolution and reintroduces the implicit-any cascade.
    expect(Object.keys(paths)).toContain(`zod@${version}`);
  });
});
