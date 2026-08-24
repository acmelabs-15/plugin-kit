# Optimizing progressive disclosure by measurement

Read this when a disclosure run has finished and you are deciding what to adopt, or before starting one to know what it will cost. For the doctrine underneath it — which directory a file belongs in, the body's size budget, the compaction boundary, the depth rule, and what is and is not known about pointers — that is `progressive-disclosure.md`, and it is the better read when you are doing this by judgement rather than by measurement. What doctrine cannot tell you is *which* content should move, because that depends on what the skill is actually asked to do.

`../operations/optimize-disclosure.ts` answers that by measuring it. It runs the skill on real evals, watches which bundled files get read and how often, counts what each run costs, and restructures the layout to cut the cost — with the expectation pass rate as the thing a restructure is not allowed to break.

If you only want the numbers — which bundled files get pulled, at what rate, at what token cost — reach for `../operations/measure-disclosure.ts` instead. Same sweep, same grading, same file table; no candidates, no selection, no `--apply`. It is the cheaper half of the run above, and the one to start with.

## Table of Contents

- [Run it on the weaker tier](#run-it-on-the-weaker-tier)
- [What one run measures](#what-one-run-measures)
- [The decision rule](#the-decision-rule)
- [How selection works, and why it uses a held-out split](#how-selection-works-and-why-it-uses-a-held-out-split)
- [Reading the report](#reading-the-report)
- [What the measurement cannot see](#what-the-measurement-cannot-see)
- [Cost](#cost)

```bash
bun ../operations/measure-disclosure.ts \
  --skill-path ../my-skill \
  --scenarios ../my-skill/evals/evals.json \
  --results-dir ./disclosure-runs/my-skill
```

Restructuring as well is the same command with the optimizer's name and its extra flags:

```bash
bun ../operations/optimize-disclosure.ts \
  --skill-path ../my-skill \
  --scenarios ../my-skill/evals/evals.json \
  --model sonnet \
  --results-dir ./disclosure-runs/my-skill
```

**`--results-dir` must point outside the skill.** The run scans the skill with `**/*` and excludes nothing, so results written inside it become bundled files the next run measures as part of the artifact — the tool would be measuring its own output. The winning layout is copied to `<results-dir>/best-layout/` by default, and a target that overlaps the skill in either direction is refused before the loop spends a model call, because that copy deletes its destination first.

`--scenarios` is spelled that way on the command line but takes the `evals.json` you already have — `{skill_name, evals: [{id, prompt, expectations}]}` — or a bare array of the same rows; scenario and eval are the same thing here. Those `expectations` are the guardrail, and a set with none leaves the loop free to strip the skill to nothing and call it an improvement, which is why the run warns loudly when it finds none.

---

## Run it on the weaker tier

**Sonnet, not opus, and this is not a cost preference.** `measure-disclosure.ts` no longer takes `--model` at all — sonnet is hardcoded there, and a deliberate off-tier sweep goes through `--tier-study`, which marks its own output as not a measurement of record. `optimize-disclosure.ts` still takes `--model`, so the choice below is still yours to get wrong there. The two tiers fail in opposite directions, measured on the same skill and the same scenarios: opus reached 100% of what it should have on five of six references and read a file it did not need on 3 of 8 runs that should have reached nothing; sonnet over-fetched on none and missed between a third and two-thirds.

So a routing defect is invisible on the strong model, because eager reading opens the file whatever the pointer says. **An opus-only sweep of the measured skill showed five of six references at 100% and would have surfaced nothing at all.** A signposting measurement taken on the strongest available model is a check that returns a healthy verdict from the wrong configuration, which is worth less than no check — a passing result is stronger evidence than an absent one, and this one has not earned it.

The inverse holds for over-fetch: only the strong tier produces enough of it to study. If that is the question, run the strong tier deliberately and say so, rather than reading it off a sweep aimed at recall.

---

## What one run measures

| Quantity | Where it comes from | Why it matters |
|---|---|---|
| **Body tokens** | The SKILL.md body, tokenized | The bill every invocation pays, whether or not it needs the content |
| **Which bundled files were read** | `Read` tool calls whose path lands inside the skill directory | The evidence for whether deferral is working |
| **Per-file recall** | Reads over the runs of the scenarios whose `expects_references` names that file | Whether the pointer fires for the runs that needed it. The figure the verdict keys on |
| **Over-fetch** | Reads on the runs of scenarios declaring an *empty* `expects_references` | Reads on runs that should have reached nothing |
| **Total context tokens** | The `result` event's `usage` block | What the whole run cost, deferral included |
| **Expectation pass rate** | A grader pass over the transcript and any files produced | The guardrail — a cheaper skill that stopped working is a regression |

The grader runs on `--grader-model`, which defaults to `sonnet` and deliberately does **not** inherit the measurement model. Grading is one single-turn call with the transcript and the produced files already in the prompt, judged against an explicit list — there is nothing to plan and no tool to call. It matters for wall clock because the grading call is serial with the scenario inside the same worker slot, so a run measuring on opus waits on the heavy model twice; measured over two attempts each, opus averaged 13.1s against sonnet's 11.0s.

The obvious move — grade on the cheapest model — was measured and rejected. Against a run whose own final response admitted it had left a pointer without a load condition, `haiku` returned `passed: true` twice while `sonnet` and `opus` returned `passed: false` twice, and haiku was not even faster (11.8s). A grader that fails open is worse than a slow one, because this is the guardrail deciding whether a restructure broke the skill.

The guardrail also depends on the grader being *held constant*: a candidate's pass rate is judged against a baseline graded by the same model, so a stricter or slacker grader moves both numbers and not the gap between them. Change it with `--grader-model`, not with the measurement model, and change it between runs rather than within one.

Token figures come from `tiktoken` where it is installed. It is a devDependency of this repository rather than a runtime one, because a skill's scripts run with nothing but Bun; when it is absent the loop falls back to the published characters-over-four estimator and says so on every surface — in the terminal, in `results.json`, and at the top of the report. A body measured at 4,800 estimated tokens against a 5,000-token budget has not been shown to be inside it.

Invocation is held constant. The prompt names the skill outright rather than relying on the description to route to it, because whether the description triggers is what `../operations/optimize-description.ts` measures. Holding it fixed here is what makes these numbers about the layout instead of about routing.

---

## The decision rule

**What the verdicts serve.** The target is every reference loading as close to 100% of the times it is supposed to — recall approaching 1.0 on the should-reach set — with the body's token budget as the standing constraint. That constraint is what stops the target being trivial: recall goes to 1.0 if you inline everything, and a skill that has done that has abandoned progressive disclosure rather than optimized it. So the loop drives recall up and body tokens down together, and the verdicts below are the moves available.

The rule keys on recall, not on the raw pull rate. Load mode is checked first, and that is not a formality — a `scripts/` file has a pull rate of zero when everything is working, because its text is never supposed to enter context at all.

| Verdict | Condition | The fix |
|---|---|---|
| **signpost** | A declared file whose recall is below 0.5 | Needed and missed. Repair reachability: write the pointer, or rewrite the one that is not firing. **Never delete**, whatever the raw rate says. Reachability is the first of three remedies — see the ladder below |
| **keep** | A declared file reached by at least half the runs that needed it | Genuinely conditional content, which is what deferral is for. A low raw rate here is scenario mix, not a defect |
| **inline** | Healthy recall, raw pull rate at or above the threshold, **and** body headroom | Body content paying an extra tool call to arrive late. Advisory only — see the compaction caveat below |
| **prune** | The set carries ground truth, no scenario declares this file, and nobody read it | Ground truth — not a rate — says nothing needs it. Deleting it is a hypothesis the loop tests |
| **unmeasured** | Zero pulls, the body points at the file, and the set declares no ground truth | Cannot distinguish rarely-needed from needed-and-missed. Derive ground truth before removing anything |
| **misfiled** | An `execute`- or `copy`-mode file that *was* read | Either the body asks for the wrong verb, or the file is in the wrong directory |

**What changed, and why.** The rule used to key on the raw pull rate alone, and it carried a prune verdict for a file that was "pulled on no run, and the body points straight at it" — read as *the pointer works and nothing needs the file*. That reading does not hold. A raw rate cannot separate *rarely needed* from *needed and missed*: one reference in the measured skill reads as 5.6% of all runs and as 37.5% recall, the entire gap being scenarios that correctly did not need it. Pruning on a raw rate deletes the well-signposted rare file and keeps the frequently-relevant file nobody reaches. That case is now **unmeasured**, and it is a request for evidence rather than a verdict.

**prune ignores signposting deliberately, and inherits the corpus's coverage.** Ground truth answers *is this file needed* directly, so the pointer stops being the proxy it was under the old rule: a file nothing declares and nobody reads is deletable whether or not the body names it. The residual risk is **partial annotation**. A corpus that annotates only some of its scenarios can make a file that an un-annotated use case genuinely needs — and cannot reach — read as deletable, because the rows that would have declared it were never asked. A prune verdict is therefore only as trustworthy as the coverage behind it. It is sound when the un-annotated rows are *deliberately undetermined* — examined and left open, which is the standard ablation-derived ground truth meets by construction — and it is not sound when they are merely unexamined. Compare `ground_truth.annotatedScenarios` against `scenario_count` in `results.json` — the number of rows in the scenario set — before acting on any prune, and read a gap between them as a reason to annotate rather than to delete.

**An unannotated set now produces no deletion verdict at all.** What used to render as a zero-pulls prune renders as **unmeasured**. The way to earn a prune is to derive ground truth; there is no path to one that skips it.

**signpost fires on recall, so it now covers two situations that used to look different.** A file the body never names and a file whose pointer nobody follows are both reachability defects, and both are repaired by editing the body. Check the *signposted* column to know which repair applies: a file the body never names needs a pointer written before anything else can be learned from it, because its zero is about the pointer rather than the file.

**The 0.5 recall threshold is a judgement, not a measured figure**, in the same way `--pass-rate-tolerance` is. Recall denominators here are small enough that the whole verdict can turn on one run: over four expected runs, two-of-four keeps and one-of-four signposts. Treat a file sitting on the line as unresolved rather than as decided, and add runs before acting on it.

**The compaction caveat on inline.** Splicing a reference into the body stops it costing a tool call and starts it costing tokens on every invocation — and if it lands past the first 5,000 body tokens it also enters the truncation zone, where auto-compaction drops it until the skill is invoked again. `progressive-disclosure.md` has the mechanism. This is why inline is advisory: the arithmetic can say inline while the body has no room for it.

### Reading the figures, in the order they should be read

**Recall first, quoted as a fraction.** Write it `3/4`, never `75%`: these denominators are small, and a ratio over four runs prints identically to one over ninety. `results.json` reports `reads` and `expectedRuns` beside the rate for exactly that reason. A recall of `null` is not a recall of zero — null means no scenario claims the file is ever needed, zero means every run that needed it failed to open it, and the two argue for opposite actions.

**Then the raw pull rate, as scenario-mix context rather than as a verdict.** Worked example: a file read on 4 of 8 delivered runs is a 50% pull rate, which looks marginal. Its recall is 3/4. The pointer is working for the scenarios that need it, and the low pull rate is describing how few scenarios in this set need it — the exact confound a pull rate alone cannot resolve. Nothing needs fixing there.

**Then over-fetch, and interpret it before acting on it.** Three things to hold:

- It is computed over the **empty-array negative rows only** — scenarios that declared they should reach nothing. Nothing else is in that denominator.
- It is **null, not zero, when the set carries no negative row.** A rate over no runs is not a rate of zero, and printing zero would hand back a flattering clean bill for a measurement that never happened.
- Under **outcome-derived** ground truth it means "reads that did not improve the score", not "reads that made no sense". A negative row established by ablation is one whose score did not drop when the file was removed, and that can happen because the scenario was already at ceiling. A pointer followed correctly into a scenario that could not have scored higher is counted as over-fetch under that derivation. Say which kind of ground truth produced the number before drawing a conclusion from it.

### When recall falls short: three levers, in order

Low recall is a symptom, and pointer repair is only the first of three remedies. Let the observable select the lever rather than reaching for the first one every time. Only the first lever has a verdict behind it — the report classifies files, not file *sets*, and it has no way to see a boundary drawn in the wrong place or a scenario that does not do what it was written to do. Levers 2 and 3 are yours to reach for; nothing in the table will name them.

**1. Reachability — repair or reposition the pointer.** This is the `signpost` verdict's scope. It applies when recall is low **and** the file's content matches what its scenarios actually needed: the right content is in the right file, and the model is not getting to it. Write the pointer if the body never named the file; rewrite it if it is there and not firing. Nothing measured says what a better pointer looks like — `progressive-disclosure.md` is explicit that no pointer form has evidence behind it — so this is judgement applied to a measured symptom, and it is worth re-measuring afterwards rather than assuming the edit worked.

**2. Reference composition — merge, split, or otherwise recompose the files.** This applies when the misses cluster on a **content boundary** rather than on a pointer. Two signatures: a file that scenarios need in fragments, each wanting a different part of it, and two files that no scenario ever needs separately. The first wants a split, the second a merge. No pointer fixes either, because the defect is that the file boundary does not match how need presents in the scenarios — no wording gets a model to open half a file, and none reliably buys a second hop it was never going to take.

**3. Scenario quality — rewrite or re-derive the scenarios.** The scenario set is itself an object of evaluation, not a fixed measuring stick. This applies when the ablation refutes a scenario's designed candidate: the scenario was annotated against a file, removing that file changes nothing, and the drop it does show comes from somewhere else. That is the set telling you the scenario does not create the firing condition it was written for. Two questions follow — whether the scenario genuinely produces the situation the reference exists for, and whether the should-reach set is *complete*, since a reference needed by a use case no scenario represents is invisible to every figure on this page. Rewriting a scenario is as legitimate a remedy as rewriting a pointer. What is not legitimate is hand-asserting the rewritten scenario's ground truth: re-derive it by ablation, below, so the new annotation is measured rather than declared.

Order matters because the cheaper lever changes the evidence for the more expensive one. Repair reachability first and re-measure; only then decide whether what remains is a composition defect or a scenario defect. A file can need more than one, and a recomposition moves every pointer touching it anyway.

### Where ground truth comes from

Two places, and **prune** requires one of them.

**Declared.** `expects_references` on each scenario names the skill-relative paths it should send the model to. The field, and the load-bearing distinction between omitting the key and setting it to an empty array, are in `schemas.md` — an omitted key keeps the row out of every denominator, an empty array puts it into the over-fetch denominator, and collapsing the two turns every unannotated scenario into a negative case and makes recall look perfect. A set with `annotatedScenarios: 0` reports every recall as null and over-fetch as null, and both scripts say so on stderr rather than printing a column of zeros. That state is what produces the **unmeasured** verdict; it is not a clean bill.

**Derived, by ablation.** Two stages, and it retires the hand annotation for any skill you are willing to spend the runs on.

1. Run the whole scenario set against two arms: the skill as shipped, and a copy with every reference file removed *and every pointer to them re-worded out of the prose*. Re-worded rather than line-deleted, deliberately — a pointer naming a file that is not there is a different experimental condition than content that was never offered, and a model that tries to read a missing file and fails is not a model that decided it did not need one. The score drop sorts each scenario into needs-something or needs-nothing.
2. Remove one file at a time, against candidates derived from the scenario's own prompt rather than the full matrix, which attributes each surviving drop to a named file causally.

On the measured skill that came to 27 scenarios × 2 runs × 2 arms for stage 1 plus 30 targeted runs for stage 2 — 138 runs against 324 for a full per-file grid over the same corpus. It returned: stripping all six references cost 10 points of assertion pass rate, 82.4% down to 72.5%; 15 of 27 scenarios dropped; every one of the six files was causally needed by at least one scenario; and six scenarios validated as negatives by outcome rather than by assertion.

Three conditions the design is only valid under, each learned the hard way in the session that ran it. Run the arms **concurrently**, or a provider-side shift lands on one arm and reads as an effect. Give each stage-2 scenario **two** candidates rather than one, because the contrast is what discriminates — one scenario reproduced its drop under one candidate at 0.10 and showed nothing at all under the other at 0.60. And gate completeness on **per-run grading compared across arms**, never on the headline `assertions_total`, which counts only counted runs and shrinks when runs load the skill via file rather than via the tool; reading that shrinkage as partial grading produced a wrong diagnosis once already.

**The distinction that must not collapse:** an ablation measures which *content* a scenario needs; recall measures whether the *pointer* to that content fires. One scenario in the measured set was annotated against a reference and was unaffected by removing it, because that model never reads it there in the first place — its drop comes from somewhere else entirely. A file can be genuinely needed and never reached, which is a signposting defect, or reached and not needed, which is over-fetch. Only running both instruments separates them.

### The other direction: pushing a body section out

A body section needed on a minority of runs is taxing every invocation that does not need it. That one cannot be read straight off the stream — the body arrives whole, so nothing distinguishes the section a run used from the one it skipped past. The loop asks a model which sections are minority-use, given the body, the scenarios and the measured pull rates, and treats the answer as a **hypothesis rather than a verdict**.

What makes it a measurement is what happens on the next iteration. A section pushed out becomes a bundled file with a recall and a pull rate of its own. If it comes back reached on nearly every run that needs it and pulled on nearly all of them, the rule above says to inline it again — so a bad extraction is caught by the same arithmetic that would have caught a bad reference. The loop corrects its own proposals, which is why the model step is allowed to be a proposal at all.

Only sections above `--min-extract-tokens` (250 by default) are proposed. Deferring content costs a round trip, so moving a small section out makes the skill slower and barely cheaper.

---

## How selection works, and why it uses a held-out split

Scenarios split 60/40 by default. Restructures are proposed from what the **train** split showed and selected on the **held-out** split, for the same reason the description loop does it: a layout tuned until it aces the scenarios that motivated it has usually just memorized them. An extraction proposed because no train scenario needed that section will always look free on the train scenarios.

A candidate has to clear three gates, in order:

1. **The guardrail.** Its held-out pass rate must stay within `--pass-rate-tolerance` (0.05) of the baseline. Below that it is rejected however cheap it is.
2. **Cost.** Its held-out context cost must not exceed the baseline's. A restructure that costs more is not an optimization, whatever else it improved.
3. **Cheapest wins.** Among what survives, lowest context tokens per run; ties break toward the higher pass rate, then the smaller body.

The tolerance is a judgement, not a measured figure. These runs check on the order of twenty expectations, so 0.05 absorbs roughly one expectation flipping — the noise from re-running the same layout twice — and refuses a candidate that drops two. Widen it and the loop will trade the skill's behaviour for tokens, which is exactly what the guardrail exists to prevent.

A rejection is a result, not a failure. A candidate that cut tokens and broke the work has told you the content it moved was being used.

---

## Reading the report

The report opens automatically and rewrites itself as the run proceeds. Three sections, in the order you want them.

**The headline tiles** — body tokens, context per run, pass rate, split. Body tokens is the unconditional bill and the number a restructure is trying to move; context per run is what the runs actually cost, which includes whatever deferral pulled back in. Pass rate sits beside them because a body-token figure without it says nothing.

**What actually got read** — one row per bundled file, with its load mode, its cost if read, its recall, its pull rate as a bar, whether the body points at it, and its verdict. Read that row right to left of how it is laid out: recall first, then the *signposted* column before reacting to any zero, and the pull rate last. A file the body never names could not have loaded, and its zero is about the pointer rather than the file. A blank recall is a set that declared no ground truth, not a file that failed.

**Body tokens against the guardrail** — one row per layout measured, baseline first. The body-token bar shows the trend; the pass-rate bar beside it is the guardrail at each step. Rejected candidates stay in the table, greyed, with the reason they lost. Selection reads the held-out column only, so a candidate that looks good on train and lost on held-out is showing you an overfit that the split caught.

**Before adopting this layout** appears above the file table when the rewrite hit something it could not decide alone. The rewrite works on paragraphs rather than lines, because a pointer sentence is routinely wrapped and deleting the line that happens to hold the path leaves the rest of the clause dangling. The case it cannot resolve is a sentence that points at two files — deleting it to remove one takes the pointer to the other with it, and that loss is silent, where a dangling reference is loud: `../validate/validate.ts` and the skill-reviewer agent both flag one. So the sentence stays, and the note tells you to rewrite it.

The winning layout is written to `--apply <dir>`, or to `<results-dir>/best-layout/` when you gave one. **The source skill is never modified**, on any path — adopting the result stays a diff someone reads rather than something that already happened while they watched a progress bar.

---

## What the measurement cannot see

Worth knowing before you act on a zero.

- **A pull is a `Read` tool call.** A file opened another way — piped through a shell command, globbed and concatenated — is invisible here and reads as never pulled.
- **Scripts are counted by whether they were read, not whether they ran.** A `scripts/` file's execution is correct behaviour and shows as a zero pull rate, which is why load mode is checked before the pull rate rather than after.
- **A recall figure carries no evidence that the skill body ever reached the model.** A read that errored and a run whose body never arrived look identical in it. Quote recall with the delivered-run count beside it — the sweeps behind the figures above ran at 54/54 delivered, verified from `runs_without_skill=0` and `runs_loaded_via_file=0`, and an earlier sweep of the same artifact reached only 36 of 54.
- **Grading reads the transcript and the head of up to three files the run produced.** An expectation about something further inside a large artifact is judged on a truncated view.
- **Pull rates and recall are only as stable as the run count.** Two runs per scenario is the smallest number that can distinguish "always" from "sometimes"; when verdicts flip between iterations, that is the symptom of too little evidence rather than of an unstable skill.

---

## Cost

One baseline sweep, then `(--max-iterations - 1) × --max-candidates` more, each of `scenarios × --runs-per-scenario` runs — and every run does the skill's real work rather than answering a routing question. With the defaults and five scenarios that is seventy runs plus their grading calls, **worst case**.

Usually less, because a candidate is measured on the train scenarios first and only reaches the held-out scenarios if it is still in contention there — it has to at least tie the incumbent on context cost and stay inside `--pass-rate-tolerance` on pass rate. At the default `--holdout 0.4` a candidate that loses on train costs three fifths of a sweep instead of a whole one. The report shows those rows with an em dash in the held-out column and the gate's reason beside them, which is how you tell "measured and rejected" from "never measured".

This is a filter rather than a change to the selection rule: selection still happens on the held-out split, and a candidate the gate retires is simply never eligible. What it gives up is the candidate that regresses on train and would have reversed on the held-out split — a layout that costs more on the scenarios it was proposed from and then wins on a smaller split is describing sampling noise, and it is not worth two fifths of the budget to keep looking for it.

That cost is why `--max-iterations` defaults to 3 where the description loop defaults to 5. An iteration there scores one candidate description; an iteration here materializes and scores up to three whole layouts. Three iterations is already nine full measurement passes, which is about as much wall clock as a restructure is worth before a human looks at the result.

**Deriving ground truth is a separate budget on top of all of this**, and it is the larger one — 138 runs on the measured skill, against 70 for a defaults-sized optimization loop. Spend it once per skill rather than once per run: an annotation, however it was arrived at, is a property of the scenario set and survives every later sweep. A set that already carries `expects_references` costs nothing extra at all.

Scenarios that write files need `acceptEdits`. `measure-disclosure.ts` always uses it and has no flag — scenarios do the skill's real work, the real work writes files, and a run that cannot write stops short of what is being measured. `optimize-disclosure.ts` still takes `--permission-mode` and leaves it off by default, because applying a permission mode to someone's machine is their call, not a default that script makes quietly.

### Iterating on a slice

Every run above is a whole scenario set, and a scenario run does the skill's real work rather than answering a routing question — which is why this budget is the one that hurts. While you are moving a pointer by hand and want to know whether the two scenarios that edit was about now reach the file, `measure-disclosure.ts` takes `--only`:

```bash
bun ../operations/measure-disclosure.ts \
  --skill-path skills/<name> \
  --scenarios evals/disclosure/<name>.json \
  --only 2,4
```

Selectors are scenario ids, comma-separated, resolved in set order. Every set shipped in this repository numbers its scenarios `1` upward, so the ids are usually digits — but they are ids rather than positions, and a set that names its scenarios takes those names instead. An unknown id is a hard error listing the ids that exist rather than an empty sweep: a measurement over zero scenarios does not fail, it reports a 0% pass rate over nothing and a file table of `prune` verdicts, which is indistinguishable from a layout nobody reads.

**A slice iterates; it never records**, and a pull rate is the figure a hand-picked set distorts most, because the scenario set IS the denominator. A file that two of the three scenarios you selected happen to need shows a rate no full sweep would ever have produced. The run says so on every surface: `results.json` gains a `subset` block naming what ran and what was excluded, the terminal states it before and after, the report carries a qualifying banner above the metric tiles, and the dashboard row carries a not-of-record chip beside the one a tier study now carries.

Both markers are the same kind of claim and neither is `invalidating`: the figures are real and the run did what it was asked, they simply answer a narrower question than a measurement of record answers. A run can carry both. Re-run the full set before quoting anything, and never read a slice's rate against a full sweep's — the difference would be a change of denominator reported as a change of result.

**That last sentence is now enforced rather than left to you.** `measure-disclosure.ts` writes a results envelope — `envelope.json` beside `results.json` whenever `--results-dir` is passed, or wherever `--envelope` names — and its `run.evalSetHash` is computed over the scenarios that actually RAN, exactly as `measure-triggering.ts` computes its own over the rows that ran. `evalSetHash` is a comparability key, so `compareRuns` mechanically refuses a delta between a slice and a full sweep, and between two different slices of the same file. `provenance.caps` carries the sentence naming which selectors ran and how many rows went unmeasured, which is what tells a reader *why* a comparison was refused rather than merely that it was.

The same check catches the other not-of-record class, and on that one disclosure is the stricter of the two sweeps. `run.model` is also a comparability key, and this operation's model is hardcoded rather than defaulted — so a tier study, which is the only thing that moves it, is refused against a measurement of record instead of quietly producing a delta across two different instruments. A triggering run that pinned no `--model` records `null` and has no equivalent protection, because two such runs on different machines compare as equal while having been answered by whatever each operator had configured; it says so in its own caps instead.

What the check cannot do is stop you reading two numbers off two screens. It refuses a delta between two envelopes, and the stamp, the banner and the dashboard chip remain the surfaces that reach a person. Re-run the full set before quoting anything.
