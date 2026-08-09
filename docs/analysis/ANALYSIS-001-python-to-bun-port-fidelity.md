---
title: "ANALYSIS-001: Python to Bun Port Fidelity"
type: analysis
status: ACCEPTED
permalink: analysis/analysis-001-python-to-bun-port-fidelity
tags:
- analysis
- port-fidelity
- python-to-bun
- determinism
---

# ANALYSIS-001: Python to Bun Port Fidelity

## Context

The merged plugin decided to port the bespoke evaluation harness rather than adopt the first-party `claude plugin eval` command, for the availability reasons recorded in [[ADR-001: Skill Creator Merge Conflict Resolutions]] D10. That made the port itself the deliverable, and raised the question the port had to answer: how closely does the Bun implementation have to match the Python original, and where it claims to match, what proves it.

This note records the invocation mapping from the Python scripts to their Bun replacements, and the fidelity evidence gathered while porting. The evidence is worth keeping because several findings were counter-intuitive: two working premises turned out to be wrong when tested, one fidelity target that the brief assumed unreachable was reached, and one plausible-looking implementation produced output that looked correct and was not.

## Executive Summary

Every Python entry point has a one-to-one Bun replacement, invoked as `bun scripts/<kebab-name>.ts` in place of `python -m scripts.<snake_name>`. Three numerical or binary behaviours needed deliberate reproduction rather than idiomatic reimplementation: the MT19937 random generator, CPython's compensated summation in `sum`, and the zip writer's compression output. All three are verified — MT19937 against committed golden vectors, and the zip writer as byte-identical to zlib at compression level 9 across eight diverse inputs, which exceeded the brief's assumption that byte-identity was unreachable. Two premises the port started from were corrected by measurement: `fnmatch` is not case-insensitive on macOS, and Bun's spawn `timeout` is not a hard timeout. Two parsers are kept deliberately separate rather than unified, because the quirks of the hand-rolled one are load-bearing. Two defects in the original were fixed rather than ported.

## Approach

Fidelity was established per behaviour rather than per file. For each behaviour where the Bun and Python implementations could disagree observably, the port either produced a golden vector from the Python original and asserted against it, or ran both implementations over a spread of inputs and compared outputs directly. Where a premise about the runtime was load-bearing — case sensitivity, timeout semantics — it was tested rather than assumed, which is how both of the corrected premises surfaced.

## Findings

### Finding 1: Invocation mapping

Each Python module entry point maps to a kebab-case TypeScript file run under Bun. The module-execution form (`python -m scripts.name`) is replaced by direct file invocation.

| Python | Bun |
|---|---|
| `python -m scripts.aggregate_benchmark` | `bun scripts/aggregate-results.ts` |
| `python -m scripts.run_loop` | `bun scripts/optimize-description.ts` |
| `python -m scripts.package_skill` | `bun scripts/package-skill.ts` |
| `python -m scripts.quick_validate` | `bun scripts/validate-skill.ts` |
| `python -m scripts.run_eval` | `bun scripts/measure-triggering.ts` |
| `python -m scripts.improve_description` | `bun scripts/propose-description.ts` |
| `python -m scripts.generate_report` | `bun scripts/generate-report.ts` |
| `eval-viewer/generate_review.py` | `bun eval-viewer/generate-review.ts` |

### Finding 2: MT19937 reproduces CPython bit-exactly

The Mersenne Twister port reproduces CPython bit-for-bit across seeding, `getrandbits`, rejection sampling, shuffle, and the train/test split — for the split, both membership and order. This is verified against golden vectors committed to the repository rather than against a reimplementation of the same logic.

The vectors exist because of a specific near-miss. An earlier port that seeded through the wrong initialisation routine failed every vector while emitting output that was perfectly random-looking: well-distributed, no visible structure, indistinguishable from correct by inspection. Statistical plausibility is not evidence of bit-exactness, and only a committed reference sequence catches the difference. Any future change to the generator has to clear the vectors.

### Finding 3: CPython compensated summation in the builtin sum

CPython 3.12 and later use Neumaier compensated summation inside the builtin `sum`. Reproducing it is not an optimisation — omitting it changes results that callers check.

Two observed consequences: over a constant dataset, standard deviation reads `3.7e-18` instead of exactly zero, so a test asserting zero variance fails on a dataset that has none; and over mixed-magnitude datasets, results drift by up to roughly 2 percent, which is large enough to move a reported metric.

### Finding 4: Zip writer is byte-identical to zlib at level 9

The zip writer produces byte-identical output to zlib at compression level 9, verified across eight diverse inputs. Levels 1 and 6 diverge, so the identity claim is specific to level 9 and does not generalise across the level range.

This exceeded the brief, which assumed byte-identity was unreachable and specified a weaker equivalence target. Zip64 is implemented rather than guarded against, because the Python original enables it automatically; emitting an error or refusing large archives would have been a capability regression relative to the thing being ported.

### Finding 5: Two premises corrected by measurement

Both of these were assumptions the port carried until they were tested.

`fnmatch` is not case-insensitive on macOS. The assumption that it was would have made pattern matching silently accept inputs the original rejects.

Bun's spawn `timeout` is not a hard timeout. A child process that traps SIGTERM runs to completion regardless of the configured value. Enforcing a real deadline requires an explicit abort followed by SIGKILL; relying on `timeout` alone leaves a trapping child unbounded.

### Finding 6: Two parsers kept deliberately separate

The port keeps a real YAML parse for validation and a hand-rolled line parser alongside it, rather than unifying on the correct one.

The separation is deliberate because the hand-rolled parser's quirks are load-bearing — downstream behaviour depends on them. It matches on raw lines by prefix, strips quotes repeatedly rather than once, and loses newlines in block scalars even for literal style where a conformant parser preserves them. Replacing it with the real parser would change observable behaviour, so the two coexist with distinct roles: correctness for validation, bug-compatibility everywhere the original's output shape is depended upon.

### Finding 7: Defects fixed rather than ported

Two defects in the original were corrected rather than reproduced, on the grounds that both are unambiguously broken behaviour with no downstream dependency on the breakage.

Eval output containing a closing script tag terminated the viewer's embedded-data block early. The visible symptom was a blank page, but the mechanism is a script-element breakout: eval output is arbitrary model-generated content, it is interpolated into an inline script, and a payload closing that element can open a new one. Treating it only as a rendering defect understates it — the fix escapes the breakout characters as escape sequences that decode identically, so the data contract is unchanged while the injection path closes.

The packager's usage strings referenced a directory the script no longer occupies, so the printed instructions did not work as written.

## Recommendations

1. Treat the MT19937 golden vectors as a gate on any change to the generator (Finding 2). The failure mode they catch is invisible to inspection and to statistical checks.
2. Keep the compensated-summation implementation tied to a test that asserts exact zero variance over a constant dataset (Finding 3), since that is the cheapest detector for a regression to naive summation.
3. Scope the byte-identity claim to compression level 9 wherever it is documented (Finding 4). It is false at levels 1 and 6, and an unqualified claim will mislead.
4. Wherever a deadline matters, pair the spawn `timeout` with an explicit abort and SIGKILL (Finding 5). The configured value alone does not bound a SIGTERM-trapping child.
5. Leave the two parsers separate and document the hand-rolled parser's quirks as intended behaviour (Finding 6), so a future cleanup does not unify them and change output shape.
6. Re-evaluate the whole port once the first-party eval command is documented and generally available, per the provisional status recorded in [[ADR-001: Skill Creator Merge Conflict Resolutions]] D10.

## Observations

- [fact] Every Python entry point maps one-to-one onto a kebab-case TypeScript file invoked under Bun, replacing module execution with direct file invocation #port #invocation
- [outcome] MT19937 reproduces CPython bit-exactly across seeding, getrandbits, rejection sampling, shuffle, and train/test split membership and order, verified against committed golden vectors #determinism #mt19937
- [insight] A port seeding through the wrong initialisation routine failed every golden vector while emitting perfectly random-looking output, which is why the vectors exist #determinism #testing
- [fact] CPython 3.12 and later use Neumaier compensated summation in the builtin sum; without it a constant dataset's standard deviation reads 3.7e-18 instead of exactly zero #floating-point #summation
- [fact] Omitting compensated summation drifts mixed-magnitude datasets by up to roughly 2 percent #floating-point #summation
- [outcome] The zip writer is byte-identical to zlib at compression level 9 across 8 diverse inputs, exceeding a brief that assumed byte-identity was unreachable #packaging #byte-identity
- [constraint] Byte-identity holds at compression level 9 only; levels 1 and 6 diverge #packaging #byte-identity
- [decision] Zip64 is implemented rather than guarded, because the Python original enables it automatically and omitting it would be a capability regression #packaging #zip64
- [problem] The premise that fnmatch is case-insensitive on macOS is false, corrected empirically #premise-correction #fnmatch
- [problem] Bun's spawn timeout is not a hard timeout — a SIGTERM-trapping child runs to completion, so an explicit abort plus SIGKILL is required #premise-correction #process-control
- [decision] Two parsers are kept deliberately separate: a real YAML parse for validation, and a hand-rolled line parser whose quirks are load-bearing #parsing #bug-compatibility
- [constraint] The hand-rolled parser matches raw lines by prefix, strips quotes repeatedly, and loses newlines in block scalars even for literal style #parsing #bug-compatibility
- [solution] A closing script tag in eval output broke out of the viewer's inline script element; the blank page was the symptom, the injection path was the defect, and the escape fix closes it without altering the decoded data #security #viewer
- [solution] The packager's usage strings referenced a directory the script no longer occupies; fixed rather than ported #defect-fix #packaging

## Relations

- caused_by [[ADR-001: Skill Creator Merge Conflict Resolutions]]
- pairs_with [[ADR-001: Skill Creator Merge Conflict Resolutions]]
