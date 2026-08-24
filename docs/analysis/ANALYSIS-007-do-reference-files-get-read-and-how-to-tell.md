---
title: "ANALYSIS-007: Do Reference Files Get Read, and How to Tell"
type: analysis
status: DRAFT
permalink: analysis/analysis-007-do-reference-files-get-read-and-how-to-tell
tags:
- analysis
- skills
- references
- progressive-disclosure
- vendor-survey
---

# ANALYSIS-007: Do Reference Files Get Read, and How to Tell

> This is the plain edition of ANALYSIS-004, "What Makes a Bundled Reference Get Read". It carries every finding, figure, evidence label, dated correction, limit and recommendation from that note, as of 2026-08-24. ANALYSIS-004 stays the note of record. Where the two ever disagree, ANALYSIS-004 is right.

## What this note found

A skill can move content out of SKILL.md into separate reference files. The model then has to decide to open them. This note measures how often it does, and finds that the usual way of measuring it is wrong.

The skill measured is ask-user-question: 456 lines of SKILL.md and six reference files. It is the test subject, not the subject. What is at stake is the guidance this repository gives every skill it produces.

**The usual number divides by the wrong thing.** Counting reads against every run buries the answer. Divide instead by the runs that needed the file. The wording reference was read 3 times in one sweep of 54 runs on the weaker model. Those same 3 reads give two very different answers:

| Divide the same 3 reads by | Result | This is called |
|:--|:--|:--|
| all 54 runs in the sweep | 5.6% | pull rate |
| the 8 runs that needed the file | 37.5% | recall |

Nothing changed but the denominator. The whole gap is runs that were right not to open the file. A decision to keep or delete a file, taken on the first number, ranks a well-pointed rare file below a badly-pointed common one.

**The stronger model hides the fault the weaker model exposes.** The two models fail in opposite directions, so they are not one instrument with different noise:

| Model | Opened the file when it should have | Opened a file it did not need |
|:--|:--|:--|
| opus | 100% on five of six files, 75% on the sixth | 3 of 8 runs, which is 37.5% |
| sonnet | Between 33% and 90% | 0 of 8 runs |

So measure on the weaker model. An opus-only sweep would have shown five of six files at 100% and surfaced nothing at all. A check that returns a clean verdict from the wrong setup is worth less than no check.

**Moving a pointer next to the step that needs it did not help.** The best-performing file is the only one pointed to from inside the numbered steps, six times over. The worst are single pointers in trailing sections. Two published examples show the difference in shape:

```text
Anthropic, at the end of the file — names a file, and nothing else:

    **Advanced features**: See [advanced.md](advanced.md)

Cursor, inside an instruction — says when to reach for it:

    Add a `@service-template.ts` reference file when creating a new
    service for the standard boilerplate
```

The trailing shape is the one that measured worst here. So the obvious fix was to move a trailing pointer into its step. That was tested on 2026-08-24, moving the pointer without changing its wording and without adding a second mention. Reach halved: 8 of 40 runs became 4 of 40, at p about 0.20. That is no detectable effect, trending against. Placement does not go into any standard.

**The published guidance names this failure and stops there.** Anthropic writes that if Claude fails to follow references, "Your links might need to be more explicit or prominent". It never says what prominent means, or how to measure it. Its own worked example of a good reference block is the trailing shape above, four bare lines of it.

**No other vendor has this problem, because no other vendor lets the model decide.** Five vendors attach a file when a condition matches, usually a file-matching pattern. Gemini CLI does it twice over. Codex and Aider have no reference-following at all. Across eight vendors, a Claude skill's reference file is the only case where reading depends on the model choosing to read. Every authoring rule written here is a workaround for a missing mechanism, and should say so.

## How this note is arranged

1. What this note found — above. The results and the three numbers that carry them.
2. What to do about it — six recommendations, each one usable on its own.
3. How the measurements were run — the scenarios, the models, and how vendor claims were checked.
4. Words used exactly — one meaning per word, plus the evidence labels. Read it before the findings.
5. Findings 1 to 18 — one claim each, with its evidence label. Stable numbers; cite them.
6. What is still unknown — six open questions.
7. Observations and Relations — the graph layer.

## What to do about it

**1. Report recall, never pull rate.** Re-derive any keep-or-delete verdict that was taken on a pull rate. The gap between 5.6% and 37.5% is not rounding; it inverts the ranking of which file is in trouble. See Finding 1.

**2. Measure on the weaker model.** It is the only one that reveals a missed pointer, because the stronger model opens the file whatever the pointer says. An opus-only sweep of this skill would have hidden every problem. See Findings 2, 3 and 15.

**3. Do not write placement into any standard. Executed 2026-08-24, and the result forbids the rule rather than licensing it.** This recommendation once called for an experiment. The experiment ran exactly as specified: one trailing pointer moved inside the step that needs it, mention count held fixed, re-measured on the weaker model at 40 runs per arm. Reach halved, at p about 0.20. A correlation, an external result and a filesystem-level analogue all pointed one way, and the controlled run did not follow them. That is why the experiment had to come before the rule. See Finding 4.

**4. Bound how deep references go, never how many there are. Withdrawn and replaced 2026-08-24.** This recommendation once read "treat six references as a live defect pending replication", because external measured work appeared to contradict the shipped artifact. It does not: the three-module figure counts whole skills attached to a task, not files bundled inside one. No vendor states a cap on count, Anthropic's own skill-creator calls bundled resources "unlimited", and Anthropic's claude-api skill ships 66 reference files. Write the principle instead. Link every reference directly from SKILL.md. Make each file readable on its own, with a table of contents past roughly 100 lines. Split by what one task needs to read, not to hit a target number. Whether six is right for this skill is a recall question, not a threshold question. See Findings 1 and 17.

**5. Prefer an explicit stop rule over a weaker pointer.** Stop criteria and fetch budgets work inside a SKILL.md. Discouraging a read by softening its pointer is not a mechanism anyone has shown to work. See Finding 13.

**6. Say in the guidance that it is a workaround.** The harness attaches its own context files deterministically, and does not do this for skill references. Any rule written here compensates for a missing mechanism. It should say so, rather than presenting itself as the natural way to author references. See Finding 11.

## How the measurements were run

Recall comes from 27 scenarios. Each was annotated in advance with the reference it should open, and each ran twice per model. Recall divides reads by the runs that should have produced them. Over-fetch is measured separately, against four scenarios that should open nothing, across eight runs.

Every vendor claim was checked against primary text on 2026-08-24. Primary text means raw markdown, or HTML stripped locally, then grepped for the exact sentence. No claim rests on a search summary or a fetch summariser. This was not caution for its own sake. A prior agent on a sibling project had a fetch summariser fabricate a paper's contents, complete with invented experiments and an invented improvement figure. A paraphrase is not primary text, and its failure mode is a confident answer rather than an error.

Where the findings come from:

| Findings | Source |
|:--|:--|
| 1 to 5 | This repository's own measurements. |
| 6 to 9 | Published research and Anthropic's documentation. |
| 10 to 15 | The vendor survey. |
| 16 | The four commissioned answers, drawing on all three sources above. |
| 17 | A correction added 2026-08-24. It retires a claim that entered Finding 9 and Finding 14 on a misreading of its source. |
| 18 | This repository's own measurement, added 2026-08-24. It derives recall's denominator instead of hand-annotating it. |

Vendors reached: OpenAI, through the Codex AGENTS.md documentation, the AGENTS.md format site, and the GPT-4.1 and GPT-5 prompting guides. Google, through the Gemini CLI context-file and memory-import documentation and Gemini Code Assist review customisation. Cursor, GitHub Copilot, Windsurf, Cline, Continue and Aider.

Vendors not reached: JetBrains AI, Amazon Q Developer, Zed, Sourcegraph Amp, and Devin's hosted product.

One constraint shapes every conclusion. This repository is Claude-first. Where a vendor practice conflicts with a Claude standard, the Claude standard wins. Nothing here is recommended because it is popular elsewhere.

### What made this measurable at all

ANALYSIS-003 established that this harness could not previously tell whether a reference was opened. Three defects caused that. A path comparison left symlinks intact, so it counted every read inside the skill as a read outside it. A load was recorded from the tool request rather than from its result. And two halves of one measurement disagreed about what a valid run is. All three are fixed.

This note is the sequel. The instrument now works, and the number it reports is the wrong one. ANALYSIS-003 records pull rates between 11% and 59% after those fixes, and a keep-or-delete verdict computed from them. Finding 1 is why that verdict cannot stand.

## Words used exactly

One word carries one meaning throughout. The words in the Avoid column never carry that meaning here. Quoted primary text keeps its own words, including words this note otherwise avoids.

**Searching this note.** Finding numbers are stable anchors, so cite them. Every heading is unique. Each claim's full statement lives under its own finding, and nowhere else.

### Counting reads

| Word | Meaning here | Avoid |
|:--|:--|:--|
| pull rate | Reads of a file, divided by every run. | raw rate, open rate, read rate |
| recall | Reads of a file, divided by the runs that needed it. | hit rate, follow rate, success rate |
| over-fetch | The model opens a file the run did not need. | over-reading, eager reading, false positive |
| missed pointer | The model should open a file and does not. | signposting defect, routing defect |

### The skill being measured

| Word | Meaning here | Avoid |
|:--|:--|:--|
| harness | The program that runs the model and builds its context. Claude Code, here. | runtime, platform, tool |
| reference | A markdown file beside SKILL.md that the model must choose to open. | module, resource, sub-file |
| pointer | The sentence in SKILL.md that names a reference and says when to open it. | link, signpost, mention |
| firing condition | The part of a pointer that says when to open the file. | trigger, when-clause |
| cost of skipping | The part of a pointer that says what you lose by not opening it. | penalty, risk clause |
| mention count | How many times SKILL.md names one reference. | surface area, repetition |
| workflow step | A numbered step in SKILL.md's procedure. | section, instruction |
| trailing section | A section after the numbered steps, near the end of SKILL.md. | footer, appendix |
| topic centrality | How close a reference's subject sits to the skill's main job. | importance, salience |
| attach | The harness puts a file into context before the model runs, with no read call. | auto-load, splice, import, inject |
| progressive disclosure | Moving content out of SKILL.md into a reference reached by a pointer. | layering, chunking, tiering |
| prune | Delete a reference from a skill. | cut, trim, drop |

### Running the measurements

| Word | Meaning here | Avoid |
|:--|:--|:--|
| scenario | One test prompt, written to exercise part of the skill. | case, test, task, eval |
| run | One execution of one scenario against one model. | attempt, trial |
| sweep | Every scenario run against one model. | pass, batch, campaign |
| arm | One version of the skill inside a controlled comparison. | condition, variant, branch |
| delivered run | A run in which the skill body reached the model. | valid run, loaded run |
| negative scenario | A scenario that should open no reference at all. | control, null case |
| confound | A second cause that would produce the same number. | noise, bias |
| assertion pass rate | The share of graded checks a run passes. Ablation figures move this score. | score, accuracy, grade |
| ablation | Deleting content and re-running, to see what the deletion costs. | strip test, knockout |
| drop map | Which scenarios lost score when a given file was deleted. | attribution table |
| ground truth | Which reference each scenario should open. Recall divides by this. | labels, key, gold set |

### Evidence labels

Every finding carries these on an **Evidence** line under its heading.

| Label | Meaning |
|:--|:--|
| MEASURED | Someone ran an experiment and reports a number. |
| GUIDANCE | A vendor asserts it and publishes no evidence for it. |
| PORTABLE EVIDENCE | The claim holds whatever harness you use. |
| TECHNIQUE | The claim is adoptable inside Claude conventions. |
| MECHANISM-SPECIFIC | The claim shows the shape of the difficulty and cannot be adopted, because a Claude skill opens a reference only when the model chooses to. |
| SHIPPED-PRACTICE | Counted from what published skills actually bundle. |
| CORRECTION | The finding retires a claim an earlier draft carried. |
| OURS | This repository measured it. |
| PUBLISHED | It comes from published research or vendor documentation. |
| VENDOR | It comes from the vendor survey. |
| derived | It follows from another finding rather than from its own measurement. |
| MEASURED but confounded | The number is real, and two causes vary together inside it. |
| bounding | The finding sets a limit on what any rule here can be. |
| the central result | The survey's main answer. |

Nearly all vendor material is GUIDANCE, and saying so is part of the finding.

### Words that mean two things

- **module.** SkillsBench uses it for a whole skill attached to one task, never for a file inside a skill, and never defines it. This note never uses the word for a bundled file. Finding 17 carries the correction.
- **prominent.** Anthropic's word for what a pointer should be. Named, never defined, never measured. Finding 6.
- **tier.** ANALYSIS-004 calls opus and sonnet the two model tiers. This note writes "the stronger model" and "the weaker model" instead, and names them.
- **signposting, routing.** ANALYSIS-004 uses both for one idea. This note writes missed pointer throughout.
- **pp.** The sources mix "percentage points" and "pp". This note writes points. Every figure is unchanged.
- **raw pull rate.** A pull rate is always raw, so this note writes pull rate. Recall is the corrected figure.

## Findings

### Finding 1: Pull rate divides by the wrong number

**Evidence:** OURS · MEASURED

A pull rate cannot separate *rarely needed* from *needed and missed*, so no keep-or-delete verdict can rest on one.

| Reference | Weaker model | Stronger model | Where its pointer sits |
|:--|:--|:--|:--|
| layout | 90% (9/10) | 100% (10/10) | 6 mentions, inside workflow steps 3 and 4 |
| asking-again | 75% (6/8) | 100% (8/8) | 1 mention, trailing section |
| reading-answers | 60% (6/10) | 100% (10/10) | 1 mention, trailing section |
| examples | 50% (2/4) | 100% (4/4) | 2 mentions |
| wording | 37.5% (3/8) | 75% (6/8) | 1 mention, trailing section |
| failed-question | 33% (2/6) | 100% (6/6) | 1 mention, trailing section |

The wording reference reads as 5.6% pull rate and 37.5% recall, and the entire gap is scenarios that correctly did not need it.

The consequence is direct rather than theoretical. A verdict computed from a pull rate deletes a file that is well pointed to and seldom relevant, and keeps a file that is often relevant and routinely missed.

This is the same family of defect as ANALYSIS-003 Finding 13: a figure computed over the wrong population, returning a plausible number rather than an error. It survived the fixes to the measurement tool, because those fixes corrected which reads were counted, not what the reads were divided by.

### Finding 2: The two models fail in opposite directions

**Evidence:** OURS · MEASURED

Opus reached 100% recall on five of six references and 75% on the sixth, and over-fetched on 3 of 8 negative runs. Sonnet over-fetched on 0 of 8, and its recall ran between 33% and 90%.

That is near-perfect recall with poor precision, against perfect precision with poor recall. The two models are not one instrument reading one quantity with different noise. They fail in different directions, so a defect visible on one is invisible on the other.

### Finding 3: Only the weaker model can find a missed pointer

**Evidence:** OURS · derived

It follows from Finding 2 that the stronger model cannot show a missed pointer, because eager reading opens the file whatever the pointer says. Measuring this skill on opus alone would have shown five of six references at 100% and surfaced nothing.

This sits with ANALYSIS-003's guard-scope finding. A check that returns a healthy verdict from the wrong configuration is worth less than no check, because a passing result is stronger evidence than an absent one. Pointer health measured on the strongest available model is that check.

### Finding 4: Moving a pointer into its step halved its reach

**Evidence:** OURS · MEASURED but confounded

The controlled run refuted the hypothesis in its actionable form, so placement does not enter guidance.

The observation that started it: the best-performing reference is the only one pointed to from inside the numbered workflow steps, six times over, and the worst are single pointers in trailing sections.

Position inside the file does not explain that. Those trailing sections sit at lines 369 to 439 of 456, which is end-of-context, and the retrieval literature makes that a favoured position. The effect therefore runs *opposite* to what raw position predicts, which is what made structural placement the candidate rather than positional salience.

**The honest limit: mention count and placement vary together across all six references.** The best differs from the worst in both at once, and nothing in the observational data separates them.

**Tested 2026-08-24.** The worst reference's single trailing pointer was moved into the workflow step where its condition fires. It was moved rather than duplicated, holding mention count at one, so the test separated placement from the number of mentions. Four scenarios ran ten times each, with both arms interleaved at the same concurrency so any drift hit both equally. Trailing scored 8 of 40; in-step scored 4 of 40. Moving the pointer in halved its reach, at z about 1.27 and p about 0.20. The honest reading is no detectable effect, with a trend against the hypothesis.

An earlier run at eight per arm returned 2 of 8 against 2 of 8. That was not reported as evidence of no effect, because eight runs per arm can only detect an enormous one.

The best performer's 90% recall still has no explanation. Mention count and topic centrality both remain live and untested.

### Finding 5: Two other explanations were checked and ruled out

**Evidence:** OURS · MEASURED

The low recall figures are genuine non-attempts, and they are not depressed by runs that never received the skill.

No read of a file inside the skill failed. The low figures are therefore real non-attempts rather than attempts that errored. That clears the first explanation.

The second is separate, and it is cleared too — but only because someone checked it rather than assuming it. A read that errors and a run whose skill body never arrived are unrelated causes that look identical in a recall figure. ANALYSIS-003 Finding 16 records 18 of 54 runs never receiving the body on a sweep of this artifact, and 27 scenarios run twice is also 54 runs. That coincidence made the question worth asking.

**They are not the same runs**, verified from the results files rather than inferred. The opus sweep behind the recall column reports `runs_without_skill=0`, `runs_loaded_via_file=0` and `countedRuns=54/54`. The sonnet sweep reports the same. The sweep ANALYSIS-003 describes reports `runs_without_skill=18` and `countedRuns=36/54`, and predates the Skill-tool grant that both recall sweeps were taken after. Finding 1's table therefore rests on fully-delivered runs.

Keep the distinction now that it has resolved cleanly, because it is what made the question askable. A recall figure carries no evidence about whether the body reached the model, so quote every recall figure with its delivered-run count.

### Finding 6: Anthropic names the failure but not the fix

**Evidence:** PUBLISHED · GUIDANCE

Verbatim, from the skill-authoring best-practices page, under observing how Claude navigates skills: "**Missed connections**: Does Claude fail to follow references to important files? Your links might need to be more explicit or prominent."

The failure is named exactly. No threshold, form or measurement attaches to *prominent*.

The same list holds the nearest thing to an over-fetch statement anywhere in the survey: "**Overreliance on certain sections**: If Claude repeatedly reads the same file, consider whether that content should be in the main SKILL.md instead". That concerns how often a needed file is read, not reading a file that was never needed.

The list also offers "**Ignored content**: If Claude never accesses a bundled file, it might be unnecessary or poorly signaled in the main instructions". That merges the two causes Finding 1 separates, and gives no way to tell them apart.

The merge has the shape ANALYSIS-002 ranks its findings by. A reference nobody needs is dead weight. A reference that is needed and missed actively misleads, because the skill reads as though the guidance is covered.

### Finding 7: Anthropic's model example is the worst-measured shape

**Evidence:** PUBLISHED · GUIDANCE

The page's "Good example: One level deep" is a trailing block of four bare pointers shaped `**Advanced features**: See [advanced.md](advanced.md)`. Each gives a label and a filename, with no firing condition and no cost of skipping. That is the trailing shape which scored between 33% and 75% on the weaker model here.

The framing encourages it. The page describes SKILL.md as serving "as an overview that points Claude to detailed materials as needed, like a table of contents in an onboarding guide." A table of contents is a collected list by construction.

The example illustrates nesting depth. Nothing on the page treats where a pointer sits as a variable. Anthropic's two canonical pointer forms also differ from each other, and neither matches the rule circulating in this ecosystem that a pointer should carry a file, a firing condition and a cost of skipping. **That rule has no published basis anywhere**, and after this survey no vendor analogue either.

### Finding 8: The one-level rule rests on a behaviour, not taste

**Evidence:** PUBLISHED · GUIDANCE

Verbatim: "Claude may partially read files when they're referenced from other referenced files. When encountering nested references, Claude might use commands like `head -100` to preview content rather than reading entire files, resulting in incomplete information."

Record that as a mechanism rather than a style rule. It matches the measured result that a second nesting level never helps, and can collapse accuracy from 0.91 to 0.64 (arXiv 2607.17598).

Other verified figures from the same page, all GUIDANCE: "Keep SKILL.md body under 500 lines for optimal performance"; "Keep references one level deep from SKILL.md"; "For reference files longer than 100 lines, include a table of contents at the top."

### Finding 9: Earlier measured work, and where it clashes

**Evidence:** PUBLISHED · MEASURED

- **Corrected 2026-08-24 — this bullet previously misread its source, and that misreading is why Finding 17 exists.** SkillsBench (arXiv 2602.12670) reports that 2 to 3 *whole skills attached to one task* outperform larger sets. It does not say a skill should bundle at most three references. Its Table 5 column header is "Skills Count" over rows "1 skill / 2-3 skills / 4+ skills", and *module* appears nowhere in the body evidence. Nothing in that paper bears on the six references this skill ships.
- An explicit ordered workflow instruction beat conditional availability. Invocation ran 44% against 95%, and pass rate 53% against 79% (Vercel's agents-md evaluation). This is the strongest external support for Finding 4, being exactly the difference between *this is available if relevant* and *at this step, do this*.
- Tool necessity is decodable from hidden states at 0.89 to 0.96 AUROC, a measure of how well a classifier separates two classes, while models still fail to act on it (arXiv 2605.09252). Do not soften the implication. If the model already represents that it needs the file, rewording the pointer optimises a stage that is not the broken one. This was established on tool calls rather than file reads inside a skill, so its transfer is unverified.
- Lost-in-the-middle (arXiv 2307.03172) predicts the **opposite** of Finding 4, because the worst references sit where retrieval should be strongest. This stays an unresolved contradiction rather than a resolved one. It is evidence that the mechanism is not positional salience.
- Prompt repetition helps non-reasoning inference and goes neutral under reasoning (arXiv 2512.14982). That predicts **less** benefit than the gap between six mentions and one shows.

### Finding 10: Only a Claude skill leaves the read to the model

**Evidence:** VENDOR · the central result

| Vendor | Mechanism | Who decides |
|:--|:--|:--|
| Cursor | `globs` in MDC frontmatter | harness, on glob match |
| Cursor | `description`, no globs | model |
| Windsurf | `trigger: glob` | harness, on file read or edit |
| Windsurf | `trigger: model_decision` | model |
| GitHub Copilot | `applyTo` glob frontmatter | harness |
| Continue | `globs`, plus a content `regex` | harness |
| Cline | `paths` frontmatter | harness |
| Gemini CLI | just-in-time scan near touched paths | harness |
| Gemini CLI | `@file.md` text import | harness, before the model reads |
| OpenAI Codex | directory-walk concatenation to a byte cap | harness |
| Aider | conventions file loaded from config, read-only | user |
| Claude skill references | model calls Read | model |

A glob is a file-matching pattern. Verbatim, from primary text:

- Cursor's frontmatter behaviour table gives both regimes as adjacent rows. For `alwaysApply` false with globs provided: "Auto-attached when a matching file is in context." For a description with no globs: "Agent reads the description and pulls the rule in when relevant."
- Windsurf's activation-mode table is the most explicit statement of the trade anyone publishes, because it carries a context-cost column. For `model_decision`: "Only the `description` is shown in the system prompt. Cascade reads the full rule file when it decides the description is relevant", at a cost of "Description always; full content on demand". For `glob`: "Rule is applied when Cascade reads or edits a file matching the `globs` pattern", at a cost of "Only when matching files are touched".
- GitHub Copilot: "At the start of the file, create a frontmatter block containing the `applyTo` keyword. Use glob syntax to specify what files or directories the instructions apply to", and "Instructions are automatically added to requests that you submit to Copilot."
- Continue: "globs (optional): When files are provided as context that match this glob pattern, the rule will be included."
- Cline: "When Cline processes a request, it gathers context from your current work (open files, visible tabs, mentioned paths, edited files), evaluates each rule's conditions, and activates matching rules." Its framing of why is the plainest anyone gives: "It's the difference between handing someone an entire policy manual versus the one page they need right now."
- Gemini CLI: "When a tool accesses a file or directory, the CLI automatically scans for `GEMINI.md` files in that directory and its ancestors up to a trusted root", scoped to "Lets the model discover highly specific instructions for particular components only when they are needed."
- OpenAI Codex: "Codex reads `AGENTS.md` files before doing any work", stopping "once the combined size reaches the limit defined by `project_doc_max_bytes` (32 KiB by default)."
- Aider: "It's best to load the conventions file with `/read CONVENTIONS.md` or `aider --read CONVENTIONS.md`. This way it is marked as read-only, and cached if prompt caching is enabled."

Everywhere else, the problem measured here was removed by design. Codex and Aider have no reference-following failure mode because they have no reference-following. The five matching vendors have none for scoped rules, because a deterministic matcher decides. Only Windsurf's `model_decision` and Cursor's description-only rule share this regime, and both vendors offer them as one option among four.

Classified **MECHANISM-SPECIFIC**. This is emphatically not a recommendation to adopt globs. It establishes the difficulty rather than the remedy.

### Finding 11: The harness can attach files, but not these

**Evidence:** VENDOR · bounding

Claude Code's own CLAUDE.md supports `@path` imports whose content enters context before the model reads anything. This was verified directly in this environment, where an auto-imported spec arrived as loaded context with no read call. Gemini's documentation describes the same Claude Code behaviour from outside, noting it "produces a flat, linear document by concatenating all included files".

The gap is not that the harness cannot attach. It is that a skill author has no way to declare a condition under which the harness attaches a file in `references/`. That bounds what any authoring rule can be. Such a rule compensates for a missing mechanism; it is not the natural way to author references.

### Finding 12: The one published placement rule agrees

**Evidence:** VENDOR · TECHNIQUE

Codex is the only vendor publishing a proximity rule for instructions: "Codex stops searching once it reaches your current directory, so place overrides as close to specialized work as possible." For code review it is more specific, telling authors to add the rules section "to the `AGENTS.md` closest to the code the rules govern."

That is *put the instruction next to the work it governs*, stated at the filesystem level. Finding 4's hypothesis is the same principle at the document level.

Classified **TECHNIQUE**: the principle is adoptable inside Claude conventions even though the mechanism is not, and it is the only published statement pointing this direction.

### Finding 13: One vendor tunes over-fetching; none measures it

**Evidence:** VENDOR · TECHNIQUE

OpenAI's recommended `<context_gathering>` prompt block contains, verbatim, "Avoid over searching for context", "Trace only symbols you'll modify or whose contracts you rely on; avoid transitive expansion unless necessary", and "Prefer acting over more searching." The guide goes further: "you can even set fixed tool call budgets", with a worked example specifying "an absolute maximum of 2 tool calls" plus a clause permitting an answer "even if it might not be fully correct."

The framing matters more than the tactics. OpenAI's premise is that "GPT-5 is, by default, thorough and comprehensive when trying to gather context in an agentic environment to ensure it will produce a correct answer". An eager model over-fetches by default, and eagerness is a property you tune. That is GUIDANCE, and it reframes the 37.5% opus over-fetch as a setting rather than a bug.

GitHub takes the inverse position. Its instruction-generating prompt lists among its goals "Allow the agent to complete its task more quickly by minimizing the need for exploration using grep, find, str_replace_editor, and code search tools", and tells authors to add detail "to reduce the amount of searching the agent has to do". That treats model-initiated fetching as a cost to design away, never a behaviour to calibrate.

### Finding 14: Every vendor caps size; none caps the count

**Evidence:** VENDOR · GUIDANCE

Five vendors cap volume, in five incompatible units:

- Cursor: "Keep rules under 500 lines" and "Split large rules into multiple, composable rules".
- Anthropic: the same 500-line figure for SKILL.md, arrived at independently, with no derivation published on either side.
- Windsurf, hard-enforced: "Workspace rule files are limited to 12,000 characters each. The global rules file is limited to 6,000 characters."
- Codex: a 32 KiB byte cap with truncation, advising "Raise the limit or split instructions across nested directories when you hit the cap".
- Gemini: a configurable maximum import depth defaulting to 5, with the best practice "Keep imports shallow - avoid deeply nested import chains".

GitHub's "Instructions must be no longer than 2 pages" sits inside a `<Limitations>` block of a prompt it ships for *generating* instructions. It constrains a generator rather than an author, and should be cited that way.

**No vendor gives guidance on the number of reference files, and no external figure supplies one either** (Finding 17). Anthropic's own skill-creator states the opposite outright, listing bundled resources as progressive-disclosure level 3: "**Bundled resources** - As needed (unlimited, scripts can execute without loading)." What binds is depth, not count. Finding 17 carries that.

### Finding 15: Two vendors admit weaker models need more

**Evidence:** VENDOR · PORTABLE EVIDENCE

Anthropic says "What works perfectly for Opus might need more detail for Haiku", and carries the checklist item "Tested with Haiku, Sonnet, and Opus".

OpenAI is more mechanistically specific, and this is the new statement. At minimal reasoning effort, "minimal reasoning performance can vary more drastically depending on prompt than higher reasoning levels", and consequently "Disambiguating tool instructions to the maximum extent possible and inserting agentic persistence reminders as shared above, are particularly critical at minimal reasoning". Separately: "Switch to a lower `reasoning_effort`. This reduces exploration depth but improves efficiency and latency."

Both amount to one claim: the cheaper configuration is more prompt-sensitive and explores less. Classified **PORTABLE EVIDENCE**, with the caveat that neither vendor quantifies it. It corroborates Finding 2 and independently supports Finding 3 — the one place the vendor record and this repository's data agree without needing the data.

### Finding 16: Answers to the four questions we commissioned

**Evidence:** VENDOR · PUBLISHED · OURS

**A. Does any vendor say where a pointer should sit?** No. Cursor demonstrates both forms without commenting on the difference. One example rule carries `@migration-template.sql` as a bare trailing line after all the prose. Another puts the pointer inside the instruction: "Add a `@service-template.ts` reference file when creating a new service for the standard boilerplate". A third threads pointers through prose steps: "First create a property to toggle in `@reactiveStorageTypes.ts`." The nearest prior art is Finding 12's filesystem-level proximity rule. Finding 4's placement contrast may be the only evidence on this question that exists.

**B. Has anyone moved from model-initiated reading to attachment on a matched condition?** Yes, near-unanimously (Finding 10). Cursor, Windsurf, Copilot, Continue and Cline match a glob or a path. Gemini CLI matches a touched directory. Codex and Aider load unconditionally. Windsurf ships both regimes and states the context cost of each.

**C. Is there guidance on the number of reference files, or on over-fetching?** On count, nothing from any vendor (Finding 14). On size, everyone caps, in five units. On over-fetching, no vendor measures it, and only OpenAI addresses it, as a setting rather than a defect (Finding 13).

**D. Does any vendor acknowledge degradation on smaller or faster models?** Two do, both without a number (Finding 15). Finding 1's recall table remains the only quantified instance.

### Finding 17: No cap on reference count survives its source

**Evidence:** CORRECTION · MEASURED · SHIPPED-PRACTICE

An earlier draft carried "at most three reference modules outperform larger bundles" as a measured constraint on how many files a skill should bundle. Checked against primary text on 2026-08-24, **that claim does not survive**. It is a category error rather than a wrong number, and it was propagating into authoring guidance.

**What the paper counts.** The sentence is genuine. The current abstract of arXiv 2602.12670 reads "Focused Skills with at most three modules outperform larger or exhaustive bundles", and the v1 abstract words it "Focused Skills with 2-3 modules outperform comprehensive documentation". But *module* is never defined. It occurs three times in 112k characters of full text: once in each abstract phrasing, once in the conclusion, and once meaning something unrelated — "Each task in SkillsBench is a self-contained module comprising four components", which is a task rather than a skill file.

The body evidence is Section 4.2.1, titled **"Skills Quantity Analysis"**. Table 5's column header is **"Skills Count"** and its rows are "1 skill", "2-3 skills" and "4+ skills":

| Skills Count | With Skills | No Skills | Δabs (points) |
|:--|:--|:--|:--|
| 1 skill | 42.2% | 24.4% | +17.8 |
| 2-3 skills | 42.0% | 23.4% | +18.6 |
| 4+ skills | 32.7% | 26.9% | +5.9 |

The paper's Finding 5, verbatim: "2-3 Skills are optimal; more Skills show diminishing returns", supported by "Tasks with 2-3 Skills show the largest improvement (+18.6pp), while 4+ Skills provide only +5.9pp benefit." **A module is a whole skill attached to one task.** The paper says nothing about how many reference files belong inside a skill.

Two caveats survive even on the corrected reading. One skill at +17.8 points is indistinguishable from 2 to 3 skills at +18.6, so the finding is "4 or more attached skills degrades", not "three is optimal". And the three rows carry different no-Skills baselines of 24.4%, 23.4% and 26.9%, so they are different task sets — a stratified observational split, not a controlled manipulation of count over fixed tasks.

Section 4.2.2 is about prose length rather than file count: Detailed 42.7% (+18.8 points, N=1165), Compact 37.6% (+17.1, N=845), Standard 37.1% (+10.1, N=773), Comprehensive 39.9% (**-2.9**, N=140). "Detailed" beats "Compact", so it is not "shorter always wins", and the only negative cell is also the smallest by a factor of five.

**No vendor states a count cap.** Anthropic's best-practices.md, skills.md and overview.md were grepped for every "at most / no more than / maximum of / limit of N (reference|file|module|resource)" construction, returning zero matches. Only size caps exist, already recorded in Finding 8 and Finding 14.

**The real constraint is depth, stated as a mechanism.** From best-practices.md, verbatim: "Keep references one level deep from SKILL.md. All reference files should link directly from SKILL.md to ensure Claude reads complete files when needed", carried as a checklist item, "File references are one level deep". Finding 8 quotes the mechanism behind it: nested references get previewed with `head -100` rather than read whole. **The number of references is unbounded; depth is bounded at one.** What degrades a reference is not that it has siblings. It is whether SKILL.md points at it directly, and whether the file is small enough, or carries a table of contents, that a partial read still returns complete information.

Name the likely origin of the "three" impression so nobody re-derives it: the documentation's own "Good example: One level deep" happens to show exactly three links. Finding 7 establishes that the block illustrates nesting depth rather than a cap.

**What mature skills ship**, counted rather than asked. Across Anthropic's own 20 published skills, counting markdown reference files and excluding SKILL.md: **claude-api ships 66**, theme-factory 10, mcp-builder 4, skill-creator 4, and pdf 2. The document skills carry large bundles of scripts rather than prose: docx 60, pptx 55, xlsx 52, and canvas-design 82 bundled files, none of them markdown references. **Thirteen of the twenty exceed three bundled files.**

Across the whole installed corpus on this machine — 398 unique skills, deduplicated by SKILL.md content hash — total bundled files run median 1, p75 4, p90 10, max 223. Files in `references/` alone run median 1, p75 2, p90 4, max 63. **25.9% exceed three bundled files, 10.6% exceed three `references/` files, and 20.4% ship none at all.** Addy Osmani's agent-skills repository takes a third shape: 23 of its 24 skills bundle nothing, one bundles four, and a repository-level shared `references/` of seven files serves them all.

The ecosystem median of one file is real, and it is not good practice. SkillsBench's Appendix A measured 47,150 deduplicated skills and found "most Skills contain very few files (median of one, concentrated below five)", with 78% being "SKILL.md plus optional resources". The same appendix scored ecosystem mean quality at 6.2 out of 12, and selected only top-quartile skills, at 9 out of 12 or above, for its benchmark. The median describes the many thin community skills, not the mature ones.

**Consequence.** The six references this skill ships are not evidence of a defect, and the earlier recommendation to treat them as one is withdrawn. Whether six is right is a recall question (Finding 1), not a count-threshold question.

### Finding 18: Deleting files derives the denominator

**Evidence:** OURS · MEASURED

Ground truth can be derived from the artifact instead of hand-annotated, by deleting content and watching the score move.

Every recall figure in Finding 1 divides by a hand annotation: someone wrote down, per scenario, which reference it should have opened. That annotation is the weakest link, because a wrong entry moves a file's recall without anything erroring — the fault shape this note's predecessor catalogues. **Measured 2026-08-24.** The per-skill result map lives in the ask-user-question project's ANALYSIS-007. What belongs here is the method, its cost, and its limits.

**The method has two stages.** Stage 1 runs the whole scenario set against two arms: the skill as shipped, and a copy with every reference deleted *and every pointer to them re-worded out of the prose*. Re-worded rather than line-deleted, deliberately. A pointer naming a file that is not there is a different experimental condition from content that was never offered, and a model that tries to read a missing file and fails is not a model that decided it did not need one. The score drop sorts every scenario into needs-something or needs-nothing. Stage 2 then deletes one file at a time, against candidates derived from the scenario's own prompt rather than the full matrix, which attributes each surviving drop to a named file causally.

**It costs a fraction of the full grid.** On this skill: 27 scenarios × 2 runs × 2 arms for stage 1, plus 30 targeted runs for stage 2. A full per-file grid over the same scenario set would cost 324 runs.

**What it returned.** On sonnet, with both arms run concurrently so provider-side drift lands on both: deleting all six references costs 10 points of assertion pass rate, from 82.4% down to 72.5%. Fifteen of 27 scenarios drop. Every one of the six files is causally needed by at least one scenario. Six scenarios validate as negatives by outcome — they need nothing from the references, established by measurement rather than asserted in advance. In stage 2, nine of ten candidate attributions reproduced their stage-1 drop under a single named file, and three candidates were refuted. A scenario carries more than one candidate, so those two counts are not complements.

**The refutations are the more valuable half.** One scenario, three-words-one-concept, was annotated against the wording reference, and deleting that file changes nothing, because sonnet never opens it there in the first place. Its drop comes from elsewhere. **A drop map measures which content a scenario needs. It does not measure whether the pointer to that content fires**, and the two must never be merged. Finding 1's recall metric is about pointer health; this method's output is about content need. A file can be genuinely needed and never opened, which is a missed pointer, or opened and not needed, which is over-fetch. Only running both instruments separates those.

**Three design details, each learned by getting it wrong in the same session.** Run the arms concurrently, or a provider-side shift lands on one arm and reads as an effect. Give each stage-2 scenario two candidates rather than one, because the contrast is what discriminates: one scenario reproduced its drop under minus-failed-question at 0.10 and showed nothing at all under minus-reading-answers at 0.60. And gate completeness on per-run grading compared across arms, never on the headline `assertions_total`. That figure counts only counted runs, and shrinks when runs load the skill via file rather than via the tool; reading its shrinkage as partial grading produced a wrong diagnosis in this session, corrected the same day in the session ledger.

**A fourth design detail, learned later the same day.** Re-wording a pointer out of the prose removes the prose too. Where that prose teaches something rather than only pointing at the file, a stage-2 drop attributes to the file-plus-prose bundle rather than to the file. The instance: a file measured at zero reads across 42 runs on the weaker model still carried an ablation-attributed drop, and only its surrounding body prose could explain that. State every stage-2 attribution as a bundle unless the removed pointer prose was checked for content of its own. Where the prose does teach, split the arms so prose and file are removed separately.

**The split ran 2026-08-24, and added a fifth design detail: re-derive after the base changes.** The three-arm experiment prescribed above executed on this skill's evolved base — tables of contents added, six wording trims — at ten runs per arm. Both halves came back null: shipped 0.700, prose-removed 0.740, file-removed 0.720, against a 15-point threshold set before the run. The bundle attribution taken at n=2 did not reproduce at five times the sample, and noise cannot be separated from base drift after the fact. An ablation-derived attribution is a fact about the artifact version it was measured on. Re-derive ground truth after any base change before spending remedy effort on it, and record the base version beside every attribution row. The affected corpus row was re-derived to an outcome negative the same day.

**What it settles, and what it does not.** The open question is not what the cap on reference count is, but what splitting buys, and it now has exactly one measurement against it: for this artifact, splitting buys 10 points, and per-file necessity is provable rather than assumed. That is one skill on one model, so the general question survives intact. What it retires is the hand annotation, for any skill whose owner will spend the run budget above.

## What is still unknown

**Why the best performer reaches 90% — narrowed 2026-08-24, not closed.** The controlled run Finding 4 called for was executed. Moving one pointer without changing its mention count halved reach rather than helping, at p about 0.20, so placement in its actionable form is refuted rather than merely unproven. What remains undetermined is what *does* explain the gap between the best reference and the worst. Mention count and topic centrality vary together across all six references, both remain live, and neither has been manipulated in a controlled run.

**Whether a firing condition and a stated cost of skipping do anything.** The pointer rule circulating in this ecosystem has no published basis and no vendor analogue. It is untested here and everywhere.

**What the right number of references is for a skill of this shape — now genuinely open, where it previously looked settled.** The three-module figure was the only number in evidence, and it turned out to count whole skills attached to a task rather than bundled files (Finding 17). No vendor states a count cap, so there is no external threshold to replicate against. Shipped practice spans zero to 66 reference files with no published rationale anywhere on that range, so the question is not "what is the cap" but "what does splitting buy". **Partially answered 2026-08-24, in Finding 18**: splitting into the six files this skill ships buys 10 points of assertion pass rate on sonnet, and each of the six is causally needed by at least one scenario, so per-file necessity is provable rather than assumed. The entry stays open because that is one skill on one model. What splitting buys for a skill of a different shape, and where the return stops, are both unmeasured.

**Whether over-fetch carries a cost worth removing.** Opus reads unnecessary files on 37.5% of negative runs, and whether those reads degraded an answer was never measured. An over-fetch costing only tokens is a different problem from one that misleads.

**Whether the hidden-state result transfers.** It was established on tool calls, not on file reads inside a skill.

**What five unreached vendors do**: JetBrains AI, Amazon Q Developer, Zed, Sourcegraph Amp, and Devin's hosted product. Every vendor claim here is scoped to the eight that were reached.

## Observations

### What this repository measured

- [fact] Recall across 27 annotated scenarios run twice per model ranged from 33% to 90% on sonnet and 75% to 100% on opus, against a 456-line SKILL.md carrying six references #recall #measurement
- [problem] Pull rate divides by the wrong number: one reference reads as 5.6% pull rate and 37.5% recall, and the whole gap is scenarios that correctly did not need it #recall #denominator
- [insight] A keep-or-delete verdict computed from a pull rate deletes a well-pointed rare file and keeps an often-relevant file that is routinely missed, so the verdict inherits the defect rather than the data #prune-verdict #metric
- [fact] The two models fail in opposite directions: opus reached 100% recall on five of six references and over-fetched on 3 of 8 negative runs, while sonnet over-fetched on none and reached between 33% and 90% #models #asymmetry
- [insight] A missed pointer is invisible on the stronger model because eager reading opens the file whatever the pointer says, so the weaker model is the only instrument that finds one and an opus-only sweep would have shown five of six at 100% #models #instrument
- [fact] The best-performing reference is the only one pointed to from inside the numbered workflow steps, six times over, while the worst are single pointers in trailing sections #placement #hypothesis
- [insight] Position does not explain the contrast: the trailing sections sit at lines 369 to 439 of 456, which is end-of-context and a favoured retrieval position, so the effect runs opposite to what position predicts #placement #position
- [problem] Mention count and placement vary together across all six references, so the observational placement result was confounded from the start #confound #observational
- [outcome] The controlled placement run of 2026-08-24 refuted the actionable form: moving one pointer into its workflow step with mention count held at one halved reach, 8 of 40 trailing against 4 of 40 in-step at p about 0.20, so placement does not enter guidance and the best performer's 90% recall stays unexplained #placement #refuted
- [fact] No read of a file inside the skill failed, so the low recall figures are genuine non-attempts rather than attempts that errored #confound #cleared
- [fact] Both recall sweeps ran at 54 of 54 delivered, verified from `runs_without_skill=0` and `runs_loaded_via_file=0` in their results files, so the recall table rests on fully-delivered runs and refused loads do not depress it #load-ceiling #resolved
- [insight] A read that errors and a run whose skill body never arrived are unrelated causes that look identical in a recall figure, so quote every recall figure with its delivered-run count; the 18-of-54 ceiling on an earlier sweep of this artifact belongs to a different set of runs taken before the Skill-tool grant #load-ceiling #distinction

### What the published record says

- [problem] Anthropic names the exact failure and leaves the remedy unquantified — if Claude fails to follow references, "Your links might need to be more explicit or prominent" — with no threshold, form or measurement attached to prominent #anthropic #guidance
- [insight] Anthropic's canonical "one level deep" good example is a trailing block of four bare label-plus-filename pointers with no firing condition and no cost of skipping, structurally the exact shape that measured worst here, offered as an illustration of nesting depth because placement is treated as a variable nowhere #anthropic #canonical-example
- [fact] The published framing of SKILL.md as "an overview that points Claude to detailed materials as needed, like a table of contents in an onboarding guide" encourages the collected-list shape by construction #anthropic #framing
- [problem] Published guidance merges the two causes recall separates, offering that a never-accessed file "might be unnecessary or poorly signaled", with no way to tell them apart — the same dead-versus-misleading distinction a sibling survey ranks its findings by #anthropic #conflation
- [fact] The nesting rule rests on a behaviour rather than a preference: when references are nested, Claude "might use commands like head -100 to preview content rather than reading entire files, resulting in incomplete information" #anthropic #mechanism
- [fact] Verified published figures, all unquantified guidance: keep the SKILL.md body under 500 lines, keep references one level deep, and add a table of contents to reference files longer than 100 lines #anthropic #limits
- [risk] The hidden-state result implies pointer wording optimises the wrong stage, since necessity is decodable at 0.89 to 0.96 AUROC while the model still fails to act on it, but it was established on tool calls rather than file reads inside a skill #mechanism #transfer-unverified
- [problem] Lost-in-the-middle predicts the opposite of the placement finding, since the worst references sit where retrieval should be strongest, and prompt-repetition work predicts less benefit than the six-mentions-against-one gap shows; both stay recorded as unresolved contradictions #contradiction #open

### What the vendor survey found

- [insight] Across eight vendors, a Claude skill's reference is the only case where whether a file is read depends on the model deciding to read it, because everyone else removed the decision #survey #central-result
- [fact] Five vendors resolve conditional instruction loading by attaching a file when a condition matches, and Cursor's own table gives both regimes as adjacent rows — "Auto-attached when a matching file is in context" against "Agent reads the description and pulls the rule in when relevant" #vendors #auto-attach
- [fact] Windsurf is the only vendor shipping both regimes side by side with a context-cost column, pricing model-decided reading as "Description always; full content on demand" against glob attachment's "Only when matching files are touched" #windsurf #closest-analogue
- [fact] Gemini CLI attaches twice over: a just-in-time scan when "a tool accesses a file or directory", and `@file.md` imports that enter the text before the model reads #gemini #attachment
- [fact] OpenAI's Codex and Aider have no reference-following mechanism at all — Codex concatenates directory-scoped files to a 32 KiB cap before doing any work, and Aider loads a conventions file from config as read-only #codex #aider
- [decision] Every vendor attachment mechanism is classified MECHANISM-SPECIFIC and none is recommended for adoption, because this repository is Claude-first and a Claude skill opens references only when the model chooses to #classification #claude-first
- [insight] The harness already puts files into context deterministically for its own context files, so the gap is not that it cannot attach — skill references are not wired to that path, which makes every authoring rule a compensation for a missing mechanism #mechanism #gap
- [technique] The only published proximity rule points the same way as the placement data: place overrides "as close to specialized work as possible" and put review rules in the file "closest to the code the rules govern", the same principle at the filesystem level rather than the document level #codex #prior-art
- [technique] One vendor alone addresses over-fetching, framing it as a setting to tune rather than a defect, publishing stop criteria including "Avoid over searching for context" and "Prefer acting over more searching", plus fixed tool-call budgets with a clause permitting an answer that is not fully correct #openai #over-fetch
- [fact] GitHub takes the inverse position, telling authors to add detail "to reduce the amount of searching the agent has to do" and treating model-initiated exploration purely as a cost to design away #github #exploration
- [fact] Every vendor caps instruction volume in a different unit — 500 lines, 12,000 and 6,000 characters hard-enforced, 32 KiB with truncation, import depth 5 — and no vendor gives guidance on the number of reference files #limits #caps
- [fact] Two vendors acknowledge weaker-model degradation, both without a number: "What works perfectly for Opus might need more detail for Haiku", and "minimal reasoning performance can vary more drastically depending on prompt than higher reasoning levels" #models #degradation
- [insight] The premise that an eager model over-fetches by default reframes the 37.5% opus over-fetch as a setting rather than a bug, and independently supports using the weaker model as the detection instrument #openai #corroboration
- [problem] No vendor states where in a document a pointer should sit, and Cursor demonstrates both the trailing and the in-step forms in its own examples without commenting on the difference #placement #not-found
- [fact] The published record holds no frontier-tier comparison of reference-open rates and no measurement of whether repetition or mention count raises open odds; five vendors were not reached, and every vendor claim is scoped to the eight that were #gap #scope

### What the reference-count correction established

- [problem] The three-module claim previously carried as a measured constraint on bundled files does not survive its source: the paper counts whole skills attached to one task, its Table 5 column header is "Skills Count" over rows "1 skill / 2-3 skills / 4+ skills", and the word module appears nowhere in the body evidence #correction #category-error
- [fact] Module is never defined in arXiv 2602.12670, occurring three times in 112k characters of full text — once per abstract phrasing, once in the conclusion, and once meaning a task rather than a skill file #correction #undefined-term
- [insight] Even on the corrected reading the paper supports no threshold of three: one attached skill at +17.8 points is indistinguishable from 2 to 3 at +18.6, so the result is that 4 or more degrades rather than that three is optimal #skillsbench #threshold
- [risk] The three quantity rows carry different no-Skills baselines of 24.4%, 23.4% and 26.9%, so they are different task sets — a stratified observational split rather than a controlled manipulation of count over fixed tasks #skillsbench #confound
- [fact] The paper's companion complexity result is about prose length rather than file count, and does not reduce to shorter-is-better: Detailed scored +18.8 points against Compact's +17.1, and the only negative cell, Comprehensive at -2.9, is also the smallest at N=140 against 773 to 1165 #skillsbench #length
- [fact] No vendor states a cap on reference-file count; Anthropic's best-practices, skills and overview pages return zero matches for every at-most-N construction, and its skill-creator lists bundled resources as progressive-disclosure level 3, "As needed (unlimited, scripts can execute without loading)" #no-cap #anthropic
- [decision] Bound reference depth rather than reference count: the number of references is unbounded and depth is bounded at one, per the published rule "Keep references one level deep from SKILL.md. All reference files should link directly from SKILL.md to ensure Claude reads complete files when needed" #depth #principle
- [insight] The likely origin of the three-file impression is that the published "Good example: One level deep" happens to show exactly three links — an illustration of nesting depth rather than a cap, as a sibling finding establishes #origin #illustration
- [fact] Anthropic's own 20 published skills exceed three bundled files in thirteen cases, and claude-api ships 66 markdown reference files; the large document-skill bundles of 52 to 82 files are scripts and fonts rather than prose references #shipped-practice #anthropic
- [fact] Across 398 unique skills deduplicated by SKILL.md content hash on this machine, bundled files run median 1, p75 4, p90 10 and max 223, with 25.9% exceeding three bundled files, 10.6% exceeding three references-directory files, and 20.4% shipping none #shipped-practice #census
- [technique] A third shipped architecture exists beyond thin skills and fat bundles: Addy Osmani's repository bundles nothing in 23 of 24 skills and serves them all from a repository-level shared references directory of seven files #shipped-practice #shared-pool
- [insight] The ecosystem median of one bundled file describes the many thin community skills rather than good practice, since the same appendix that measured it across 47,150 skills scored ecosystem mean quality at 6.2 out of 12 and selected only top-quartile skills for the benchmark #ecosystem #quality-gap
- [problem] Shipped practice spans zero to 66 reference files with no published rationale anywhere on that range, so the open question is not what the cap is but what splitting buys — measured once as of 2026-08-24, on one skill and one model, and unmeasured everywhere else #open #partially-answered

### What the ablation established

- [technique] Ground truth for which reference a scenario needs is derivable by ablation rather than hand annotation: stage 1 deletes every reference and re-words its pointers out of the prose, sorting scenarios by score drop, and stage 2 deletes one file at a time against prompt-derived candidates to attribute each surviving drop causally #ablation #ground-truth
- [fact] Measured 2026-08-24 on the ask-user-question skill under sonnet with both arms run concurrently: deleting all six references costs 10 points of assertion pass rate, from 82.4% to 72.5%, 15 of 27 scenarios drop, every one of the six files is causally needed by at least one scenario, and six scenarios validate as negatives by outcome #ablation #measurement
- [insight] A drop map measures content need rather than pointer health, and the two must never be merged — one scenario annotated against the wording reference is unaffected by deleting it, because that model never opens it there, so the scenario drops for another reason entirely #ablation #distinction
- [constraint] The design is valid only under three conditions learned in the same session: run the arms concurrently so provider drift lands on both, give each stage-2 scenario two candidates so the contrast discriminates, and gate completeness on per-run grading across arms rather than on the headline counted-runs total, whose shrinkage under file-loaded runs produced a wrong diagnosis corrected the same day #ablation #method-validity
- [fact] The two-stage design costs 27 scenarios × 2 runs × 2 arms plus 30 targeted runs, against 324 runs for a full per-file grid over the same scenario set, which is what makes derived ground truth affordable enough to retire annotation #ablation #cost

## Relations

- pairs_with [[ANALYSIS-004: What Makes a Bundled Reference Get Read]]
- relates_to [[SESSION-2026-08-23_01: Plugin Kit Measurement Tooling Hardening]]

<!-- ANALYSIS-004 carries no inverse edge back to this note. The owner instructed that the original stay byte-identical, so the pairs_with edge is one-way by instruction rather than by oversight. -->
