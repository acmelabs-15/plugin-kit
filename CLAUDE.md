# plugin-kit

Builds every Claude Code component and measures whether it works.

## Vocabulary is fixed, and it binds

`CONTEXT.md` is this repo's glossary. Read it before writing prose, naming a
symbol, or choosing a word in a commit message. Its `_Avoid_` lines are decisions,
not preferences: a term listed there was rejected for a recorded reason.

The one you will hit first: the five things a plugin carries are **components**.
The TypeScript still calls them `artifact` in about 450 places — `ArtifactKind`,
`ENVELOPE_ARTIFACTS`, `asArtifactKind`. That is known, deferred, and recorded in
`docs/decisions/ADR-002-component-is-the-canonical-term.md`. Match the surrounding
code when you edit those files; use `component` in every new name and all prose.

A term the glossary lacks is a gap to raise, not a synonym to coin.

## Decisions live in `docs/decisions/`

`ADR-NNN-kebab-title.md`, with frontmatter matching the existing files. Write one
only when the decision is hard to reverse, surprising without context, and the
result of a real trade-off. Analysis notes go in `docs/analysis/`, session notes in
`docs/sessions/`.

## Pure Bun

Nothing here spawns `node`, `npx`, `python` or `uv`. `bun shared/tools/check-bun-purity.ts .`
enforces it.

Importing `node:fs/promises` satisfies the rule — Bun implements those builtins
natively, and no Node needs to exist on the machine. Where a Bun-native API exists
it wins: `Bun.file` over `readFile`, `Bun.Glob` over hand-rolled globbing,
`Bun.spawn` over `child_process`. Three `node:` modules survive that filter because
Bun offers no equivalent: `node:fs/promises`, `node:os`, `node:path`.

## Tests sit beside their subject

`__tests__/<filename>.test.ts` next to the file under test, using `bun:test`.
`bunfig.toml` deliberately sets no test root, so a suite anywhere is picked up.

`shared/` holds deliberately-invalid fixtures. They stay inert only because
discovery scans `skills/` at plugin root and never reaches them — a positional
safety with no test guarding it. Do not move a fixture, or a scan root, without
checking that still holds.

## Everything in the repo ships

Installation copies the whole directory into a cache. There is no `files` field and
no ignore mechanism, so `shared/`, every `__tests__/`, and the fixtures all travel
with it. Do not gitignore `shared/` — with no build step, source *is* the shipped
artifact.

## Where things are

`skills/` five creators, `agents/` five reviewers, `shared/` all logic and the
cross-cutting references, `evals/` what this plugin measured about itself,
`future/` parked work. `README.md` carries the full tour.
