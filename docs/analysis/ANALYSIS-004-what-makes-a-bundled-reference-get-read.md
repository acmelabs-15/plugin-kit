---
title: "ANALYSIS-004: What Makes a Bundled Reference Get Read"
type: analysis
status: DRAFT
permalink: analysis/analysis-004-what-makes-a-bundled-reference-get-read
tags:
- analysis
- skills
- references
- progressive-disclosure
- vendor-survey
---

# ANALYSIS-004: What Makes a Bundled Reference Get Read

> Every vendor claim below was verified against primary text on 2026-08-24 — raw markdown or locally-stripped HTML, grepped for the exact sentence — rather than against a search summary or a fetch summariser. Each is labelled MEASURED or GUIDANCE, and classified PORTABLE EVIDENCE, TECHNIQUE or MECHANISM-SPECIFIC. Findings 1-5 are this repository's own measurements; 6-9 are published work; 10-15 are the vendor survey; 16 consolidates the four commissioned answers and draws on all three; 17 is a correction, added 2026-08-24, retiring a claim that entered Finding 9 and Finding 14 on a misreading of its source; 18, added 2026-08-24, is this repository's own measurement, and gives the recall metric a derived denominator in place of a hand-annotated one. Open questions are held separately in What Could Not Be Determined.

## Context

A skill that puts content in bundled reference files only works if the model opens them. ANALYSIS-003 established that this harness could not previously tell whether it did — a path comparison left symlinks intact and classified every in-skill read as outside the skill, a load was recorded from the tool request rather than its result, and two halves of one measurement disagreed about what a valid run is. Those are fixed.

This note is the sequel. The instrument now works, and the number it emits turns out to be the wrong number to look at. ANALYSIS-003 records post-fix pull rates between 11% and 59% and a keep-or-prune verdict computed from them; the finding here is that a raw pull rate cannot support that verdict, because it does not distinguish a reference that was rarely needed from one that was needed and missed.

The measured artifact is the ask-user-question skill — 456 lines of SKILL.md, six bundled references. It is the test subject, not the subject. What is at stake is the progressive-disclosure guidance this repository gives every skill it produces, and the standards the skill-creator surface encodes.

The constraint that shapes every conclusion: this repository is Claude-first. Where a vendor practice conflicts with a Claude standard, the Claude standard wins, and nothing below is recommended because it is popular elsewhere.

## Executive Summary

**The metric was wrong, and the correction is cheap.** Recall — reached divided by should-have-reached — separates the two causes a raw pull rate conflates. One reference in the measured skill reads as 5.6% raw and 37.5% recall; the whole of that gap is scenarios that correctly did not need it. Any keep-or-prune decision taken on a raw rate is therefore taken on a number that ranks a well-signposted rare file below a badly-signposted common one.

**The two model tiers fail in opposite directions, which decides how to measure.** Opus reached 100% of what it should have on five of six references, and over-fetched on 37.5% of the runs that should have reached nothing. Sonnet over-fetched on none and missed between a third and two-thirds. A strong model therefore hides a signposting defect by reading eagerly, and the weaker model is the only instrument that detects one. Measuring signposting on the strongest available model measures nothing — which is a fault class of exactly the shape ANALYSIS-003 catalogues, in that the run completes and returns a healthy-looking table.

**The placement hypothesis was tested the same day and refuted in its actionable form.** The best-performing reference is the only one pointed to from inside the numbered workflow steps; the worst are single pointers in trailing sections. Position is not the explanation, and it is worth being precise about why: those sections sit at lines 369-439 of 456, which is end-of-context and a favoured retrieval position, so the effect runs opposite to what position predicts. Mention count and placement are confounded in the observational data — and the controlled run that Finding 4 called for was then executed 2026-08-24: moving the worst reference's single pointer into the workflow step, mention count held at one, HALVED its reach, 8/40 trailing against 4/40 in-step, p≈0.20. No detectable effect, trending against. Placement does not go into guidance; what explains the best performer remains open, with mention count and topic centrality still live.

**The published record names the failure and prescribes nothing measurable.** Anthropic's guidance says that if Claude fails to follow references, "Your links might need to be more explicit or prominent", and never operationalises *prominent*. Sharper: its own canonical worked example of a correct reference block is a trailing manifest of four bare `See [file.md]` lines with no firing condition and no cost of skipping — structurally the exact form that measured worst here. It is offered as an illustration of nesting depth, because placement is not treated as a variable anywhere in the published record.

**The vendor survey's result is a negative one, and it is the most useful thing in the note.** Five vendors — Cursor, Windsurf, GitHub Copilot, Continue and Cline — resolve conditional instruction loading by harness attachment on a matched condition, overwhelmingly a file glob. Gemini CLI does it twice over. OpenAI's Codex and Aider have no reference-following mechanism at all. Across eight vendors, **a Claude skill's bundled reference is the only case where whether a file is read depends on the model deciding to read it.** Every authoring rule this repository writes is therefore a workaround for a missing declarative mechanism, and should be written knowing that.

## Approach

The recall figures come from 27 scenarios, each annotated in advance with which reference it should reach, run twice per model. Recall is reached over should-have-reached; over-fetch is measured separately against four scenarios that should reach nothing, eight runs.

Vendor documentation was retrieved as raw markdown where the site served it and as locally-stripped HTML where it did not, then grepped for the exact sentence before quoting. This was not caution for its own sake: a prior agent on a sibling project had a fetch summariser fabricate a paper's contents, complete with invented experiments and an invented improvement figure. A summariser's paraphrase is not primary text, and the failure mode is the one ANALYSIS-003 is about — a confident answer rather than an error.

**MEASURED** means someone ran an experiment and reports a number. **GUIDANCE** means a vendor asserts it without published evidence. Nearly all vendor material is GUIDANCE, and saying so is part of the finding. **PORTABLE EVIDENCE** transfers regardless of harness; **TECHNIQUE** is adoptable inside Claude conventions; **MECHANISM-SPECIFIC** establishes the shape of the difficulty but cannot be adopted, because a Claude skill loads its references only by the model choosing to read them.

Vendors reached: OpenAI (Codex AGENTS.md docs, the AGENTS.md format site, the GPT-4.1 and GPT-5 prompting guides), Google (Gemini CLI context-file and memory-import docs, Gemini Code Assist review customisation), Cursor, GitHub Copilot, Windsurf, Cline, Continue, Aider. Not reached: JetBrains AI, Amazon Q Developer, Zed, Sourcegraph Amp, Devin's hosted product.

## Findings

### Finding 1: Raw pull rate is the wrong denominator (OURS, MEASURED)

| reference | sonnet | opus | pointer placement |
|:--|:--|:--|:--|
| layout reference | 90% (9/10) | 100% (10/10) | 6 mentions, inside workflow steps 3-4 |
| asking-again reference | 75% (6/8) | 100% (8/8) | 1 mention, trailing section |
| reading-answers reference | 60% (6/10) | 100% (10/10) | 1 mention, trailing section |
| examples file | 50% (2/4) | 100% (4/4) | 2 mentions |
| wording reference | 37.5% (3/8) | 75% (6/8) | 1 mention, trailing section |
| failed-question reference | 33% (2/6) | 100% (6/6) | 1 mention, trailing section |

The wording reference reads as 5.6% of all runs and as 37.5% recall. The entire gap is scenarios that correctly did not need it.

The consequence for this repository is direct rather than theoretical. A raw rate cannot separate *rarely needed* from *needed and missed*, so a keep-or-prune verdict computed from one will prune a file that is well signposted and seldom relevant, and keep a file that is frequently relevant and routinely missed. **This is a denominator defect of the same family ANALYSIS-003 Finding 13 describes** — a figure computed over the wrong population, returning a plausible number rather than an error — and it survived the collector fixes because those fixes corrected *which reads were counted*, not *what they were divided by*.

### Finding 2: The two model tiers fail in opposite directions (OURS, MEASURED)

Opus: 100% recall on five of six references, 75% on the sixth, and over-fetch on 3 of 8 negative runs. Sonnet: over-fetch on 0 of 8, recall between 33% and 90%.

Near-perfect recall with poor precision, against perfect precision with poor recall. The two tiers are not the same instrument reading the same quantity with different noise; they fail in different directions, so a defect visible on one is invisible on the other.

### Finding 3: Therefore the weak model is the detection instrument (OURS, derived)

It follows from Finding 2 that a routing defect cannot be seen on the strong model, because eager reading opens the file whatever the pointer says. Measuring this skill on opus alone would have shown five of six references at 100% and surfaced nothing at all.

This belongs in the same register as ANALYSIS-003's guard-scope finding: a check that returns a healthy verdict from the wrong configuration is worth less than no check, because a passing result is stronger evidence than an absent one. Signposting measured on the strongest available model is that check.

### Finding 4: The placement contrast, stated as a hypothesis rather than a result (OURS, MEASURED but confounded)

The best-performing reference is the only one pointed to from inside the numbered workflow steps, six times. The worst are single pointers in trailing sections.

Position within the file is not the explanation. Those trailing sections sit at lines 369-439 of 456 — end-of-context, which the retrieval literature makes a favoured position. So the effect runs *opposite* to what raw position predicts, which is what makes structural placement rather than positional salience the candidate.

**The honest limit: mention count and placement vary together across all six references.** The best differs from the worst in both at once, and nothing in the observational data separates them.

**Tested 2026-08-24 — the controlled run happened, and it refuted the actionable form.** The worst reference's single trailing pointer was MOVED — not duplicated — into the workflow step where its condition fires, holding mention count at one so the test isolated placement from surface area. Four scenarios, ten attempts each, both arms interleaved at the same concurrency so drift hit both equally. Result: trailing 8/40, in-step 4/40 — moving it in halved the reach, z≈1.27, p≈0.20. The honest reading is no detectable effect with a trend AGAINST the hypothesis. A first underpowered run at 8 per arm returned 2/8 against 2/8 and was not reported as a null, because at that n the only detectable effect is enormous. Placement therefore does not go into guidance, and the best performer's 90% recall still has no explanation — mention count and topic centrality both remain live and untested.

### Finding 5: Both confounds are cleared, and they are two different confounds (OURS, MEASURED)

Zero in-skill reads failed, so the low recall figures are genuine non-attempts rather than attempts that errored. That clears the read confound.

The load confound is a separate question, and it is cleared too — but only because it was checked rather than assumed. A read that errors and a run whose skill body never arrived are unrelated causes that look identical in a recall figure, and ANALYSIS-003 Finding 16 records 18 of 54 runs never receiving the body on a sweep of this artifact, while 27 scenarios run twice is also 54 runs. That coincidence is what made the question worth asking.

**They are not the same runs.** Verified from the results files rather than inferred: the opus sweep behind the recall column reports `runs_without_skill=0`, `runs_loaded_via_file=0` and `countedRuns=54/54`; the sonnet sweep reports the same; the sweep ANALYSIS-003 describes reports `runs_without_skill=18` and `countedRuns=36/54`, and predates the Skill-tool grant that both recall sweeps were taken after. The recall table in Finding 1 therefore rests on a fully-delivered corpus and is not depressed by refused loads.

The distinction is worth keeping now that it has resolved cleanly, because it is what made the question askable in the first place. A recall figure carries no evidence about whether the body reached the model, so it should be quoted with its delivered-run count rather than on its own.

### Finding 6: Anthropic names the failure and leaves the remedy unquantified (PUBLISHED, GUIDANCE)

Verbatim, from the skill-authoring best-practices page, under observing how Claude navigates skills: "**Missed connections**: Does Claude fail to follow references to important files? Your links might need to be more explicit or prominent."

The failure mode is named exactly. No threshold, form, or measurement attaches to *prominent*.

The same list contains the nearest thing to an over-fetch statement anywhere in the survey — "**Overreliance on certain sections**: If Claude repeatedly reads the same file, consider whether that content should be in the main SKILL.md instead" — but that concerns read *frequency*, not reading a file that was not needed. And it offers "**Ignored content**: If Claude never accesses a bundled file, it might be unnecessary or poorly signaled in the main instructions", which conflates precisely the two causes Finding 1's metric separates, and gives no way to tell them apart.

That conflation is the same shape ANALYSIS-002 ranks its findings by: dead surface versus actively misleading surface. An unnecessary reference is dead weight; a needed-and-missed reference misleads, because the skill reads as though the guidance is covered.

### Finding 7: The canonical example is the shape that measured worst (PUBLISHED, GUIDANCE)

The page's "Good example: One level deep" is a trailing block of four bare pointers of the form `**Advanced features**: See [advanced.md](advanced.md)` — a label, a filename, no firing condition, no cost of skipping. Structurally that is the trailing-manifest form which scored 33% to 75% on sonnet here.

The framing encourages it: the page describes SKILL.md as serving "as an overview that points Claude to detailed materials as needed, like a table of contents in an onboarding guide." A table of contents is a collected manifest by construction.

The example is presented as an illustration of nesting depth. Nothing on the page treats where a pointer sits as a variable. Anthropic's two canonical pointer forms also differ from each other, and neither matches the file-plus-firing-condition-plus-cost-of-skipping rule circulating in this ecosystem — **that rule has no published basis anywhere**, and after this survey, no vendor analogue either.

### Finding 8: Anthropic's nesting rule rests on a behavioural claim, not a preference (PUBLISHED, GUIDANCE)

Verbatim: "Claude may partially read files when they're referenced from other referenced files. When encountering nested references, Claude might use commands like `head -100` to preview content rather than reading entire files, resulting in incomplete information."

Worth recording as a mechanism rather than a style rule, because it is consistent with the measured result that a second nesting level never helps and can collapse accuracy from 0.91 to 0.64 (arXiv 2607.17598). Other verified figures from the same page, all GUIDANCE: "Keep SKILL.md body under 500 lines for optimal performance"; "Keep references one level deep from SKILL.md"; "For reference files longer than 100 lines, include a table of contents at the top."

### Finding 9: Prior measured work, including where it disagrees with us (PUBLISHED, MEASURED)

- **Corrected 2026-08-24 — this bullet previously misread its source, and the misreading is the reason Finding 17 exists.** SkillsBench (arXiv 2602.12670) reports that 2-3 *whole skills attached to one task* outperform larger sets. It does not say a skill should bundle at most three reference files. Its Table 5 column header is "Skills Count" over rows "1 skill / 2-3 skills / 4+ skills", and *module* appears nowhere in the body evidence. Nothing in that paper bears on the six references the measured skill ships.
- An explicit ordered workflow instruction beat conditional availability, invocation 44% to 95% and pass 53% to 79% (Vercel's agents-md evaluation). This is the strongest external support for Finding 4, being exactly the difference between *this is available if relevant* and *at this step, do this*.
- Tool necessity is decodable from hidden states at 0.89-0.96 AUROC while models still fail to act on it (arXiv 2605.09252). The implication should not be softened: if the model already represents that it needs the file, rewording the pointer optimises a stage that is not the broken one. Established on tool calls rather than on file reads inside a skill, so its transfer is unverified.
- Lost-in-the-middle (arXiv 2307.03172) predicts the **opposite** of Finding 4, since the worst references sit where retrieval should be strongest. Left as a live contradiction rather than resolved. It is evidence the mechanism is not positional salience.
- Prompt repetition helps non-reasoning inference and goes neutral under reasoning (arXiv 2512.14982), predicting **less** benefit than the six-mentions-against-one gap shows.

### Finding 10: Across eight vendors, only a Claude skill reference is model-decided (VENDOR, the central result)

| vendor | mechanism | who decides |
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

Verbatim, from primary text:

- Cursor's frontmatter behaviour table gives both regimes as adjacent rows. `alwaysApply` false with globs provided: "Auto-attached when a matching file is in context." Description with no globs: "Agent reads the description and pulls the rule in when relevant."
- Windsurf's activation-mode table is the most explicit statement of the trade anyone publishes, because it carries a context-cost column. For `model_decision`: "Only the `description` is shown in the system prompt. Cascade reads the full rule file when it decides the description is relevant", cost "Description always; full content on demand". For `glob`: "Rule is applied when Cascade reads or edits a file matching the `globs` pattern", cost "Only when matching files are touched".
- GitHub Copilot: "At the start of the file, create a frontmatter block containing the `applyTo` keyword. Use glob syntax to specify what files or directories the instructions apply to", and "Instructions are automatically added to requests that you submit to Copilot."
- Continue: "globs (optional): When files are provided as context that match this glob pattern, the rule will be included."
- Cline: "When Cline processes a request, it gathers context from your current work (open files, visible tabs, mentioned paths, edited files), evaluates each rule's conditions, and activates matching rules." Its framing of why is the plainest anyone gives: "It's the difference between handing someone an entire policy manual versus the one page they need right now."
- Gemini CLI: "When a tool accesses a file or directory, the CLI automatically scans for `GEMINI.md` files in that directory and its ancestors up to a trusted root", scoped to "Lets the model discover highly specific instructions for particular components only when they are needed."
- OpenAI Codex: "Codex reads `AGENTS.md` files before doing any work", stopping "once the combined size reaches the limit defined by `project_doc_max_bytes` (32 KiB by default)."
- Aider: "It's best to load the conventions file with `/read CONVENTIONS.md` or `aider --read CONVENTIONS.md`. This way it is marked as read-only, and cached if prompt caching is enabled."

The problem measured here has been designed out of existence everywhere else. Codex and Aider have no reference-following failure mode because they have no reference-following. The five matcher vendors have none for scoped rules because a deterministic matcher decides. Only Windsurf's `model_decision` and Cursor's description-only rule share this regime, and both vendors offer them as one option among four.

Classified **MECHANISM-SPECIFIC**. This is emphatically not a recommendation to adopt globs; it establishes the difficulty rather than the remedy.

### Finding 11: The harness can already attach files — skill references are simply not wired to it (VENDOR, bounding)

Claude Code's own `CLAUDE.md` supports `@path` imports whose content is spliced into context before the model reads anything, verified directly in this environment, where an auto-imported spec arrived as loaded context with no read call. Gemini's documentation describes the same Claude Code behaviour from the outside, noting it "produces a flat, linear document by concatenating all included files".

So the gap is not that the harness cannot attach. It is that a skill author has no declarative way to request attachment for `references/`. This bounds what any authoring rule can be: a compensation for a missing mechanism, not the natural way to author references.

### Finding 12: The only published proximity principle points the way this data does (VENDOR, TECHNIQUE)

Codex is the one vendor that publishes a proximity rule for instructions: "Codex stops searching once it reaches your current directory, so place overrides as close to specialized work as possible." For code review it is more specific: add the rules section "to the `AGENTS.md` closest to the code the rules govern."

That is *put the instruction next to the work it governs*, stated at the filesystem level. Finding 4's hypothesis is the same principle at the document level — put the pointer inside the step that needs the file. Classified **TECHNIQUE**: the principle is adoptable inside Claude conventions even though the mechanism is not, and it is the only published statement pointing this direction.

### Finding 13: Over-fetching is framed as a dial by one vendor and measured by none (VENDOR, TECHNIQUE)

OpenAI's recommended `<context_gathering>` prompt block contains, verbatim, "Avoid over searching for context", "Trace only symbols you'll modify or whose contracts you rely on; avoid transitive expansion unless necessary", and "Prefer acting over more searching." The guide goes further: "you can even set fixed tool call budgets", with a worked example specifying "an absolute maximum of 2 tool calls" plus an escape-hatch clause, "even if it might not be fully correct."

The framing matters more than the tactics. OpenAI's premise is that "GPT-5 is, by default, thorough and comprehensive when trying to gather context in an agentic environment to ensure it will produce a correct answer" — an eager model over-fetches by default, and eagerness is a property you tune. That is GUIDANCE, but it reframes the 37.5% opus over-fetch as a setting rather than a bug.

GitHub takes the inverse position: its instruction-generating prompt lists among its goals "Allow the agent to complete its task more quickly by minimizing the need for exploration using grep, find, str_replace_editor, and code search tools", and tells authors to add detail "to reduce the amount of searching the agent has to do". Model-initiated fetching as a cost to design away, never a behaviour to calibrate.

### Finding 14: Every vendor caps size; none gives a count (VENDOR, GUIDANCE)

Five incompatible units. Cursor: "Keep rules under 500 lines" and "Split large rules into multiple, composable rules". Anthropic: the same 500-line figure for SKILL.md, arrived at independently and with no derivation published on either side. Windsurf, hard-enforced: "Workspace rule files are limited to 12,000 characters each. The global rules file is limited to 6,000 characters." Codex: a 32 KiB byte cap with truncation, advising "Raise the limit or split instructions across nested directories when you hit the cap". Gemini: a configurable maximum import depth defaulting to 5, with the best practice "Keep imports shallow - avoid deeply nested import chains".

GitHub's "Instructions must be no longer than 2 pages" sits inside a `<Limitations>` block of a prompt it ships for *generating* instructions, so it constrains a generator rather than an author, and should be cited that way.

**No vendor gives guidance on the number of reference files, and no external figure supplies one either** (Finding 17). Anthropic's own skill-creator states the opposite outright, listing bundled resources as progressive-disclosure level 3: "**Bundled resources** - As needed (unlimited, scripts can execute without loading)." The constraint that actually binds fan-out is depth, not count — see Finding 17.

### Finding 15: Two vendors acknowledge weaker-model degradation, neither with a number (VENDOR, PORTABLE EVIDENCE)

Anthropic: "What works perfectly for Opus might need more detail for Haiku", with the checklist item "Tested with Haiku, Sonnet, and Opus".

OpenAI is more mechanistically specific, and this is the new one: at minimal reasoning effort, "minimal reasoning performance can vary more drastically depending on prompt than higher reasoning levels", and consequently "Disambiguating tool instructions to the maximum extent possible and inserting agentic persistence reminders as shared above, are particularly critical at minimal reasoning". Separately, "Switch to a lower `reasoning_effort`. This reduces exploration depth but improves efficiency and latency."

Both amount to one claim: the cheaper configuration is more prompt-sensitive and explores less. Classified **PORTABLE EVIDENCE** with the caveat that neither vendor quantifies it. It corroborates Finding 2 and independently supports Finding 3 — which is the one place the vendor record and this repository's data agree without needing the data.

### Finding 16: Direct answers to the four questions the survey was commissioned to settle

**A. Does any vendor say where a pointer should sit?** No. Cursor demonstrates both forms without commenting on the difference: one example rule carries `@migration-template.sql` as a bare trailing line after all prose, another puts the pointer inside the instruction — "Add a `@service-template.ts` reference file when creating a new service for the standard boilerplate" — and a third threads pointers through prose steps, "First create a property to toggle in `@reactiveStorageTypes.ts`." The nearest prior art is Finding 12's filesystem-level proximity principle. The placement contrast in Finding 4 may be the only evidence on this question that exists.

**B. Has anyone moved from model-initiated reading to harness auto-attachment on a matched condition?** Yes, near-unanimously — Finding 10. Cursor, Windsurf, Copilot, Continue and Cline match a glob or path; Gemini CLI matches a touched directory; Codex and Aider load unconditionally. Windsurf ships both regimes and prices them.

**C. Guidance on the number of reference files, or on over-fetching?** On count, nothing from any vendor (Finding 14). On size, everyone caps, in five units. On over-fetching, no vendor measures it and only OpenAI addresses it, as a dial rather than a defect (Finding 13).

**D. Any vendor acknowledging degradation on smaller or faster models?** Two, both unquantified (Finding 15). The recall table in Finding 1 remains the only quantified instance.

### Finding 17: There is no defensible cap on reference count — the three-module figure counts something else (CORRECTION, MEASURED + SHIPPED-PRACTICE)

An earlier draft of this note carried "at most three reference modules outperform larger bundles" as a measured constraint on how many files a skill should bundle. Verified against primary text on 2026-08-24, **that claim does not survive**. It is a category error rather than a wrong number, and it was propagating into authoring guidance.

**What the paper counts.** The sentence is genuine — the current abstract of arXiv 2602.12670 reads "Focused Skills with at most three modules outperform larger or exhaustive bundles", and the v1 abstract words it "Focused Skills with 2-3 modules outperform comprehensive documentation". But *module* is never defined. It occurs three times in 112k characters of full text: once in each abstract phrasing, once in the conclusion, and once meaning something unrelated — "Each task in SkillsBench is a self-contained module comprising four components", which is a task, not a skill file.

The body evidence is Section 4.2.1, titled **"Skills Quantity Analysis"**. Table 5's column header is **"Skills Count"** and its rows are "1 skill", "2-3 skills", "4+ skills":

| Skills Count | With Skills | No Skills | Δabs |
|:--|:--|:--|:--|
| 1 skill | 42.2% | 24.4% | +17.8 |
| 2-3 skills | 42.0% | 23.4% | +18.6 |
| 4+ skills | 32.7% | 26.9% | +5.9 |

Finding 5 verbatim: "2-3 Skills are optimal; more Skills show diminishing returns", supported by "Tasks with 2-3 Skills show the largest improvement (+18.6pp), while 4+ Skills provide only +5.9pp benefit." **A module is a whole skill attached to one task.** The paper says nothing about how many reference files belong inside a skill.

Two caveats survive even on the corrected reading. One skill (+17.8) is indistinguishable from 2-3 (+18.6), so the finding is "4+ attached skills degrades", not "three is optimal". And the three strata carry different no-Skills baselines (24.4 / 23.4 / 26.9), so they are different task sets — a stratified observational split, not a controlled manipulation of count over fixed tasks.

Section 4.2.2 is about prose length, not file count: Detailed 42.7% (+18.8, N=1165), Compact 37.6% (+17.1, N=845), Standard 37.1% (+10.1, N=773), Comprehensive 39.9% (**-2.9**, N=140). "Detailed" beats "Compact", so it is not "shorter always wins", and the only negative cell is also the smallest by a factor of five.

**No vendor states a count cap.** Anthropic's best-practices.md, skills.md and overview.md were grepped for every "at most / no more than / maximum of / limit of N (reference|file|module|resource)" construction: zero matches. Only size caps exist, already recorded in Finding 8 and Finding 14.

**The real constraint is depth, and it is stated as a mechanism.** From best-practices.md, verbatim: "Keep references one level deep from SKILL.md. All reference files should link directly from SKILL.md to ensure Claude reads complete files when needed", carried as a checklist item, "File references are one level deep". The mechanism behind it is already quoted in Finding 8 — nested references get previewed with `head -100` rather than read whole. **Fan-out is unbounded; depth is bounded at one.** What degrades a reference is not the existence of siblings but whether SKILL.md points at it directly, and whether it is small enough or has a table of contents so a partial read still returns complete information.

A likely origin for the "three" impression, worth naming so it is not re-derived: the docs' own "Good example: One level deep" happens to show exactly three links. Finding 7 already establishes that block is an illustration of nesting depth, not a cap.

**What mature skills actually ship**, counted rather than asked. Anthropic's own 20 published skills, markdown reference files excluding SKILL.md: **claude-api ships 66**, theme-factory 10, mcp-builder 4, skill-creator 4, pdf 2. The document skills carry large bundles that are scripts rather than prose — docx 60, pptx 55, xlsx 52, canvas-design 82 bundled files, none of them markdown references. **Thirteen of the twenty exceed three bundled files.**

Across the whole installed corpus on this machine — 398 unique skills deduped by SKILL.md content hash — total bundled files run median 1, p75 4, p90 10, max 223; `references/` files alone run median 1, p75 2, p90 4, max 63. **25.9% exceed three bundled files, 10.6% exceed three `references/` files, and 20.4% ship none at all.** Addy Osmani's agent-skills repository takes a third shape: 23 of its 24 skills bundle nothing, one bundles four, and a repository-level shared `references/` of seven files serves all of them.

The ecosystem median of one file is real but should not be read as good practice. SkillsBench's own Appendix A measured 47,150 deduplicated skills and found "most Skills contain very few files (median of one, concentrated below five)" with 78% being "SKILL.md plus optional resources" — while scoring ecosystem mean quality at 6.2/12 and deliberately selecting only top-quartile skills (>= 9/12) for its benchmark. The median describes the mass of thin community skills, not the mature ones.

**Consequence for this repository.** The six references the measured skill ships are not evidence of a defect, and the earlier recommendation to treat them as one is withdrawn. Whether six is right for that skill is a question for the recall data in Finding 1, not for a count threshold.

### Finding 18: The recall denominator is derivable by ablation, which retires the hand annotation (OURS, MEASURED)

Every recall figure in Finding 1 divides by a hand annotation — someone wrote down, per scenario, which reference it should have reached. That annotation is the weakest link in the metric: a wrong entry moves a file's recall without anything erroring, which is the fault shape this note's predecessor catalogues. **Measured 2026-08-24: the denominator can be derived from the artifact instead, by removing content and watching the score move.** The per-skill result map that produced lives in the ask-user-question project's ANALYSIS-007; what belongs here is the method, its cost, and its limits.

**The method, in two stages.** Stage 1 runs the whole scenario set against two arms — the skill as shipped, and a copy with every reference file removed *and every pointer to them re-worded out of the prose*. Re-worded rather than line-deleted, deliberately: a pointer naming a file that is not there is a different experimental condition than content that was never offered, and a model that tries to read a missing file and fails is not a model that decided it did not need one. The score drop sorts every scenario into needs-something or needs-nothing. Stage 2 then removes one file at a time, but only against candidates derived from the scenario's own prompt rather than the full matrix, which attributes each surviving drop to a named file causally.

**It costs a fraction of the grid.** On the measured skill: 27 scenarios × 2 runs × 2 arms for stage 1, plus 30 targeted runs for stage 2 — against 324 runs for a full per-file grid over the same corpus.

**What it returned.** On sonnet, with the two arms run concurrently so provider-side drift lands on both: stripping all six references costs 10 points of assertion pass rate, 82.4% down to 72.5%. Fifteen of 27 scenarios drop. Every one of the six bundled files is causally needed by at least one scenario. Six scenarios validate as negatives by outcome — they need nothing from the references, established by measurement rather than asserted in advance. In stage 2, nine of ten candidate attributions reproduced their stage-1 drop under a single named file, and three candidates were refuted; a scenario carries more than one candidate, so those two counts are not complements.

**The refutations are the more valuable half.** One scenario — three-words-one-concept — was annotated against the wording reference, and removing that file changes nothing, because sonnet never reads it there in the first place. Its drop comes from elsewhere. **A drop map measures which content a scenario needs; it does not measure whether the pointer to that content fires**, and the two must not be conflated. Finding 1's recall metric is about pointer health; this method's output is about content need. A file can be genuinely needed and never reached, which is a signposting defect, or reached and not needed, which is over-fetch — and only running both instruments separates those.

**Three design details, each learned the hard way in the same session.** Run the arms concurrently, or a provider-side shift lands on one arm and reads as an effect. Give each stage-2 scenario two candidates rather than one, because the contrast is what discriminates — one scenario reproduced its drop under minus-failed-question at 0.10 and showed nothing at all under minus-reading-answers at 0.60. And gate completeness on per-run grading compared across arms, never on the headline `assertions_total`: that figure counts only counted runs and shrinks when runs load the skill via file rather than via the tool, and reading its shrinkage as partial grading produced a wrong diagnosis in this session, corrected the same day in the session ledger.

**A fourth design detail, learned later the same day.** Re-wording a pointer out of the prose removes the prose too, and where that prose is instructive rather than merely deictic, a stage-2 drop attributes to the file-plus-prose bundle rather than to the file. The instance: a file measured at zero reads across 42 runs on the weaker tier nonetheless carried an ablation-attributed drop, which only its surrounding body prose could explain. State every stage-2 attribution as a bundle unless the removed pointer prose was checked for content of its own — and where the prose does teach, split the arms so prose and file are removed separately.

**The split was run, 2026-08-24, and it added a fifth design detail: re-derive after base drift.** The three-arm experiment this paragraph prescribes executed on the measured skill's evolved base (tables of contents added, six wording trims) at n=10 per arm — and both halves came back null: shipped 0.700, prose-removed 0.740, file-removed 0.720, against a registered 15-point threshold. The n=2 bundle attribution did not reproduce at five times the sample, and noise versus base drift cannot be separated after the fact. The lesson for the method: an ablation-derived attribution is a fact about the artifact version it was measured on, so re-derive ground truth after any base change before spending remedy effort on it, and record the base version beside every attribution row. The affected corpus row was re-derived to an outcome negative the same day.

**What it settles, and what it does not.** The open question below is not what the cap on reference count is but what splitting buys, and it now has exactly one measurement against it: for this artifact, splitting buys 10 points, and per-file necessity is provable rather than assumed. That is n=1 skill on one model, so the general question survives intact. What it retires is the hand annotation, for any skill anyone is willing to spend the run budget above on.

## What Could Not Be Determined

- **What explains the best performer's 90% recall — narrowed 2026-08-24, not closed.** The controlled run Finding 4 called for was executed: moving one pointer without changing its count halved reach rather than helping, p≈0.20, so placement in its actionable form is refuted rather than merely unproven. What remains undetermined is what DOES explain the gap between the best reference and the worst — mention count and topic centrality vary together across all six references, both remain live, and neither has been manipulated in a controlled run.
- **Whether a firing condition and a stated cost of skipping do anything.** The pointer rule circulating in this ecosystem has no published basis and no vendor analogue. Untested here and everywhere.
- **What the right number of references is for a skill of this shape — now genuinely open, where it previously looked settled.** The three-module figure was the only number in evidence and it turned out to count whole skills attached to a task, not bundled files (Finding 17). No vendor states a count cap, so there is no external threshold to replicate against. Shipped practice spans zero to 66 reference files with no published rationale at any point on that range, which means the question is not "what is the cap" but "what does splitting buy". **Partially answered 2026-08-24 — see Finding 18**: splitting into the six files this skill ships buys 10 points of assertion pass rate on sonnet, and each of the six is causally needed by at least one scenario, so per-file necessity is now provable rather than assumed. The entry stays open because that is n=1 skill on one model: what splitting buys for a skill of a different shape, and where the return stops, are both still unmeasured.
- **Whether over-fetch carries a cost worth removing.** Opus reads unnecessary files on 37.5% of negative runs, but whether those reads degraded an answer was never measured. An over-fetch costing only tokens is a different problem from one that misleads.
- **Whether the hidden-state result transfers.** Established on tool calls, not on file reads inside a skill.
- **Five vendors not reached**: JetBrains AI, Amazon Q Developer, Zed, Sourcegraph Amp, Devin's hosted product. Every vendor claim here is scoped to the eight that were.

## Recommendations

1. **Report recall, never raw pull rate, and re-derive any keep-or-prune verdict that was taken on a raw rate** (Finding 1). The 5.6%-against-37.5% gap is not rounding; it inverts the ranking of which reference is in trouble.
2. **Run signposting measurements on the weaker model** (Findings 2, 3, 15). Measuring this skill on opus alone would have shown five of six references at 100% and hidden every problem.
3. **Executed 2026-08-24 — and the result forbids the rule rather than licensing it** (Finding 4). The experiment this recommendation called for was run exactly as specified: one trailing pointer moved inside the step that needs it, mention count held fixed, re-measured on sonnet at 40 attempts per arm. Reach HALVED, p≈0.20 — no detectable effect, trending against. Do not write placement into any standard. The correlation, the external result and the filesystem-level analogue all pointed one way and the controlled run did not follow them, which is precisely why the experiment had to precede the rule.
4. **Withdrawn 2026-08-24 — replaced by: bound reference depth, never reference count** (Finding 17). This recommendation previously read "treat six references as a live defect pending replication", on the basis that external measured work contradicted the shipped artifact. It does not: the three-module figure counts whole skills attached to a task, not files bundled inside one. No count cap is stated by any vendor, Anthropic's skill-creator calls bundled resources "unlimited", and Anthropic's own claude-api skill ships 66 reference files. Write the principle instead — every reference linked directly from SKILL.md, each file independently readable with a table of contents past ~100 lines, and splits driven by what one task needs to read rather than by a target count. Whether six is right for the measured skill is a recall question (Finding 1), not a threshold question.
5. **Prefer an explicit stop rule over wording a pointer more weakly** (Finding 13). Stop criteria and fetch budgets are adoptable inside a SKILL.md; discouraging a read by softening its pointer is not a mechanism anyone has shown to work.
6. **Write the guidance knowing it is a workaround** (Finding 11). The harness attaches files deterministically for its own context files and not for skill references. Any rule authored here compensates for a missing declarative mechanism and should say so rather than presenting itself as the natural way to author references.

## Observations

### What this repository measured

- [fact] Per-reference recall across 27 annotated scenarios run twice per model ranged from 33% to 90% on sonnet and 75% to 100% on opus, against a 456-line SKILL.md carrying six bundled references #recall #measurement
- [problem] Raw pull rate is the wrong denominator: one reference reads as 5.6% raw and 37.5% recall, and the whole gap is scenarios that correctly did not need it #recall #denominator
- [insight] A keep-or-prune verdict computed from a raw rate prunes a well-signposted rare file and keeps a frequently-relevant file that is routinely missed, so the verdict inherits the defect rather than the data #prune-verdict #metric
- [fact] The two model tiers fail in opposite directions — opus 100% recall on five of six references with over-fetch on 3 of 8 negative runs, sonnet zero over-fetch and recall between 33% and 90% #models #asymmetry
- [insight] A routing defect is invisible on the strong model because eager reading opens the file whatever the pointer says, so the weaker model is the only instrument that detects one and an opus-only sweep would have shown five of six at 100% #models #instrument
- [fact] The best-performing reference is the only one pointed to from inside the numbered workflow steps, six times, while the worst are single pointers in trailing sections #placement #hypothesis
- [insight] Position is not the explanation: the trailing sections sit at lines 369-439 of 456, which is end-of-context and a favoured retrieval position, so the effect runs opposite to what position predicts #placement #position
- [problem] Mention count and placement vary together across all six references, so the observational placement result was confounded from the start #confound #observational
- [outcome] The controlled placement run executed 2026-08-24 refuted the actionable form: one pointer moved into its workflow step with mention count held at one HALVED reach, 8/40 trailing against 4/40 in-step, p≈0.20 — no detectable effect, trending against, so placement does not enter guidance and the best performer's 90% recall remains unexplained #placement #refuted
- [fact] Zero in-skill reads failed, so the low recall figures are genuine non-attempts rather than attempts that errored #confound #cleared
- [fact] Both recall sweeps ran at 54/54 delivered, verified from `runs_without_skill=0` and `runs_loaded_via_file=0` in their results files, so the recall table rests on a fully-delivered corpus and is not depressed by refused loads #load-ceiling #resolved
- [insight] A read that errors and a run whose skill body never arrived are unrelated causes that look identical in a recall figure, so a recall figure should be quoted with its delivered-run count; the 18-of-54 ceiling recorded on an earlier sweep of this artifact belongs to a different corpus taken before the Skill-tool grant #load-ceiling #distinction

### What the published record says

- [problem] Anthropic names the exact failure and leaves the remedy unquantified — if Claude fails to follow references, "Your links might need to be more explicit or prominent" — with no threshold, form or measurement attached to prominent #anthropic #guidance
- [insight] Anthropic's canonical "one level deep" good example is a trailing block of four bare label-plus-filename pointers with no firing condition and no cost of skipping, structurally the exact form that measured worst here, and it is offered as an illustration of nesting depth because placement is not treated as a variable anywhere #anthropic #canonical-example
- [fact] The published framing of SKILL.md as "an overview that points Claude to detailed materials as needed, like a table of contents in an onboarding guide" encourages the collected-manifest shape by construction #anthropic #framing
- [problem] Published guidance conflates the two causes recall separates, offering that a never-accessed file "might be unnecessary or poorly signaled" with no way to tell them apart — the same dead-versus-misleading distinction a sibling survey ranks its findings by #anthropic #conflation
- [fact] The nesting rule rests on a behavioural claim rather than a preference: Claude "might use commands like head -100 to preview content rather than reading entire files, resulting in incomplete information" when references are nested #anthropic #mechanism
- [fact] Verified published figures, all unquantified guidance: SKILL.md body under 500 lines, references one level deep, a table of contents for reference files longer than 100 lines #anthropic #limits
- [risk] The hidden-state result implies pointer wording optimises the wrong stage — necessity is decodable at 0.89-0.96 AUROC while the model still fails to act — but it was established on tool calls rather than on file reads inside a skill #mechanism #transfer-unverified
- [problem] Lost-in-the-middle predicts the opposite of the placement finding since the worst references sit where retrieval should be strongest, and prompt-repetition work predicts less benefit than the six-mentions-against-one gap shows; both are recorded as live contradictions rather than resolved #contradiction #open

### What the vendor survey found

- [insight] Across eight vendors, a Claude skill's bundled reference is the only case where whether a file is read depends on the model deciding to read it; everyone else designed the decision out #survey #central-result
- [fact] Five vendors resolve conditional instruction loading by harness attachment on a matched condition, and Cursor's own table gives both regimes as adjacent rows — "Auto-attached when a matching file is in context" against "Agent reads the description and pulls the rule in when relevant" #vendors #auto-attach
- [fact] Windsurf is the only vendor shipping both regimes side by side with a context-cost column, pricing model-decided reading as "Description always; full content on demand" against glob attachment's "Only when matching files are touched" #windsurf #closest-analogue
- [fact] Gemini CLI attaches twice over — a just-in-time scan when "a tool accesses a file or directory", and `@file.md` imports spliced into the text before the model reads #gemini #attachment
- [fact] OpenAI's Codex and Aider have no reference-following mechanism at all: Codex concatenates directory-scoped files to a 32 KiB cap before doing any work, Aider loads a conventions file from config as read-only #codex #aider
- [decision] Every vendor attachment mechanism is classified MECHANISM-SPECIFIC and none is recommended for adoption, since this repository is Claude-first and a Claude skill loads references only by the model choosing to read them #classification #claude-first
- [insight] The harness already splices files into context deterministically for its own context files, so the gap is not that it cannot attach — skill references are not wired to that path, which makes every authoring rule a compensation for a missing declarative mechanism #mechanism #gap
- [technique] The only published proximity principle points the same way as the placement data: place overrides "as close to specialized work as possible" and put review rules in the file "closest to the code the rules govern" — the same principle at the filesystem level rather than the document level #codex #prior-art
- [technique] One vendor alone addresses over-fetching and frames it as a tunable dial rather than a defect, publishing stop criteria including "Avoid over searching for context" and "Prefer acting over more searching", plus fixed tool-call budgets with an escape-hatch clause #openai #over-fetch
- [fact] GitHub takes the inverse position, telling authors to add detail "to reduce the amount of searching the agent has to do" and treating model-initiated exploration purely as a cost to design away #github #exploration
- [fact] Every vendor caps instruction volume in a different unit — 500 lines, 12,000 and 6,000 characters hard-enforced, 32 KiB with truncation, import depth 5 — and no vendor gives guidance on the number of reference files #limits #caps
- [fact] Two vendors acknowledge weaker-model degradation, both unquantified: "What works perfectly for Opus might need more detail for Haiku", and "minimal reasoning performance can vary more drastically depending on prompt than higher reasoning levels" #models #degradation
- [insight] The premise that an eager model over-fetches by default reframes the 37.5% opus over-fetch as a setting rather than a bug, and independently supports using the weaker model as the detection instrument #openai #corroboration
- [problem] No vendor states where in a document a pointer should sit, and Cursor demonstrates both the trailing and in-step forms in its own examples without commenting on the difference #placement #not-found
- [fact] No frontier-tier comparison of reference-open rates exists in the published record, and no measurement of whether repetition or surface area raises open odds; five vendors were not reached and every vendor claim is scoped to the eight that were #gap #scope

### What the reference-count correction established

- [problem] The three-module claim this note previously carried as a measured constraint on bundled files does not survive its source: the paper counts whole skills attached to one task, its Table 5 column header is "Skills Count" over rows "1 skill / 2-3 skills / 4+ skills", and the word module appears nowhere in the body evidence #correction #category-error
- [fact] Module is never defined in arXiv 2602.12670, occurring three times in 112k characters of full text — once per abstract phrasing, once in the conclusion, and once meaning a task rather than a skill file #correction #undefined-term
- [insight] Even on the corrected reading the paper does not support a threshold of three: one attached skill (+17.8pp) is indistinguishable from 2-3 (+18.6pp), so the result is that 4+ degrades rather than that three is optimal #skillsbench #threshold
- [risk] The three quantity strata carry different no-Skills baselines of 24.4%, 23.4% and 26.9%, so they are different task sets — a stratified observational split rather than a controlled manipulation of count over fixed tasks #skillsbench #confound
- [fact] The paper's companion complexity result is about prose length, not file count, and does not reduce to shorter-is-better: Detailed scored +18.8pp against Compact's +17.1pp, and the only negative cell, Comprehensive at -2.9pp, is also the smallest at N=140 against 773-1165 #skillsbench #length
- [fact] No vendor states a cap on reference-file count; Anthropic's best-practices, skills and overview pages return zero matches for every at-most-N construction, and its skill-creator lists bundled resources as progressive-disclosure level 3, "As needed (unlimited, scripts can execute without loading)" #no-cap #anthropic
- [decision] Bound reference depth rather than reference count: fan-out is unbounded, depth is bounded at one, per the published rule "Keep references one level deep from SKILL.md. All reference files should link directly from SKILL.md to ensure Claude reads complete files when needed" #depth #principle
- [insight] The likely origin of the three-file impression is that the published "Good example: One level deep" happens to show exactly three links — an illustration of nesting depth, not a cap, as a sibling finding already establishes #origin #illustration
- [fact] Anthropic's own 20 published skills exceed three bundled files in thirteen cases, and claude-api ships 66 markdown reference files; the large document-skill bundles of 52 to 82 files are scripts and fonts rather than prose references #shipped-practice #anthropic
- [fact] Across 398 unique skills deduped by SKILL.md content hash on this machine, bundled files run median 1, p75 4, p90 10, max 223, with 25.9% exceeding three bundled files, 10.6% exceeding three references-directory files, and 20.4% shipping none #shipped-practice #census
- [technique] A third shipped architecture exists beyond thin skills and fat bundles: Addy Osmani's repository bundles nothing in 23 of 24 skills and serves them all from a repository-level shared references directory of seven files #shipped-practice #shared-pool
- [insight] The ecosystem median of one bundled file describes the mass of thin community skills rather than good practice, since the same appendix that measured it across 47,150 skills scored ecosystem mean quality at 6.2/12 and selected only top-quartile skills for the benchmark #ecosystem #quality-gap
- [problem] Shipped practice spans zero to 66 reference files with no published rationale anywhere on that range, so the open question is not what the cap is but what splitting buys — measured once as of 2026-08-24, on one skill and one model, and unmeasured everywhere else #open #partially-answered

### What the ablation established

- [technique] Ground truth for which reference a scenario needs is derivable by ablation rather than hand annotation: stage 1 strips every reference and re-words its pointers out of the prose, sorting scenarios by score drop, and stage 2 removes one file at a time against prompt-derived candidates to attribute each surviving drop causally #ablation #ground-truth
- [fact] Measured 2026-08-24 on the ask-user-question skill under sonnet with both arms run concurrently: stripping all six references costs 10 points of assertion pass rate, 82.4% to 72.5%, 15 of 27 scenarios drop, every one of the six files is causally needed by at least one scenario, and six scenarios validate as negatives by outcome #ablation #measurement
- [insight] A drop map measures content need, not pointer health, and the two must not be conflated — one scenario annotated against the wording reference is unaffected by removing it because that model never reads it there, so the scenario drops for another reason entirely #ablation #distinction
- [constraint] The design is valid only under three conditions learned in the same session: arms run concurrently so provider drift lands on both, two candidates per stage-2 scenario so the contrast discriminates, and completeness gated on per-run grading across arms rather than on the headline counted-runs total, whose shrinkage under file-loaded runs produced a wrong diagnosis corrected the same day #ablation #method-validity
- [fact] The two-stage design costs 27 scenarios × 2 runs × 2 arms plus 30 targeted runs against 324 runs for a full per-file grid over the same corpus, which is what makes derived ground truth affordable enough to retire annotation #ablation #cost

## Relations

- extends [[ANALYSIS-003: Measurement Fault Classes]]
- pairs_with [[ANALYSIS-002: Inert Parameter and Flag Survey]]
- depends_on [[SESSION-2026-08-23_01: Plugin Kit Measurement Tooling Hardening]]
- extended_by [[ANALYSIS-005: Structural Genres of Skill Content]]
