# Scenario synthesis: `hook-creator`

- **Target**: `/home/claude/work/skill-creator/skills/hook-creator`
- **Type**: skill (SKILL.md and its bundled files)
- **Read for substance**: 10 source(s) — 1 body, 5 examples, 2 references, 2 scripts
- **Material handed to synthesis**: 46,409 characters

## What this artifact appears to do (20)

Derived from the artifact's own structure and its bundled files. The description was
not read — queries written from it would inherit its vocabulary and the eval would
certify the description against itself.

- Does this want a hook?
- Pick the narrowest event
- The if field is where the cost lives
- Pick the handler type
- Gotchas
- Write the handler
- Test it, and keep testing until it passes
- Wire it in
- Where this ships
- Debug
- Bundled files
- Worked example: protected-branch-guard
- PreToolUse guard: refuse a force push to a protected branch.
- SessionStart context: tell Claude where the repository stands.
- PostToolUse reaction: tidy the file Claude just wrote.
- hooks
- Every hook event
- Handlers: the five types, the JSON contract, and the environment
- The hook event table the harness runs against.
- Payload harness for Claude Code hooks.

## Stated non-goals (2)

Hard negatives are drawn from these, phrased in the positive vocabulary.

- A hook is the one Claude Code component whose behaviour is not a model judgement.
- Read ../skill-creator/references/distribution-targets.md when the hook has to reach a surface beyond the machine you are on, or when the plugin carrying it also ships skills or an MCP server whose reach differs — it has the artifact-by-s...

## Declared surface

- `allowed-tools: Read`
- `allowed-tools: Grep`
- `allowed-tools: Glob`

## Co-installed neighbours (6)

Scanned 10 installed skill(s). A neighbour sharing this
artifact's vocabulary owns queries this one has to decline, which makes its
territory the sharpest available source of hard negatives.

- `xlsx` (user) — shares `file`, `read`, `reference`, `where`
- `startup-hook-skill` (user) — shares `hook`, `repository`, `sessionstart`, `test`
- `docx` (user) — **uses pushy phrasing** — shares `file`, `read`, `table`
- `mcp-builder` (user) — shares `context`, `model`, `server`
- `pdf` (user) — **uses pushy phrasing** — shares `file`, `table`
- `pptx` (user) — **uses pushy phrasing** — shares `file`, `reference`

## Capabilities the description never mentions (10)

Each of these is a finding on its own. The loop optimizes the description, so a
capability its vocabulary never touches generates no queries and is never
penalised for being missing — the score comes back clean and the gap survives.

- The if field is where the cost lives
- Gotchas
- Wire it in
- Where this ships
- Debug
- Bundled files
- Worked example: protected-branch-guard
- PreToolUse guard: refuse a force push to a protected branch.
- SessionStart context: tell Claude where the repository stands.
- PostToolUse reaction: tidy the file Claude just wrote.

## Scenarios (20)

- 10 positive, 10 negative (asked for 10 and 10)
- Written to `/home/claude/work/skill-creator/evals/trigger/hook-creator.json`

**Scenarios are a draft.** Confirm the inventory above describes the artifact, then edit the set before running the loop — correcting a misread now costs nothing, and correcting it after an iteration costs the iteration.
