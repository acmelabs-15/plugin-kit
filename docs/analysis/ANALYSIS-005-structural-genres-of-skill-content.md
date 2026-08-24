---
title: "ANALYSIS-005: Structural Genres of Skill Content"
type: analysis
status: DRAFT
permalink: analysis/analysis-005-structural-genres-of-skill-content
tags:
- analysis
- skills
- structure
- lint
- vendor-survey
---

# ANALYSIS-005: Structural Genres of Skill Content

> Every count below was taken by grep over primary text on 2026-08-24, never estimated. Every external claim was checked against the repository or page that makes it — Addy Osmani's pack was cloned rather than fetched through a summariser, because a sibling investigation caught a fetch summariser fabricating a paper's contents. Each genre carries a claim label: MEASURED (someone ran an experiment and reports a number), GUIDANCE (asserted without published evidence), or SHIPPED-PRACTICE (people do it and claim nothing). The catalog inherits its labels and its findings from ANALYSIS-004 and contradicts none of them.

## Context

A skill's body is not undifferentiated prose. It is assembled from a small number of recurring structural elements — numbered steps, tables of a particular shape, checkbox lists, diagrams, pointer blocks — and authors reach for the same ones repeatedly without anyone having named them.

Naming them is the prerequisite for three things this repository wants. Teaching the skill-creator surface what good structure is requires knowing what the available structures are. Making structure lint-detectable requires a signature a rule can match against markdown alone. And measuring whether a structure earns its place requires knowing which of the three harnesses — triggering, disclosure recall, outcome pass rate — could see its effect at all.

The motivating claim came from outside. Addy Osmani's Agent Skills pack is described as shipping "process over prose", "anti-rationalization tables", and "non-negotiable verification". That description is accurate as far as it goes, and this note verifies it against the repository's own text. What the description does not say, and what the counts show, is that two of those three genres are almost unique to that pack.

## Executive Summary

**The three claimed genres are real, verbatim in the primary text, and one of them belongs to a single vendor.** The claim source is the pack's own README under "Key design choices". Anti-rationalization appears in 22 of Addy's 24 skills in a mechanically identical form and in **zero** of Anthropic's 20 published skills — not under other wording either, since a loose grep for rationaliz, excuse, "seems right" and temptation returns nothing across all 20. A genre that reads as an ecosystem norm is one author's house style.

**The claim's universal quantifier is loose, and being precise about it is the point.** "Every skill includes a table" is 22 of 24. "Every skill ends with evidence requirements" is 23 of 24 carrying a verification checkbox. Both shapes are genuinely dominant in that pack and genuinely absent from the vendor's own corpus, where 0 of 20 skills carry a single `- [ ]`.

**Anthropic publishes a structural rule and does not follow it in its own largest bundle.** The published guidance is a table of contents for any reference file longer than 100 lines. Across the claude-api skill's 66 reference files, 48 exceed 100 lines and **none** carries a table of contents, including a 1548-line migration guide. Addy's shared checklists comply in 5 of 7. This repository complies in 0 of 15. That is a compliance gap with a number attached, and it makes the TOC genre the cheapest lint rule in the catalog to write and the easiest to justify.

**Presence is countable for all fourteen genres; effect is measured for two.** Ordered workflow instruction has external measured support — Vercel's evaluation moved invocation from 44% to 95% and pass rate from 53% to 79% by stating a step explicitly rather than making a capability conditionally available. In-step pointer placement was measured in this repository and **refuted** in its actionable form: moving a pointer into the step that needs it halved its reach, 8/40 against 4/40, p≈0.20. Every other genre here is GUIDANCE or SHIPPED-PRACTICE, and the catalog says so on each row rather than letting popularity read as evidence.

**The house convention this repository already ships is among the unvalidated ones, and the measured evidence on it is not encouraging.** The firing-condition reference manifest — a pointer carrying when it fires and what skipping costs — appears in all 5 plugin-kit creator skills and throughout the ask-user-question skill. ANALYSIS-004 established the rule has no published basis and no vendor analogue. It also measured those exact pointers: 33% to 75% recall on sonnet. Shipping the fullest form of the genre did not make those references reliably reached.

## Approach

Four corpora, read as files rather than as descriptions of files.

Addy Osmani's pack was cloned at depth 1 from its GitHub repository; 24 skills, 7 repo-root shared checklists, plus the README and the skill-anatomy document that specify the house format. Anthropic's 20 published skills were read from the marketplace copy installed on this machine — eight whole across the thin-to-fat range (internal-comms at 32 lines through xlsx and docx, to mcp-builder), with claude-api and skill-creator read in sections, and all 20 marker-censused. This repository's 5 creator skills and 15 of its 17 shared references were read; two were left alone because another agent is mid-rewrite in them and their current text is not stable. The ask-user-question skill was read whole — body plus all six references.

Counts come from grep expressions that double as candidate detection signatures, which is deliberate: a genre whose presence cannot be counted mechanically is a genre no lint rule can find.

Three harness names recur below. **Triggering** measures whether a skill fires on the phrasings users type. **Disclosure recall** measures reached over should-have-reached for a bundled reference, per ANALYSIS-004 Finding 1 — never raw pull rate, which conflates rarely-needed with needed-and-missed. **Outcome pass rate** measures whether the produced artifact satisfies its assertions. Genres differ in which harness could see them at all, and several can only be seen by the last one.

One measurement constraint carries from ANALYSIS-004 Finding 3 into every experiment proposed here: run it on the weaker model. The strong model reaches nearly everything eagerly and hides signposting defects; the weaker model over-fetches on nothing and misses, which makes it the only instrument that detects a defect.

## Findings

Each genre carries: what it is structurally, who ships it counted, its claim label, a deterministic detection signature, and the harness that could measure it.

### Genre 1: Ordered workflow steps

A body organised as consecutively numbered headings or a numbered top-level list, each step naming an action rather than a topic. The distinguishing property is that the reader is told to be at a position, not offered material that might be relevant.

**Who ships it.** Addy: 16 of 24 carry numbered step or phase headings, 18 of 24 carry a Process, Workflow, Cycle or Steps section. This repository: 5 of 5 — plugin-creator runs Phase 1 through Phase 8, command-creator numbers 1 through 6, skill-creator and the ask-user-question skill both number their steps. Anthropic: 4 of 20 clearly, led by mcp-builder with 17 numbered subsections and doc-coauthoring with 14.

**Claim: MEASURED, external.** Vercel's agents-md evaluation moved invocation from 44% to 95% and pass rate from 53% to 79% by giving an explicit ordered workflow instruction rather than making the capability conditionally available. That is the strongest external evidence for any genre in this catalog, and it is about the difference between "this is available if relevant" and "at this step, do this".

**Detection signature.** Three or more headings matching `^#{2,4}\s*(Step|Phase)\s*\d+` or `^#{2,4}\s*\d+\.\s`, with the integers ascending and contiguous. A gap or a repeat is itself a finding.

**Harness.** Outcome pass rate. The experiment shape: take one skill whose body is topic-organised, rewrite the same content as numbered steps changing no substantive guidance, and run both arms concurrently against the same scenario set.

### Genre 2: Blocking checkpoint or stop gate

An imperative inside a workflow forbidding progress past a point until a condition holds — distinct from a step, because its content is a refusal rather than an action.

**Who ships it.** Addy: 9 of 24. Anthropic: 5 of 20, the sharpest being claude-api's instruction to stop and ask the user before editing a file carrying another provider's markers. This repository: 0 of 5 creator skills carry an explicit stop imperative, which is a gap worth noticing given how much the build protocol elsewhere relies on gates.

**Claim: SHIPPED-PRACTICE.** No vendor publishes evidence that a stop imperative changes behaviour, and none measures compliance with one.

**Detection signature.** A line matching `\*\*STOP|[Dd]o not proceed|[Bb]efore proceeding|blocking` within a numbered step block or within three lines of a step heading. Requiring the proximity is what separates a gate from prose that happens to contain the word.

**Harness.** Outcome pass rate, on a scenario set built so the only way to pass is to have stopped — a scenario whose correct answer is a question rather than an artifact.

### Genre 3: Anti-rationalization table

A two-column table whose left column quotes an excuse in the agent's own voice and whose right column rebuts it factually. Structurally it is a pre-emptive counter-argument placed where the temptation lives.

**Who ships it.** Addy: **22 of 24**, and the form is mechanically identical in every one — the heading is `## Common Rationalizations` and the header row is `| Rationalization | Reality |` without variation. The two exceptions are idea-refine and the using-agent-skills meta-skill. Anthropic: **0 of 20**, confirmed twice — no such heading, and no match for rationaliz, excuse, "seems right" or temptation anywhere in the 20 bodies. This repository: 0 of 5. The ask-user-question skill: 0.

**Claim: GUIDANCE.** The pack asserts the value plainly — its format spec calls the section "the most distinctive feature of well-crafted skills" and says the tables "prevent the agent from rationalizing its way out of following the process." No experiment is published, here or anywhere, that measures whether a rebutted excuse is less often acted on.

**Detection signature.** A heading matching `rationaliz` followed within five lines by a table whose header row's first cell matches `Rationaliz|Excuse|Objection` and which has exactly two columns and three or more body rows. This is the cleanest signature in the catalog because one author's rigid consistency made it so.

**Harness.** Outcome pass rate, and it needs a purpose-built scenario set: cases that present a plausible reason to skip a step — time pressure, apparent triviality, an authority instruction. The pack ships fixtures of exactly this shape (a time-pressure file, an authority-pressure file), which is the closest thing to an evaluation design anyone has published for it.

### Genre 4: Verification-evidence requirement

A terminal section listing exit criteria as checkboxes, where each item demands an artifact — a passing suite, a build output, a screenshot — rather than a judgement.

**Who ships it.** Addy: 23 of 24 carry at least one `- [ ]`, and 24 of 24 carry a verification-flavoured heading. Anthropic: **0 of 20 carry a single `- [ ]`**. This repository: plugin-creator carries 13 checkboxes; the other four express the same intent as a numbered pre-flight list instead, as does the ask-user-question skill with 14 numbered items.

**Claim: GUIDANCE.** The pack's assertion is unambiguous — verification "is non-negotiable", every skill "ends with evidence requirements", and "'Seems right' is never sufficient." Nothing measures whether the checkbox form produces more evidence than a prose instruction to verify.

Worth recording as a distinction rather than a defect: Anthropic's corpus does demand evidence, it just does not use checkboxes to do it. The xlsx skill's requirements block is the clearest case, and it carries a caveat sharper than most checklists manage — that a clean recalculation proves formulas evaluate, not that they are right, because an off-by-one range yields an error-free file with wrong numbers. That is a verification-honesty statement, and no checkbox in the surveyed corpus says anything as useful.

**Detection signature.** Three or more consecutive `^\s*- \[ \]` lines under a heading matching `[Vv]erif|[Cc]hecklist|[Ee]vidence|[Pp]re-flight`, or the same run as a numbered list under a pre-flight heading. Grading whether the items demand artifacts rather than judgements is not mechanical and should not be attempted by a lint rule.

**Harness.** Outcome pass rate, with the transcript inspected for whether the evidence was actually produced — the interesting failure is a run that ticks the boxes without generating what they name.

### Genre 5: Front-loaded gotcha inventory

A block of counter-intuitive facts, each a bolded lead followed by its consequence, placed before the workflow rather than inside it. Its defining property is that its content cannot live behind a pointer, because the reader has no way to know the trap exists and therefore no way to decide to open a file about it.

**Who ships it.** This repository: 5 of 5, and it is the first section in four of them, under headings that name the failure class — the failures that say nothing, the failures that render cleanly and are still wrong, the silent failures that only happen inside a plugin. The ask-user-question skill: present, before step 1. Anthropic: present under other names in docx, xlsx and claude-api, where a drift table warns that the model's training prior may be stale. Addy: the Red Flags section in 23 of 24 is the closest analogue but sits at the end, which inverts the placement that defines this genre.

**Claim: SHIPPED-PRACTICE**, with an explicit and unusually good rationale published in this repository's own skill-creator body: these facts are inline rather than behind a pointer because you cannot decide to open a file about a trap you do not know exists. That is a progressive-disclosure argument, and it is the only published statement in the survey explaining why a specific class of content must not be moved out of a body.

**Detection signature.** A heading matching `[Gg]otcha|[Pp]itfall|[Dd]rift|silent` occurring within the first 25% of the body's lines, whose immediate content is three or more `^- \*\*` bullets.

**Harness.** Outcome pass rate, on scenarios whose only failure mode is the trap. Disclosure recall is the wrong instrument and would mislead, since the whole claim is that this content must never be behind a pointer.

### Genre 6: Diagnosis table

A table mapping an observed symptom to a cause or to the section that repairs it, usually as the entry point to a set of repair procedures.

**Who ships it.** The ask-user-question skill: the failed-question reference opens with a table mapping what the reader said onto which of seven failure modes was hit, each mode then carrying its own repair. This repository: plugin-creator's diagnostics section carries three, keyed on a component not loading, paths not resolving, and a rejected manifest. Anthropic: claude-api's drift table maps a stale prior to the current API, which is the same shape with training data as the symptom. Addy: debugging-and-error-recovery carries the genre in its five-step triage.

**Claim: SHIPPED-PRACTICE.**

**Detection signature.** A table of two or three columns with three or more body rows whose first-column header matches `[Ss]ymptom|[Cc]heck|[Ee]rror|[Pp]roblem|[Ww]hat .* said|[Ss]tale`, and whose right column contains either a pointer or an imperative.

**Harness.** Outcome pass rate on repair scenarios — present a broken artifact and grade the repair. The interesting measurement is whether the table routes correctly, since the ask-user-question reference makes the point that the modes want opposite fixes and the repair for one makes another worse.

### Genre 7: Decision or routing table

A table whose left column is a condition and whose right column is the approach, tool or file to use. Distinct from a diagnosis table in that it routes forward from an intent rather than backward from a symptom.

**Who ships it.** Anthropic: 4 of 20 place one within the first 45 lines — docx, xlsx, pptx and claude-api all open with a task-to-approach table, and claude-api additionally carries a subcommand dispatch table. Addy: common inside bodies, including a test-size table and a tool-to-purpose table. The ask-user-question skill: the examples file closes with a table choosing between the three call shapes by what the decision costs.

**Claim: SHIPPED-PRACTICE.**

**Detection signature.** A table with two or three columns whose first-column header matches `Task|When|If|Case|Subcommand|Size|Job` and whose second column's cells predominantly contain imperatives, file paths or backticked identifiers.

**Harness.** Outcome pass rate, or disclosure recall where the right column names files — a routing table is a manifest wearing a table's clothes and can be measured as one.

### Genre 8: ASCII flow or pipeline diagram

A fenced or indented block using box-drawing and arrow characters to show a sequence, a decision tree or a proportion.

**Who ships it.** Addy: **14 of 24**, and they carry real load — the red-green-refactor cycle, the bug-reproduction pipeline, the test pyramid with its 80/15/5 proportions, a decision guide branching on whether logic crosses a boundary. Anthropic: **2 of 20**, one being webapp-testing's decision tree. This repository: 0 of 5. The ask-user-question skill: 0. **Mermaid appears zero times in all four corpora**, despite being the diagram form this project's own note conventions specify.

**Claim: SHIPPED-PRACTICE.** The 14-against-2 split is the finding: a third-party pack leans on diagrams heavily and the vendor almost never does, and neither publishes a reason.

**Detection signature.** A fenced or indented block containing three or more of `┌ └ ├ │ ▶ ▼ ╱ ──`, or three or more lines matching `^\s*[|├└]`. Mermaid is the separate and simpler case of a fence whose info string is `mermaid`.

**Harness.** Outcome pass rate, via ablation — replace the diagram with a prose statement of the same sequence and run both arms concurrently. This is the cheapest genre in the catalog to test, because the substitution is mechanical and the content is unchanged.

### Genre 9: Worked before-and-after pair

Two adjacent specimens of the same artifact, one labelled wrong and one right, with the difference between them carrying the instruction.

**Who ships it.** Addy: 11 of 24, densest in test-driven-development, which pairs state-based against interaction-based assertions, DAMP against over-DRY setup, and descriptive against vague test names. Anthropic: 1 of 20 — webapp-testing's single do-and-don't pair on waiting for network idle. The ask-user-question skill: the wording reference carries a worked-rewrites section, and the examples file carries the fullest instance in the survey — a call that failed five times, its diagnosis worst-first, and its repair.

**Claim: SHIPPED-PRACTICE.**

**Detection signature.** Two fenced blocks separated by fewer than four lines, each preceded within two lines by a marker matching `Good|Bad|Before|After|✅|❌|Don't|Do:`; or the same markers as comment leads on the first line inside each fence.

**Harness.** Outcome pass rate graded on output quality rather than on task completion, since the genre's claim is about the shape of what gets produced.

### Genre 10: Firing-condition reference manifest

A pointer block where each entry names a file **and** the condition under which to open it, often with the cost of not opening it.

**Who ships it.** This repository: 5 of 5, under headings that name the property directly — bundled files, and when each one fires — with the conditions in bold. The ask-user-question skill body: three references each get a prose section carrying a firing condition and an explicit cost of skipping, including that skipping the reply reference is how a skip gets read as agreement, which costs a wrong action rather than a wrong sentence. Anthropic: the claude-api skill's quick task reference is the largest instance anywhere — roughly twenty condition-to-file routes covering 66 reference files, each phrased as a bolded situation followed by which file to read.

**Claim: SHIPPED-PRACTICE, and specifically not validated.** ANALYSIS-004 established that the file-plus-firing-condition-plus-cost-of-skipping rule has no published basis and, after a survey of eight vendors, no analogue either. It also measured these exact pointers on the ask-user-question skill: 75%, 60% and 33% recall on sonnet for the three references carrying the fullest form. Shipping the genre did not make them reliably reached. That is the single most important honesty point in this catalog, because the genre is this repository's own convention and it would be easy to read its ubiquity here as evidence.

**Detection signature.** A pointer line containing a filename or path and, in the same sentence, a subordinate clause opening with `when|before|while|open it` — distinguishable from Genre 11 precisely by the presence of that clause.

**Harness.** Disclosure recall, reported as reached over should-have-reached and never as raw pull rate. This is the genre recall was built for, and the denominator can now be derived by ablation rather than hand-annotated, per ANALYSIS-004 Finding 18.

### Genre 11: Bare trailing reference manifest

A closing section listing bundled files as a label and a filename, with no condition and no cost.

**Who ships it.** Anthropic: webapp-testing closes with one, skill-creator closes with one, and the published best-practices page's canonical good example of correct nesting depth is a block of four such lines. Addy: test-driven-development closes with a see-also pointing at a shared checklist.

**Claim: SHIPPED-PRACTICE, with the only measured signal running against it.** ANALYSIS-004 Finding 7 records that this structural form is what measured worst in the recall table, 33% to 75% on sonnet — while noting the confound honestly, since mention count and placement vary together and the controlled placement experiment came back null and trending the other way. The form is the vendor's own canonical illustration, offered to demonstrate nesting depth rather than pointer quality, because placement is not treated as a variable anywhere in the published record.

**Detection signature.** A heading matching `[Rr]eference|[Ss]ee [Aa]lso|[Bb]undled|[Ff]urther` in the last 15% of the body, whose body is a bullet list of two or more filenames where no bullet contains a `when|before|while` clause. The negative condition is what makes it separable from Genre 10.

**Harness.** Disclosure recall, ideally as an A/B against Genre 10 over the same file set — which is the controlled experiment neither this repository nor any vendor has yet run on manifest form as opposed to manifest position.

### Genre 12: Inline in-step pointer

A reference to a file or sibling skill placed inside a numbered workflow step rather than in a manifest.

**Who ships it.** Anthropic: internal-comms is the purest case, where step 2 of a three-step workflow is entirely an instruction to load the matching guideline file; claude-api's subcommand table tells the model to read a named guide immediately and not to summarise it. Addy: test-driven-development points at a sibling skill from inside its browser-testing section.

**Claim: MEASURED, and refuted in its actionable form.** This is the one genre where this repository has already run the experiment. ANALYSIS-004 Finding 4 moved a single trailing pointer into the workflow step where its condition fires, holding mention count at one so placement was isolated from surface area, and re-measured at 40 attempts per arm on sonnet. Reach **halved** — 8/40 trailing against 4/40 in-step, p≈0.20. The honest reading is no detectable effect with a trend against the hypothesis. The correlation, the external Vercel result and the filesystem-level proximity principle from Codex all pointed the other way, and the controlled run did not follow them.

**Detection signature.** A filename, path or backticked skill name appearing on a line inside a numbered-step block, where the block is delimited by consecutive step headings.

**Harness.** Disclosure recall — already run. The catalog entry exists to stop the genre being re-derived as guidance from its intuitive appeal, not to propose measuring it again.

### Genre 13: Numbered rules with a per-rule check

A rule set where each rule is a numbered heading and each carries an explicit, mechanically evaluable test of whether a candidate string or artifact passes it.

**Who ships it.** The ask-user-question skill: the layout reference is built entirely this way — thirteen numbered rules, each opening with a bolded check stating what must hold, such as no authored line exceeding 60 display columns measured in display cells. Its wording reference carries a variant where each rule instead cites the clause of the external specification it derives from, which is a provenance label rather than a check. Nobody else in the survey ships it: 0 of Addy's 24, 0 of Anthropic's 20, 0 of this repository's other creator skills.

**Claim: SHIPPED-PRACTICE**, and a house genre of one skill.

**Detection signature.** Three or more headings matching `^#{3}\s*\d+\.\s`, each followed within five lines by a bolded lead matching `Check:|Test:|Passes when`.

**Harness.** Outcome pass rate graded by a rubric derived from the checks themselves — the genre's distinguishing property is that it hands the grader its own rubric, which makes it unusually cheap to evaluate and is arguably the strongest argument for it.

### Genre 14: Table of contents in a long reference

An anchor-linked list of a reference file's own headings placed at its top, so a partial read still returns a map of the whole.

**Who ships it.** Addy: **5 of 7** shared checklists, the two exceptions being a 67-line file below the threshold and a 370-line file above it. Anthropic: **0 of 66** claude-api reference files, of which **48 exceed 100 lines**, the largest being a 1548-line migration guide. This repository: 0 of 15 readable shared references, of which 13 exceed 100 lines.

**Claim: GUIDANCE, published and then not followed.** The rule is Anthropic's own — a table of contents for reference files longer than 100 lines — and it is stated alongside the mechanism that motivates it: when references are nested, the model may preview with a partial read rather than reading whole files, returning incomplete information. A table of contents is what makes a partial read still useful. The vendor states the rule and complies with it nowhere in its largest bundle.

**Detection signature.** Within the first 25 lines of a `.md` file whose length exceeds 100 lines, three or more bullets matching `^\s*[-*] +\[.+\]\(#`. Both halves of the condition are mechanical, which makes this the cheapest rule in the catalog to write and the easiest to defend, since the threshold is the vendor's own.

**Harness.** Disclosure recall under partial reads specifically — the measurement is not whether the file is opened but whether a truncated read still yields the needed section. That is a variant of the recall harness rather than a new one, and it is not currently instrumented.

## What Could Not Be Determined

- **Whether any genre except two is load-bearing.** Presence is countable for all fourteen and effect is measured for ordered workflow instruction (externally, positive) and in-step pointer placement (here, refuted). For the other twelve there is no experiment, in this repository or in the published record. The catalog is a substrate for measurement, not a set of validated recommendations, and reading a high count as evidence would repeat exactly the error ANALYSIS-004 Finding 17 corrects, where shipped practice was mistaken for a measured constraint.
- **Whether anti-rationalization tables change behaviour at all.** The genre is the most distinctive thing in the survey and the least evidenced. It is also the most testable, because the pack ships fixtures built around time pressure and authority pressure, which is the scenario shape the experiment needs.
- **Why the two exceptions in Addy's pack are exceptions.** The meta-skill and the ideation skill omit the rationalizations table. Whether that is a considered judgement about genre fit or an oversight is not stated anywhere in the repository.
- **Whether a table of contents helps, as opposed to merely being prescribed.** The mechanism is plausible and published, the compliance gap is measured, and the effect is not. The harness variant needed to see it — recall conditioned on partial reads — does not currently exist.
- **Whether Genre 10 beats Genre 11 on form alone.** ANALYSIS-004 tested pointer *position* and found nothing. Nobody has tested pointer *form* — the same pointer in the same place, with and without its firing condition and cost of skipping. That experiment is unrun, and it is the one that would settle whether this repository's own convention earns its place.
- **Frontmatter genres are out of scope.** The description carries its own structures — trigger-and-skip clauses, negative scoping, an embedded disambiguating command in the claude-api case — and they are measured by the triggering harness rather than by anything in this note. They belong in a separate survey.
- **Genre interaction is unexamined.** Every count here treats genres as independent. Whether a numbered workflow makes a trailing manifest better or worse, or whether a gotcha block substitutes for a stop gate, is untested and probably matters more than any single genre's effect.

## Recommendations

1. **Write the four cheapest lint rules first, and only those, because their signatures are unambiguous** — the table of contents rule (Genre 14, against the vendor's own published 100-line threshold), the anti-rationalization table (Genre 3, one heading and one header row), the ordered-step contiguity check (Genre 1, ascending integers), and the manifest-form split (Genres 10 and 11, separated by the presence of a conditional clause). Each matches on markdown alone with no judgement, which is the property that makes a lint rule survivable.
2. **Have every lint rule report presence, never quality, until an experiment says otherwise.** Thirteen of fourteen genres have no measured effect. A rule that says "this reference is over 100 lines and has no table of contents" is a fact; a rule that says "add an anti-rationalization table" is guidance dressed as enforcement, and the catalog exists partly to keep that line visible.
3. **Measure Genre 3 next, because it is the largest unvalidated claim in the ecosystem and the cheapest to test.** One vendor ships it in 22 of 24 skills and nobody else ships it at all, which means the ablation is trivial: take those 22, strip the table, run both arms concurrently against pressure-shaped scenarios on the weaker model.
4. **Do not write pointer placement into any standard, and record why in the standard itself** (Genre 12). The controlled run halved reach. The intuition, the external result and the filesystem-level analogue all pointed the other way, which is exactly why the experiment had to come before the rule and why the null needs to be written down where the next author will find it.
5. **Test Genre 10 against Genre 11 on form before defending this repository's convention further.** The firing-condition manifest is shipped in every creator skill here and is unvalidated, and the only measurement touching it — 33% to 75% recall on the ask-user-question references carrying its fullest form — does not support it. Holding position and mention count fixed while varying only the conditional clause is the missing experiment.
6. **Adopt the diagram question rather than the diagram.** Addy uses ASCII flow diagrams in 14 of 24 skills and Anthropic in 2 of 20, with no published reason on either side, and mermaid appears nowhere despite this project's note conventions specifying it. Ablation is mechanical here — swap the diagram for prose stating the same sequence — so this is a question to settle rather than a preference to legislate.

## Observations

### What the primary text says

- [fact] The three claimed genres are verbatim in the pack's own README under Key design choices — process not prose with steps, checkpoints and exit criteria; a table of common excuses with documented counter-arguments; and verification as non-negotiable where seems-right is never sufficient #claims #verified
- [fact] The pack's format specification calls the rationalizations section the most distinctive feature of well-crafted skills and states its purpose as preventing the agent from rationalizing its way out of following the process #anti-rationalization #stated-purpose
- [problem] The claim's universal quantifier is loose in both directions — every skill includes a rationalizations table is 22 of 24, and every skill ends with evidence requirements is 23 of 24 carrying a checkbox #claims #precision
- [insight] This repository's skill-creator publishes the only rationale in the survey for why a class of content must stay inline rather than move behind a pointer — you cannot decide to open a file about a trap you do not know exists #gotchas #disclosure-argument
- [fact] Anthropic publishes the table-of-contents rule for reference files over 100 lines alongside its mechanism, that nested references may be previewed with a partial read rather than read whole #toc #published-rule

### What the counts show

- [fact] Anti-rationalization appears in 22 of Addy's 24 skills with an identical heading and an identical two-column header, and in zero of Anthropic's 20, zero of this repository's 5 creator skills, and zero of the ask-user-question skill #anti-rationalization #single-vendor
- [fact] A loose grep for rationaliz, excuse, seems-right and temptation across all 20 Anthropic skill bodies returns zero matches, so the absence is genuine rather than a wording difference #anti-rationalization #negative-confirmed
- [fact] Verification checkboxes appear in 23 of Addy's 24 skills and in zero of Anthropic's 20, which express evidence requirements as prose requirement blocks instead #verification #form-split
- [problem] Across the claude-api skill's 66 reference files, 48 exceed 100 lines and none carries a table of contents including a 1548-line migration guide, against 5 of 7 compliance in Addy's shared checklists and 0 of 15 in this repository #toc #compliance-gap
- [fact] ASCII flow diagrams appear in 14 of Addy's 24 skills and 2 of Anthropic's 20, and mermaid appears zero times across all four corpora despite being this project's specified diagram form #diagrams #split
- [fact] Ordered numbered steps appear in 16 of Addy's 24, 5 of 5 creator skills here, and 4 of Anthropic's 20, making it the most evenly distributed genre in the catalog #workflow-steps #distribution
- [fact] Blocking stop imperatives appear in 9 of Addy's 24 and 5 of Anthropic's 20, and in none of this repository's 5 creator skills #gates #gap
- [fact] Worked good-and-bad specimen pairs appear in 11 of Addy's 24 and 1 of Anthropic's 20 #worked-pairs #split
- [fact] Numbered rules each carrying their own pass check appear in exactly one artifact across all four corpora — the ask-user-question layout reference, with thirteen such rules #rules-with-checks #house-genre
- [fact] Anthropic's largest reference bundle does not use the bare trailing manifest its own documentation illustrates, routing 66 files through roughly twenty bolded condition-to-file entries instead #claude-api #routing-manifest

### What the detection signatures buy

- [technique] A genre whose presence cannot be counted by grep is a genre no lint rule can find, so every count in this survey was taken with an expression that doubles as a candidate detection signature #lint #method
- [technique] The anti-rationalization signature is the cleanest in the catalog because one author's rigid consistency made it so — a single heading pattern plus a fixed two-column header, with no variants to accommodate #lint #signature
- [technique] The two manifest genres are separable by one mechanical test, the presence of a when-or-before clause in the same sentence as the filename, which is what lets a rule distinguish a conditioned pointer from a bare one #lint #manifest-split
- [technique] The table-of-contents rule is the cheapest to write and the easiest to defend because both halves of its condition are mechanical and the 100-line threshold is the vendor's own #lint #toc
- [constraint] Signatures should report presence and never quality, because thirteen of the fourteen genres have no measured effect and a rule prescribing an unvalidated genre is guidance dressed as enforcement #lint #scope

### What remains unmeasured

- [insight] Presence is countable for all fourteen genres and effect is measured for two, so the catalog is a substrate for measurement rather than a set of validated recommendations #load-bearing #honesty
- [outcome] Ordered workflow instruction carries the only positive measured support in the catalog, from an external evaluation moving invocation from 44 to 95 percent and pass rate from 53 to 79 percent against conditional availability #workflow-steps #measured
- [outcome] In-step pointer placement is the one genre measured in this repository and it was refuted in its actionable form — reach halved, 8 of 40 trailing against 4 of 40 in-step, p approximately 0.20 — so the entry exists to stop the genre being re-derived from its intuitive appeal #placement #refuted
- [risk] The firing-condition manifest is this repository's own convention, shipped in all 5 creator skills, has no published basis and no vendor analogue, and the only measurement touching it recorded 33 to 75 percent recall on the references carrying its fullest form #house-convention #unvalidated
- [problem] Nobody has tested pointer form as opposed to pointer position — the same pointer in the same place with and without its firing condition and cost of skipping — which is the experiment that would settle whether the house convention earns its place #open #form-experiment
- [risk] Reading a high shipped count as evidence of value would repeat the category error a sibling finding already corrects, where a measured figure about whole skills attached to a task was mistaken for a constraint on files bundled inside one #shipped-practice #category-error
- [constraint] Every experiment proposed here must run on the weaker model, since the strong model reaches nearly everything eagerly and hides the signposting defect the measurement exists to detect #instrument #model-tier
- [problem] Every count treats genres as independent, so whether a numbered workflow changes what a trailing manifest achieves, or whether a front-loaded gotcha block substitutes for a stop gate, is untested and may matter more than any single genre in isolation #interaction #open

## Relations

- extends [[ANALYSIS-004: What Makes a Bundled Reference Get Read]]
- depends_on [[ANALYSIS-003: Measurement Fault Classes]]
- pairs_with [[ANALYSIS-002: Inert Parameter and Flag Survey]]
