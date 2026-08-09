# plugin-kit — Architecture & Runtime Notes

Reference for the Claude Code plugin that creates, validates, benchmarks, and
optimizes agent artifacts.

**Scope:** 5 artifact types × 4 operations, plus one HTML report renderer.

| | validate | benchmark | optimize-description | optimize-disclosure |
|---|:---:|:---:|:---:|:---:|
| skill | ✓ | ✓ | ✓ | ✓ |
| mcp | ✓ | ✓ | ✓ | ✓ |
| agent | ✓ | ✓ | ✓ | — |
| command | ✓ | ✓ | — | — |
| plugin | ✓ | ✓ | — | — |

14 valid cells of 20.

---

## 1. Directory structure

Plugin root **is** the repo root. This matters: installation copies the plugin
directory into a cache and stops, so shared code inside that boundary is copied
with everything else and needs no build step.

```text
plugin-kit/                              ← plugin root IS repo root (no build needed)
│
├── .claude-plugin/
│   └── plugin.json                      ← ONLY this goes in here
│
├── skills/                              ← auto-discovered
│   ├── skill-creator/
│   │   ├── SKILL.md
│   │   ├── scripts/
│   │   │   └── run.ts                   ← 2-line shim; ${CLAUDE_SKILL_DIR} points here
│   │   └── references/                  ← artifact-specific depth
│   │       ├── frontmatter-fields.md
│   │       └── disclosure-tiers.md
│   ├── agent-creator/{SKILL.md, scripts/run.ts, references/}
│   ├── command-creator/{SKILL.md, scripts/run.ts, references/}
│   ├── mcp-creator/{SKILL.md, scripts/run.ts, references/}
│   └── plugin-creator/{SKILL.md, scripts/run.ts, references/}
│
├── agents/                              ← auto-discovered
│   └── artifact-reviewer.md
│
├── bin/
│   └── plugin-kit                       ← #!/usr/bin/env bun, chmod +x
│                                           auto-added to Bash tool's PATH
├── shared/                              ← inert to Claude Code; all logic
│   ├── cli.ts                           ← argv → dispatch → --json
│   ├── env.ts                           ← the ONLY reader of CLAUDE_* vars
│   ├── capabilities.ts                  ← the 5×4 matrix as data
│   │
│   ├── references/                      ← cross-cutting prose (all 5 skills)
│   │   ├── descriptions.md
│   │   ├── progressive-disclosure.md
│   │   └── path-anchors.md
│   │
│   ├── schemas/                         ← Zod, pinned specifier
│   │   ├── artifact.ts                  ← discriminated union of 5 kinds
│   │   ├── layout.ts                    ← valid dir structure per kind
│   │   ├── operations.ts                ← validate|benchmark|optimize-* results
│   │   ├── prompt.ts                    ← LLM I/O for optimize ops
│   │   ├── report.ts                    ← envelope the template consumes
│   │   └── __tests__/
│   │
│   ├── parse/                           ← one parser per kind; owned here
│   │   ├── frontmatter.ts               ← every operation imports this
│   │   ├── skill.ts
│   │   ├── agent.ts
│   │   ├── command.ts
│   │   ├── mcp.ts
│   │   ├── plugin.ts
│   │   └── __tests__/
│   │
│   ├── discover/
│   │   ├── find.ts                      ← locate artifacts on disk
│   │   ├── layout.ts                    ← check dir structure
│   │   └── __tests__/
│   │
│   ├── validate/
│   │   ├── collector.ts                 ← accumulates findings; never throws
│   │   ├── rules/
│   │   │   ├── tiers.ts                 ← spec | claude-code | strict
│   │   │   ├── description.ts           ← 1024 / 1536 char caps
│   │   │   ├── body-size.ts             ← 100 / 500 lines, 5k-token budget
│   │   │   ├── references.ts            ← dangling + depth + circular
│   │   │   └── naming.ts
│   │   └── __tests__/
│   │
│   ├── operations/
│   │   ├── validate.ts
│   │   ├── benchmark.ts
│   │   ├── optimize-description.ts
│   │   ├── optimize-disclosure.ts
│   │   └── __tests__/
│   │
│   ├── report/
│   │   ├── template.html                ← static: all markup, CSS, JS
│   │   ├── emit.ts                      ← validates envelope, writes JSON
│   │   └── __tests__/
│   │
│   └── fixtures/                        ← golden corpus, shared by all ops
│       ├── skill/{valid, missing-description, oversized-body, dangling-ref}/
│       ├── agent/{valid, invalid-*}/
│       ├── command/{valid, invalid-*}/
│       ├── mcp/{valid, invalid-*}/
│       └── plugin/{valid, invalid-*}/
│
├── package.json                         ← dev deps only (types, vitest)
├── tsconfig.json
├── .gitignore
├── README.md
└── LICENSE
```

### Why each placement

| Choice | Reason |
|---|---|
| No `dist/` | Plugin root is repo root, so `shared/` is already inside the install boundary |
| Shims in `skills/*/scripts/` | Only `${CLAUDE_SKILL_DIR}` and `${CLAUDE_PROJECT_DIR}` expand in `allowed-tools` |
| Relative import `../../../shared/` | Stays inside the plugin root — `../outside` is **not** copied on install |
| `bin/` kept anyway | On the Bash tool's `PATH` while enabled; useful outside the five skills |
| `shared/references/` | Cross-cutting; `${CLAUDE_PLUGIN_ROOT}` expands anywhere in skill content |

---

## 2. Runtime: Bun, no build step

**TypeScript needs no compilation.** Bun transpiles TS natively. `bun run script.ts`
works with no `tsc`, no bundler, no config.

**Dependencies resolve without `node_modules`.** From Bun's docs:

> If Bun finds no `node_modules` directory in the working directory or higher, it
> abandons Node.js-style module resolution in favor of the Bun module resolution
> algorithm … Bun auto-installs every imported package on the fly into a global
> module cache during execution.

**Pin the version in the import specifier.** This makes the file self-contained —
the docs note that "with version specifiers in `import` statements, even a
`package.json` isn't necessary."

```ts
import { z } from "zod@^4.1.0";
```

Without a pin, Bun resolves `latest` when no `package.json` is found up the tree,
so the validator's behavior can change between runs with no commit.

### Verified: no `-i` flag needed

An earlier concern — that a `node_modules` in the user's project would suppress
auto-install — is **wrong**. Tested on Bun 1.3.14 with a script outside a project
that had `node_modules` present in the cwd:

| Test | Result |
|---|---|
| cwd **has** `node_modules`, bare `import { z } from "zod"`, default flags | works |
| same, with `-i` | works |
| same, pinned `"zod@^4.1.0"` | works |
| same, with `--no-install` | fails |

The `--no-install` error explains why:

```text
error: Cannot find package 'zod' from '/private/tmp/.../plugin/bare.ts'
```

Resolution anchors to **the importing file**, not the working directory. Since
plugin scripts live under `~/.claude/plugins/cache/…` with no `node_modules`
above them, Bun-style resolution and auto-install apply regardless of where the
user is. `--install=fallback` / `-i` is unnecessary.

**Residual risks, both narrow:** the first run on a cold cache needs network, and
a fully offline user fails. Neither justifies a build step unless publishing to a
marketplace for strangers.

### CDN imports do not work

```text
error: ENOENT reading "https://esm.sh/zod@4"
```

Bun treats the URL as a file path. Its docs state it plainly: *"Unlike Deno, Bun
does not currently support URL imports."* `esm.sh`, `unpkg`, and `jsdelivr` are
all out.

---

## 3. Path anchors — `shared/env.ts`

Three variables, three jobs, never conflated. Resolved in exactly one module.

| Anchor | Job | Lifecycle |
|---|---|---|
| `${CLAUDE_PLUGIN_ROOT}` | locate **shipped code** | read-only; replaced wholesale on update |
| `${CLAUDE_PLUGIN_DATA}` | the plugin's **own state** — config, caches, install markers | persists across updates; spans projects |
| `${CLAUDE_PROJECT_DIR}` | the **user's project** | the user's repo, not yours |

**Two prohibitions follow from the lifecycle column:**

- Never write state into `PLUGIN_ROOT` — an update replaces that directory.
- Never put project data in `PLUGIN_DATA` — it spans projects and will bleed
  between them.

**A fourth anchor exists but is not an env var.** `${CLAUDE_SKILL_DIR}` is a
*string substitution* in skill content and `allowed-tools` Bash rules. Only the
three above are exported as environment variables to hook processes and MCP/LSP
subprocesses. A skill script locates itself with `import.meta.dir`, never
`process.env.CLAUDE_SKILL_DIR`.

```ts
/**
 * Path anchors for the plugin-kit runtime.
 *
 * The only place Claude Code's plugin env vars are read. Note that
 * CLAUDE_SKILL_DIR is a string substitution, not an exported env var —
 * a skill script locates itself with import.meta.dir instead.
 */
import { join } from "node:path";

/** Read an env var, falling back when unset or empty. */
function fromEnv(name: string, fallback: () => string): string {
  const value = process.env[name];
  return value && value.length > 0 ? value : fallback();
}

/** Installed plugin directory (shipped code, read-only, replaced on update). */
export function pluginRoot(): string {
  return fromEnv("CLAUDE_PLUGIN_ROOT", () => join(import.meta.dir, ".."));
}

/** Persistent plugin state. Callers create it on first write. */
export function pluginData(): string {
  return fromEnv("CLAUDE_PLUGIN_DATA", () => join(pluginRoot(), ".plugin-kit-data"));
}

/** The user's project root. */
export function projectDir(): string {
  return fromEnv("CLAUDE_PROJECT_DIR", () => process.cwd());
}

/** Static report template shipped with the plugin. */
export function templatePath(): string {
  return join(pluginRoot(), "shared", "report", "template.html");
}
```

### Why the fallback is file-relative

`import.meta.dir` is immune to the working-directory problem. A `process.cwd()`
fallback would reintroduce exactly the bug the anchor exists to fix: a bare
relative path resolves against wherever the user happens to be, which may not
exist — or worse, may exist and be something else.

### Never use `new URL("..", import.meta.url).pathname`

It looks equivalent and is not. Verified in a directory containing a space:

```text
new URL(..).pathname : "/private/tmp/anchor%20test%20dir/"   → does NOT resolve
join(import.meta.dir): "/private/tmp/anchor test dir"        → resolves
fileURLToPath(URL)   : "/private/tmp/anchor test dir/"       → decodes correctly
```

`.pathname` returns the percent-encoded URL component, so `%20` is not a space on
disk and every derived path points at a directory that doesn't exist. It also
prepends a slash on Windows (`/C:/Users/…`), where `C:\Users\First Last\` makes
this the common case rather than an edge case. It additionally returns a trailing
slash, producing `/plugin//.plugin-kit-data` under string concatenation.

Use `join(import.meta.dir, "..")`. `fileURLToPath` from `node:url` also decodes
correctly if a URL is already in hand.

---

## 4. The permission pattern

This is the detail that would otherwise prompt on every one of the 14 operation
cells. From the Claude Code skills docs:

```yaml
---
name: render-chart
description: Render a chart from a CSV file
allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/render.sh *)
---

Run `${CLAUDE_SKILL_DIR}/scripts/render.sh <csv-file>` to render the chart.
```

> Claude Code substitutes `${CLAUDE_SKILL_DIR}` and `${CLAUDE_PROJECT_DIR}` in two
> places: the skill's markdown content, and Bash rules in the `allowed-tools`
> frontmatter. Using the same variable in both places lets a skill run a bundled
> script without a permission prompt.

**Only those two variables expand in `allowed-tools`.** `${CLAUDE_PLUGIN_ROOT}`
expands in skill *content*, in hook and monitor commands, and in MCP/LSP configs —
but it is not listed for `allowed-tools`. If the body renders an absolute path
while the rule stays a literal `${CLAUDE_PLUGIN_ROOT}/…` string, they don't match
and every invocation prompts.

`${CLAUDE_SKILL_DIR}` resolves to `<plugin>/skills/<name>/` — the skill's own
subdirectory, **not** the plugin root.

### The shim pattern

The invocation path must live inside the skill, but module resolution is a
separate concern: ESM resolves relative imports against the file, not the cwd. So
each skill gets a two-line entry point and all logic stays in one place.

`skills/skill-creator/scripts/run.ts`:

```ts
#!/usr/bin/env bun
import { main } from "../../../shared/cli.ts";
await main(Bun.argv.slice(2), { kind: "skill" });
```

`skills/skill-creator/SKILL.md`:

```yaml
---
name: skill-creator
description: …
allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/run.ts *)
---

Validate the skill:

    ${CLAUDE_SKILL_DIR}/scripts/run.ts validate --path <path> --json

For description guidance, see `${CLAUDE_PLUGIN_ROOT}/shared/references/descriptions.md`.
```

`bin/plugin-kit` stays for humans, CI, and ad-hoc agent calls — a convenience
surface, not the permission-critical one.

### Verified depths

| File | Import | Resolves to |
|---|---|---|
| `skills/*/scripts/run.ts` | `../../../shared/cli.ts` | ✓ |
| `bin/plugin-kit` | `../shared/cli.ts` | ✓ |
| `shared/env.ts` | `join(import.meta.dir, "..")` | ✓ plugin root |

---

## 5. The HTML report pattern

Three files, strict separation. This is Anthropic's `session-report` shape.

| File | Owns | Never does |
|---|---|---|
| script (`.ts`) | emits JSON | render markup |
| `template.html` | all markup, CSS, JS — static, committed | know about your data |
| `SKILL.md` | tells Claude to copy the template, inject JSON, write narrative | contain markup |

**Flow:**

1. Run the script, redirect JSON to a temp file.
2. `cp <template> ./report-$(date +%Y%m%d-%H%M).html`
3. **Edit** (not Write) the copy: replace the contents of
   `<script id="report-data" type="application/json">` with the JSON.
4. Fill `<!-- AGENT: findings -->` with 3–5 one-line narrative items.
5. Report the saved path. Do not open it.

The template's JS renders every table, bar, and drill-down from the JSON blob.
Claude supplies data plus prose, never HTML.

**Props contract is a thin envelope, not a per-operation report type:**

```ts
const ReportEnvelope = z.object({
  input:  z.object({ artifact: ArtifactRef, operation: OperationName }),
  output: OperationResult,   // discriminated on `operation`
});
```

The container switches on `output.operation`. That discriminant is the only thing
the renderer needs to know.

**This is where Zod earns its place.** A silently-missing field in a
machine-to-machine JSON contract produces a report full of zeros rather than an
error — a documented failure mode in this exact pattern. Validate the envelope
before it reaches the template.

---

## 6. Validation: two tools, split by boundary

| Boundary | Tool | Why |
|---|---|---|
| Artifact → findings (`SKILL.md`, `plugin.json`, layout) | hand-rolled collector | needs warnings, full enumeration, filesystem checks |
| Script → script / script → viewer JSON | **Zod** | silent-zeros is the documented failure mode |

A schema library is the wrong shape for artifact validation:

- A collector accumulates **warnings and errors separately**. Zod has no warning
  tier; everything is a failure.
- It **continues after a failure** to produce all findings. Zod short-circuits.
- Dangling-reference checks read the filesystem. That isn't a schema question.
- The output is a report with a fix per finding, not a parse error tree.

### Thresholds disagree across sources — use tiers

| Check | Community (`write-a-skill`) | Anthropic docs |
|---|---|---|
| Description length | ≤ 1024 chars | 1,536 (`description` + `when_to_use`) |
| SKILL.md length | ≤ 100 lines | "under 500 lines" |
| References depth | one level, no circular refs | not specified |

There is no single correct threshold, so `validate` carries **named tiers**
(`spec` / `claude-code` / `strict`) rather than hardcoded numbers.

### Hard numbers worth encoding

| Constraint | Value | Feeds |
|---|---|---|
| `description` + `when_to_use` cap | 1,536 characters | validate, optimize-description |
| SKILL.md body | "under 500 lines" | validate, optimize-disclosure |
| Skill listing budget | 1% of model context window | optimize-description |
| **Post-compaction retention** | **first 5,000 tokens per skill** | **optimize-disclosure** |
| Combined re-attach budget | 25,000 tokens across all skills | optimize-disclosure |

The 5,000-token figure is the real justification for `optimize disclosure`. Skill
content stays in context for the whole session, and after auto-compaction only the
first 5,000 tokens of each skill are re-attached. A body over that threshold
silently loses its tail — a measurable pass/fail, not a style opinion.

---

## 7. Capability matrix as data

```ts
export const CAPABILITIES = {
  skill:   ["validate", "benchmark", "optimize-description", "optimize-disclosure"],
  mcp:     ["validate", "benchmark", "optimize-description", "optimize-disclosure"],
  agent:   ["validate", "benchmark", "optimize-description"],
  command: ["validate", "benchmark"],
  plugin:  ["validate", "benchmark"],
} as const satisfies Record<ArtifactKind, readonly OperationName[]>;
```

The CLI rejects unsupported pairs from this table; the template switches on
`output.operation`. Neither the skills nor the renderer hardcodes the answer.

---

## 8. Constraints and gotchas

**Everything in the repo ships.** Installation is a clone into
`~/.claude/plugins/cache/`. There is no `files` field, no ignore mechanism, and no
exclusion hook in the manifest schema. The installed plugin carries
`shared/fixtures/`, every `__tests__/`, `tsconfig.json`, and `package.json`.

The real risk isn't size — it's that `shared/fixtures/` holds *deliberately
invalid* SKILL.md files. They're safe today because discovery only scans `skills/`
at plugin root, but that safety is positional. Guard it:

```ts
// shared/discover/__tests__/fixtures-not-discoverable.test.ts
test("no fixture SKILL.md lives under skills/", async () => {
  const found = [...new Glob("skills/**/SKILL.md").scanSync(pluginRoot())];
  expect(found.filter((p) => p.includes("fixture"))).toEqual([]);
});
```

**Do not gitignore `shared/`.** With no build step, source *is* the shipped
artifact. The reflex to ignore anything outside `dist/` would break the plugin.

**`${CLAUDE_PLUGIN_ROOT}` changes on every plugin update.** The previous version's
directory lingers about two weeks before cleanup. Nothing should cache a resolved
absolute path, and nothing should write state there.

**Components must not live inside `.claude-plugin/`.** Only `plugin.json` goes
there. `skills/`, `agents/`, `commands/`, `hooks/`, `bin/` all sit at plugin root.

**The trade being accepted:** a plugin whose root is the repo root ships its whole
repo, and nothing outside can consume the library. If a separately published CLI
becomes desirable later (the `skillcheck` model — npm package + `npx`, which also
removes every Zod caveat), that's when `packages/` and a `Bun.build` step arrive,
along with the stale-`dist/` failure mode.

---

## 9. Prior art to know about

| Project | Overlap |
|---|---|
| `skill-creator@claude-plugins-official` | benchmark, optimize-description, HTML review viewer — for `skill` only |
| `plugin-dev` (official) | skills for creating skills, hooks, commands, agents |
| `mcp-builder` (official, 99K installs) | MCP authoring; prescribes **Zod** for TS |
| `writing-great-skills` (mattpocock, 314K installs) | pure reference prose, zero scripts |
| `@jkeskikangas/skillcheck` | validator published as a standalone npm package |
| `claude plugin validate --strict` | already checks `plugin.json`, frontmatter, `hooks.json` |

**Differentiation:** breadth (five artifact types vs one), and
`optimize-disclosure`, which nothing else claims and which now has a hard metric.

**Do not rebuild `claude plugin validate`.** Wrap it and add what it doesn't
cover — description quality, disclosure depth, layout conventions. Duplicating its
schema checks creates two sources of truth that will drift.

Established file conventions worth matching rather than inventing:
`evals/evals.json`, `grading.json`, `benchmark.json`.
