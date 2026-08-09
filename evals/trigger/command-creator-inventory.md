# Scenario synthesis: `command-creator`

- **Target**: `/home/claude/work/skill-creator/skills/command-creator`
- **Type**: skill (SKILL.md and its bundled files)
- **Read for substance**: 6 source(s) — 1 body, 2 examples, 3 references
- **Material handed to synthesis**: 37,860 characters

## What this artifact appears to do (19)

Derived from the artifact's own structure and its bundled files. The description was
not read — queries written from it would inherit its vocabulary and the eval would
certify the description against itself.

- The layout question, settled
- When this skill hands off
- Where this ships
- Gotchas — the failures that render cleanly and are still wrong
- Decide who may invoke it
- Decide the argument contract
- The autocomplete hint
- Decide what context it needs at load time
- The substitutions
- Write it
- Check the rendering
- Measure the triggering, when there is triggering to measure
- Pre-flight
- Bundled files, and when each one fires
- Specimen: the smallest command that earns its place
- Specimen: arguments and injected context together
- Arguments and substitutions: what a command renders to
- Frontmatter for an invocation-first entry point
- Load-time context injection

## Stated non-goals (5)

Hard negatives are drawn from these, phrased in the positive vocabulary.

- Handing off is not a downgrade and it costs nothing — the file you have written becomes the SKILL.md unchanged.
- - A skill and a command with the same name are not an error — the skill wins.
- Reaching for it usually means this is not a command any more, and skill-creator is the better fit.
- Check what it reveals: an environment dump, a config print, a verbose CI log will carry secrets into context, and context is not a place you can take something back from.
- You are not looking for a crash; you are looking at what the model is told to do when the user fumbles, which should degrade into a question rather than a confident wrong action.

## Declared surface

- `allowed-tools: Read`
- `allowed-tools: Grep`
- `allowed-tools: Glob`

## Co-installed neighbours (6)

Scanned 10 installed skill(s). A neighbour sharing this
artifact's vocabulary owns queries this one has to decline, which makes its
territory the sharpest available source of hard negatives.

- `xlsx` (user) — shares `file`, `mean`, `name`, `time`, `where`
- `morning` (user) — shares `invoke`, `name`, `question`, `render`
- `pptx` (user) — **uses pushy phrasing** — shares `file`, `layout`, `time`
- `grill-me` (user) — shares `question`, `time`, `written`
- `skill-creator` (user) — shares `better`, `creator`, `measure`
- `doc-coauthoring` (user) — shares `context`, `write`

## Capabilities the description never mentions (6)

Each of these is a finding on its own. The loop optimizes the description, so a
capability its vocabulary never touches generates no queries and is never
penalised for being missing — the score comes back clean and the gap survives.

- The layout question, settled
- When this skill hands off
- Where this ships
- The substitutions
- Measure the triggering, when there is triggering to measure
- Pre-flight

## Scenarios (20)

- 10 positive, 10 negative (asked for 10 and 10)
- Written to `/home/claude/work/skill-creator/evals/trigger/command-creator.json`

**Scenarios are a draft.** Confirm the inventory above describes the artifact, then edit the set before running the loop — correcting a misread now costs nothing, and correcting it after an iteration costs the iteration.
