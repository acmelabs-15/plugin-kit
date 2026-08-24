---
title: "ANALYSIS-008: Structural Genres of Skill Content, Readable Edition"
type: analysis
status: DRAFT
permalink: analysis/analysis-008-structural-genres-of-skill-content-readable-edition
tags:
- skills
- structure
- lint
- vendor-survey
- readable-edition
---

# ANALYSIS-008: Structural Genres of Skill Content, Readable Edition

This is the readable edition of ANALYSIS-005. It carries the same content in plainer words, at content parity as of 2026-08-24, and ANALYSIS-005 remains the note of record: where the two disagree, ANALYSIS-005 is authoritative.

## Table of Contents

1. [Language](#language)
2. [Why this note exists](#why-this-note-exists)
3. [What the survey found](#what-the-survey-found)
4. [How the counts were taken](#how-the-counts-were-taken)
5. [The four dated corrections](#the-four-dated-corrections)
6. [Lineage: the six proposed rules](#lineage-the-six-proposed-rules)
7. [The fourteen genres](#the-fourteen-genres)
8. [What could not be determined](#what-could-not-be-determined)
9. [Recommendations](#recommendations)
10. [Observations](#observations)
11. [Relations](#relations)

## Language

One word for one concept. Each term below has one meaning in this note, and the Avoid list names the words this note does not use for that meaning.

**Genre**:
A recurring structural element of a skill body — numbered steps, a table of a particular shape, a checkbox list, a diagram, a block of pointers. This note names fourteen of them and counts each one across four corpora.
_Avoid_: pattern, shape, form, structural type, device.

**Claim label**:
The one value on every genre that records what kind of support that genre has. Every genre carries exactly one.
_Avoid_: value label, evidence label, confidence score, rating.

**MEASURED**:
The claim label meaning someone ran an experiment and reports a number. Exactly one genre carries it, and that genre was refuted.

**GUIDANCE**:
The claim label meaning someone asserts the value of the genre and publishes no evidence for it.

**SHIPPED-PRACTICE**:
The claim label meaning people do it and claim nothing. A high count establishes this label and nothing more.

**Detection signature**:
The grep expression that decides whether a genre is present in a markdown file. Every count in this note was taken with one, so every count can be re-run and every genre can become a lint rule.
_Avoid_: regex, detector, matcher, rule.

**Harness**:
A measurement setup that can see a genre's effect. Three exist, and genres differ in which one could see them at all.
_Avoid_: test, eval, benchmark.

**Triggering**:
The harness that measures whether a skill fires on the phrasings users type.

**Disclosure recall**:
The harness that measures, for one bundled reference, the runs that reached it divided by the runs that should have reached it. Never the raw pull rate, which mixes rarely-needed with needed-and-missed.
_Avoid_: pull rate, fetch rate, hit rate.

**Outcome pass rate**:
The harness that measures whether the artifact a skill produces satisfies its own assertions.

**Refuted**:
A rule that was tested and failed. Two of the six proposed rules are refuted.
_Avoid_: disproved, debunked, killed.

**Evidence withdrawn**:
A rule that was never tested, whose cited support was re-read and found to measure something else. One of the six proposed rules is in this state. It is not refuted, and this note keeps the two words apart, because collapsing them would misstate what is known.
_Avoid_: retracted, invalidated, refuted.

**Lineage**:
The record of an earlier six-rule proposal for a standard skill shape, and what happened to each of its six rules.
_Avoid_: history, provenance, background.

**The four corpora**:
The four bodies of text read for this survey. **The pack** is Addy Osmani's Agent Skills pack, 24 skills plus 7 shared checklists. **Anthropic** is Anthropic's 20 published skills. **This repository** is plugin-kit, its 5 creator skills plus its shared references. **The ask-user-question skill** is a separate repository and is counted separately from this repository.
_Avoid_: codebase, source, sample, ecosystem.

**Reference file**:
A markdown file bundled beside a skill and reached by a pointer from the skill body.
_Avoid_: doc, resource, attachment, module.

**Manifest**:
A block in a skill body that lists the skill's bundled reference files. Two genres are manifests, and they differ by one property: Genre 10 gives each entry a firing condition, and Genre 11 gives none.
_Avoid_: index, see-also list, pointer block.

**Firing condition**:
The clause in a pointer that says when to open the file it names, often with the cost of not opening it.
_Avoid_: trigger, precondition, when-clause.

**House convention**:
A practice that one author or one repository ships everywhere without publishing evidence for it.
_Avoid_: house style, house genre, house format, house diction.

**Ablation**:
Removing one element from an artifact, then running the original and the changed version at the same time against the same scenarios, to see what the element was doing.
_Avoid_: A/B test, strip test, arm.

**The weaker model**:
The lower-capability model that every experiment proposed here must run on. The stronger model reaches nearly everything eagerly, which hides the defect the measurement exists to find.
_Avoid_: small model, cheap model, weak model.

**Note of record**:
ANALYSIS-005. It is authoritative wherever this edition and it disagree.
_Avoid_: the original, source note, canonical copy.

**Four words in the note of record are not used here**, because each carried a picture rather than a fact. Load-bearing becomes *has a measured effect*. Spine becomes *organising structure*. Substrate for measurement becomes *a starting list for experiments*. Killed becomes *refuted*.

## Why this note exists

A skill body is not undifferentiated prose. Authors assemble it from a small number of recurring structural elements, and they reach for the same ones repeatedly. Nobody had named them.

Naming them is the prerequisite for three things this repository wants.

- Teaching the skill-creator surface what good structure is requires knowing which structures exist.
- Making structure lint-detectable requires a signature that a rule can match against markdown alone.
- Measuring whether a structure earns its place requires knowing which harness could see its effect at all.

The motivating claim came from outside. The pack is described as shipping "process over prose", "anti-rationalization tables", and "non-negotiable verification". That description is accurate as far as it goes, and this note verifies it against the pack's own text. What the description does not say, and what the counts show, is that two of those three genres are almost unique to that pack.

## What the survey found

Six findings. Each states the finding, then the numbers behind it.

**1. The three claimed genres are real, they are verbatim in the primary text, and one of them belongs to a single author.** The claim source is the pack's own README, under the heading "Key design choices". Anti-rationalization appears in 22 of the pack's 24 skills in a mechanically identical form, and in zero of Anthropic's 20 published skills. The absence is not a wording difference: a loose grep for rationaliz, excuse, "seems right" and temptation returns nothing across all 20 bodies. A genre that looks like an ecosystem-wide norm is one author's house convention.

**2. The claim says every and means almost every, and being precise about the gap is the point.** "Every skill includes a table" is 22 of 24. "Every skill ends with evidence requirements" is 23 of 24 carrying a verification checkbox. Both shapes are genuinely dominant in the pack, and both are genuinely absent from the vendor's own corpus, where 0 of 20 skills carry a single `- [ ]`.

**3. Anthropic publishes a structural rule and does not follow it in its own largest bundle.** The published rule is a table of contents for any reference file longer than 100 lines. Across the claude-api skill's 66 reference files, 48 exceed 100 lines and none carries a table of contents, including a 1548-line migration guide. The pack's shared checklists comply in 5 of 7. This repository complies in 0 of 15 on the shared-reference count, and in 0 of 24 counting every reference-role file over the threshold; Genre 14 enumerates both denominators. That gap is a compliance failure with a number attached, and it makes the table-of-contents genre the cheapest lint rule in the catalog to write and the easiest to justify.

**4. Someone proposed a standard shape once, measurement refuted two of its six rules within hours, and a third lost its evidence.** Four rules survive: a numbered workflow as the organising structure, one level of nesting, gotchas staying in the body, and a table of contents past 100 lines. They survive as candidates to validate, not as established standard. Corrected 2026-08-24: this finding previously continued "since only the first has a positive measured result and that result is external", and after that result was re-opened in primary text, none of the four has a positive measured result. A controlled run refuted the rule that every reference be pointed to from inside the step that needs it. A category error refuted the rule capping a skill at three references. Both refuted rules are marked at the genre entries they touch, so neither can be adopted from this note, and rule 1's evidence withdrawal is marked at the lineage table and at Genre 1. The lesson generalises twice: two of the six rules failed measurement on the day they were written, and a third fell when someone opened the source it had been citing. That is why every entry below carries a claim label, why none rests on popularity, and why no citation inherited from a sibling note counts until it has been opened here.

**5. Presence is countable for all fourteen genres. Effect is measured for exactly one, and that one came back refuted.** Corrected 2026-08-24: this finding previously read "effect is measured for two" and credited ordered workflow instruction with external measured support from Vercel's evaluation. Re-opened in primary text, that evaluation moved invocation by adding an instruction to AGENTS.md telling the agent to invoke a skill, not by organising a body as numbered steps. It therefore measures forced invocation from passive context rather than this genre. The correction sits at Genre 1 and in the lineage table. What remains measured is in-step pointer placement, run in this repository and refuted in its actionable form: moving a pointer into the step that needs it halved its reach, 8/40 against 4/40, p approximately 0.20. The honest position is starker than it first read. Thirteen of fourteen genres have no measured effect, and the fourteenth was measured and did not survive. Every genre here is GUIDANCE or SHIPPED-PRACTICE, and the catalog says so on each entry rather than letting popularity read as evidence.

**6. This repository's own convention is among the unvalidated genres, and the one measurement touching it is not encouraging.** The firing-condition reference manifest is a pointer that carries when it fires and what skipping it costs. It appears in 3 of the 5 plugin-kit creator skills, and throughout the ask-user-question skill. ANALYSIS-004 established that the rule has no published basis and no vendor analogue. It also measured those exact pointers at 33% to 75% recall on sonnet. Shipping the fullest form of the genre did not make those references reliably reached.

## How the counts were taken

Four corpora, read as files rather than as descriptions of files.

- **The pack** was cloned at depth 1 from its GitHub repository: 24 skills, 7 repo-root shared checklists, plus the README and the skill-anatomy document that specify the house format. It was cloned rather than fetched through a summariser, because a sibling investigation caught a fetch summariser fabricating a paper's contents.
- **Anthropic's 20 published skills** were read from the marketplace copy installed on this machine. Eight were read whole, from the shortest to the longest: internal-comms at 32 lines, through xlsx and docx, to mcp-builder. The claude-api and skill-creator skills were read in sections. All 20 were counted for markers by grep.
- **This repository** contributed its 5 creator skills and 15 of its 17 shared references. Two shared references were left alone, because another agent is mid-rewrite in them and their current text is not stable.
- **The ask-user-question skill** was read whole, body plus all six references.

Every count was taken by grep over primary text on 2026-08-24, and none was estimated. Every external claim was checked against the repository or the page that makes it.

Counts come from grep expressions that double as candidate detection signatures. That is deliberate: a genre whose presence cannot be counted mechanically is a genre no lint rule can find.

**The three harnesses.** Triggering measures whether a skill fires on the phrasings users type. Disclosure recall measures reached over should-have-reached for a bundled reference, per ANALYSIS-004 Finding 1, and never the raw pull rate, which conflates rarely-needed with needed-and-missed. Outcome pass rate measures whether the produced artifact satisfies its assertions. Genres differ in which harness could see them at all, and several can only be seen by outcome pass rate.

**One instrument constraint carries from ANALYSIS-004 Finding 3 into every experiment proposed here: run it on the weaker model.** The strong model reaches nearly everything eagerly and hides signposting defects. The weaker model over-fetches on nothing and misses, which makes it the only instrument that detects a defect.

## The four dated corrections

The note of record has corrected itself four times, all on 2026-08-24. Each correction is stated in full at the entry it touches. This table is the index.

| Date | What changed | From | To | Stated in full at |
|:--|:--|:--|:--|:--|
| 2026-08-24 | Genre 1 count for this repository | 5 of 5 creator skills | 3 of 5 | Genre 1 |
| 2026-08-24 | Genre 5 placement count | first section in four of five | first section in three of five | Genre 5 |
| 2026-08-24 | Genre 10 count for this repository | 5 of 5 creator skills | 3 of 5 | Genre 10 |
| 2026-08-24 | Rule 1 and Genre 1 claim label | MEASURED, external | SHIPPED-PRACTICE, evidence withdrawn | Lineage row 1, the lineage correction, Genre 1 |

The fourth is the largest, and it lands at nine sites: the two summary findings above, the lineage table's first verdict cell, three lineage paragraphs, the Genre 1 claim label, recommendation 1, and two observations. It is an evidence withdrawal and not a refutation, and the lineage section says why the distinction has to hold.

**Two places in the note of record were not swept to match its own corrections, and this edition states the corrected figure at both.** Its Executive Summary still reports the firing-condition manifest as appearing in "all 5 plugin-kit creator skills", where its Genre 10 entry corrects that count to 3 of 5. Its "What Could Not Be Determined" section still reports effect as measured for two genres, with ordered workflow instruction described as "externally, positive", where its Executive Summary and its Genre 1 entry withdraw that evidence. Both stale readings are recorded here so that nothing is lost, and the corrected figures are used throughout this edition.

## Lineage: the six proposed rules

This catalog is not the first attempt. A six-rule standard skill shape was proposed in a predecessor conversation, with evidence labels attached to each rule. Two of the six were refuted by measurement within hours of being written, and a third lost its only measured support on 2026-08-24 when the source it cited was re-opened in primary text.

That history is recorded here for two reasons. The refuted rules must not be adopted from this note as genres worth having. And the pattern the history establishes is the reason every catalog entry carries a claim label.

**Refutation and evidence withdrawal are kept apart throughout.** Two rules were tested and failed. One was never tested at all, while being recorded as though it had been. Collapsing the two would misstate what is known about rule 1, which is nothing.

| # | Proposed rule | Verdict | Basis |
|:--|:--|:--|:--|
| 1 | Organise the body as a numbered workflow | **SURVIVES, EVIDENCE WITHDRAWN** | Corrected 2026-08-24. The Vercel result formerly cited here measured an instruction added to AGENTS.md, not a numbered workflow in a body; the correction below the table has the detail. Not refuted. Now rests only on the process-over-prose house convention counted in Genre 1, which is shipped practice |
| 2 | Point to every reference from inside the step whose work needs it | **REFUTED** | Controlled run, 40 attempts on each version, same day: moving a pointer in-step halved reach, 8/40 against 4/40, p approximately 0.20. ANALYSIS-004 Finding 4, as corrected |
| 3 | One level of nesting, never two | **SURVIVES** | Measured. The mechanism is that nested references get previewed rather than read whole |
| 4 | At most three references per skill | **REFUTED** | Category error. The three-module figure counts whole skills attached to one task, not files bundled inside one. ANALYSIS-004 Finding 17 |
| 5 | Keep gotchas and the validation loop in the body regardless of size | **SURVIVES** | Doctrine, not measurement. Genre 5 carries the published rationale: a reader cannot decide to open a file about a trap they do not know exists |
| 6 | Put a table of contents on references past 100 lines | **SURVIVES** | Published guidance, reinforced by the sourced partial-read mechanism. Genre 14 has the detail |

**Correction, 2026-08-24: rule 1 loses its evidence, and this is a third failure mode rather than a third refutation.** Row 1's basis was re-opened in primary text and does not say what it was cited as saying. Vercel's evaluation moved invocation by adding an instruction to AGENTS.md telling the agent to invoke a skill. That instruction is passive context authored outside the skill, not an organisation of a skill body as numbered steps. Rule 1 is therefore not refuted: nothing tested it and found it wanting. It loses its only positive measured support and drops to the standing of rules 3, 5 and 6, which is defensible doctrine, never tested here. The verdict cell reads SURVIVES, EVIDENCE WITHDRAWN to keep that distinction visible. The primary-text quotations are held in ANALYSIS-006 Finding 21.

**The consequence for the table as a whole is worth stating outright: after this correction, not one of the four surviving rules has a positive measured result behind it.** Rule 1 rests on shipped practice, rule 3 on a mechanism, rule 5 on doctrine, and rule 6 on published guidance. The survivors are unanimously unvalidated, which is a stronger claim than the table made before, and a less comfortable one.

**The lesson, stated plainly, because it is the reason this note is shaped the way it is.** Two of the six rules failed measurement on the day they were written, and a third lost its evidence when someone re-opened the source it cited. Both refuted rules were intuitive, and both had converging support. Rule 2 agreed with an external measured result and with Codex's filesystem-level proximity principle. Rule 4 appeared to rest on a published number. Both failed anyway. Therefore every genre entry below carries a claim label that says MEASURED, GUIDANCE or SHIPPED-PRACTICE, and never assumes. A genre that many people ship is a genre many people ship, and that is the whole of what a high count establishes.

**Rule 1 adds a second discipline that the claim labels alone do not enforce.** A label is only as good as the citation under it, and this one survived two notes because nobody reopened the source. The verification rule this repository already had was aimed at claims being made for the first time, not at claims being inherited from a sibling note. **A citation carried across from another note is unverified until someone opens it here.** That failure mode is silent, it is not detectable by reading the note that carries it, and it produced a label reading MEASURED on a genre nobody had ever measured.

**The four survivors are candidate standard to validate, not established standard.** Corrected 2026-08-24: this paragraph previously read "Only rule 1 has a positive measured result behind it, and that result is external and about instruction form rather than about this repository's artifacts." After the correction above, none of the four has a positive measured result. Rule 1 rests on shipped practice, rule 3 on a mechanism, rule 5 on doctrine, and rule 6 on published guidance. Each is defensible, none is tested here, and none is measured anywhere. Writing them into a standard is a decision to be taken knowingly, and the correction makes it a more consequential decision than this paragraph previously implied, rather than a less consequential one.

**Where the refuted rules touch the catalog, they are marked at the point of contact.** Rule 2 is marked in Genre 12. Rule 4 is marked in Genre 10 and in the reference-count discussion there. A reader who arrives at a genre entry cannot adopt a refuted rule without meeting its refutation first.

## The fourteen genres

Every entry has the same shape, so a reader learns it once.

1. **What it is.** The structure, and the property that distinguishes it from its neighbours.
2. **Who ships it.** The counts, always in the order: the pack, Anthropic, this repository, the ask-user-question skill. A corpus is named only where the survey counted it.
3. **Claim.** The claim label and the evidence behind it.
4. **Corrections and refutations.** Present only where a dated correction or a refuted rule touches the genre. Its absence means neither does.
5. **Detection signature.** The grep expression a lint rule would match on.
6. **Harness.** The measurement setup that could see the genre's effect, and the shape of the experiment.

### Genre 1: Ordered workflow steps

**What it is.** A body organised as consecutively numbered headings, or as a numbered top-level list, where each step names an action rather than a topic. The distinguishing property is that the reader is told to be at a position, rather than offered material that might be relevant.

**Who ships it.** The pack: 16 of 24 carry numbered step or phase headings on the strict measure, and 18 of 24 carry a Process, Workflow, Cycle or Steps section on the loose measure. Anthropic: 4 of 20 clearly, led by mcp-builder with 17 numbered subsections and doc-coauthoring with 14. This repository: 3 of 5 on the strict measure, where plugin-creator runs Phase 1 through Phase 8, command-creator numbers 1 through 6, and skill-creator numbers Step 1 through Step 5. On the loose measure this repository is 1 of 5, though that grep is tuned to the pack's diction and does not transfer cleanly. The ask-user-question skill numbers 1 through 7, and is counted separately because it is a different repository.

**Claim: SHIPPED-PRACTICE.** The in-repo count evidence stands as counted, and a count establishes that people ship the genre and nothing more.

**Corrections and refutations.** Two dated corrections land here.

*Corrected 2026-08-24, the count: this line previously read 5 of 5, and the detector built from this genre's own signature refuted it.* agent-creator and mcp-creator carry zero numbered step headings, and both are topic-organised under descriptive imperative headings. agent-creator's only numbered list is four interview questions inside its capture-intent section, which is a question list rather than an organising structure. Two things went wrong and both are worth naming. The stated count and the named examples disagreed, since the sentence asserted five while naming only three creator skills, and nobody caught it because the examples read plausibly. And the ask-user-question skill was folded into a denominator of plugin-kit creator skills it does not belong to, which padded the numerator on top of the overcount. The general lesson for the catalog: a count and its example list must be generated from the same command, or they drift apart silently.

*Corrected 2026-08-24, the claim label: this entry previously read MEASURED, external, and the citation carrying that label does not support it.* The entry previously said that Vercel's agents-md evaluation moved invocation from 44% to 95% and pass rate from 53% to 79% "by giving an explicit ordered workflow instruction rather than making the capability conditionally available", and it called that the strongest external evidence for any genre in the catalog. Re-opened in primary text, the manipulation was an instruction added to AGENTS.md telling the agent to invoke a skill. Verbatim: "We tried adding explicit instructions to AGENTS.md telling the agent to use the skill", with the example instruction given as "Before writing code, first explore the project structure, then invoke the nextjs-doc skill for documentation." That is host-prompt-level forced invocation, authored in always-loaded passive context outside the skill, and it measures whether a skill fires at all rather than how a skill body is organised. Two figure corrections travel with it. The published trigger figures are 56% never-invoked, so the 44% is a complement this repository computed rather than a number the post states. And the post gives "95%+" rather than 95% flat. This genre therefore has no external measured support, and the result it was leaning on belongs to the forced-invocation question instead. The primary-text quotations are held in ANALYSIS-006 Finding 21, and the mechanism they bear on is ANALYSIS-006 Finding 11, the absence of any `tool_choice` analogue for skills.

*A limit of the signature, rather than a defect in it.* The two skills with zero strict matches arguably do have an organising order, carried by descriptive headings placed in a deliberate sequence. A mechanical detector sees only an explicit one, which is the honest boundary of what Genre 1 can be linted for.

**Detection signature.** Three or more headings matching `^#{2,4}\s*(Step|Phase)\s*\d+` or `^#{2,4}\s*\d+\.\s`, with the integers ascending and contiguous. A gap or a repeat is itself a finding.

**Harness.** Outcome pass rate. The experiment: take one skill whose body is topic-organised, rewrite the same content as numbered steps changing no substantive guidance, and run both versions at the same time against the same scenario set. This genre is now wholly untested, so that experiment is the only thing that could settle it.

### Genre 2: Blocking checkpoint or stop gate

**What it is.** An imperative inside a workflow that forbids progress past a point until a condition holds. It is distinct from a step, because its content is a refusal rather than an action.

**Who ships it.** The pack: 9 of 24. Anthropic: 5 of 20, and the clearest is claude-api's instruction to stop and ask the user before editing a file carrying another provider's markers. This repository: 0 of 5 creator skills carry an explicit stop imperative, which is a gap worth noticing given how much the build protocol elsewhere relies on gates.

**Claim: SHIPPED-PRACTICE.** No vendor publishes evidence that a stop imperative changes behaviour, and none measures compliance with one.

**Detection signature.** A line matching `\*\*STOP|[Dd]o not proceed|[Bb]efore proceeding|blocking` within a numbered step block, or within three lines of a step heading. Requiring the proximity is what separates a gate from prose that happens to contain the word.

**Harness.** Outcome pass rate, on a scenario set built so that the only way to pass is to have stopped. The scenario's correct answer has to be a question rather than an artifact.

### Genre 3: Anti-rationalization table

**What it is.** A two-column table whose left column quotes an excuse in the agent's own voice and whose right column rebuts it factually. Structurally it is a pre-emptive counter-argument, placed where the temptation lives.

**Who ships it.** The pack: 22 of 24, and the form is mechanically identical in every one, since the heading is `## Common Rationalizations` and the header row is `| Rationalization | Reality |` without variation. The two exceptions are idea-refine and the using-agent-skills meta-skill. Anthropic: 0 of 20, confirmed twice, since there is no such heading and no match for rationaliz, excuse, "seems right" or temptation anywhere in the 20 bodies. This repository: 0 of 5. The ask-user-question skill: 0.

**Claim: GUIDANCE.** The pack asserts the value plainly. Its format specification calls the section "the most distinctive feature of well-crafted skills" and says the tables "prevent the agent from rationalizing its way out of following the process." No experiment is published, here or anywhere, that measures whether a rebutted excuse is less often acted on.

**Detection signature.** A heading matching `rationaliz` followed within five lines by a table whose header row's first cell matches `Rationaliz|Excuse|Objection`, and which has exactly two columns and three or more body rows. This is the cleanest signature in the catalog, because one author's rigid consistency made it so.

**Harness.** Outcome pass rate, and it needs a purpose-built scenario set: cases that present a plausible reason to skip a step, such as time pressure, apparent triviality, or an authority instruction. The pack ships fixtures of exactly this shape, a time-pressure file and an authority-pressure file, which is the closest thing to an evaluation design anyone has published for the genre.

### Genre 4: Verification-evidence requirement

**What it is.** A terminal section listing exit criteria as checkboxes, where each item demands an artifact — a passing suite, a build output, a screenshot — rather than a judgement.

**Who ships it.** The pack: 23 of 24 carry at least one `- [ ]`, and 24 of 24 carry a verification-flavoured heading. Anthropic: 0 of 20 carry a single `- [ ]`. This repository: plugin-creator carries 13 checkboxes, and the other four express the same intent as a numbered pre-flight list instead. The ask-user-question skill does the same, with 14 numbered items.

**Claim: GUIDANCE.** The pack's assertion is unambiguous: verification "is non-negotiable", every skill "ends with evidence requirements", and "'Seems right' is never sufficient." Nothing measures whether the checkbox form produces more evidence than a prose instruction to verify.

*Worth recording as a distinction rather than a defect.* Anthropic's corpus does demand evidence, and it simply does not use checkboxes to do it. The xlsx skill's requirements block is the clearest case, and it carries a caveat sharper than most checklists manage: a clean recalculation proves that formulas evaluate, not that they are right, because an off-by-one range yields an error-free file with wrong numbers. That is a verification-honesty statement, and no checkbox in the surveyed corpus says anything as useful.

**Detection signature.** Three or more consecutive `^\s*- \[ \]` lines under a heading matching `[Vv]erif|[Cc]hecklist|[Ee]vidence|[Pp]re-flight`, or the same run as a numbered list under a pre-flight heading. Grading whether the items demand artifacts rather than judgements is not mechanical, and a lint rule should not attempt it.

**Harness.** Outcome pass rate, with the transcript inspected for whether the evidence was actually produced. The interesting failure is a run that ticks the boxes without generating what they name.

### Genre 5: Front-loaded gotcha inventory

**What it is.** A block of counter-intuitive facts, each a bolded lead followed by its consequence, placed before the workflow rather than inside it. Its defining property is that its content cannot live behind a pointer, because the reader has no way to know the trap exists and therefore no way to decide to open a file about it.

**Who ships it.** The pack: the Red Flags section in 23 of 24 is the closest analogue, and it sits at the end, which inverts the placement that defines this genre. Anthropic: present under other names in docx, xlsx and claude-api, where a drift table warns that the model's training prior may be stale. This repository: 5 of 5, verified, all five carrying a Gotchas H2 within the first 25% of the body, between 10% and 23% in. It is the first section in three of them — mcp-creator, plugin-creator and skill-creator — and in agent-creator and command-creator it is the third and the second H2 respectively, still front-loaded but not opening the body. The headings name the failure class: the failures that say nothing, the failures that render cleanly and are still wrong, and the silent failures that only happen inside a plugin. The ask-user-question skill: present, before step 1.

**Claim: SHIPPED-PRACTICE**, with an explicit and unusually good rationale published in this repository's own skill-creator body. Those facts are inline rather than behind a pointer because you cannot decide to open a file about a trap you do not know exists. That is a progressive-disclosure argument, and it is the only published statement in the survey explaining why a specific class of content must not be moved out of a body.

**Corrections and refutations.** *Corrected 2026-08-24, the placement count: this entry previously read "first section in four of them", and the correction to three was made during the same sweep that corrected Genres 1 and 10.*

**Detection signature.** A heading matching `[Gg]otcha|[Pp]itfall|[Dd]rift|silent` occurring within the first 25% of the body's lines, whose immediate content is three or more `^- \*\*` bullets.

**Harness.** Outcome pass rate, on scenarios whose only failure mode is the trap. Disclosure recall is the wrong instrument and would mislead, since the whole claim is that this content must never sit behind a pointer.

### Genre 6: Diagnosis table

**What it is.** A table mapping an observed symptom to a cause, or to the section that repairs it. It is usually the entry point to a set of repair procedures.

**Who ships it.** The pack: debugging-and-error-recovery carries the genre in its five-step triage. Anthropic: claude-api's drift table maps a stale prior to the current API, which is the same shape with training data as the symptom. This repository: plugin-creator's diagnostics section carries three rows, keyed on a component not loading, paths not resolving, and a rejected manifest. The ask-user-question skill: the failed-question reference opens with a table mapping what the reader said onto which of seven failure modes was hit, and each mode then carries its own repair.

**Claim: SHIPPED-PRACTICE.**

**Detection signature.** A table of two or three columns with three or more body rows, whose first-column header matches `[Ss]ymptom|[Cc]heck|[Ee]rror|[Pp]roblem|[Ww]hat .* said|[Ss]tale`, and whose right column contains either a pointer or an imperative.

**Harness.** Outcome pass rate on repair scenarios: present a broken artifact and grade the repair. The interesting measurement is whether the table routes correctly, since the ask-user-question reference makes the point that the modes want opposite fixes and that the repair for one makes another worse.

### Genre 7: Decision or routing table

**What it is.** A table whose left column is a condition and whose right column is the approach, tool or file to use. It differs from a diagnosis table in that it routes forward from an intent rather than backward from a symptom.

**Who ships it.** The pack: common inside bodies, including a test-size table and a tool-to-purpose table. Anthropic: 4 of 20 place one within the first 45 lines, since docx, xlsx, pptx and claude-api all open with a task-to-approach table, and claude-api additionally carries a subcommand dispatch table. The ask-user-question skill: the examples file closes with a table choosing between the three call shapes by what the decision costs.

**Claim: SHIPPED-PRACTICE.**

**Detection signature.** A table with two or three columns whose first-column header matches `Task|When|If|Case|Subcommand|Size|Job`, and whose second column's cells predominantly contain imperatives, file paths or backticked identifiers.

**Harness.** Outcome pass rate, or disclosure recall where the right column names files. A routing table whose right column names files is a manifest in table form, and it can be measured as one.

### Genre 8: ASCII flow or pipeline diagram

**What it is.** A fenced or indented block using box-drawing and arrow characters to show a sequence, a decision tree or a proportion.

**Who ships it.** The pack: 14 of 24, and they carry real load, including the red-green-refactor cycle, the bug-reproduction pipeline, the test pyramid with its 80/15/5 proportions, and a decision guide branching on whether logic crosses a boundary. Anthropic: 2 of 20, one being webapp-testing's decision tree. This repository: 0 of 5. The ask-user-question skill: 0. Mermaid appears zero times in all four corpora, despite being the diagram form this project's own note conventions specify.

**Claim: SHIPPED-PRACTICE.** The 14-against-2 split is the finding. A third-party pack leans on diagrams heavily, the vendor almost never does, and neither publishes a reason.

**Detection signature.** A fenced or indented block containing three or more of `┌ └ ├ │ ▶ ▼ ╱ ──`, or three or more lines matching `^\s*[|├└]`. Mermaid is the separate and simpler case of a fence whose info string is `mermaid`.

**Harness.** Outcome pass rate, via ablation: replace the diagram with a prose statement of the same sequence and run both versions at the same time. This is the cheapest genre in the catalog to test, because the substitution is mechanical and the content is unchanged.

### Genre 9: Worked before-and-after pair

**What it is.** Two adjacent specimens of the same artifact, one labelled wrong and one labelled right, where the difference between them carries the instruction.

**Who ships it.** The pack: 11 of 24, densest in test-driven-development, which pairs state-based against interaction-based assertions, DAMP against over-DRY setup, and descriptive against vague test names. Anthropic: 1 of 20, which is webapp-testing's single do-and-don't pair on waiting for network idle. The ask-user-question skill: the wording reference carries a worked-rewrites section, and the examples file carries the fullest instance in the survey, a call that failed five times with its diagnosis worst problem first and its repair.

**Claim: SHIPPED-PRACTICE.**

**Detection signature.** Two fenced blocks separated by fewer than four lines, each preceded within two lines by a marker matching `Good|Bad|Before|After|✅|❌|Don't|Do:`, or the same markers as comment leads on the first line inside each fence.

**Harness.** Outcome pass rate graded on output quality rather than on task completion, since the genre's claim is about the shape of what gets produced.

### Genre 10: Firing-condition reference manifest

**What it is.** A pointer block where each entry names a file **and** the condition under which to open it, often with the cost of not opening it.

**Who ships it.** Anthropic: the claude-api skill's quick task reference is the largest instance anywhere, roughly twenty condition-to-file routes covering 66 reference files, each phrased as a bolded situation followed by which file to read. This repository: 3 of 5. agent-creator and command-creator both use the heading "Bundled files, and when each one fires" with the conditions in bold, and mcp-creator uses the heading "Bundled files" with the condition in the prose of each entry. The ask-user-question skill body: three references each get a prose section carrying a firing condition and an explicit cost of skipping, including that skipping the reply reference is how a skip gets read as agreement, which costs a wrong action rather than a wrong sentence.

**Claim: SHIPPED-PRACTICE, and specifically not validated.** ANALYSIS-004 established that the file-plus-firing-condition-plus-cost-of-skipping rule has no published basis, and, after a survey of eight vendors, no analogue either. It also measured these exact pointers on the ask-user-question skill: 75%, 60% and 33% recall on sonnet for the three references carrying the fullest form. Shipping the genre did not make them reliably reached. That is the single most important honesty point in this catalog, because the genre is this repository's own convention and it would be easy to read its ubiquity here as evidence.

**Corrections and refutations.** One dated correction and one refuted rule land here.

*Corrected 2026-08-24, the count: this line previously read 5 of 5, and it was found by sweeping the other repo counts after the Genre 1 correction rather than by the detector, which does not cover this genre yet.* plugin-creator and skill-creator carry no manifest section at all. They point at their references inline instead, with 11 and 21 inline mentions respectively, which is Genre 12, the in-step pointer form that this repository's own controlled run refuted. That makes the correction substantive rather than arithmetic: two of the five creator skills use exclusively the pointer form measurement did not support, and the note previously reported them as using the manifest form instead. Whether that is deliberate or drift is not established here.

*A cap on how many entries this manifest may carry is REFUTED, and must not be reintroduced here.* Rule 4 of the proposed standard said at most three references per skill. It was a category error, because the three-module figure counts whole skills attached to one task rather than files bundled inside one, and no vendor states a count cap anywhere. Anthropic's skill-creator calls bundled resources unlimited, and its own claude-api skill routes 66 of them through a single manifest of this genre. The constraint that actually binds is depth, bounded at one, not the number of files. A lint rule over this genre may check that each entry carries a firing condition, and it must not check how many entries there are.

**Detection signature.** A pointer line containing a filename or path and, in the same sentence, a subordinate clause opening with `when|before|while|open it`. That clause is what distinguishes this genre from Genre 11.

**Harness.** Disclosure recall, reported as reached over should-have-reached and never as raw pull rate. This is the genre recall was built for, and the denominator can now be derived by ablation rather than hand-annotated, per ANALYSIS-004 Finding 18.

### Genre 11: Bare trailing reference manifest

**What it is.** A closing section listing bundled files as a label and a filename, with no condition and no cost.

**Who ships it.** The pack: test-driven-development closes with a see-also pointing at a shared checklist. Anthropic: webapp-testing closes with one, skill-creator closes with one, and the published best-practices page's canonical good example of correct nesting depth is a block of four such lines.

**Claim: SHIPPED-PRACTICE, with the only measured signal running against it.** ANALYSIS-004 Finding 7 records that this structural form is what measured worst in the recall table, at 33% to 75% on sonnet. It also notes the confound honestly, since mention count and placement vary together, and the controlled placement experiment came back null and trending the other way. The form is the vendor's own canonical illustration, offered to demonstrate nesting depth rather than pointer quality, because placement is not treated as a variable anywhere in the published record.

**Detection signature.** A heading matching `[Rr]eference|[Ss]ee [Aa]lso|[Bb]undled|[Ff]urther` in the last 15% of the body, whose content is a bullet list of two or more filenames where no bullet contains a `when|before|while` clause. The negative condition is what makes it separable from Genre 10.

**Harness.** Disclosure recall, ideally as an ablation against Genre 10 over the same file set. That is the controlled experiment neither this repository nor any vendor has yet run on manifest form, as opposed to manifest position.

### Genre 12: Inline in-step pointer

**What it is.** A reference to a file or a sibling skill placed inside a numbered workflow step rather than in a manifest.

**Who ships it.** The pack: test-driven-development points at a sibling skill from inside its browser-testing section. Anthropic: internal-comms is the purest case, where step 2 of a three-step workflow is entirely an instruction to load the matching guideline file, and claude-api's subcommand table tells the model to read a named guide immediately and not to summarise it.

**Claim: MEASURED, and REFUTED in its actionable form. Do not adopt this as a rule.**

**Corrections and refutations.** This genre is rule 2 of the proposed standard, and it is one of the two rules measurement refuted. It is the one genre where this repository has already run the experiment. ANALYSIS-004 Finding 4 moved a single trailing pointer into the workflow step where its condition fires, holding mention count at one so that placement was isolated from surface area, and re-measured at 40 attempts on each version on sonnet. Reach halved: 8/40 trailing against 4/40 in-step, p approximately 0.20. The honest reading is no detectable effect, with a trend against the hypothesis. The correlation, the external Vercel result and the filesystem-level proximity principle from Codex all pointed the other way, and the controlled run did not follow them.

**Detection signature.** A filename, path or backticked skill name appearing on a line inside a numbered-step block, where the block is delimited by consecutive step headings.

**Harness.** Disclosure recall, already run. The catalog entry exists to stop the genre being re-derived as guidance from its intuitive appeal, not to propose measuring it again.

### Genre 13: Numbered rules with a per-rule check

**What it is.** A rule set where each rule is a numbered heading and each carries an explicit, mechanically evaluable test of whether a candidate string or artifact passes it.

**Who ships it.** The pack: 0 of 24. Anthropic: 0 of 20. This repository: 0 of the other 5 creator skills. The ask-user-question skill: the layout reference is built entirely this way, with thirteen numbered rules, each opening with a bolded check stating what must hold, such as no authored line exceeding 60 display columns measured in display cells. Its wording reference carries a variant where each rule instead cites the clause of the external specification it derives from, which is a provenance label rather than a check.

**Claim: SHIPPED-PRACTICE**, and a house convention of one skill.

**Detection signature.** Three or more headings matching `^#{3}\s*\d+\.\s`, each followed within five lines by a bolded lead matching `Check:|Test:|Passes when`.

**Harness.** Outcome pass rate, graded by a rubric derived from the checks themselves. The genre's distinguishing property is that it hands the grader its own rubric, which makes it unusually cheap to evaluate and is arguably the strongest argument for it.

### Genre 14: Table of contents in a long reference

**What it is.** An anchor-linked list of a reference file's own headings, placed at the top of that file, so that a partial read still returns a map of the whole.

**Who ships it.** The pack: 5 of 7 shared checklists, and the two exceptions are a 67-line file below the threshold and a 370-line file above it. Anthropic: 0 of the claude-api skill's 66 reference files, of which 48 exceed 100 lines, the largest being a 1548-line migration guide. This repository: 0 of 24 over-threshold files. The ask-user-question skill: 0 of 6.

**This repository's gap, enumerated, because it is an actionable work item rather than an observation.** Twenty-four reference-role files here exceed 100 lines and none carries a table of contents.

In `shared/references/`, thirteen files: schemas.md (723), grader.md (227), blind-comparison.md (217), distribution-targets.md (209), comparison-analysis.md (202), disclosure-optimization.md (200), description-optimization.md (195), progressive-disclosure.md (191), pure-bun.md (185), running-detached.md (160), description-writing.md (144), plugin-skills.md (115), benchmark-notes.md (107).

In per-skill `references/` and `examples/`, eleven files: command-creator/arguments.md (335), mcp-creator/server-entry.md (296), agent-creator/agent-frontmatter.md (269), command-creator/command-frontmatter.md (268), mcp-creator/tool-surface.md (258), mcp-creator/naming-walkthrough.md (232), command-creator/load-time-injection.md (225), plugin-creator/shared-code-architecture.md (174), agent-creator/delegation.md (155), agent-creator/flake-triage.md (151), command-creator/review-pr.md (148).

Two of these, disclosure-optimization.md and progressive-disclosure.md, are mid-rewrite by another agent, so their status should be re-checked rather than acted on from this count. Nine further files fall under the threshold and are correctly exempt, the largest being plugin-creator/verification.md at 98.

The ask-user-question skill has the same gap in full. All six of its reference files exceed 100 lines and none carries a table of contents: layout.md (469), examples.md (332), reading-answers.md (177), failed-question.md (157), wording.md (150), asking-again.md (140). Those are the same six files whose recall ANALYSIS-004 measured at 33% to 75%, which makes them the one set where a table-of-contents intervention could be measured against an existing baseline rather than in the abstract.

**Claim: GUIDANCE, published and then not followed.** The rule is Anthropic's own, a table of contents for reference files longer than 100 lines, and it is stated alongside the mechanism that motivates it: when references are nested, the model may preview with a partial read rather than reading whole files, returning incomplete information. A table of contents is what makes a partial read still useful. The vendor states the rule and complies with it nowhere in its largest bundle.

**Detection signature.** Within the first 25 lines of a `.md` file whose length exceeds 100 lines, three or more bullets matching `^\s*[-*] +\[.+\]\(#`. Both halves of the condition are mechanical, which makes this the cheapest rule in the catalog to write and the easiest to defend, since the threshold is the vendor's own.

**Harness.** Disclosure recall under partial reads specifically. The measurement is not whether the file is opened, but whether a truncated read still yields the needed section. That is a variant of the recall harness rather than a new one, and it is not currently instrumented.

## What could not be determined

- **Whether any genre has a measured effect.** Presence is countable for all fourteen. Effect is measured for one, in-step pointer placement, which was run here and refuted. For the other thirteen there is no experiment, in this repository or in the published record. Corrected 2026-08-24: this entry previously read "whether any genre except two is load-bearing" and credited ordered workflow instruction with an external positive result, which the same-day correction withdrew. The catalog is a starting list for experiments, not a set of validated recommendations, and reading a high count as evidence would repeat exactly the error ANALYSIS-004 Finding 17 corrects, where shipped practice was mistaken for a measured constraint.
- **Whether anti-rationalization tables change behaviour at all.** The genre is the most distinctive thing in the survey and the least evidenced. It is also the most testable, because the pack ships fixtures built around time pressure and authority pressure, which is the scenario shape the experiment needs.
- **Why the two exceptions in the pack are exceptions.** The meta-skill and the ideation skill omit the rationalizations table. Whether that is a considered judgement about genre fit or an oversight is not stated anywhere in the repository.
- **Whether a table of contents helps, as opposed to merely being prescribed.** The mechanism is plausible and published, the compliance gap is measured, and the effect is not. The harness variant needed to see it, recall conditioned on partial reads, does not currently exist.
- **Whether Genre 10 beats Genre 11 on form alone.** ANALYSIS-004 tested pointer *position* and found nothing. Nobody has tested pointer *form*, meaning the same pointer in the same place, with and without its firing condition and cost of skipping. That experiment is unrun, and it is the one that would settle whether this repository's own convention earns its place.
- **What the frontmatter genres are, since they are out of scope here.** The description carries its own structures — trigger-and-skip clauses, negative scoping, and an embedded disambiguating command in the claude-api case — and they are measured by the triggering harness rather than by anything in this note. They belong in a separate survey.
- **Whether genres interact.** Every count here treats genres as independent. Whether a numbered workflow makes a trailing manifest better or worse, or whether a gotcha block substitutes for a stop gate, is untested and probably matters more than any single genre's effect.

## Recommendations

The numbers are the priority order, and later items refer back to earlier ones.

1. **Treat the four surviving rules of the proposed standard as candidate standard to validate, and say so wherever they are written down.** A numbered workflow as the organising structure, one level of nesting, gotchas staying in the body, and a table of contents past 100 lines are all defensible, and none has been tested against this repository's own artifacts. Corrected 2026-08-24: none of the four carries a positive measured result either, since rule 1's was withdrawn when its citation was re-opened. Two of their six siblings were refuted within hours of being proposed, which is the first calibration to carry, because a rule that sounds right and has converging support is exactly the kind that failed last time. Rule 1 adds the second calibration: a rule can read as measured for as long as nobody opens the source, so check the citation before you write the standard.
2. **Write the four cheapest lint rules first, and only those, because their signatures are unambiguous.** They are the table-of-contents rule (Genre 14, against the vendor's own published 100-line threshold), the anti-rationalization table (Genre 3, one heading and one header row), the ordered-step contiguity check (Genre 1, ascending integers), and the manifest-form split (Genres 10 and 11, separated by the presence of a conditional clause). Each matches on markdown alone with no judgement, which is the property that makes a lint rule survivable.
3. **Fix this repository's own table-of-contents gap, which Genre 14 enumerates to file and line count.** Twenty-four reference-role files exceed 100 lines and none carries a table of contents, led by schemas.md at 723 lines. Two of the twenty-four are mid-rewrite and should be re-checked rather than acted on from that count. The ask-user-question skill's six references have the same gap and are the better test bed, because ANALYSIS-004 already measured their recall at 33% to 75% and a table-of-contents intervention there has a baseline to move against.
4. **Have every lint rule report presence, never quality, until an experiment says otherwise.** Thirteen of fourteen genres have no measured effect. A rule that says "this reference is over 100 lines and has no table of contents" states a fact. A rule that says "add an anti-rationalization table" states an opinion as a requirement, and the catalog exists partly to keep that line visible. In particular, no rule may cap the number of references a skill bundles, because that cap is refuted (Genre 10).
5. **Measure Genre 3 next, because it is the largest unvalidated claim in the ecosystem and the cheapest to test.** One author ships it in 22 of 24 skills and nobody else ships it at all, which means the ablation is trivial: take those 22, strip the table, and run both versions at the same time against pressure-shaped scenarios on the weaker model.
6. **Do not write pointer placement into any standard, and record the null where the next author will find it** (Genre 12, rule 2 of the proposed standard). The controlled run halved reach. The intuition, the external result and the filesystem-level analogue all pointed the other way, which is exactly why the experiment had to come before the rule, and why an unrecorded null gets re-derived by the next person who finds the intuition persuasive.
7. **Test Genre 10 against Genre 11 on form before defending this repository's convention further.** The firing-condition manifest is shipped in three of the five creator skills here and is unvalidated, and the other two carry no manifest at all, pointing at their references inline in the form the placement experiment refuted, which makes this repository's practice less uniform than the note first reported. The only measurement touching the manifest form, 33% to 75% recall on the ask-user-question references carrying its fullest form, does not support it. Holding position and mention count fixed while varying only the conditional clause is the missing experiment.
8. **Adopt the diagram question rather than the diagram.** The pack uses ASCII flow diagrams in 14 of 24 skills and Anthropic in 2 of 20, with no published reason on either side, and mermaid appears nowhere despite this project's note conventions specifying it. Ablation is mechanical here, since the diagram swaps for prose stating the same sequence, so this is a question to settle rather than a preference to legislate.

## Observations

### The lineage

- [problem] A six-rule standard skill shape was proposed in a predecessor conversation and measurement refuted two of its six rules within hours — pointing every reference from inside the step whose work needs it, and capping a skill at three references #lineage #refuted
- [insight] Both refuted rules were intuitive and carried converging support, since one agreed with an external measured result and with a filesystem-level proximity principle and the other appeared to rest on a published number, and both failed anyway — which is why no genre entry may rest on how many people ship it #lineage #calibration
- [decision] The four surviving rules are recorded as candidate standard to validate rather than as established standard, and corrected 2026-08-24 none of them carries a positive measured result at all — rule 1's was withdrawn when its citation was re-opened, leaving shipped practice, a mechanism, doctrine and published guidance as the four bases #lineage #candidate-standard
- [constraint] Each refuted rule is marked again at the genre entry it touches, so a reader arriving at a genre cannot adopt a refuted rule without meeting its refutation first, and no lint rule over the manifest genre may cap entry count #lineage #guardrail
- [problem] A third rule lost its evidence on 2026-08-24 without ever being refuted: the external result cited for numbered-workflow-as-organising-structure measured an instruction added to a host context file telling the agent to invoke a skill, which is forced invocation from passive context rather than how a body is organised #lineage #evidence-withdrawn
- [insight] Refutation and evidence withdrawal are different failure modes and are kept distinct here, since two rules were tested and failed while one was never tested and had been recorded as though it had been — collapsing them would misstate what is known about rule 1, which is nothing #lineage #distinction
- [constraint] A citation inherited from a sibling note counts as unverified until it is opened in primary text here, because the existing verification rule was aimed at first-time claims and this one survived two notes unchecked, producing a MEASURED label on a genre nobody had measured #lineage #inherited-citation
- [problem] This repository carries 24 reference-role files over 100 lines and none has a table of contents, led by schemas.md at 723 lines and spanning both the shared pool and the per-skill directories, with two of the 24 mid-rewrite and needing re-check rather than action #toc #work-item
- [technique] The ask-user-question skill's six references are the better test bed for a table-of-contents intervention, since all six exceed 100 lines with no table of contents and are the same six whose recall was already measured at 33 to 75 percent, giving the change a baseline to move against #toc #test-bed

### What the primary text says

- [fact] The three claimed genres are verbatim in the pack's own README under Key design choices — process not prose with steps, checkpoints and exit criteria; a table of common excuses with documented counter-arguments; and verification as non-negotiable where seems-right is never sufficient #claims #verified
- [fact] The pack's format specification calls the rationalizations section the most distinctive feature of well-crafted skills and states its purpose as preventing the agent from rationalizing its way out of following the process #anti-rationalization #stated-purpose
- [problem] The claim's universal quantifier is loose in both directions — every skill includes a rationalizations table is 22 of 24, and every skill ends with evidence requirements is 23 of 24 carrying a checkbox #claims #precision
- [insight] This repository's skill-creator publishes the only rationale in the survey for why a class of content must stay inline rather than move behind a pointer — you cannot decide to open a file about a trap you do not know exists #gotchas #disclosure-argument
- [fact] Anthropic publishes the table-of-contents rule for reference files over 100 lines alongside its mechanism, that nested references may be previewed with a partial read rather than read whole #toc #published-rule

### What the counts show

- [fact] Anti-rationalization appears in 22 of the pack's 24 skills with an identical heading and an identical two-column header, and in zero of Anthropic's 20, zero of this repository's 5 creator skills, and zero of the ask-user-question skill #anti-rationalization #single-vendor
- [fact] A loose grep for rationaliz, excuse, seems-right and temptation across all 20 Anthropic skill bodies returns zero matches, so the absence is genuine rather than a wording difference #anti-rationalization #negative-confirmed
- [fact] Verification checkboxes appear in 23 of the pack's 24 skills and in zero of Anthropic's 20, which express evidence requirements as prose requirement blocks instead #verification #form-split
- [problem] Across the claude-api skill's 66 reference files, 48 exceed 100 lines and none carries a table of contents including a 1548-line migration guide, against 5 of 7 compliance in the pack's shared checklists and 0 of 15 in this repository #toc #compliance-gap
- [fact] ASCII flow diagrams appear in 14 of the pack's 24 skills and 2 of Anthropic's 20, and mermaid appears zero times across all four corpora despite being this project's specified diagram form #diagrams #split
- [fact] Ordered numbered steps appear in 16 of the pack's 24, 3 of 5 creator skills here, and 4 of Anthropic's 20 — corrected 2026-08-24 from 5 of 5, since agent-creator and mcp-creator carry zero numbered step headings and are topic-organised #workflow-steps #distribution
- [problem] The Genre 1 repo count was wrong because its stated figure and its example list were written separately — the sentence asserted five while naming three, and folded in a skill from another repository — so a count and the examples supporting it must be generated by the same command #correction #count-drift
- [insight] The detector built from this note's own catalogued signature refuted one of the note's own counts, which is the first evidence that the signatures are precise enough to be run against a corpus rather than merely readable #correction #detector-validates
- [fact] Blocking stop imperatives appear in 9 of the pack's 24 and 5 of Anthropic's 20, and in none of this repository's 5 creator skills #gates #gap
- [fact] Worked good-and-bad specimen pairs appear in 11 of the pack's 24 and 1 of Anthropic's 20 #worked-pairs #split
- [fact] Numbered rules each carrying their own pass check appear in exactly one artifact across all four corpora — the ask-user-question layout reference, with thirteen such rules #rules-with-checks #house-genre
- [fact] Anthropic's largest reference bundle does not use the bare trailing manifest its own documentation illustrates, routing 66 files through roughly twenty bolded condition-to-file entries instead #claude-api #routing-manifest

### What the signatures give

- [technique] A genre whose presence cannot be counted by grep is a genre no lint rule can find, so every count in this survey was taken with an expression that doubles as a candidate detection signature #lint #method
- [technique] The anti-rationalization signature is the cleanest in the catalog because one author's rigid consistency made it so — a single heading pattern plus a fixed two-column header, with no variants to accommodate #lint #signature
- [technique] The two manifest genres are separable by one mechanical test, the presence of a when-or-before clause in the same sentence as the filename, which is what lets a rule distinguish a conditioned pointer from a bare one #lint #manifest-split
- [technique] The table-of-contents rule is the cheapest to write and the easiest to defend because both halves of its condition are mechanical and the 100-line threshold is the vendor's own #lint #toc
- [constraint] Signatures should report presence and never quality, because thirteen of the fourteen genres have no measured effect and a rule prescribing an unvalidated genre states an opinion as a requirement #lint #scope

### What remains unmeasured

- [insight] Presence is countable for all fourteen genres and effect is measured for exactly one, corrected 2026-08-24 from two, so the catalog is a starting list for experiments rather than a set of validated recommendations — and the single measured genre came back refuted #measured-effect #honesty
- [outcome] Corrected 2026-08-24 — ordered workflow instruction carries no external measured support after all: the evaluation cited for it moved invocation by adding an instruction to a host context file telling the agent to invoke a skill, so it measures forced invocation from passive context rather than body organisation, and the genre drops to shipped practice on its counts alone #workflow-steps #evidence-withdrawn
- [outcome] In-step pointer placement is the one genre measured in this repository and it was refuted in its actionable form — reach halved, 8 of 40 trailing against 4 of 40 in-step, p approximately 0.20 — so the entry exists to stop the genre being re-derived from its intuitive appeal #placement #refuted
- [risk] The firing-condition manifest is this repository's own convention, shipped in 3 of 5 creator skills — corrected 2026-08-24 from all 5 — has no published basis and no vendor analogue, and the only measurement touching it recorded 33 to 75 percent recall on the references carrying its fullest form #house-convention #unvalidated
- [problem] plugin-creator and skill-creator carry no reference manifest at all and point at their bundled files inline instead, 11 and 21 mentions, which is the in-step pointer form this repository's own controlled run refuted — so two of five creator skills use exclusively the form measurement did not support #house-convention #refuted-form
- [problem] Nobody has tested pointer form as opposed to pointer position — the same pointer in the same place with and without its firing condition and cost of skipping — which is the experiment that would settle whether the house convention earns its place #open #form-experiment
- [risk] Reading a high shipped count as evidence of value would repeat the category error a sibling finding already corrects, where a measured figure about whole skills attached to a task was mistaken for a constraint on files bundled inside one #shipped-practice #category-error
- [constraint] Every experiment proposed here must run on the weaker model, since the strong model reaches nearly everything eagerly and hides the signposting defect the measurement exists to detect #instrument #model-tier
- [problem] Every count treats genres as independent, so whether a numbered workflow changes what a trailing manifest achieves, or whether a front-loaded gotcha block substitutes for a stop gate, is untested and may matter more than any single genre in isolation #interaction #open

## Relations

<!-- The note of record carries no inverse edge back to this edition, by owner instruction. -->

- pairs_with [[ANALYSIS-005: Structural Genres of Skill Content]]
- relates_to [[SESSION-2026-08-23_01: Plugin Kit Measurement Tooling Hardening]]
