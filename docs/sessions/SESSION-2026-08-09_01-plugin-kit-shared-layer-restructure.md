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
- **Position**: step 1 of 9 COMPLETE; step 2 of 9 next

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

## Observations

- [problem] Brain MCP exited with error -32000 because the basic-memory config held project `plugin-kit` as a bare string where a ProjectEntry object is required #brain-mcp #config
- [solution] Rewriting the project entry in object form restored the server; the prior file is preserved as a dated `.bak` alongside it #brain-mcp #recovery
- [risk] The Brain `create_project` handler is suspected of reporting success while writing a shape its own loader rejects, so other projects may carry the same latent break #brain-mcp #write-path
- [fact] Repo verification confirmed the handover's absent-surface claims: no `bin/`, `shared/cli.ts`, `shared/env.ts`, `shared/capabilities.ts`, nor the six planned `shared/` subdirectories #verification #restructure
- [fact] `shared/scripts` holds 13 entry points, `lib/` 15, `__tests__/` 26; `envelope.ts` is 919 lines; all ten domain-free modules sit in `shared/scripts/lib/` #verification #inventory
- [problem] Test suite measured 1,276 pass / 1 fail over 27 files against a claimed 1,131 / 0 / 26, so the handover's baseline is stale #divergence #tests
- [insight] The single failure is tautology-shaped: the test concatenates a `root` carrying the macOS `TMPDIR` trailing slash and asserts a doubled separator the implementation normalises away #tests #defect-class
- [decision] The failing assertion is left unrepaired because it lives in the hooks rules that a later step of the restructure deletes #tests #sequencing
- [problem] `shared/eval-viewer` is 7 files (3 html, 4 ts), not the 4 the handover claimed #divergence #inventory
- [outcome] Step 1 of 9 complete at commit `7ab0fcc` on branch `restructure-shared-layer`, applying six corrections across the architecture doc and the pure-bun reference #milestone #restructure
- [insight] The replaced fixtures guard could never fail: it globbed `skills/**` and filtered for `fixture` while the fixture corpus lives under `shared/` #guard #false-negative
- [decision] `docs/architecture.md:176` keeps `zod@^4.1.0` because it records what was actually tested, and a measurement record is never edited to match a later decision #provenance #measurement
- [risk] The 25,000-token combined re-attach budget at `docs/architecture.md:434` is asserted without justification while the 5,000-token figure directly below it is fully argued #budget #unsupported-claim
- [problem] `skills/plugin-creator/references/shared-code-architecture.md` argues for a build step, contradicting the no-build-step decision #contradiction #build-step
- [requirement] Step 2 of 9 retires hooks: `shared/rules/hooks.ts`, the `registry.ts` import and target-type entry, and `agents/hook-reviewer.md` #next-step #hooks

## Relations

- relates_to [[ADR-001: Skill Creator Merge Conflict Resolutions]]
- pairs_with [[ANALYSIS-001: Python to Bun Port Fidelity]]
