---
title: "ANALYSIS-009: Weak-Model Routing for Progressive Disclosure, Readable Edition"
type: analysis
status: DRAFT
permalink: analysis/analysis-009-weak-model-routing-for-progressive-disclosure-readable-edition
tags:
- skills
- routing
- model-tiers
- vendor-survey
- readable-edition
---

# ANALYSIS-009: Weak-Model Routing for Progressive Disclosure, Readable Edition

This is the readable edition of ANALYSIS-006. It carries the same 24 findings, the same figures, the same corrections and the same open questions, in plainer words and a steadier layout. Content parity was checked section by section on 2026-08-24. ANALYSIS-006 stays the note of record. Where the two ever disagree, the original wins.

## Language

One word for one concept. Every term below means one thing everywhere in this note. The Avoid list under each term names the words this note does not use for that concept, so a reader never has to work out whether two words are two ideas.

Quoted text is an exception. A quotation keeps its author's words, so a vendor's "invoke", "trigger" or "activate" appears inside quotation marks unchanged.

**Routing**
The model choosing which tool or which skill to use for a request. Routing happens before anything is read.
_Avoid_: selection, dispatch, activation, tool choice.

**Triggering**
Routing applied to skills: whether a given skill loads for a given request. Triggering is one kind of routing, not a second idea.
_Avoid_: invocation, firing, activation.

**Disclosure**
The model reading supplied material after routing has already picked something. A reference file is read at disclosure time, not at routing time.
_Avoid_: retrieval, lookup, fetch.

**Routing surface**
The text a model reads while deciding. For a tool it is the tool description. For a skill it is the frontmatter description, and that is the only routing surface a skill author controls.
_Avoid_: trigger text, description field (when the surface rather than the field is meant).

**Instruction surface**
The text a model reads after it has decided. For a skill it is the body.
_Avoid_: skill content, prompt body.

**Deep surface**
The reference files the body points at. Reached only after the body has been read.
_Avoid_: bundled resources, attachments.

**Tier**
A model's capability level inside a family. This note says strong tier and weak tier and nothing else. This repository ships against sonnet as its weak tier.
_Avoid_: smaller model, cheaper model, bigger model, less capable model.

**Recall**
The share of the reference files a model actually reads, measured per file.
_Avoid_: coverage, read rate.

**Over-fetch**
A model reading material it did not need. The strong tier's failure direction here.
_Avoid_: over-reading, eager loading.

**Under-reach**
A model failing to read material it did need. The weak tier's failure direction here.
_Avoid_: under-triggering, missing the pointer.

**Capability-graded**
Describes a remedy whose benefit depends on the tier receiving it: large on the weak tier, near zero on the strong tier. The direction of the effect is fixed; only its size changes with tier.
_Avoid_: tier-sensitive, scales with model.

**Model-dependent**
Describes an effect whose direction changes with the model: it helps one model and harms another. This is a different thing from capability-graded, where the direction never flips. The distinction decides how to read a result, so this note never blurs the two.
_Avoid_: varies by model, model-specific.

**Passive context**
Text that sits in front of the model on every turn because an always-loaded file such as AGENTS.md or CLAUDE.md holds it. The model does not decide to read passive context. It is simply there.
_Avoid_: ambient context, always-on docs, system prompt injection.

**Routing map**
A short list in passive context. Each line pairs a task description with a file path: when working on this area, read this file.

The routing map is the mechanism two of this note's sources arrived at independently, and it is worth stating in full because the phrase is easy to read past. A skill asks the model to make a judgment call. The model must look at its own description, look at the request, and decide whether the two match. A routing map asks for nothing of the kind. The instruction is already in front of the model on every turn, and the model only has to match a task to a line and open the file named on it. A standing lookup instruction beats a judgment call. Vercel measured that difference at 100 percent against 53. TanStack ships it as the install path for a library.
_Avoid_: passive-context routing map (say routing map; passive context is already its home), skill index, task map.

**Pointer**
One sentence in a document telling the model to read another document. A skill description is a pointer. A line in a workflow step saying "read the reference file" is a pointer.
_Avoid_: signpost, reference, link.

**Constraint**
One thing a step asks the model to do. A step that says produce JSON, stay under 200 words, and read the reference file carries three constraints.
_Avoid_: instruction, requirement, rule (when a single demand inside a step is meant).

**Forced invocation**
A vendor control that takes the routing choice away from the model. Anthropic's `tool_choice` is one. This note keeps the vendor's own word here because the term names their control rather than the event.
_Avoid_: forced triggering, mandatory tool use.

**Training prior**
What a model can already produce from its training, with nothing supplied.

**Training-prior test**
A test built so the model cannot pass it from its training prior. Its correct answer has to come from the supplied material.
_Avoid_: out-of-training test, novel API test.

**Inert scenario**
A should-fire scenario the model passes from its training prior. It passes whether or not the skill loaded, so it measures nothing.
_Avoid_: leaky test, weak test.

**Ablation denominator**
Establishing that content was needed by removing it and watching the score move, rather than by asserting in advance which skill should have fired.
_Avoid_: expected-tool annotation, ground-truth label.

**Evidence label**
Every finding carries one. MEASURED means somebody ran an experiment and reports a number. GUIDANCE means somebody asserts it and publishes no evidence. SHIPPED-PRACTICE means somebody does it in a product and claims nothing about it.

**Transfer class**
Some findings carry one. PORTABLE EVIDENCE means the result transfers to this repository's problem. TECHNIQUE means the method transfers even though the result does not. MECHANISM-SPECIFIC means it needs a mechanism Claude Code skills do not have, so it is recorded and not recommended.

## How to Read a Finding

Every finding below has the same parts, in the same order. Learn the shape once.

- **Labels** names the source type, the evidence label, and the transfer class where the original assigns one.
- **Claim** states the finding in one sentence.
- **Evidence** gives the source and the exact words where exact words carry the result.
- **Limits** names what the evidence does not support. This part is absent where the original states no limits.
- **For this repository** says what the finding changes here.

## Verification Method

Every external claim in this note was checked against primary text on 2026-08-24. Vendor documentation was fetched as raw markdown where the site serves it, and as locally stripped HTML where it does not. Papers were fetched as their arXiv abstract or as full HTML. Each quoted sentence was then grepped for in the fetched file before it was written down.

No claim here rests on a search summary or on a fetch summariser. That rule is not caution for its own sake. During this investigation a search summariser attributed two specific figures to a paper, and grepping the paper's own text found neither figure, plus a result running the opposite way. Finding 15 records that incident.

The findings answer three questions in order. Findings 1 to 5 say why the weak tier under-routes. Findings 6 to 14 catalogue the remedies. Finding 15 is a method correction. Findings 16 to 20, added on 2026-08-24, say how the community detects tier-dependent failures. Findings 21 to 24 cover two named sources, Vercel and TanStack, read in primary text. Finding 21 is a second correction, and it lands on a sibling note rather than on this one.

This note extends the vendor survey in ANALYSIS-004 along the model-tier axis. It does not repeat that survey.

## Context

This repository measures its skills on two model tiers and gets two different artifacts back.

- Triggering on sonnet reaches 20 of 39 should-fire phrasings. The strong tier reaches roughly 90 percent.
- 15 of the 19 misses fire on the strong tier over identical hook text.
- Recall on sonnet runs 33 to 100 percent per file. The strong tier reads everything.
- 8 of the misses sit on near-verbatim hook vocabulary, which makes the hook lever measured-weak rather than untested.
- Moving a pointer into a workflow step halved reach, at 40 runs per arm.
- An imperative pointer inside a workflow step scored 0 of 20, on a route where the file was never read at all.

ANALYSIS-004 established the asymmetry and drew the operational conclusion from it. The two tiers fail in opposite directions. The strong tier over-fetches at near-total recall. The weak tier under-reaches with no over-fetch. The weak tier is therefore the only instrument that can detect a signposting defect. What that note could not establish was why the gap exists, and what to do about it. Its vendor survey found two vendors acknowledging weak-tier degradation and neither attaching a number to it.

This note is the follow-up on that axis. The question is why a weaker or cheaper model routes worse through a progressive-disclosure surface, and what the published and shipped record offers as a remedy.

One constraint shapes every recommendation and does not change. This repository is Claude-first. A skill's frontmatter description is the only routing surface the mechanism exposes. Body genre has been measured here not to move triggering. A remedy needing a mechanism Claude Code skills do not have is recorded as MECHANISM-SPECIFIC and is not recommended.

## The Ten Headline Results

**The vendor record has changed since ANALYSIS-004, and it now carries a number.** Anthropic's tool search documentation states that Claude's ability to pick the right tool degrades once more than 30 to 50 tools are available. Gemini's function-calling page caps the active set at 10 to 20. OpenAI advises fewer than 20 functions available at the start of a turn. Three vendors independently put a count on the routing surface. That is the sharpest possible contrast with ANALYSIS-004's result that no vendor caps the number of reference files a skill may bundle. Vendors bound what the model must choose among. Nobody bounds what it may later read.

**Published measurement confirms the tier asymmetry this repository measured, in the same direction.** MetaTool finds that as tool-list size grows most models decline, that all models decline sharply between five and ten tools, and that the strongest model in its set is nearly flat across the same growth. That is the external analogue of this repository's recall table: list length is a weak-tier problem specifically.

**Weak-tier routing failure is polarised rather than merely reduced, and the pole is not predicted by capability.** MetaTool's tool-usage-awareness results show some weak models firing on essentially everything and others almost never firing, with many near coin-flip accuracy. Over-fetch and under-reach are two poles of one defect. Which pole a given model lands on has to be measured, not inferred from its tier.

**The best-fitting external result gives every remedy in this note its shape: capability-graded benefit.** An instruction-compiler study on three production-tier models reports that a training-free prompt rewrite recovers up to 11 points of instruction-following for weaker models while leaving stronger models essentially unchanged. Its controls attribute the gain to the rewrite rather than to extra tokens or reordering. Anthropic's own tool search numbers reproduce that shape independently: Opus 4 improved from 49 to 74 percent, Opus 4.5 from 79.5 to 88.1. A remedy that shows nothing on the strong tier is not thereby refuted. Showing nothing there is the predicted result. This is the single most useful calibration in the note, because it inverts the default reading of a null.

**The most actionable and least intuitive finding is that a description polished by the strongest model can make a weaker model route worse.** MetaTool rewrote tool descriptions with two capable models and measured eight downstream models on the result. A Llama2-70b rewrite gained 7.83 percent for Llama2-13b. A GPT-4 rewrite caused a sharp decline for the ChatGLM and Llama2 families. Its recommendation is to choose the rewrite model according to the downstream model that will route. Two vendors say the same thing about their own levers without numbers: Anthropic reports namespacing effects that vary by LLM, and OpenAI notes that adding examples may hurt reasoning models. There is no portable weak-tier description rule. There is a portable method: optimise on the tier that will route, not merely measure on it. That upgrades ANALYSIS-004's Finding 3 from a measurement protocol to an authoring protocol.

**A second mechanism sits underneath the first, and it is not about routing at all.** Compositional constraint work finds reliable instruction following breaking down beyond five or six simultaneous constraints, with the probability of satisfying all of them collapsing multiplicatively even as per-constraint pass rates decay gently. A pointer inside a workflow step is one more simultaneous constraint. That is the most plausible published explanation for an imperative in-step pointer scoring 0 of 20 here. It argues for reducing the number of things a step asks for, rather than strengthening any one of them.

**The same literature refuses to let the scale story stay simple, and the contradiction is kept live.** The constraint-saturation paper reports ranking inversions counter to scaling expectations, with a nominally weaker model composing constraints more reliably than a stronger sibling. It states plainly that single-constraint competence does not predict compositional robustness. It also records a model jumping from rank ten to rank two purely on a larger token budget. Model tier is one variable among several, and treating weak model as a single explanatory axis is not supported.

**Addy Osmani's pack says nothing about model tiers, verified negatively.** Grepping his repository README, his blog post on skills and his lesson on skills for Haiku, Opus, Sonnet, weaker model, smaller model, cheaper model, model tier and less capable returns zero matches in all three. His stated rationale for progressive disclosure is token cost and attention dilution, not model capability. That absence is worth recording precisely, because his pack is the most-cited third-party prior art in this ecosystem and it is not evidence on this question.

**On detection, the sharpest result is a test-design rule, and this repository has not audited against it.** Vercel and TanStack converge independently on the same observable: a disclosure mechanism has failed when the model falls back to its training prior instead of the supplied content. The consequence is that a scenario whose correct answer the model can already produce cannot detect a routing failure. It passes whether or not the skill fired. That is the triggering-side twin of the recall-denominator defect, and it means a should-fire set can look healthy while measuring nothing. The vendor prescribes cross-tier testing and supplies three different qualitative questions rather than one subtractable metric, so the published protocol cannot produce a tier diff at all. This repository's two-tier sweeps already do the thing the protocol lacks.

**One external citation this repository relies on turns out to be misattributed, and the correction removes the last measured support from a surviving rule.** ANALYSIS-005's lineage credits "a numbered workflow is the spine of the body" to Vercel's 44-to-95 percent invocation result. The primary text shows that manipulation was an instruction added to AGENTS.md telling the agent to invoke the skill. That is host-prompt-level forced invocation, authored outside the skill entirely, not body structure. It is evidence for the missing-`tool_choice` finding instead. Vercel's other measured claim in this repository, passive context at 100 percent against skills at 53 to 79, is accurate as cited. Vercel also measured that the most forceful phrasing was the worst one. "You MUST invoke the skill" lost to "Explore project first, then invoke skill". That is a direct counterexample to fixing a missed pointer by strengthening its imperative, and it converges with both the constraint-count account and this repository's own 0-of-20 result.

## Approach

The owner's question named "AdiazMadi" among the sources to cover. That is almost certainly Addy Osmani, whose skill pack is prior art in this repository's research and whose name matches phonetically. Finding 14 covers him by name. The interpretation is recorded here so a later reader can correct it if it is wrong.

Sources were opened rather than summarised.

- Anthropic's documentation serves raw markdown at its published URLs and was read that way.
- Gemini's function-calling page, OpenAI's function-calling guide and prompting guide, and the two Anthropic engineering posts were fetched as HTML and stripped locally with a regex stripper. No model touched them.
- Papers were fetched as their arXiv abstract page, and, where a body claim was quoted, as the full HTML of the specific version cited.

Version matters and is recorded. MetaTool's abstract changed materially between v3 and v6, and the recommendation this note leans on appears only in v6.

Every quoted sentence was grepped for in the fetched artifact before being written down. Where a search summary asserted a figure, that figure was grepped for independently and reported as absent when absent. See Finding 15.

Sources reached: Anthropic (skill-authoring best practices, tool-use overview, define-tools, tool search tool, the advanced tool use engineering post, the writing-tools-for-agents engineering post, the agent-skills engineering post), Google (Gemini function-calling documentation), OpenAI (function-calling guide, GPT-5 prompting guide), Berkeley Function Calling Leaderboard blog posts, Addy Osmani (repository README, blog post, lesson), and four papers read in primary text.

Not reached on this axis: JetBrains AI, Amazon Q Developer, Zed, Sourcegraph Amp, Cursor, Windsurf, Cline and Continue. None was checked for model-tier guidance in this pass.

## Findings 1 to 5: Why the Weak Tier Under-Routes

### Finding 1: Three vendors put a number on the routing surface, and none puts one on the disclosure surface

**Labels:** vendor. GUIDANCE.

**Claim.** Three vendors independently bound how many tools a model should choose among, and no vendor bounds how many reference files a skill may bundle.

**Evidence.** Verbatim, from primary text:

- Anthropic, tool search tool page: "**Tool selection accuracy:** Claude's ability to pick the right tool degrades once you exceed 30–50 available tools." The same page's when-to-use list includes "Tool selection accuracy drops as your toolset grows" and sets the lower boundary at "You have 10 or more tools available."
- Google, Gemini function-calling best practices: "Tool Selection: Keep active set to 10-20 tools maximum."
- OpenAI, function-calling guide: "Keep the number of initially available functions small for higher accuracy", elaborated as "Aim for fewer than 20 functions available at the start of a turn at any one time, though this is just a soft suggestion", with the adjacent instruction "Evaluate your performance with different numbers of functions."

**Limits.** The three numbers do not agree. 30 to 50, 10 to 20, and under 20 are three different bounds, and none carries a published derivation. That is why the label is GUIDANCE despite the specificity. What matters is not the value but that all three exist at all.

**For this repository.** The contrast with ANALYSIS-004 is the point. That note established that no vendor states a cap on the number of reference files a skill may bundle, that Anthropic's own skill-creator calls bundled resources unlimited, and that its claude-api skill ships 66 of them. Set beside this finding the record is coherent rather than contradictory: vendors bound the set the model must choose among, and decline to bound the set it may subsequently read. A tool list is a routing surface, evaluated on every turn. A reference file is a disclosure surface, evaluated only once its pointer has already won. The count guidance attaches to the first and not to the second, and the two should never be conflated. Whether the tool thresholds transfer to skill counts is untested, and it is held in What Could Not Be Determined.

### Finding 2: Long-list degradation is measured, and it is a weak-tier problem specifically

**Labels:** published. MEASURED. PORTABLE EVIDENCE, on direction and tier-dependence only.

**Claim.** Tool-selection accuracy falls as the candidate list grows, the fall is sharpest at small list sizes, and the strongest model in the set barely moves.

**Evidence.** MetaTool (arXiv 2310.03128) evaluates tool-usage awareness and tool selection across nine models, scoring selection with a Correct Selection Rate over lists of varying size. Verbatim from the v3 full text:

"In Figure 4, we present the results of tool selection based on popularity, revealing that as the size of tool lists increases, the performance of most LLMs declines. Notably, among open-source models, Vicuna-33b stands out, even surpassing ChatGPT in the top 5 selection settings. All LLMs have a more significant performance decline when the size of the tool list changes from five to ten. Additionally, ChatGPT exhibits remarkable stability, with only a minor decline in CSR as the size of tool lists grows, indicating consistent performance."

Three things sit in one paragraph. List length degrades selection. The degradation is sharpest between five and ten, not at the large end where intuition puts it. And the strongest model in the set is nearly flat across the same growth that moves the others.

**Limits.** They are substantial. The models are the 2023 generation, and its open-source members are far weaker than any tier this repository ships against, so the weakest results here should not be read as predictive of sonnet. Correct Selection Rate measures selection from an explicitly presented list, which is closer to Claude's tool block than to skill triggering, where the candidate set is a set of frontmatter descriptions in the system prompt. The paragraph reports a figure rather than a controlled manipulation of list size over fixed queries. The transfer class covers the direction of the effect and its tier-dependence, not its magnitude.

**For this repository.** This is the same shape as the recall table, arrived at on a different mechanism, a different task and a different model family. It is the first independent corroboration the tier asymmetry has.

### Finding 3: Weak-tier routing failure is polarised, and the pole is not read off the tier

**Labels:** published. MEASURED.

**Claim.** Among weak models both failure poles occur, and which pole a model lands on is a property of that model rather than of its capability level.

**Evidence.** The same benchmark separates whether a model knows it needs a tool from whether it picks the right one. Verbatim on the first:

"We found that most models' awareness of tool usage is not ideal, as shown in Table 3. ChatGPT has the best performance in this regard, but only has an accuracy of less than 75%, and the worst-performing model, Llama2-13b, has an F1 Score of only 11.53%. Additionally, the accuracy of many LLMs is close to the level of random guessing (50%). The awareness of some LLMs appears polarized, with Baichuan2 essentially considering the use of tools for all queries, while LLama2-13b and Vicuna-7b are overly confident and rarely choose to use tools in most cases."

**For this repository.** This corroborates ANALYSIS-004 Finding 2 and sharpens it in a way that matters for how measurement is run here. That note found the strong tier over-fetching and the weak tier under-reaching, and generalised to the weak tier being the detection instrument. MetaTool shows that among weak models both poles occur. One model fires on everything; two fire on almost nothing. Weakness predicts that routing will be unreliable. It does not predict the direction of the unreliability.

The operational consequence is narrow but real. This repository's instrument choice stays correct, because the tier it ships against is measured to sit at the under-reach pole, with zero over-fetch across eight negative runs. But that is a measured fact about this tier on this artifact, not a property that transfers to a different weak model. An over-fetch check belongs in any sweep run against a tier that has not been characterised.

### Finding 4: Compositional load is a second mechanism, distinct from list length

**Labels:** published. MEASURED. PORTABLE EVIDENCE, with a stated gap.

**Claim.** Reliable instruction following breaks down beyond five or six simultaneous constraints, because the chance of satisfying all of them collapses multiplicatively while each one individually decays gently.

**Evidence.** Constraint Saturation Evaluation (arXiv 2608.12426) varies the number of simultaneous constraints from one to twelve across 15 models, with deterministic rule-based verifiers and no LLM judge, over 369,753 checks. Verbatim from the abstract:

"First, per-constraint pass rate decays gradually and predictably, while the chance of satisfying all k constraints collapses - a model passing individual constraints at ~41% at k=8 succeeds on all eight just 5.7% of the time. Second, constraints do not degrade equally: structural constraints lose 2x more baseline capability per added constraint than lexical ones... Reliable instruction following breaks down beyond 5-6 simultaneous constraints: probe-level success falls below 50% at 7 constraints for the strongest model, and at 3 or fewer for 12 of 15."

And from the body: "Production systems assuming linear degradation will experience unexpected failures: a system reliable with 3 constraints may fail significantly with 5."

**Limits.** The constraints measured are verifier-checkable output properties such as schemas and word limits. They are not "read this file". No published work extends the composition result to tool or file-read constraints.

**For this repository.** This is the most plausible published explanation for a result that could not previously be explained here. An imperative in-workflow pointer scored 0 of 20, on a route where the file was never read. Under the composition model that is not a pointer-strength failure at all. The pointer is one more simultaneous constraint inside a step that already carries several, and the probability of honouring all of them is multiplicative even where each is individually likely.

It also reframes the placement null. Moving a pointer into a workflow step does not merely relocate it. It adds it to that step's constraint budget, which predicts the observed halving better than any positional account does.

The prescription that follows is uncomfortable and clean: reduce the number of things a step asks for, rather than strengthening any one of them. Strengthening a pointer raises its individual pass rate, which the paper measures as the term that decays gently. The term that collapses is the conjunction, and only removing constraints touches that.

### Finding 5: The same paper refuses the simple scale story, and the contradiction is kept live

**Labels:** published. MEASURED. Contrary evidence.

**Claim.** Capability does not predict compositional reliability, and at least one non-capability variable moves a model eight ranks on its own.

**Evidence.** Under the heading "Scale does not predict compositional performance", verbatim:

"Counter to typical scaling expectations, we observe multiple ranking inversions: Gemini Pro ranks #2 at k=1 (90.5% single-constraint pass rate) but #11 overall (42.1% mCSR); Flash-Lite ranks #6 at k=1 (78.1%) but #3 overall (56.6%). Single-constraint competence does not predict compositional robustness—the models that understand constraints best in isolation are not necessarily the ones that compose them most reliably."

And on a different axis entirely: "the same model with a larger token budget (Claude 4.7 at 16,384 vs 4,096 tokens) jumps from rank #10 to #2 without any change to its compositional capacity."

IFScale (arXiv 2507.11538) adds a related complication at extreme density. Across 20 models and up to 500 simultaneous keyword instructions, "even the best frontier models only achieve 68% accuracy at the max density", and its analysis "reveals model size and reasoning capability to correlate with 3 distinct performance degradation patterns, bias towards earlier instructions, and distinct categories of instruction-following errors."

**For this repository.** This is recorded rather than resolved, and it should temper the framing of the whole question. A nominally weaker model composed constraints more reliably than its stronger sibling. A single model moved eight ranks on output budget alone. Weaker models route worse is a defensible summary of the routing evidence in Findings 2 and 3, and it is not a law. Where a measurement here shows a tier gap, the gap is the finding. Attributing it to capability rather than to sampling budget, alignment training or task shape requires separating those, and this repository has not done so.

IFScale's contribution is that size correlates with the pattern of degradation rather than simply with its amount. Its earlier-instruction bias is a third position claim pointing in a third direction: against lost-in-the-middle's end-of-context prediction, and against this repository's measured trailing-beats-in-step null. All three are held open in What Could Not Be Determined.

## Findings 6 to 14: The Remedies

### Finding 6: The benefit of a routing remedy is capability-graded, measured with controls

**Labels:** published. MEASURED. PORTABLE EVIDENCE. The central remedy result.

**Claim.** A training-free prompt rewrite recovers up to 11 points of instruction-following for weaker production-tier models and leaves stronger models essentially unchanged, and named controls exclude the obvious confounds.

**Evidence.** Instruction Stacking Collapse (arXiv 2608.02639) stacks 24 verifier-checked instructions, one to twenty at a time, over three production-tier models: Claude Sonnet 4.6, GPT-5-mini and Gemini 2.5 Flash. Verbatim from the abstract:

"Instruction-following degrades non-linearly: the follow rate falls from ~96% to as low as 20%, driven by a structured and reproducible set of pairwise conflicts. A single 'output JSON' constraint, for example, is jointly unsatisfiable with nine others. We then evaluate a training-free remedy: an instruction compiler that rewrites the stacked prompt in a single LLM call and is reused across queries. Its benefit is capability-graded. It recovers up to +11 points of follow rate for weaker models, which are also the models most often deployed at scale, while leaving stronger models, which already internalise the same structure, essentially unchanged. Cluster-robust tests, same-baseline controls, and a within-family scaling ladder attribute the gain to the rewrite itself rather than to additional tokens, reordering, or measurement headroom."

Three properties make this the most useful external result in the note. The models are current production tiers rather than a 2023 open-source set. The controls are named and they exclude the obvious confounds: token count, ordering, and headroom, the last being the one that would otherwise explain a strong-tier null trivially. And the finding is not that the remedy works. It is that the remedy's benefit is graded by the capability of the model receiving it, which is a claim about the shape of results rather than about one technique.

**Limits.** The object rewritten is a stacked system prompt, not a skill description. The technique does not transfer directly. The grading does.

**For this repository.** This licenses the note's most transferable output. A remedy measured on the strong tier and showing nothing has produced the predicted result, not a refutation. Conversely, a remedy measured only on the strong tier has measured almost nothing, which is ANALYSIS-004's Finding 3 arrived at from the remedy side rather than the detection side.

### Finding 7: The vendor's own shipped pre-routing mechanism reproduces the grading, with numbers

**Labels:** vendor. MEASURED. MECHANISM-SPECIFIC.

**Claim.** Anthropic's tool search tool improves selection accuracy far more for the weaker starting model than for the stronger one, and this repository cannot adopt the mechanism.

**Evidence.** Anthropic's advanced tool use engineering post reports, verbatim: "Internal testing showed significant accuracy improvements on MCP evaluations when working with large tool libraries. **Opus 4 improved from 49% to 74%, and Opus 4.5 improved from 79.5% to 88.1% with Tool Search Tool enabled.**"

The weaker starting model gains 25 points. The stronger gains 8.6. That is Finding 6's grading, independently, on a different remedy and a different evaluation.

The same post reports an 85 percent reduction in tool-definition tokens, and separately that tool use examples "improved accuracy from 72% to 90% on complex parameter handling". It names the failure the whole feature targets: "The most common failures are wrong tool selection and incorrect parameters, especially when tools have similar names like notification-send-user vs. notification-send-channel."

The mechanism is deferred loading plus a search step. Tools marked `defer_loading: true` are absent from context until Claude searches for them, with regex and BM25 search shipped and embeddings named as a supported custom option. It is available on Haiku 4.5 as well as on the Opus and Sonnet tiers.

**Limits.** Two, before this is read as a recommendation. The numbers are internal testing, not externally reproducible. And the comparison is across model generations, Opus 4 against Opus 4.5, rather than across tiers within one generation, so it corroborates the grading rather than establishing it.

**For this repository.** It is MECHANISM-SPECIFIC for the artifact shipped here. Skills already implement three-level progressive disclosure, but there is no `defer_loading` flag, no search step, and no way for an author to request that a skill body or a reference be retrieved rather than chosen. This is ANALYSIS-004's Finding 11 recurring on a new axis: the harness can do the deterministic thing, and skills are not wired to it.

### Finding 8: Detail helps, and a strong-model rewrite can hurt the weak model

**Labels:** published. MEASURED. PORTABLE EVIDENCE, with the transfer to the Claude family explicitly untested. The most actionable finding.

**Claim.** A description rewritten by a strong model is an intervention with a measurable direction, and that direction has been observed negative for some downstream model families.

**Evidence.** MetaTool v6 reports two description experiments. On length, verbatim: "The more detailed the description, the more efficient tool selection. As shown by the fitted line, as the length of the description increases, the CSR continuously increases, indicating that detailed descriptions can help LLMs better understand the functionality of tools, thus improving the accuracy of tool selection."

On rewriting, verbatim and in full because the detail carries the finding: "we built upon the original description by having two proficient LLMs rewrite it and then observed the performance changes of eight LLMs on the new descriptions. Different rewritten LLMs yielded varying benefits for different groups. For instance, descriptions rewritten by Llama2-70b resulted in a 7.83% improvement for llama2-13b, but did not significantly enhance the performance of the Vicuna series models. In contrast, descriptions rewritten by GPT-4 caused a sharp decline in the performance of ChatGLM and Llama2 series, while significantly boosting the Vicuna series, possibly due to the Vicuna series' training corpus being largely sourced from ShareGPT. Therefore, we strongly recommend that tool developers choose an appropriate rewrite model for generating new descriptions based on the downstream LLM the tool will apply to."

**Limits.** The two halves are not equally strong and must not be quoted as though they were. The length result is observational: a fitted line across tools whose descriptions differ in many ways at once, and the higher-scoring group had also been merged and decomposed to reduce functional overlap, so description source is confounded with overlap reduction. The rewrite result is a manipulation, with the same tools, the same queries, and only the rewriter varied. That is the half that carries weight. The proposed explanation for the rewrite effect, training-corpus proximity, is a hypothesis in the paper rather than a demonstrated mechanism, though the effect does not depend on the explanation being right. Every model in that experiment predates the tiers this repository ships against.

**For this repository.** The consequence is direct and immediate. ANALYSIS-004 Finding 3 established that signposting must be measured on the weak tier. This finding extends it: the description must be optimised on the tier that will route, because a description tuned by or for the strongest tier is a specific intervention with a measurable sign, and that sign has been observed negative.

### Finding 9: Three independent sources say a routing remedy's effect is model-dependent

**Labels:** vendor and published, converging. GUIDANCE on the vendor half.

**Claim.** The direction of a phrasing intervention depends on the model receiving it, which retires the search for a portable weak-tier phrasing rule.

**Evidence.** Beyond Finding 8, two vendors state the same thing about their own levers, without numbers:

- Anthropic, writing tools for agents: "We have found selecting between prefix- and suffix-based namespacing to have non-trivial effects on our tool-use evaluations. **Effects vary by LLM** and we encourage you to choose a naming scheme according to your own evaluations."
- OpenAI, function-calling guide: "Include examples and edge cases, especially to rectify any recurring failures. (**Note: Adding examples may hurt performance for reasoning models.**)"

The second is the sharper of the two, because it names a remedy class whose sign flips with model class. Examples help the non-reasoning configuration and may hurt the reasoning one. That is the same shape as MetaTool's rewriter result and as Finding 6's grading.

Anthropic makes a related point about output format that generalises the principle: "Even your tool response structure—for example XML, JSON, or Markdown—can have an impact on evaluation performance: there is no one-size-fits-all solution. This is because LLMs are trained on next-token prediction and tend to perform better with formats that match their training data."

**For this repository.** Taken together these retire the question the owner's brief asked, in the form it was asked. There is no community-favoured phrasing rule for weak-tier routing that survives contact with the evidence, because three independent sources report that the sign of a phrasing intervention depends on the model. What survives is a method: hold the routing surface fixed, vary one thing, measure on the deployment tier, keep the result. That is what this repository already does. The finding is that doing so is not merely good practice here, but the only thing the record supports.

### Finding 10: Fewer and broader beats many and narrow, stated by two vendors and forced on one benchmark

**Labels:** vendor, GUIDANCE. Published, incidental. TECHNIQUE.

**Claim.** Overlapping and narrow tool descriptions are the named confusion mechanism, and one benchmark could not define ground truth until it removed the overlap.

**Evidence.** Anthropic's define-tools page, verbatim: "**Consolidate related operations into fewer tools.** Rather than creating a separate tool for every action (`create_pr`, `review_pr`, `merge_pr`), group them into a single tool with an `action` parameter. Fewer, more capable tools reduce selection ambiguity and make your tool surface easier for Claude to navigate." And: "**Use meaningful namespacing in tool names.** When your tools span multiple services or resources, prefix names with the service... This makes tool selection unambiguous as your library grows."

The engineering post is blunter about the failure being avoided: "More tools don't always lead to better outcomes", "Too many tools or overlapping tools can also distract agents from pursuing efficient strategies", and "When tools overlap in function or have a vague purpose, agents can get confused about which ones to use."

OpenAI's parallel advice is "Combine functions that are always called in sequence" and "Make the functions obvious and intuitive. (principle of least surprise)".

The incidental measured corroboration is the more interesting evidence. MetaTool could not build its benchmark over its raw tool set, because overlap made ground truth undefinable: "Overlapped issue refers to a query that can be solved by multiple tools. If left unaddressed, this overlap could potentially influence the computation of final metrics." Its remedy was to merge and decompose 390 tools down to 198, verified with silhouette coefficients over description embeddings. That is an admission with a method attached: overlapping descriptions are not separable even for a grader with the ground truth in hand, which is a stronger statement about description overlap than any vendor makes.

**For this repository.** This finding touches the measured weakness here most directly. 8 of the 19 triggering misses sit on near-verbatim hook vocabulary. Description overlap between sibling skills is the failure mode two vendors name and one benchmark had to engineer around, and it is a defect this repository can detect mechanically. Embedding sibling descriptions and looking for clusters is exactly the operation MetaTool performed.

### Finding 11: Forced invocation exists for tools at every vendor and does not exist for skills

**Labels:** vendor. MECHANISM-SPECIFIC. The prompt-level substitute is GUIDANCE.

**Claim.** Every vendor surveyed ships a control that removes the routing decision from the model for tools, and a Claude Code skill has no analogue.

**Evidence.** The controls:

- Anthropic: `tool_choice`, supporting `auto`, `none`, `any` and `tool`, documented per model.
- Google: "Control how the model uses tools using tool_choice in generation_config: auto (Default): Model decides whether to call a function or respond directly. any: Model is constrained to always predict a function call. none: Model is prohibited from making function calls. validated: Model ensures function schema adherence." Gemini additionally supports restricting the callable set through `allowed_tools`.
- OpenAI: the equivalent `tool_choice` control on its function-calling surface.

What the skill mechanism does offer is graded prompt-level steering, which Anthropic documents explicitly, verbatim: "This boundary is steerable through your system prompt. If Claude isn't calling tools when you expect, a light instruction such as `\"Use the tools to investigate before responding.\"` increases tool use. A stronger form such as `\"Always call a tool first before responding.\"` pushes further. Conversely, `\"Use your judgment about whether to call a tool or respond directly.\"` keeps triggering behavior conservative."

**Limits.** That steering lives in the host's prompt rather than in any skill an author ships, which means it is available to this repository only for skills whose consumers control their own system prompt.

**For this repository.** A user can name a skill and invoke it directly, and that is the whole of the deterministic path. An author has no way to declare that a skill must fire on a condition. This extends ANALYSIS-004's central vendor result, that a skill's bundled reference is the only case where whether a file is read depends on the model deciding to read it, onto the triggering surface itself. The gap is not that the mechanism is unknown. It is standard, and it is absent here.

### Finding 12: The routing surface and the instruction surface are different surfaces, and one vendor now says so outright

**Labels:** vendor. GUIDANCE. TECHNIQUE. The remedy most compatible with the skill mechanism.

**Claim.** The text that wins the routing decision and the text that governs correct use are different objects with different optimisation targets, and conflating them degrades both.

**Evidence.** OpenAI's function-calling guide, verbatim: "**For deferred tools, put detailed guidance in the function description and keep the namespace description concise. The namespace helps the model choose what to load; the function description helps it use the loaded tool correctly.**"

Anthropic's tool search optimisation tips carry the same split implicitly: "Use keywords in descriptions that match how users describe tasks", "Keep your 3–5 most frequently used tools non-deferred", and "Add a system prompt section describing available tool categories: 'You can search for tools to interact with Slack, GitHub, and Jira'". The first is routing advice, and the tool's own detailed description is use advice.

Alongside that sits Anthropic's unqualified statement about the routing surface, verbatim: "**Provide extremely detailed descriptions.** This is by far the most important factor in tool performance", with the concrete form "Aim for at least 3–4 sentences for each tool description, more if the tool is complex."

**For this repository.** The mapping onto skills is exact and it is already validated here. A skill's frontmatter description is the routing surface. Its body is the instruction surface. Its references are the deep surface. This repository has measured the separation from the other side, since body genre does not move triggering, which is the same claim arrived at empirically rather than by assertion. The practical reading is that effort spent on the body to fix a triggering problem is spent on the wrong surface, and the 3-to-4-sentence floor is the vendor's own guidance for the surface that does move it. The description is the one routing lever an author actually controls.

### Finding 13: Strong-routes-weak-executes is measured for model selection and unmeasured for skill selection

**Labels:** published. MEASURED but off-target. The shipped analogue is SHIPPED-PRACTICE.

**Claim.** Query routing between a strong and a weak model is measured and transfers across model swaps. Skill selection by a stronger model on behalf of a weaker one is not measured anywhere found.

**Evidence.** RouteLLM (arXiv 2406.18665), verbatim from its abstract: "we propose several efficient router models that dynamically select between a stronger and a weaker LLM during inference, aiming to optimize the balance between cost and response quality... Our evaluation on widely-recognized benchmarks shows that our approach significantly reduces costs-by over 2 times in certain cases-without compromising the quality of responses. Interestingly, our router models also demonstrate significant transfer learning capabilities, maintaining their performance even when the strong and weak models are changed at test time."

**Limits.** Scoping this honestly matters more than reporting it. RouteLLM routes queries between models. The architecture the owner's question describes, where a stronger model decides which skill fires and a weaker model then executes it, is a different thing, and no measurement of it was found in this survey. The transfer-learning result is the part that would most plausibly carry over, since it suggests a router's decision function is not tightly coupled to the specific models behind it, but that is an inference and is labelled as one.

**For this repository.** The shipped analogue inside this ecosystem is the subagent: a stronger orchestrator dispatching to a subordinate agent with its own context. That pattern is SHIPPED-PRACTICE and, as far as this survey found, entirely unmeasured on routing accuracy.

### Finding 14: Addy Osmani's corpus contains no model-tier guidance, verified negatively

**Labels:** shipped-practice. Negative result.

**Claim.** The most-cited third-party prior art in this ecosystem says nothing about model tiers, and its stated rationale for progressive disclosure is token cost rather than model capability.

**Evidence.** Grepping his repository README, his blog post on agent skills and his lesson on agent skills, case-insensitively, for Haiku, Opus, Sonnet, weaker model, smaller model, cheaper model, model tier and less capable, returns **zero matches in all three files**. The absence is genuine rather than a wording difference. The method is the same negative confirmation ANALYSIS-005 used on the anti-rationalization genre.

What he does say about progressive disclosure, verbatim: "**Progressive disclosure.** The `SKILL.md` is the entry point. Supporting references load only when needed, keeping token usage minimal." From the blog post: "This is the harness engineering lesson applied at skill granularity. Every token loaded into context degrades performance somewhere, so you load what's relevant and leave the rest on disk. Progressive disclosure is how you get a twenty-skill library into a 5K-token slot without poisoning the well." And the generalised form: "Progressive disclosure for any rulebook. Do not write a 50-page handbook. Write a small router that points to the right small chapter for the situation."

On the routing surface specifically, from the lesson: "The description field is critical. It is the primary way agents decide whether to activate a skill. Write it to clearly describe both what the skill does and when it should be used", with the three levels costed as "At startup, load only skill names and descriptions (~100 tokens each)... Even with 50 skills installed, the startup cost is only about 5,000 tokens."

**Limits.** His rationale is asserted rather than measured. No evaluation accompanies any of it.

**For this repository.** Two things carry. His pack's own README documents a portability defect in the architecture ANALYSIS-004 catalogued as a third shape: a per-skill install "copies only `skills/<name>/`, not the repo-level `references/` directory", so the shared pool's paths are unavailable, which he tracks as an open issue. That is worth carrying because this repository considered the shared-pool architecture, and the shared pool has a distribution cost its author states publicly. And the single point of convergence with the measured record is the router framing: a small router pointing at the right small chapter is Finding 12's two-surface split in different words. Everything else in his corpus is orthogonal to the tier question rather than evidence on it.

## Finding 15: A Method Correction

### Finding 15: A search summariser asserted two figures that its cited paper does not contain

**Labels:** method. Correction.

**Claim.** A web-search summary invented two figures and an anti-correlation claim, attributed them to the constraint-saturation paper, and the paper argues the opposite direction on that exact question.

**Evidence.** While locating Finding 4's source, a web-search summary asserted of the constraint-saturation paper that "the degradation rate under constraint composition is strongly anti-correlated with baseline capability, spanning nearly an order of magnitude from 8.1% (Gemini 3.1 Pro) to 81.8% (Qwen3.5 0.8B)".

That claim was checked against the paper's own text, both the abstract page and the full v1 HTML at 155KB stripped, grepping for `81.8`, `8.1%`, `anti-correlat`, `order of magnitude` and `baseline capability`. **Neither figure appears anywhere, and the phrase "anti-correlated" appears nowhere.** The only match for "baseline capability" is the unrelated structural-versus-lexical comparison quoted in Finding 4. Worse than absent: the paper's own text argues the opposite direction on exactly that question. Its section headed "Scale does not predict compositional performance" reports ranking inversions counter to scaling expectations, quoted in Finding 5.

**For this repository.** Had that summary been trusted, this note would have carried a fabricated headline number supporting its central thesis, in a paper that partly contradicts it. That is the most dangerous possible shape for an error, because it would have read as the strongest evidence in the note.

This is the second recorded instance of the fault class in this research programme. A fetch summariser fabricating a paper's contents is what put the verify-against-primary-text rule into ANALYSIS-004 in the first place. It is recorded here as a finding rather than a footnote because two independent instances make it a base rate rather than an anecdote: a summariser's number is not evidence that the number exists. The check costs one grep.

## Findings 16 to 20: How Routing and Tier Failures Get Found

Added on 2026-08-24 in response to a third question: what methods the community uses to identify tier-dependent failures before they bite. Sources added for this pass: Anthropic's skill-authoring and evaluation pages, the writing-tools-for-agents engineering post re-read for its evaluation protocol, promptfoo's configuration guide, Vercel's agent-eval post, and TanStack's agent-skills documentation. Where this repository's harness already implements a method, it is cross-referenced as measured-here practice rather than presented as new.

### Finding 16: The vendor prescribes a cross-tier test and ships neither tooling nor a diffable metric for it

**Labels:** vendor. GUIDANCE.

**Claim.** Anthropic tells authors to test a skill on every tier, and supplies three different qualitative questions rather than one metric, so the published protocol cannot produce a tier diff.

**Evidence.** Verbatim, from the skill-authoring best-practices page under the heading "Test with all models you plan to use": "Skills act as additions to models, so effectiveness depends on the underlying model. Test your Skill with all the models you plan to use it with."

The per-tier prompts are given as a list. Claude Haiku: "Does the Skill provide enough guidance?" Claude Sonnet: "Is the Skill clear and efficient?" Claude Opus: "Does the Skill avoid over-explaining?" The section closes with "What works perfectly for Opus might need more detail for Haiku." The authoring checklist carries "Tested with Haiku, Sonnet, and Opus".

Separately, `claude plugin eval` exists as tooling in this ecosystem but does not appear in the public plugins documentation as of 2026-08-24. That page was fetched and grepped for "plugin eval", "eval suite" and "--eval", with zero matches.

**Limits.** Whether `claude plugin eval` supports a cross-tier matrix is not establishable from public primary text, and it is recorded as a gap rather than guessed at.

**For this repository.** The prescription is real and the instrument is missing, in a specific way worth naming. The three questions are not one question asked three times. They are three different qualitative judgements, one per tier. A cross-tier matrix requires the opposite shape: a single metric evaluated on every tier, so the tiers can be subtracted. As published, the protocol can produce only three separate impressions, and impressions are exactly what ANALYSIS-004 Finding 3 shows fail here, because the strong tier reads eagerly and looks healthy whatever the pointer says.

Measured-here cross-reference: this repository's two-tier trigger sweeps, its tier-study flag, and its recall-by-tier split already implement the thing the published protocol lacks, namely one metric on both tiers, subtractable. That is not novelty imported from this survey. It is prior practice that the survey finds no published equivalent for.

### Finding 17: A cross-model matrix is the default output shape of community eval tooling

**Labels:** community. SHIPPED-PRACTICE.

**Claim.** In promptfoo, naming a second provider is the whole of the work needed to get a cross-model comparison, and the tool treats one-model evaluation as the special case.

**Evidence.** promptfoo's configuration guide takes `providers` as a list and states the consequence verbatim: "Running promptfoo eval over this config will result in a matrix view that you can use to evaluate GPT vs Gemini." The worked config lists two providers against one shared test set.

**Limits.** This matters for adopting it here. promptfoo compares providers on prompt outputs. Whether it can observe which skill was selected inside an agent harness, as opposed to what the final answer looked like, was not established from its documentation in this pass, and the two are different measurements. The SHIPPED-PRACTICE label covers cross-model comparison generally, and explicitly not skill-selection observability.

**For this repository.** Where a vendor prescribes cross-tier testing without an instrument, the community tooling makes the instrument the path of least resistance.

### Finding 18: The vendor's evaluation protocol prescribes observing why a tool was not called, not only whether it was

**Labels:** vendor. GUIDANCE and TECHNIQUE.

**Claim.** Anthropic prescribes routing observability and secondary metrics alongside top-level accuracy, and reaches the hand-annotation problem without solving it.

**Evidence.** From the writing-tools-for-agents post, verbatim: "In your evaluation agents' system prompts, we recommend instructing agents to output not just structured response blocks (for verification), but also reasoning and feedback blocks." And, more directly on routing observability: "If you're running your evaluation with Claude, you can turn on interleaved thinking for similar functionality 'off-the-shelf'. This will help you probe **why agents do or don't call certain tools** and highlight specific areas of improvement in tool descriptions and specs."

On instrumentation beyond the headline number: "As well as top-level accuracy, we recommend collecting other metrics like the total runtime of individual tool calls and tasks, the total number of tool calls, the total token consumption, and tool errors. Tracking tool calls can help reveal common workflows that agents pursue and offer some opportunities for tools to consolidate."

The most useful sentence carries its own caveat, on annotating which tool a task should have used: "For each prompt-response pair, you can optionally also specify the tools you expect an agent to call in solving the task, to measure whether or not agents are successful in grasping each tool's purpose during evaluation. However, because there might be multiple valid paths to solving tasks correctly, try to avoid overspecifying or overfitting to strategies."

Anthropic's general evaluation guidance adds two lines that bear on tier work: "We relied on held-out test sets to ensure we did not overfit to our 'training' evaluations", and, from the test-development page, "Prioritize volume over quality: More questions with slightly lower signal automated grading is better than fewer questions with high-quality human hand-graded evals" plus "A/B testing: Compare performance against a baseline model or earlier version." The last is the closest thing published to a regression gate on a model change, and it is stated generically rather than for skills.

**For this repository.** This is the vendor independently arriving at the hand-annotation problem, because a should-have-used label is a guess about one valid path among several, and stopping at the warning. ANALYSIS-004 Finding 18 goes further and solves it. An ablation denominator establishes need causally, by removing content and watching the score move, rather than by asserting the expected path in advance. This survey found no published equivalent anywhere. The vendor guidance is therefore corroboration that the annotation problem is real, and this repository's answer to it remains the stronger one.

### Finding 19: The detectable signal for a disclosure failure is reversion to the training prior, and two independent sources converge on it

**Labels:** community. TECHNIQUE. The sharpest detection result.

**Claim.** A disclosure mechanism has failed when the model produces its training prior instead of the supplied content, and therefore a test the model can already pass detects nothing.

**Evidence.** Vercel, on why their first eval suite could not see anything, verbatim: "Our initial test suite had ambiguous prompts, tests that validated implementation details rather than observable behavior, and **a focus on APIs already in model training data**. We weren't measuring what we actually cared about." Their fix: "Most importantly, we added tests targeting Next.js 16 APIs that aren't in model training data." Their closing recommendation states it as a rule: "Test with evals. **Build evals targeting APIs not in training data. That's where doc access matters most.**"

TanStack ships the same idea as a user-facing diagnostic. Its "Confirm It's Wired Up" step tells the reader to open a fresh session, ask for a specific task, and then check for named observable markers: "The agent uses `chat()`, not `streamText()`", and "The adapter is imported as `openaiText()` from `@tanstack/ai-openai`, not `createOpenAI()`". It closes with the failure signal: "**If the agent still falls back to other-SDK patterns**, re-open its config file and confirm the intent-skills block is present and the `task:` descriptions clearly cover the area you're asking about."

Both make the same move from opposite directions. The observable that distinguishes a working disclosure mechanism from a broken one is whether the model produced the supplied content or fell back to its prior. A test whose correct answer the model can already produce cannot detect a routing failure at all. It passes either way, and its pass is evidence of nothing.

**For this repository.** This is directly actionable and it names a defect class never audited for here. Any should-fire scenario whose expected output the model can generate without the skill is an inert scenario. That is the triggering-side twin of the recall-denominator problem ANALYSIS-004 Finding 1 corrects. There, a raw rate could not separate rarely-needed from needed-and-missed. Here, a passing scenario cannot separate the skill fired from the model already knew. It converges with the ablation method already in use: a scenario whose score does not move when the skill is stripped is, by definition, one whose answer was already in the model.

### Finding 20: Harden the suite before trusting any comparison run through it

**Labels:** community. TECHNIQUE.

**Claim.** Vercel published their eval suite's defects and the three controls that fixed them before publishing any result the suite produced.

**Evidence.** Verbatim: "Before drawing conclusions, we needed evals we could trust... We hardened the eval suite by removing test leakage, resolving contradictions, and shifting to behavior-based assertions." And on run discipline: "All the results that follow come from this hardened eval suite. Every configuration was judged against the same tests, **with retries to rule out model variance**."

Three controls sit in one paragraph: leakage removal, behaviour-based rather than implementation-based assertions, and repetition against provider variance.

**For this repository.** The third control is the same one ANALYSIS-004 Finding 18 records learning the hard way, where arms had to be run concurrently so provider drift landed on both. This belongs in the same register as ANALYSIS-003's fault classes. A suite returning a healthy number from a leaky test is worse than no suite, because a passing result is stronger evidence than an absent one. That a team published its own suite's defects before its findings is the practice worth copying, independent of what the findings were.

## Findings 21 to 24: The Two Named Sources, Read in Primary Text

### Finding 21: Vercel's numbers verified, and one of them is cited wrongly in this repository

**Labels:** correction. MEASURED.

**Claim.** Vercel's figures are accurate as published, this repository's 44 percent is a computed complement rather than a stated figure, and ANALYSIS-005's rule 1 rests on a manipulation that was not what the rule describes.

**Evidence.** The post's figures, verified verbatim: baseline 53 percent; skill with default behaviour 53 percent, described as "Zero improvement. The skill existed, the agent could use it, and the agent chose not to"; skill with explicit instructions 79 percent; and the AGENTS.md docs index at 100 percent across Build, Lint and Test. On triggering: "In 56% of eval cases, the skill was never invoked", and after the intervention, "This improved the trigger rate to 95%+".

Two precision notes on how this repository cites it. **The 44 percent figure is a complement this repository computed, not a number the post states** — the post gives 56 percent non-invocation. And the upper figure is "95%+", not 95 percent flat. Neither is wrong. Both should be quoted as derived, and as a floor, respectively.

The substantive correction is larger and it lands on a sibling note. ANALYSIS-005's lineage table records rule 1, "A numbered workflow is the spine of the body", with verdict SURVIVES, on the basis of "Vercel's evaluation, invocation 44% to 95%". The primary text shows the manipulation was not a numbered workflow, and was not inside the skill at all: "**We tried adding explicit instructions to AGENTS.md telling the agent to use the skill**", with the example instruction quoted in full as "Before writing code, first explore the project structure, then invoke the nextjs-doc skill for documentation."

That is host-prompt-level forced invocation, authored **outside** the skill, in always-loaded passive context. It is evidence for Finding 11, where prompt-level steering is the only substitute available when a `tool_choice` analogue is missing. It is not evidence about body structure.

This repository's other Vercel citation is accurate as stated. The context-optimizer surface cites passive context at 100 percent against skills at 53 to 79 percent, and the post says exactly that: "A compressed 8KB docs index embedded directly in AGENTS.md achieved a 100% pass rate, while skills maxed out at 79% even with explicit instructions telling the agent to use them. Without those instructions, skills performed no better than having no documentation at all."

**For this repository.** Rule 1 loses its only positive measured support and joins rules 3, 5 and 6 as defensible doctrine that has never been measured on this repository's artifacts. ANALYSIS-005's own framing makes this the right correction to make loudly. That note wrote that every genre entry carries a value label precisely because two of six proposed rules died on contact with measurement, and this is a third dying on contact with its own citation.

### Finding 22: Vercel measured extreme fragility in the routing instruction, and the stronger imperative was the worse one

**Labels:** community. MEASURED.

**Claim.** On the same skill and the same docs, the maximally forceful instruction lost to one that sequenced the work and mentioned the skill second.

**Evidence.** Their wording table, verbatim in both rows. "You MUST invoke the skill" produced "Reads docs first, anchors on doc patterns", with the outcome "Misses project context". "Explore project first, then invoke skill" produced "Builds mental model first, uses docs as reference", with the outcome "Better results". Their summary: "Same skill. Same docs. Different outcomes based on subtle wording changes."

With a concrete instance: "In one eval (the 'use cache' directive test), the 'invoke first' approach wrote correct page.tsx but completely missed the required next.config.ts changes. The 'explore first' approach got both." And their reaction: "This fragility concerned us. If small wording tweaks produce large behavioral swings, the approach feels brittle for production use."

The same section carries a cost finding for a skill that is present and unused: "the skill actually performed worse than baseline on some metrics (58% vs 63% on tests), suggesting that **an unused skill in the environment may introduce noise or distraction**."

**Limits.** The unused-skill observation is one metric in one suite, and it is a different question from whether an unnecessary read costs anything. Neither is measured cleanly, and both stay open.

**For this repository.** This corroborates Finding 9's model-dependence cluster and adds something none of those sources do: the maximally forceful phrasing lost. That is a direct counterexample to the intuition that a missed pointer wants a stronger imperative. It converges with Finding 4's constraint-count account of why strengthening one term does not fix a collapsing conjunction, and it converges with this repository's own imperative in-workflow pointer scoring 0 of 20. The unused-skill number is partial evidence on ANALYSIS-004's open question about whether over-fetch costs anything, approaching from the other side: not the cost of reading something unnecessary, but the cost of it merely being available.

### Finding 23: Vercel names no model anywhere, which leaves a gap in the result this repository leans on hardest

**Labels:** community. Scope.

**Claim.** The most-cited external result in this repository's skill guidance reports one configuration on an unnamed model, so its tier-sensitivity is unknown.

**Evidence.** The post was grepped for every Claude, GPT and Gemini model name, and for "model tier", "weaker model", "smaller model" and "across models": **zero matches**.

Their stated theory for why passive context wins is three factors, verbatim: "No decision point. With AGENTS.md, there's no moment where the agent must decide 'should I look this up?'"; "Consistent availability. Skills load asynchronously and only when invoked. AGENTS.md content is in the system prompt for every turn."; and "No ordering issues. **Skills create sequencing decisions** (read docs first vs. explore project first). Passive context avoids this entirely."

Their scoping is also more careful than the headline suggests, and it deserves quoting since this repository builds skills: "Skills aren't useless... Skills work better for vertical, action-specific workflows that users explicitly trigger, like 'upgrade my Next.js version,' 'migrate to the App Router,' or applying framework best practices. The two approaches complement each other."

**For this repository.** This is worth stating plainly because of what the number is used for. A 56 percent non-invocation rate is precisely the quantity Findings 2, 6 and 7 predict should move with tier, since long-list and routing failures are where the tiers diverge most, and capability-graded benefit says an instruction remedy should pay off differently at different tiers. The tier-sensitivity cannot be recovered from the published text.

Their third factor converges independently with Finding 4: invoking a skill adds a sequencing constraint to a step that already carries several. It is the mechanism their own wording-fragility result demonstrates.

### Finding 24: TanStack ships a routing mechanism, converges with Vercel independently, and publishes no evidence at all

**Labels:** shipped-practice. With a scoped negative.

**Claim.** TanStack installs a routing map into the agent's own config file, which is Vercel's measured remedy generalised into a distributable mechanism, and TanStack publishes no measurement of it.

**Evidence.** TanStack's **Intent** mechanism ships skills inside npm packages and installs a routing table into the agent's own config file. `npx @tanstack/intent@latest install` writes an `intent-skills` block whose entries pair a task description with a file path. One entry pairs a task of "Building chat, tool calling, adapters, or streaming with TanStack AI" with `node_modules/@tanstack/ai/skills/ai-core/SKILL.md`, under the header comment "Skill mappings — when working in these areas, load the linked skill file into context."

TanStack names the routing lever explicitly, verbatim: "Check that the `task:` descriptions match areas you actually work in. Tighten or reword them if needed — **they're how your agent decides when to pull the skill into context.**"

Their stated rationale for packaging is the training-prior framing that Finding 19 turns into a detection method. Skills ship in the package "so the guidance travels with `npm update` instead of being pinned in a model's training data or copy-pasted into CLAUDE.md manually."

The scoped negative, stated because a named source's silence is a finding. The TanStack agent-skills documentation was grepped for Haiku, Opus, Sonnet, weaker model, smaller model, model tier, less capable, eval, benchmark and pass rate: **zero matches on all of them.** As of 2026-08-24 TanStack publishes a routing mechanism and a manual verification procedure, and publishes no evaluation, no measurement, and no model-tier guidance whatever.

**Limits.** One shipped practice here is in tension with published vendor guidance and should be recorded rather than adopted. TanStack routes skills to each other: "ai-core points at the companion packages' skills, and ai-persistence is an entry point that routes to its own sub-skills (`server`, `stores`, and the `build-{drizzle,prisma,cloudflare,custom}-adapter` recipes)." That is multi-level nesting, against the one-level-deep rule and the partial-read mechanism behind it recorded in ANALYSIS-004 Findings 8 and 17. Nobody has measured which is right, and the tension is live.

**For this repository.** Rather than relying on a skill's own description to win the routing decision from inside the skill, both Vercel and TanStack put a task-to-file map into always-loaded passive context. Vercel measured that architecture at 100 percent against 53. TanStack ships it as the install path for a library. Two unconnected teams converging on the same structural answer is the strongest non-measured signal in this survey. TanStack is also the third independent source saying the description is where routing is won, which is Finding 12 again. Their contribution to this note is architecture and a detection procedure, not evidence.

## What Could Not Be Determined

- **Whether skill triggering has ever been measured against model tier by anyone else.** Nothing in this survey measures whether a skill fires, by tier, on realistic user phrasings. Every external result quoted here is about tool selection, function calling or constraint following. This repository's 20-of-39-against-90-percent figure appears to be the only measurement of the actual quantity, which means it has no external replication and no external contradiction.
- **Whether the tool-count thresholds transfer to skill counts.** Three vendors bound the tool list at 30 to 50, 10 to 20, and under 20. A tool definition sits in the tool block with a schema. A skill contributes roughly 100 tokens of name and description to the system prompt. The surfaces differ in size, position and structure, and no one has measured whether the thresholds move together. Adopting a skill-count cap from these numbers would repeat the category error ANALYSIS-004 Finding 17 corrects.
- **Whether the description-rewriter result transfers to the Claude family.** MetaTool's rewriters and downstream models are all the 2023 generation. Whether a description tuned by the strongest current Claude degrades routing on a weaker current Claude is exactly the experiment this repository could run and has not.
- **Whether description length helps monotonically, has a ceiling, or reverses.** The fitted-line result is observational and confounded with overlap reduction, and Anthropic's 3-to-4-sentence floor is a floor with no stated ceiling. No source anywhere states where more detail stops helping.
- **Where a pointer should sit, now with three published claims in three directions.** Lost-in-the-middle predicts end-of-context is favoured. IFScale reports bias toward earlier instructions. This repository measured trailing beating in-step at 8 of 40 against 4 of 40, p approximately 0.20. Finding 4 offers a fourth account in which position is not the variable at all and constraint count is. None has been separated from the others, and the honest position is that the question is open and expensive.
- **Whether the 5-to-6 constraint ceiling applies to a skill body's rules.** The constraints measured are verifier-checkable output properties. Whether "read this file when X" occupies the same budget as "output valid JSON" is unestablished, and the whole application of Finding 4 to this repository's 0-of-20 result rests on it.
- **Whether a strong-routes-weak-executes architecture improves skill selection.** RouteLLM measures query routing between models, not skill selection. The subagent pattern is the shipped analogue and no measurement of its routing accuracy was found.
- **Whether over-fetch on the strong tier costs anything.** Inherited unresolved from ANALYSIS-004 and untouched here.
- **Eight vendors not checked on this axis.** Cursor, Windsurf, Cline, Continue, JetBrains AI, Amazon Q Developer, Zed and Sourcegraph Amp were not searched for model-tier guidance in this pass. The five matcher vendors are the most likely to hold something useful, since a deterministic matcher is precisely the mechanism that makes tier irrelevant, and any statement they make about why would bear on Finding 11.
- **Whether Vercel's 56 percent non-invocation rate is tier-dependent.** Their post names no model anywhere. It is the most-cited external result in this repository's skill guidance, and the quantity it reports is exactly the one Findings 2, 6 and 7 predict should move with tier. Unrecoverable from the published text.
- **Whether a routing map in passive context beats a skill description on this repository's own artifacts.** Vercel measured that architecture at 100 percent against 53 and TanStack ships it, but neither result is about this repository's skills, and the A/B has not been run here. It is the most directly testable thing this survey surfaced.
- **How many of this repository's should-fire scenarios are inert.** Finding 19 establishes that a scenario the model can pass without the skill cannot detect a triggering failure. The existing should-fire set has never been audited for training-prior leakage, so the fraction is unknown, and the 20-of-39 figure's denominator is unaudited in a way distinct from every limitation already recorded.
- **Whether any community harness can observe skill selection rather than output quality.** promptfoo makes cross-model matrices the default output shape, but on prompt outputs. Whether it or anything else can see which skill an agent harness selected was not established from primary text in this pass.
- **Whether `claude plugin eval` supports a cross-tier matrix.** It exists as tooling in this ecosystem and does not appear in the public plugins documentation as of 2026-08-24, grepped and confirmed absent. Its capabilities are not establishable from public primary text.
- **Whether TanStack's multi-level skill routing degrades reads.** They route skills to sub-skills, against the published one-level-deep rule and the partial-read mechanism behind it. Nobody has measured which is right.
- **Whether an unused-but-present skill costs anything.** Vercel observed 58 percent against a 63 percent baseline on one metric, and offered noise or distraction as a hypothesis. That is one metric in one suite, and it is a different question from whether an unnecessary read costs anything.

## Recommendations

1. **Optimise the description on the tier that will route, not merely measure on it** (Findings 8, 9). ANALYSIS-004 established the weak tier as the detection instrument. The rewriter result makes it the optimisation target as well, because a strong-model rewrite has a measured sign and that sign has been observed negative. Where a description is edited, the edit is an intervention with a direction, and it should be measured on the routing tier before it ships.
2. **Spend triggering effort on the description and stop spending it on the body** (Finding 12). The two-surface split is now stated outright by one vendor, implied by another, and confirmed here from the other side by the measurement that body genre does not move triggering. The vendor floor for the routing surface is 3 to 4 sentences covering what it does, when to use it and when not to.
3. **Attack description overlap between sibling skills, mechanically** (Finding 10). Two vendors name overlapping and vague descriptions as the confusion mechanism, and one benchmark had to merge 390 tools into 198 before ground truth was even definable. 8 of 19 misses here sit on near-verbatim hook vocabulary. Embedding sibling descriptions and clustering them is the operation that benchmark performed, it is cheap, and it produces a candidate list rather than a judgement.
4. **When a step's pointer is missed, remove constraints from the step rather than strengthening the pointer** (Finding 4). Per-constraint pass rate decays gently and the conjunction collapses multiplicatively, so strengthening one constraint optimises the term that was not the problem. This is the first published account that explains the 0-of-20 in-step result, and it predicts that a stronger imperative would not have helped.
5. **Read a strong-tier null as the predicted result, not as a refutation** (Findings 6, 7). Capability-graded benefit is measured with controls on current production tiers and reproduced independently in vendor internal testing. Any A/B this repository runs on a routing remedy should be powered on the weak tier, and should not treat a strong-tier null as evidence against.
6. **Do not import the tool-count thresholds as a skill-count cap** (Finding 1, and What Could Not Be Determined). The numbers are real and they are about a different surface. The correct reading of Finding 1 is that vendors bound routing surfaces and decline to bound disclosure surfaces, which is consistent with ANALYSIS-004's depth-not-count principle rather than a reason to revisit it.
7. **Write the tier guidance knowing the escape hatch is missing** (Finding 11). Every vendor ships a forced-invocation control for tools and none exists for skills. Guidance authored here compensates for its absence, exactly as ANALYSIS-004's reference-following guidance compensates for the absence of declarative attachment, and it should say so rather than presenting a pointer as the natural mechanism.
8. **Keep the position question closed to spending until the confound is separated** (Finding 5). Four accounts now disagree about where a pointer should sit, one of which says position is not the variable. A further placement A/B buys nothing until constraint count and position are manipulated independently.
9. **Audit the should-fire scenario set for training-prior leakage, and treat any inert scenario as a measurement defect rather than a passing test** (Finding 19). Two independent sources make reversion to the training prior the observable that distinguishes a working disclosure mechanism from a broken one. The existing ablation harness already produces the audit for free: a scenario whose score does not move when the skill is stripped is one whose answer was already in the model, and it can neither pass nor fail informatively.
10. **Correct ANALYSIS-005's lineage rule 1, explicitly and where the next author will find it** (Finding 21). Its verdict of SURVIVES rests on a Vercel result that measured an instruction added to AGENTS.md, not a numbered workflow inside a skill. Rule 1 should move to the same status as rules 3, 5 and 6, namely defensible doctrine never measured here, and the Vercel result should be re-filed as evidence for prompt-level forced invocation. That note's own lineage section argues for making exactly this kind of correction loudly.
11. **Build the cross-tier matrix as one metric per tier, not three questions per tier** (Finding 16). The published protocol asks a different qualitative question of each model, which cannot be subtracted. This repository's existing two-tier sweeps are the correct shape, and should be described that way when the practice is written down, since no published equivalent was found.
12. **Test the routing map against the description, on this repository's own artifacts** (Findings 21, 24). Vercel measured the architecture at 100 against 53 and TanStack ships it. Neither result is about these skills. Holding content fixed and varying only whether a task-to-file map sits in always-loaded context is a clean A/B, and it is the highest-value unrun experiment this survey surfaced.
13. **Stop treating a missed pointer as a call for a stronger imperative** (Findings 4, 22). Vercel measured "You MUST invoke the skill" losing to an instruction that sequenced the work and mentioned the skill second, and this repository measured an imperative in-workflow pointer at 0 of 20. Two independent results, one mechanism: the conjunction collapses whatever the individual term's force.
14. **Publish the suite's defects before its findings** (Finding 20). Vercel's leakage removal, behaviour-based assertions and retries against variance are the same controls this repository learned the hard way, and stating them alongside a result is what makes the result checkable rather than merely reported.

## Observations

### Why the weak tier under-routes

- [fact] Three vendors independently put a count on the routing surface — Anthropic states tool selection degrades past 30 to 50 available tools, Gemini caps the active set at 10 to 20, OpenAI advises fewer than 20 at the start of a turn — while no vendor caps the number of reference files a skill may bundle #vendors #thresholds
- [insight] The record is coherent rather than contradictory once the two surfaces are separated: vendors bound the set a model must choose among and decline to bound the set it may later read, so tool-count guidance must never be imported as reference-count guidance #routing-surface #disclosure-surface
- [fact] Measured across nine models, tool-selection performance declines as list size grows, all models decline most sharply between five and ten tools, and the strongest model in the set is nearly flat across the same growth #metatool #list-length
- [insight] The external long-list result is the same shape as this repository's recall table on a different mechanism, task and model family, which is the first independent corroboration the tier asymmetry has #corroboration #asymmetry
- [problem] Weak-tier routing failure is polarised rather than merely reduced — one benchmarked model fires on essentially every query while two others almost never fire, with many near coin-flip accuracy — so capability predicts unreliability but not its direction #polarity #instrument
- [constraint] This repository's tier is measured at the under-reach pole with zero over-fetch across eight negative runs, which is a fact about this tier on this artifact and does not transfer to an uncharacterised weak model; an over-fetch check belongs in any sweep against a new tier #instrument #scope
- [fact] Reliable instruction following breaks down beyond five or six simultaneous constraints across 15 models, with a model passing individual constraints at about 41 percent at k=8 satisfying all eight just 5.7 percent of the time #composition #ceiling
- [insight] A pointer inside a workflow step is one more simultaneous constraint, which is the first published account that explains an imperative in-step pointer scoring 0 of 20 here, and it predicts that strengthening the pointer would not have helped #composition #in-step-null
- [risk] The same paper reports ranking inversions counter to scaling expectations and states that single-constraint competence does not predict compositional robustness, so weaker-routes-worse is a defensible summary of the routing evidence and not a law #scale #contrary
- [fact] One model moved from rank ten to rank two on output token budget alone with no change to its compositional capacity, so a measured tier gap requires separating capability from sampling budget, alignment training and task shape before it is attributed to capability #confound #budget
- [problem] Instruction-density work reports bias toward earlier instructions, which is a third position claim pointing against both lost-in-the-middle's end-of-context prediction and this repository's measured trailing-beats-in-step null #position #unresolved

### How a remedy's benefit is shaped

- [outcome] The central remedy result is capability-graded benefit: a training-free instruction-compiler rewrite recovers up to 11 points of follow rate for weaker production-tier models while leaving stronger models essentially unchanged, with controls excluding token count, reordering and measurement headroom #capability-graded #measured
- [insight] Capability grading inverts the default reading of a null — a remedy showing nothing on the strong tier has produced the predicted result rather than a refutation, and a remedy measured only on the strong tier has measured almost nothing #calibration #null-reading
- [fact] Anthropic's internal testing reproduces the grading independently on a different remedy: Opus 4 improved from 49 to 74 percent with the tool search tool enabled while Opus 4.5 improved from 79.5 to 88.1, a 25-point gain against 8.6 #tool-search #grading
- [risk] Those numbers are internal testing across model generations rather than across tiers within one generation, so they corroborate the grading rather than establishing it #tool-search #caveat
- [decision] The tool search mechanism is classified MECHANISM-SPECIFIC and not recommended for adoption: skills already implement three-level disclosure but expose no deferred-loading flag, no search step, and no way for an author to request retrieval rather than model choice #mechanism #gap
- [outcome] A description rewritten by a strong model is not a neutral improvement — a Llama2-70b rewrite gained 7.83 percent for Llama2-13b while a GPT-4 rewrite sharply degraded two other model families — and the paper's recommendation is to choose the rewrite model by the downstream model that will route #rewriter #sign-flip
- [insight] That upgrades the established protocol from measure-on-the-weak-tier to optimise-on-the-weak-tier, since editing a description is an intervention with a direction and that direction has been observed negative #protocol #upgrade
- [problem] The companion description-length result is observational — a fitted line over tools that also differ in functional overlap — so only the rewriter half of that paper carries weight and the two must not be quoted as equally strong #confound #honesty

### What the author controls, and what the vendor keeps

- [fact] Three independent sources report that a routing remedy's effect is model-dependent: namespacing effects that vary by LLM, examples that may hurt reasoning models, and rewriter benefit that varies by downstream family #model-dependence #convergence
- [decision] There is therefore no portable weak-tier phrasing rule to adopt; what the record supports is a method — hold the routing surface fixed, vary one thing, measure on the deployment tier — which this repository already practises #no-portable-rule #method
- [technique] Two vendors prescribe consolidation over proliferation, with fewer and more capable tools said to reduce selection ambiguity, and one benchmark had to merge 390 tools into 198 because overlap made ground truth undefinable #consolidation #overlap
- [technique] Description overlap is mechanically detectable by embedding sibling descriptions and clustering them, which is the operation that benchmark performed, and it bears directly on the eight of nineteen misses here sitting on near-verbatim hook vocabulary #overlap-detection #actionable
- [problem] Every vendor ships a forced-invocation control for tools — Anthropic's tool_choice, Gemini's auto, any, none and validated modes plus an allowed-tools restriction, and OpenAI's equivalent — and a Claude Code skill has no analogue beyond a user naming it #forced-invocation #absent
- [technique] One vendor now states the two-surface split outright, putting concise routing text in the namespace description and detailed guidance in the function description, which maps exactly onto a skill's frontmatter against its body and is confirmed here from the other side by body genre not moving triggering #two-surface #validated-here
- [fact] The vendor floor for the routing surface is explicit: extremely detailed descriptions are called by far the most important factor in tool performance, with at least 3 to 4 sentences covering what the tool does, when to use it and when not to #description-floor #anthropic

### What the survey did not find, and one method correction

- [fact] Grepping Addy Osmani's repository README, blog post and lesson case-insensitively for Haiku, Opus, Sonnet, weaker model, smaller model, cheaper model, model tier and less capable returns zero matches in all three files #addy #negative-confirmed
- [insight] His stated rationale for progressive disclosure is token cost and attention dilution rather than model capability, asserted without any accompanying evaluation, so the most-cited third-party prior art in this ecosystem is orthogonal to the tier question rather than evidence on it #addy #orthogonal
- [technique] His one point of convergence with the measured record is the router framing — write a small router that points to the right small chapter rather than a 50-page handbook — which is the two-surface split in different words #addy #convergence
- [risk] His pack's own README documents that a per-skill install copies only the skill directory and not the repository-level shared references, so the shared-pool architecture carries a distribution cost its author states publicly #shared-pool #portability
- [problem] A web-search summariser attributed two specific figures and an anti-correlation claim to the constraint-saturation paper, and grepping its abstract plus 155KB of stripped full text found neither figure, no occurrence of anti-correlated, and a section arguing the opposite direction on that exact question #summariser #fabrication
- [constraint] Two independent instances of a summariser inventing a paper's contents make this a base rate rather than an anecdote, so a summariser's number is not evidence that the number exists and the check costs one grep #verification #base-rate
- [problem] No external measurement of skill triggering against model tier was found anywhere, so this repository's 20-of-39-against-90-percent figure has neither replication nor contradiction outside itself #gap #unreplicated
- [problem] The strong-routes-weak-executes architecture is measured for query routing between models and unmeasured for skill selection; the subagent pattern is its shipped analogue and carries no routing-accuracy measurement #routing-layer #unmeasured
- [risk] Eight vendors were not checked on the model-tier axis, and the five matcher vendors are the most likely to hold something relevant since a deterministic matcher is exactly the mechanism that makes tier irrelevant #scope #not-reached

### What the detection survey and the two named sources established

- [technique] Two independent sources converge on reversion to the training prior as the observable that a disclosure mechanism failed — one hardening its suite by targeting APIs absent from training data, the other telling users the failure signal is the agent falling back to another SDK's patterns #detection #training-prior
- [problem] A scenario whose correct answer the model can already produce cannot detect a routing failure, since it passes whether or not the skill fired, which makes an unaudited should-fire set capable of looking healthy while measuring nothing #detection #inert-scenario
- [insight] That is the triggering-side twin of the recall-denominator defect: there a raw rate could not separate rarely-needed from needed-and-missed, here a passing scenario cannot separate the skill fired from the model already knew #detection #twin-defect
- [problem] The vendor prescribes testing a skill on every tier but supplies three different qualitative questions, one per tier, which cannot be subtracted — a tier diff needs one metric evaluated on each tier, which the published protocol never provides #cross-tier #no-instrument
- [fact] Community eval tooling makes the cross-model matrix the default output shape rather than a feature to assemble, with a provider list producing a matrix view directly, though on prompt outputs rather than on which skill an agent selected #promptfoo #matrix
- [technique] The vendor evaluation protocol prescribes observing why a tool was not called, via reasoning and feedback blocks or interleaved thinking, plus tool-call counts, runtimes, token consumption and errors alongside top-level accuracy #observability #protocol
- [insight] The vendor independently reaches the hand-annotation problem and stops at a warning against overspecifying expected tool calls, where this repository's ablation denominator solves it causally, and no published equivalent was found anywhere #annotation #ablation-stronger
- [outcome] Vercel's figures verified in primary text: baseline 53 percent, skill at default 53 percent with zero improvement, skill with explicit instructions 79 percent, passive docs index 100 percent, and 56 percent of cases where the skill was never invoked #vercel #verified
- [problem] This repository's cited 44 percent is a complement it computed rather than a figure the post states, and the upper bound is published as 95 percent or more rather than 95 percent flat #vercel #citation-precision
- [problem] A sibling note credits the numbered-workflow-as-spine rule to that Vercel result, but the manipulation was an instruction added to AGENTS.md telling the agent to invoke the skill — authored outside the skill in passive context — so the rule loses its only positive measured support and the result belongs to prompt-level forced invocation instead #correction #misattribution
- [outcome] Vercel measured the most forceful phrasing losing: "You MUST invoke the skill" anchored on doc patterns and missed project context, while an instruction sequencing exploration before invocation did better, on the same skill and the same docs #vercel #imperative-loses
- [risk] Vercel names no model anywhere in the post, so the tier-sensitivity of a 56 percent non-invocation rate — precisely the quantity this note predicts should move with tier — is unknown and unrecoverable from the published text #vercel #tier-gap
- [technique] TanStack ships Vercel's measured remedy as a distributable mechanism arrived at independently, installing a task-to-file mapping block into the agent's config so routing is decided from always-loaded context rather than from inside the skill #tanstack #convergence
- [fact] TanStack's agent-skills documentation returns zero matches for every model-tier term and for eval, benchmark and pass rate, so it publishes a routing mechanism and a manual verification procedure with no measurement of either, and it routes skills to sub-skills against the published one-level-deep rule #tanstack #scoped-negative

## Relations

<!-- The original ANALYSIS-006 carries no inverse edge back to this note, by owner instruction. -->

- pairs_with [[ANALYSIS-006: Weak-Model Routing for Progressive Disclosure]]
- relates_to [[SESSION-2026-08-23_01: Plugin Kit Measurement Tooling Hardening]]
