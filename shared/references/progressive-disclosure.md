# Progressive disclosure: what goes where, and how big things get

Skills load in three levels, and the whole point of the directory taxonomy is to control which level a given file lands in:

1. **Metadata** (`name` + `description`) — always in context, for every installed skill
2. **SKILL.md body** — in context whenever the skill triggers
3. **Bundled files** — only when needed, and scripts can execute without entering context at all

**What this is optimizing toward:** every reference loading as close to 100% of the times it is supposed to — recall approaching 1.0 over the runs that need it — with the body's token budget standing as the constraint. The constraint is what keeps the target honest: recall goes to 1.0 the moment you inline everything, and a skill that has done that has abandoned progressive disclosure rather than optimized it.

Every rule below carries what backs it. **(published, Anthropic)** is a documented mechanism, quoted. **(published guidance, unquantified)** is asserted by Anthropic without published evidence or derivation, whether or not it names a number. **(house rule)** is this repository's own, and says what it rests on. **(measured here)** means this repository ran the experiment and reports the number. **(unmeasured)** means the rule is held because it is coherent, not because anyone tested it. Several rules that lived here for a long time turned out to belong in that last category once someone checked, and two of them were wrong.

## Table of Contents

- [Size limits](#size-limits)
- [What survives compaction](#what-survives-compaction)
- [Fan-out is unbounded; depth is bounded at one](#fan-out-is-unbounded-depth-is-bounded-at-one)
- [Pointers, and what is actually known about them](#pointers-and-what-is-actually-known-about-them)
- [Author for the weaker tier](#author-for-the-weaker-tier)
- [Two things that belong in the body regardless of size](#two-things-that-belong-in-the-body-regardless-of-size)
- [Diagrams cost tokens on every invocation](#diagrams-cost-tokens-on-every-invocation)
- [The taxonomy is decided by load mode, not content genre](#the-taxonomy-is-decided-by-load-mode-not-content-genre)
- [The placement rule](#the-placement-rule)
- [The status of `examples/`](#the-status-of-examples)
- [When a fifth directory earns its place](#when-a-fifth-directory-earns-its-place)

---

## Size limits

**SKILL.md: under 500 lines** (published guidance, unquantified) **and under 5,000 tokens** (house rule, derived from the published compaction boundary below). Both, not either. They are not redundant — a 480-line file with long paragraphs can be 7,000 tokens and blow the budget while passing the line check. Measure both.

Only the line figure is Anthropic's, and it ships with no derivation. The token figure is this repository's own gate, and it is the half with a mechanism under it: 5,000 tokens is exactly where compaction stops retaining a skill, below. Both are enforced as warnings by `shared/validate/validate-skill.ts`.

When you approach the limit, the answer is another layer of hierarchy with clear pointers about where to go next, not tighter prose (unmeasured). Move detail into `references/` and leave a sentence in SKILL.md saying what is in there and when to read it.

**Reference files can be large** (published guidance, unquantified). A 2,000-line `references/api.md` is fine — it is only paid for when read. Past roughly 100 lines it carries a table of contents in the standard form specified immediately below, for a mechanical reason given under depth later on. Telling SKILL.md what to grep for instead — "search `references/tables.md` for the table name" — costs a fraction of reading it, and nobody has tested whether the model complies (unmeasured).

**The table of contents has a standard form** (house rule, locked 2026-08-24). A literal `## Table of Contents` heading, then a flat bulleted list of GitHub-style anchor links naming every H2 section in document order — no nesting, no tables, H2 entries only, and the table of contents itself excluded — placed after the H1 and the file's orientation prose. That heading is **the first H2 in the file**, and the position is stated that way because it is deliberately checkable: a reader or a validator confirms it by finding the first line that opens a section, with no judgement involved.

```markdown
- [Size limits](#size-limits)
- [What survives compaction](#what-survives-compaction)
```

Whole-specimen files are exempt — an `examples/` file whose content *is* the artifact, carrying no H1 and no wrapper prose around it. Injecting a map into one edits the specimen somebody is meant to copy, and specimen content is consumed whole rather than partially read, so the mechanism that motivates the rule does not reach it.

The heading-plus-bullets shell is deliberate rather than cosmetic. It is the deterministic signature the validator checks for, so a file carrying the same map in any other form — a prose sentence naming the sections, a table, a nested list — reads as missing one.

**Information lives in one place** (unmeasured). If something is in SKILL.md *and* in a reference file, one of them will drift and the model will read both. Prefer the reference file for anything detailed, and keep SKILL.md to procedure, workflow and pointers.

---

## What survives compaction

Auto-compaction does not simply drop a skill, and what it keeps is documented precisely. Per the skill content lifecycle in Anthropic's Claude Code skills documentation (`code.claude.com/docs/en/skills`), compaction re-attaches "the most recent invocation of each skill after the summary, keeping the first 5,000 tokens of each"; re-attached skills "share a combined budget of 25,000 tokens", filled newest-first, with a skill that does not fit dropped whole rather than truncated further; and re-invoking a skill after compaction restores its full content (published, Anthropic).

Two consequences for an author, both mechanical rather than stylistic:

- **Content past the first 5,000 body tokens is provisional.** In a session that compacts it is gone until the skill is invoked again. Whatever must survive — the constraint that makes the rest of the procedure correct, the trap that is expensive to hit — belongs early in the body, not in a closing section.
- **A long body is a bigger bet in a crowded session.** Several skills sharing 25,000 tokens means the oldest invocations fall off entirely, whole.

This also cuts against inlining a frequently-read reference into a body already near budget: the content stops costing a tool call and starts sitting in the truncation zone. Check body headroom before treating a high pull rate as a reason to inline.

---

## Fan-out is unbounded; depth is bounded at one

**No cap on the number of reference files exists in any source.** Anthropic's best-practices, skills and overview pages carry no at-most-N construction for reference files, and its skill-creator lists bundled resources as the third disclosure level: "As needed (unlimited, scripts can execute without loading)" (published, Anthropic). Shipped practice agrees — Anthropic's own `claude-api` skill ships 66 markdown reference files, and thirteen of its twenty published skills exceed three bundled files (measured here, counted).

Two count rules circulate anyway, and both are named here so they are not re-derived. The published "Good example: One level deep" happens to show exactly three links — it illustrates nesting depth, not a cap. And the external result that "at most three modules outperform larger bundles" counts *whole skills attached to one task*, not files bundled inside one skill; its own table is headed "Skills Count" over rows of 1 / 2-3 / 4+ skills.

**Depth is the constraint that binds, and it is stated as a mechanism rather than a preference** (published, Anthropic): "Claude may partially read files when they're referenced from other referenced files. When encountering nested references, Claude might use commands like `head -100` to preview content rather than reading entire files, resulting in incomplete information." The rule that follows: "Keep references one level deep from SKILL.md. All reference files should link directly from SKILL.md to ensure Claude reads complete files when needed" (published guidance, unquantified). So `references/grading.md`, never `references/prompts/grading.md`.

That same mechanism is why a long file opens with a table of contents. A partial read of a file that carries its own map still returns complete information; a partial read of one that does not returns a truncated answer that looks whole.

Splits are therefore driven by what one task needs to read in one go, never by a target count. Whether a particular skill's six references are right for it is a recall question — `disclosure-optimization.md` — and not a threshold question.

---

## Pointers, and what is actually known about them

Deferral only works if the model opens the file at the right moment. Anthropic names that failure exactly and then stops: if Claude fails to follow references, "Your links might need to be more explicit or prominent" (published guidance, unquantified). Nothing anywhere operationalises *prominent*.

**No pointer form has evidence behind it, including the one this repository used to mandate.** The rule that a pointer must name the file, the condition that fires it, and the cost of skipping it has no published basis in Anthropic's documentation and no analogue at any of the eight vendors surveyed. It is struck as a rule. The skill measured here was authored under it, and its pointers still ranged from 33% to 90% recall on the weaker tier, so following it did not prevent the failure it exists to prevent (measured here). Anthropic's own canonical example of a correct reference block is the opposite shape — a trailing manifest of four bare `**Advanced features**: See [advanced.md](advanced.md)` lines, no condition, no cost — offered as an illustration of nesting depth, because placement is not treated as a variable anywhere in the published record.

**Placement was tested in a controlled run and refuted in its actionable form** (measured here). One reference's single trailing pointer was moved into the numbered workflow step where its condition fires, mention count held at one so the test isolated placement from surface area. Forty attempts per arm: trailing 8/40, in-step 4/40. Moving it in *halved* reach, z≈1.27, p≈0.20 — no detectable effect, trending against the hypothesis. Placement does not go into any standard.

What explains the gap between the best-reached reference (90% recall on the weaker tier, six mentions, inside the workflow steps) and the worst (33%) remains unknown (unmeasured). Mention count and topic centrality vary together across the measured set, and neither has been manipulated in a controlled run.

So the only mechanical rules worth enforcing around references are the published structural ones above: one level deep, a table of contents past roughly 100 lines, a body inside its budget. Nothing mechanical is known about how a pointer should *read*. That part is judgement — write it as judgement, and do not defend it as though it were measured.

Judgement that is at least coherent, labelled as such:

- **Flow matters** (unmeasured). A reference should be openable at the moment its condition fires and answer the question completely. Where two files are always needed together, that is one file. Where one answers half a question, it should say where the other half is — a reader who has to guess at the second hop usually does not take it.
- **Vocabulary has to match across the boundary** (unmeasured). If the body says "tool grant" and the reference says "permissions", the model bridges that itself and sometimes will not. One term per concept, everywhere.
- **Prefer an explicit stop rule to a weakly-worded pointer** (unmeasured). If a file is being opened when it is not needed, discouraging the read by softening its pointer is not a mechanism anyone has shown to work; a stated stop criterion or fetch budget in the body is at least a real instruction. The only vendor that addresses over-fetching at all frames it as a tunable dial rather than a defect, and publishes stop criteria rather than softer pointers.
- **Write the guidance knowing it is a workaround.** The harness already splices files into context deterministically for its own context files — a `CLAUDE.md` `@path` import arrives before the model reads anything. A skill author has no declarative way to request that for `references/`. Across eight vendors surveyed, a Claude skill's bundled reference is the only case where whether a file is read depends on the model deciding to read it; everyone else resolves it by harness attachment on a matched condition. Every rule here compensates for a missing declarative mechanism rather than describing the natural way to author references.

### A zero is not evidence that a file is useless

This is the rule that was wrong for longest, and it was wrong in the direction that produces deletions.

**A raw pull rate cannot separate *rarely needed* from *needed and missed*** (measured here). One reference in the measured skill reads as 5.6% of all runs and as 37.5% recall — the entire gap is scenarios that correctly did not need it. A keep-or-prune verdict computed from a raw rate prunes a well-signposted rare file and keeps a frequently-relevant file that is routinely missed. It inverts the ranking of which reference is actually in trouble.

Deletion is therefore justified by evidence, never by a rate:

| Symptom | What it means | What to do |
|---|---|---|
| Pulled on nearly every run | Body content paying an extra tool call to arrive late | Inline it — if the body has headroom under the compaction boundary |
| Reached by fewer than half the runs that needed it | Needed and missed: a reachability defect | Repair reachability. Never delete |
| Pulled rarely, but reached by the runs that needed it | Deferral working; the low rate is scenario mix | Keep |
| Pulled on no run, and no scenario declares it needed | **Undetermined** — this is the 5.6%-against-37.5% case | Establish ground truth before touching it |
| Pulled on no run, and the body never names it | It could not have loaded; its zero says nothing about the file | Write the pointer, then measure again |

"Runs that needed it" is ground truth, and it comes from one of two places. Declare it per scenario with `expects_references` — the field, and the load-bearing distinction between omitting it and setting it to an empty array, are in `schemas.md`. Or derive it from the artifact by ablation: strip the reference files out, re-word their pointers out of the prose rather than deleting the lines, and see which scenarios lose score; then remove one file at a time to attribute each surviving drop to a named file. `disclosure-optimization.md` carries the workflow and what it costs.

One distinction must not collapse. An ablation measures which *content* a scenario needs; recall measures whether the *pointer* to that content fires. A file can be genuinely needed and never reached, which is a signposting defect, or reached and not needed, which is over-fetch. Only running both instruments tells them apart.

---

## Author for the weaker tier

**The two model tiers fail in opposite directions** (measured here). On the same skill and the same scenarios: opus reached 100% of what it should have on five of six references, and read a file it did not need on 3 of 8 runs that should have reached nothing. Sonnet over-fetched on none and missed between a third and two-thirds. Near-perfect recall with poor precision, against perfect precision with poor recall.

The authoring consequence is direct: **a strong model forgives a signposting defect by reading eagerly, so a skill that works on it is not thereby a skill that works.** Write pointers the weaker tier will follow, and treat the strong tier's success as no evidence. Anthropic says the same without a number: "What works perfectly for Opus might need more detail for Haiku" (published guidance, unquantified).

The measurement consequence is the mirror image and belongs to whoever runs the tooling — measure on the weaker tier, because the strong one hides every routing defect. `disclosure-optimization.md` carries that rule and the sweep that demonstrates it.

## Two things that belong in the body regardless of size

**Gotchas** (unmeasured). Environment-specific facts that defy a reasonable assumption — a field that silently means the opposite of what it looks like, an exit code that discards stdout. These invert the disclosure rule: the model cannot decide to open a file about a trap it does not know exists, so a gotcha behind a pointer is a gotcha that arrives after the mistake. Keep them in the body, keep them concrete, keep them *early* in the body for the compaction reason above, and keep general advice ("handle errors appropriately") out of the list.

**The validation loop** (unmeasured). If the skill ships a validator, the body says to run it, fix, and run it again until it passes. Mentioning a validator once produces one run; describing the loop produces the loop.

## Diagrams cost tokens on every invocation

A mermaid graph in a SKILL.md body is *text the model reads*, paid for on every invocation, and against a table it is usually more tokens for less clarity. So the question is never "would a diagram look good here" but "is the branching structure itself the content". This whole section is judgement; no one has measured a diagram against its table (unmeasured).

Worth it: a decision tree with real branches (which event, which transport, which component type), or a fan-out-and-barrier shape that prose flattens badly. Put those in `references/`, so only the reader standing at that fork pays for them. Not worth it: anything in a body that restates a table or list already there, a sequence diagram of a two-step process, or decoration for a section that looks plain.

Keep any diagram under roughly fifteen nodes. One nobody can follow in raw source has failed for the model and for the human at once.

---

## The taxonomy is decided by load mode, not content genre

The placement rules from here down are grounded in the Agent Skills specification and in Anthropic's own shipped skills. Where they go past both — the hard cases, the fifth-directory test — they are judgement (unmeasured), and none of them has been measured against an alternative.

This is the part that gets miscategorised. The three standard directories are not "code, docs, and files" — they are three different things the model can do with a file:

| Load mode | What enters context | Directory |
|---|---|---|
| **Execute** | only the output; never the source | `scripts/` |
| **Read** | the file's full content | `references/` |
| **Copy into output** | ideally nothing | `assets/` |

`examples/` is not a fourth load mode. It is a labelled *genre* inside the read mode: a complete **specimen** of the skill's input or output, valuable for its shape rather than for prose explaining it.

**The decisive evidence** is a skill in Anthropic's own public repository that ships `.ts`-equivalent scripts in *both* `scripts/` and `examples/`, with opposite instructions. Its `scripts/` are documented as black boxes — *"use `--help` to see usage, then invoke directly… DO NOT read the source… they exist to be called directly rather than ingested into your context window."* Its `examples/` sit under a heading reading **"Reference Files"**, described as patterns to look at. Same file type, same language, opposite verb. The file type tells you nothing; what SKILL.md tells the model to *do* with the file tells you everything.

---

## The placement rule

Apply in order; first match wins. The test is always the verb SKILL.md uses.

1. **`scripts/`** — SKILL.md tells the model to *run* this file, and only its output matters.
   *Check:* is the file named inside a command invocation (`bun scripts/x.ts`, `bash scripts/x.sh`, `./scripts/x`)?

2. **`assets/`** — the file is copied, embedded, or filled in to become part of the artifact the model produces; the model needs its bytes, not its meaning.
   *Check:* does the produced artifact contain this file, or a filled-in version of it? Fonts, logos, images, document shells, HTML or React boilerplate, output templates.

3. **`examples/`** — the model *reads* this file as a whole specimen of the skill's input or output and imitates its shape.
   *Check:* is it a complete instance of the thing the skill consumes or produces, valuable for its structure rather than for prose about it — and does SKILL.md say *read* or *follow this pattern* rather than *run* or *copy*?

4. **`references/`** — the model *reads* this file for explanation, rules, schemas, or API detail. Prose about the domain, not a specimen of it. The default for anything read-into-context that is not a whole specimen.

5. **Anything else** (a LICENSE, plugin metadata, a single small template) → skill root, flat.

**Two guardrails that catch most misfiling:**

- **A `scripts/` file is never read; an `examples/` file is never run.** If SKILL.md violates that, the file is in the wrong directory. This one check catches the confusion the taxonomy exists to prevent.
- **Do not create a directory for one file.** A single specimen belongs at the skill root as `example.md`, not `examples/example.md`. Plenty of good skills have no subdirectories at all.

### Hard cases

**An example that is runnable code.** `examples/` if SKILL.md says read it and write something similar; `scripts/` if SKILL.md says invoke it. Runnability is irrelevant — the verb decides.

**A template the model fills in.** `assets/`. If the model *fills in* the file, it is a template. If the model looks at a filled-in one to learn the shape and then writes its own from scratch, that is a specimen and belongs in `examples/`.

**A worked walkthrough in prose.** `references/`. Distinguishing test: delete the explanatory prose. If a usable artifact remains, it was a specimen; if nothing remains, it was documentation.

**Sample input or output data.** Split by role. Data the model *reads* to learn a format goes to `examples/` if it is a whole specimen and `references/` if it is a schema or field description. Data the model *hands to a script* as a fixture, or *ships inside* the output, goes to `assets/`. One caveat worth knowing so you do not fail a skill that followed the spec literally: the specification lists "data files (lookup tables, schemas)" under `assets/`, which sits awkwardly with the same spec's framing of `assets/` as files not loaded into context — a schema is read by definition. Practice sits on the spec's side.

---

## The status of `examples/`

`scripts/`, `references/` and `assets/` are named in the Agent Skills specification, each with its own section. **`examples/` is not.**

It is nonetheless standard-*conformant*: the spec's directory tree ends with "any additional files or directories", and its optional-directories section is not exhaustive-by-exclusion. Claude Code's own documentation names `examples/` with a precise semantic ("example output showing the expected format"), VS Code's documentation names it, and Anthropic uses it in its public skills repository.

So: **a reviewer must never flag `examples/` as non-conformant, and must never require it.** A skill that folds its specimens into `references/`, or keeps a flat `examples.md` at the root, is fully correct. Treat `examples/` as an optional, widely-used, spec-permitted specialization of `references/` — one that exists because `references/` otherwise conflates "documentation explaining X" with "a specimen of X".

Keep `assets/`. Its low usage in developer-tooling skills is a sampling artefact of what those skills do; skills that produce documents, decks, spreadsheets or branded artifacts use `assets/` as their primary payload directory, and the spec's own best-practice guidance names it as the home for output templates.

---

## When a fifth directory earns its place

Four names cover placement for nearly every skill, and a fifth should be treated as a smell until it defends itself. This skill ships one that does: `report/`.

It holds the eval report generators, the modules they share, and the HTML templates they fill in — one sub-application whose parts are only meaningful together. Split by load mode it would land in two places: generators in `scripts/`, templates in `assets/`, with nothing in either saying they are one component. That split changes nothing about what enters context, which is the only thing the taxonomy exists to control — the generators are still run and the templates are still filled in. It costs legibility and buys conformance to a rule whose purpose is already met.

So the question for a fifth directory is not whether the four could have absorbed the files. It is whether holding them together preserves something the split would destroy, and whether a reader can still tell at a glance how the contents load. Where either answer is no, use the four.
