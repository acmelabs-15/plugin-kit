# Scenario synthesis: `create-plugin`

- **Target**: `/home/claude/work/skill-creator/skills/create-plugin`
- **Type**: skill (SKILL.md and its bundled files)
- **Read for substance**: 3 source(s) — 1 body, 2 references
- **Material handed to synthesis**: 26,944 characters

## What this artifact appears to do (6)

Derived from the artifact's own structure and its bundled files. The description was
not read — queries written from it would inherit its vocabulary and the eval would
certify the description against itself.

- The manifest
- Gotchas — the silent failures that only happen inside a plugin
- Diagnostics
- Finish
- Path anchors: three of them, three jobs
- Shared code across a plugin's skills

## Stated non-goals (3)

Hard negatives are drawn from these, phrased in the positive vocabulary.

- It carries the artifact-by-surface matrix, the MCPB manifest fields, the rest of the submission requirements, the admin precedence rules that decide whether a fleet install can be overridden, the traps that look portable and are not, and...
- None of the three has a standalone install path off Claude Code, so for anything distributed the plugin is not a packaging convenience — it is the only delivery mechanism they have.
- They are not interchangeable, and conflating them produces failures that only appear after an update or in someone else's project — which is the worst time to find them.

## Declared surface

- `allowed-tools: Read`
- `allowed-tools: Grep`
- `allowed-tools: Glob`

## Co-installed neighbours (4)

Scanned 10 installed skill(s). A neighbour sharing this
artifact's vocabulary owns queries this one has to decline, which makes its
territory the sharpest available source of hard negatives.

- `xlsx` (user) — shares `create`, `path`, `standalone`, `time`
- `grill-me` (user) — shares `portable`, `produce`, `requirement`, `time`
- `docx` (user) — **uses pushy phrasing** — shares `create`, `find`, `produce`
- `startup-hook-skill` (user) — shares `create`, `project`

## Capabilities the description never mentions (3)

Each of these is a finding on its own. The loop optimizes the description, so a
capability its vocabulary never touches generates no queries and is never
penalised for being missing — the score comes back clean and the gap survives.

- Diagnostics
- Finish
- Path anchors: three of them, three jobs

## Scenarios (20)

- 10 positive, 10 negative (asked for 10 and 10)
- Written to `/home/claude/work/skill-creator/evals/trigger/create-plugin.json`

**Scenarios are a draft.** Confirm the inventory above describes the artifact, then edit the set before running the loop — correcting a misread now costs nothing, and correcting it after an iteration costs the iteration.
