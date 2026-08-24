# Body structure: which shapes to reach for, and what stands behind each

A skill body is not undifferentiated prose. It is assembled from a small number of recurring shapes — numbered steps, tables of a particular form, checkbox lists, diagrams, pointer blocks — and authors reach for the same ones repeatedly. This file names them, says who ships each one counted, and says what evidence stands behind it, so you pick a shape knowingly rather than by imitation.

**Read the labels before the catalog.** A standard skill shape was proposed here once, as six rules with evidence attached, and **two of the six were refuted by measurement within hours of being written**. Both refuted rules were intuitive and both had converging support, and both failed anyway. So nothing below rests on how many people ship it. Every entry carries one of three labels, used exactly as the survey assigned them:

- **MEASURED** — someone ran an experiment and reports a number. Says who, and whether the number is from here or from outside.
- **GUIDANCE** — asserted by someone with standing, without published evidence.
- **SHIPPED-PRACTICE** — people do it and claim nothing.

A high count is a high count. That is the whole of what it establishes.

Counts below were taken by grep over primary text on 2026-08-24 across four corpora: a third-party pack (Osmani's Agent Skills, 24 skills plus 7 shared checklists), Anthropic's 20 published skills, this repository's 5 creator skills, and the ask-user-question skill read whole.

## Table of Contents

- [The calibration lesson](#the-calibration-lesson)
- [The default shape](#the-default-shape)
- [Two rules that are refuted](#two-rules-that-are-refuted)
- [The genre catalog](#the-genre-catalog)
- [Choosing a genre you cannot yet justify](#choosing-a-genre-you-cannot-yet-justify)
- [The measurement route](#the-measurement-route)

---

## The calibration lesson

The six proposed rules and what happened to them:

| # | Proposed rule | Verdict | Basis |
|:--|:--|:--|:--|
| 1 | A numbered workflow is the spine of the body | **survives, unmeasured** | Shipped practice. Its measured citation was withdrawn 2026-08-24 — the run measured another mechanism |
| 2 | Every reference is pointed to from inside the step whose work needs it | **refuted** | Controlled run here, 40 attempts per arm: reach *halved* |
| 3 | One level of nesting, never two | **survives** | Published mechanism: nested references get previewed, not read whole |
| 4 | At most three references per skill | **refuted** | Category error — the source figure counts whole skills, not bundled files |
| 5 | Gotchas and the validation loop stay in the body regardless of size | **survives** | Doctrine: you cannot decide to open a file about a trap you do not know exists |
| 6 | A table of contents on references past 100 lines | **survives** | Published guidance plus the partial-read mechanism |

Rule 2 agreed with an external measured result *and* with a filesystem-level proximity principle from another vendor. Rule 4 appeared to rest on a published number. Convergence did not save either one. That is why the labels are not decoration, and why the four survivors below are written as candidates rather than as settled standard.

**Rule 1 is a third failure and it failed in a third way.** Nothing refuted the shape; its citation turned out to be measuring another mechanism entirely, so the rule lost its evidence while keeping its plausibility. The lesson is narrower than the other two and easier to miss: check what a number *measured*, not merely that a number exists and points the right way.

---

## The default shape

Four rules survived. Three of them are **candidate-to-validate** — defensible, untested against this repository's own artifacts. One is locked.

**1. A numbered workflow is the spine of the body.** Consecutively numbered headings or a numbered top-level list, each step naming an action rather than a topic. The distinguishing property: the reader is told to *be at a position*, not offered material that might be relevant.

*SHIPPED-PRACTICE. Its measured support was withdrawn on 2026-08-24 and the shape now carries none.* This entry cited Vercel's agents-md evaluation — invocation 44% to 95%, pass rate 53% to 79% — as the strongest external evidence for any shape in this file. Read in primary text, that manipulation was not a numbered workflow and was not inside the skill at all: "**We tried adding explicit instructions to AGENTS.md telling the agent to use the skill**", the instruction quoted as "Before writing code, first explore the project structure, then invoke the nextjs-doc skill for documentation." That is host-prompt forced invocation authored in always-loaded passive context, which is a different mechanism from how a body is shaped internally. Two figures were imprecise as well: the post reports 56% never-invoked rather than a 44% invocation rate, which was a complement computed here, and its upper figure is "95%+", a floor rather than a value. The evidence is sound and it belongs to passive-context steering — `progressive-disclosure.md` carries it there, alongside the second team that shipped the same architecture.

What survives is the shape itself, on the same footing as rules 3, 5 and 6: defensible, widely shipped, and never measured on this repository's artifacts — **candidate-to-validate**. Do not re-import the 44%-to-95% figure as evidence for a body shape.

Scope it to the body. A reference file that is a catalog, a rule set or a schema is not a workflow, and numbering it changes nothing.

**2. Depth one, never two.** All reference files link directly from SKILL.md. `references/grading.md`, never `references/prompts/grading.md`.

*The mechanism is published by Anthropic* — when references are nested, the model may preview with `head -100` rather than reading whole files, returning incomplete information. *The rule that follows it is published guidance without a number* — **candidate-to-validate**. `progressive-disclosure.md` owns this rule and the fan-out question it is constantly confused with.

**3. Gotchas and the validation loop stay in the body regardless of size.** Both invert the disclosure rule. A gotcha behind a pointer is a gotcha that arrives after the mistake, because the model cannot decide to open a file about a trap it does not know exists. A validator mentioned once produces one run; the loop described produces the loop.

*GUIDANCE* — doctrine with an unusually good published rationale and no measurement. **Candidate-to-validate.** Keep gotchas *early* in the body: content past the first 5,000 body tokens does not survive compaction. Counted here: 5 of 5 creator skills front-load a gotcha inventory, and it is the first section in four of them.

**4. A table of contents on every reference past 100 lines. This one is locked.** House standard as of 2026-08-24, not a candidate.

The form is specified in `progressive-disclosure.md` and is deliberately mechanical — read it there rather than reconstructing it, because a file carrying the same map in any other shape reads as missing one. Whole-specimen files are exempt.

What backs the lock: the 100-line threshold is Anthropic's own published rule, stated alongside the partial-read mechanism that motivates it, and the compliance record is the sharpest number in the survey. Across the claude-api skill's 66 reference files, 48 exceed 100 lines and **none** carries a table of contents, including a 1,548-line migration guide. The third-party pack complies in 5 of 7. This repository complied in **0 of 24** over-threshold files on the survey date; that gap has since been closed across both the shared pool and the per-skill directories. Effect is still unmeasured — the rule is locked because it is cheap, mechanical and the vendor's own, not because anyone has shown it helps.

---

## Two rules that are refuted

Stated here because both are intuitive enough to be re-derived by the next author who finds them persuasive.

**Do not move a pointer into the step whose work needs it.** This was measured here, in the one controlled run this repository has on pointer structure. A single trailing pointer was moved into the numbered workflow step where its condition fires, with mention count held at one so placement was isolated from surface area. Forty attempts per arm on the weaker tier: trailing 8/40, in-step 4/40. Moving it in **halved** reach, p≈0.20 — no detectable effect, trending against the hypothesis. The intuition, an external measured result and another vendor's filesystem-level proximity principle all pointed the other way.

Read it as: placement does not go into any standard, in either direction. The finding is a null with a hostile trend, not evidence that trailing pointers are good.

**Do not cap the number of references a skill bundles.** No cap exists in any source. Anthropic's skill-creator lists bundled resources as "unlimited", and its own claude-api skill routes 66 of them through a single manifest. Two count rules circulate anyway: the published "one level deep" example happens to show three links while illustrating *depth*, and the external "at most three modules" result counts **whole skills attached to one task**, not files inside one skill — its own table is headed "Skills Count".

Fan-out is unbounded; depth is what binds. A check over a reference manifest can tell the two forms apart — the conditional clause is the mechanical difference — but that is detection, not a standard to enforce, because no pointer form has measured evidence and the file-plus-condition-plus-cost rule is struck. What a check must never do is count the entries.

---

## The genre catalog

Shapes you can choose from, with what is actually known about each. None of these is required. Each entry gives what it is, who ships it counted, its label, and when it plausibly earns its place.

### Anti-rationalization table

Two columns: the left quotes an excuse in the agent's own voice, the right rebuts it factually. A pre-emptive counter-argument placed where the temptation lives.

*Counted:* 22 of 24 in the third-party pack, mechanically identical every time — heading `## Common Rationalizations`, header row `| Rationalization | Reality |`. **0 of Anthropic's 20**, confirmed twice: a loose grep for *rationaliz*, *excuse*, "seems right" and *temptation* across all 20 bodies returns nothing. 0 of 5 here.

*GUIDANCE.* The pack calls it "the most distinctive feature of well-crafted skills" and says the tables "prevent the agent from rationalizing its way out of following the process". No experiment anywhere measures whether a rebutted excuse is less often acted on. **This is the largest unvalidated claim in the ecosystem** — a genre that reads as an ecosystem norm is one author's house style.

*Earns its place when* your workflow has a step with an obvious plausible reason to skip it — time pressure, apparent triviality, an instruction from someone senior.

### Verification-evidence checklist

A terminal section of checkboxes where each item demands an artifact — a passing suite, a build output, a screenshot — rather than a judgement.

*Counted:* 23 of 24 in the pack carry at least one `- [ ]`; 24 of 24 carry a verification heading. **0 of Anthropic's 20 carry a single `- [ ]`.** Here, plugin-creator carries 13; the other four express the same intent as a numbered pre-flight list, as does the ask-user-question skill with 14 numbered items.

*GUIDANCE.* Nothing measures whether the checkbox form produces more evidence than a prose instruction to verify. Worth recording as a distinction rather than a defect: Anthropic's corpus *does* demand evidence, in prose. The xlsx skill's requirements block carries a caveat sharper than most checklists manage — that a clean recalculation proves formulas evaluate, not that they are right, because an off-by-one range yields an error-free file with wrong numbers.

*Earns its place when* the exit criteria are artifacts you can name. If an item reads as a judgement ("output looks correct"), the checkbox is buying nothing.

### Diagnosis table

Symptom in the left column, cause or repairing section in the right. Routes *backward* from something that already went wrong.

*Counted:* the ask-user-question skill's failed-question reference opens with one mapping what the reader said onto seven failure modes; plugin-creator's diagnostics section carries three; claude-api's drift table maps a stale training prior to the current API; the pack's debugging skill carries it as a five-step triage.

*SHIPPED-PRACTICE.*

*Earns its place when* the failure modes want **different** fixes and the reader cannot tell which they hit. Where the repair for one mode makes another worse, the routing is the content.

### Decision or routing table

Condition in the left column, approach or file in the right. Routes *forward* from an intent — the mirror of the diagnosis table.

*Counted:* 4 of Anthropic's 20 place one within the first 45 lines (docx, xlsx, pptx, claude-api). Common inside the pack's bodies. The ask-user-question examples file closes with one choosing between call shapes by what the decision costs.

*SHIPPED-PRACTICE.*

*Earns its place when* the body opens onto genuinely different paths and the reader knows their case but not their route. Note that a routing table whose right column names files is a reference manifest wearing a table's clothes, and can be measured as one.

### Worked before-and-after pair

Two adjacent specimens of the same artifact, one wrong and one right, with the difference between them carrying the instruction.

*Counted:* 11 of 24 in the pack, densest in its TDD skill. 1 of Anthropic's 20. The ask-user-question wording reference carries worked rewrites, and its examples file carries the fullest instance in the survey — a call that failed five times, diagnosed worst-first, then repaired.

*SHIPPED-PRACTICE.*

*Earns its place when* the guidance is about the *shape* of an output and prose describing that shape keeps coming out abstract. It is expensive in tokens — two specimens for one point — so use it where the gap between good and bad is visible and hard to state.

### Reference manifest, conditioned or bare

A pointer block. The **conditioned** form names a file, the condition that fires it and often the cost of skipping it. The **bare** form is a label and a filename.

*Counted:* the conditioned form appears in 5 of 5 creator skills here and throughout the ask-user-question skill; the largest instance anywhere is claude-api's roughly twenty condition-to-file routes over 66 files. The bare form is Anthropic's canonical published illustration — four bare `See advanced.md` lines, offered to demonstrate nesting depth.

*SHIPPED-PRACTICE, and specifically not validated.* The conditioned form is this repository's own convention, has no published basis and no analogue across eight vendors surveyed, and the only measurement touching it recorded 33% to 75% recall on the weaker tier for the references carrying its fullest form. Shipping the genre did not make those references reliably reached. Nobody has tested pointer *form* — the same pointer, same place, with and without its condition — which is the experiment that would settle whether the convention earns its place. Do not read its ubiquity here as evidence.

*Earns its place when* — unresolved, honestly. Name every reference where its content is relevant, so a reader meets the pointer at the moment the file would help; that much is coverage and you can check it. Whether to spell out the condition and the cost is judgement, and the rule mandating it here has been struck.

### Blocking checkpoint

An imperative forbidding progress past a point until a condition holds. Distinct from a step: its content is a refusal rather than an action.

*Counted:* 9 of 24 in the pack; 5 of Anthropic's 20, the sharpest being claude-api's instruction to stop and ask before editing a file carrying another provider's markers. **0 of 5 here** — a gap worth noticing given how much this repository's protocols rely on gates elsewhere.

*SHIPPED-PRACTICE.* No vendor publishes evidence that a stop imperative changes behaviour, and none measures compliance with one.

*Earns its place when* proceeding past a point is expensive to undo and the correct output at that moment is a question rather than an artifact.

### Numbered rules with a per-rule check

Each rule is a numbered heading carrying an explicit, mechanically evaluable test of whether a candidate passes it.

*Counted:* exactly one artifact across all four corpora — the ask-user-question layout reference, thirteen rules, each opening with a bolded check such as *no authored line exceeds 60 display columns, measured in display cells*. 0 everywhere else.

*SHIPPED-PRACTICE*, and a house genre of one file.

*Earns its place when* the rules are about a checkable property of a string or an artifact. Its distinguishing virtue is that it hands a grader its own rubric, which makes the resulting skill unusually cheap to evaluate — arguably the strongest argument for it.

### ASCII flow or pipeline diagram

A fenced block using box-drawing and arrow characters to show a sequence, a decision tree or a proportion.

*Counted:* **14 of 24** in the pack, carrying real load — a red-green-refactor cycle, a test pyramid with its 80/15/5 proportions, a decision guide branching on whether logic crosses a boundary. **2 of Anthropic's 20.** 0 of 5 here. **Mermaid appears zero times in all four corpora**, despite being this project's own specified diagram form.

*SHIPPED-PRACTICE.* The 14-against-2 split is itself the finding, and neither side publishes a reason.

*Earns its place when* the branching structure *is* the content. The cost framing — a diagram in a body is text the model reads on every invocation, so put real decision trees in `references/` where only the reader at that fork pays for them, and keep any diagram under roughly fifteen nodes — is in `progressive-disclosure.md`. Do not restate it; that file owns it.

### Whole specimen

A complete instance of the skill's input or output, valuable for its shape rather than for prose about it. Lives in `examples/`, or at the skill root when there is only one.

*SHIPPED-PRACTICE.* Anthropic uses `examples/` in its public skills repository and Claude Code's documentation names it; the Agent Skills specification does not, which makes it spec-permitted rather than spec-named. A reviewer must never flag it as non-conformant and never require it.

*Earns its place when* the artifact's structure is what you are teaching and explanatory prose around it would obscure the thing being copied. **A whole specimen is exempt from the table-of-contents rule** — no H1, no wrapper prose, content *is* the artifact. Injecting a map into one edits the specimen somebody is meant to copy, and specimens are consumed whole rather than partially read, so the mechanism motivating the rule does not reach them. `progressive-disclosure.md` carries the placement test that decides `examples/` against `references/`.

---

## Choosing a genre you cannot yet justify

Twelve of the fourteen shapes surveyed have no measured effect in either direction. That is not a reason to avoid them — it is a reason to be accurate about what you are doing.

Use a genre because its mechanism fits your problem, and say so in that language. "The failure modes want opposite fixes, so the reader needs routing" is a defensible reason. "Twenty-two of twenty-four skills do this" is not a reason at all, and the calibration lesson above is what happens when it gets treated as one.

Two guardrails carry into anything built on this file. **Report presence, never quality** — a check that says "this reference is over 100 lines and has no table of contents" states a fact; one that says "add an anti-rationalization table" is guidance dressed as enforcement. And **every count here treats genres as independent**, which is almost certainly wrong: whether a numbered workflow changes what a trailing manifest achieves, or whether a front-loaded gotcha block substitutes for a stop gate, is untested and may matter more than any single genre in isolation.

---

## The measurement route

"Should we adopt X" is answerable by experiment. Three harnesses exist; the useful question is which one could see a given genre at all.

| Harness | What it measures | Which genres it can see | Where it lives |
|---|---|---|---|
| **Triggering** | Whether the skill fires on the phrasings users type | Frontmatter shapes only — no body genre moves it | `description-optimization.md`, and `description-writing.md` for what to vary |
| **Disclosure recall** | Reached over should-have-reached, per bundled reference | Manifest form, table of contents (under partial reads), routing tables whose right column names files | `disclosure-optimization.md`; the doctrine is `progressive-disclosure.md` |
| **Outcome pass rate** | Whether the produced artifact satisfies its assertions | Everything else — workflow steps, stop gates, anti-rationalization, verification, gotchas, diagnosis tables, worked pairs, per-rule checks, diagrams | The eval loop in SKILL.md; `grader.md` and `benchmark-notes.md` for the passes, `blind-comparison.md` when grading cannot separate two arms |

**Recall is reached-over-should-have-reached, never a raw pull rate.** A raw rate cannot separate *rarely needed* from *needed and missed*, and a keep-or-prune verdict computed from one inverts the ranking of which reference is in trouble. `progressive-disclosure.md` carries that table.

**Run it on the weaker tier.** This constraint carries into every experiment proposed here. The two tiers fail in opposite directions: the strong model reaches nearly everything eagerly and hides signposting defects, while the weaker one over-fetches on nothing and misses. Only the weaker tier is an instrument that detects a defect.

**The general shape of a genre experiment is ablation.** Take artifacts that carry the genre, strip it while changing no substantive guidance, run both arms concurrently against the same scenario set. The cheapest genre to test this way is the diagram — replace it with prose stating the same sequence, and the substitution is mechanical. The most valuable is the anti-rationalization table: one vendor ships it in 22 of 24 skills, nobody else ships it at all, and the pressure-shaped fixtures the experiment needs already exist in that pack.

Where a genre could plausibly earn its place but the evidence is not there, that is a question to settle rather than a preference to legislate.
