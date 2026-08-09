---
title: "SESSION-2026-08-09_01: Plugin Kit Shared Layer Restructure"
type: session
status: IN_PROGRESS
permalink: sessions/session-2026-08-09-01-plugin-kit-shared-layer-restructure
tags:
- session
- restructure
- shared-layer
- verification
---

# SESSION-2026-08-09_01: Plugin Kit Shared Layer Restructure

## Session Info

- **Date**: 2026-08-09
- **Branch**: `restructure-shared-layer`
- **Objective**: execute the 9-step restructure of the `shared/` layer toward the design target recorded in `docs/architecture.md` (a plain project doc, not a knowledge-graph note)
- **Handover brief**: `docs/continuation.md`
- **Position**: steps 1 and 2 of 9 COMPLETE; step 3 of 9 next

## Ledger

### Event 1 — Brain MCP unreachable at session start

- Symptom: MCP error -32000; server exited on start
- Root cause: `~/.basic-memory/config.json` carried project `plugin-kit` as a bare string where the schema requires a ProjectEntry object; basic-memory's Pydantic validation rejected the shape and the server exited
- Fix: entry rewritten in object form
- Backup: `~/.basic-memory/config.json.bak-20260809`
- Suspected upstream defect: the Brain `create_project` write path reported success while writing a shape its own loader rejects

### Event 2 — repo verified against handover claims

- Confirmed absent: `bin/`, `shared/cli.ts`, `shared/env.ts`, `shared/capabilities.ts`, and `shared/{schemas,parse,discover,operations,report,fixtures}/`
- Confirmed present: `shared/scripts` 13 entry points; `lib/` 15; `__tests__/` 26
- Confirmed: `envelope.ts` is 919 lines
- Confirmed: all ten domain-free modules (pool, mt19937, stats, fnmatch, mime, pyfloat, zipwriter, subprocess, progress, browser) sit in `shared/scripts/lib/`

### Event 3 — divergence: test suite counts

- Observed 1,276 pass / 1 fail across 27 files; handover claimed 1,131 / 0 / 26
- Failure at `shared/scripts/__tests__/validate.test.ts:465`
- Mechanism: the test builds its expected path by concatenating a `root` that carries the macOS `TMPDIR` trailing slash, producing a doubled separator the implementation normalises away
- Same tautology-shaped defect class already documented once in this project
- Disposition: lives in the hooks rules, which a later step deletes

### Event 4 — divergence: eval-viewer file count

- `shared/eval-viewer` is 7 files (3 `.html`, 4 `.ts`), not the claimed 4

### Event 5 — step 1 of 9 COMPLETE, commit `7ab0fcc`

Six corrections applied across `docs/architecture.md` and `shared/references/pure-bun.md`:

1. cell count 14 to 15 at two sites
2. `vitest` to `bun test`
3. `zod@^4.1.0` to `zod@4.1.0`
4. fixtures guard replaced: the old one globbed `skills/**` and filtered for `fixture`, but the corpus lives under `shared/`, so it could never fail
5. single `artifact-reviewer.md` replaced with five per-artifact reviewers
6. first-run network assumption stated in `pure-bun.md`

### Event 6 — deliberately preserved

- `docs/architecture.md:176` keeps `zod@^4.1.0` because it records what was actually tested; a measurement record is never edited to match a later decision

### Event 7 — carried forward

- `docs/architecture.md:434` asserts a 25,000-token combined re-attach budget with no justification, while the 5,000-token figure directly below it is fully argued
- `skills/plugin-creator/references/shared-code-architecture.md` argues for a build step, contradicting the no-build-step decision
- Next: step 2 of 9 — retire hooks (`shared/rules/hooks.ts`, the `registry.ts` import and target-type entry, and `agents/hook-reviewer.md`)

### Event 8 — step 2 scope was under-stated by the handover

- Handover framed the retirement as "three edits, clean dependency; nothing else breaks"
- True of the import graph: only `registry.ts` imported `hooksRules`
- False of the description surface: `hook-reviewer` was named inside the `description:` frontmatter of all five surviving reviewers, plus routing rows in `README.md` and `skills/plugin-creator/SKILL.md`
- The house rule that a removal is not done until every description naming the artifact is enumerated is what surfaced this; the import-graph check alone would have shipped five descriptions pointing at a deleted agent

### Event 9 — decision locked: keep the exclusion, drop the pointer

- Each reviewer description still excludes hook review, but no longer names an agent that does not exist
- Clause applied verbatim across five files: "Do not use to review a hook — no agent in this plugin covers hook review."
- Rejected: dropping the hook clause entirely, which would have removed the negative that keeps the five reviewers off hook audits nothing else catches

### Event 10 — step 2 of 9 COMPLETE, commit `e11b23b`

- Deleted `shared/rules/hooks.ts` (409 lines) and `agents/hook-reviewer.md`
- Registry import and entry removed; `TARGET_TYPES` narrowed to five by derivation, verified rather than assumed
- `ArtifactKind` and `ARTIFACT_KINDS` in `envelope.ts` narrowed so the envelope vocabulary stops advertising a kind nothing produces; no stored envelope carries `artifact: "hooks"`, so nothing on disk newly fails
- `compareRuns`, `explainIncomparability` and `COMPARABILITY_KEYS` inspected and left untouched, as a later step reserves them
- Two docblocks counting a "seventh artifact" corrected to five
- Suite went 1,276 pass / 1 fail to 1,269 pass / 0 fail; the deleted `describe` block carried the failing assertion, so the tautology was never repaired
- `evals/RETIRED-ARTIFACTS.md` created as a mapping note beside the seven immutable eval records naming the retired artifacts

### Event 11 — carried forward from step 2

- All five reviewer descriptions were already 289 to 943 characters over the 1,536 cap before this session touched them; the edit added a uniform 51
- Unresolved: whether `<example>` blocks count against that cap. Stripped of examples every description lands between 855 and 1,139
- `README.md` still advertises `hook-creator` as shipped when it lives in parked `future/`
- `future/hook-testing/hook-creator/SKILL.md:214` instructs running `skill-creator:hook-reviewer`, which no longer resolves if that subtree is unparked
- Next: step 3 of 9 — give the ten domain-free modules a `shared/util/` home and add the import-direction test

### Event 12 — the 1,536 cap does not apply to subagents; the premise was wrong

- Investigated in parallel: Claude Code documentation, and what this repo actually enforces
- 1,536 caps the **skill listing**, on `description` plus `when_to_use` combined. Subagents have no `when_to_use` field and no documented description cap at all
- `DESCRIPTION_HARD_MAX = 1536` at `shared/scripts/validate-skill.ts:70` is skill-only and structurally unreachable from the agent path: the branch sits behind `tier === "extended"`, and `shared/rules/agent.ts:47` sets `honoursTier: false`
- Agents carry their own independent rule at `shared/rules/agent.ts:41`, `DESCRIPTION_MAX = 1024`, which pushes to `warnings`; `shared/scripts/validate.ts:682` exits non-zero on errors only, so an over-length agent description exits 0
- Three modules hold three independent length literals with no shared source: `validate-skill.ts:70` at 1536, `agent.ts:41` at 1024, `command.ts:33` at 1024
- Provenance of 1,536: no measurement, no test, one uncited "Anthropic docs" table attribution, propagated across seven files. `evals/` has zero hits for `1536` or `truncat`
- `docs/architecture.md:436` claims 1,536 feeds `optimize-description`; `shared/scripts/propose-description.ts:210` actually instructs the model at 1024
- Nothing runs `validate` at all: `package.json` has only `test` and `typecheck`, there is no CI directory, and no hook wires it up
- Correction to an earlier claim in this session: the five reviewer descriptions were reported as "289 to 943 over the cap". No enforced cap applies to them

### Event 13 — defect found: block-scalar descriptions truncate at the first blank line

- `shared/scripts/lib/frontmatter.ts:106` ends block-scalar collection at any line starting with neither two spaces nor a tab; a blank line inside the scalar matches neither
- Every reviewer description carries a blank line after its opening paragraph, so collection stops there
- Measured loss through `readTargetDefinition`, conformant parse versus hand-rolled: skill 1876 to 368, agent 2237 to 430, command 2530 to 510, mcp 2467 to 492, plugin 2474 to 532. Between 78 and 81 percent, with `<example>` blocks present in one and absent in the other
- Consequence for reads: every trigger measurement ever produced for these five describes about a fifth of the shipped string
- Consequence for writes: `optimize-description.ts:379-382` seeds from the same reader and `measure-triggering.ts:321` writes frontmatter back as a space-joined `description: |`, so an optimize run would silently replace a 1,876-character description with a ~368-character one
- The docblock at `measure-triggering.ts:438-441` asserts the opposite, claiming example blocks "survive as text but lose their line breaks". Same documented-value-versus-render-truth shape the port analysis already recorded once

### Event 14 — decision locked: fix the call site, not the parser

- The hand-rolled parser is bug-compatible with the Python original deliberately, and the port analysis records its quirks as load-bearing, naming newline loss in block scalars but not truncation
- Losing line breaks and losing 80 percent of the content are different claims, so the truncation is treated as an undocumented defect rather than a preserved quirk
- Fix scoped to the agent read path in `measure-triggering.ts`, reusing the conformant reader already present at `shared/rules/lib.ts:72`. `frontmatter.ts` is not edited
- A regression test asserting an example block survives the read is part of the fix; the defect was invisible because nothing asserted it
- Whether SKILL.md descriptions are affected the same way is being investigated but explicitly not acted on: widening to skills is a separate decision

### Event 15 — agent read path fixed, commit `54dba23`

- Agent branch of `readTargetDefinition` routed to the conformant reader already present at `shared/rules/lib.ts:72`; `shared/scripts/lib/frontmatter.ts` verified unchanged by diff
- Read lengths restored: 1875, 2236, 2529, 2466, 2473, with `<example>` blocks present in all five
- Write path verified a fixed point across two passes, so no separate guard was built
- Regression test added and confirmed to fail against the old reader rather than merely pass against the new one; the defect survived because nothing asserted the tail
- Suite 1,269 to 1,270 pass, 0 fail, typecheck clean

### Event 16 — the same defect affects four of five skills

- Verified independently, whitespace-collapsed so the newline-versus-space join is not miscounted as loss: `skill-creator` 947 to 567 (40%), `command-creator` 832 to 586 (30%), `plugin-creator` 891 to 688 (23%), `agent-creator` 942 to 735 (22%), `mcp-creator` 943 to 943 (0%)
- Confirmed identical root cause rather than a lookalike: `skills/skill-creator/SKILL.md` carries `description: |` at line 9, content at 10, a blank line at 11, and a second paragraph at 12 the reader never reaches
- Evidence-integrity consequence: the 2026-08-08 triggering table in `evals/MEASUREMENTS.md` is presented as executed measurement, and for four of five skills it measured a string 22 to 40 percent shorter than what ships. All five had paragraph breaks flattened to spaces, so even the unaffected skill was measured in a different shape than it ships

### Event 17 — decision locked: same call-site fix for skills, plus a mapping note

- Skill branch routed to the conformant reader on the same reasoning as agents; `parseSkillMd` and every other caller of the hand-rolled parser stay bug-compatible
- `evals/MEASUREMENT-CAVEATS.md` records what the 2026-08-08 run actually measured, beside the record rather than inside it, because a measurement record is never edited to match a later reality
- Accepted consequence: measurements taken after the fix are not comparable with the 2026-08-08 baseline. That baseline measured strings that do not ship, so the loss of comparability is the correct outcome rather than a regression
- Rejected: reflowing the four SKILL.md descriptions to remove blank lines, which would contort authoring around a parser defect and let the next paragraph break silently reintroduce the truncation
- Open and delegated for report only: whether the third target type, `command`, is affected. No `commands/` directory appears to exist, which would make that branch dead in practice

## Observations

### Session infrastructure

- [problem] Brain MCP exited with error -32000 because the basic-memory config held project `plugin-kit` as a bare string where a ProjectEntry object is required #brain-mcp #config
- [solution] Rewriting the project entry in object form restored the server; the prior file is preserved as a dated `.bak` alongside it #brain-mcp #recovery
- [risk] The Brain `create_project` handler is suspected of reporting success while writing a shape its own loader rejects, so other projects may carry the same latent break #brain-mcp #write-path
- [risk] Brain `write_note` silently dropped a `status` field passed via `metadata`, needing a repair edit; same report-success-and-drop shape as the `create_project` defect #brain-mcp #write-path

### Verification and divergences

- [fact] Repo verification confirmed the handover's absent-surface claims: no `bin/`, `shared/cli.ts`, `shared/env.ts`, `shared/capabilities.ts`, nor the six planned `shared/` subdirectories #verification #restructure
- [fact] `shared/scripts` holds 13 entry points, `lib/` 15, `__tests__/` 26; `envelope.ts` is 919 lines; all ten domain-free modules sit in `shared/scripts/lib/` #verification #inventory
- [problem] Test suite measured 1,276 pass / 1 fail over 27 files against a claimed 1,131 / 0 / 26, so the handover's baseline was stale #divergence #tests
- [insight] The single failure was tautology-shaped: the test concatenated a `root` carrying the macOS `TMPDIR` trailing slash and asserted a doubled separator the implementation normalises away #tests #defect-class
- [problem] `shared/eval-viewer` is 7 files (3 html, 4 ts), not the 4 the handover claimed #divergence #inventory
- [insight] The handover's scoping proved reliable about code and unreliable about content surface, which is the pattern to expect across the remaining steps #handover #scoping

### Step outcomes and locked decisions

- [outcome] Step 1 of 9 complete at commit `7ab0fcc`, applying six corrections across the architecture doc and the pure-bun reference #milestone #restructure
- [outcome] Step 2 of 9 complete at commit `e11b23b`; suite went 1,276 pass / 1 fail to 1,269 pass / 0 fail with typecheck clean #milestone #hooks
- [insight] The replaced fixtures guard could never fail: it globbed `skills/**` and filtered for `fixture` while the fixture corpus lives under `shared/` #guard #false-negative
- [decision] `docs/architecture.md:176` keeps `zod@^4.1.0` because it records what was actually tested, and a measurement record is never edited to match a later decision #provenance #measurement
- [decision] The failing hooks assertion was left unrepaired and deleted with the block it lived in, rather than fixed then removed #tests #sequencing
- [decision] Retiring `hook-reviewer` keeps the hook exclusion in all five reviewer descriptions and drops the pointer, so no description names an agent that is not there #descriptions #hooks
- [decision] The block-scalar truncation is fixed at the call site, leaving the deliberately bug-compatible parser untouched #parser #bug-compatibility

### Defects and unsupported claims

- [problem] `shared/scripts/lib/frontmatter.ts:106` ends block-scalar collection at the first blank line, losing 78 to 81 percent of every agent description and dropping `<example>` blocks entirely #parser #data-loss
- [risk] `optimize-description` seeds from that truncated read and writes frontmatter back, so a run against any reviewer would silently replace a 1,876-character description with roughly 368 characters #parser #destructive-write
- [problem] The docblock at `measure-triggering.ts:438-441` asserts example blocks survive the read when they do not, repeating the documented-value-versus-render-truth failure the port analysis already recorded #documentation #drift
- [problem] The 1,536 cap does not apply to subagents: it caps the skill listing on `description` plus `when_to_use`, and subagents have no `when_to_use` field #cap #premise-error
- [fact] `DESCRIPTION_HARD_MAX` is skill-only and unreachable from the agent path; agents carry an independent 1024 warning that exits 0, and three modules hold three unshared length literals #validation #duplication
- [problem] Nothing in the repo runs `validate`: no CI directory, no hook, and `package.json` carries only `test` and `typecheck` #validation #coverage-gap
- [risk] The 25,000-token combined re-attach budget at `docs/architecture.md:434` is asserted without justification while the 5,000-token figure directly below it is fully argued #budget #unsupported-claim
- [problem] `skills/plugin-creator/references/shared-code-architecture.md` argues for a build step, contradicting the no-build-step decision #contradiction #build-step

### Carried forward

- [requirement] Step 3 of 9 gives the ten domain-free modules a `shared/util/` home and adds the import-direction test #next-step #util
- [requirement] Whether SKILL.md descriptions suffer the same block-scalar truncation is open and deliberately unacted on, as widening the fix is a separate decision #parser #open-question
- [requirement] `README.md` still advertises `hook-creator` as shipped when it lives in parked `future/`, and `future/hook-testing/hook-creator/SKILL.md:214` invokes an agent that no longer resolves #docs #parked

## Relations

- relates_to [[ADR-001: Skill Creator Merge Conflict Resolutions]]
- pairs_with [[ANALYSIS-001: Python to Bun Port Fidelity]]
