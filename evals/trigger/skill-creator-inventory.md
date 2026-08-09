# Scenario synthesis: `skill-creator`

- **Target**: `/home/claude/work/skill-creator/skills/skill-creator`
- **Type**: skill (SKILL.md and its bundled files)
- **Read for substance**: 41 source(s) — 1 body, 2 examples, 17 references, 20 scripts, 1 assets (names only)
- **Material handed to synthesis**: 80,000 characters

## What this artifact appears to do (24)

Derived from the artifact's own structure and its bundled files. The description was
not read — queries written from it would inherit its vocabulary and the eval would
certify the description against itself.

- Gotchas
- Creating a skill
- Capture intent
- Write the SKILL.md
- Writing style
- Pre-flight, run as a loop
- Write the evals
- Running and evaluating the evals
- Improving the skill
- Description optimization
- Progressive disclosure optimization
- Shipping, packaging and other environments
- evals
- trigger eval set
- Analyst passes
- Authoring checklist
- Blind Comparator Agent
- Running the description optimization loop
- Writing a description that fires on the right queries
- Optimizing progressive disclosure by measurement
- Distribution targets
- Environments
- Eval evidence: what to commit, and why it lives in the repo
- SKILL.md frontmatter: the standard, the extensions, and which ones fail open

## Stated non-goals (12)

Hard negatives are drawn from these, phrased in the positive vocabulary.

- The rule: match on the artifact the skill produces, not the topic it is about, and name at least one same-domain case it is not for.
- Either this or Ctrl-C records the run as done rather than failed, since a deliberate shutdown is not a failure.
- - [ ] At least one "Do not use when…" clause, and its exclusions share vocabulary with the positive claims — an obviously-irrelevant exclusion defends against nothing
- You receive two outputs labeled A and B, but you are not told which skill produced which.
- - the artifact's stated non-goals, phrased in the positive vocabulary
- Do NOT use when a skill is merely the subject matter rather than the artifact being produced: reviewing or auditing someone else's skill for security or quality, debugging why an installed skill errors at runtime, writing documentation o...
- Do NOT use when the user asks you to follow a plan, brief, or spec that happens to mention skills or plugins among its inputs — follow that document instead.
- Benchmarking or variance analysis of anything other than skill triggering is out of scope.
- So "does this work in Claude Desktop?" is not a question with one answer.
- The quantitative comparison depends on baselines, and baselines are not meaningful without independent runs.
- Trigger text is lost, a model override does not apply, an autocomplete hint does not appear.
- They are not redundant — a 480-line file with long paragraphs can be 7,000 tokens and blow the budget while passing the line check.

## Declared surface

- `allowed-tools: Read`
- `allowed-tools: Grep`
- `allowed-tools: Glob`

## Co-installed neighbours (6)

Scanned 10 installed skill(s). A neighbour sharing this
artifact's vocabulary owns queries this one has to decline, which makes its
territory the sharpest available source of hard negatives.

- `xlsx` (user) — shares `document`, `file`, `input`, `name`, `open`, `other`, `output`, `produced`
- `pptx` (user) — **uses pushy phrasing** — shares `creating`, `file`, `input`, `output`, `plan`, `text`
- `doc-coauthoring` (user) — shares `authoring`, `creating`, `documentation`, `spec`, `write`, `writing`
- `morning` (user) — shares `about`, `answer`, `artifact`, `brief`, `name`, `question`
- `skill-creator` (user) — shares `analysi`, `creator`, `description`, `eval`, `variance`
- `pdf` (user) — **uses pushy phrasing** — shares `creating`, `file`, `produce`, `text`

## Capabilities the description never mentions (12)

Each of these is a finding on its own. The loop optimizes the description, so a
capability its vocabulary never touches generates no queries and is never
penalised for being missing — the score comes back clean and the gap survives.

- Gotchas
- Capture intent
- Write the SKILL.md
- Pre-flight, run as a loop
- Progressive disclosure optimization
- Shipping, packaging and other environments
- Analyst passes
- Authoring checklist
- Blind Comparator Agent
- Distribution targets
- Environments
- SKILL.md frontmatter: the standard, the extensions, and which ones fail open

## Scenarios (20)

- 10 positive, 10 negative (asked for 10 and 10)
- Written to `/home/claude/work/skill-creator/evals/trigger/skill-creator.json`

**Scenarios are a draft.** Confirm the inventory above describes the artifact, then edit the set before running the loop — correcting a misread now costs nothing, and correcting it after an iteration costs the iteration.
