# Scenario synthesis: `agent-creator`

- **Target**: `/home/claude/work/skill-creator/skills/agent-creator`
- **Type**: skill (SKILL.md and its bundled files)
- **Read for substance**: 4 source(s) — 1 body, 1 examples, 2 references
- **Material handed to synthesis**: 31,741 characters

## What this artifact appears to do (19)

Derived from the artifact's own structure and its bundled files. The description was
not read — queries written from it would inherit its vocabulary and the eval would
certify the description against itself.

- Does the work want a subagent at all?
- Capture intent
- Gotchas — the failures that say nothing
- Write the definition
- Frontmatter
- The tool grant
- The system prompt body
- The description
- Mechanical pre-flight
- Build the delegation scenario set
- Measure
- Improve
- Claude Code leverage worth reaching for
- Ship it
- Where this ships
- Bundled files, and when each one fires
- Judging whether a race is real or coincidental is the hard part of this job,
- Delegation: how an agent gets reached, and why it usually is not
- Subagent frontmatter: every field, and when it earns its place

## Stated non-goals (8)

Hard negatives are drawn from these, phrased in the positive vocabulary.

- Four criteria, in impact order: a deliverable clause naming what the agent produces rather than the topic it concerns; a negative clause built from the positives' own vocabulary, since a negative made of words the positives never use exc...
- They work as few-shot demonstrations placed in the only text read when the decision is made, and the length guidance above does not apply to them.
- Draw them from the agent's stated non-goals phrased in the positive vocabulary; from the adjacent capability just outside the boundary, which a reasonable person would assume this agent handles; and from co-installed neighbours, since a ...
- And an agent carrying memory is not a pure function of its definition: a difference between two runs may be accumulated state rather than your change, so clear or pin it while measuring and say which you did.
- Do not use to fix the failing test, quarantine it, or add a retry — this agent reports and never edits.
- Do not use when the test suite fails to build or start at all, because there is nothing to sample.
- Do not use to write new tests or to make a slow suite faster.
- They are not interchangeable, and a kebab-case key in an agent file is simply ignored — no warning, no fallback.

## Declared surface

- `allowed-tools: Read`
- `allowed-tools: Grep`
- `allowed-tools: Glob`

## Co-installed neighbours (6)

Scanned 10 installed skill(s). A neighbour sharing this
artifact's vocabulary owns queries this one has to decline, which makes its
territory the sharpest available source of hard negatives.

- `xlsx` (user) — shares `between`, `deliverable`, `edit`, `file`, `read`, `report`, `where`, `word`
- `docx` (user) — **uses pushy phrasing** — shares `change`, `deliverable`, `edit`, `file`, `produce`, `read`, `report`, `word`
- `skill-creator` (user) — shares `creator`, `description`, `edit`, `improve`, `measure`, `test`
- `pdf` (user) — **uses pushy phrasing** — shares `file`, `produce`, `text`
- `pptx` (user) — **uses pushy phrasing** — shares `file`, `text`
- `doc-coauthoring` (user) — shares `decision`, `write`

## Capabilities the description never mentions (9)

Each of these is a finding on its own. The loop optimizes the description, so a
capability its vocabulary never touches generates no queries and is never
penalised for being missing — the score comes back clean and the gap survives.

- Capture intent
- Gotchas — the failures that say nothing
- Mechanical pre-flight
- Measure
- Improve
- Claude Code leverage worth reaching for
- Ship it
- Where this ships
- Judging whether a race is real or coincidental is the hard part of this job,

## Scenarios (20)

- 10 positive, 10 negative (asked for 10 and 10)
- Written to `/home/claude/work/skill-creator/evals/trigger/agent-creator.json`

**Scenarios are a draft.** Confirm the inventory above describes the artifact, then edit the set before running the loop — correcting a misread now costs nothing, and correcting it after an iteration costs the iteration.
