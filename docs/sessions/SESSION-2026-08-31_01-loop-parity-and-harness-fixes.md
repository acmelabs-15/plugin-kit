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

### Open

- T-05 glossary gaps in `CONTEXT.md` (see companion record)
- T-06 rename `--fixture` if the owner accepts **scenario repo** as the term
