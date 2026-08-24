---
title: "ANALYSIS-003: Measurement Fault Classes"
type: analysis
status: ACCEPTED
permalink: analysis/analysis-003-measurement-fault-classes
tags:
- analysis
- measurement
- fault-classes
- install-state
- isolation
---

# ANALYSIS-003: Measurement Fault Classes

> Every fault below was verified by reading source or by running a probe on 2026-08-23. Where a claim rests on documentation rather than on source or a measurement, it is labelled as such.

## Context

This harness does not usually fail by erroring. It fails by returning a number that looks healthy and is wrong, and the number then travels into a committed record where it reads as evidence. Six such fault classes had already been paid for before 2026-08-23; that day's work found several more, and 2026-08-24 added six again, all of them in the disclosure path and all found from downstream rather than from here.

The note exists because the individual fixes are recorded in commits and session ledgers, but the *classes* were only ever described in conversation. A future operator inheriting this harness needs the classes, not the patches — the patches close specific instances, and the classes tell you what to distrust next.

## Executive Summary

The faults divide into six groups. Install state is the largest and the most dangerous, because triggering and disclosure sweeps require *opposite* install states, so a single configuration cannot be correct for both and no single guard can cover them. A second group silently downgrades a run: rate limits and timeouts are both recorded as legitimate model non-triggers, so throttling and slowness both push measured trigger rates *down* rather than raising an error. A third is a reader defect that truncated block-scalar descriptions, costing this repository's own flagship skill 40.3% of its description — including the exact clauses its measured improvement is credited to. Both halves of that one are now fixed, and what outlived the reader fix was a trap in the artifact rather than in the harness; what outlives the artifact fix is that its safety is conditional on no description containing a quote or a backslash. A fourth is an irreducible environment ceiling that no flag closes. The fifth is a single sentinel-value defect worth naming separately because its shape is different from the others: a validity test too weak to exclude the sentinel it was handed.

The sixth group is the disclosure collector, added 2026-08-24 and the largest single haul in the note. Three defects sat between the model's reads and the numbers: a path comparison that left symlinks intact and classified every in-skill read as outside, a load recorded from the tool request rather than its result, and a pass rate and context cost taken over runs the layout never reached — which put a perverse incentive inside the optimizer, since an unloaded run is cheap. All three returned confident answers rather than errors, and the first reproduced Finding 1's exact signature from an unrelated cause, which is why it survived a session of being looked at.

The count is itself the finding. A harness that can return a confidently wrong number does so in many independent ways, so each new operation needs its own guard rather than inheriting a neighbour's.

## Approach

Each fault was established by reading the implementation rather than the documentation, and by probing where reading was ambiguous. Two of the findings below exist specifically because a documented claim and the observed behaviour disagreed, and in both cases the documentation was accurate about the mechanism while the inference drawn from it was wrong.

## Findings

### Finding 1: Triggering and disclosure need opposite install states

A triggering sweep needs the artifact reachable, because the thing being measured is whether the router selects it. A disclosure sweep needs the artifact *absent*, because content served through the skill system never produces a `Read` tool call, and a pull is detected as a `Read`.

The consequence is that a disclosure run against an installed copy floors every pull rate at zero and prints `prune` on every file. Nothing in that output looks anomalous — `prune` is a legitimate verdict, and a table of them reads as a decisive result. The same install state is healthy for one operation and fatal for the other, which is why an install-state guard cannot be written once and shared.

### Finding 2: A live instance, caught on a guard's first run

The retired fork's 21KB SKILL.md plus its eight reference files were installed under the *current* name, while the new repository shipped only a `.gitkeep`. That copy would have answered every probe, and every disclosure number taken in that window would have described the retired artifact.

It was caught by an install-state guard on its first run, which is the reason to build such guards before trusting a corpus rather than after. The copy was removed only after an archived copy was verified byte-identical by md5, so the removal did not destroy the only instance of the artifact.

### Finding 3: A guard that verified the wrong thing and reported ok

At that same moment, `make doctor` reported "ok no older copy installed". The report was not a lie about its own check — its check covered *previous* names only, and the collision was under the current name.

This is the most quietly dangerous shape in the note, because a guard reporting ok is stronger evidence than no guard at all, and here it was worth less than nothing. A guard's scope has to be read before its verdict is trusted.

### Finding 4: Rate limits and timeouts are recorded as clean non-triggers

Two independent paths downgrade a run rather than failing it.

A rate-limited run is recorded as a clean decline. A decline is a legitimate model outcome, so throttling silently reports *lower* trigger rates rather than erroring, and a throttled sweep looks like a skill that triggers less often.

Timeouts are likewise scored as non-triggers. One committed corpus carries seven such per file on its two lowest-scoring skills — and those two are the ones anchoring its headline improvement figure, so the improvement is computed against a floor that timeouts helped create.

Both faults share a direction, which is what makes them hard to spot: they never inflate a result, so a suspiciously good number will not surface them.

### Finding 5: Duplicate scenario ids collapse the held-out split

The held-out membership test is a `Set` over scenario ids. A duplicate id shrinks the set, and every number computed from the smaller split remains plausible.

The general form is worth stating beyond this instance: **when a uniqueness constraint is documented in prose but enforced only by a `Set` downstream, a violation does not error — it silently shrinks the set.** And a corrupted holdout is worse than a missing one, because the selection still looks validated. A missing holdout is an obvious gap; a shrunken one is a passed check.

### Finding 6: Block-scalar descriptions are silently truncated

The hand-rolled frontmatter reader joins continuation lines with a single space and stops at a blank line, so a block-scalar description is truncated at its first paragraph break.

This repository's own flagship skill lost **40.3%** of its description that way: 949 characters shipped against 567 read. The lost portion was the entire negatives block — the clauses that the skill's own measured improvement is credited to. So the measurement that justified the description was taken against a string missing the reason it was better.

The reader-side split was fixed in `037d59f`, which bounds the damage in time: measurements taken after that commit were not affected, and the 2026-08-08 corpus was taken before it and was. Note specifically that measurement is *not* the wrong-reader side today — `measure-triggering.ts:463-473` uses a real `Bun.YAML.parse` and falls back to the hand-rolled reader only for `targetType === "command"`, a documented dead branch, and `propose-description.ts:408` never reads the description at all.

**What persisted after the reader fix was a trap in the artifact rather than in the harness.** The two readers disagreed about what the shipped file said, so any third-party or future consumer using the hand-rolled reader silently received a 40%-shorter description. That was closed at `2a7c0d5` by re-serialising all five creator skills to a single double-quoted line, recovering 380, 246, 207 and 203 characters; the fifth carried no blank line and had never been mis-measured.

The residual risk is that the fix is conditionally rather than unconditionally safe — see Finding 10.

### Finding 7: An irreducible environment ceiling

The `ANTHROPIC_DEFAULT_*_MODEL` aliases and the Bedrock variables reach every spawned child in every configuration, because the environment merge drops only `CLAUDECODE`. They cannot simply be dropped — doing so breaks auth.

The consequence is a hard limit on cross-machine comparability: two envelopes both recording `model: opus` are not necessarily comparable, because the alias that resolved that name may differ between machines. No flag closes this. It is a ceiling to state in the record rather than a defect to fix, and any cross-machine comparison should carry it as a caveat.

### Finding 8: `--setting-sources project` does more than its name promises

It excludes user-level **skills**, not merely user-level plugins. Measured: 11 skills visible under isolation against 118 without it.

That is a useful property and a trap in equal measure — useful because it is the only thing that actually isolates the inventory, a trap because the flag name suggests a narrower effect and anyone reasoning from the name will under-estimate what the isolated run excludes.

### Finding 9: A sentinel value passing a validity test too weak to exclude it

`lsof` returning `0` reached `process.kill(0, "SIGTERM")`. In POSIX semantics, signalling pid `0` targets the caller's entire process group.

Nothing rejected it because the validity test was `Number.isInteger(0)`, which is true. The defect is not a missing check — a check was present and passed. This class is distinct from the others in the note: the others produce a wrong measurement, while this one produces an unintended side effect on processes that were never part of the run.

### Finding 10: A defence can be conditionally safe and read as unconditional

The single-line double-quoted serialisation that closed Finding 6 is safe only because none of the five descriptions currently contains a `"` or a `\`.

The hand-rolled reader strips *repeated* quote characters and unescapes nothing. So a description that quotes a phrase — an entirely reasonable thing for a description to do — would round-trip differently through the two parsers and reintroduce the divergence. It would do so silently, and with no blank line present to make the problem visible the way the original defect at least eventually was.

This is the shape worth carrying beyond this instance: the fix looks like a format change that removes a class of bug, and is actually a format change that removes it *for the current inputs*. A defence whose safety depends on a property of the data, rather than on a property of the code, needs that property asserted somewhere or it will lapse without a signal.

### Finding 11: Two unrelated causes, one identical signature

Finding 1 establishes that a disclosure run against an installed copy floors every pull rate at zero and prints `prune` on every file. On 2026-08-24 that exact table was produced with the install state correct, by a cause with nothing to do with it.

`createRunCollector` resolved the skill directory and every read path with `resolve`, which is string arithmetic and leaves symlinks intact. The skill is installed beneath `os.tmpdir()`, which on macOS returns `/var/folders/...` while `/var` is a symlink to `/private/var`. The model reports its reads through the canonical `/private/var/...`, so the two never matched and every genuine in-skill read was classified as outside the skill.

Measured on one skill, same scenarios, same bytes: 54 runs recorded 159 `Read` calls and 0 classified in-skill before the fix, 154 and 106 after. Six files went from 0 pulls and `prune` to rates between 11% and 59% and `keep` on all six.

The lesson is not the symlink. It is that **the zero-pull `prune` table is not diagnostic of install state**, and treating a known signature as identifying its known cause cost a full session: the install state was checked, found correct, and the table was believed. Fixed at `4710db8` with a regression test that fails on the parent commit.

### Finding 12: A load recorded on the request rather than on the result

`skillLoaded` was set the moment a `Skill` tool-use appeared in the stream, and a `Read` of SKILL.md was treated the same way. Neither looked at what came back, so a run whose every load attempt was refused recorded identically to one that loaded cleanly.

The interface already said otherwise: `ScenarioRun.skillLoaded` is documented as "whether the body reached context at all — a run where it did not measures nothing". The implementation recorded intent.

Blast radius was wider than the field. `skillLoaded` gates `countedRuns` in `computeFileStats`, so failed runs sat in the denominator of every pull rate, and it gates `runsWithoutSkill`, which drives the harness warning and the report's health banner. Neither could fire.

Replayed over six real transcripts: unfixed reported 6 of 6 loaded and 0 pulls; fixed reported 4 of 6 and 6 pulls. On a full sweep it surfaced **18 of 54 runs that never received the skill** — a third of the sample, invisible until then. Fixed at `02248f3`.

A near-miss worth carrying: `is_error` is ABSENT on success rather than `false`. Twelve successful results across those transcripts carried no flag, so a test for `=== false` would have called every success a failure — the same shape as the defect being fixed.

### Finding 13: The loop scored the layout on runs the layout never reached

The largest of the group, and it broke the objective and the guardrail in opposite directions at once.

`computeFileStats` counted pulls over runs where the body loaded. `scoreRuns` counted the pass rate and the context cost over every error-free run, loaded or not. Two halves of one measurement disagreeing about what a valid run is.

- **The objective.** An unloaded run is cheap: 226k tokens against 350k for a loaded one, measured. Counting it meant a candidate that made loading fail more often reported a LOWER context cost and cleared `meanContextTokens` more easily. The loop was rewarded for breaking the skill.
- **The guardrail.** Pass rate became a mix of two populations, 0.949 loaded against 0.667 unloaded, so it tracked the load-failure rate rather than the layout. Across three sweeps of identical bytes it moved 6.9 points, against a `DEFAULT_PASS_RATE_TOLERANCE` of 0.05 documented as absorbing about one assertion of sampling noise. **The environmental noise was larger than the entire tolerance.**

This was deliberate rather than an oversight — `RunTally.unloaded` was documented "In the pass rate, out of every pull rate" — and what it protected is real: a layout that stops the skill loading has broken the work. That protection is now `loadRate`, guarded by name ahead of the cost check, rather than folded into two figures that mean something else. Fixed at `e0be400`.

The general form is worth more than the instance: **when one operation reports several figures, they must agree on what a valid unit is.** Here two filters differing by one clause put a perverse incentive inside an optimizer and nothing errored.

### Finding 14: A report written, and never advertised

`serveReport` serves a run's real report when `status.detail.reportPath` is set, and falls back to the progress page when it is not. `measure-disclosure` published `resultsDir` alone and wrote `report.html` thirty lines further down without ever saying where, so every dashboard link for a measured sweep landed on a status table while the report sat on disk beside it. Both optimizer loops set the field and neither had the problem.

The fallback carries a comment calling this "the dead end the user actually hit", written about the description report and left open for this one. Fixed at `e70b881`.

### Finding 15: Two costs of the temp-root workaround

Before the Finding 11 fix was authorised, the symptom was worked around by pointing the run's temp root at a path not reached through a symlink. It worked, and it cost two things that were not obvious.

`statusDir()` is `${tmpdir()}/skill-creator-progress`, so a run under a moved temp root registers where the dashboard never reads. That sweep completed, wrote its results, and was simply invisible to the dashboard — recoverable only by copying the status file across by hand.

The second cost is the general one: a workaround that moves an environment variable moves everything else keyed to it, and the blast radius is whatever else reads that variable. Here it was one dashboard registry; it is not knowable in advance without grepping for the variable.

### Finding 16: A third of runs never receive the skill, and it is not this harness

Not a plugin-kit defect, and recorded here because it bounds every disclosure number this harness produces.

With Finding 12 fixed, a full sweep reported 18 of 54 runs where the body never reached context. All 18 requested it and were refused. Reproduced directly: the `Skill` tool returns `is_error: true` with content `Execute skill: <alias>` and no body, and the model then says so in its own final answer — "the skill wouldn't load ... I composed the call from my own judgment instead".

It is not the permission mode: `acceptEdits` loads the skill fine in an isolated probe. It is not path scoping: `--add-dir` on the skill directory changes nothing. The failure is stochastic rather than per-scenario — 13 scenarios loaded on both attempts, 10 on one of two, 4 on neither.

Checked for a false negative rather than assumed, because a third is a lot: the two populations separate on every independent axis. Loaded runs scored 0.949 with a mean of 2.94 in-skill reads and 350k context; unloaded runs scored 0.667 with **zero** in-skill reads across all 18, 7 `Read` calls between them, and 226k context. Not one unloaded run pulled a single in-skill file, which is the contradiction a misclassification would have produced.

The consequence for this harness is a ceiling rather than a bug: a disclosure sweep measures roughly two thirds of the runs it pays for, and which two thirds varies. That belongs in the record beside Finding 7's environment ceiling.

## Recommendations

1. Treat install state as per-operation, never per-repository (Findings 1, 2). A guard that satisfies a triggering sweep is the wrong guard for a disclosure sweep, and vice versa.
2. Read a guard's scope before trusting its verdict (Finding 3). "ok" from a check that covers previous names only is not "ok".
3. Assume any downgraded run is a silently downgraded run (Finding 4). Because both rate limits and timeouts push results down, a low number needs provenance before it is treated as a measurement.
4. Where prose documents a uniqueness constraint, enforce it at parse time rather than relying on a downstream `Set` (Finding 5).
5. Scope every comparability claim to a single machine unless the environment aliases have been captured (Finding 7). No flag closes that ceiling.
6. When a validity test guards a destructive call, test for the sentinel explicitly rather than for well-formedness (Finding 9). `Number.isInteger` admits `0`.
7. Assert the data property that a conditionally safe fix depends on (Finding 10). The single-line description form holds only while no description contains a `"` or a `\`, so that condition belongs in a test rather than in a reader's memory.

8. Never treat a known signature as identifying its known cause (Finding 11). The zero-pull `prune` table has at least two unrelated causes, and checking the install state does not rule out the other one.
9. Record an outcome from the tool result, never from the request (Finding 12). A tool-use event is an intention; only the result says what happened. Test `is_error !== true`, because success omits the flag rather than setting it false.
10. Make every figure one operation reports agree on what a valid unit is (Finding 13). Two filters differing by one clause put a perverse incentive inside an optimizer, and nothing errored.
11. When a distortion is being removed from a figure, ask what counting it was protecting before removing it (Finding 13). Here it was the only thing watching for a layout that stops the skill loading, and it needed replacing rather than deleting.
12. Grep for an environment variable before working around anything by moving it (Finding 15). The blast radius is everything else keyed to it, and here it silently detached a completed run from the dashboard.

## Observations

### Install state and collisions

- [constraint] Triggering and disclosure sweeps require opposite install states — a triggering sweep needs the artifact reachable, a disclosure sweep needs it absent, because content served through the skill system never produces a `Read` #install-state #opposite-requirements
- [problem] A disclosure run against an installed copy floors every pull rate at zero and prints `prune` on every file, so one install state is healthy for one operation and fatal for the other #install-state #void-measurement
- [problem] A live collision was caught on an install guard's first run: the retired fork's 21KB SKILL.md plus eight reference files were installed under the current name while the new repo shipped only a `.gitkeep`, so that copy would have answered every probe #install-collision #live-instance
- [solution] The colliding copy was removed only after an archived copy was verified byte-identical by md5, so the removal did not destroy the only instance #install-collision #verification
- [problem] `make doctor` reported "ok no older copy installed" at that same moment because its check covered previous names only while the collision was under the current name — a guard that verified the wrong thing and reported ok #guards #false-assurance

### Silently downgraded runs

- [problem] A rate-limited run is recorded as a clean decline, so throttling silently reports lower trigger rates rather than erroring #rate-limit #silent-downgrade
- [problem] Timeouts are scored as non-triggers; one committed corpus carries seven per file on its two lowest-scoring skills, which are the two anchoring its headline improvement #timeouts #silent-downgrade
- [insight] Both downgrade paths only ever push results down, so a suspiciously good number will never surface them and a low number is the one that needs provenance #silent-downgrade #direction
- [problem] Duplicate scenario ids collapse the held-out split because membership is a `Set` over ids, so a repeat shrinks it while every number computed from it stays plausible #holdout #silent-shrink
- [insight] The general form: a uniqueness constraint documented in prose but enforced only by a downstream `Set` does not error on violation, it silently shrinks the set — and a corrupted holdout is worse than a missing one because the selection still looks validated #uniqueness #general-form

### Reader and description truncation

- [problem] The hand-rolled frontmatter reader joins continuation lines with a single space and ends collection at a blank line, silently truncating any block-scalar description at its first paragraph break #parser #truncation
- [fact] This repository's own flagship skill lost 40.3% of its description that way — 949 characters shipped against 567 read — and the lost portion was the entire negatives block its measured improvement is credited to #parser #self-inflicted
- [outcome] The reader-side split was fixed in `037d59f`, which bounds the damage in time: measurements taken after that commit were unaffected, and the 2026-08-08 corpus was taken before it and was affected #parser #fix-boundary
- [fact] Measurement is not the wrong-reader side today — `measure-triggering.ts:463-473` uses a real `Bun.YAML.parse` and falls back to the hand-rolled reader only for `targetType === "command"`, a documented dead branch, while `propose-description.ts:408` never reads the description at all #parser #reader-routing
- [problem] What persisted after the reader fix was a trap in the artifact rather than in the harness: the two readers disagreed about what the shipped file said, so any third-party or future consumer using the hand-rolled reader silently received a 40%-shorter description #parser #artifact-trap
- [outcome] The artifact trap was closed at `2a7c0d5` by re-serialising all five creator skills to a single double-quoted line, recovering 380, 246, 207 and 203 characters; the fifth carried no blank line and had never been mis-measured #parser #artifact-fix
- [constraint] A defence can be conditionally safe and read as unconditional: the single-line double-quoted form is safe only because none of the five descriptions contains a `"` or a `\`, since the hand-rolled reader strips repeated quote characters and unescapes nothing — a description quoting a phrase would round-trip differently through the two parsers and reintroduce the divergence silently, with no blank line to make it visible #conditional-safety #general-form

### Environment and isolation

- [constraint] The `ANTHROPIC_DEFAULT_*_MODEL` aliases and the Bedrock variables reach every spawned child in every configuration because the environment merge drops only `CLAUDECODE`, and dropping them breaks auth — so two envelopes both recording `model: opus` are not necessarily comparable across machines and no flag closes it #env #irreducible-ceiling
- [fact] `--setting-sources project` excludes user-level skills and not just plugins, which is more than its name promises: 11 skills visible isolated against 118 unisolated #isolation #naming-trap

### Validity tests, and the count as a finding

- [problem] A sentinel passed a validity test too weak to exclude it: `lsof` returning `0` reached `process.kill(0, "SIGTERM")`, which signals the caller's entire process group, and `Number.isInteger(0)` is true so nothing rejected it #sentinel #validity-test
- [insight] The number of independent fault classes is itself the finding — a harness that can return a confidently wrong number does so in many unrelated ways, so each new operation needs its own guard rather than inheriting a neighbour's #fault-classes #meta

### The disclosure collector, 2026-08-24

- [problem] `createRunCollector` compared paths resolved with `resolve`, which leaves symlinks intact, so a skill installed under `/var/folders/...` matched none of the reads the model reported through the canonical `/private/var/...` #symlink #void-measurement
- [fact] Same 54 runs, same bytes: 159 `Read` calls and 0 classified in-skill before the fix, 154 and 106 after, and all six bundled files moved from 0 pulls and `prune` to 11-59% and `keep` #symlink #measured
- [insight] The zero-pull `prune` table has at least two unrelated causes, so it is not diagnostic of install state — the state was checked, found correct, and the table was believed anyway #signature #misdiagnosis
- [problem] `skillLoaded` was set on seeing a `Skill` tool-use rather than its result, so a run whose every load attempt was refused recorded identically to one that loaded cleanly, and the `runsWithoutSkill` health signal could never fire #load-signal #silent-downgrade
- [fact] `is_error` is absent on a successful tool result rather than set to `false`: twelve successes across six transcripts carried no flag, so a test for `=== false` would have called every one a failure #tool-result #trap
- [problem] `computeFileStats` counted pulls over loaded runs while `scoreRuns` counted the pass rate and context cost over every error-free run, so two halves of one measurement disagreed about what a valid unit is #consistency #guardrail
- [risk] An unloaded run is cheap — 226k tokens against 350k — so counting it in the objective meant a candidate that broke loading reported a lower context cost and cleared the check more easily: the loop was rewarded for breaking the skill #perverse-incentive #objective
- [fact] Pass rate was a mix of 0.949 loaded against 0.667 unloaded, moving 6.9 points across three sweeps of identical bytes, against a tolerance of 0.05 documented as absorbing about one assertion of noise #guardrail #noise
- [constraint] What counting unloaded runs in the pass rate protected was real — a layout that stops the skill loading — so it was replaced by a named `loadRate` guard rather than deleted #chestertons-fence #guardrail
- [problem] `measure-disclosure` published `resultsDir` but never `reportPath`, so every dashboard link for a measured sweep landed on a status page while the report sat on disk beside it #dashboard #dead-end
- [problem] `statusDir()` is keyed to `tmpdir()`, so the temp-root workaround registered a completed sweep where the dashboard never reads and made it invisible without erroring #workaround #blast-radius
- [problem] With the load signal fixed, 18 of 54 runs never received the skill: the `Skill` tool returns `is_error` with no body, unaffected by permission mode or `--add-dir`, so a disclosure sweep measures about two thirds of the runs it pays for #environment #ceiling
- [solution] That figure was checked for a false negative rather than assumed: unloaded runs showed zero in-skill reads across all 18, against a mean of 2.94 for loaded ones, which is the contradiction a misclassification would have produced #verification #populations
- [insight] Every one of these returned a confident answer rather than an error — a deletion proposal, a full sample, a status page, a cheaper layout — which is the note's original thesis arriving four more times #fault-classes #meta

## Relations

- caused_by [[SESSION-2026-08-23_01: Plugin Kit Measurement Tooling Hardening]]
- pairs_with [[ANALYSIS-001: Python to Bun Port Fidelity]]
- extended_by [[ANALYSIS-004: What Makes a Bundled Reference Get Read]]
- required_by [[ANALYSIS-005: Structural Genres of Skill Content]]
