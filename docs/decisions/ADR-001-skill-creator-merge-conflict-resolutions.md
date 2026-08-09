---
title: "ADR-001: Skill Creator Merge Conflict Resolutions"
type: decision
status: PROPOSED
date: 2026-07-28
updated: 2026-07-28
permalink: decisions/adr-001-skill-creator-merge-conflict-resolutions
tags:
- decision
- skill-authoring
- plugin-merge
- agent-skills
---

# ADR-001: Skill Creator Merge Conflict Resolutions

## Status

PROPOSED (2026-07-28)

## Context and Problem Statement

Three separate artifacts each claimed authority over how an agent skill should be written: Anthropic's `skill-creator` plugin, the `skill-development` skill bundled with `plugin-dev`, and the standalone `skill-reviewer` agent. They were merged into a single Bun plugin. Merging them surfaced eleven points where the three sources gave different, and in several cases mutually exclusive, guidance.

Scope expanded partway through. The plugin-container half of `plugin-dev` — `plugin-structure`, `plugin-settings`, the `plugin-validator` agent, and the `plugin-creator` command — was added after the initial three sources, so the merged result covers skill plugins as well as standalone skills. Surveying the whole of it exposed a gap that shaped the work: the sources proved roughly 95 percent creation-only, with essentially nothing addressing evaluate, modify, or improve. Those three verbs had to be authored rather than merged, which is why several of the resolutions below govern behaviour for which no source offered guidance to adjudicate.

The obvious merge strategy — pick whichever source felt most authoritative and defer to it — was unavailable, because the disagreements were not stylistic. Several turned on facts that could be measured: how much description text a runtime actually reads before truncating, how many real skills a validator's allow-list would reject, how many tokens a file that passes a line-count rule actually costs. Where a claim could be tested, the test was run, and the measurement decided the conflict regardless of which source had asserted what.

This ADR records each of the eleven resolutions together with the evidence that produced it. The evidence is recorded inline rather than summarised, because in most cases the evidence — not a preference — is the reason the resolution holds, and a future reader reversing one of these decisions needs to know what would have to be re-measured first.

## Decision Drivers

1. **Measurement beats assertion.** Where a conflict rested on a testable claim, the claim was tested and the result was binding. Three resolutions reversed the direction the sources implied.
2. **Portability is a real axis, not a strictness setting.** Several conflicts that looked like "strict versus lax" turned out to be "conformant to a published standard versus extended beyond it," which is a different question with a different answer.
3. **A cheap mechanical gate and a real completion criterion are different instruments.** Conflating them made the checklist look like a substitute for evidence, which it is not.
4. **Fail-open mechanisms cannot be relied on for safety.** A gate that silently does nothing on runtimes that do not implement it provides confidence rather than protection.
5. **Divergent copies of the same upstream artifact must be reconciled against the canonical one.** Where two repositories shipped different versions, the marketplace copy was treated as authoritative.

## Considered Options

### Option A: Adopt one source verbatim and discard the others

Pick the source with the strongest provenance — Anthropic's `skill-creator` — and take its guidance wholesale, treating the other two as commentary.

**Pros**:

- Fastest to execute; no adjudication needed.
- Produces an internally consistent artifact by construction.

**Cons**:

- The chosen source contradicts itself in at least one place (it preaches explanatory voice while writing all-caps imperatives elsewhere), so "internally consistent" is false.
- Discards the measurements that reversed the source's implied direction, shipping guidance known to be wrong.

### Option B: Cherry-pick each conflict by editorial preference

Resolve each of the eleven conflicts by judgement, choosing whichever guidance reads better.

**Pros**:

- Allows the merged artifact to take the best of all three sources.
- No measurement cost.

**Cons**:

- Preference cannot distinguish a description-form convention that fits a truncation budget from one that overflows it. Four of the eleven conflicts hinge on a number that judgement has no access to.
- Leaves no recorded rationale, so any future reader can reverse any resolution at equal cost.

### Option C: Resolve each conflict on measured evidence, falling back to judgement only where nothing is measurable (Recommended)

Treat each conflict as a question, ask whether it has a testable form, and where it does, run the test and let the result bind. Record the evidence alongside the resolution.

**Pros**:

- Three resolutions (frontmatter tiers, length, invocation gating) came out opposite to what the sources implied, and would have been wrong under Options A or B.
- Each resolution carries its own falsification condition, so reversing one is a matter of re-measuring rather than re-arguing.

**Cons**:

- Slower; several conflicts required building a measurement before the question could be answered.
- Produces resolutions that are only as durable as the environment they were measured against.

## Decision

Chosen option: **Option C (resolve on measured evidence)**, because four of the eleven conflicts turned on quantities no amount of editorial judgement could supply, and three of those four resolved against the direction the sources implied.

### D1: Voice — explanatory over imperative

**Decision**: The merged skill explains why a rule exists rather than asserting it with MUST, ALWAYS, or NEVER.

**Rationale**: The source material argues for this position directly, and then violates it — the same document that recommends explaining the reasoning writes all-caps imperatives elsewhere in its own body. The contradiction is itself the argument for picking a side and applying it uniformly: an artifact that models both voices teaches neither.

**Reversibility**: PASS — voice is a rewriting pass over prose, with no structural dependency.

### D2: Description form — capability-first, not boilerplate

**Decision**: Descriptions lead with the capability the skill provides. The third-person "This skill should be used when" construction is not used.

**Rationale**: The description and `when_to_use` text are combined and truncated at 1,536 characters. That makes the budget capped rather than merely finite, which changes the economics of a fixed preamble: boilerplate spends characters from a hard limit and pushes the actual use case later in the string, where truncation is most likely to reach it. A capability-first opening spends the earliest, safest characters on the discriminating content.

The budget argument is what makes boilerplate wasteful, but it is not the evidence that capability-first works. That comes from a controlled experiment, and it is the strongest measurement produced anywhere in this merge. Holding the skill name, the body, the query set, the runs per query, and the environment constant so the description was the only variable, rewriting from topic-matching to artifact-matching moved hard near-miss false positives from 29.2 percent (7 of 24) to 8.3 percent (2 of 24) on sonnet, and from 14.3 percent (3 of 21) to 4.8 percent (1 of 21) on opus. True positives rose rather than fell, 85.7 percent to 90.5 percent, so the gain is not precision bought with recall. The sample is small — 24 and 21 queries per arm — and the result should be read at that weight.

Two caveats belong with the figures. The rewrite introduced one false positive it had not previously had, so the mechanism is not monotonic. And the description that shipped is a further, D1-conformant revision of the measured arm rather than the measured string itself; the shipped wording has not been re-measured.

**Falsification**: a re-run at the same protocol showing the capability-first form at or above the boilerplate form on hard near-miss false-positive rate.

**Reversibility**: PASS — a per-skill string edit.

### D3: Frontmatter tiers — portable versus extended, not strict versus lax

**Decision**: Frontmatter keys are split into two tiers: the portable set defined by the Agent Skills open standard, and an extended set permitted beyond it. Validation is tier-parameterised — `--standard` enforces the portable set and `--extended` opts into the Claude Code extensions.

This describes what shipped, which is narrower than a tier report. `--standard` is the default, the tier is an input flag rather than a computed verdict, and the output is a boolean with a 0/1 exit; the report carries a tier header naming the flag it ran under. Consequently a default run still rejects the same 18 of 25, and the plugin's own `plugin-creator` skill exits 1 under it. Classifying a skill by the highest tier it satisfies, and reporting that instead of a pass/fail, remains the intended end state and is not yet built.

**Rationale**: The source validator enforced a six-key allow-list — `name`, `description`, `license`, `allowed-tools`, `metadata`, `compatibility`. On inspection that allow-list turned out to be exactly the field set of the Agent Skills open standard, not an arbitrary house restriction. That reframes the conflict: the question is not how strict to be, but whether a given skill is portable across conformant runtimes or bound to one that accepts extensions.

The measurement settles the framing. Applied as a rejection rule, the six-key allow-list rejects 18 of 25 official plugin skills — 72.0 percent — including 7 of 7 of `plugin-dev`'s own skills. A rule that rejects the entire output of the tooling that publishes it is not measuring conformance failure; it is measuring that extension is the norm. Reporting the tier preserves the standard's meaning without declaring most real skills invalid.

**Reversibility**: WARNING — downstream tooling that consumes the validator's verdict would need to handle a two-tier result rather than a boolean. Reverting to a single strict verdict re-introduces the 72.0 percent rejection rate.

### D4: Naming — kebab-case

**Decision**: Skill names are kebab-case.

**Rationale**: This was not a live disagreement so much as a stale copy. Upstream had already fixed it: the two repositories ship divergent copies of the same skill, and the canonical marketplace copy corrects the non-kebab name that the other copy still carries. The resolution is to follow the canonical copy rather than to arbitrate between them.

**Reversibility**: PASS — a rename, though it invalidates any external reference to the old name.

### D5: Checklist and evals — a pre-flight gate, not a completion criterion

**Decision**: The 25-box checklist is retained as a cheap mechanical pre-flight. Measured evidence from evals is the only criterion for calling a skill done.

**Rationale**: The checklist is 25 boxes, not the 27 the source material claimed, and every box is mechanically checkable — which is exactly what makes it valuable as a pre-flight and useless as a completion test. Nothing in it observes whether the skill works. Treating a fully ticked checklist as completion substitutes cheap verification for the expensive kind, and the cheap kind cannot detect the failures that matter.

**Reversibility**: PASS — the two instruments are separable; either can be re-weighted without touching the other.

### D6: Length — under 500 lines and under 5,000 tokens

**Decision**: Both limits apply. A skill must be under 500 lines and under 5,000 tokens.

**Rationale**: The sources between them offered five conflicting figures, so this was not a disagreement between two positions that could be split. The two limits adopted have different provenance, and the ADR should not overstate it: the line count comes from the standard's structural guidance, while the token budget is the progressive-disclosure recommendation for the instructions level. Only the first is settled by external authority. The token budget is adopted on its merits — it is the limit that does the actual work here, since the line rule is the one demonstrated below to fail permissively. The two limits are not redundant with each other. The source skill is 482 lines and approximately 6,900 tokens: it passes the line rule and fails the token rule. Line count is a proxy for the thing that actually costs context, and this case demonstrates the proxy failing in the permissive direction — enforcing only lines would have certified an over-budget file.

**Scope**: both limits are measured over the SKILL.md **body** — the file with its YAML frontmatter block removed — because the body is what loads into context. Stating this is not pedantry: three independent measurements of the merged SKILL.md during review returned 4,148, 4,506, and 4,887 tokens, and the spread is explained by scope (body versus whole file) and by tokenizer choice, not by disagreement about the file. A limit without a stated scope and a named tokenizer is not measurable, and this one was being read three ways.

**Instrument gap**: nothing in the shipped tooling measures either limit. The validator performs no length check, and the only bundled estimator is a bytes-over-four approximation, which is not accurate enough to adjudicate a file sitting within ten percent of the ceiling. Until a real tokenizer is wired in, the line limit is mechanically enforceable and the token limit is advisory. Confirmation box 3 stays unticked for that reason rather than because the merged skill is suspected of breaching it.

**Reversibility**: PASS — thresholds are configuration.

### D7: Directory taxonomy — decided by load mode

**Decision**: The bundled-directory taxonomy is defined by how the runtime loads the contents, not by subject matter: `scripts/` is executed, `references/` is read into context, `assets/` is copied into output.

**Rationale**: Load mode is the only distinction the runtime actually acts on, so it is the only one that can be enforced or reasoned about. Subject-matter taxonomies cut across it and produce directories whose handling is ambiguous.

`examples/` is then a genre inside the read mode rather than a fourth mode. It remains standard-conformant — the specification permits "any additional files or directories" — but it is not a standard-named directory, and that distinction is recorded so a future reader does not mistake permitted for specified.

**Reversibility**: PASS — a directory reorganisation, mechanical but touching every bundled path.

### D8: Iteration — empirical re-run with baseline and benchmark

**Decision**: The iterate step is an empirical loop: establish a baseline, run against a benchmark, change one thing, re-run, compare. The previous guidance — notice where the agent struggles and edit accordingly — is demoted from the method to a trigger for entering the loop.

**Rationale**: "Notice struggles and edit" describes how a problem is detected, not how a fix is validated. It has no comparison and no baseline, so it cannot distinguish an improvement from a regression that happens to fix the one case being watched. Retained as a trigger it is useful; promoted to the method it licenses unmeasured change.

**Reversibility**: PASS — the loop is additive over the trigger.

### D9: Reviewer stance — a scoped restriction, not a blanket ban on testing

**Decision**: The blanket prohibition on testing skills is replaced with a scoped one: the bundled reviewer audits statically and never executes, and therefore cannot substitute for measurement.

**Rationale**: The blanket ban conflated two claims — that this reviewer does not run skills, which is true and is a property of its design, and that skills should not be run, which is false and contradicts D5 and D8. Scoping the restriction to the reviewer keeps the accurate part and removes the part that would have prohibited the only completion criterion the merged skill recognises.

Repointing the reviewer at the merged rules also closes a self-contradiction defect. The reviewer ships alongside the skill that teaches the rules, so an unrepointed reviewer fails skills written according to its own companion. Concretely: the source reviewer's imperative-only style rule would have failed this plugin's own SKILL.md, which is written in the explanatory voice D1 adopts. A bundled reviewer that rejects the output of the bundled guidance is broken as a pair, even though no individual rule in it is wrong on its own terms.

The word-count half of that charge does not hold and is recorded here so it is not repeated: the source's 1,000-3,000 word band is scoped to the body, and the merged body measures 2,968 words, inside the range. Only the style rule conflicts.

**Reversibility**: PASS — a documentation scope change; no behaviour depends on it.

### D10: Evaluation harness — port the bespoke one despite a first-party command existing

**Decision**: The bespoke evaluation harness is ported rather than replaced by the first-party `claude plugin eval`.

**Rationale**: The overlap is real, which is what makes this decision non-obvious rather than trivial. The first-party command carries a no-plugin ablation arm — a control run with the plugin disabled — and that is precisely the comparison the bespoke harness exists to produce. Adopting it would have retired a component rather than duplicated one.

What blocks adoption is execution, not documentation. `claude plugin eval --help` exits 0 and prints the full option set, the ablation semantics, the JSON contract, and the on-disk case format (`evals/**/case.yaml` or `evals/**/prompt.md`, plus `graders/*.md`). Running it returns an early-access refusal. So the interface is readable and the behaviour is not verifiable: nothing can be validated against a command that will not execute, and adopting an unvalidatable runner as the project's only measurement instrument would put the completion criterion of D5 and D8 on something untested.

**Reversibility**: WARNING — anticipated, but not a component swap. The ported harness emits a bespoke `evals/evals.json` shape, and the first-party case format appears nowhere in the repository. Migrating therefore means rewriting every eval set authored between now and then, not repointing a runner. That cost was incurred by not reading `--help` before choosing the on-disk shape; emitting the first-party format from the start would have made the reversal genuinely cheap, and doing so remains the recommended path if the harness is revised before the command reaches general availability.

### D11: Invocation — ship auto-invocable with no gate

**Decision**: The `skill-creator` skill ships auto-invocable, with no invocation gate. This resolution is scoped to that skill; it is not a plugin-wide prohibition on the field.

`plugin-creator`, which writes directory trees and manifests into the user's filesystem, initially declared `disable-model-invocation` as an intent marker with the fail-open caveat inline. That key has since been dropped (`4069aa5`, "drop a fail-open guardrail"), and this paragraph is corrected rather than deleted because the reasoning is the same reasoning that decided D11 for `skill-creator`: a key that expresses intent and guarantees nothing is not defence in depth, it is a second thing to keep in sync with the control that actually holds. What bounds `plugin-creator` is in its body — its phases each stop for explicit agreement before anything is written — and that is the whole of the portable-control rule below, not the accompaniment to a frontmatter half.

**Rationale**: Two independent grounds, either sufficient on its own.

First, the problem the gate would solve shrank to a size a binary off-switch is disproportionate to. Over-triggering was the stated motivation, and matching the description on artifact rather than topic — describing what the skill operates on instead of the subject area it belongs to — cut the hard near-miss false-positive rate from 29.2 percent to 8.3 percent on sonnet and from 14.3 percent to 4.8 percent on opus.

It did not stop occurring, and this ground should not be read as claiming it did. A residual persists, it is model-dependent, and the rewrite introduced one false positive it had not previously had. An 8.3 percent residual is a case for continuing to tune the description, not for a switch that removes the skill from model consideration entirely.

Second, and independently sufficient, the available mechanism does not do what it appears to. `disable-model-invocation` is fail-open in runtimes that do not implement it: the key is accepted, no gate is applied, and nothing reports the difference. Relying on it would have produced false confidence — the appearance of a control with no guarantee of one — which is worse than shipping ungated and knowing it. This is the ground that carries the decision.

The positive obligation follows from the same fact and applies to every skill authored with this plugin: because frontmatter cannot restrict behaviour portably, the SKILL.md body is the only control surface that travels. Any step that writes, deletes, or overwrites carries an explicit in-body confirmation requirement, and no such step is ever conditioned on a frontmatter key.

**Reversibility**: PASS — the gate can be added, subject to the caveat that adding it does not guarantee it takes effect.

## Consequences

### Positive

- Three resolutions (D3, D6, D11) came out opposite to the direction the sources implied, and each is backed by a measurement a future reader can re-run.
- The frontmatter question has a portability answer rather than a strictness answer, and `--extended` clears the frontmatter-key rejections among the 18. The default run is unchanged, so the practical benefit is currently available only to a caller who already knows to opt out.
- The dual length limit closes a gap where a 482-line, roughly 6,900-token file passed the only enforced rule.
- Each resolution carries an explicit falsification condition, so reversal requires new evidence rather than a fresh opinion.

### Negative

- D10 is knowingly provisional, and its migration is more expensive than a runner swap. The bespoke `evals/evals.json` shape diverges from the first-party `case.yaml` plus `graders/*.md` format, so adopting the command later means rewriting every eval set authored in the interim.
- D11 accepts a measured, non-zero over-triggering residual — 8.3 percent on sonnet and 4.8 percent on opus — which is model-dependent and is not expected to reach zero by description tuning alone. No gating mechanism is held in reserve, since the only available one is fail-open. D3's tier report is the nearest thing to a signal: a skill declaring an extended-tier key is flagged as non-portable, which is exactly the warning that the key may be inert on the runtime that loads it.
- The measured figures are environment-bound. The 72.0 percent rejection rate and the roughly 6,900-token count are point-in-time observations against specific corpora and files, and both drift as their sources change.

### Neutral

- D4 is a reconciliation with upstream rather than an independent choice; it would have been reached by following the canonical copy without any adjudication.
- The two-tier frontmatter model adds a reporting dimension without changing what any skill is permitted to declare.

## Confirmation

- [ ] Every bundled skill's combined description and `when_to_use` text is at or under 1,536 characters, with the capability stated before the first truncation-vulnerable position
- [ ] Running the validator with `--extended` over the 25-skill official corpus produces no frontmatter-key rejection among the 18, and the report names the tier it ran under
- [ ] Every bundled skill's SKILL.md body is under 500 lines and under 5,000 tokens, counted with a named tokenizer rather than a bytes-per-token approximation (blocked until a tokenizer is wired into the validator)
- [ ] Bundled directories are confined to `scripts/`, `references/`, `assets/`, and `examples/`, each used per its declared load mode
- [ ] The eval loop produces a recorded baseline and a benchmark comparison for at least one change
- [ ] The bundled reviewer performs no execution, verified by inspection of its tool surface
- [ ] The bundled reviewer's rules are repointed at the merged standard, verified by running it against this plugin's own SKILL.md without a word-count or imperative-style failure
- [ ] No skill relies on `disable-model-invocation` as its only control: neither bundled skill declares the key at all. `skills/plugin-creator` carried it as an intent marker and dropped it in `4069aa5`, on the ground D11 gives — a marker that guarantees nothing is a second thing to maintain, not a layer of defence. What bounds it is in its body, where Phases 1 through 3 each stop for explicit agreement before anything is written

## Clarifications

_No clarifications yet._

## Observations
### Measured evidence

- [fact] Combined description and when_to_use text truncates at 1,536 characters, making the description budget capped rather than merely finite #description #truncation
- [fact] The six-key allow-list rejects 18 of 25 official plugin skills, 72.0 percent, including 7 of 7 of plugin-dev's own skills #frontmatter #measurement
- [fact] The source skill is 482 lines and approximately 6,900 tokens, passing the 500-line rule while failing the 5,000-token rule #length #measurement
- [fact] Rewriting a description from topic-matching to artifact-matching moved hard near-miss false positives 29.2 to 8.3 percent on sonnet (7/24 to 2/24) and 14.3 to 4.8 percent on opus (3/21 to 1/21), with true positives rising 85.7 to 90.5 percent under a single-variable control #description #measurement
- [outcome] That reduction is not an elimination — a model-dependent residual persists and the rewrite introduced one false positive it had not previously had #invocation #description
- [fact] The merged sources proved roughly 95 percent creation-only with essentially nothing for evaluate, modify, or improve, so those three verbs were authored rather than merged #scope #gap

### Resolutions and their scope

- [decision] Eleven merge conflicts across three source artifacts resolved on measured evidence rather than editorial preference #merge #methodology
- [insight] The source validator's six-key allow-list is exactly the Agent Skills open standard field set, reframing strict-versus-lax as portable-versus-extended #frontmatter #standard
- [decision] Directory taxonomy is defined by load mode — scripts executed, references read into context, assets copied into output #taxonomy #load-mode
- [constraint] The examples directory is standard-conformant via the specification's allowance for additional files and directories, but is not a standard-named directory #taxonomy #standard
- [decision] The 25-box checklist is a mechanical pre-flight; measured evidence is the sole completion criterion #evals #checklist
- [constraint] The line limit comes from the standard and the token budget from the progressive-disclosure recommendation; together they resolve five conflicting figures across the sources #length #standard

### Risks, gaps, and defects

- [problem] The source material argues for explanatory voice while writing all-caps imperatives elsewhere in its own body #voice #contradiction
- [risk] The disable-model-invocation key is fail-open in runtimes that do not implement it, so it expresses intent and never a safety boundary #invocation #fail-open
- [constraint] The first-party plugin eval command carries a no-plugin ablation arm that genuinely overlaps the bespoke harness; its interface is readable via --help but it refuses to execute under early access, so its behaviour could not be validated #evals #tooling
- [risk] The ported harness emits a bespoke evals.json shape rather than the first-party case.yaml plus graders format, so adopting the command later means rewriting every eval set, not swapping a runner #evals #migration-cost
- [constraint] Both length limits are scoped to the SKILL.md body with a named tokenizer; nothing in the shipped tooling measures tokens, so the line limit is enforceable and the token limit is advisory #length #instrument-gap
- [problem] An unrepointed bundled reviewer fails skills written per its own companion skill; its imperative-only style rule would have failed this plugin's SKILL.md, though its body-scoped word-count band would not #reviewer #self-contradiction
- [risk] Measured figures are point-in-time and environment-bound; the rejection rate and token count drift as their source corpora change #measurement #staleness
## Relations

- leads_to [[ANALYSIS-001: Python to Bun Port Fidelity]]
- pairs_with [[ANALYSIS-001: Python to Bun Port Fidelity]]
- relates_to [[SESSION-2026-08-09_01: Plugin Kit Shared Layer Restructure]]
