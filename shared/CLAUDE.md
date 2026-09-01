# shared/

All logic lives here. Claude Code does not discover anything in this tree — no
frontmatter is read, and the directories are grouped by function rather than by
load mode.

`shared/report/` is the recorded exception to that grouping and not a fifth load
mode: it holds the report generators together with the HTML they fill, because
splitting them across `scripts/` and `assets/` would scatter one component.

## Two things called "agent" that are not the same

`agents/*.md` at repo root are **subagent definitions** — frontmatter, discovered
by Claude Code, each running in its own context.

`shared/references/grader.md`, `blind-comparison.md` and `comparison-analysis.md`
are **prompt payloads** — no frontmatter, invisible to Claude Code. The eval
scripts read them and send their text to a model. They are data, not components.

Keep the names apart. Collapsing them implies the payloads are loadable and the
definitions are inlineable, and neither is true.

## Zod earns its place at machine boundaries only

Two validation styles, split by boundary:

- **Component → findings** (`SKILL.md`, `plugin.json`, layout): the hand-rolled
  collector. It separates warnings from errors, continues after a failure to
  produce every finding, and reads the filesystem. Zod does none of those.
- **Script → script, script → viewer JSON**: Zod. A silently-missing field in a
  machine-to-machine contract renders a report full of zeros rather than an error.

Pin the exact version in the specifier — `import { z } from "zod@4.1.0"`. A range
like `^4.1.0` still admits `4.9.x`, which reintroduces the drift the pin exists to
stop.

## The dependency floor

`shared/util/` may import runtime builtins and its own siblings. Nothing else.
`shared/util/__tests__/import-direction.test.ts` scans the directory and enforces
it, so a module added tomorrow is covered without anyone enrolling it.

## Path anchors resolve in one place

`${CLAUDE_PLUGIN_ROOT}` locates shipped code and is replaced wholesale on update —
never write state there. `${CLAUDE_PLUGIN_DATA}` is the plugin's own state and
spans projects — never put project data there. `${CLAUDE_PROJECT_DIR}` is the
user's repo.

`${CLAUDE_SKILL_DIR}` is a string substitution in skill content and `allowed-tools`
Bash rules, not an exported environment variable. A script locates itself with
`import.meta.dir`.

Never use `new URL("..", import.meta.url).pathname` — it returns the percent-encoded
component, so a directory containing a space resolves to a path that does not exist.
Use `join(import.meta.dir, "..")`.
