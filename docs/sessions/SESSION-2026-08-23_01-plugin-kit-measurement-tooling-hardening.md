---
title: "SESSION-2026-08-23_01: Plugin Kit Measurement Tooling Hardening"
type: session
status: IN_PROGRESS
permalink: sessions/session-2026-08-23-01-plugin-kit-measurement-tooling-hardening
tags:
- session
- plugin-kit
- measurement-tooling
- control-bytes
- isolation
---

# SESSION-2026-08-23_01: Plugin Kit Measurement Tooling Hardening

**Scope**: Changes made TO plugin-kit on 2026-08-23 — control-byte escaping so `grep` can see three files, first publication of the `restructure-shared-layer` branch, and a set of in-flight patches hardening the measurement tooling against silent-void measurements and unisolated grader runs.
**State**: One commit landed plus a branch publication. Five patches in flight and uncommitted; recorded here as in-progress, not as done. Expect appends.
**Companion record**: the build that consumes these standards is tracked separately in the `ask-user-question` Brain project's 2026-08-23 session ledger. That project records work done to the new plugin; this note records work done to plugin-kit. Named in prose only, because Brain wikilinks cannot resolve across projects.

## Tasks

Canonical task registry for this session. T-NN is the stable session-note ID. Agent and Effort are left unfilled where they were not stated rather than guessed.

### Active (in_progress)

| T-ID | Group | Subject | Agent | Files | Effort | Created |
|:--|:--|:--|:--|:--|:--|:--|
| T-03 | Tooling hardening | Grader isolation: one wrapper applying `--setting-sources project`, `--strict-mcp-config` and a per-call empty temp cwd | — | four helper call sites | — | Event 04 |
| T-04 | Tooling hardening | Install-state guard for `measure-disclosure.ts`, plus the envelope-gated warning holes in `optimize-disclosure` | — | `shared/operations/measure-disclosure.ts`, `shared/operations/optimize-disclosure.ts` | — | Event 05 |
| T-05 | Tooling hardening | Schemas for eval sets and scenario sets | — | new schema modules | — | Event 06 |
| T-06 | Tooling hardening | Scope `reclaimPort` to this toolchain's own processes | — | `shared/report/generate-review.ts:670-696` | — | Event 07 |
| T-07 | Record integrity | Dated erratum on the `/morning` false-fire misattribution | — | `evals/MEASUREMENT-CAVEATS.md` | — | Event 08 |

### Backlog (pending)

#### Unblocked — ready to pick up

_Empty._

| T-ID | Group | Subject | Agent | Files | Effort | Created |
|:--|:--|:--|:--|:--|:--|:--|

#### Blocked

_Empty._

| T-ID | Group | Subject | Agent | Files | Effort | Blocked by | Created |
|:--|:--|:--|:--|:--|:--|:--|:--|

### Archive (completed + deleted)

<details>
<summary>2 archived tasks</summary>

| T-ID | Status | Group | Subject | Agent | Files | Effort | Created | Resolved |
|:--|:--|:--|:--|:--|:--|:--|:--|:--|
| T-01 | completed | Grep visibility | Escape raw control bytes in three files | — | three files incl. `shared/operations/synthesize-scenarios.ts` | — | Event 02 | Event 02 |
| T-02 | completed | Git hygiene | Publish `restructure-shared-layer` to `origin` | — | — | — | Event 03 | Event 03 |

</details>

### Pending User Decisions (surface on resume)

- None currently.

## Event 01 — Session started

- Timestamp: 2026-08-23 21:15
- Project: plugin-kit
- Branch: `restructure-shared-layer`
- Context: the project's own graph had no record of any work after 2026-08-09, so this ledger opens to close that gap
- Goal: record the control-byte fix, the branch publication, and the in-flight measurement-tooling patches

## Event 02 — Control bytes escaped so grep can see three files, commit `7ac48de`

- Timestamp: 2026-08-23 21:15
- Commit: `7ac48de` — escaped raw control bytes in three files
- Root cause: a raw NUL at `shared/operations/synthesize-scenarios.ts:679` made `file` classify the file as binary, so plain `grep` skipped all 1899 lines and issued no warning
- Consequence already paid: an agent concluded the file had no CLI entrypoint when `callClaude` sits at `:1428`
- Narrower truth: only the NUL file was genuinely grep-invisible — the 0x1b and 0x1c-0x1f files were misclassified by `file` but still matched by grep, so they were latent hazards rather than active ones
- Verified: suite unchanged at 1399 pass / 0 fail

## Event 03 — restructure-shared-layer published to origin for the first time

- Timestamp: 2026-08-23 21:15
- Changed: `restructure-shared-layer` remote tracking → published
- Exposure closed: 25 commits existed only on one machine with no remote branch
- Context: both pre-existing remote branches pointed at a 2026-08-08 commit, so nothing from this restructure had ever been pushed

## Event 04 — IN FLIGHT: grader isolation patch

- Timestamp: 2026-08-23 21:15
- Problem: four helper call sites spawn `claude` with no isolation
- Evidence: a probe showed one call actively routing into a plugin skill and issuing a `Read` unprompted
- Approach: add `--setting-sources project` plus `--strict-mcp-config` plus a per-call empty temp cwd, via one wrapper so the flags and the cwd cannot be applied separately
- Status: uncommitted

## Event 05 — IN FLIGHT: measure-disclosure install-state guard

- Timestamp: 2026-08-23 21:15
- Problem: `measure-disclosure.ts` builds no envelope and never called `detectInstallState`, so it reported clean `prune` tables against an installed copy with nothing saying the measurement was void
- Second hole found during the same work: all three of `optimize-disclosure`'s warning sites sit inside an envelope gate, so it is equally silent when run without `--envelope` or `--results-dir`
- Status: uncommitted

## Event 06 — IN FLIGHT: schemas for eval sets and scenario sets

- Timestamp: 2026-08-23 21:15
- Problem: no schemas exist for either shape
- Sharpest edge: `expectations` silently defaults to `[]` when its key is misspelled, so a scenario set can parse clean and measure against nothing
- Status: uncommitted

## Event 07 — IN FLIGHT: scope reclaimPort to this toolchain

- Timestamp: 2026-08-23 21:15
- Problem: `reclaimPort` at `shared/report/generate-review.ts:670-696` sends SIGTERM to every PID holding port 3117, whether or not it belongs to this toolchain
- Status: uncommitted

## Event 08 — IN FLIGHT: dated erratum on the /morning false-fire misattribution

- Timestamp: 2026-08-23 21:15
- Problem: `MEASUREMENTS.md:94-96` attributes a false fire to a `/morning` neighbour collision
- Probe: 11 skills visible under `--setting-sources project` against 118 without it, with no user-scope skills surviving isolation, so `/morning` could not have loaded
- Disposition: appended as a dated erratum to `evals/MEASUREMENT-CAVEATS.md` beside the record rather than edited into it
- No number moves: the cause was wrong, not the count
- Status: uncommitted

## Event 09 — Survey findings recorded beyond the fixes

- Timestamp: 2026-08-23 21:15
- Finding: `--bare` does not isolate the skill inventory, so `--grader-bare` was never sufficient for this purpose on any machine
- Finding: `DESCRIPTION_MAX = 1024` is duplicated across five live sites with only a comment naming the winner
- Finding: `installConflict` blocks nothing — callers only record its return
- Finding: `docs/architecture.md` and `README.md`'s layout block name roughly twenty paths that do not exist
- Finding: `measure-disclosure.ts:291` writes `results.json` with no timestamped subdirectory, unlike both optimizers

## Event 10 — Measurement fault classes landed as a durable analysis note

- Timestamp: 2026-08-23 21:47
- Created: the measurement-fault-class analysis, recording nine verified fault classes across install state, silently downgraded runs, reader truncation, the environment ceiling, and one sentinel-value defect
- Reason: the individual fixes live in commits and in this ledger, but the fault classes existed only in conversation prose and would not have survived the session
- Numbering: first written as ANALYSIS-002, renumbered to ANALYSIS-003 after a concurrent agent claimed 002 for the inert-parameter-and-flag survey; both inbound edges were repointed and the 002 copy deleted
- Relations: reciprocal edges formed with this ledger and with the port-fidelity analysis

## Observations

### Landed today

- [problem] A raw NUL at `shared/operations/synthesize-scenarios.ts:679` made `file` classify the file as binary, so plain `grep` skipped all 1899 lines and warned about nothing #grep #false-negative
- [outcome] Escaping the raw control bytes in three files restored grep visibility at commit `7ac48de`, with the suite unchanged at 1399 pass / 0 fail #control-bytes #fix
- [insight] Only the NUL file was genuinely grep-invisible; the 0x1b and 0x1c-0x1f files were misclassified by `file` yet still matched by grep, so they were latent hazards rather than active ones and the fix is broader than the defect #control-bytes #precision
- [problem] The grep blind spot had already produced a real false negative: an agent concluded the file had no CLI entrypoint when `callClaude` sits at `:1428` #grep #agent-error
- [fact] `restructure-shared-layer` was pushed to `origin` for the first time, publishing 25 commits that existed only on one machine; both pre-existing remote branches pointed at a 2026-08-08 commit #git #single-copy-risk

### Isolation, and what it corrected

- [problem] Four grader helper call sites spawn `claude` with no isolation, and a probe caught one routing into a plugin skill and issuing a `Read` unprompted, so grader runs were contaminated by whatever was installed #isolation #grader
- [fact] `--bare` does not isolate the skill inventory — its own help states skills still resolve via `/skill-name`, and it skips plugin sync rather than plugin loading, so `--grader-bare` was never sufficient for this purpose on any machine #isolation #bare
- [problem] `MEASUREMENTS.md:94-96` misattributes a false fire to a `/morning` neighbour collision; a probe measured 11 skills visible under `--setting-sources project` against 118 without it, with no user-scope skills surviving isolation, so `/morning` could not have loaded. The count stands and only the cause was wrong #errata #attribution

### Install-state gaps

- [problem] `measure-disclosure.ts` builds no envelope and never called `detectInstallState`, so it reported clean `prune` tables against an installed copy with nothing marking the measurement void #install-state #void-measurement
- [problem] All three of `optimize-disclosure`'s warning sites sit inside an envelope gate, so it is equally silent when run without `--envelope` or `--results-dir` — the guard exists but is unreachable on the path most likely to need it #install-state #silent-warning
- [problem] `installConflict` returns `string | null` and callers only record it, so it blocks nothing and sequencing an install-sensitive run is operator discipline rather than an enforced gate #install-state #no-gate

### Schema and output hazards

- [risk] `expectations` silently defaults to `[]` when its key is misspelled, so a scenario set can parse clean and measure against nothing while reporting success #schemas #silent-default
- [risk] `reclaimPort` at `shared/report/generate-review.ts:670-696` sends SIGTERM to every PID holding port 3117 regardless of whether the process belongs to this toolchain #ports #collateral-damage
- [risk] `measure-disclosure.ts:291` writes `results.json` straight into `--results-dir` with no timestamped subdirectory, unlike both optimizers, so a second run silently replaces the first rather than corrupting it #results #overwrite

### Documentation and duplication drift

- [problem] `DESCRIPTION_MAX = 1024` is duplicated across five live sites with only a comment, not a mechanism, stating that `validate/validate-skill.ts` wins; all five agree today, so nothing is broken and nothing prevents them diverging #duplication #caps
- [problem] `docs/architecture.md` and `README.md`'s layout block name roughly twenty paths that do not exist, including a `bin/` shim and a dispatcher; there is no unified entry point and `shared/cli.ts` is an argv-parsing library #docs #drift

## Relations

- caused_by [[SESSION-2026-08-09_01: Plugin Kit Shared Layer Restructure]]
- pairs_with [[ANALYSIS-001: Python to Bun Port Fidelity]]
- pairs_with [[ANALYSIS-002: Inert Parameter and Flag Survey]]
- leads_to [[ANALYSIS-003: Measurement Fault Classes]]