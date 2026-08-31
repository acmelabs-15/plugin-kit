---
title: "SESSION-2026-08-31_01: Loop parity and harness fixes"
type: session
status: IN_PROGRESS
permalink: sessions/session-2026-08-31-01-loop-parity-and-harness-fixes
tags:
- session
- plugin-kit
- measurement-tooling
- disclosure
- description
---

# SESSION-2026-08-31_01: Loop parity and harness fixes

**Scope**: Changes made TO plugin-kit on 2026-08-31 while the `sessions` plugin (acmelabs-15/sessions) was measured with its loops: what the first fixture-backed sweep exposed, and the asymmetry between the disclosure and description loops it led to.
**State** (PRs #2–#5): `--fixture` copies a repository into every throwaway root (#2); `evals/` out of the disclosure inventory, `--allowed-tools` for scenario children, `MEASUREMENT_MODEL` + `DEFAULT_NUM_WORKERS` in `shared/util/measurement.ts` with `--tier-study` replacing `--model` on the triggering/description loops, the worker-cliff warning, the grader's bounded tool trace (#3); the install-conflict warning in both loops and train-first gating in the description loop (#4); `--resume-from` and `--tier-study` on `optimize-disclosure.ts` with the candidate workspace under `--results-dir`, plus the staleness sweep (#5). The rule the owner stated and that now holds in code: **callers do not pass `--model` or `--num-workers` to any loop; the tools decide**.
**Companion record**: what remains — and everything else still open around the `sessions` plugin — is `docs/plan/PLAN-001-session-plan-relationship-and-re-evaluation.md` in acmelabs-15/sessions, Part 5 for this repo: the glossary gaps to raise in `CONTEXT.md` (tier study, measurement model, tool trace, and a word for the repository `--fixture` copies — "fixture" already names the invalid validator fixtures under `shared/`, so the flag's name collides).

## Tasks

### Done

- T-01 `--fixture` (PR #2)
- T-02 inventory excludes `evals/`; `--allowed-tools`; measurement constants; `--tier-study`; tool trace (PR #3)
- T-03 install-conflict warning, train-first gate (PR #4)
- T-04 `--resume-from`, `--tier-study` and the workspace under `--results-dir` on the disclosure optimizer; the staleness sweep (PR #5)
- T-08 second staleness sweep after #5: `--resume-from` documented for both loops (`running-detached.md`, both loop references); two comments still describing a `--model` flag on the run model and the proposal step corrected; the description reference no longer tells the reader to set `--num-workers`

### Open

- T-05 glossary gaps in `CONTEXT.md` (see companion record)
- T-06 rename `--fixture` if the owner accepts **scenario repo** as the term
- T-07 `--resume-from` reads only `results.json`: it validates shape and the layout directory but never compares the dead run's `envelope.json` (model, eval-set hash, target) with the current inputs, so a resume under different inputs mixes figures. A guard belongs in `readResumeState`'s caller, where the envelope is at hand

### 2026-08-31 · T-09 — the resume port verified end to end, and the suite made honest

Peter asked whether `--resume-from` on the disclosure loop was completely done. Read on `main`, then two
smokes: a bogus file, and a real resume with `--max-iterations` already reached so no measurement is
spent. The resume works (baseline not re-measured, both scored layouts carried, `results.json`,
`report.html`, `envelope.json`, `best-layout` written, exit 0). Found and fixed on the way:

- an unreadable or non-JSON `--resume-from` path died with a stack; it is now one `Error:` line, exit 2,
  like the removed-flag guard;
- `readResumeState` carried `files[]` rows unchecked, so a row missing `loadMode` crashed the report of a
  run that had already spent its budget; rows are validated with the rest of the file;
- the reference said `<dir>/results.json` and "the same `--results-dir`"; the file is at
  `<dir>/<timestamp>/results.json` and the incumbent is found by absolute path — corrected;
- **the suite was not green on `main`**: five tests failed (two still asserting a `--model` flag on the
  optimizer, one trace head with a trailing space, `install-conflict.ts` in `shared/util` importing
  `../envelope.ts` against the layering rule, and the purity checker reading a test helper named `bash`
  as a shell-out). The earlier session note claimed 1,756 green; it was 1,754 with 5 failing. Fixed at the
  cause each time: trace heads are trimmed, `install-conflict.ts` moved to `shared/` beside the module it
  depends on, the helper renamed, the two tests rewritten for `--tier-study`. 1,759 pass.
