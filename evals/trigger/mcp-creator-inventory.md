# Scenario synthesis: `mcp-creator`

- **Target**: `/home/claude/work/skill-creator/skills/mcp-creator`
- **Type**: skill (SKILL.md and its bundled files)
- **Read for substance**: 5 source(s) — 1 body, 2 examples, 2 references
- **Material handed to synthesis**: 31,674 characters

## What this artifact appears to do (18)

Derived from the artifact's own structure and its bundled files. The description was
not read — queries written from it would inherit its vocabulary and the eval would
certify the description against itself.

- Gotchas
- Decide the home before writing anything
- Choosing a transport
- Where this ships
- The tool name is not what you think it is
- The same server, named three other ways
- Credentials in a plugin that ships to other people
- Interpolation, and the failure that does not fail
- Paths for a stdio command
- Scope, precedence, and trust
- Verify
- Designing the tool surface
- Pre-flight
- Bundled files
- Worked example: acme-devtools, four servers, every derived name
- plugin mcp
- The server entry: every field, every location, every name
- Designing and measuring the tool surface

## Stated non-goals (6)

Hard negatives are drawn from these, phrased in the positive vocabulary.

- A plugin lands on machines you will never see, so "it works on mine" is not a strategy.
- A user-scope entry named issue-tracker carrying only a url completely replaces a plugin entry of that name that had url, headers and a timeout — the headers are not inherited, they are gone.
- The cost: an unconnected server's tools are not in the model's tool list, and the model cannot choose a tool it cannot see.
- The config half of this skill is prescriptive because its failure modes are fixed; this half is not, because they are not.
- tenantId is not a secret, so it is a plain prompted string.
- The URL carries a default so the entry works unconfigured against production, while ACME_TRACKER_URL lets someone point it at staging without editing a shipped file — a default is right here precisely because a hostname is not a secret.

## Declared surface

- `allowed-tools: Read`
- `allowed-tools: Grep`
- `allowed-tools: Glob`

## Co-installed neighbours (5)

Scanned 10 installed skill(s). A neighbour sharing this
artifact's vocabulary owns queries this one has to decline, which makes its
territory the sharpest available source of hard negatives.

- `xlsx` (user) — shares `file`, `header`, `name`, `other`, `path`, `where`
- `pptx` (user) — **uses pushy phrasing** — shares `editing`, `file`
- `doc-coauthoring` (user) — shares `verify`, `writing`
- `docx` (user) — **uses pushy phrasing** — shares `file`, `replace`
- `mcp-builder` (user) — shares `model`, `server`

## Capabilities the description never mentions (6)

Each of these is a finding on its own. The loop optimizes the description, so a
capability its vocabulary never touches generates no queries and is never
penalised for being missing — the score comes back clean and the gap survives.

- Gotchas
- Decide the home before writing anything
- Where this ships
- Verify
- Pre-flight
- Bundled files

## Scenarios (20)

- 10 positive, 10 negative (asked for 10 and 10)
- Written to `/home/claude/work/skill-creator/evals/trigger/mcp-creator.json`

**Scenarios are a draft.** Confirm the inventory above describes the artifact, then edit the set before running the loop — correcting a misread now costs nothing, and correcting it after an iteration costs the iteration.
