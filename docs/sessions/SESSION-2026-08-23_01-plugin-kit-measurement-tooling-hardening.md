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
**State** (2026-08-24 close): everything lives on a published `main` — the staging branch is merged fast-forward, pushed, and deleted along with the stale `restructure` branch. Landed this cycle: the four disclosure-collector fixes with regression tests; the Skill-tool grant; recall and over-fetch reported beside every pull rate; recall-aware verdicts with the new `unmeasured` verdict; the doctrine and operator references rewritten on evidence with a five-way label legend; the locked table-of-contents standard specified, rolled out across 25 files, and enforced by a warn-tier presence-and-position rule; three informational genre detectors that cannot touch the verdict; the body-structure genre catalog for authors; and the habit flags (`--model`, `--permission-mode`) removed from measure-disclosure in favour of hardcoded sonnet plus acceptEdits and a purpose-named `--tier-study`. ANALYSIS-003/004/005 carry the fault classes, the reference research (18 findings), and the genre taxonomy — 005 corrected itself twice, both dated. Suite 1,612 passing. Open improvement candidates: instance-aware worker default, fail-fast on a broken grant, eval-child cross-session isolation, the counted-runs stamp on results, and the two creator skills using exclusively the refuted in-step pointer form.
**Companion record**: the build that consumes these standards is tracked separately in the `ask-user-question` Brain project's 2026-08-23 session ledger. That project records work done to the new plugin; this note records work done to plugin-kit. Named in prose only, because Brain wikilinks cannot resolve across projects.

## Tasks

Canonical task registry for this session. T-NN is the stable session-note ID. Agent and Effort are left unfilled where they were not stated rather than guessed.

### Active (in_progress)

_Empty. All five hardening patches landed and were verified on `main` (confirmed against the tree 2026-08-24); the 2026-08-24 event stream below records the work that followed._

| T-ID | Group | Subject | Agent | Files | Effort | Created |
|:--|:--|:--|:--|:--|:--|:--|

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
<summary>7 archived tasks</summary>

| T-ID | Status | Group | Subject | Agent | Files | Effort | Created | Resolved |
|:--|:--|:--|:--|:--|:--|:--|:--|:--|
| T-03 | completed | Tooling hardening | Grader isolation wrapper | — | four helper call sites | — | Event 04 | landed pre-resume, verified 2026-08-24 |
| T-04 | completed | Tooling hardening | Install-state guard + warning holes | — | `measure-disclosure.ts`, `optimize-disclosure.ts` | — | Event 05 | landed pre-resume, verified 2026-08-24 |
| T-05 | completed | Tooling hardening | Schemas for eval and scenario sets | — | `shared/schemas/` | — | Event 06 | landed pre-resume, verified 2026-08-24 |
| T-06 | completed | Tooling hardening | Scope `reclaimPort` to own processes | — | `shared/report/` | — | Event 07 | landed pre-resume, verified 2026-08-24 |
| T-07 | completed | Record integrity | `/morning` erratum | — | `evals/MEASUREMENT-CAVEATS.md` | — | Event 08 | landed pre-resume, verified 2026-08-24 |
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

## Event — 2026-08-24: the 5,000-token claim is sourced, and the framing corrected

The load-bearing number behind the whole disclosure operation is verified rather than invented. Anthropic's Claude Code skills documentation, "Skill content lifecycle", states verbatim that auto-compaction re-attaches "the most recent invocation of each skill after the summary, keeping the first 5,000 tokens of each", and that "Re-attached skills share a combined budget of 25,000 tokens", filled newest-first so "older skills can be dropped entirely after compaction". Independently verified against the live page rather than taken from the research agent's report; the quote sits at the page's line 503. This closes the continuation document's open question "Where the 25,000-token figure comes from."

Two corrections fall out. The architecture document's "silently loses its tail" framing understated a two-part mechanism — per-skill truncation at 5,000 AND whole-skill dropping under the shared budget — and is now corrected in place with the source attached. And the gate's two thresholds acquire their real meaning: warn at 5,000 is the compaction-survival boundary the docs define; the band between warn and fail passes the gate but loses its tail on every compaction until the skill is re-invoked, which the docs name as the recovery. The measured ask-user-question skill sits at 5,795 body tokens — inside that band — so its trailing sections, including four of its six reference pointers, are exactly what a compacted session stops seeing. That fact belongs in the guidance rewrite's rationale for what stays in a body's first 5,000 tokens.

## Event — 2026-08-24: LOCKED — recall-aware verdict semantics, and the rewrite dispatched

Owner chose, verbatim: "Adopt the table (Recommended)". The locked semantics for `decideFileVerdict`: a file some scenario declares gets `signpost` below 0.5 recall (needed and missed — repair reachability, never delete) and `keep` at or above it whatever the raw rate; `inline` stays advisory, requires healthy recall, and carries the body-headroom and compaction-boundary notes; `prune` narrows to the one evidenced case — corpus carries ground truth, no scenario declares the file, and nobody reads it; a set with no ground truth at all can no longer produce `prune` — its zero-pulls-with-pointer case becomes a new `unmeasured` verdict naming the ambiguity and the ablation that resolves it. The proposer prompt follows: repair candidates for signpost, deletion candidates only for prune. The consistency objection recorded in the code comment is answered structurally: destructive verdicts now exist only where evidence does, so annotated and unannotated sets diverge in honesty rather than in action.

Execution: the verdict implementation resumes with the engineer agent that built the reporting substrate and knows every surface; the doctrine and operator references rewrite in parallel under a separate dispatch, both grounded in the reference-disclosure analysis note's findings and the sourced compaction mechanism. First recall sweep of record supplied the motivating example — a file verdicted keep on 15% raw pulls at 0 of 2 recall.

## Event — 2026-08-24: owner ruling — the objective is recall toward 100%, with three remedy levers

Owner statement of the disclosure objective, refining the earlier reachability ruling: progressively-loaded reference content should load as close to 100% of the time it is supposed to. Recall toward 1.0 on the should-reach set is the target the tooling optimizes toward, under the standing body-budget constraint. When recall falls short, the remedy set is three levers, and the operator guidance must name all three: repair or reposition the pointer; recompose the references themselves — merge, split, adjust — when the content boundary does not match how need presents; and evaluate the scenarios — a scenario that never triggers loading raises the question of whether it is the right scenario, so the corpus is itself an object of evaluation and scenario rewrite is a legitimate remedy, with ablation re-establishing a rewritten scenario's ground truth. Relayed to the in-flight reference rewrite; the verdict implementation is unaffected.

## Event — 2026-08-24: two improvement candidates and one considered-rejection recovered from the predecessor conversation

The predecessor conversation is now read in full, and it carried three items that reached no note and no queue.

**Improvement candidate — fail-fast on a broken grant.** Offered during the load-failure investigation and never decided: the `Skill` tool's result arrives within the first few seconds of a run, so a sweep whose grant is broken could abort in ~10 seconds instead of discovering after a full sweep that it measured nothing. Zero routine speed gain — post-grant, no run would trigger it — but it converts an expensive silent failure into a cheap loud one, the same argument as the counted-runs collapse. Insurance, not speed.

**Considered and rejected, with reason — the `dontAsk` pairing.** The SDK documentation's stricter recommended form for headless agents is `--allowedTools <list> --permission-mode dontAsk`, where anything unlisted is denied outright instead of relying silently on the absence of a permission callback. Deliberately NOT adopted for the disclosure harness: its scenarios write files, so `dontAsk` would deny every tool not explicitly enumerated, and building that enumeration is its own change. Recorded so the rejection is legible and the option is findable if the harness's tool surface is ever pinned down.

**Also recovered**: the settings-file-versus-flag difference for the Skill grant is documented workspace-trust behaviour (project `permissions.allow` is trust-gated and `-p` never shows the trust dialog) — not a bug, not to be filed upstream.

## Event — 2026-08-24: the three-layer rewrite lands, `3e67d05` and `3f4d85e`

The deliverable the disclosure research was for is complete, landed as two commits on a combined tree verified at 1567 pass / 0 fail, tsc clean.

**Code (`3e67d05`)**: `decideFileVerdict` keys on recall where ground truth exists — signpost below 0.5 recall overriding any raw rate, prune narrowed to the evidenced case, the new `unmeasured` verdict replacing the unsafe zero-pulls prune on unannotated sets, and the proposer fed recall with repair candidates for signpost and deletion candidates only for prune. Regression tests proven per rule in an isolated worktree; the unsafe deletion cannot return without breaking tests at every layer that would act on it.

**References (`3f4d85e`)**: progressive-disclosure.md and disclosure-optimization.md rewritten on evidence. Struck as rules: delete-at-zero, and the invented pointer form. Written: the recall-first reading order with the worked example, the new verdict table with the partial-annotation caveat and the annotatedScenarios-against-scenario_count check, the three remedy levers each tied to its selecting observable, the sourced compaction boundary, depth-not-count, the placement refutation stated as a result, author-for-the-weaker-tier, and a five-way evidence legend — published, published-unquantified, house rule, measured here, unmeasured — applied to every surviving rule. One label-precision catch during landing: the 5,000-token body gate now carries the house-rule label with its derivation, keeping the published label only on the 500-line half that earned it.

The doctrine, the operator guidance, and the code now agree about what a verdict means and what evidence it requires. Remaining from the queue: outcomes measurement (runs on sonnet per the recovered coverage ruling), the upstream comment, the mainline merge and push.

## Event — 2026-08-24: ANALYSIS-005 lands, and two new write-path defect instances with it

The structural-genres survey is durable at `0584df2` — fourteen genres of skill-body and reference content, every count by grep across four corpora, each genre carrying a deterministic detection signature a lint rule could be written from, and an honest effect column: presence countable for all fourteen, effect measured for exactly two, one of them this repository's own placement refutation. The counted headlines: anti-rationalization tables are a single-vendor house genre (22 of 24 against 0 of 20, absent under alternate wording too); Anthropic publishes the table-of-contents rule and complies nowhere its bundles are large (48 of claude-api's 66 references over 100 lines, zero ToCs); and this repository complies 0 of 15 with 13 over the line — an actionable gap now that the compaction mechanism makes the rule mechanical. The house pointer form is stated as unvalidated, measured at 33-75% recall despite full conformance.

Two write-path defect instances caught by mandated read-back during authoring, both silent: `write_note` emitted a duplicate frontmatter block, prepending its own minimal block and leaving status and tags in the non-authoritative second one — the known duplicate-frontmatter forbidden pattern, now traced to the write path itself rather than to authoring error. And a detection-signature regex containing a doubled open bracket was parsed as a phantom wikilink relation, surfacing only as an unresolved count of one; notes documenting regexes must dodge that sequence, and the unresolved-relations count is the only detector.

Follow-up work items this creates: tables of contents for the 13 over-length references here and the measured skill's layout reference; then the skill-creator guidance update encoding the taxonomy; then lint signatures wired toward outcome measurement.

## Event — 2026-08-24: merged to main, pushed, branch retired — the standing risk is closed

Owner ruling executed: the work does not live on a branch. `restructure-shared-layer` fast-forwarded into `main` (161 files, +13,213 / −2,309 — the shared-layer restructure, the four collector fixes, the Skill grant, the recall layer, the recall-aware verdicts, both rewritten references, and analyses 002 through 005), `main` pushed to origin at `6a4cecd`, and the staging branch deleted locally and on the remote. Every commit this session and its predecessors produced now exists on the published mainline. The exposure that opened at the branch's first publication — work existing on one machine, then on one unmerged branch — is fully closed.

## Event — 2026-08-24: an eval worker escalated its fixture out of the sandbox — a new isolation finding

During the first designed measure-outcomes run, a spawned eval worker sent a cross-session message to the orchestrating session, urgently advising against "dropping the deprecated export" — which is not a real export but the fictional dilemma inside the timeout-with-partial-selection scenario prompt. The worker's judgement was, within its fiction, exactly what the scenario tests: refuse to treat a timed-out partial selection as approval for an irreversible act, and escalate. But the escalation crossed the sandbox boundary into a real session.

The finding: spawned eval children can reach the host machine's agent-communication layer and message other live sessions. The grader-isolation work fenced the skill inventory and MCP config; it does not fence cross-session messaging. Consequences, in order: an operator who acts on such a message treats fixture content as real work (the message arrived styled exactly like a teammate report); a reply from the operator would inject content into a measured run and contaminate it — the correct response is silence toward the worker; and scenario prompts containing urgent-sounding dilemmas are precisely the ones that will escape this way. Improvement candidate: the run wrapper should sever or namespace the cross-session channel for spawned children, the same way the isolation flags fence settings. Until then, the caveat travels with any outcomes readout: mid-run messages from sessions named like run workers are fixture leakage, not work.

No reply was sent to the worker. Whether the escalating run belongs to the treatment or control arm gets checked from the run logs after completion, not by poking the live run.

## Event — 2026-08-24: LOCKED — the table-of-contents standard form

Owner chose a combination of the two leading options, which resolves to one form since they differed only by anchors: a literal `## Table of Contents` H2, then a flat bulleted list of GitHub-style anchor links naming every H2 section in document order — no nesting, no tables, H2 entries only — placed after the H1 and its orientation prose. Rationale carried with the decision: the heading-plus-bullets shell is the deterministic lint signature Genre 14 needs, the form is byte-recognizable against the only shipped standard in any surveyed corpus, the anchors serve rendered browsing, and the link text still hands a raw-text reader the plain section names, so the partial-read mechanism the rule exists for loses nothing. Whole-specimen files remain exempt per the recorded exemption. The 23 prose-form maps applied earlier today convert to this standard before landing; the measured skill's six references receive the same form after the outcomes run completes, where the intervention has a recall baseline to move against.

## Event — 2026-08-24: the table-of-contents standard lands end to end, `e585fc8` and `2e9e61f`

The owner's standard is now specified, rolled out, and enforced. `e585fc8` adds the Genre 14 validator rule — presence and position at warn tier, whole-specimen exemption, fence-aware, the refuted count-cap parked as a comment. `2e9e61f` writes the locked form into the doctrine as a house rule and applies it across 25 over-threshold files including the parked hook-creator pair, with the authoring checklist gaining the matching pre-flight item. The skill-creator body deliberately carries no fourth copy: it sits at 4,999 of 5,000 tokens and already routes authors to the doctrine at placement time, so the spec lives in one place with mechanical checks at the gate.

The validation story is the part worth keeping: the rule's ten flags matched the human rollout's edit list, its single silence matched the single human exemption, and its position check agreed with all ten human placements — neither side tuned against the other, twice over. Zero findings now across all five creator skills and the measured external skill. The engineer also walked back its own fence-guard claim after measuring it ("defensive, not currently load-bearing") and verified its warning text by rendering rather than by grepping source, where concatenated literals had made the grep a false negative — both incidents belong to the day's citing-rule lineage.

Suite 1,582 pass / 0 fail on the combined tree; main pushed. Remaining from the day's queue: the skill-creator guidance encoding of the genre taxonomy, the remaining three cheap lint rules, the #77363 upstream comment, and the eventual plugin-kit uninstall.

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
- required_by [[ANALYSIS-006: Weak-Model Routing for Progressive Disclosure]]