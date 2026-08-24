---
title: "ANALYSIS-009: Why Weaker Models Miss Skills, and What Helps"
type: analysis
status: DRAFT
permalink: analysis/analysis-009-why-weaker-models-miss-skills-and-what-helps
tags:
- skills
- routing
- model-tiers
- vendor-survey
- readable-edition
---

# ANALYSIS-009: Why Weaker Models Miss Skills, and What Helps

This note explains why a weaker model fails to load the right skill, and what the published and shipped record says helps. It is the readable edition of ANALYSIS-006, which stays the note of record; content parity with it was checked on 2026-08-24.

## What this note found

The most useful single result is a calibration. A remedy that helps weaker models often does nothing for stronger ones. So a null result on the strong tier is what the evidence predicts, not a refutation. Reading it as a refutation throws away working remedies.

The ten results below are the whole note in short form. Each names the findings that carry it.

**Vendors now put a number on how many tools a model may choose among, and none on how many files it may read.** Anthropic says tool selection degrades past 30 to 50 available tools. Gemini caps the active set at 10 to 20. OpenAI advises fewer than 20 at the start of a turn. ANALYSIS-004 found no vendor capping the reference files a skill may bundle. The record is coherent once you separate the two: vendors bound what a model must choose among, and decline to bound what it may later read. See Finding 1.

**Published measurement confirms the tier gap this repository measured, in the same direction.** Tool-selection accuracy falls as the candidate list grows, most sharply between five and ten items. The strongest model in the set barely moves across the same growth. List length is a weak-model problem specifically. See Finding 2.

**Weak models fail in both directions, and the direction is not predictable from the tier.** One benchmarked model called a tool on almost every query. Two others almost never called one. Many sat near coin-flip accuracy. Weakness predicts that routing will be unreliable; it does not predict which way. See Finding 3.

**The benefit of a routing remedy is graded by the capability of the model receiving it.** A training-free prompt rewrite recovered up to 11 points of instruction-following for weaker production models and left stronger ones essentially unchanged. Named controls rule out extra tokens, reordering and measurement headroom. Anthropic's own tool search numbers reproduce the shape: Opus 4 went from 49 to 74 percent, Opus 4.5 from 79.5 to 88.1. See Findings 6 and 7.

**A description polished by the strongest model can make a weaker model route worse.** One benchmark had two capable models rewrite tool descriptions, then measured eight downstream models. A Llama2-70b rewrite gained 7.83 percent for Llama2-13b. A GPT-4 rewrite sharply degraded the ChatGLM and Llama2 families. There is no portable phrasing rule for weak models. There is a portable method: optimise on the tier that will route, not merely measure on it. See Findings 8 and 9.

**A second cause sits underneath the first, and it is not about routing at all.** Reliable instruction-following breaks down past five or six simultaneous demands. Each demand individually decays gently while the chance of satisfying all of them collapses. A pointer inside a workflow step is one more simultaneous demand. That is the best published explanation for an imperative in-step pointer scoring 0 of 20 here. See Finding 4.

**The same literature refuses to let the scale story stay simple.** One paper reports ranking inversions against scaling expectations, with a nominally weaker model handling multiple demands more reliably than a stronger sibling. It also records a model jumping from rank ten to rank two on a larger token budget alone. Model tier is one variable among several. See Finding 5.

**The most-cited third-party prior art in this ecosystem says nothing about model tiers.** Grepping Addy Osmani's README, blog post and lesson for eight tier-related terms returns zero matches in all three. His stated reason for progressive disclosure is token cost and attention dilution, not model capability. His pack is not evidence on this question. See Finding 14.

**A test whose answer the model already knows cannot detect a routing failure.** Two independent sources converge: a disclosure mechanism has failed when the model falls back to its training instead of the supplied content. A scenario the model can pass unaided passes whether or not the skill fired. This repository has never audited its should-fire set for that defect. See Finding 19.

**One external citation this repository relies on is misattributed, and the correction removes a rule's last measured support.** ANALYSIS-005 credits "a numbered workflow is the spine of the body" to Vercel's 44-to-95 percent result. The primary text shows that change was an instruction added to AGENTS.md, outside the skill entirely. Vercel's other cited claim, passive context at 100 percent against skills at 53 to 79, is accurate. Vercel also measured that the most forceful wording was the worst one. See Findings 21 and 22.

## What these look like in practice

Three concrete artifacts from the record. Every string below is quoted from a source this note verified.

### The gap that prompted this note

This repository measures its skills on two model tiers and gets two different artifacts back.

| What was measured | Weak tier (sonnet) | Strong tier |
|---|---|---|
| Should-fire phrasings that triggered | 20 of 39 | about 90 percent |
| Reference files read, per file | 33 to 100 percent | all of them |
| Files read that were not needed | none, across eight negative runs | reads everything, so it over-fetches |

Three details sharpen the table. 15 of the 19 misses fire on the strong tier over identical hook text. 8 of the misses sit on near-verbatim hook vocabulary, which makes the hook a measured-weak lever rather than an untested one. Moving a pointer into a workflow step halved reach at 40 runs per arm, and an imperative pointer inside a step scored 0 of 20 on a route where the file was never read.

ANALYSIS-004 drew the operational conclusion. The two tiers fail in opposite directions, so the weak tier is the only instrument that can detect a signposting defect. What it could not establish was why, and what to do. This note answers those.

### A routing map, as it sits in an always-loaded file

A skill asks the model to make a judgment call. The model reads the skill's own description, reads the request, and decides whether the two match. A routing map asks for nothing of the kind. The instruction is already in front of the model on every turn, and the model only matches a task to a line and opens the file named on it. A standing lookup instruction beats a judgment call.

TanStack installs one into the agent's own config file:

```text
# Skill mappings — when working in these areas, load the linked skill file into context.
intent-skills:
  - task: Building chat, tool calling, adapters, or streaming with TanStack AI
    ➞      node_modules/@tanstack/ai/skills/ai-core/SKILL.md
```

The block name, the header comment, the `task:` key and this task-and-path pair are all recorded verbatim in the source. The key naming the path is not recorded, so the arrow stands in for it.

Vercel measured this architecture at 100 percent against 53 for a skill left to fire on its own. TanStack ships it as the install path for a library, and reached it independently. Finding 24 carries both.

### Two rival wordings for the same instruction

Vercel varied only the wording of an instruction in an always-loaded file, holding the skill and the docs fixed.

| Wording | What the agent did | Outcome |
|---|---|---|
| "You MUST invoke the skill" | "Reads docs first, anchors on doc patterns" | "Misses project context" |
| "Explore project first, then invoke skill" | "Builds mental model first, uses docs as reference" | "Better results" |

The forceful wording lost. That is a direct counterexample to answering a missed pointer with a stronger imperative, and it converges with this repository's own 0-of-20 result. Finding 22 carries the detail.

## What to do about it

Two constraints shape every recommendation. This repository is Claude-first, and a skill's frontmatter description is the only routing surface the mechanism exposes. Body genre has been measured here not to move triggering. Where a remedy needs a mechanism Claude Code skills do not have, it is recorded and not recommended.

1. **Optimise the description on the tier that will route, not merely measure on it** (Findings 8, 9). ANALYSIS-004 established the weak tier as the detection instrument. The rewriter result makes it the optimisation target too. Editing a description is an intervention with a direction, and that direction has been observed negative. Measure an edit on the routing tier before it ships.
2. **Spend triggering effort on the description** (Finding 12). One vendor now states the two-surface split outright and another implies it. This repository confirmed it from the other side, by measuring that body genre does not move triggering. The vendor floor for the routing surface is 3 to 4 sentences covering what it does, when to use it and when not to. Effort spent on the body to fix a triggering problem is spent on the wrong surface.
3. **Attack description overlap between sibling skills, mechanically** (Finding 10). Two vendors name overlapping and vague descriptions as the confusion mechanism. One benchmark had to merge 390 tools into 198 before ground truth was definable. 8 of 19 misses here sit on near-verbatim hook vocabulary. Embedding sibling descriptions and clustering them is the operation that benchmark performed. It is cheap, and it produces a candidate list rather than a judgement.
4. **When a step's pointer is missed, take demands out of the step** (Finding 4). Per-demand pass rate decays gently and the conjunction collapses multiplicatively. Strengthening one demand optimises the term that was not the problem. This is the first published account that explains the 0-of-20 in-step result, and it predicts a stronger imperative would not have helped.
5. **Read a strong-tier null as the predicted result** (Findings 6, 7). Capability-graded benefit is measured with controls on current production tiers, and reproduced independently in vendor internal testing. Power any A/B on a routing remedy on the weak tier, and treat a strong-tier null as consistent with the remedy working.
6. **Read the tool-count numbers as a bound on routing surfaces only** (Finding 1, and the open questions). The numbers are real and they describe a different surface. Vendors bound routing surfaces and decline to bound disclosure surfaces, which is consistent with ANALYSIS-004's depth-not-count principle rather than a reason to revisit it.
7. **Write the tier guidance knowing the escape hatch is missing** (Finding 11). Every vendor ships a forced-invocation control for tools and none exists for skills. Guidance authored here compensates for that absence, exactly as ANALYSIS-004's reference-following guidance compensates for the absence of declarative attachment. Say so, rather than presenting a pointer as the natural mechanism.
8. **Spend on pointer placement only after separating position from demand count** (Finding 5). Four accounts now disagree about where a pointer should sit, and one says position is not the variable at all. A further placement A/B buys nothing until demand count and position are varied independently.
9. **Audit the should-fire set for scenarios the model can already pass, and treat each one as a measurement defect** (Finding 19). Two independent sources make reversion to training the observable that separates a working disclosure mechanism from a broken one. The existing ablation harness produces the audit for free: a scenario whose score does not move when the skill is stripped is one whose answer was already in the model, and it can neither pass nor fail informatively.
10. **Correct ANALYSIS-005's lineage rule 1, where the next author will find it** (Finding 21). Its verdict of SURVIVES rests on a Vercel result that measured an instruction added to AGENTS.md, not a numbered workflow inside a skill. Move rule 1 to the same status as rules 3, 5 and 6, namely defensible doctrine never measured here. Re-file the Vercel result as evidence for prompt-level forced invocation. That note's own lineage section argues for making this kind of correction loudly.
11. **Build the cross-tier matrix as one metric per tier** (Finding 16). The published protocol asks a different qualitative question of each model, and three impressions cannot be subtracted. This repository's existing two-tier sweeps are the correct shape, and no published equivalent was found, so describe them that way when the practice is written down.
12. **Test the routing map against the description, on this repository's own artifacts** (Findings 21, 24). Vercel measured the architecture at 100 against 53 and TanStack ships it, but neither result is about these skills. Hold the content fixed and vary only whether a task-to-file map sits in always-loaded context. It is a clean A/B and the highest-value unrun experiment this survey surfaced.
13. **Prefer wording that sequences the work over wording that commands it** (Findings 4, 22). Vercel measured "You MUST invoke the skill" losing to an instruction that sequenced the work and mentioned the skill second. This repository measured an imperative in-workflow pointer at 0 of 20. Two independent results, one mechanism: the conjunction collapses whatever force the individual term carries.
14. **Publish the suite's defects alongside its findings** (Finding 20). Vercel's leakage removal, behaviour-based assertions and retries against variance are the same controls this repository learned the hard way. Stating them next to a result is what makes the result checkable rather than merely reported.

## How to find things in this note

1. What this note found — the ten results, in plain sentences.
2. What these look like in practice — the tier gap, a routing map, two rival wordings.
3. What to do about it — fourteen recommendations, each naming its findings.
4. How to find things in this note — this list.
5. How to read a finding — the five parts every finding has, and the label tokens.
6. Findings 1 to 5 — why the weak tier misses.
7. Findings 6 to 14 — what helps, and what will not transfer.
8. Finding 15 — the figure a search summary invented.
9. Findings 16 to 20 — how these failures get detected.
10. Findings 21 to 24 — Vercel and TanStack, read in full.
11. What nobody has measured yet — sixteen open questions.
12. Words this note uses precisely — the glossary, and the words it avoids.
13. How every claim here was checked — the method, and the sources reached.
14. Observations — forty-nine, grouped.
15. Relations.

## How to read a finding

Every finding has the same five parts, in the same order. Learn the shape once.

- **Labels.** Fixed tokens, separated by a middle dot. Nothing else on the line.
- **In short.** The finding itself, standalone. This line alone carries it.
- **Evidence.** Who measured or asserted it, with exact words where exact words matter.
- **Limits.** What the evidence does not support. Absent where the source states none.
- **What this changes here.** What it means for this repository.

The first three parts are lookup. The last is explanation. A reader who wants only the evidence can skip the last line of every finding, and a reader who wants only the consequences can read the first two and the last.

**Evidence label tokens**, one per finding:

- `MEASURED` — somebody ran an experiment and reports a number.
- `GUIDANCE` — somebody asserts it and publishes no evidence.
- `SHIPPED-PRACTICE` — somebody does it in a product and claims nothing about it.

**Source tokens**: `VENDOR`, `PUBLISHED`, `COMMUNITY`, `METHOD`.

**Transfer tokens**, where the source assigns one:

- `PORTABLE EVIDENCE` — the result transfers to this repository's problem.
- `TECHNIQUE` — the method transfers even though the result does not.
- `MECHANISM-SPECIFIC` — it needs a mechanism Claude Code skills lack, so it is recorded and not recommended.

**Qualifier tokens**, where a finding needs one:

- `CONTRARY` — the evidence cuts against this note's own thesis.
- `CORRECTION` — the finding corrects something this repository had recorded.
- `NEGATIVE RESULT` — a source's silence, confirmed by grep, is itself the finding.
- `SCOPED NEGATIVE` — a source ships something useful and publishes no evidence for it.
- `OFF-TARGET` — the measurement is sound and it measures a neighbouring question.
- `SCOPE` — what a source leaves unsaid bounds how far its number travels.

The findings answer three questions in order. Findings 1 to 5 say why the weak tier misses. Findings 6 to 14 catalogue remedies. Finding 15 is a method correction. Findings 16 to 20, added on 2026-08-24, say how the community detects tier-dependent failures. Findings 21 to 24 cover Vercel and TanStack in primary text, and Finding 21 is a second correction that lands on a sibling note. This note extends ANALYSIS-004's vendor survey along the model-tier axis and does not repeat it.

## Findings 1 to 5: why the weak tier misses

### Finding 1. Vendors cap tool lists, never reference files

**Labels.** VENDOR · GUIDANCE

**In short.** Three vendors bound how many tools a model may choose among. No vendor bounds how many reference files a skill may bundle.

**Evidence.** Verbatim, from primary text:

- Anthropic, tool search tool page: "**Tool selection accuracy:** Claude's ability to pick the right tool degrades once you exceed 30–50 available tools." The same page's when-to-use list includes "Tool selection accuracy drops as your toolset grows" and sets the lower boundary at "You have 10 or more tools available."
- Google, Gemini function-calling best practices: "Tool Selection: Keep active set to 10-20 tools maximum."
- OpenAI, function-calling guide: "Keep the number of initially available functions small for higher accuracy", elaborated as "Aim for fewer than 20 functions available at the start of a turn at any one time, though this is just a soft suggestion", with the adjacent instruction "Evaluate your performance with different numbers of functions."

**Limits.** The three numbers disagree. 30 to 50, 10 to 20, and under 20 are three different bounds, and none carries a published derivation. That is why the label is GUIDANCE despite the specificity. What matters is not the value but that all three exist.

**What this changes here.** ANALYSIS-004 established that no vendor caps a skill's bundled reference files, that Anthropic's skill-creator calls bundled resources unlimited, and that its claude-api skill ships 66 of them. Set beside this finding the record is coherent rather than contradictory. A tool list is a routing surface, evaluated every turn. A reference file is a disclosure surface, evaluated only after its pointer has already won. The count guidance attaches to the first and not the second, and the two must never be conflated. Whether the tool thresholds transfer to skill counts is untested and sits in the open questions.

### Finding 2. Long tool lists hurt weaker models most

**Labels.** PUBLISHED · MEASURED · PORTABLE EVIDENCE

**In short.** Tool-selection accuracy falls as the candidate list grows, the fall is sharpest at small list sizes, and the strongest model barely moves.

**Evidence.** MetaTool (arXiv 2310.03128) evaluates tool-usage awareness and tool selection across nine models, scoring selection with a Correct Selection Rate over lists of varying size. Verbatim from the v3 full text:

"In Figure 4, we present the results of tool selection based on popularity, revealing that as the size of tool lists increases, the performance of most LLMs declines. Notably, among open-source models, Vicuna-33b stands out, even surpassing ChatGPT in the top 5 selection settings. All LLMs have a more significant performance decline when the size of the tool list changes from five to ten. Additionally, ChatGPT exhibits remarkable stability, with only a minor decline in CSR as the size of tool lists grows, indicating consistent performance."

Three results sit in one paragraph. List length degrades selection. The degradation is sharpest between five and ten, not at the large end where intuition puts it. And the strongest model is nearly flat across the growth that moves the others.

**Limits.** They are substantial. The models are the 2023 generation, and its open-source members are far weaker than any tier this repository ships against, so the weakest results are not predictive of sonnet. Correct Selection Rate measures selection from an explicitly presented list, which is closer to Claude's tool block than to skill triggering, where the candidates are frontmatter descriptions in the system prompt. The paragraph reports a figure rather than a controlled manipulation of list size over fixed queries. The transfer covers the direction of the effect and its tier-dependence, not its magnitude.

**What this changes here.** This is the same shape as the recall table, on a different mechanism, a different task and a different model family. It is the first independent corroboration the tier gap has.

### Finding 3. Weak models fail in both directions, unpredictably

**Labels.** PUBLISHED · MEASURED

**In short.** Among weak models both failure directions occur, and which one a model takes is a property of that model rather than of its capability level.

**Evidence.** The same benchmark separates whether a model knows it needs a tool from whether it picks the right one. Verbatim on the first:

"We found that most models' awareness of tool usage is not ideal, as shown in Table 3. ChatGPT has the best performance in this regard, but only has an accuracy of less than 75%, and the worst-performing model, Llama2-13b, has an F1 Score of only 11.53%. Additionally, the accuracy of many LLMs is close to the level of random guessing (50%). The awareness of some LLMs appears polarized, with Baichuan2 essentially considering the use of tools for all queries, while LLama2-13b and Vicuna-7b are overly confident and rarely choose to use tools in most cases."

**What this changes here.** This corroborates ANALYSIS-004 Finding 2 and sharpens it. That note found the strong tier over-fetching and the weak tier under-reaching, and generalised to the weak tier being the detection instrument. MetaTool shows both directions occurring among weak models: one fires on everything, two fire on almost nothing. Weakness predicts unreliable routing. It does not predict which way the unreliability runs.

The consequence is narrow and real. The instrument choice here stays correct, because the tier this repository ships against is measured at the under-reach pole with zero over-fetch across eight negative runs. That is a measured fact about this tier on this artifact, and it does not transfer to a different weak model. An over-fetch check belongs in any sweep against a tier nobody has characterised.

### Finding 4. Asking for too many things at once breaks all of them

**Labels.** PUBLISHED · MEASURED · PORTABLE EVIDENCE

**In short.** Reliable instruction-following breaks down past five or six simultaneous demands, because the chance of satisfying all of them collapses while each one individually decays gently.

**Evidence.** Constraint Saturation Evaluation (arXiv 2608.12426) varies the number of simultaneous constraints from one to twelve across 15 models, using deterministic rule-based verifiers and no LLM judge, over 369,753 checks. Verbatim from the abstract:

"First, per-constraint pass rate decays gradually and predictably, while the chance of satisfying all k constraints collapses - a model passing individual constraints at ~41% at k=8 succeeds on all eight just 5.7% of the time. Second, constraints do not degrade equally: structural constraints lose 2x more baseline capability per added constraint than lexical ones... Reliable instruction following breaks down beyond 5-6 simultaneous constraints: probe-level success falls below 50% at 7 constraints for the strongest model, and at 3 or fewer for 12 of 15."

And from the body: "Production systems assuming linear degradation will experience unexpected failures: a system reliable with 3 constraints may fail significantly with 5."

**Limits.** The demands measured are verifier-checkable output properties such as schemas and word limits. They are not "read this file". No published work extends the result to tool or file-read demands.

**What this changes here.** This is the best published explanation for a result that could not previously be explained. An imperative in-workflow pointer scored 0 of 20 here, on a route where the file was never read. Under this model that is not a pointer-strength failure. The pointer is one more simultaneous demand inside a step that already carries several, and the chance of honouring all of them is multiplicative even where each is individually likely.

It also reframes the placement null. Moving a pointer into a workflow step does not merely relocate it. It adds it to that step's budget, which predicts the observed halving better than any positional account.

The prescription is uncomfortable and clean. Reduce the number of things a step asks for, rather than strengthening any one of them. Strengthening a pointer raises its individual pass rate, which the paper measures as the term that decays gently. The term that collapses is the conjunction, and only removing demands touches that.

### Finding 5. Model strength does not predict handling many demands

**Labels.** PUBLISHED · MEASURED · CONTRARY

**In short.** Capability does not predict which model handles several demands at once, and at least one variable other than capability moves a model eight ranks on its own. This is contrary evidence, kept live rather than resolved.

**Evidence.** Under the heading "Scale does not predict compositional performance", verbatim:

"Counter to typical scaling expectations, we observe multiple ranking inversions: Gemini Pro ranks #2 at k=1 (90.5% single-constraint pass rate) but #11 overall (42.1% mCSR); Flash-Lite ranks #6 at k=1 (78.1%) but #3 overall (56.6%). Single-constraint competence does not predict compositional robustness—the models that understand constraints best in isolation are not necessarily the ones that compose them most reliably."

And on a different axis entirely: "the same model with a larger token budget (Claude 4.7 at 16,384 vs 4,096 tokens) jumps from rank #10 to #2 without any change to its compositional capacity."

IFScale (arXiv 2507.11538) adds a complication at extreme density. Across 20 models and up to 500 simultaneous keyword instructions, "even the best frontier models only achieve 68% accuracy at the max density", and its analysis "reveals model size and reasoning capability to correlate with 3 distinct performance degradation patterns, bias towards earlier instructions, and distinct categories of instruction-following errors."

**What this changes here.** This tempers the framing of the whole question. A nominally weaker model handled several demands more reliably than its stronger sibling. A single model moved eight ranks on output budget alone. Weaker models route worse is a defensible summary of Findings 2 and 3, and it is not a law. Where a measurement here shows a tier gap, the gap is the finding. Attributing it to capability rather than to sampling budget, alignment training or task shape requires separating those, and this repository has not done so.

IFScale's contribution is that size correlates with the pattern of degradation rather than its amount. Its bias toward earlier instructions is a third position claim pointing a third way: against lost-in-the-middle's end-of-context prediction, and against this repository's measured trailing-beats-in-step null. All three stay open.

## Findings 6 to 14: what helps, and what will not transfer

### Finding 6. One rewrite helps weak models, not strong ones

**Labels.** PUBLISHED · MEASURED · PORTABLE EVIDENCE

**In short.** A training-free prompt rewrite recovers up to 11 points of instruction-following for weaker production models and leaves stronger ones essentially unchanged, with named controls excluding the obvious confounds. This is the central remedy result in the note.

**Evidence.** Instruction Stacking Collapse (arXiv 2608.02639) stacks 24 verifier-checked instructions, one to twenty at a time, over three production-tier models: Claude Sonnet 4.6, GPT-5-mini and Gemini 2.5 Flash. Verbatim from the abstract:

"Instruction-following degrades non-linearly: the follow rate falls from ~96% to as low as 20%, driven by a structured and reproducible set of pairwise conflicts. A single 'output JSON' constraint, for example, is jointly unsatisfiable with nine others. We then evaluate a training-free remedy: an instruction compiler that rewrites the stacked prompt in a single LLM call and is reused across queries. Its benefit is capability-graded. It recovers up to +11 points of follow rate for weaker models, which are also the models most often deployed at scale, while leaving stronger models, which already internalise the same structure, essentially unchanged. Cluster-robust tests, same-baseline controls, and a within-family scaling ladder attribute the gain to the rewrite itself rather than to additional tokens, reordering, or measurement headroom."

Three properties make this the most useful external result. The models are current production tiers rather than a 2023 open-source set. The controls are named and exclude token count, ordering and headroom, the last being the one that would otherwise explain a strong-tier null trivially. And the finding is not that the remedy works, but that **the remedy's benefit is graded by the capability of the model receiving it**, which is a claim about the shape of results rather than about one technique.

**Limits.** The object rewritten is a stacked system prompt, not a skill description. The technique does not transfer directly. The grading does.

**What this changes here.** This licenses the note's most transferable output. A remedy measured on the strong tier and showing nothing has produced the predicted result. A remedy measured only on the strong tier has measured almost nothing, which is ANALYSIS-004's Finding 3 reached from the remedy side rather than the detection side.

### Finding 7. Anthropic's own numbers show the same lopsided gain

**Labels.** VENDOR · MEASURED · MECHANISM-SPECIFIC

**In short.** Anthropic's tool search tool improves selection accuracy far more for the weaker starting model than for the stronger one, and this repository cannot adopt the mechanism.

**Evidence.** Anthropic's advanced tool use engineering post reports, verbatim: "Internal testing showed significant accuracy improvements on MCP evaluations when working with large tool libraries. **Opus 4 improved from 49% to 74%, and Opus 4.5 improved from 79.5% to 88.1% with Tool Search Tool enabled.**"

The weaker starting model gains 25 points. The stronger gains 8.6. That is Finding 6's grading, independently, on a different remedy and a different evaluation.

The same post reports an 85 percent reduction in tool-definition tokens, and separately that tool use examples "improved accuracy from 72% to 90% on complex parameter handling". It names the failure the feature targets: "The most common failures are wrong tool selection and incorrect parameters, especially when tools have similar names like notification-send-user vs. notification-send-channel."

The mechanism is deferred loading plus a search step. Tools marked `defer_loading: true` are absent from context until Claude searches for them, with regex and BM25 search shipped and embeddings named as a supported custom option. It is available on Haiku 4.5 as well as the Opus and Sonnet tiers.

**Limits.** Two, before this reads as a recommendation. The numbers are internal testing and not externally reproducible. And the comparison runs across model generations, Opus 4 against Opus 4.5, rather than across tiers within one generation, so it corroborates the grading rather than establishing it.

**What this changes here.** Skills already implement three-level progressive disclosure, and there is no `defer_loading` flag, no search step, and no way for an author to ask that a skill body or reference be retrieved rather than chosen. This is ANALYSIS-004's Finding 11 recurring on a new axis: the harness can do the deterministic thing, and skills are not wired to it.

### Finding 8. A strong model's rewrite can make a weak model worse

**Labels.** PUBLISHED · MEASURED · PORTABLE EVIDENCE

**In short.** A description rewritten by a strong model is an intervention with a measurable direction, and that direction has been observed negative for some downstream model families. This is the most actionable finding in the note.

**Evidence.** MetaTool v6 reports two description experiments. On length, verbatim: "The more detailed the description, the more efficient tool selection. As shown by the fitted line, as the length of the description increases, the CSR continuously increases, indicating that detailed descriptions can help LLMs better understand the functionality of tools, thus improving the accuracy of tool selection."

On rewriting, verbatim and in full because the detail carries the finding: "we built upon the original description by having two proficient LLMs rewrite it and then observed the performance changes of eight LLMs on the new descriptions. Different rewritten LLMs yielded varying benefits for different groups. For instance, descriptions rewritten by Llama2-70b resulted in a 7.83% improvement for llama2-13b, but did not significantly enhance the performance of the Vicuna series models. In contrast, descriptions rewritten by GPT-4 caused a sharp decline in the performance of ChatGLM and Llama2 series, while significantly boosting the Vicuna series, possibly due to the Vicuna series' training corpus being largely sourced from ShareGPT. Therefore, we strongly recommend that tool developers choose an appropriate rewrite model for generating new descriptions based on the downstream LLM the tool will apply to."

**Limits.** The two halves are not equally strong and must not be quoted as though they were. The length result is observational: a fitted line across tools whose descriptions differ in many ways at once, and the higher-scoring group had also been merged and decomposed to reduce functional overlap, so description source is confounded with overlap reduction. The rewrite result is a manipulation, with the same tools, the same queries, and only the rewriter varied. That is the half carrying weight. The proposed explanation for the rewrite effect, training-corpus proximity, is a hypothesis in the paper rather than a demonstrated mechanism, though the effect does not depend on the explanation being right. Every model in that experiment predates the tiers this repository ships against, so the transfer to the Claude family is explicitly untested.

**What this changes here.** ANALYSIS-004 Finding 3 established that signposting must be measured on the weak tier. This extends it: the description must be optimised on the tier that will route, because a description tuned by or for the strongest tier is a specific intervention with a measurable sign, and that sign has been observed negative.

### Finding 9. A fix can help one model and harm another

**Labels.** VENDOR · PUBLISHED · GUIDANCE

**In short.** The direction of a phrasing intervention depends on the model receiving it, which retires the search for a portable weak-model phrasing rule. Three sources converge on it.

**Evidence.** Beyond Finding 8, two vendors say the same about their own levers, without numbers:

- Anthropic, writing tools for agents: "We have found selecting between prefix- and suffix-based namespacing to have non-trivial effects on our tool-use evaluations. **Effects vary by LLM** and we encourage you to choose a naming scheme according to your own evaluations."
- OpenAI, function-calling guide: "Include examples and edge cases, especially to rectify any recurring failures. (**Note: Adding examples may hurt performance for reasoning models.**)"

The second is sharper, because it names a remedy class whose direction flips with model class. Examples help the non-reasoning configuration and may hurt the reasoning one. That is the shape of MetaTool's rewriter result and of Finding 6's grading.

Anthropic generalises the principle to output format: "Even your tool response structure—for example XML, JSON, or Markdown—can have an impact on evaluation performance: there is no one-size-fits-all solution. This is because LLMs are trained on next-token prediction and tend to perform better with formats that match their training data."

**What this changes here.** Together these retire the question the owner's brief asked, in the form it was asked. No community-favoured phrasing rule for weak-model routing survives contact with the evidence, because three independent sources report that the direction of a phrasing intervention depends on the model. What survives is a method: hold the routing surface fixed, vary one thing, measure on the deployment tier, keep the result. This repository already does that. The finding is that doing so is not merely good practice here, but the only thing the record supports.

### Finding 10. Fewer, broader tools beat many overlapping ones

**Labels.** VENDOR · GUIDANCE · PUBLISHED · TECHNIQUE

**In short.** Overlapping and narrow descriptions are the named confusion mechanism, and one benchmark could not define ground truth until it removed the overlap.

**Evidence.** Anthropic's define-tools page, verbatim: "**Consolidate related operations into fewer tools.** Rather than creating a separate tool for every action (`create_pr`, `review_pr`, `merge_pr`), group them into a single tool with an `action` parameter. Fewer, more capable tools reduce selection ambiguity and make your tool surface easier for Claude to navigate." And: "**Use meaningful namespacing in tool names.** When your tools span multiple services or resources, prefix names with the service... This makes tool selection unambiguous as your library grows."

The engineering post is blunter about the failure being avoided: "More tools don't always lead to better outcomes", "Too many tools or overlapping tools can also distract agents from pursuing efficient strategies", and "When tools overlap in function or have a vague purpose, agents can get confused about which ones to use."

OpenAI's parallel advice is "Combine functions that are always called in sequence" and "Make the functions obvious and intuitive. (principle of least surprise)".

The incidental measured corroboration is the more interesting evidence. MetaTool could not build its benchmark over its raw tool set, because overlap made ground truth undefinable: "Overlapped issue refers to a query that can be solved by multiple tools. If left unaddressed, this overlap could potentially influence the computation of final metrics." Its remedy was to merge and decompose 390 tools down to 198, verified with silhouette coefficients over description embeddings. That is an admission with a method attached. Overlapping descriptions are not separable even for a grader holding the ground truth, which is a stronger statement about overlap than any vendor makes.

**What this changes here.** This touches the measured weakness here most directly. 8 of the 19 triggering misses sit on near-verbatim hook vocabulary. Description overlap between sibling skills is the failure two vendors name and one benchmark had to engineer around, and it is detectable mechanically. Embedding sibling descriptions and looking for clusters is exactly what MetaTool did.

### Finding 11. Vendors can force a tool call, never a skill

**Labels.** VENDOR · MECHANISM-SPECIFIC · GUIDANCE

**In short.** Every vendor surveyed ships a control that takes the routing choice away from the model for tools, and a Claude Code skill has no equivalent.

**Evidence.** The controls:

- Anthropic: `tool_choice`, supporting `auto`, `none`, `any` and `tool`, documented per model.
- Google: "Control how the model uses tools using tool_choice in generation_config: auto (Default): Model decides whether to call a function or respond directly. any: Model is constrained to always predict a function call. none: Model is prohibited from making function calls. validated: Model ensures function schema adherence." Gemini additionally supports restricting the callable set through `allowed_tools`.
- OpenAI: the equivalent `tool_choice` control on its function-calling surface.

What the skill mechanism offers instead is graded prompt-level steering, which Anthropic documents explicitly, verbatim: "This boundary is steerable through your system prompt. If Claude isn't calling tools when you expect, a light instruction such as `\"Use the tools to investigate before responding.\"` increases tool use. A stronger form such as `\"Always call a tool first before responding.\"` pushes further. Conversely, `\"Use your judgment about whether to call a tool or respond directly.\"` keeps triggering behavior conservative."

**Limits.** That steering lives in the host's prompt rather than in any skill an author ships, so it is available here only for skills whose consumers control their own system prompt.

**What this changes here.** A user can name a skill and invoke it directly, and that is the whole deterministic path. An author cannot declare that a skill must fire on a condition. This extends ANALYSIS-004's central vendor result, that a skill's bundled reference is the only case where whether a file is read depends on the model deciding to read it, onto the triggering surface itself. The gap is not that the mechanism is unknown. It is standard, and it is absent here.

### Finding 12. Choosing a tool and using it need different text

**Labels.** VENDOR · GUIDANCE · TECHNIQUE

**In short.** The text that wins the routing decision and the text that governs correct use are different objects with different targets, and conflating them degrades both. This is the remedy most compatible with the skill mechanism.

**Evidence.** OpenAI's function-calling guide, verbatim: "**For deferred tools, put detailed guidance in the function description and keep the namespace description concise. The namespace helps the model choose what to load; the function description helps it use the loaded tool correctly.**"

Anthropic's tool search optimisation tips carry the same split implicitly: "Use keywords in descriptions that match how users describe tasks", "Keep your 3–5 most frequently used tools non-deferred", and "Add a system prompt section describing available tool categories: 'You can search for tools to interact with Slack, GitHub, and Jira'". The first is routing advice, and the tool's own detailed description is use advice.

Alongside sits Anthropic's unqualified statement about the routing surface, verbatim: "**Provide extremely detailed descriptions.** This is by far the most important factor in tool performance", with the concrete form "Aim for at least 3–4 sentences for each tool description, more if the tool is complex."

**What this changes here.** The mapping onto skills is exact and already validated. A skill's frontmatter description is the routing surface, its body the instruction surface, its references the deep surface. This repository measured the separation from the other side, because body genre does not move triggering, which is the same claim reached empirically rather than by assertion. Effort spent on the body to fix a triggering problem is spent on the wrong surface, and the 3-to-4-sentence floor is the vendor's guidance for the surface that does move it. The description is the one routing lever an author controls.

### Finding 13. Routing between models is measured; skills are not

**Labels.** PUBLISHED · MEASURED · OFF-TARGET · SHIPPED-PRACTICE

**In short.** Routing queries between a strong and a weak model is measured and survives swapping the models. A stronger model choosing skills on behalf of a weaker one is measured nowhere this survey reached.

**Evidence.** RouteLLM (arXiv 2406.18665), verbatim from its abstract: "we propose several efficient router models that dynamically select between a stronger and a weaker LLM during inference, aiming to optimize the balance between cost and response quality... Our evaluation on widely-recognized benchmarks shows that our approach significantly reduces costs-by over 2 times in certain cases-without compromising the quality of responses. Interestingly, our router models also demonstrate significant transfer learning capabilities, maintaining their performance even when the strong and weak models are changed at test time."

**Limits.** Scoping this honestly matters more than reporting it, which is why the label is OFF-TARGET. RouteLLM routes queries between models. The architecture the owner's question describes, where a stronger model decides which skill fires and a weaker model executes it, is a different thing, and no measurement of it was found. The transfer-learning result is the part most likely to carry over, since it suggests a router's decision function is not tightly coupled to the models behind it, but that is an inference and is labelled as one.

**What this changes here.** The shipped analogue in this ecosystem is the subagent: a stronger orchestrator dispatching to a subordinate agent with its own context. That pattern is SHIPPED-PRACTICE and, as far as this survey found, entirely unmeasured on routing accuracy.

### Finding 14. Addy Osmani's pack says nothing about model tiers

**Labels.** SHIPPED-PRACTICE · NEGATIVE RESULT

**In short.** The most-cited third-party prior art in this ecosystem says nothing about model tiers, and its stated reason for progressive disclosure is token cost rather than model capability.

**Evidence.** Grepping his repository README, his blog post on agent skills and his lesson on agent skills, case-insensitively, for Haiku, Opus, Sonnet, weaker model, smaller model, cheaper model, model tier and less capable returns **zero matches in all three files**. The absence is genuine rather than a wording difference. The method is the same negative confirmation ANALYSIS-005 used on the anti-rationalization genre.

What he does say about progressive disclosure, verbatim: "**Progressive disclosure.** The `SKILL.md` is the entry point. Supporting references load only when needed, keeping token usage minimal." From the blog post: "This is the harness engineering lesson applied at skill granularity. Every token loaded into context degrades performance somewhere, so you load what's relevant and leave the rest on disk. Progressive disclosure is how you get a twenty-skill library into a 5K-token slot without poisoning the well." And the generalised form: "Progressive disclosure for any rulebook. Do not write a 50-page handbook. Write a small router that points to the right small chapter for the situation."

On the routing surface specifically, from the lesson: "The description field is critical. It is the primary way agents decide whether to activate a skill. Write it to clearly describe both what the skill does and when it should be used", with the three levels costed as "At startup, load only skill names and descriptions (~100 tokens each)... Even with 50 skills installed, the startup cost is only about 5,000 tokens."

**Limits.** His rationale is asserted rather than measured. No evaluation accompanies any of it.

**What this changes here.** Two things carry. His pack's README documents a portability defect in the architecture ANALYSIS-004 catalogued as a third shape: a per-skill install "copies only `skills/<name>/`, not the repo-level `references/` directory", so the shared pool's paths are unavailable, which he tracks as an open issue. That matters because this repository considered the shared-pool architecture, and the shared pool has a distribution cost its author states publicly. The single point of convergence with the measured record is the router framing: a small router pointing at the right small chapter is Finding 12's two-surface split in different words. Everything else is orthogonal to the tier question rather than evidence on it.

## Finding 15: the figure a search summary invented

### Finding 15. A search summary invented two figures

**Labels.** METHOD · CORRECTION

**In short.** A web-search summary invented two figures and an anti-correlation claim, attributed them to the constraint-saturation paper, and the paper argues the opposite direction on that exact question.

**Evidence.** While locating Finding 4's source, a web-search summary asserted of the constraint-saturation paper that "the degradation rate under constraint composition is strongly anti-correlated with baseline capability, spanning nearly an order of magnitude from 8.1% (Gemini 3.1 Pro) to 81.8% (Qwen3.5 0.8B)".

That claim was checked against the paper's own text, both the abstract page and the full v1 HTML at 155KB stripped, grepping for `81.8`, `8.1%`, `anti-correlat`, `order of magnitude` and `baseline capability`. **Neither figure appears anywhere, and the phrase "anti-correlated" appears nowhere.** The only match for "baseline capability" is the unrelated structural-versus-lexical comparison quoted in Finding 4. Worse than absent, the paper's own text argues the opposite direction. Its section headed "Scale does not predict compositional performance" reports ranking inversions counter to scaling expectations, quoted in Finding 5.

**What this changes here.** Had that summary been trusted, this note would have carried a fabricated headline number supporting its central thesis, inside a paper that partly contradicts it. That is the most dangerous shape an error can take, because it would have read as the strongest evidence in the note.

This is the second recorded instance of the fault class in this research programme. A fetch summariser fabricating a paper's contents is what put the verify-against-primary-text rule into ANALYSIS-004. It is a finding rather than a footnote because two independent instances make it a base rate rather than an anecdote: a summariser's number is not evidence that the number exists. The check costs one grep.

## Findings 16 to 20: how these failures get detected

Added on 2026-08-24 in response to a third question: what methods the community uses to identify tier-dependent failures before they bite. Sources added for this pass: Anthropic's skill-authoring and evaluation pages, the writing-tools-for-agents engineering post re-read for its evaluation protocol, promptfoo's configuration guide, Vercel's agent-eval post, and TanStack's agent-skills documentation. Where this repository's harness already implements a method, it is cross-referenced as existing practice rather than presented as new.

### Finding 16. The vendor asks for tier tests and ships no metric

**Labels.** VENDOR · GUIDANCE

**In short.** Anthropic tells authors to test a skill on every tier, and supplies three different qualitative questions rather than one metric, so the published protocol cannot produce a tier diff.

**Evidence.** Verbatim, from the skill-authoring best-practices page under the heading "Test with all models you plan to use": "Skills act as additions to models, so effectiveness depends on the underlying model. Test your Skill with all the models you plan to use it with."

The per-tier prompts are given as a list. Claude Haiku: "Does the Skill provide enough guidance?" Claude Sonnet: "Is the Skill clear and efficient?" Claude Opus: "Does the Skill avoid over-explaining?" The section closes with "What works perfectly for Opus might need more detail for Haiku." The authoring checklist carries "Tested with Haiku, Sonnet, and Opus".

Separately, `claude plugin eval` exists as tooling in this ecosystem but does not appear in the public plugins documentation as of 2026-08-24. That page was fetched and grepped for "plugin eval", "eval suite" and "--eval", with zero matches.

**Limits.** Whether `claude plugin eval` supports a cross-tier matrix is not establishable from public primary text. It is recorded as a gap rather than guessed at.

**What this changes here.** The prescription is real and the instrument is missing, in a way worth naming precisely. The three questions are not one question asked three times. They are three different qualitative judgements, one per tier. A cross-tier matrix needs the opposite shape: a single metric on every tier, so the tiers can be subtracted. As published, the protocol yields three separate impressions, and impressions are exactly what ANALYSIS-004 Finding 3 shows fail here, because the strong tier reads eagerly and looks healthy whatever the pointer says.

This repository's two-tier trigger sweeps, its tier-study flag and its recall-by-tier split already implement what the published protocol lacks: one metric, both tiers, subtractable. That is not novelty imported from this survey. It is existing practice the survey finds no published equivalent for.

### Finding 17. Community eval tools compare models by default

**Labels.** COMMUNITY · SHIPPED-PRACTICE

**In short.** In promptfoo, naming a second provider is the whole of the work needed for a cross-model comparison, and the tool treats one-model evaluation as the special case.

**Evidence.** promptfoo's configuration guide takes `providers` as a list and states the consequence verbatim: "Running promptfoo eval over this config will result in a matrix view that you can use to evaluate GPT vs Gemini." The worked config lists two providers against one shared test set.

**Limits.** This matters for adopting it here. promptfoo compares providers on prompt outputs. Whether it can observe which skill was selected inside an agent harness, as opposed to what the final answer looked like, was not established from its documentation in this pass, and the two are different measurements. The SHIPPED-PRACTICE label covers cross-model comparison generally, and explicitly not skill-selection observability.

**What this changes here.** Where a vendor prescribes cross-tier testing without an instrument, the community tooling makes the instrument the path of least resistance.

### Finding 18. Watch why a tool was not called, not just whether

**Labels.** VENDOR · GUIDANCE · TECHNIQUE

**In short.** Anthropic prescribes routing observability and secondary metrics alongside top-level accuracy, and reaches the hand-annotation problem without solving it.

**Evidence.** From the writing-tools-for-agents post, verbatim: "In your evaluation agents' system prompts, we recommend instructing agents to output not just structured response blocks (for verification), but also reasoning and feedback blocks." And, more directly on routing observability: "If you're running your evaluation with Claude, you can turn on interleaved thinking for similar functionality 'off-the-shelf'. This will help you probe **why agents do or don't call certain tools** and highlight specific areas of improvement in tool descriptions and specs."

On instrumentation beyond the headline number: "As well as top-level accuracy, we recommend collecting other metrics like the total runtime of individual tool calls and tasks, the total number of tool calls, the total token consumption, and tool errors. Tracking tool calls can help reveal common workflows that agents pursue and offer some opportunities for tools to consolidate."

The most useful sentence carries its own caveat, on annotating which tool a task should have used: "For each prompt-response pair, you can optionally also specify the tools you expect an agent to call in solving the task, to measure whether or not agents are successful in grasping each tool's purpose during evaluation. However, because there might be multiple valid paths to solving tasks correctly, try to avoid overspecifying or overfitting to strategies."

Anthropic's general evaluation guidance adds two lines that bear on tier work: "We relied on held-out test sets to ensure we did not overfit to our 'training' evaluations", and, from the test-development page, "Prioritize volume over quality: More questions with slightly lower signal automated grading is better than fewer questions with high-quality human hand-graded evals" plus "A/B testing: Compare performance against a baseline model or earlier version." The last is the closest thing published to a regression gate on a model change, and it is stated generically rather than for skills.

**What this changes here.** This is the vendor independently reaching the hand-annotation problem, because a should-have-used label is a guess about one valid path among several, and stopping at the warning. ANALYSIS-004 Finding 18 goes further and solves it. An ablation denominator establishes need causally, by removing content and watching the score move, rather than by asserting the expected path in advance. This survey found no published equivalent anywhere. The vendor guidance corroborates that the annotation problem is real, and this repository's answer to it remains the stronger one.

### Finding 19. A test the model can already pass detects nothing

**Labels.** COMMUNITY · TECHNIQUE

**In short.** A disclosure mechanism has failed when the model produces its training prior instead of the supplied content, so a test the model can already pass detects nothing. Two independent sources converge on it, and it is the sharpest detection result in the note.

**Evidence.** Vercel, on why their first eval suite could not see anything, verbatim: "Our initial test suite had ambiguous prompts, tests that validated implementation details rather than observable behavior, and **a focus on APIs already in model training data**. We weren't measuring what we actually cared about." Their fix: "Most importantly, we added tests targeting Next.js 16 APIs that aren't in model training data." Their closing recommendation states it as a rule: "Test with evals. **Build evals targeting APIs not in training data. That's where doc access matters most.**"

TanStack ships the same idea as a user-facing diagnostic. Its "Confirm It's Wired Up" step tells the reader to open a fresh session, ask for a specific task, and check named observable markers: "The agent uses `chat()`, not `streamText()`", and "The adapter is imported as `openaiText()` from `@tanstack/ai-openai`, not `createOpenAI()`". It closes with the failure signal: "**If the agent still falls back to other-SDK patterns**, re-open its config file and confirm the intent-skills block is present and the `task:` descriptions clearly cover the area you're asking about."

Both make the same move from opposite directions. The observable separating a working disclosure mechanism from a broken one is whether the model produced the supplied content or fell back to its prior. A test whose correct answer the model can already produce passes either way, and its pass is evidence of nothing.

**What this changes here.** This is directly actionable and names a defect class never audited for here. Any should-fire scenario whose expected output the model can generate without the skill is inert. That is the triggering-side twin of the recall-denominator problem ANALYSIS-004 Finding 1 corrects. There, a raw rate could not separate rarely-needed from needed-and-missed. Here, a passing scenario cannot separate the skill fired from the model already knew. It converges with the ablation method already in use: a scenario whose score does not move when the skill is stripped is one whose answer was already in the model.

### Finding 20. Fix the test suite before trusting its numbers

**Labels.** COMMUNITY · TECHNIQUE

**In short.** Vercel published their eval suite's defects and the three controls that fixed them before publishing any result the suite produced.

**Evidence.** Verbatim: "Before drawing conclusions, we needed evals we could trust... We hardened the eval suite by removing test leakage, resolving contradictions, and shifting to behavior-based assertions." And on run discipline: "All the results that follow come from this hardened eval suite. Every configuration was judged against the same tests, **with retries to rule out model variance**."

Three controls sit in one paragraph: leakage removal, behaviour-based rather than implementation-based assertions, and repetition against provider variance.

**What this changes here.** The third control is the one ANALYSIS-004 Finding 18 records learning the hard way, where arms had to run concurrently so provider drift landed on both. This belongs in the same register as ANALYSIS-003's fault classes. A suite returning a healthy number from a leaky test is worse than no suite, because a passing result is stronger evidence than an absent one. Publishing a suite's defects before its findings is the practice worth copying, independent of what the findings were.

## Findings 21 to 24: Vercel and TanStack, read in full

### Finding 21. Vercel is right; one citation here is wrong

**Labels.** CORRECTION · MEASURED

**In short.** Vercel's figures are accurate as published, this repository's 44 percent is a computed complement rather than a stated figure, and ANALYSIS-005's rule 1 rests on a change that was not what the rule describes.

**Evidence.** The post's figures, verified verbatim: baseline 53 percent; skill with default behaviour 53 percent, described as "Zero improvement. The skill existed, the agent could use it, and the agent chose not to"; skill with explicit instructions 79 percent; and the AGENTS.md docs index at 100 percent across Build, Lint and Test. On triggering: "In 56% of eval cases, the skill was never invoked", and after the intervention, "This improved the trigger rate to 95%+".

Two precision notes on how this repository cites it. **The 44 percent figure is a complement this repository computed, not a number the post states** — the post gives 56 percent non-invocation. And the upper figure is "95%+", not 95 percent flat. Neither is wrong. Quote them as derived and as a floor, respectively.

The substantive correction is larger and lands on a sibling note. ANALYSIS-005's lineage table records rule 1, "A numbered workflow is the spine of the body", with verdict SURVIVES, on the basis of "Vercel's evaluation, invocation 44% to 95%". The primary text shows the change was not a numbered workflow, and was not inside the skill at all: "**We tried adding explicit instructions to AGENTS.md telling the agent to use the skill**". The instruction is quoted in full:

```text
Before writing code, first explore the project structure, then invoke the nextjs-doc skill for documentation.
```

That is host-prompt-level forced invocation, authored **outside** the skill, in always-loaded passive context. It is evidence for Finding 11, where prompt-level steering is the only substitute available when a `tool_choice` equivalent is missing. It is not evidence about body structure.

This repository's other Vercel citation is accurate as stated. The context-optimizer surface cites passive context at 100 percent against skills at 53 to 79 percent, and the post says exactly that: "A compressed 8KB docs index embedded directly in AGENTS.md achieved a 100% pass rate, while skills maxed out at 79% even with explicit instructions telling the agent to use them. Without those instructions, skills performed no better than having no documentation at all."

**What this changes here.** Rule 1 loses its only positive measured support and joins rules 3, 5 and 6 as defensible doctrine never measured on this repository's artifacts. ANALYSIS-005's own framing makes this the right correction to make loudly. That note wrote that every genre entry carries a value label precisely because two of six proposed rules died on contact with measurement, and this is a third dying on contact with its own citation.

### Finding 22. The most forceful wording performed worst

**Labels.** COMMUNITY · MEASURED

**In short.** On the same skill and the same docs, the maximally forceful instruction lost to one that sequenced the work and mentioned the skill second.

**Evidence.** Their wording table, verbatim in both rows. "You MUST invoke the skill" produced "Reads docs first, anchors on doc patterns", with the outcome "Misses project context". "Explore project first, then invoke skill" produced "Builds mental model first, uses docs as reference", with the outcome "Better results". Their summary: "Same skill. Same docs. Different outcomes based on subtle wording changes."

With a concrete instance: "In one eval (the 'use cache' directive test), the 'invoke first' approach wrote correct page.tsx but completely missed the required next.config.ts changes. The 'explore first' approach got both." And their reaction: "This fragility concerned us. If small wording tweaks produce large behavioral swings, the approach feels brittle for production use."

The same section carries a cost finding for a skill that is present and unused: "the skill actually performed worse than baseline on some metrics (58% vs 63% on tests), suggesting that **an unused skill in the environment may introduce noise or distraction**."

**Limits.** The unused-skill observation is one metric in one suite, and it is a different question from whether an unnecessary read costs anything. Neither is measured cleanly, and both stay open.

**What this changes here.** This corroborates Finding 9's model-dependence cluster and adds what none of those sources do: the maximally forceful phrasing lost. That is a direct counterexample to the intuition that a missed pointer wants a stronger imperative. It converges with Finding 4's account of why strengthening one term does not fix a collapsing conjunction, and with this repository's own imperative in-workflow pointer scoring 0 of 20. The unused-skill number is partial evidence on ANALYSIS-004's open question about whether over-fetch costs anything, from the other side: not the cost of reading something unnecessary, but the cost of it merely being available.

### Finding 23. Vercel never names a model, and that matters

**Labels.** COMMUNITY · SCOPE

**In short.** The most-cited external result in this repository's skill guidance reports one configuration on an unnamed model, so its tier-sensitivity is unknown.

**Evidence.** The post was grepped for every Claude, GPT and Gemini model name, and for "model tier", "weaker model", "smaller model" and "across models": **zero matches**.

Their stated theory for why passive context wins is three factors, verbatim: "No decision point. With AGENTS.md, there's no moment where the agent must decide 'should I look this up?'"; "Consistent availability. Skills load asynchronously and only when invoked. AGENTS.md content is in the system prompt for every turn."; and "No ordering issues. **Skills create sequencing decisions** (read docs first vs. explore project first). Passive context avoids this entirely."

Their scoping is more careful than the headline suggests, and deserves quoting since this repository builds skills: "Skills aren't useless... Skills work better for vertical, action-specific workflows that users explicitly trigger, like 'upgrade my Next.js version,' 'migrate to the App Router,' or applying framework best practices. The two approaches complement each other."

**What this changes here.** State it plainly because of what the number is used for. A 56 percent non-invocation rate is exactly the quantity Findings 2, 6 and 7 predict should move with tier, since long-list and routing failures are where the tiers diverge most, and capability-graded benefit says an instruction remedy should pay off differently at different tiers. The tier-sensitivity cannot be recovered from the published text.

Their third factor converges independently with Finding 4. Invoking a skill adds a sequencing demand to a step that already carries several, and their own wording-fragility result demonstrates the mechanism.

### Finding 24. TanStack ships the same fix with no evidence

**Labels.** SHIPPED-PRACTICE · SCOPED NEGATIVE

**In short.** TanStack installs a routing map into the agent's own config file, which is Vercel's measured remedy turned into a distributable mechanism, and publishes no measurement of it.

**Evidence.** TanStack's **Intent** mechanism ships skills inside npm packages and installs a routing table into the agent's own config file. `npx @tanstack/intent@latest install` writes an `intent-skills` block whose entries pair a task description with a file path. One entry pairs a task of "Building chat, tool calling, adapters, or streaming with TanStack AI" with `node_modules/@tanstack/ai/skills/ai-core/SKILL.md`, under the header comment "Skill mappings — when working in these areas, load the linked skill file into context." The block is rendered in "What these look like in practice" above.

TanStack names the routing lever explicitly, verbatim: "Check that the `task:` descriptions match areas you actually work in. Tighten or reword them if needed — **they're how your agent decides when to pull the skill into context.**"

Their stated reason for packaging is the training-prior framing Finding 19 turns into a detection method. Skills ship in the package "so the guidance travels with `npm update` instead of being pinned in a model's training data or copy-pasted into CLAUDE.md manually."

The scoped negative, stated because a named source's silence is a finding. The TanStack agent-skills documentation was grepped for Haiku, Opus, Sonnet, weaker model, smaller model, model tier, less capable, eval, benchmark and pass rate: **zero matches on all of them.** As of 2026-08-24 TanStack publishes a routing mechanism and a manual verification procedure, and publishes no evaluation, no measurement, and no model-tier guidance whatever.

**Limits.** One shipped practice here conflicts with published vendor guidance and should be recorded rather than adopted. TanStack routes skills to each other: "ai-core points at the companion packages' skills, and ai-persistence is an entry point that routes to its own sub-skills (`server`, `stores`, and the `build-{drizzle,prisma,cloudflare,custom}-adapter` recipes)." That is multi-level nesting, against the one-level-deep rule and the partial-read mechanism behind it recorded in ANALYSIS-004 Findings 8 and 17. Nobody has measured which is right, and the tension is live.

**What this changes here.** Rather than relying on a skill's own description to win the routing decision from inside the skill, both Vercel and TanStack put a task-to-file map into always-loaded passive context. Vercel measured that architecture at 100 percent against 53. TanStack ships it as the install path for a library. Two unconnected teams converging on the same structural answer is the strongest non-measured signal in this survey. TanStack is also the third independent source saying the description is where routing is won, which is Finding 12 again. Their contribution is architecture and a detection procedure, not evidence.

## What nobody has measured yet

- **Whether skill triggering has ever been measured against model tier by anyone else.** Nothing in this survey measures whether a skill fires, by tier, on realistic user phrasings. Every external result quoted here is about tool selection, function calling or constraint following. This repository's 20-of-39-against-90-percent figure appears to be the only measurement of the actual quantity, which means it has no external replication and no external contradiction.
- **Whether the tool-count thresholds transfer to skill counts.** Three vendors bound the tool list at 30 to 50, 10 to 20, and under 20. A tool definition sits in the tool block with a schema. A skill contributes roughly 100 tokens of name and description to the system prompt. The surfaces differ in size, position and structure, and nobody has measured whether the thresholds move together. Adopting a skill-count cap from these numbers would repeat the category error ANALYSIS-004 Finding 17 corrects.
- **Whether the description-rewriter result transfers to the Claude family.** MetaTool's rewriters and downstream models are all the 2023 generation. Whether a description tuned by the strongest current Claude degrades routing on a weaker current Claude is exactly the experiment this repository could run and has not.
- **Whether description length helps monotonically, has a ceiling, or reverses.** The fitted-line result is observational and confounded with overlap reduction, and Anthropic's 3-to-4-sentence floor is a floor with no stated ceiling. No source anywhere states where more detail stops helping.
- **Where a pointer should sit, now with three published claims in three directions.** Lost-in-the-middle predicts end-of-context is favoured. IFScale reports bias toward earlier instructions. This repository measured trailing beating in-step at 8 of 40 against 4 of 40, p approximately 0.20. Finding 4 offers a fourth account in which position is not the variable at all and demand count is. None has been separated from the others, and the honest position is that the question is open and expensive.
- **Whether the 5-to-6 demand ceiling applies to a skill body's rules.** The demands measured are verifier-checkable output properties. Whether "read this file when X" occupies the same budget as "output valid JSON" is unestablished, and the whole application of Finding 4 to this repository's 0-of-20 result rests on it.
- **Whether a strong-routes-weak-executes architecture improves skill selection.** RouteLLM measures query routing between models, not skill selection. The subagent pattern is the shipped analogue and no measurement of its routing accuracy was found.
- **Whether over-fetch on the strong tier costs anything.** Inherited unresolved from ANALYSIS-004 and untouched here.
- **Eight vendors not checked on this axis.** Cursor, Windsurf, Cline, Continue, JetBrains AI, Amazon Q Developer, Zed and Sourcegraph Amp were not searched for model-tier guidance in this pass. The five matcher vendors are the most likely to hold something useful, since a deterministic matcher is precisely the mechanism that makes tier irrelevant, and any statement they make about why would bear on Finding 11.
- **Whether Vercel's 56 percent non-invocation rate is tier-dependent.** Their post names no model anywhere. It is the most-cited external result in this repository's skill guidance, and the quantity it reports is exactly the one Findings 2, 6 and 7 predict should move with tier. Unrecoverable from the published text.
- **Whether a routing map beats a skill description on this repository's own artifacts.** Vercel measured that architecture at 100 percent against 53 and TanStack ships it, but neither result is about this repository's skills, and the A/B has not been run here. It is the most directly testable thing this survey surfaced.
- **How many of this repository's should-fire scenarios are inert.** Finding 19 establishes that a scenario the model can pass without the skill cannot detect a triggering failure. The existing should-fire set has never been audited for training-prior leakage, so the fraction is unknown, and the 20-of-39 figure's denominator is unaudited in a way distinct from every limitation already recorded.
- **Whether any community harness can observe skill selection rather than output quality.** promptfoo makes cross-model matrices the default output shape, but on prompt outputs. Whether it or anything else can see which skill an agent harness selected was not established from primary text in this pass.
- **Whether `claude plugin eval` supports a cross-tier matrix.** It exists as tooling in this ecosystem and does not appear in the public plugins documentation as of 2026-08-24, grepped and confirmed absent. Its capabilities are not establishable from public primary text.
- **Whether TanStack's multi-level skill routing degrades reads.** They route skills to sub-skills, against the published one-level-deep rule and the partial-read mechanism behind it. Nobody has measured which is right.
- **Whether an unused-but-present skill costs anything.** Vercel observed 58 percent against a 63 percent baseline on one metric, and offered noise or distraction as a hypothesis. That is one metric in one suite, and it is a different question from whether an unnecessary read costs anything.

## Words this note uses precisely

One word for one concept, everywhere. Each **Avoid** list names the words this note does not use for that concept, so a reader never has to work out whether two words are two ideas, and a search for the right word finds every place it appears.

Quoted text is the exception. A quotation keeps its author's words, so a vendor's "invoke", "trigger" or "activate" appears inside quotation marks unchanged.

**Routing.** The model choosing which tool or which skill to use for a request. Routing happens before anything is read. **Avoid:** selection, dispatch, activation, tool choice.

**Triggering.** Routing applied to skills: whether a given skill loads for a given request. Triggering is one kind of routing, not a second idea. **Avoid:** invocation, firing, activation.

**Disclosure.** The model reading supplied material after routing has already picked something. A reference file is read at disclosure time, not at routing time. **Avoid:** retrieval, lookup, fetch.

**Routing surface.** The text a model reads while deciding. For a tool it is the tool description. For a skill it is the frontmatter description, and that is the only routing surface a skill author controls. **Avoid:** trigger text, description field, when the surface rather than the field is meant.

**Instruction surface.** The text a model reads after it has decided. For a skill it is the body. **Avoid:** skill content, prompt body.

**Deep surface.** The reference files the body points at, reached only after the body has been read. **Avoid:** bundled resources, attachments.

**Tier.** A model's capability level inside a family. This note says strong tier and weak tier and nothing else. This repository ships against sonnet as its weak tier. **Avoid:** smaller model, cheaper model, bigger model, less capable model.

**Recall.** The share of the reference files a model actually reads, measured per file. **Avoid:** coverage, read rate.

**Over-fetch.** A model reading material it did not need. The strong tier's failure direction here. **Avoid:** over-reading, eager loading.

**Under-reach.** A model failing to read material it did need. The weak tier's failure direction here. **Avoid:** under-triggering, missing the pointer.

**Capability-graded.** A remedy whose benefit depends on the tier receiving it: large on the weak tier, near zero on the strong tier. The direction of the effect is fixed; only its size changes with tier. **Avoid:** tier-sensitive, scales with model.

**Model-dependent.** An effect whose direction changes with the model: it helps one model and harms another. This is a different thing from capability-graded, where the direction never flips. Reading a null result correctly depends on knowing which one you are looking at, so the two are never blurred here. **Avoid:** varies by model, model-specific.

**Passive context.** Text in front of the model on every turn because an always-loaded file such as AGENTS.md or CLAUDE.md holds it. The model does not decide to read passive context. It is simply there. **Avoid:** ambient context, always-on docs, system prompt injection.

**Routing map.** A short list in passive context. Each line pairs a task description with a file path: when working in this area, read this file. A skill asks the model to make a judgment call, matching its own description against the request. A routing map asks for nothing of the kind, because the instruction is already there and the model only matches a task to a line. "What these look like in practice" shows one. **Avoid:** passive-context routing map, since passive context is already its home; skill index; task map.

**Pointer.** One sentence in a document telling the model to read another document. A skill description is a pointer. A line in a workflow step saying to read the reference file is a pointer. **Avoid:** signpost, reference, link.

**Demand.** One thing a step asks the model to do. A step saying produce JSON, stay under 200 words, and read the reference file carries three demands. The papers behind Findings 4 and 5 call these constraints, and their quoted text keeps that word. **Avoid:** instruction, requirement, rule, when a single ask inside a step is meant.

**Forced invocation.** A vendor control that takes the routing choice away from the model. Anthropic's `tool_choice` is one. The vendor's own word is kept here because the term names their control rather than the event. **Avoid:** forced triggering, mandatory tool use.

**Training prior.** What a model can already produce from its training, with nothing supplied.

**Inert scenario.** A should-fire scenario the model passes from its training prior. It passes whether or not the skill loaded, so it measures nothing. **Avoid:** leaky test, weak test.

**Ablation denominator.** Establishing that content was needed by removing it and watching the score move, rather than by asserting in advance which skill should have fired. **Avoid:** expected-tool annotation, ground-truth label.

## How every claim here was checked

Every external claim was checked against primary text on 2026-08-24. Vendor documentation was fetched as raw markdown where the site serves it, and as locally stripped HTML where it does not. Papers were fetched as their arXiv abstract or as full HTML. Each quoted sentence was then grepped for in the fetched file before it was written down.

No claim rests on a search summary or a fetch summariser. That rule is not caution for its own sake. During this investigation a search summariser attributed two figures to a paper, and grepping the paper's own text found neither, plus a result running the opposite way. Finding 15 records it.

Three method details are worth keeping. Gemini's function-calling page, OpenAI's function-calling guide and prompting guide, and the two Anthropic engineering posts were fetched as HTML and stripped locally with a regex stripper, so no model touched them. Papers quoted on a body claim were fetched as the full HTML of the specific version cited. And version matters: MetaTool's abstract changed materially between v3 and v6, and the recommendation this note leans on appears only in v6.

The owner's question named "AdiazMadi" among the sources to cover. That is almost certainly Addy Osmani, whose skill pack is prior art in this repository's research and whose name matches phonetically. Finding 14 covers him by name, and the interpretation is recorded here so a later reader can correct it if it is wrong.

**Sources reached.** Anthropic (skill-authoring best practices, tool-use overview, define-tools, tool search tool, the advanced tool use engineering post, the writing-tools-for-agents engineering post, the agent-skills engineering post), Google (Gemini function-calling documentation), OpenAI (function-calling guide, GPT-5 prompting guide), Berkeley Function Calling Leaderboard blog posts, Addy Osmani (repository README, blog post, lesson), promptfoo's configuration guide, Vercel's agent-eval post, TanStack's agent-skills documentation, and four papers read in primary text.

**Not reached on this axis.** JetBrains AI, Amazon Q Developer, Zed, Sourcegraph Amp, Cursor, Windsurf, Cline and Continue. None was checked for model-tier guidance in this pass.

## Observations

### Why the weak tier misses

- [fact] Three vendors independently put a count on the routing surface — Anthropic states tool selection degrades past 30 to 50 available tools, Gemini caps the active set at 10 to 20, OpenAI advises fewer than 20 at the start of a turn — while no vendor caps the number of reference files a skill may bundle #vendors #thresholds
- [insight] The record is coherent once the two surfaces are separated. Vendors bound the set a model must choose among and decline to bound the set it may later read, so tool-count guidance must never be imported as reference-count guidance #routing-surface #disclosure-surface
- [fact] Measured across nine models, tool-selection performance declines as list size grows, all models decline most sharply between five and ten tools, and the strongest model in the set is nearly flat across the same growth #metatool #list-length
- [insight] The external long-list result is the same shape as this repository's recall table on a different mechanism, task and model family, which is the first independent corroboration the tier gap has #corroboration #asymmetry
- [problem] Weak-model routing failure runs in both directions rather than being merely reduced. One benchmarked model fires on essentially every query while two others almost never fire, with many near coin-flip accuracy, so capability predicts unreliability but not its direction #polarity #instrument
- [constraint] This repository's tier is measured at the under-reach pole with zero over-fetch across eight negative runs. That is a fact about this tier on this artifact and does not transfer to an uncharacterised weak model, so an over-fetch check belongs in any sweep against a new tier #instrument #scope
- [fact] Reliable instruction following breaks down beyond five or six simultaneous demands across 15 models, with a model passing individual demands at about 41 percent at k=8 satisfying all eight just 5.7 percent of the time #composition #ceiling
- [insight] A pointer inside a workflow step is one more simultaneous demand. That is the first published account explaining an imperative in-step pointer scoring 0 of 20 here, and it predicts that strengthening the pointer would not have helped #composition #in-step-null
- [risk] The same paper reports ranking inversions counter to scaling expectations and states that single-constraint competence does not predict compositional robustness, so weaker-routes-worse is a defensible summary of the routing evidence and not a law #scale #contrary
- [fact] One model moved from rank ten to rank two on output token budget alone with no change to its compositional capacity, so a measured tier gap requires separating capability from sampling budget, alignment training and task shape before it is attributed to capability #confound #budget
- [problem] Instruction-density work reports bias toward earlier instructions, a third position claim pointing against both lost-in-the-middle's end-of-context prediction and this repository's measured trailing-beats-in-step null #position #unresolved

### How a remedy's benefit is shaped

- [outcome] The central remedy result is capability-graded benefit. A training-free instruction-compiler rewrite recovers up to 11 points of follow rate for weaker production-tier models while leaving stronger models essentially unchanged, with controls excluding token count, reordering and measurement headroom #capability-graded #measured
- [insight] Capability grading inverts the default reading of a null. A remedy showing nothing on the strong tier has produced the predicted result rather than a refutation, and a remedy measured only on the strong tier has measured almost nothing #calibration #null-reading
- [fact] Anthropic's internal testing reproduces the grading independently on a different remedy: Opus 4 improved from 49 to 74 percent with the tool search tool enabled while Opus 4.5 improved from 79.5 to 88.1, a 25-point gain against 8.6 #tool-search #grading
- [risk] Those numbers are internal testing across model generations rather than across tiers within one generation, so they corroborate the grading rather than establishing it #tool-search #caveat
- [decision] The tool search mechanism is classified MECHANISM-SPECIFIC and not recommended for adoption. Skills already implement three-level disclosure but expose no deferred-loading flag, no search step, and no way for an author to request retrieval rather than model choice #mechanism #gap
- [outcome] A description rewritten by a strong model is not a neutral improvement. A Llama2-70b rewrite gained 7.83 percent for Llama2-13b while a GPT-4 rewrite sharply degraded two other model families, and the paper's recommendation is to choose the rewrite model by the downstream model that will route #rewriter #sign-flip
- [insight] That upgrades the established protocol from measure-on-the-weak-tier to optimise-on-the-weak-tier, since editing a description is an intervention with a direction and that direction has been observed negative #protocol #upgrade
- [problem] The companion description-length result is observational, a fitted line over tools that also differ in functional overlap, so only the rewriter half of that paper carries weight and the two must not be quoted as equally strong #confound #honesty

### What an author controls, and what the vendor keeps

- [fact] Three independent sources report that a routing remedy's effect is model-dependent: namespacing effects that vary by LLM, examples that may hurt reasoning models, and rewriter benefit that varies by downstream family #model-dependence #convergence
- [decision] There is no portable weak-model phrasing rule to adopt. What the record supports is a method — hold the routing surface fixed, vary one thing, measure on the deployment tier — which this repository already practises #no-portable-rule #method
- [technique] Two vendors prescribe consolidation over proliferation, with fewer and more capable tools said to reduce selection ambiguity, and one benchmark had to merge 390 tools into 198 because overlap made ground truth undefinable #consolidation #overlap
- [technique] Description overlap is mechanically detectable by embedding sibling descriptions and clustering them, the operation that benchmark performed, and it bears directly on the eight of nineteen misses here sitting on near-verbatim hook vocabulary #overlap-detection #actionable
- [problem] Every vendor ships a forced-invocation control for tools — Anthropic's tool_choice, Gemini's auto, any, none and validated modes plus an allowed-tools restriction, and OpenAI's equivalent — and a Claude Code skill has no analogue beyond a user naming it #forced-invocation #absent
- [technique] One vendor now states the two-surface split outright, putting concise routing text in the namespace description and detailed guidance in the function description. That maps exactly onto a skill's frontmatter against its body, and is confirmed here from the other side by body genre not moving triggering #two-surface #validated-here
- [fact] The vendor floor for the routing surface is explicit. Extremely detailed descriptions are called by far the most important factor in tool performance, with at least 3 to 4 sentences covering what the tool does, when to use it and when not to #description-floor #anthropic

### What the survey did not find, and one method correction

- [fact] Grepping Addy Osmani's repository README, blog post and lesson case-insensitively for Haiku, Opus, Sonnet, weaker model, smaller model, cheaper model, model tier and less capable returns zero matches in all three files #addy #negative-confirmed
- [insight] His stated rationale for progressive disclosure is token cost and attention dilution rather than model capability, asserted without any accompanying evaluation, so the most-cited third-party prior art in this ecosystem is orthogonal to the tier question rather than evidence on it #addy #orthogonal
- [technique] His one point of convergence with the measured record is the router framing — write a small router that points to the right small chapter rather than a 50-page handbook — which is the two-surface split in different words #addy #convergence
- [risk] His pack's own README documents that a per-skill install copies only the skill directory and not the repository-level shared references, so the shared-pool architecture carries a distribution cost its author states publicly #shared-pool #portability
- [problem] A web-search summariser attributed two specific figures and an anti-correlation claim to the constraint-saturation paper. Grepping its abstract plus 155KB of stripped full text found neither figure, no occurrence of anti-correlated, and a section arguing the opposite direction on that exact question #summariser #fabrication
- [constraint] Two independent instances of a summariser inventing a paper's contents make this a base rate rather than an anecdote, so a summariser's number is not evidence that the number exists and the check costs one grep #verification #base-rate
- [problem] No external measurement of skill triggering against model tier was found anywhere, so this repository's 20-of-39-against-90-percent figure has neither replication nor contradiction outside itself #gap #unreplicated
- [problem] The strong-routes-weak-executes architecture is measured for query routing between models and unmeasured for skill selection. The subagent pattern is its shipped analogue and carries no routing-accuracy measurement #routing-layer #unmeasured
- [risk] Eight vendors were not checked on the model-tier axis, and the five matcher vendors are the most likely to hold something relevant since a deterministic matcher is exactly the mechanism that makes tier irrelevant #scope #not-reached

### What the detection survey and the two named sources established

- [technique] Two independent sources converge on reversion to the training prior as the observable that a disclosure mechanism failed. One hardened its suite by targeting APIs absent from training data; the other tells users the failure signal is the agent falling back to another SDK's patterns #detection #training-prior
- [problem] A scenario whose correct answer the model can already produce cannot detect a routing failure, since it passes whether or not the skill fired, which makes an unaudited should-fire set capable of looking healthy while measuring nothing #detection #inert-scenario
- [insight] That is the triggering-side twin of the recall-denominator defect. There a raw rate could not separate rarely-needed from needed-and-missed; here a passing scenario cannot separate the skill fired from the model already knew #detection #twin-defect
- [problem] The vendor prescribes testing a skill on every tier but supplies three different qualitative questions, one per tier, which cannot be subtracted. A tier diff needs one metric evaluated on each tier, which the published protocol never provides #cross-tier #no-instrument
- [fact] Community eval tooling makes the cross-model matrix the default output shape rather than a feature to assemble, with a provider list producing a matrix view directly, though on prompt outputs rather than on which skill an agent selected #promptfoo #matrix
- [technique] The vendor evaluation protocol prescribes observing why a tool was not called, via reasoning and feedback blocks or interleaved thinking, plus tool-call counts, runtimes, token consumption and errors alongside top-level accuracy #observability #protocol
- [insight] The vendor independently reaches the hand-annotation problem and stops at a warning against overspecifying expected tool calls, where this repository's ablation denominator solves it causally, and no published equivalent was found anywhere #annotation #ablation-stronger
- [outcome] Vercel's figures verified in primary text: baseline 53 percent, skill at default 53 percent with zero improvement, skill with explicit instructions 79 percent, passive docs index 100 percent, and 56 percent of cases where the skill was never invoked #vercel #verified
- [problem] This repository's cited 44 percent is a complement it computed rather than a figure the post states, and the upper bound is published as 95 percent or more rather than 95 percent flat #vercel #citation-precision
- [problem] A sibling note credits the numbered-workflow-as-spine rule to that Vercel result, but the change was an instruction added to AGENTS.md telling the agent to invoke the skill, authored outside the skill in passive context. The rule loses its only positive measured support and the result belongs to prompt-level forced invocation instead #correction #misattribution
- [outcome] Vercel measured the most forceful phrasing losing. "You MUST invoke the skill" anchored on doc patterns and missed project context, while an instruction sequencing exploration before invocation did better, on the same skill and the same docs #vercel #imperative-loses
- [risk] Vercel names no model anywhere in the post, so the tier-sensitivity of a 56 percent non-invocation rate — precisely the quantity this note predicts should move with tier — is unknown and unrecoverable from the published text #vercel #tier-gap
- [technique] TanStack ships Vercel's measured remedy as a distributable mechanism arrived at independently, installing a task-to-file mapping block into the agent's config so routing is decided from always-loaded context rather than from inside the skill #tanstack #convergence
- [fact] TanStack's agent-skills documentation returns zero matches for every model-tier term and for eval, benchmark and pass rate. It publishes a routing mechanism and a manual verification procedure with no measurement of either, and it routes skills to sub-skills against the published one-level-deep rule #tanstack #scoped-negative

## Relations

<!-- ANALYSIS-006 carries no inverse edge back to this note, by owner instruction. -->

- pairs_with [[ANALYSIS-006: Weak-Model Routing for Progressive Disclosure]]
- relates_to [[SESSION-2026-08-23_01: Plugin Kit Measurement Tooling Hardening]]
