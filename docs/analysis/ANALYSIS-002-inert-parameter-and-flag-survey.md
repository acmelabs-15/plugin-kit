---
title: 'ANALYSIS-002: Inert Parameter and Flag Survey'
type: analysis
status: DRAFT
permalink: analysis/analysis-002-inert-parameter-and-flag-survey
tags:
- code-quality
- survey
- cli-flags
- typescript
---

# ANALYSIS-002: Inert Parameter and Flag Survey

A deliberate sweep of `shared/` for one defect class: a parameter or flag that is
**declared, defaulted, threaded through call sites, and never reaches the thing it was
supposed to affect**. Three instances surfaced by accident on 2026-08-23, two of them
while looking at something else, which is the argument for surveying rather than waiting
to stumble over the fourth.

**Verdict: the class is rarer than those three anecdotes suggested.** Across all of
`shared/` there is exactly one live in-class instance, and it was already known. Two
adjacent findings outrank it. Neither `noUnusedParameters` nor `noUnusedLocals` can catch
the class, for a structural reason worth understanding before anyone treats them as a guard.

## Scope and Method

Read-only sweep of every `.ts` file under `shared/`, excluding `node_modules`. Five shapes
were searched: a params field never read in its own body; a CLI flag declared but never
parsed; a flag threaded through intermediates and dropped at the final consumer; an
options-bag field accepted by a type and never read; and a default that can never apply.

Scanners were written for each shape and then **validated against a known instance before
their output was trusted**. The params-field scanner, run against the pre-fix blob of
`shared/operations/measure-outcomes.ts`, correctly flags `graderModel` as never read —
so it detects the class when the class is present. Run against the current tree it yields
nine hits, of which eight were disproved by hand. That 1-in-9 signal rate is the single
most important fact about automating this: every hit needs a human.

The eight false positives fall into three groups, all worth knowing for anyone repeating
the sweep. Zod issue payloads (`params: { severity: "error" }`) are value literals that
merely happen to be named `params`. A bodiless function type alias declares fields that
implementations elsewhere read. And a multi-line return annotation of the form `}): {`
truncates a naive body region, making genuinely-read fields look unread.

## Findings, Ranked by Whether a Caller Could Believe It Works

Ranked deliberately by that question rather than by severity: a parameter nobody passes is
dead code, while a flag documented in `--help` that silently does nothing actively misleads.

### 1. Two flag readers with divergent empty-string semantics (adjacent to the class)

`flagString` in `shared/operations/measure-triggering.ts:1327` treats an empty string as
**absent**, returning `undefined` for `""`. Its counterpart `stringFlag` — defined twice as
a private local, in `shared/report/generate-report.ts:684` and
`shared/operations/aggregate-results.ts:730`, with identical bodies — treats an empty string
as **present**, returning `""`.

So `--skill-name ""` means "not supplied" to one reader and "supplied as empty" to the other.
Nothing depends on the difference today, which is exactly what makes it a trap rather than a
bug: the next person to move a flag between these files gets a silent behaviour change with
no failing test. This also inverts the analysis of the four dead-default sites below, and was
the step that nearly produced three false findings in this survey.

**Misleads by construction. Highest-value item in this report.**

### 2. Ten dead imports in one module (adjacent to the class)

`shared/operations/optimize-disclosure.ts` imports ten symbols it never uses:
`mapWithConcurrency`, `computeFileStats`, `createRunCollector`, `inventoryBundledFiles`,
`parseGrading`, `scoreRuns`, `trainGate`, `layoutDescription`, `installSkillForTrigger`, plus
one whole import declaration unused at line 37. Refactor debris. Mildly misleading: the
import list overstates the module's dependencies, so anyone reading it to judge coupling gets
a wrong answer. Six further dead locals sit in the `disclosure-measure` test and two in the
`optimize-disclosure` test.

### 3. `projectRoot` on `gradeRun` (in-class, the one live instance)

`shared/operations/disclosure-measure.ts:339` declares `readonly projectRoot: string` in
`gradeRun`'s params. It is supplied at line 257 as `projectRoot: root` and **never referenced
in the body**. The only other occurrence in that file, at line 202, is a different call to
`createRunCollector`, which does read it.

**Dead code, not misleading.** `gradeRun` is module-private with a single caller, and the
artifacts the field would have resolved are read by the parent at line 345 and embedded into
the prompt instead. Nobody outside the module can be deceived by it. Left in place
deliberately: removing it widens a diff whose reviewability is its safety property.

### 4. Four `??` fallbacks that can never fire (in-class, benign)

`parseArgs` pre-populates every flag carrying a spec `default` (`shared/cli.ts:89-91`), so a
`?? FALLBACK` at the read site cannot fire for such a flag. Four sites do this:
`--grader-model` in `shared/operations/measure-outcomes.ts:1146`, `--skill-name` in
`shared/report/generate-report.ts:720`, and `--skill-name` plus `--skill-path` in
`shared/operations/aggregate-results.ts:841-842`.

**In every case the fallback equals the spec default it cannot override**, so no caller is
misled and no behaviour differs. Belt-and-braces rather than defect. Recommend leaving all
four alone. Note this verdict depends on which reader each site uses, per finding 1.

### 5. `--grader-model`, fixed (in-class, was the only misleading instance)

`--grader-model` was parsed, defaulted to `DEFAULT_GRADER_MODEL`, threaded through two call
sites and accepted by `createClaudeGrader` — then never appended to argv. The flag was
accepted, documented in `--help`, and silently inert, so an operator asking for a cheap fast
grader got whatever default applied. **Fixed**: the model is now appended at
`shared/operations/measure-outcomes.ts:1007`, guarded so an empty value cannot leave a bare
`--model` with nothing after it. Measured before and after against a recording stub: the
argv gained `--model <graderModel>`.

### 6. `metadata` on `write_note`, external (in-class, out of repo)

The knowledge-graph server's `write_note` accepts a `metadata` parameter, reports success,
and silently drops it. Recorded here because it is the same class and was hit by three
agents on 2026-08-23; it is not a defect in this repository and cannot be fixed from it. The
workaround is a following `edit_note` find_replace, which is what produced this note's own
`status` field.

## Shapes With Zero Findings

Reported explicitly, because a negative result from a validated scanner is evidence rather
than absence of effort.

- **Flag declared but never parsed: zero.** Every flag in every spec under `shared/` is
  referenced. An initial pass reported twelve; all twelve are read via `requireFlag` or
  direct index access such as `flags["no-open"]`, neither of which the first reader pattern
  matched.
- **Flag dropped at the final consumer: zero remaining.** This is the `--grader-model` shape
  and the hardest to see, since every intermediate hop looks correct. The one instance is fixed.
- **Options-bag or interface field never read: zero.** Every field of every named interface
  and type alias under `shared/` was checked against the whole corpus, since these are
  cross-file contracts and a file-scoped check would be meaningless.

## Would a Compiler Option Catch This Class?

**No. Neither option catches it, and the reason is structural rather than incidental.**

| Option | Pre-existing sites flagged | Catches the class? |
|---|---|---|
| `noUnusedParameters` | **1** — `shared/report/generate-dashboard.ts:296`, an unused `state` | No |
| `noUnusedLocals` | **18** — 10 in `optimize-disclosure.ts`, 6 and 2 in two test files | No |

Both options track **bindings**. This class lives one level below a binding, in a property of
a params object. In `createClaudeGrader(params: { graderModel, instructionsPath })` the
binding `params` *is* used, because `params.instructionsPath` is read, so
`noUnusedParameters` is satisfied while `graderModel` rots unnoticed. Destructuring would
expose it — `const { a, b } = params` with `b` unused is caught by `noUnusedLocals` — but
this codebase overwhelmingly uses `params.x` property access, so that path never triggers.
**There is no `tsc` option for "declared property of a params type, never read in the body."**

**Recommendation, which is not the one this survey set out to reach.** Adopt both options for
hygiene: `noUnusedParameters` costs a single site, and `noUnusedLocals` buys the deletion of
eighteen genuine dead imports at zero false positives. But adopt them knowing they do **not**
cover this class, and do not let their presence imply otherwise. The only mechanical guard is
a scanner of the kind validated here, and at a 1-in-9 signal rate it needs a reviewer on every
hit. Given the sweep found one dead field and zero remaining live defects, maintaining that
scanner is not worth it. The honest conclusion is that this was three coincidences rather than
a pattern, and the cheapest durable defence is that the misleading instance is fixed and the
shape is now written down.

## Observations

- [outcome] Exactly one live in-class instance exists across all of `shared/`, and it was already known before the sweep #survey #code-quality
- [fact] The params-field scanner produced nine hits at current HEAD, of which eight were disproved by hand — a 1-in-9 signal rate #tooling #precision
- [technique] A heuristic scanner was validated against a known-positive blob before its output was trusted, which is what made the eight false positives safe to discard #method #validation
- [problem] `flagString` treats an empty string as absent while `stringFlag` treats it as present, so the same flag value means two different things depending on which reader a call site uses #cli-flags #trap
- [insight] The divergent readers invert the verdict on four dead-default sites, so the analysis cannot be done without first knowing which reader each site uses #cli-flags #analysis
- [fact] `parseArgs` pre-populates every flag declaring a spec default, making a `??` fallback at the read site unreachable for those flags #cli-flags
- [outcome] All four unreachable `??` fallbacks carry the same value as the default they cannot override, so none is a defect #cli-flags #benign
- [constraint] Neither `noUnusedParameters` nor `noUnusedLocals` can catch this class, because both track bindings while the class lives in a property of a params object #typescript #tooling
- [fact] `noUnusedParameters` flags one pre-existing site and `noUnusedLocals` flags eighteen, all of the latter being genuine dead imports #typescript #metrics
- [decision] Both compiler options are recommended for hygiene but explicitly not as a guard against this class, so their presence cannot imply coverage #typescript #recommendation
- [decision] Maintaining the scanner is not recommended: one dead field and zero live defects do not justify a detector needing a reviewer on every hit #tooling #cost
- [solution] `--grader-model` now reaches argv, verified before and after against a recording stub rather than by reading the diff #cli-flags #verification
- [risk] Dead imports overstate a module's dependencies, so anyone reading an import list to judge coupling gets a wrong answer #code-quality #coupling
- [insight] Ranking by whether a caller could believe the parameter works separates dead code from actively misleading surface, and reverses the order severity alone would give #method #triage
- [problem] This note was invisible to every permalink lookup until repaired on 2026-08-23, because its own frontmatter carried `permalink: plugin-kit/analysis/analysis-003-inert-parameter-and-flag-survey` — a permalink left stale from when the note was numbered 003, carrying a legacy project prefix that current writes do not produce. It resolved by title and appeared in a directory listing throughout, which is what made the fault hard to see. A rename updates the title and the filename but leaves the frontmatter `permalink:` line untouched, and the index derives from that line, so a forced single-file resync re-read the stale value rather than repairing it — the index was faithful to the file and the file was wrong. Repaired by editing the one line; no content change, no rewrite and no resync were needed #index-corruption #stale-permalink

## Relations

- pairs_with [[ANALYSIS-001: Python to Bun Port Fidelity]]
- pairs_with [[SESSION-2026-08-23_01: Plugin Kit Measurement Tooling Hardening]]