# Path anchors: three of them, three jobs

Read this when you are about to write a path into the plugin's own files — a hook command, an MCP `command`, a skill script invocation — or when a path that worked in development stopped working after an install, an update, or a move to another project.

Claude Code exposes three path anchors to a plugin. They are not interchangeable, and conflating them produces failures that only appear after an update or in someone else's project — which is the worst time to find them.

| Anchor | Job | Lifecycle |
|---|---|---|
| `${CLAUDE_PLUGIN_ROOT}` | locate **shipped code** | read-only; replaced wholesale on update |
| `${CLAUDE_PLUGIN_DATA}` | the plugin's **own state** — config, caches, install markers | persists across updates; spans projects |
| `${CLAUDE_PROJECT_DIR}` | the **user's project** | the user's repo, not yours |

Two prohibitions follow directly from the lifecycle column:

- **Never write state into `PLUGIN_ROOT`.** An update replaces that directory, so anything written there is gone without warning.
- **Never put project data in `PLUGIN_DATA`.** It spans projects, so a knowledge graph or a per-repo cache stored there bleeds between them.

## Why a relative path is not an alternative

A bare relative path — `bun run shared/lib/tool.ts` — resolves against the **working directory**, not the plugin. When a skill fires while the user sits in some unrelated project, that path points into *their* tree. It may not exist; worse, it may exist and be something else.

This is a distinct failure from the one `shared-code-architecture.md` covers. That one is about files never being copied. This one bites even when the file *was* copied, because nothing about a relative path knows where the plugin went. `${CLAUDE_PLUGIN_ROOT}` is the only form that answers "where am I installed", and it is the established convention — Anthropic's own hooks use it universally, always quoted:

```json
{ "command": "bun \"${CLAUDE_PLUGIN_ROOT}/hooks-handlers/session-start.ts\"" }
```

Quote it. An unquoted path breaks on the first install directory containing a space.

## Resolve them in exactly one module

Shell strings can interpolate the anchors directly. Code should not read `process.env` all over the place — one module owns resolution, everything else imports from it:

```ts
import { join } from "node:path";

/** Read an env var, falling back when unset or empty. */
function fromEnv(name: string, fallback: () => string): string {
  const value = process.env[name];
  return value && value.length > 0 ? value : fallback();
}

/** Installed plugin directory (shipped code, read-only). */
export function pluginRoot(): string {
  return fromEnv("CLAUDE_PLUGIN_ROOT", () => join(import.meta.dir, ".."));
}

/** Persistent plugin state. Callers create it on first write. */
export function pluginData(): string {
  return fromEnv("CLAUDE_PLUGIN_DATA", () => `${pluginRoot()}/.my-plugin-data`);
}

/** The user's project root. */
export function projectDir(): string {
  return fromEnv("CLAUDE_PROJECT_DIR", () => process.cwd());
}
```

Three things this buys, each of which is a bug avoided rather than a nicety:

**The fallbacks let scripts run outside a session.** Tests and local runs get sensible values instead of `undefined`, with no branching at the call site.

**`pluginRoot`'s fallback is file-relative, not cwd-relative.** `import.meta.dir` is the module's own directory, so even the fallback is immune to the working-directory problem above. A `process.cwd()` fallback would reintroduce exactly the bug the anchor exists to fix.

Use `import.meta.dir`, not `new URL("..", import.meta.url).pathname`. The latter looks equivalent and is not: `.pathname` leaves URL escapes in place, so a plugin installed under `has space dir` resolves to `has%20space%20dir`, which does not exist. It also carries a leading slash on Windows (`/C:/...`). `fileURLToPath` from `node:url` decodes correctly if you already have a URL in hand; `import.meta.dir` skips the round trip.

**Derived paths are named once.** If the knowledge graph lives at `docs/` under the project, that belongs here as a `docsDir()` and nowhere else:

```ts
export function docsDir(): string {
  return `${projectDir()}/docs`;
}
```

## `PLUGIN_DATA` has a documented use worth knowing

If a plugin genuinely needs third-party dependencies present at runtime rather than bundled into what it ships, Anthropic documents installing them into `${CLAUDE_PLUGIN_DATA}` from a `SessionStart` hook — comparing the bundled manifest against a stored copy to decide whether to reinstall, then pointing the module resolution path at the result. It works because that directory survives updates.

Bundling is simpler and is the recommendation, and under Bun there is very little left to bundle: `Bun.build` inlines every dependency into the shipped output, so the installed plugin has no `node_modules` to populate and nothing to fetch on a machine that may be offline. `bun build --compile` goes one step further and emits an executable that needs no runtime either. Reach for the install-on-first-session pattern only for something genuinely un-bundleable — a native binary, a model file, a dependency with a licence that forbids redistribution. The pattern exists, it is sanctioned, and it is the reason `PLUGIN_DATA` is not merely a cache directory.

The cheapest audit is a grep for the two mistakes that matter: a path into the plugin that does not start with `${CLAUDE_PLUGIN_ROOT}`, and a second place reading `process.env` for something the resolver module already owns. Both are additions someone made in a hurry, and both read as harmless until an update or another project exposes them.
