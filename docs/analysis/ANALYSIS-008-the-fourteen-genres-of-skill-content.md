---
title: "ANALYSIS-008: The Fourteen Genres of Skill Content"
type: analysis
status: DRAFT
permalink: analysis/analysis-008-the-fourteen-genres-of-skill-content
tags:
- skills
- structure
- lint
- vendor-survey
- readable-edition
---

# ANALYSIS-008: The Fourteen Genres of Skill Content

The readable rebuild of ANALYSIS-005: Structural Genres of Skill Content, content-parity as of 2026-08-24. The original remains the note of record. Every count here was taken by grep over primary text on 2026-08-24, and none was estimated.

## Summary

Skill files are built from a small number of recurring structures, and almost none of them has been shown to work.

This note names fourteen such structures and calls each one a genre. It counts every genre across four collections of skill files. It then asks, for each, what evidence exists that the structure does anything.

1. Fourteen genres can be counted mechanically, one has ever been tested for effect, and that test failed. Findings 5 and 12 carry this.
2. Three structures claimed as common practice are real, and one of them is used by a single author. Findings 1 and 2 carry this.
3. Anthropic publishes a rule about long reference files and breaks it in its own largest bundle. Finding 3 carries this.
4. An earlier attempt at a standard skill shape lost two of its six rules to measurement and a third to an unchecked citation. Finding 4 carries this.
5. The convention this repository ships most widely is untested, and the one measurement near it is discouraging. Finding 6 carries this.
6. The practical output is a short list of checks that a linter can run today, because their patterns are unambiguous. Recommendation 2 carries this.

Four dated corrections apply, at eleven sites — see Corrections.

## Recommendations

1. **Record the four surviving rules of the earlier standard as candidates to validate.** They are a numbered workflow as the organising structure, one level of nesting, gotchas staying in the body, and a table of contents past 100 lines (Finding 4). Corrected 2026-08-24: none of the four carries a positive measured result, rule 1's having been withdrawn when its citation was re-opened. Cost: this leaves the repository with no settled shape to teach, which is the honest position rather than a comfortable one.
2. **Write the four cheapest checks first, because their patterns are unambiguous.** Two of them are the table-of-contents check (Genre 14, against the vendor's own 100-line threshold) and the excuse-table check (Genre 3, one heading and one header row). The other two are the step-contiguity check (Genre 1, ascending integers) and the manifest-form split (Genres 10 and 11, separated by a conditional clause). Cost: each reports presence only, so none of them tells you whether the structure helps.
3. **Close this repository's table-of-contents gap, which Genre 14 enumerates to file and line count.** Twenty-four reference-role files exceeded 100 lines with none carrying a table of contents, led by schemas.md at 723 lines. Two of the twenty-four were mid-rewrite and wanted re-checking rather than action. Limit: Method records a same-day re-check finding this largely done, and finding that the ask-user-question files are no longer available as a test bed.
4. **Have every check report presence, and leave quality to an experiment.** Thirteen of fourteen genres have no measured effect (Finding 5). A check saying "this file is over 100 lines and has no table of contents" states a fact, where one saying "add an excuse table" states an opinion as a requirement. Limit: a check over the manifest genre should report entry count as a fact only, because the cap on entries is refuted (Genre 10).
5. **Measure Genre 3 next, because it is the largest unvalidated claim here and the cheapest to test.** One author ships it in 22 of 24 skills and nobody else ships it at all. The ablation is therefore trivial: take those 22, remove the table, and run both versions together against pressure-shaped scenarios on the weaker model. Cost: it needs a purpose-built scenario set, since ordinary tasks give the agent no reason to skip a step.
6. **Keep pointer placement out of any standard, and record the null where the next author will find it.** The controlled run halved reach (Genre 12, Finding 5). Cost: none. The reason to spend words on it is that the intuition, the external result and the filesystem analogue all pointed the other way. An unrecorded null gets re-derived by the next person who finds the intuition persuasive.
7. **Test Genre 10 against Genre 11 on form before defending this repository's convention further.** Hold position and mention count fixed, and vary only the conditional clause. The manifest ships in three of five creator skills here, the other two carry none, and the only measurement near it recorded 33% to 75% recall (Finding 6). Cost: one more controlled run on the weaker model, on a question no vendor has asked.
8. **Settle the diagram question rather than legislating a preference.** One author uses ASCII diagrams in 14 of 24 skills and Anthropic in 2 of 20, with no published reason either way, and mermaid appears nowhere despite this project's conventions specifying it (Genre 8). Cost: low, because the ablation is mechanical — a diagram swaps for prose stating the same sequence.

## Table of Contents

1. Summary — the headline results, and a pointer to the corrections.
2. Recommendations — what to do, each with its cost or limit.
3. Table of Contents — this list.
4. How to read the findings — the two repeated shapes, and the label vocabulary.
5. Findings 1 to 6: what the survey establishes — the six results in full.
6. Genres 1 to 14: the catalog of shapes — the lookup layer, one uniform entry per genre.
7. Method — corpora, instruments, the verification rule, and a same-day re-check of the table-of-contents gap, placed here because it is a re-measurement rather than a correction to the record.
8. Corrections — the four dated corrections and the eleven sites they touch.
9. Open questions — what stays unknown, and what would close each one.
10. Glossary — terms, the words this note avoids, and flagged ambiguities.
11. Observations — the graph layer.
12. Relations — the graph edges.

Two notes for an agent reading this file. Finding numbers and genre numbers are stable identifiers, and each claim's full statement lives under its own numbered entry rather than being spread across the note. Fenced blocks are quoted specimens, so a heading inside a fence belongs to the quoted material and never to this note.

## How to read the findings

This note repeats two shapes. Learn each once and every entry parses the same way.

**The finding shape**, used by Findings 1 to 6.

- **In short.** The finding standing alone, in one or two sentences.
- **Labels.** A token list and nothing else.
- **Evidence.** Figures, quotations and sources.
- **Limits.** What the finding does not establish. Conditional.
- **What this changes here.** The consequence for this repository.

**The genre-entry shape**, used by Genres 1 to 14.

- **In short.** The structure, and what separates it from its neighbours.
- **What it looks like.** A quoted specimen from a named file.
- **Labels.** A token list and nothing else.
- **Evidence.** Who ships it, counted per corpus, then the basis for the label.
- **Limits.** Corrections and refuted rules touching this genre. Conditional.
- **Detection signature.** The pattern a check would match on.
- **Harness.** The measurement that could see the genre's effect.

**A conditional marker appears only where its content exists.** Limits is the only conditional marker in either shape. Its absence means no correction and no refuted rule touches that entry, so absence carries information.

**The label vocabulary is closed.** Tokens are capitals, multiword tokens use spaces, and a middle dot separates them.

- MEASURED · GUIDANCE · SHIPPED PRACTICE — the three evidence labels, one per genre.
- REFUTED — tested and failed.
- EVIDENCE WITHDRAWN — never tested, and the cited support measured something else.
- SURVIVES — a proposed rule that nothing has refuted.
- CORRECTED 2026-08-24 — a dated correction touches this entry.

**Lookup and explanation are separate.** In short, What it looks like, Labels, Detection signature and Harness are lookup. Evidence, Limits and What this changes here are explanation. Read the first set to find something and the second set to understand why it carries the label it does.

**Cross-note citations are bare text**, in the form ANALYSIS-004 Finding 17. Genre numbers match the note of record and its sibling notes, so one citation resolves in both.

**One quoted specimen mints a graph edge, and the edge is an artifact.** The indexer reads markdown link syntax as a relation even inside a code fence. Genre 14's specimen quotes two anchor bullets, and their fragment-only targets resolve to the current document, so this note carries an edge to itself. That edge is a by-product of quoting faithfully rather than a link this note makes. Fidelity outranks tidiness, so the quoted characters stay exactly as they are. The Relations section is the authority on what this note links to.

## Findings 1 to 6: what the survey establishes

### Finding 1: Two of three claimed genres belong to one author

**In short.** A pack of 24 skills is described as shipping process over prose, excuse tables and non-negotiable verification. All three are real in its text. Two are almost unique to it.

**Labels.** SHIPPED PRACTICE · GUIDANCE

**Evidence.** The claim source is the pack's own README, under "Key design choices". Excuse tables appear in 22 of the pack's 24 skills, in a mechanically identical form. They appear in zero of Anthropic's 20 published skills. The absence is genuine rather than a wording difference: a loose grep for rationaliz, excuse, "seems right" and temptation returns nothing across all 20 bodies. Genre 3 carries the counts and the specimen.

**What this changes here.** A structure that reads as an industry norm is one author's house convention. Adopting it because it looks widespread would be adopting it on a miscount.

### Finding 2: The claim says every and means almost every

**In short.** Two universal claims about the pack are close to true and not true. The gap is small, and stating it precisely is the point.

**Labels.** SHIPPED PRACTICE

**Evidence.** "Every skill includes a table" is 22 of 24. "Every skill ends with evidence requirements" is 23 of 24 carrying a verification checkbox. Both shapes genuinely dominate that pack. Both are absent from the vendor's corpus, where 0 of 20 skills carry a single `- [ ]`. Genres 3 and 4 carry these counts.

**Limits.** The two exceptions in each case are named but unexplained, and the pack states no reason for them. Open questions carries that.

**What this changes here.** A count is the unit that survives scrutiny, and a universal quantifier is not. Every figure in this note is a count for that reason.

### Finding 3: Anthropic breaks its own rule on long reference files

**In short.** The vendor publishes a rule requiring a table of contents on any reference file over 100 lines, and does not follow it in its own largest bundle.

**Labels.** GUIDANCE

**Evidence.** The claude-api skill has 66 reference files. Of those, 48 exceed 100 lines and none carries a table of contents, the largest being a 1548-line migration guide. The pack complies in 5 of 7 shared checklists. This repository complied in 0 of 15 shared references, and in 0 of 24 counting every reference-role file over the threshold. Genre 14 enumerates all of these to file and line count.

**Limits.** The rule's effect is unmeasured. What is measured is compliance, which is a different thing, and Open questions keeps them apart.

**What this changes here.** This is the cheapest check in the catalog to write and the easiest to defend, because the threshold is the vendor's own. Recommendation 2 puts it first, and Method records a same-day re-check of the repository's own gap.

### Finding 4: Two of six rules refuted, a third lost its evidence

**In short.** A six-rule standard skill shape was proposed once. Measurement refuted two of its rules within hours. A third later lost its only support when someone opened the source it cited.

**Labels.** REFUTED · EVIDENCE WITHDRAWN · SURVIVES · CORRECTED 2026-08-24

**Evidence.** Rule 2, pointing to every reference from inside the step that needs it, was refuted by a controlled run. Rule 4, capping a skill at three references, was refuted as a category error. Rule 1, a numbered workflow as the organising structure, lost its evidence on 2026-08-24. Rules 3, 5 and 6 survive. Corrected 2026-08-24: this finding once continued "since only the first has a positive measured result and that result is external", and after that result was re-opened, none of the four survivors has a positive measured result. Rule 1 now rests on shipped practice, rule 3 on a mechanism, rule 5 on doctrine, and rule 6 on published guidance. Genre 12 carries rule 2's refutation and Genre 10 carries rule 4's.

**Limits.** Refutation and evidence withdrawal are different, and collapsing them would misstate what is known about rule 1, which is nothing. Two rules were tested and failed. One was never tested while being recorded as though it had been.

**What this changes here.** Two lessons follow, and they shape the whole note. A rule that sounds right and has converging support is exactly the kind that failed last time, because both refuted rules were intuitive and both had support pointing their way. And a citation carried across from another note stays unverified until someone opens it here, because this one survived two notes unchecked and produced a MEASURED label on a genre nobody had measured. Method states that as a standing rule.

### Finding 5: One genre was measured, and it failed

**In short.** Presence is countable for all fourteen genres. Effect is measured for exactly one. That one came back refuted.

**Labels.** MEASURED · REFUTED · CORRECTED 2026-08-24

**Evidence.** In-step pointer placement was run in this repository and refuted: moving a pointer into the step that needs it halved its reach, 8/40 against 4/40, p approximately 0.20 (Genre 12). Corrected 2026-08-24: this finding once read "effect is measured for two" and credited ordered workflow steps with external support from Vercel's evaluation. Re-opened in primary text, that evaluation added an instruction to AGENTS.md telling the agent to invoke a skill, so it measures forced invocation from passive context rather than how a body is organised. Genre 1 carries the quotations and the figure corrections that travel with them.

**Limits.** The refuted result is a trend against the hypothesis rather than a clean negative, since p is approximately 0.20. The honest reading is no detectable effect.

**What this changes here.** Thirteen of fourteen genres have no measured effect, and the fourteenth did not survive being measured. The catalog is a starting list for experiments, not a set of validated recommendations. Reading a high count as evidence would repeat the error ANALYSIS-004 Finding 17 corrects.

### Finding 6: This repository's own convention is untested

**In short.** The structure this repository ships most deliberately has no published basis, no analogue at any vendor, and one nearby measurement that does not support it.

**Labels.** SHIPPED PRACTICE · CORRECTED 2026-08-24

**Evidence.** The firing-condition manifest is a pointer saying when it fires and what skipping it costs. It appears in 3 of the 5 plugin-kit creator skills, and throughout the ask-user-question skill. ANALYSIS-004 found no published basis and, after a survey of eight vendors, no analogue. It measured those exact pointers at 75%, 60% and 33% recall on sonnet. Corrected 2026-08-24: the count here once read all 5, and the two skills removed from it carry no manifest at all, pointing at their references inline in the form measurement refuted. Genre 10 carries this in full.

**Limits.** The measurement tested pointer position, not pointer form. Nobody has run the same pointer in the same place with and without its conditional clause, so the convention is unsupported rather than disproved.

**What this changes here.** This is the most important honesty point in the note, because the genre is this repository's own and its ubiquity here reads easily as evidence. Recommendation 7 names the missing experiment.

## Genres 1 to 14: the catalog of shapes

Every entry uses the genre-entry shape declared in How to read the findings. Specimens are quoted from the file named beside them, under the fidelity rule stated in Method.

### Genre 1: Ordered workflow steps

**In short.** A body organised as numbered headings, or a numbered top-level list, where each step names an action rather than a topic. The reader is told to be at a position, not offered material that might be relevant.

**What it looks like.** From the pack's debugging-and-error-recovery and test-driven-development skills:

```text
### Step 1: Reproduce
### Step 1: RED — Write a Failing Test
```

**Labels.** SHIPPED PRACTICE · CORRECTED 2026-08-24

**Evidence.** The pack: 16 of 24 carry numbered step or phase headings on the strict measure, and 18 of 24 carry a Process, Workflow, Cycle or Steps section on the loose measure. Anthropic: 4 of 20 clearly, led by mcp-builder with 17 numbered subsections and doc-coauthoring with 14. This repository: 3 of 5 on the strict measure, where plugin-creator runs Phase 1 through Phase 8, command-creator numbers 1 through 6, and skill-creator numbers Step 1 through Step 5. On the loose measure this repository is 1 of 5, though that grep is tuned to the pack's diction and does not transfer cleanly. The ask-user-question skill numbers 1 through 7, counted separately because it is a different repository. The counts stand as counted, and a count establishes that people ship the genre and nothing more.

**Limits.** Two corrections land here, and one boundary of the signature is worth stating.

*Correction A, 2026-08-24, the count.* This line once read 5 of 5, and the detector built from this genre's own signature refuted it. agent-creator and mcp-creator carry zero numbered step headings, both organised by topic under descriptive imperative headings. agent-creator's only numbered list is four interview questions inside its capture-intent section, which is a question list rather than an organising structure. Two things went wrong. The stated count and the named examples disagreed, because the sentence asserted five while naming three, and nobody caught it because the examples read plausibly. And the ask-user-question skill was folded into a set of plugin-kit creator skills it does not belong to, padding the numerator on top of the overcount. The lesson: generate a count and its example list from the same command, or they drift apart silently.

*Correction D, 2026-08-24, the label.* This entry once read MEASURED, external, and the citation carrying that label does not support it. The entry said Vercel's agents-md evaluation moved invocation from 44% to 95% and pass rate from 53% to 79%. It credited that to "giving an explicit ordered workflow instruction rather than making the capability conditionally available", and called it the strongest external evidence for any genre here. Re-opened in primary text, the manipulation was an instruction added to AGENTS.md telling the agent to invoke a skill. Verbatim: "We tried adding explicit instructions to AGENTS.md telling the agent to use the skill". The example given was "Before writing code, first explore the project structure, then invoke the nextjs-doc skill for documentation." That is forced invocation at the host-prompt level, authored in always-loaded passive context outside the skill. It measures whether a skill fires at all, not how a body is organised. Two figure corrections travel with it. The published trigger figures are 56% never-invoked, so the 44% is a complement this repository computed rather than a number the post states. And the post gives "95%+" rather than 95% flat. This genre therefore has no external measured support. The quotations are held in ANALYSIS-006 Finding 21, and the mechanism they bear on is ANALYSIS-006 Finding 11, the absence of any `tool_choice` analogue for skills.

*A boundary of the signature, not a defect in it.* The two skills scoring zero arguably do have an organising order, carried by descriptive headings in a deliberate sequence. A mechanical detector sees only an explicit one, which is the honest limit of what this genre can be checked for.

**Detection signature.** Three or more headings matching `^#{2,4}\s*(Step|Phase)\s*\d+` or `^#{2,4}\s*\d+\.\s`, with the integers ascending and contiguous. A gap or a repeat is itself a finding.

**Harness.** Outcome pass rate. Take one skill organised by topic, rewrite the same content as numbered steps changing no substantive guidance, and run both versions together against the same scenarios. This genre is now wholly untested, so that experiment is the only thing that could settle it.

### Genre 2: Blocking checkpoint or stop gate

**In short.** An imperative inside a workflow forbidding progress past a point until a condition holds. It differs from a step because its content is a refusal rather than an action.

**What it looks like.** From the pack's using-agent-skills meta-skill:

```text
1. **STOP.** Do not proceed with a guess.
2. Name the specific confusion.
```

**Labels.** SHIPPED PRACTICE

**Evidence.** The pack: 9 of 24. Anthropic: 5 of 20, and the clearest is claude-api's instruction to stop and ask the user before editing a file carrying another provider's markers. This repository: 0 of 5 creator skills carry an explicit stop imperative, which is a gap worth noticing given how much the build protocol elsewhere relies on gates. No vendor publishes evidence that a stop imperative changes behaviour, and none measures compliance with one.

**Detection signature.** A line matching `\*\*STOP|[Dd]o not proceed|[Bb]efore proceeding|blocking` inside a numbered step block, or within three lines of a step heading. The proximity requirement separates a gate from prose that happens to contain the word.

**Harness.** Outcome pass rate, on scenarios built so the only way to pass is to have stopped. The correct answer has to be a question rather than an artifact.

### Genre 3: Anti-rationalization table

**In short.** A two-column table whose left column quotes an excuse in the agent's own voice and whose right column rebuts it factually. It is a pre-emptive counter-argument, placed where the temptation lives.

**What it looks like.** From the pack's debugging-and-error-recovery skill:

```text
## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "I know what the bug is, I'll just fix it" | You might be right 70% of the time. The other 30% costs hours. Reproduce first. |
```

**Labels.** GUIDANCE

**Evidence.** The pack: 22 of 24, and the form is mechanically identical every time, with the heading and the two-column header row shown above appearing without variation. The two exceptions are idea-refine and the using-agent-skills meta-skill. Anthropic: 0 of 20, confirmed twice, since there is no such heading and no match for rationaliz, excuse, "seems right" or temptation in the 20 bodies. This repository: 0 of 5. The ask-user-question skill: 0. The pack asserts the value plainly. It calls the section "the most distinctive feature of well-crafted skills". It says the tables "prevent the agent from rationalizing its way out of following the process." No published experiment measures whether a rebutted excuse is acted on less often.

**Detection signature.** A heading matching `rationaliz` followed within five lines by a table whose header row's first cell matches `Rationaliz|Excuse|Objection`, with exactly two columns and three or more body rows. This is the cleanest signature in the catalog, because one author's rigid consistency made it so.

**Harness.** Outcome pass rate, needing a purpose-built scenario set: cases presenting a plausible reason to skip a step, such as time pressure, apparent triviality, or an authority instruction. The pack ships fixtures of exactly this shape, a time-pressure file and an authority-pressure file, which is the closest thing to an evaluation design anyone has published for it.

### Genre 4: Verification-evidence requirement

**In short.** A closing section listing exit criteria as checkboxes, where each item demands an artifact — a passing suite, a build output, a screenshot — rather than a judgement.

**What it looks like.** From the pack's test-driven-development skill:

```text
## Verification

- [ ] Every new behavior has a corresponding test
- [ ] Bug fixes include a reproduction test that failed before the fix
```

**Labels.** GUIDANCE

**Evidence.** The pack: 23 of 24 carry at least one `- [ ]`, and 24 of 24 carry a verification-flavoured heading. Anthropic: 0 of 20 carry a single `- [ ]`. This repository: plugin-creator carries 13 checkboxes, and the other four express the same intent as a numbered pre-flight list. The ask-user-question skill does the same, with 14 numbered items. The pack's assertion is unambiguous: verification "is non-negotiable", every skill "ends with evidence requirements", and "'Seems right' is never sufficient." Nothing measures whether the checkbox form produces more evidence than a prose instruction to verify.

Worth recording as a distinction rather than a defect: Anthropic's corpus does demand evidence and simply does not use checkboxes. The xlsx skill's requirements block is the clearest case, and it carries a sharper caveat than most checklists manage. A clean recalculation proves formulas evaluate, not that they are right, because an off-by-one range yields an error-free file with wrong numbers. No checkbox in the surveyed corpus says anything as useful.

**Detection signature.** Three or more consecutive `^\s*- \[ \]` lines under a heading matching `[Vv]erif|[Cc]hecklist|[Ee]vidence|[Pp]re-flight`, or the same run as a numbered list under a pre-flight heading. Grading whether items demand artifacts rather than judgements is not mechanical, and a check should leave it alone.

**Harness.** Outcome pass rate, with the transcript inspected for whether the evidence was actually produced. The interesting failure is a run ticking the boxes without generating what they name.

### Genre 5: Front-loaded gotcha inventory

**In short.** A block of counter-intuitive facts, each a bolded lead followed by its consequence, placed before the workflow. Its defining property: a reader who does not know the trap exists cannot decide to open a file about it.

**What it looks like.** From this repository's mcp-creator skill:

```text
## Gotchas

- **A plugin's tool names carry an infix**: `mcp__plugin_<plugin>_<server>__<tool>`,
  not `mcp__<server>__<tool>`. A grant copied out of the server's own README is
  valid, matches nothing, and prompts for permission every time instead of erroring.
```

**Labels.** SHIPPED PRACTICE · CORRECTED 2026-08-24

**Evidence.** The pack: the Red Flags section in 23 of 24 is the closest analogue, and it sits at the end, inverting the placement that defines this genre. Anthropic: present under other names in docx, xlsx and claude-api, where a drift table warns that the model's training prior may be stale. This repository: 5 of 5, verified, all five carrying a Gotchas H2 within the first 25% of the body, between 10% and 23% in. It is the first section in three of them — mcp-creator, plugin-creator and skill-creator. In agent-creator and command-creator it is the third and second H2, still front-loaded but not opening the body. The headings name the failure class: the failures that say nothing, the failures that render cleanly and are still wrong, and the silent failures that only happen inside a plugin. The ask-user-question skill: present, before step 1.

The label carries an unusually good rationale, published in this repository's own skill-creator body. These facts sit inline rather than behind a pointer because you cannot decide to open a file about a trap you do not know exists. That is a progressive-disclosure argument, and it is the only published statement in the survey explaining why a class of content must not be moved out of a body.

**Limits.** *Correction B, 2026-08-24, the placement count.* This entry once read "first section in four of them". The correction to three was made during the same sweep that corrected Genres 1 and 10.

**Detection signature.** A heading matching `[Gg]otcha|[Pp]itfall|[Dd]rift|silent` occurring within the first 25% of the body's lines, whose immediate content is three or more `^- \*\*` bullets.

**Harness.** Outcome pass rate, on scenarios whose only failure mode is the trap. Disclosure recall is the wrong instrument and would mislead, since the whole claim is that this content must never sit behind a pointer.

### Genre 6: Diagnosis table

**In short.** A table mapping an observed symptom to a cause, or to the section repairing it. It is usually the entry point to a set of repair procedures.

**What it looks like.** From the ask-user-question skill's failed-question reference:

```text
| What the reader said | Look first at |
|---|---|
| `I do not understand`, `what is this about`, `where are you` | Mode 1 |
| `both of these seem the same`, `what is the difference` | Mode 2 |
```

**Labels.** SHIPPED PRACTICE

**Evidence.** The pack: debugging-and-error-recovery carries the genre in its five-step triage. Anthropic: claude-api's drift table maps a stale prior to the current API, the same shape with training data as the symptom. This repository: plugin-creator's diagnostics section carries three rows, keyed on a component not loading, paths not resolving, and a rejected manifest. The ask-user-question skill: the failed-question reference opens with a table mapping what the reader said onto which of seven failure modes was hit, each mode then carrying its own repair.

**Detection signature.** A table of two or three columns with three or more body rows, whose first-column header matches `[Ss]ymptom|[Cc]heck|[Ee]rror|[Pp]roblem|[Ww]hat .* said|[Ss]tale`, and whose right column holds either a pointer or an imperative.

**Harness.** Outcome pass rate on repair scenarios: present a broken artifact and grade the repair. The interesting measurement is whether the table routes correctly, since the ask-user-question reference notes that the modes want opposite fixes and that the repair for one makes another worse.

### Genre 7: Decision or routing table

**In short.** A table whose left column is a condition and whose right column is the approach, tool or file to use. It routes forward from an intent, where a diagnosis table routes backward from a symptom.

**What it looks like.** From Anthropic's docx skill, in its opening lines:

```text
| Task | Approach |
|---|---|
| **Create** a new document | Write a `docx` (npm) script — see gotchas below |
| **Read** content | `pandoc -t markdown file.docx` |
```

**Labels.** SHIPPED PRACTICE

**Evidence.** The pack: common inside bodies, including a test-size table and a tool-to-purpose table. Anthropic: 4 of 20 place one within the first 45 lines, since docx, xlsx, pptx and claude-api all open with a task-to-approach table, and claude-api also carries a subcommand dispatch table. The ask-user-question skill: the examples file closes with a table choosing between the three call shapes by what the decision costs.

**Detection signature.** A table with two or three columns whose first-column header matches `Task|When|If|Case|Subcommand|Size|Job`, and whose second column's cells mostly hold imperatives, file paths or backticked identifiers.

**Harness.** Outcome pass rate, or disclosure recall where the right column names files. A routing table naming files is a manifest in table form, and can be measured as one.

### Genre 8: ASCII flow or pipeline diagram

**In short.** A fenced or indented block using box-drawing and arrow characters to show a sequence, a decision tree or a proportion.

**What it looks like.** From the pack's test-driven-development skill:

```text
    RED                GREEN              REFACTOR
 Write a test    Write minimal code    Clean up the
 that fails  ──→  to make it pass  ──→  implementation  ──→  (repeat)
```

**Labels.** SHIPPED PRACTICE

**Evidence.** The pack: 14 of 24, and they carry real load, including the red-green-refactor cycle above, the bug-reproduction pipeline, the test pyramid with its 80/15/5 proportions, and a decision guide branching on whether logic crosses a boundary. Anthropic: 2 of 20, one being webapp-testing's decision tree. This repository: 0 of 5. The ask-user-question skill: 0. Mermaid appears zero times in all four corpora, despite being the diagram form this project's own note conventions specify. The 14-against-2 split is the finding, and neither side publishes a reason.

**Detection signature.** A fenced or indented block containing three or more of `┌ └ ├ │ ▶ ▼ ╱ ──`, or three or more lines matching `^\s*[|├└]`. Mermaid is the simpler separate case of a fence whose info string is `mermaid`.

**Harness.** Outcome pass rate, via ablation: replace the diagram with prose stating the same sequence and run both versions together. This is the cheapest genre here to test, because the substitution is mechanical and the content is unchanged.

### Genre 9: Worked before-and-after pair

**In short.** Two adjacent specimens of the same artifact, one labelled wrong and one labelled right, where the difference between them carries the instruction.

**What it looks like.** From the pack's test-driven-development skill:

```text
// Good: Tests what the function does (state-based)
it('returns tasks sorted by creation date, newest first', async () => {

// Bad: Tests how the function works internally (interaction-based)
it('calls db.query with ORDER BY created_at DESC', async () => {
```

**Labels.** SHIPPED PRACTICE

**Evidence.** The pack: 11 of 24, densest in test-driven-development, which pairs state-based against interaction-based assertions, DAMP against over-DRY setup, and descriptive against vague test names. Anthropic: 1 of 20, webapp-testing's single do-and-don't pair on waiting for network idle. The ask-user-question skill: the wording reference carries a worked-rewrites section, and the examples file carries the fullest instance in the survey — a call that failed five times, diagnosed worst problem first, with its repair.

**Detection signature.** Two fenced blocks separated by fewer than four lines, each preceded within two lines by a marker matching `Good|Bad|Before|After|✅|❌|Don't|Do:`, or the same markers as comment leads on the first line inside each fence.

**Harness.** Outcome pass rate graded on output quality rather than task completion, since the genre's claim is about the shape of what gets produced.

### Genre 10: Firing-condition reference manifest

**In short.** A pointer block where each entry names a file and the condition for opening it, often with the cost of not opening it.

**What it looks like.** From this repository's agent-creator skill:

```text
## Bundled files, and when each one fires

- `references/agent-frontmatter.md` — **when setting a field beyond `name`,
  `description` and `tools`; when a field you set did nothing; before granting `Task`.**
```

**Labels.** SHIPPED PRACTICE · CORRECTED 2026-08-24 · REFUTED

**Evidence.** Anthropic: claude-api's quick task reference is the largest instance anywhere, roughly twenty condition-to-file routes covering 66 reference files, each phrased as a bolded situation followed by which file to read. This repository: 3 of 5. agent-creator and command-creator use the heading shown above with conditions in bold, and mcp-creator uses "Bundled files" with the condition in each entry's prose. The ask-user-question skill body: three references each get a prose section carrying a firing condition and an explicit cost of skipping. One of those states that skipping the reply reference is how a skip gets read as agreement, which costs a wrong action rather than a wrong sentence.

The label says specifically not validated. ANALYSIS-004 found the file-plus-firing-condition-plus-cost-of-skipping rule has no published basis and, after a survey of eight vendors, no analogue either. It also measured these exact pointers on the ask-user-question skill: 75%, 60% and 33% recall on sonnet for the three references carrying the fullest form. Shipping the genre did not make them reliably reached. That is the most important honesty point in this catalog, because the genre is this repository's own convention and its ubiquity here reads easily as evidence.

**Limits.** One correction and one refuted rule land here.

*Correction C, 2026-08-24, the count.* This line once read 5 of 5. It was found by sweeping the other repository counts after the Genre 1 correction, rather than by the detector, which does not cover this genre yet. plugin-creator and skill-creator carry no manifest section at all. They point at their references inline instead, with 11 and 21 inline mentions, which is Genre 12 — the in-step pointer form this repository's own controlled run refuted. That makes the correction substantive rather than arithmetic: two of the five creator skills use only the pointer form measurement did not support, and the note previously reported them as using the manifest form. Whether that is deliberate or drift is not established here.

*The cap on entries is refuted, and belongs nowhere in this catalog.* Rule 4 of the earlier standard said at most three references per skill. It was a category error: the three-module figure counts whole skills attached to one task, not files bundled inside one, and no vendor states a count cap anywhere. Anthropic's skill-creator calls bundled resources unlimited, and its own claude-api skill routes 66 of them through a single manifest of this genre. The constraint that binds is depth, bounded at one, rather than the number of files. A check here may confirm that each entry carries a firing condition, and should report entry count as a fact only.

**Detection signature.** A pointer line holding a filename or path and, in the same sentence, a subordinate clause opening with `when|before|while|open it`. That clause is what separates this genre from Genre 11.

**Harness.** Disclosure recall, reported as reached over should-have-reached and never as raw pull rate. This is the genre recall was built for, and the denominator can now be derived by ablation rather than hand-annotated, per ANALYSIS-004 Finding 18.

### Genre 11: Bare trailing reference manifest

**In short.** A closing section listing bundled files as a label and a filename, with no condition and no cost.

**What it looks like.** From Anthropic's webapp-testing skill, at the end of the body:

```text
## Reference Files

- **examples/** - Examples showing common patterns:
  - `element_discovery.py` - Discovering buttons, links, and inputs on a page
```

**Labels.** SHIPPED PRACTICE

**Evidence.** The pack: test-driven-development closes with a see-also pointing at a shared checklist. Anthropic: webapp-testing closes with the block above, skill-creator closes with one, and the published best-practices page's canonical good example of correct nesting depth is a block of four such lines. ANALYSIS-004 Finding 7 records that this form measured worst in the recall table, at 33% to 75% on sonnet.

**Limits.** The measurement carries a confound, stated honestly in the source: mention count and placement vary together, and the controlled placement experiment came back null and trending the other way. The form is the vendor's own canonical illustration, offered to demonstrate nesting depth rather than pointer quality, because placement is not treated as a variable anywhere in the published record.

**Detection signature.** A heading matching `[Rr]eference|[Ss]ee [Aa]lso|[Bb]undled|[Ff]urther` in the last 15% of the body, whose content is a bullet list of two or more filenames where no bullet holds a `when|before|while` clause. That negative condition makes it separable from Genre 10.

**Harness.** Disclosure recall, ideally as an ablation against Genre 10 over the same file set. That is the controlled experiment neither this repository nor any vendor has run on manifest form, as opposed to manifest position.

### Genre 12: Inline in-step pointer

**In short.** A reference to a file or a sibling skill placed inside a numbered workflow step rather than in a manifest. This is the one genre anyone has measured, and the measurement refuted it.

**What it looks like.** From Anthropic's internal-comms skill, where step 2 of three is entirely a load instruction:

```text
1. **Identify the communication type** from the request
2. **Load the appropriate guideline file** from the `examples/` directory:
    - `examples/3p-updates.md` - For Progress/Plans/Problems team updates
```

**Labels.** MEASURED · REFUTED

**Evidence.** The pack: test-driven-development points at a sibling skill from inside its browser-testing section. Anthropic: internal-comms is the purest case, shown above, and claude-api's subcommand table tells the model to read a named guide immediately and not to summarise it.

**Limits.** This genre is rule 2 of the earlier standard, and one of the two rules measurement refuted. Do not adopt it as a rule. ANALYSIS-004 Finding 4 moved a single trailing pointer into the workflow step where its condition fires. It held mention count at one, so placement was isolated from surface area, and re-measured at 40 attempts on each version on sonnet. Reach halved: 8/40 trailing against 4/40 in-step, p approximately 0.20. The honest reading is no detectable effect, with a trend against the hypothesis. The correlation, the external Vercel result and the filesystem-level proximity principle from Codex all pointed the other way, and the controlled run did not follow them.

**Detection signature.** A filename, path or backticked skill name on a line inside a numbered-step block, where the block is delimited by consecutive step headings.

**Harness.** Disclosure recall, already run. This entry exists to stop the genre being re-derived as guidance from its intuitive appeal, not to propose measuring it again.

### Genre 13: Numbered rules with a per-rule check

**In short.** A rule set where each rule is a numbered heading, and each carries an explicit, mechanically evaluable test of whether a candidate string or artifact passes it.

**What it looks like.** From the ask-user-question skill's layout reference:

```text
### 1. Budget 60 display columns in a `question`, and wrap it yourself

**Check:** no line *you write* into a question exceeds 60 display columns, measured
in display cells rather than characters.
```

**Labels.** SHIPPED PRACTICE

**Evidence.** The pack: 0 of 24. Anthropic: 0 of 20. This repository: 0 of the other 5 creator skills. The ask-user-question skill: the layout reference is built entirely this way, with thirteen numbered rules, each opening with a bolded check stating what must hold. Its wording reference carries a variant where each rule instead cites the clause of the external specification it derives from, which is a provenance label rather than a check. This is a house convention of one skill.

**Detection signature.** Three or more headings matching `^#{3}\s*\d+\.\s`, each followed within five lines by a bolded lead matching `Check:|Test:|Passes when`.

**Harness.** Outcome pass rate, graded by a rubric derived from the checks themselves. The genre hands the grader its own rubric, which makes it unusually cheap to evaluate and is arguably the strongest argument for it.

### Genre 14: Table of contents in a long reference

**In short.** An anchor-linked list of a reference file's own headings, placed at its top, so a partial read still returns a map of the whole.

**What it looks like.** From the pack's accessibility-checklist shared reference. The heading above these bullets is trimmed here, because it would collide with this note's own navigation section:

```text
- [Essential Checks](#essential-checks)
- [Common HTML Patterns](#common-html-patterns)
```

**Labels.** GUIDANCE

**Evidence.** The pack: 5 of 7 shared checklists, the two exceptions being a 67-line file below the threshold and a 370-line file above it. Anthropic: 0 of the claude-api skill's 66 reference files, of which 48 exceed 100 lines, the largest a 1548-line migration guide. This repository: 0 of 24 over-threshold files. The ask-user-question skill: 0 of 6.

The rule is Anthropic's own — a table of contents for reference files longer than 100 lines — and it is published alongside its mechanism. When references are nested, the model may preview with a partial read rather than reading whole files, returning incomplete information. A table of contents is what makes a partial read still useful. The vendor states the rule and complies with it nowhere in its largest bundle.

**This repository's gap, enumerated, because it is a work item rather than an observation.** Twenty-four reference-role files exceeded 100 lines and none carried a table of contents.

Thirteen files in `shared/references/`: schemas.md (723), grader.md (227), blind-comparison.md (217), distribution-targets.md (209), comparison-analysis.md (202), disclosure-optimization.md (200), description-optimization.md (195), progressive-disclosure.md (191), pure-bun.md (185), running-detached.md (160), description-writing.md (144), plugin-skills.md (115), benchmark-notes.md (107).

Eleven files in per-skill `references/` and `examples/`: command-creator/arguments.md (335), mcp-creator/server-entry.md (296), agent-creator/agent-frontmatter.md (269), command-creator/command-frontmatter.md (268), mcp-creator/tool-surface.md (258), mcp-creator/naming-walkthrough.md (232), command-creator/load-time-injection.md (225), plugin-creator/shared-code-architecture.md (174), agent-creator/delegation.md (155), agent-creator/flake-triage.md (151), command-creator/review-pr.md (148).

Two of these, disclosure-optimization.md and progressive-disclosure.md, were mid-rewrite by another agent, so their status wanted re-checking rather than action from this count. Nine further files fall under the threshold and are correctly exempt, the largest being plugin-creator/verification.md at 98.

The ask-user-question skill had the same gap in full. All six of its reference files exceed 100 lines and none carried a table of contents: layout.md (469), examples.md (332), reading-answers.md (177), failed-question.md (157), wording.md (150), asking-again.md (140). Those are the same six files whose recall ANALYSIS-004 measured at 33% to 75%, which made them the one set where a change could be measured against an existing baseline. Method records a same-day re-check of both gaps.

**Detection signature.** Within the first 25 lines of a `.md` file longer than 100 lines, three or more bullets matching `^\s*[-*] +\[.+\]\(#`. Both halves are mechanical, which makes this the cheapest check here to write and the easiest to defend, since the threshold is the vendor's own.

**Harness.** Disclosure recall under partial reads specifically. The measurement is not whether the file is opened, but whether a truncated read still yields the needed section. That is a variant of the recall harness rather than a new one, and it is not currently instrumented.

## Method

Four corpora were read as files rather than as descriptions of files.

| Corpus | What was read | How |
|:--|:--|:--|
| The pack | 24 skills, 7 shared checklists, the README, the skill-anatomy document | Cloned at depth 1 from its GitHub repository |
| Anthropic | 20 published skills | Marketplace copy on this machine; 8 read whole from shortest to longest, internal-comms at 32 lines through xlsx and docx to mcp-builder; claude-api and skill-creator read in sections; all 20 counted by grep |
| This repository | 5 creator skills, 15 of 17 shared references | Read on disk; 2 references skipped as mid-rewrite and unstable |
| The ask-user-question skill | Body plus all six references | Read whole |

The pack was cloned rather than fetched through a summariser, because a sibling investigation caught a fetch summariser fabricating a paper's contents. Every external claim was checked against the repository or page that makes it.

Counts come from grep expressions doubling as candidate detection signatures. That is deliberate: a genre whose presence cannot be counted mechanically is a genre no check can find.

**The three harnesses.** Triggering measures whether a skill fires on the phrasings users type. Disclosure recall measures reached over should-have-reached for a bundled reference, per ANALYSIS-004 Finding 1, and never the raw pull rate, which conflates rarely-needed with needed-and-missed. Outcome pass rate measures whether the produced artifact satisfies its assertions. Genres differ in which harness could see them, and several can only be seen by outcome pass rate.

**One instrument constraint carries from ANALYSIS-004 Finding 3 into every experiment proposed here: run it on the weaker model.** The strong model reaches nearly everything eagerly and hides signposting defects. The weaker model over-fetches on nothing and misses, which makes it the only instrument that detects a defect.

**The verification rule.** A citation carried across from another note counts as unverified until someone opens it in primary text here. The rule this repository already had was aimed at claims made for the first time, not at claims inherited from a sibling note. That failure mode is silent, it cannot be detected by reading the note carrying it, and it produced correction D.

**The specimen fidelity rule.** Every specimen in the catalog was copied from primary text on 2026-08-24, from the file named beside it, and none was written for this note. Two edits are allowed and no others: the trim drops surrounding lines, and a source line too long for this page may wrap onto a second line. No character inside a specimen is changed, added or removed.

### A same-day re-check of the table-of-contents gap

This section sits under Method rather than Corrections because it is a re-measurement rather than a correction to the record. Genre 14's counts stay exactly as the record measured them, because they are a dated measurement rather than an error.

**Recommendation 3 has largely been carried out since the survey, later on 2026-08-24.** All 24 plugin-kit files named in Genre 14 are present, and 23 of them now carry a table of contents. One file has moved: `mcp-creator/references/naming-walkthrough.md` now sits at `mcp-creator/examples/naming-walkthrough.md`, and it carries a table of contents at line 7. Only `agent-creator/examples/flake-triage.md` still lacks one, and that absence is real rather than positional. A whole-file scan finds no table-of-contents heading and no anchor bullets anywhere in its 151 lines. It is an annotated agent-definition specimen rather than a reference document, which may be why.

All six ask-user-question files now carry a table of contents. Five place it at the head. `asking-again.md` places its own at line 29, below a mermaid flowchart rather than first, which is a position worth noting rather than an omission.

**One caveat on this re-check's own method, because the method is part of the record.** The first pass of this sweep scanned only each file's opening lines, and a position-sensitive check reports a mid-file table of contents as absent. It did exactly that on `asking-again.md`, and it also reported a relocated file as missing. The figures above come from a whole-file re-scan. This is the catalog's own detection-signature discipline landing on the catalog. Genre 14's signature deliberately requires the table of contents to sit within the first 25 lines, because a map appearing after the content cannot serve a partial read. A head-scoped detector is therefore correct as a check and wrong as a census. A detector answers the question its signature encodes, and never the question the reader assumed.

**This re-check is a replication, not a first measurement.** It re-ran an existing signature against changed files. It measured compliance, which was already measurable, and not effect, which remains unmeasured for this genre and for twelve others.

Two consequences follow. The compliance gap that made Genre 14 the easiest check to justify is no longer this repository's own embarrassment, though the check is still worth writing, since the vendor gap it was measured against is untouched. And the ask-user-question references are no longer a test bed for a table-of-contents change at all, because the intervention has already been applied to all six without a measurement around it.

## Corrections

The note of record has corrected itself four times, all on 2026-08-24. Those four corrections touch eleven separate sites, because a single correction propagates into every paragraph repeating the old figure.

| Date | What changed | Sites | Stated in full at |
|:--|:--|:--|:--|
| 2026-08-24 | A. Genre 1 count for this repository, 5 of 5 to 3 of 5 | 2 | Genre 1, Limits |
| 2026-08-24 | B. Genre 5 placement count, first section in four of five to three of five | 1 | Genre 5, Limits |
| 2026-08-24 | C. Genre 10 count for this repository, 5 of 5 to 3 of 5 | 2 | Genre 10, Limits |
| 2026-08-24 | D. Rule 1 and Genre 1 label, MEASURED to SHIPPED PRACTICE with evidence withdrawn | 6 | Genre 1, Limits; Findings 4 and 5 |

Correction D is the largest and the most consequential. It reaches two findings, the earlier standard's first verdict, the Genre 1 label, the first open question, and recommendation 1. It is an evidence withdrawal rather than a refutation, and Finding 4 explains why that distinction has to hold.

Corrections A, B and C are count corrections found by re-running the survey's own signatures. Correction C also changed a conclusion rather than only a number, because the two skills it removed from the count turned out to use the pointer form that measurement refuted.

## Open questions

- **Whether any genre has a measured effect at all.** The note of record heads this "Whether any genre is load-bearing at all". Corrected 2026-08-24: it once read "whether any genre except two is load-bearing" and credited ordered workflow steps with an external positive result, which the same-day correction withdrew. Effect is measured for exactly one genre, and that one came back refuted. For the other thirteen there is no experiment, here or in the published record. Closing it needs one ablation per genre on the weaker model.
- **Whether excuse tables change behaviour at all.** The genre is the most distinctive thing in the survey and the least evidenced. It is also the most testable, because the pack ships fixtures built around time pressure and authority pressure, which is the scenario shape the experiment needs. Recommendation 5 names it.
- **Why the pack's two exceptions are exceptions.** The meta-skill and the ideation skill omit the excuse table. Whether that is a considered judgement about fit or an oversight is stated nowhere in the repository. Closing it needs the author, not a measurement.
- **Whether a table of contents helps, as opposed to being prescribed.** The mechanism is plausible and published, the compliance gap is measured, and the effect is not. Closing it needs recall conditioned on partial reads, a harness variant that does not exist yet, and Method records that the obvious test bed has just been spent.
- **Whether Genre 10 beats Genre 11 on form alone.** ANALYSIS-004 tested pointer position and found nothing. Nobody has tested pointer form: the same pointer in the same place, with and without its firing condition and cost of skipping. Closing it would settle whether this repository's convention earns its place.
- **What the frontmatter genres are, since they are out of scope here.** The description carries its own structures — trigger-and-skip clauses, negative scoping, an embedded disambiguating command in the claude-api case — measured by the triggering harness rather than anything in this note. Closing it needs a separate survey.
- **Whether genres interact.** Every count here treats genres as independent. Whether a numbered workflow makes a trailing manifest better or worse, or whether a gotcha block substitutes for a stop gate, is untested and probably matters more than any single genre's effect.

## Glossary

The rest of this note reads without this section. It is here for precision, not for comprehension.

**Genre**:
One of the fourteen recurring shapes a skill body is built from.
_Avoid_: pattern, shape, form, structural type, device.

**Label**:
A token recording what kind of support a genre or finding has. The vocabulary is closed and listed in How to read the findings.
_Avoid_: claim label, value label, evidence label, confidence score.

**Detection signature**:
The grep expression deciding whether a genre is present in a markdown file. Every count here was taken with one, so every count can be re-run.
_Avoid_: regex, detector, matcher, rule.

**Specimen**:
Two or three real lines from a surveyed file, showing what a genre looks like on the page.
_Avoid_: sample, snippet, illustration.

**Harness**:
A measurement setup that can see a genre's effect. Three exist, and genres differ in which one could see them.
_Avoid_: test, eval, benchmark.

**Triggering**:
The harness measuring whether a skill fires on the phrasings users type.

**Disclosure recall**:
The harness measuring, for one bundled reference, the runs that reached it divided by the runs that should have reached it.
_Avoid_: pull rate, fetch rate, hit rate.

**Outcome pass rate**:
The harness measuring whether the artifact a skill produces satisfies its own assertions.

**The four corpora**:
The pack is Addy Osmani's Agent Skills pack, 24 skills plus 7 shared checklists. Anthropic is Anthropic's 20 published skills. This repository is plugin-kit. The ask-user-question skill is a separate repository, counted separately.
_Avoid_: codebase, source, sample, ecosystem.

**Reference file**:
A markdown file bundled beside a skill and reached by a pointer from the skill body.
_Avoid_: doc, resource, attachment, module.

**Manifest**:
A block in a skill body listing that skill's bundled reference files. Genre 10 gives each entry a firing condition and Genre 11 gives none.
_Avoid_: index, see-also list, pointer block.

**Firing condition**:
The clause in a pointer saying when to open the file it names, often with the cost of not opening it.
_Avoid_: trigger, precondition, when-clause.

**House convention**:
A practice one author or one repository ships everywhere without publishing evidence for it.
_Avoid_: house style, house genre, house format, house diction.

**Ablation**:
Removing one element, then running the original and the changed version together against the same scenarios.
_Avoid_: A/B test, strip test, arm.

**The weaker model**:
The lower-capability model every experiment here must run on, because the stronger model hides the defect.
_Avoid_: small model, cheap model, weak model.

**Note of record**:
ANALYSIS-005. It is authoritative wherever this rebuild and it disagree.
_Avoid_: the original, source note, canonical copy.

### Flagged ambiguities

- **"Load-bearing"** was the record's word for a genre with a measured effect. This rebuild says *has a measured effect*, because the original is a metaphor. The record's heading is quoted once in Open questions so a search for it still lands here.
- **SHIPPED PRACTICE** is written with a space. The record writes SHIPPED-PRACTICE with a hyphen. The token is the same label, and the spacing follows this note family's shared convention.
- **Two denominators exist for the same gap.** Finding 3 gives 0 of 15 for this repository's shared references and 0 of 24 for every reference-role file over the threshold. The record states both without reconciling them, and Genre 14 enumerates both sets.
- **Three words replace metaphors used by the record.** Spine becomes *organising structure*, substrate for measurement becomes *a starting list for experiments*, and killed becomes *refuted*.

## Observations

### The lineage

- [problem] A six-rule standard skill shape was proposed in a predecessor conversation and measurement refuted two of its six rules within hours — pointing every reference from inside the step whose work needs it, and capping a skill at three references #lineage #refuted
- [insight] Both refuted rules were intuitive and carried converging support, since one agreed with an external measured result and with a filesystem-level proximity principle and the other appeared to rest on a published number, and both failed anyway — which is why no genre entry may rest on how many people ship it #lineage #calibration
- [decision] The four surviving rules are recorded as candidates to validate rather than as settled standard, and corrected 2026-08-24 none of them carries a positive measured result at all — rule 1's was withdrawn when its citation was re-opened, leaving shipped practice, a mechanism, doctrine and published guidance as the four bases #lineage #candidate-standard
- [constraint] Each refuted rule is marked again at the genre entry it touches, so a reader arriving at a genre meets its refutation before the material they might act on, and a check over the manifest genre reports entry count as a fact rather than enforcing a cap #lineage #guardrail
- [problem] A third rule lost its evidence on 2026-08-24 without ever being refuted: the external result cited for numbered-workflow-as-organising-structure measured an instruction added to a host context file telling the agent to invoke a skill, which is forced invocation from passive context rather than how a body is organised #lineage #evidence-withdrawn
- [insight] Refutation and evidence withdrawal are different failure modes and are kept distinct here, since two rules were tested and failed while one was never tested and had been recorded as though it had been — collapsing them would misstate what is known about rule 1, which is nothing #lineage #distinction
- [constraint] A citation inherited from a sibling note counts as unverified until it is opened in primary text here, because the existing verification rule was aimed at first-time claims and this one survived two notes unchecked, producing a MEASURED label on a genre nobody had measured #lineage #inherited-citation
- [fact] Four distinct corrections in the note of record touch eleven separate sites, because one correction propagates into every paragraph repeating the old figure, and correction D alone reaches six of them #corrections #propagation
- [technique] The ask-user-question skill's six references were the better test bed for a table-of-contents change, since all six exceeded 100 lines with no table of contents and were the same six whose recall was already measured at 33 to 75 percent #toc #test-bed

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
- [fact] Ordered numbered steps appear in 16 of the pack's 24, 3 of 5 creator skills here, and 4 of Anthropic's 20 — corrected 2026-08-24 from 5 of 5, since agent-creator and mcp-creator carry zero numbered step headings and are organised by topic #workflow-steps #distribution
- [problem] The Genre 1 repository count was wrong because its stated figure and its example list were written separately — the sentence asserted five while naming three, and folded in a skill from another repository — so a count and the examples supporting it must be generated by the same command #correction #count-drift
- [insight] The detector built from this note's own catalogued signature refuted one of the note's own counts, which is the first evidence that the signatures are precise enough to run against a corpus rather than merely be read #correction #detector-validates
- [fact] Blocking stop imperatives appear in 9 of the pack's 24 and 5 of Anthropic's 20, and in none of this repository's 5 creator skills #gates #gap
- [fact] Worked good-and-bad specimen pairs appear in 11 of the pack's 24 and 1 of Anthropic's 20 #worked-pairs #split
- [fact] Numbered rules each carrying their own pass check appear in exactly one artifact across all four corpora — the ask-user-question layout reference, with thirteen such rules #rules-with-checks #house-genre
- [fact] Anthropic's largest reference bundle does not use the bare trailing manifest its own documentation illustrates, routing 66 files through roughly twenty bolded condition-to-file entries instead #claude-api #routing-manifest

### What the signatures give

- [technique] A genre whose presence cannot be counted by grep is a genre no check can find, so every count in this survey was taken with an expression that doubles as a candidate detection signature #lint #method
- [technique] The anti-rationalization signature is the cleanest in the catalog because one author's rigid consistency made it so — a single heading pattern plus a fixed two-column header, with no variants to accommodate #lint #signature
- [technique] The two manifest genres are separable by one mechanical test, the presence of a when-or-before clause in the same sentence as the filename, which is what lets a check distinguish a conditioned pointer from a bare one #lint #manifest-split
- [technique] The table-of-contents check is the cheapest to write and the easiest to defend because both halves of its condition are mechanical and the 100-line threshold is the vendor's own #lint #toc
- [constraint] Signatures should report presence and never quality, because thirteen of the fourteen genres have no measured effect and a check prescribing an unvalidated genre states an opinion as a requirement #lint #scope

### What remains unmeasured

- [insight] Presence is countable for all fourteen genres and effect is measured for exactly one, corrected 2026-08-24 from two, so the catalog is a starting list for experiments rather than a set of validated recommendations — and the single measured genre came back refuted #measured-effect #honesty
- [outcome] Corrected 2026-08-24 — ordered workflow steps carry no external measured support after all: the evaluation cited for them moved invocation by adding an instruction to a host context file telling the agent to invoke a skill, so it measures forced invocation from passive context rather than body organisation, and the genre drops to shipped practice on its counts alone #workflow-steps #evidence-withdrawn
- [outcome] In-step pointer placement is the one genre measured in this repository and it was refuted in its actionable form — reach halved, 8 of 40 trailing against 4 of 40 in-step, p approximately 0.20 — so the entry exists to stop the genre being re-derived from its intuitive appeal #placement #refuted
- [risk] The firing-condition manifest is this repository's own convention, shipped in 3 of 5 creator skills — corrected 2026-08-24 from all 5 — has no published basis and no vendor analogue, and the only measurement touching it recorded 33 to 75 percent recall on the references carrying its fullest form #house-convention #unvalidated
- [problem] plugin-creator and skill-creator carry no reference manifest at all and point at their bundled files inline instead, 11 and 21 mentions, which is the in-step pointer form this repository's own controlled run refuted — so two of five creator skills use only the form measurement did not support #house-convention #refuted-form
- [problem] Nobody has tested pointer form as opposed to pointer position — the same pointer in the same place with and without its firing condition and cost of skipping — which is the experiment that would settle whether the house convention earns its place #open #form-experiment
- [risk] Reading a high shipped count as evidence of value would repeat the category error a sibling finding already corrects, where a measured figure about whole skills attached to a task was mistaken for a constraint on files bundled inside one #shipped-practice #category-error
- [constraint] Every experiment proposed here must run on the weaker model, since the strong model reaches nearly everything eagerly and hides the signposting defect the measurement exists to detect #instrument #model-tier
- [problem] Every count treats genres as independent, so whether a numbered workflow changes what a trailing manifest achieves, or whether a front-loaded gotcha block substitutes for a stop gate, is untested and may matter more than any single genre in isolation #interaction #open

### What this rebuild verified for itself

- [outcome] A same-day re-check on 2026-08-24 found recommendation 3 carried out almost in full: all 24 plugin-kit files named in Genre 14 are present and 23 now carry a table of contents, with one file moved from a references directory to an examples one, and only the agent-creator flake-triage example still lacking one on a whole-file scan #toc #re-check
- [outcome] All six ask-user-question reference files now carry a table of contents where the survey found none, five at the head and one below a mermaid flowchart, so that set is no longer a test bed for measuring the change because the intervention landed on every file without a measurement around it #toc #test-bed-lost
- [technique] The first pass of this rebuild's re-check scanned only each file's opening lines and reported both a mid-file table of contents and a relocated file as absent, which is the catalog's own detection-signature discipline landing on the catalog — a head-scoped detector is correct as a check for Genre 14 and wrong as a census #re-check #signature-artifact
- [constraint] The same-day re-check is a replication rather than a first measurement, since it re-ran an existing signature against changed files and measured compliance, which was already measurable, rather than effect, which stays unmeasured for thirteen genres #re-check #replication
- [technique] Every specimen in this rebuild was copied from primary text in the file named beside it, with only two edits allowed — the trim drops surrounding lines and an over-long source line may wrap — so no character inside a specimen is changed #specimens #verified
- [fact] The indexer reads markdown link syntax as a relation even inside a code fence, so the Genre 14 specimen's two quoted anchor bullets mint one self-edge on this note — three resolved edges against two authored — and the ruling is to document the artifact rather than alter a faithful quote #graph #quoting-artifact

## Relations

<!-- The original note carries no inverse edge back to this rebuild, by owner instruction: original files stay byte-identical. -->

- pairs_with [[ANALYSIS-005: Structural Genres of Skill Content]]
- relates_to [[SESSION-2026-08-23_01: Plugin Kit Measurement Tooling Hardening]]
