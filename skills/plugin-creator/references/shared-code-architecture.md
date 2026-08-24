# Shared code across a plugin's skills

Read this when two or more components of one plugin need the same code — a schema, a parser, a validator, a client. It does not apply to a plugin whose components share nothing, which is most of them.

The short version:

> **Shared code is a workspace package the plugin depends on, and one build step bundles it into `dist/` before shipping. Components invoke the built output, never a path into a sibling directory.**

The package is a **dependency**, not a build target. Nothing builds it on its own and no source file imports from `dist/` — the build reads source and writes artifacts, never the reverse. Getting that direction backwards is the tempting mistake: it looks like it would make the shared code more explicit, and instead it makes committed source depend on generated output, which nothing in the surrounding ecosystem does.

## Table of Contents

- [Why a build step, and not a dependency](#why-a-build-step-and-not-a-dependency)
- [The layout](#the-layout)
- [The build step](#the-build-step)
- [What this costs](#what-this-costs)
- [Declare each package's public surface](#declare-each-packages-public-surface)
- [Why the ecosystem gives no cover here](#why-the-ecosystem-gives-no-cover-here)

## Why a build step, and not a dependency

Because the install target runs no install step. From Anthropic's plugin reference:

> "Installed plugins cannot reference files outside their directory. Paths that traverse outside the plugin root (such as `../shared-utils`) will not work after installation because those external files are not copied to the cache."

Installation copies the plugin directory into a cache and stops. Nothing resolves a workspace symlink, and nothing runs `bun install`, so a `node_modules` tree that exists in your repo does not exist at the other end. A `workspace:*` dependency is correct at development time and absent at runtime — which is precisely what bundling fixes.

This is the same constraint VS Code documents for extensions, and it reaches the same conclusion:

> "Decomposition and reuse are development best practices but they come at a cost when installing and running extensions… That's why we recommend bundling."

The dividing line across ecosystems is clean. Where an install step exists — ESLint configs, Terraform modules — the settled answer is a declared dependency and never a copy. Where the target loads a delivered artifact with no install — VS Code for Web, browser extension stores, Claude Code plugins — the settled answer is to bundle. Knowing which side you are on decides the question.

## The layout

```text
my-repo/
├── package.json              # workspaces: ["packages/*", "plugin"]
├── scripts/
│   └── build.ts              # bundles packages + plugin → plugin/dist/
├── packages/
│   └── core/                 # @my/core — the shared library
│       ├── package.json
│       └── src/
└── plugin/                   # the shipped unit
    ├── .claude-plugin/plugin.json
    ├── package.json          # @my/plugin → depends on @my/core (workspace:*)
    ├── src/                  # hook handlers, MCP server — import @my/core
    ├── skills/<name>/scripts/
    └── dist/                 # bundled output, gitignored
```

Two properties make this worth the extra directory. The library has one home, so a fix lands once rather than N times. And a second consumer — a CLI, an MCP server, a test harness — can depend on the same package without reaching inside the plugin.

**Put the build script at the repository root when it reads from more than one place.** It bundles code from `packages/` as well as from `plugin/`, so putting it in `plugin/` means a child directory reaching up to orchestrate its parent's sibling — it has to compute `join(import.meta.dir, "..")` just to find what it is building. At the root it sits above both things it builds, which is where the dependency direction already points.

Worth knowing that this is not the surrounding convention. Surveyed monorepos mostly keep the build script inside the artifact it builds, reserving a root `scripts/` for cross-cutting concerns like changelogs and CI. The exception is a repo whose root build drives many first-party units, which is the case this reference describes. If your build only ever reads from inside the plugin, follow the majority and keep it there.

**Its output still lands inside the plugin.** `plugin/dist/`, never a root-level `dist/`. Installation copies only the plugin directory, so anything outside that boundary is unreachable at runtime — the same constraint that makes bundling necessary at all. Root-level builder, plugin-local output.

Note the plugin root is `plugin/`, not the repo root. That is what puts `packages/core` *outside* the plugin and makes the build step necessary. A repo whose plugin root **is** the repo root has its shared code inside the boundary already, and installation copies it — such a plugin is conformant without bundling, and the trade is that its whole repo ships and nothing else can consume the library.

## The build step

```ts
const result = await Bun.build({
  entrypoints,        // only files something INVOKES, every group in ONE call
  outdir,             // inside the plugin: plugin/dist/
  root,               // the common ancestor of all entry points
  target: "bun",
  splitting: true,    // shared code emitted once, not per entry point
  sourcemap: "none",  // a development artifact, not a shipped one
});
```

`Bun.build` resolves imported workspace packages and npm dependencies and bundles them in, so the shipped plugin needs no `node_modules` at runtime. With `splitting` on it does still resolve one thing: each entry point imports its shared chunk by relative path, so `dist/` ships as a unit — an entry point separated from its chunks fails to load. Exclude `*.test.ts` — tests are not part of the shipped artifact.

**An entry point is a file something invokes.** Library modules are not entry points: their code is already pulled into whatever imports them, so listing them produces output nothing reads. The symptom is a `dist/` carrying a `src/` directory — a name that describes authorship rather than an artifact, and a reliable sign that libraries were mistaken for entry points. List the CLIs, the hook handlers a `hooks.json` actually declares, and the skill scripts a `SKILL.md` actually calls. Nothing else.

**Turn `splitting` on when the duplication is measurable.** Without it every entry point gets its own private copy of every library it touches. Measured on a plugin with 31 entry points sharing two internal packages: **34 MB** — 10 MB of JavaScript with the library repeated 31 times, plus 24 MB of sourcemaps. With `splitting: true` and sourcemaps off, the same artifact is **1.0 MB**. The chunk filenames are generated and disposable — no source file references one, so this changes the output shape without adding anything to the source tree's vocabulary.

The saving scales with entry points multiplied by shared-library size: negligible at two or three entry points, dominant at thirty. Build once without it and look at `dist/` — that is a cheaper decision procedure than a threshold, and there is no measured threshold to quote. Know what you are buying, too: splitting turns independent files into a graph with shared fate, which is the trade the note above about shipping `dist/` as a unit describes.

**Leave sourcemaps out of the shipped artifact.** They were 24 MB of that build, and they point back at a source tree the installed plugin does not carry. Obsidian's official plugin template and VS Code's own bundling guide both gate them behind a production flag; webpack's docs go further and warn against deploying `.map` files at all. Emit them in a development build if you want them; ship without.

**One `Bun.build` call, not one per group.** `splitting` only deduplicates across entry points it can see within a single call, so two calls produce two independent chunk graphs and everything shared between the groups ships twice. Splitting a build by group cost 800 KB on the 31-entry plugin above — the second group re-shipped a library the first had already bundled.

**That forces `root` to the common ancestor, which mirrors the source layout into the output.** With entry points in both `plugin/skills/` and `packages/cli/src/`, the only shared root is the repository, and Bun emits `dist/packages/cli/src/decompose.js` — the source layout dragged into the shipped artifact. A shipped path should describe what a thing is, not where it happened to be authored.

**Invoke every entry point once after building.** It is the only check that catches the three ways this goes wrong, each of which produces a `dist/` that looks correct on disk.

Two steps after the build fix the paths, and the second is the one that catches people:

```ts
import { Glob } from "bun";
import { rename, rm } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

// Wipe outdir BEFORE Bun.build. Without this the first build succeeds and
// every later one dies on `ENOTEMPTY` when the rename below lands on the
// previous run's output.
await rm(outdir, { recursive: true, force: true });

/**
 * Built path (relative to `outdir`) → shipped path. Each `from` is the source
 * layout `root` produced, so changing `root` changes every entry here.
 */
const relocations = [
  { from: "packages/cli/src", to: "cli" },
  { from: "plugin/skills", to: "skills" },
];

for (const { from, to } of relocations) {
  await rename(join(outdir, from), join(outdir, to));
}

// A moved entry point still holds the chunk path Bun wrote for the depth it
// built at, so rewrite each to the chunk's real location from where the file
// now sits. Deriving it from the chunk rather than from the file's nesting
// keeps this correct even if a chunk is not at the `dist/` root.
for await (const file of new Glob("**/*.js").scan({ cwd: outdir, absolute: true })) {
  const before = await Bun.file(file).text();
  const after = before.replace(/(["'])(?:\.\.\/)+(chunk-[^"']+)\1/g, (_m, quote, chunk) => {
    const rel = relative(dirname(file), join(outdir, chunk));
    return `${quote}${rel.startsWith(".") ? rel : `./${rel}`}${quote}`;
  });
  if (after !== before) await Bun.write(file, after);
}
```

Only the entry points move, so only their imports need repointing. Skip the rewrite and `dist/` fails at runtime with a module-not-found, which is why the smoke test above is not optional.

There is no way to express this in configuration. `bunfig.toml` has no `[build]` section — the request for one is open and unimplemented — no `bun.config.ts` convention exists, `--root` takes a single value, and no `package.json` field influences which files are treated as entry points. A build script is the mechanism, and it stays small.

Then every component invokes the built file, not the source:

```json
{ "command": "bun \"${CLAUDE_PLUGIN_ROOT}/dist/session-start.js\"" }
```

`${CLAUDE_PLUGIN_ROOT}` is the anchor that makes this work wherever the plugin was installed to; `path-anchors.md` covers it and the other two, and why a bare relative path fails even when the file was copied.

## What this costs

Worth stating plainly, because the trade is real:

- **The shipped artifact is generated, not authored.** `dist/` is build output. Decide whether it is gitignored (usual) or committed (defensible if consumers install from the repo), and be consistent — an inconsistency here is the kind that produces a stale shipped copy nobody notices.
- **Debugging steps through bundled code**, since sourcemaps do not ship. Debug against the source tree, which is what a map would have pointed at.
- **A patched dependency needs a rebuild and a reship.** Bundling gives single-source-of-truth at build time, not patchability at runtime.
- **Nothing catches a stale `dist/` at compile time.** A skill script invokes a built file by path, so a missing or outdated build fails at runtime, mid-session, as an unhelpful module-not-found. Rebuild as part of releasing.

## Declare each package's public surface

A workspace package needs an `exports` map, and the wildcard shorthand is worth avoiding:

```json
{ "exports": { ".": "./src/index.ts", "./*": "./src/*.ts" } }
```

Both halves cause trouble. The `"."` entry is easy to point at a barrel that was never written — nothing notices, because consumers import subpaths and the broken entry is never resolved. And `"./*"` makes every internal file public, so any module in the package becomes something a consumer can reach and therefore something you cannot move.

Enumerate instead, one entry per subpath meant to be consumed:

```json
{
  "exports": {
    "./schemas/plan-note": "./src/schemas/plan-note.ts",
    "./parsers/plan-note": "./src/parsers/plan-note.ts"
  }
}
```

This is enforced rather than documentary: Bun consults the map for bare and scoped specifiers, so an unlisted path fails to resolve. On the plugin above, enumeration made six modules genuinely private that had previously been reachable from any of a hundred-odd import sites. Point the entries at `.ts` source when the consumer is Bun — it runs TypeScript directly, and the package needs no build of its own. Only the plugin gets built.

## Why the ecosystem gives no cover here

There is no established Claude Code answer, and it is worth knowing that rather than assuming this pattern is the norm.

Anthropic's own Bun plugins duplicate shared code verbatim: four MCP-server plugins, each a single flat `server.ts`, with twelve helper functions appearing identically across three of them — `loadAccess` byte-identical in all three. No `shared/`, no workspace, no build step. Elsewhere in the community you find a source-of-truth directory plus a copy script, and repos that build the plugin as a generated artifact.

So the incumbent practice is duplication. That is the absence of a decision rather than a considered alternative, and duplication's failure mode — silent drift between copies — is the thing this architecture exists to prevent. The mechanism itself has strong general precedent; only its application here is uncommon.

The failure worth watching for is a shipped `dist/` that no longer matches its source — a stale build passes every check that looks at the repository and ships the wrong code. Rebuild as part of releasing, not as a step someone remembers.
