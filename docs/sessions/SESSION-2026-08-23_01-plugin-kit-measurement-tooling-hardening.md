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

## Event — 2026-08-24: the disclosure path repaired, and the number it produces found to be the wrong number

Work driven from the downstream `ask-user-question` project, whose session note carries the full narrative. Recorded here because every change lands in this repository. All commits on `restructure-shared-layer`, UNPUSHED and not on `main`.

**Four defects fixed, each with a regression test failing on its parent commit.**

- `4710db8` — the run collector compared paths with `resolve`, which leaves symlinks intact, so a skill under a `/var/...` temp root matched none of the reads the model reported through `/private/var/...`. Every bundled file scored 0 pulls and `prune`. Same 54 runs, same bytes: 159 Read calls and 0 classified in-skill before, 154 and 106 after.
- `02248f3` — `skillLoaded` was set on seeing a `Skill` tool-use and never read the result, so a run whose every load attempt was refused recorded identically to one that loaded cleanly. `ScenarioRun.skillLoaded` already documented the opposite, so this restored the contract. `loadedVia` and `skillRequested` were added to keep the three outcomes apart.
- `e70b881` — `measure-disclosure` wrote `report.html` and never set `detail.reportPath`, so every dashboard link for a measured sweep dead-ended on a status page. Both optimizer loops set it; only measured sweeps dead-ended.
- `e0be400` — `computeFileStats` counted pulls over loaded runs while `scoreRuns` counted the pass rate and context cost over every error-free run. Two halves of one measurement disagreeing about what a valid unit is, which put a perverse incentive inside the optimizer: an unloaded run is cheap, so a candidate that broke loading reported a LOWER context cost. `792e17c` then narrowed both to injected runs only.

**The root cause was never plugin-kit's.** The Skill tool's permission ladder falls through to `behavior: "ask"` whose message is the string `Execute skill: <name>` — a prompt label, not an error — and the binary's own SDK schema doc states that in bare `-p` an ask is terminal. Measured 0 of 4 runs loading without a grant, 4 of 4 with `--allowedTools Skill`. `34e68c7` adds the grant at the two affected spawn sites. `measure-triggering` was verified UNAFFECTED because it decides on the streamed tool_use request, before any permission check.

**Performance, all measured on a 10-core box.**

- `b91f945` — worker default derived from the machine, twice the core count, floored at 4 and capped at 24. At 54 runs: 12 workers 15.8s/run at 43-49% CPU idle, 24 workers 8.1s/run, 48 workers 43.6s/run at 0.6% idle and load 143. The curve peaks and overshooting costs about fivefold, hence the cap at the highest value measured good.
- `4cbda74` — longest-first scheduling from recorded durations, which range 51s to 376s on one corpus.
- `f8b4ff7` — the pool reported only `onSettled`, so a bar read 0/N for about 90 seconds while every worker was busy, and a parallel pool looked sequential.
- `f0e31c7` — a warning past three times the core count.
- REVERTED: decoupling grading from the run pool. Predicted 15-20%, measured MINUS 12% at 490s against 439s, because the grading limiter doubled peak concurrency into the thrashing zone. Discarded rather than kept.
- DISCARDED in seven seconds: `--bare` for scenario runs. 0 of 3 loaded; it strips the skill system along with the hooks.

**ANALYSIS-004 was authored from this work** and is the durable home for the research. Its sharpest finding bears directly on this repository's own history: a raw pull rate cannot separate a rarely-needed reference from a needed-and-missed one, so any keep-or-prune verdict already issued on one should be re-derived. The collector fixes corrected which reads were counted, never what they were divided by. ANALYSIS-003 Finding 11 records exactly such verdicts.

## Event — 2026-08-24: the destination ruling, and a candidate fault class from an interrupted sweep

Recorded from the downstream ask-user-question session on resume, because both items are this repository's rather than the plugin's.

**Owner ruling on destination.** Every change this work produces lands in the real plugin-kit codebase — `restructure-shared-layer` is a staging area, not a destination, and merging it to `main` is part of the work. Measured at ruling time: 14 commits ahead of `origin/restructure-shared-layer`, 57 commits on the branch not on `main`, and `restructure-shared-layer..main` is 0, so the merge is a fast-forward. It stays queued behind the authoring-guidance rewrite because more commits are coming.

**Candidate fault-class instance, mechanism not yet established.** A stage-1 ablation sweep pair (two concurrent `measure-disclosure` arms, 27 scenarios twice each) was interrupted, and both arms still left complete-looking `results.json` files — `install_state` populated, per-file tables, plausible pass rates. The only tell was cross-arm: `assertions_total` 262 against 259 over the identical scenario set, meaning at least three assertions were never graded. Nothing in either file marks itself partial. This is the note's thesis shape again — a confident answer instead of an error — and suggests `measure-disclosure` should either refuse to write final results while runs are ungraded or stamp the file with expected-versus-graded run counts so a consumer can tell. Not yet investigated in source; recorded so the instance is not lost. The interrupted pair is quarantined under `~/auq-results/ablation-*-interrupted` for forensics.

## Event — 2026-08-24, correction: the interrupted-sweep fault candidate is withdrawn

The candidate fault class recorded earlier today does not survive its own per-run logs, and the correction is dated here beside the record. Both arms of the supposedly interrupted pair carry full grading on all 54 runs, summing to the complete 262 assertions each; the detached processes outlived the driving session and finished cleanly. The differing headline denominators (262 against 259) are the intended behaviour of `792e17c` — `assertions_total` counts only runs the skill system delivered, and the excluded run's cause was already named in the same file's `runs_loaded_via_file` field. No fault instance occurred; the reader failed to read the field.

What survives as a genuine, smaller point: `assertions_total` does not say it is a counted-runs figure. A results file carrying both the counted and the all-runs totals — or naming the excluded assertion count — would have made this misreading impossible. Improvement candidate, not a defect.

## Event — 2026-08-24: owner ruling on worker counts, and what the default actually derives

Owner ruling, stated twice and standing: callers do not pass `--num-workers` to `measure-disclosure.ts` — the tool calculates the optimal amount on its own. Verified from source rather than from the ledger summary: `disclosure-measure.ts:92` derives `max(4, min(24, availableParallelism() * 2))` per process, 20 on a 10-core box, with no awareness of sibling instances.

Consequence and improvement candidate: the default is optimal for exactly one running instance. A multi-arm launch at defaults stacks arms times twenty children — six arms would be 120 on 10 cores, inside the measured fivefold-slowdown zone from the worker-curve data. The fix belongs here rather than in callers' flags: make the derivation instance-aware (divide the machine budget across live sweep instances, discoverable from the status directory the dashboard already globs), so the ruling and the thrashing evidence stop needing each other reconciled per launch. Until it lands, concurrent A/B arms — which are run concurrently so API drift hits both equally — are the one case the default does not cover.

## Event — 2026-08-24: recall and over-fetch land in the disclosure tooling, commit `1b3ff64`

The reporting half of the recall metric ANALYSIS-004 prescribes is implemented. Per-file recall (reads over should-have-reached, off the same counted-runs filter the pull rate uses) and over-fetch (over the empty-array negative rows) now land in results.json, the CLI lines, the HTML report and the optimizer's envelope rows, from both `measure-disclosure` and `optimize-disclosure` through the shared fold. Recall is `null` when no scenario declares the file — null and zero argue for opposite actions and are kept distinct, as are absent and empty `expects_references` at every surface. Over-fetch is null rather than 0% when a set carries no negative row, closing the flattering-clean-bill failure mode before it shipped.

Verification exceeded the brief: regression tests were proven against pre-change behaviour in an isolated git worktree, one mutation per figure — recall disabled (7 failures across every surface), absent collapsed into empty (exactly the 2 tests built for that collapse), over-fetch as 0% with no negatives (4 failures). Suite 1528 to 1555, tsc clean, independently re-run before commit. `schemas.md`'s doc-ahead-of-code line about `expects_references` is now true and names both entry points plus the one live annotated corpus.

Deliberately untouched, queued for the verdict-layer redesign: `decideFileVerdict` still prunes on raw zero, and the optimizer's proposer prompt still shows only pull rates. Feeding recall to both is one change and lands with the three-layer guidance rewrite.

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
- required_by [[ANALYSIS-004: What Makes a Bundled Reference Get Read]]
