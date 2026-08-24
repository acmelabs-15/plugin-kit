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

This harness does not usually fail by erroring. It fails by returning a number that looks healthy and is wrong, and the number then travels into a committed record where it reads as evidence. Six such fault classes had already been paid for before 2026-08-23; that day's work found several more.

The note exists because the individual fixes are recorded in commits and session ledgers, but the *classes* were only ever described in conversation. A future operator inheriting this harness needs the classes, not the patches — the patches close specific instances, and the classes tell you what to distrust next.

## Executive Summary

The faults divide into five groups. Install state is the largest and the most dangerous, because triggering and disclosure sweeps require *opposite* install states, so a single configuration cannot be correct for both and no single guard can cover them. A second group silently downgrades a run: rate limits and timeouts are both recorded as legitimate model non-triggers, so throttling and slowness both push measured trigger rates *down* rather than raising an error. A third is a reader defect that truncated block-scalar descriptions, costing this repository's own flagship skill 40.3% of its description — including the exact clauses its measured improvement is credited to. Both halves of that one are now fixed, and what outlived the reader fix was a trap in the artifact rather than in the harness; what outlives the artifact fix is that its safety is conditional on no description containing a quote or a backslash. A fourth is an irreducible environment ceiling that no flag closes. The fifth is a single sentinel-value defect worth naming separately because its shape is different from the others: a validity test too weak to exclude the sentinel it was handed.

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

## Recommendations

1. Treat install state as per-operation, never per-repository (Findings 1, 2). A guard that satisfies a triggering sweep is the wrong guard for a disclosure sweep, and vice versa.
2. Read a guard's scope before trusting its verdict (Finding 3). "ok" from a check that covers previous names only is not "ok".
3. Assume any downgraded run is a silently downgraded run (Finding 4). Because both rate limits and timeouts push results down, a low number needs provenance before it is treated as a measurement.
4. Where prose documents a uniqueness constraint, enforce it at parse time rather than relying on a downstream `Set` (Finding 5).
5. Scope every comparability claim to a single machine unless the environment aliases have been captured (Finding 7). No flag closes that ceiling.
6. When a validity test guards a destructive call, test for the sentinel explicitly rather than for well-formedness (Finding 9). `Number.isInteger` admits `0`.
7. Assert the data property that a conditionally safe fix depends on (Finding 10). The single-line description form holds only while no description contains a `"` or a `\`, so that condition belongs in a test rather than in a reader's memory.

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

## Relations

- caused_by [[SESSION-2026-08-23_01: Plugin Kit Measurement Tooling Hardening]]
- pairs_with [[ANALYSIS-001: Python to Bun Port Fidelity]]
