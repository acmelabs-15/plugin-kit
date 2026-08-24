---
title: "ANALYSIS-006: Weak-Model Routing for Progressive Disclosure"
type: analysis
status: DRAFT
permalink: analysis/analysis-006-weak-model-routing-for-progressive-disclosure
tags:
- analysis
- skills
- routing
- model-tiers
- vendor-survey
---

# ANALYSIS-006: Weak-Model Routing for Progressive Disclosure

> Every external claim below was verified against primary text on 2026-08-24 — vendor documentation fetched as raw markdown where the site serves it and as locally-stripped HTML where it does not, papers fetched as their arXiv abstract or full HTML, then grepped for the exact sentence before quoting. No claim here rests on a search summary or a fetch summariser. That is not caution for its own sake: a search summariser attributed two specific figures to a paper during this very investigation, and grepping the paper's own text found neither, plus a result running the opposite way. That incident is Finding 15. Each finding carries an evidence label — MEASURED (someone ran an experiment and reports a number), GUIDANCE (asserted without published evidence), SHIPPED-PRACTICE (people do it and claim nothing) — and a transfer classification: PORTABLE EVIDENCE, TECHNIQUE, or MECHANISM-SPECIFIC. Findings 1 to 5 answer why weaker models under-route; 6 to 14 catalogue remedies; 15 is a method correction. This note extends the vendor survey in ANALYSIS-004 along the model-tier axis and does not repeat it.

## Context

This repository measures its skills on two model tiers and gets two different artifacts back. Triggering on sonnet reaches 20 of 39 should-fire phrasings against roughly 90 percent on the stronger tier, with 15 of the 19 misses firing on the stronger model over identical hook text. Reference recall on sonnet runs 33 to 100 percent per file while the stronger tier reads everything. Eight of the misses sit on near-verbatim hook vocabulary, which makes the hook lever measured-weak rather than untested. An in-step pointer move halved reach at n=40 per arm, and an imperative in-workflow pointer scored 0 of 20 on a route where the file was never read at all.

The predecessor note established the asymmetry and drew the operational conclusion from it: the two tiers fail in opposite directions, the stronger over-fetches at near-total recall, the weaker under-reaches with no over-fetch, and therefore the weaker model is the only instrument that can detect a signposting defect. What it could not establish was why, and what to do. Its vendor survey found two vendors acknowledging weaker-model degradation and neither attaching a number to it.

This note is the follow-up on that axis. The question is why smaller or cheaper models route worse through a progressive-disclosure surface, and what the published and shipped record offers as a remedy. The constraint that shapes every recommendation is unchanged: this repository is Claude-first, a skill's frontmatter description is the only routing surface the mechanism exposes, and body genre has been measured here not to move triggering. A remedy that requires a mechanism Claude Code skills do not have is recorded as MECHANISM-SPECIFIC and is not recommended.

## Executive Summary

**The vendor record has changed since the predecessor survey, and it now carries a number.** Anthropic's tool search documentation states that Claude's ability to pick the right tool degrades once more than 30 to 50 tools are available. Gemini's function-calling page caps the active set at 10 to 20. OpenAI advises fewer than 20 functions available at the start of a turn. Three vendors independently put a count on the routing surface — which is the sharpest possible contrast with the predecessor's result that **no vendor caps the number of reference files a skill may bundle.** Vendors bound what the model must choose among; nobody bounds what it may later read.

**Published measurement confirms the tier asymmetry this repository measured, and confirms it in the same direction.** MetaTool finds that as tool-list size grows, most models decline, that all models decline sharply between five and ten tools, and that the strongest model in its set is nearly flat across the same growth. That is the external analogue of the recall table: list length is a weak-model problem specifically.

**Weak-model routing failure is polarised, not merely reduced, and the polarity is not predicted by capability.** MetaTool's tool-usage-awareness results show some weak models firing on essentially everything and others almost never firing, with many near coin-flip accuracy. Under-reach and over-fetch are two poles of one defect, and which pole a given model lands on has to be measured rather than inferred from its tier.

**The best-fitting external result gives the shape every remedy in this note takes: capability-graded benefit.** An instruction-compiler study on three production-tier models reports that a training-free prompt rewrite recovers up to 11 points of instruction-following for weaker models while leaving stronger models essentially unchanged, with controls attributing the gain to the rewrite rather than to extra tokens or reordering. Anthropic's own tool search numbers reproduce that shape independently: Opus 4 improved from 49 to 74 percent, Opus 4.5 from 79.5 to 88.1. **A remedy that shows nothing on the strong tier is not thereby refuted — showing nothing there is the predicted result.** This is the single most useful calibration in the note, because it inverts the default reading of a null.

**The most actionable and least intuitive finding is that a description polished by the strongest model can make a weaker model route worse.** MetaTool rewrote tool descriptions with two capable models and measured eight downstream models on the result: a Llama2-70b rewrite gained 7.83 percent for Llama2-13b, while a GPT-4 rewrite caused a sharp decline for the ChatGLM and Llama2 families. Its recommendation is to choose the rewrite model according to the downstream model that will route. Two vendors say the same thing about their own levers without numbers — Anthropic reports namespacing effects that vary by LLM, OpenAI notes that adding examples may hurt reasoning models. **There is no portable weak-model description rule. There is a portable method: optimise on the tier that will route, not merely measure on it.** That upgrades the predecessor's Finding 3 from a measurement protocol to an authoring protocol.

**A second mechanism sits underneath the first and is not about routing at all.** Compositional constraint work finds reliable instruction following breaking down beyond five or six simultaneous constraints, with the probability of satisfying all of them collapsing multiplicatively even as per-constraint pass rates decay gently. A pointer inside a workflow step is one more simultaneous constraint. That is the most plausible published explanation for an imperative in-step pointer scoring 0 of 20 here, and it argues for reducing the number of things a step asks for rather than strengthening any one of them.

**The same literature refuses to let the scale story stay simple, and the contradiction is kept live.** The constraint-saturation paper reports ranking inversions counter to scaling expectations, with a nominally weaker model composing constraints more reliably than a stronger sibling, and states plainly that single-constraint competence does not predict compositional robustness. It also records a model jumping from rank ten to rank two purely on a larger token budget. Model tier is one variable among several, and treating "weak model" as a single explanatory axis is not supported.

**Addy Osmani's pack says nothing about model tiers, verified negatively.** Grepping his repository README, his blog post on skills and his lesson on skills for Haiku, Opus, Sonnet, weaker model, smaller model, cheaper model, model tier and less capable returns zero matches in all three. His stated rationale for progressive disclosure is token cost and attention dilution, not model capability. That absence is worth recording precisely, because his pack is the most-cited third-party prior art in this ecosystem and it is not evidence on this question.

## Approach

The owner's question named "AdiazMadi" among the sources to cover. That is almost certainly Addy Osmani, whose skill pack is prior art in this repository's research and whose name matches phonetically; Finding 14 covers him by name and the interpretation is recorded here so a later reader can correct it if it is wrong.

Sources were opened rather than summarised. Anthropic's documentation serves raw markdown at its published URLs and was read that way. Gemini's function-calling page, OpenAI's function-calling guide and prompting guide, and the two Anthropic engineering posts were fetched as HTML and stripped locally with a regex stripper rather than passed through any model. Papers were fetched as their arXiv abstract page and, where a body claim was quoted, as the full HTML of the specific version cited. Version matters and is recorded: MetaTool's abstract changed materially between v3 and v6, and the recommendation this note leans on appears only in v6.

Every quoted sentence was grepped for in the fetched artifact before being written down. Where a search summary asserted a figure, that figure was grepped for independently and reported as absent when absent — see Finding 15.

Vendors and sources reached: Anthropic (skill-authoring best practices, tool-use overview, define-tools, tool search tool, the advanced tool use engineering post, the writing-tools-for-agents engineering post, the agent-skills engineering post), Google (Gemini function-calling documentation), OpenAI (function-calling guide, GPT-5 prompting guide), Berkeley Function Calling Leaderboard blog posts, Addy Osmani (repository README, blog post, lesson), and four papers reached in primary text. Not reached on this axis: JetBrains AI, Amazon Q Developer, Zed, Sourcegraph Amp, Cursor, Windsurf, Cline and Continue, none of which was checked for model-tier guidance in this pass.

## Findings

### Finding 1: Three vendors put a number on the routing surface, and none puts one on the disclosure surface (VENDOR, GUIDANCE)

Verbatim, from primary text:

- Anthropic, tool search tool page: "**Tool selection accuracy:** Claude's ability to pick the right tool degrades once you exceed 30–50 available tools." The same page's when-to-use list includes "Tool selection accuracy drops as your toolset grows" and sets the lower boundary at "You have 10 or more tools available."
- Google, Gemini function-calling best practices: "Tool Selection: Keep active set to 10-20 tools maximum."
- OpenAI, function-calling guide: "Keep the number of initially available functions small for higher accuracy", elaborated as "Aim for fewer than 20 functions available at the start of a turn at any one time, though this is just a soft suggestion", with the adjacent instruction "Evaluate your performance with different numbers of functions."

The three numbers do not agree — 30 to 50, 10 to 20, under 20 — and none carries a published derivation, which is why the label is GUIDANCE despite the specificity. What matters is not the value but that all three exist at all.

**The contrast with the predecessor finding is the point.** ANALYSIS-004 established that no vendor states a cap on the number of reference files a skill may bundle, that Anthropic's own skill-creator calls bundled resources unlimited, and that its claude-api skill ships 66 of them. Set beside this finding, the record is coherent rather than contradictory: **vendors bound the set the model must choose among, and decline to bound the set it may subsequently read.** A tool list is a routing surface, evaluated on every turn; a reference file is a disclosure surface, evaluated only once its pointer has already won. The count guidance attaches to the first and not the second, and the two should never be conflated. Whether the tool thresholds transfer to skill counts is untested and is held in What Could Not Be Determined.

### Finding 2: Long-list degradation is measured, and it is a weak-model problem specifically (PUBLISHED, MEASURED)

MetaTool (arXiv 2310.03128) evaluates tool-usage awareness and tool selection across nine models, scoring selection with a Correct Selection Rate over lists of varying size. Verbatim from the v3 full text:

"In Figure 4, we present the results of tool selection based on popularity, revealing that as the size of tool lists increases, the performance of most LLMs declines. Notably, among open-source models, Vicuna-33b stands out, even surpassing ChatGPT in the top 5 selection settings. All LLMs have a more significant performance decline when the size of the tool list changes from five to ten. Additionally, ChatGPT exhibits remarkable stability, with only a minor decline in CSR as the size of tool lists grows, indicating consistent performance."

Three things in one paragraph. List length degrades selection. The degradation is sharpest at the smallest sizes, between five and ten, not at the large end where intuition puts it. And **the strongest model in the set is nearly flat across the same growth that moves the others** — which is precisely the shape of this repository's own recall table, arrived at on a different mechanism, a different task and a different model family.

**Honest limits, and they are substantial.** The models are the 2023 generation, and its open-source members are far weaker than any tier this repository ships against; the weakest results here should not be read as predictive of sonnet. CSR measures selection from an explicitly presented list, which is closer to Claude's tool block than to skill triggering, where the candidate set is a set of frontmatter descriptions in the system prompt. The paragraph reports a figure rather than a controlled manipulation of list size over fixed queries. Classified **PORTABLE EVIDENCE** on the direction of the effect and its tier-dependence, not on its magnitude.

### Finding 3: Weak-model routing failure is polarised, and the polarity is not read off the tier (PUBLISHED, MEASURED)

The same benchmark separates whether a model knows it needs a tool from whether it picks the right one. Verbatim on the first:

"We found that most models' awareness of tool usage is not ideal, as shown in Table 3. ChatGPT has the best performance in this regard, but only has an accuracy of less than 75%, and the worst-performing model, Llama2-13b, has an F1 Score of only 11.53%. Additionally, the accuracy of many LLMs is close to the level of random guessing (50%). The awareness of some LLMs appears polarized, with Baichuan2 essentially considering the use of tools for all queries, while LLama2-13b and Vicuna-7b are overly confident and rarely choose to use tools in most cases."

This is the external corroboration of ANALYSIS-004 Finding 2, and it sharpens it in a way that matters for how this repository measures. The predecessor found the stronger tier over-fetching and the weaker under-reaching, and generalised to the weak model being the detection instrument. MetaTool shows that **among weak models both poles occur** — one model fires on everything, two fire on almost nothing — and that the polarity is a property of the individual model rather than of its capability level. Weakness predicts that routing will be unreliable; it does not predict the direction of the unreliability.

The operational consequence is narrow but real. This repository's instrument choice remains correct, because the tier it ships against is measured to sit at the under-reach pole, with zero over-fetch across eight negative runs. But that is a measured fact about this tier on this artifact, not a property that transfers to a different weak model, and an over-fetch check belongs in any sweep run against a tier that has not been characterised.

### Finding 4: Compositional load is a second mechanism, distinct from list length (PUBLISHED, MEASURED)

Constraint Saturation Evaluation (arXiv 2608.12426) varies the number of simultaneous constraints from one to twelve across 15 models with deterministic rule-based verifiers and no LLM judge, 369,753 checks. Verbatim from the abstract:

"First, per-constraint pass rate decays gradually and predictably, while the chance of satisfying all k constraints collapses - a model passing individual constraints at ~41% at k=8 succeeds on all eight just 5.7% of the time. Second, constraints do not degrade equally: structural constraints lose 2x more baseline capability per added constraint than lexical ones... Reliable instruction following breaks down beyond 5-6 simultaneous constraints: probe-level success falls below 50% at 7 constraints for the strongest model, and at 3 or fewer for 12 of 15."

And from the body: "Production systems assuming linear degradation will experience unexpected failures: a system reliable with 3 constraints may fail significantly with 5."

**This is the most plausible published explanation for a result this repository could not previously explain.** An imperative in-workflow pointer scored 0 of 20 here on a route where the file was never read. Under the composition model that is not a pointer-strength failure at all: the pointer is one more simultaneous constraint inside a step that already carries several, and the probability of honouring all of them is multiplicative even where each is individually likely. It also reframes the placement null. Moving a pointer into a workflow step does not merely relocate it; it adds it to that step's constraint budget, which predicts the observed halving better than any positional account does.

The prescription that follows is uncomfortable but clean: **reduce the number of things a step asks for, rather than strengthening any one of them.** Strengthening a pointer raises its individual pass rate, which the paper measures as the term that decays gently; the term that collapses is the conjunction, and only removing constraints touches that.

Classified **PORTABLE EVIDENCE** with a stated gap: the constraints are verifier-checkable output properties such as schemas and word limits, not "read this file", and no published work extends the composition result to tool or file-read constraints.

### Finding 5: The same paper refuses the simple scale story, and the contradiction is kept live (PUBLISHED, MEASURED, contrary)

Under the heading "Scale does not predict compositional performance", verbatim:

"Counter to typical scaling expectations, we observe multiple ranking inversions: Gemini Pro ranks #2 at k=1 (90.5% single-constraint pass rate) but #11 overall (42.1% mCSR); Flash-Lite ranks #6 at k=1 (78.1%) but #3 overall (56.6%). Single-constraint competence does not predict compositional robustness—the models that understand constraints best in isolation are not necessarily the ones that compose them most reliably."

And, on a different axis entirely: "the same model with a larger token budget (Claude 4.7 at 16,384 vs 4,096 tokens) jumps from rank #10 to #2 without any change to its compositional capacity."

This is recorded rather than resolved, and it should temper the framing of the whole question. A nominally weaker model composed constraints more reliably than its stronger sibling; a single model moved eight ranks on output budget alone. **"Weaker models route worse" is a defensible summary of the routing evidence in Findings 2 and 3 and is not a law.** Where a measurement here shows a tier gap, the gap is the finding; attributing it to capability rather than to sampling budget, alignment training or task shape requires separating those, and this repository has not done so.

IFScale (arXiv 2507.11538) adds a related complication at extreme density: across 20 models and up to 500 simultaneous keyword instructions, "even the best frontier models only achieve 68% accuracy at the max density", and its analysis "reveals model size and reasoning capability to correlate with 3 distinct performance degradation patterns, bias towards earlier instructions, and distinct categories of instruction-following errors." Size correlates with the *pattern* of degradation rather than simply its amount — and the earlier-instruction bias it reports is a third position claim pointing in a third direction, against lost-in-the-middle's end-of-context prediction and against this repository's measured trailing-beats-in-step null. All three are held open in What Could Not Be Determined.

### Finding 6: The benefit of a routing remedy is capability-graded, measured with controls (PUBLISHED, MEASURED — the central remedy result)

Instruction Stacking Collapse (arXiv 2608.02639) stacks 24 verifier-checked instructions, one to twenty at a time, over three production-tier models — Claude Sonnet 4.6, GPT-5-mini and Gemini 2.5 Flash. Verbatim from the abstract:

"Instruction-following degrades non-linearly: the follow rate falls from ~96% to as low as 20%, driven by a structured and reproducible set of pairwise conflicts. A single 'output JSON' constraint, for example, is jointly unsatisfiable with nine others. We then evaluate a training-free remedy: an instruction compiler that rewrites the stacked prompt in a single LLM call and is reused across queries. Its benefit is capability-graded. It recovers up to +11 points of follow rate for weaker models, which are also the models most often deployed at scale, while leaving stronger models, which already internalise the same structure, essentially unchanged. Cluster-robust tests, same-baseline controls, and a within-family scaling ladder attribute the gain to the rewrite itself rather than to additional tokens, reordering, or measurement headroom."

Three properties make this the most useful external result in the note. The models are current production tiers rather than a 2023 open-source set. The controls are named and they exclude the obvious confounds — token count, ordering, and headroom, the last being the one that would otherwise explain a strong-model null trivially. And the finding is not "the remedy works" but **"the remedy's benefit is graded by the capability of the model receiving it"**, which is a claim about the shape of results rather than about one technique.

**The calibration this licenses is the note's most transferable output.** A remedy measured on the strong tier and showing nothing has produced the predicted result, not a refutation. Conversely a remedy measured only on the strong tier has measured almost nothing, which is the predecessor's Finding 3 arrived at from the remedy side rather than the detection side. Classified **PORTABLE EVIDENCE**: the object rewritten is a stacked system prompt, not a skill description, so the technique does not transfer directly, but the grading does.

### Finding 7: The vendor's own shipped pre-routing mechanism reproduces the grading, with numbers (VENDOR, MEASURED)

Anthropic's advanced tool use engineering post reports, verbatim: "Internal testing showed significant accuracy improvements on MCP evaluations when working with large tool libraries. **Opus 4 improved from 49% to 74%, and Opus 4.5 improved from 79.5% to 88.1% with Tool Search Tool enabled.**"

The weaker starting model gains 25 points; the stronger gains 8.6. That is Finding 6's grading, independently, on a different remedy and a different evaluation. The same post reports an 85 percent reduction in tool-definition tokens and, separately, that tool use examples "improved accuracy from 72% to 90% on complex parameter handling", and names the failure the whole feature targets: "The most common failures are wrong tool selection and incorrect parameters, especially when tools have similar names like notification-send-user vs. notification-send-channel."

The mechanism is deferred loading plus a search step: tools marked `defer_loading: true` are absent from context until Claude searches for them, with regex and BM25 search shipped and embeddings named as a supported custom option. It is available on Haiku 4.5 as well as the Opus and Sonnet tiers.

**Two caveats before this is read as a recommendation.** The numbers are internal testing, not externally reproducible, and the comparison is across model generations — Opus 4 against Opus 4.5 — rather than across tiers within one generation, so it corroborates the grading rather than establishing it. And it is **MECHANISM-SPECIFIC** for the artifact this repository ships: skills already implement three-level progressive disclosure, but there is no `defer_loading` flag, no search step, and no way for an author to request that a skill body or a reference be retrieved rather than chosen. This is the predecessor's Finding 11 recurring on a new axis — the harness can do the deterministic thing, and skills are not wired to it.

### Finding 8: Detail helps, and a strong-model rewrite can hurt the weak model (PUBLISHED, MEASURED — the most actionable finding)

MetaTool v6 reports two description experiments. On length, verbatim: "The more detailed the description, the more efficient tool selection. As shown by the fitted line, as the length of the description increases, the CSR continuously increases, indicating that detailed descriptions can help LLMs better understand the functionality of tools, thus improving the accuracy of tool selection."

On rewriting, verbatim and in full because the detail carries the finding: "we built upon the original description by having two proficient LLMs rewrite it and then observed the performance changes of eight LLMs on the new descriptions. Different rewritten LLMs yielded varying benefits for different groups. For instance, descriptions rewritten by Llama2-70b resulted in a 7.83% improvement for llama2-13b, but did not significantly enhance the performance of the Vicuna series models. In contrast, descriptions rewritten by GPT-4 caused a sharp decline in the performance of ChatGLM and Llama2 series, while significantly boosting the Vicuna series, possibly due to the Vicuna series' training corpus being largely sourced from ShareGPT. Therefore, we strongly recommend that tool developers choose an appropriate rewrite model for generating new descriptions based on the downstream LLM the tool will apply to."

**The two halves are not equally strong and should not be quoted as though they were.** The length result is observational: a fitted line across tools whose descriptions differ in many ways at once, and the higher-scoring group had also been merged and decomposed to reduce functional overlap, so description source is confounded with overlap reduction. The rewrite result is a manipulation — same tools, same queries, description varied by rewriter — and it is the half that carries weight.

**What it says is that a strong model's rewrite is not a neutral improvement.** A GPT-4 rewrite improved one model family and sharply degraded two others. The proposed explanation is training-corpus proximity, which is a hypothesis in the paper rather than a demonstrated mechanism, but the effect does not depend on the explanation being right.

For this repository the consequence is direct and immediate. ANALYSIS-004 Finding 3 established that signposting must be *measured* on the weaker tier. This finding extends it: the description must be *optimised* on the tier that will route, because a description tuned by or for the strongest tier is a specific intervention with a measurable sign, and that sign has been observed negative. Classified **PORTABLE EVIDENCE** on the direction-is-not-guaranteed claim, with the transfer to the Claude family explicitly untested — every model in that experiment predates the tiers this repository ships against.

### Finding 9: Three independent sources say a routing remedy's effect is model-dependent (VENDOR + PUBLISHED, converging)

Beyond Finding 8, two vendors state the same thing about their own levers, without numbers:

- Anthropic, writing tools for agents: "We have found selecting between prefix- and suffix-based namespacing to have non-trivial effects on our tool-use evaluations. **Effects vary by LLM** and we encourage you to choose a naming scheme according to your own evaluations."
- OpenAI, function-calling guide: "Include examples and edge cases, especially to rectify any recurring failures. (**Note: Adding examples may hurt performance for reasoning models.**)"

The second is the sharper of the two, because it names a remedy class whose sign flips with model class — examples help the non-reasoning configuration and may hurt the reasoning one — which is the same shape as MetaTool's rewriter result and as Finding 6's grading.

Anthropic makes a related point about output format that generalises the principle: "Even your tool response structure—for example XML, JSON, or Markdown—can have an impact on evaluation performance: there is no one-size-fits-all solution. This is because LLMs are trained on next-token prediction and tend to perform better with formats that match their training data."

**Taken together these retire the question the owner's brief asked in the form it was asked.** There is no community-favoured phrasing rule for weak-model routing that survives contact with the evidence, because three independent sources report that the sign of a phrasing intervention depends on the model. What survives is a method: hold the routing surface fixed, vary one thing, measure on the deployment tier, keep the result. That is what this repository already does, and the finding is that doing so is not merely good practice here but the only thing the record supports.

### Finding 10: Fewer and broader beats many and narrow, stated by two vendors and forced on one benchmark (VENDOR, GUIDANCE; PUBLISHED, incidental)

Anthropic's define-tools page, verbatim: "**Consolidate related operations into fewer tools.** Rather than creating a separate tool for every action (`create_pr`, `review_pr`, `merge_pr`), group them into a single tool with an `action` parameter. Fewer, more capable tools reduce selection ambiguity and make your tool surface easier for Claude to navigate." And: "**Use meaningful namespacing in tool names.** When your tools span multiple services or resources, prefix names with the service... This makes tool selection unambiguous as your library grows."

The engineering post is blunter about the failure being avoided: "More tools don't always lead to better outcomes", "Too many tools or overlapping tools can also distract agents from pursuing efficient strategies", and "When tools overlap in function or have a vague purpose, agents can get confused about which ones to use." OpenAI's parallel advice is "Combine functions that are always called in sequence" and "Make the functions obvious and intuitive. (principle of least surprise)".

**The incidental measured corroboration is the more interesting evidence.** MetaTool could not build its benchmark over its raw tool set because overlap made ground truth undefinable: "Overlapped issue refers to a query that can be solved by multiple tools. If left unaddressed, this overlap could potentially influence the computation of final metrics." Its remedy was to merge and decompose 390 tools down to 198, verified with silhouette coefficients over description embeddings. That is an admission with a method attached — **overlapping descriptions are not separable even for a grader with the ground truth in hand**, which is a stronger statement about description overlap than any vendor makes.

This is the finding that touches this repository's own measured weakness most directly. Eight of the nineteen triggering misses sit on near-verbatim hook vocabulary. Description overlap between sibling skills is the failure mode two vendors name and one benchmark had to engineer around, and it is a defect this repository can detect mechanically — embedding sibling descriptions and looking for clusters is exactly the operation MetaTool performed. Classified **TECHNIQUE**.

### Finding 11: Forced invocation exists for tools at every vendor and does not exist for skills (VENDOR, MECHANISM-SPECIFIC)

Every vendor surveyed ships an override that removes the routing decision from the model:

- Anthropic: `tool_choice` supporting `auto`, `none`, `any` and `tool`, documented per model.
- Google: "Control how the model uses tools using tool_choice in generation_config: auto (Default): Model decides whether to call a function or respond directly. any: Model is constrained to always predict a function call. none: Model is prohibited from making function calls. validated: Model ensures function schema adherence." Gemini additionally supports restricting the callable set through `allowed_tools`.
- OpenAI: the equivalent `tool_choice` control on its function-calling surface.

**A Claude Code skill has no analogue.** A user can name a skill and invoke it directly, and that is the whole of the deterministic path; an author has no way to declare that a skill must fire on a condition. This extends the predecessor's central vendor result — that a skill's bundled reference is the only case where whether a file is read depends on the model deciding to read it — onto the triggering surface itself. The gap is not that the mechanism is unknown; it is standard, and it is absent here.

What the mechanism does offer is graded prompt-level steering, which Anthropic documents explicitly, verbatim: "This boundary is steerable through your system prompt. If Claude isn't calling tools when you expect, a light instruction such as `\"Use the tools to investigate before responding.\"` increases tool use. A stronger form such as `\"Always call a tool first before responding.\"` pushes further. Conversely, `\"Use your judgment about whether to call a tool or respond directly.\"` keeps triggering behavior conservative." Classified GUIDANCE, and it lives in the host's prompt rather than in any skill an author ships — which means it is available to this repository only for skills whose consumers control their own system prompt.

### Finding 12: The routing surface and the instruction surface are different surfaces, and one vendor now says so outright (VENDOR, GUIDANCE)

OpenAI's function-calling guide, verbatim: "**For deferred tools, put detailed guidance in the function description and keep the namespace description concise. The namespace helps the model choose what to load; the function description helps it use the loaded tool correctly.**"

That is a two-surface architecture stated as authoring advice: the text that wins the routing decision and the text that governs correct use are different objects with different optimisation targets, and conflating them degrades both. Anthropic's tool search optimisation tips carry the same split implicitly — "Use keywords in descriptions that match how users describe tasks", "Keep your 3–5 most frequently used tools non-deferred", and "Add a system prompt section describing available tool categories: 'You can search for tools to interact with Slack, GitHub, and Jira'" — where the first is routing advice and the tool's own detailed description is use advice.

Alongside that sits Anthropic's unqualified statement about the routing surface, verbatim: "**Provide extremely detailed descriptions.** This is by far the most important factor in tool performance", with the concrete form "Aim for at least 3–4 sentences for each tool description, more if the tool is complex."

**The mapping onto skills is exact and it is already validated here.** A skill's frontmatter description is the routing surface; its body is the instruction surface; its references are the deep surface. This repository has measured the separation from the other side — body genre does not move triggering — which is the same claim arrived at empirically rather than by assertion. The practical reading is that effort spent on the body to fix a triggering problem is spent on the wrong surface, and the 3-to-4-sentence floor is the vendor's own guidance for the surface that does move it. Classified **TECHNIQUE**, and it is the remedy in this note most compatible with the Claude Code skill mechanism, because the description is the one routing lever an author actually controls.

### Finding 13: Strong-routes-weak-executes is measured for model selection and unmeasured for skill selection (PUBLISHED, MEASURED but off-target)

RouteLLM (arXiv 2406.18665), verbatim from its abstract: "we propose several efficient router models that dynamically select between a stronger and a weaker LLM during inference, aiming to optimize the balance between cost and response quality... Our evaluation on widely-recognized benchmarks shows that our approach significantly reduces costs-by over 2 times in certain cases-without compromising the quality of responses. Interestingly, our router models also demonstrate significant transfer learning capabilities, maintaining their performance even when the strong and weak models are changed at test time."

**Scoping this honestly matters more than reporting it.** RouteLLM routes *queries* between models. The architecture the owner's question describes — a stronger model decides which skill fires, a weaker model then executes it — is a different thing, and no measurement of it was found in this survey. The transfer-learning result is the part that would most plausibly carry over, since it suggests a router's decision function is not tightly coupled to the specific models behind it, but that is an inference and is labelled as one.

The shipped analogue inside this ecosystem is the subagent: a stronger orchestrator dispatching to a subordinate agent with its own context. That pattern is SHIPPED-PRACTICE and, as far as this survey found, entirely unmeasured on routing accuracy.

### Finding 14: Addy Osmani's corpus contains no model-tier guidance, verified negatively (SHIPPED-PRACTICE, negative result)

Grepping his repository README, his blog post on agent skills and his lesson on agent skills, case-insensitively, for Haiku, Opus, Sonnet, weaker model, smaller model, cheaper model, model tier and less capable returns **zero matches in all three files**. The absence is genuine rather than a wording difference; the same negative-confirmation method as ANALYSIS-005 used on the anti-rationalization genre.

What he does say about progressive disclosure, verbatim: "**Progressive disclosure.** The `SKILL.md` is the entry point. Supporting references load only when needed, keeping token usage minimal." From the blog post: "This is the harness engineering lesson applied at skill granularity. Every token loaded into context degrades performance somewhere, so you load what's relevant and leave the rest on disk. Progressive disclosure is how you get a twenty-skill library into a 5K-token slot without poisoning the well." And the generalised form: "Progressive disclosure for any rulebook. Do not write a 50-page handbook. Write a small router that points to the right small chapter for the situation."

On the routing surface specifically, from the lesson: "The description field is critical. It is the primary way agents decide whether to activate a skill. Write it to clearly describe both what the skill does and when it should be used", with the three levels costed as "At startup, load only skill names and descriptions (~100 tokens each)... Even with 50 skills installed, the startup cost is only about 5,000 tokens."

**His stated rationale is token cost and attention dilution, not model capability**, and it is asserted rather than measured — no evaluation accompanies any of it. His pack's own README also documents a portability defect in the architecture ANALYSIS-004 catalogued as a third shape: a per-skill install "copies only `skills/<name>/`, not the repo-level `references/` directory", so the shared pool's paths are unavailable, which he tracks as an open issue. That is worth carrying because this repository considered the shared-pool architecture and the shared pool has a distribution cost its author states publicly.

The single point of convergence with the measured record is the router framing — a small router pointing at the right small chapter is Finding 12's two-surface split in different words. Everything else in his corpus is orthogonal to the tier question rather than evidence on it.

### Finding 15: A search summariser asserted two figures that its cited paper does not contain (METHOD, correction)

While locating Finding 4's source, a web-search summary asserted of the constraint-saturation paper that "the degradation rate under constraint composition is strongly anti-correlated with baseline capability, spanning nearly an order of magnitude from 8.1% (Gemini 3.1 Pro) to 81.8% (Qwen3.5 0.8B)".

That claim was checked against the paper's own text — abstract page and the full v1 HTML, 155KB stripped — grepping for `81.8`, `8.1%`, `anti-correlat`, `order of magnitude` and `baseline capability`. **Neither figure appears anywhere, and the phrase "anti-correlated" appears nowhere.** The only match for "baseline capability" is the unrelated structural-versus-lexical comparison quoted in Finding 4. Worse than absent, the paper's own text argues the opposite direction on exactly that question: its section headed "Scale does not predict compositional performance" reports ranking inversions counter to scaling expectations, quoted in Finding 5.

Had that summary been trusted, this note would have carried a fabricated headline number supporting its central thesis, in a paper that partly contradicts it — the most dangerous possible shape for an error, because it would have read as the strongest evidence in the note.

This is the second recorded instance of the fault class in this research programme; a fetch summariser fabricating a paper's contents is what put the verify-against-primary-text rule into ANALYSIS-004 in the first place. It is recorded here as a finding rather than a footnote because two independent instances make it a base rate rather than an anecdote: **a summariser's number is not evidence that the number exists.** The check costs one grep.

## What Could Not Be Determined

- **Whether skill triggering has ever been measured against model tier by anyone else.** Nothing in this survey measures whether a skill fires, by tier, on realistic user phrasings. Every external result quoted here is about tool selection, function calling or constraint following. This repository's 20-of-39-against-90-percent figure appears to be the only measurement of the actual quantity, which means it has no external replication and no external contradiction.
- **Whether the tool-count thresholds transfer to skill counts.** Three vendors bound the tool list at 30-50, 10-20 and under 20. A tool definition sits in the tool block with a schema; a skill contributes roughly 100 tokens of name and description to the system prompt. The surfaces differ in size, position and structure, and no one has measured whether the thresholds move together. Adopting a skill-count cap from these numbers would repeat the category error ANALYSIS-004 Finding 17 corrects.
- **Whether the description-rewriter result transfers to the Claude family.** MetaTool's rewriters and downstream models are all the 2023 generation. Whether a description tuned by the strongest current Claude degrades routing on a weaker current Claude is exactly the experiment this repository could run and has not.
- **Whether description length helps monotonically, or has a ceiling, or reverses.** The fitted-line result is observational and confounded with overlap reduction, and Anthropic's 3-to-4-sentence floor is a floor with no stated ceiling. No source anywhere states where more detail stops helping.
- **Where a pointer should sit, now with three published claims in three directions.** Lost-in-the-middle predicts end-of-context is favoured; IFScale reports bias toward earlier instructions; this repository measured trailing beating in-step at 8/40 against 4/40, p approximately 0.20. Finding 4 offers a fourth account in which position is not the variable at all and constraint count is. None has been separated from the others, and the honest position is that the question is open and expensive.
- **Whether the 5-to-6 constraint ceiling applies to a skill body's rules.** The constraints measured are verifier-checkable output properties. Whether "read this file when X" occupies the same budget as "output valid JSON" is unestablished, and the whole application of Finding 4 to this repository's 0-of-20 result rests on it.
- **Whether a strong-routes-weak-executes architecture improves skill selection.** RouteLLM measures query routing between models, not skill selection. The subagent pattern is the shipped analogue and no measurement of its routing accuracy was found.
- **Whether over-fetch on the strong tier costs anything.** Inherited unresolved from ANALYSIS-004 and untouched here.
- **Eight vendors not checked on this axis.** Cursor, Windsurf, Cline, Continue, JetBrains AI, Amazon Q Developer, Zed and Sourcegraph Amp were not searched for model-tier guidance in this pass. The five matcher vendors are the most likely to hold something useful, since a deterministic matcher is precisely the mechanism that makes tier irrelevant, and any statement they make about why would bear on Finding 11.

## Recommendations

1. **Optimise the description on the tier that will route, not merely measure on it** (Findings 8, 9). ANALYSIS-004 established the weak tier as the detection instrument; the rewriter result makes it the optimisation target as well, because a strong-model rewrite has a measured sign and that sign has been observed negative. Where a description is edited, the edit is an intervention with a direction, and it should be measured on the routing tier before it ships.
2. **Spend triggering effort on the description and stop spending it on the body** (Finding 12). The two-surface split is now stated outright by one vendor, implied by another, and confirmed here from the other side by the measurement that body genre does not move triggering. The vendor floor for the routing surface is 3 to 4 sentences covering what it does, when to use it and when not to.
3. **Attack description overlap between sibling skills, mechanically** (Finding 10). Two vendors name overlapping and vague descriptions as the confusion mechanism, and one benchmark had to merge 390 tools into 198 before ground truth was even definable. Eight of nineteen misses here sit on near-verbatim hook vocabulary. Embedding sibling descriptions and clustering them is the operation that benchmark performed, it is cheap, and it produces a candidate list rather than a judgement.
4. **When a step's pointer is missed, remove constraints from the step rather than strengthening the pointer** (Finding 4). Per-constraint pass rate decays gently and the conjunction collapses multiplicatively, so strengthening one constraint optimises the term that was not the problem. This is the first published account that explains the 0-of-20 in-step result, and it predicts that a stronger imperative would not have helped.
5. **Read a strong-tier null as the predicted result, not as a refutation** (Findings 6, 7). Capability-graded benefit is measured with controls on current production tiers and reproduced independently in vendor internal testing. Any A/B this repository runs on a routing remedy should be powered on the weak tier and should not treat a strong-tier null as evidence against.
6. **Do not import the tool-count thresholds as a skill-count cap** (Finding 1, and What Could Not Be Determined). The numbers are real and they are about a different surface. The correct reading of Finding 1 is that vendors bound routing surfaces and decline to bound disclosure surfaces, which is consistent with ANALYSIS-004's depth-not-count principle rather than a reason to revisit it.
7. **Write the tier guidance knowing the escape hatch is missing** (Finding 11). Every vendor ships a forced-invocation control for tools and none exists for skills. Guidance authored here compensates for its absence, exactly as the predecessor's reference-following guidance compensates for the absence of declarative attachment, and it should say so rather than presenting a pointer as the natural mechanism.
8. **Keep the position question closed to spending until the confound is separated** (Finding 5). Four accounts now disagree about where a pointer should sit, one of which says position is not the variable. A further placement A/B buys nothing until constraint count and position are manipulated independently.

## Observations

### Why the weaker tier under-routes

- [fact] Three vendors independently put a count on the routing surface — Anthropic states tool selection degrades past 30 to 50 available tools, Gemini caps the active set at 10 to 20, OpenAI advises fewer than 20 at the start of a turn — while no vendor caps the number of reference files a skill may bundle #vendors #thresholds
- [insight] The record is coherent rather than contradictory once the two surfaces are separated: vendors bound the set a model must choose among and decline to bound the set it may later read, so tool-count guidance must never be imported as reference-count guidance #routing-surface #disclosure-surface
- [fact] Measured across nine models, tool-selection performance declines as list size grows, all models decline most sharply between five and ten tools, and the strongest model in the set is nearly flat across the same growth #metatool #list-length
- [insight] The external long-list result is the same shape as this repository's recall table on a different mechanism, task and model family, which is the first independent corroboration the tier asymmetry has #corroboration #asymmetry
- [problem] Weak-model routing failure is polarised rather than merely reduced — one benchmarked model fires on essentially every query while two others almost never fire, with many near coin-flip accuracy — so capability predicts unreliability but not its direction #polarity #instrument
- [constraint] This repository's tier is measured at the under-reach pole with zero over-fetch across eight negative runs, which is a fact about this tier on this artifact and does not transfer to an uncharacterised weak model; an over-fetch check belongs in any sweep against a new tier #instrument #scope
- [fact] Reliable instruction following breaks down beyond five or six simultaneous constraints across 15 models, with a model passing individual constraints at about 41 percent at k=8 satisfying all eight just 5.7 percent of the time #composition #ceiling
- [insight] A pointer inside a workflow step is one more simultaneous constraint, which is the first published account that explains an imperative in-step pointer scoring 0 of 20 here, and it predicts that strengthening the pointer would not have helped #composition #in-step-null
- [risk] The same paper reports ranking inversions counter to scaling expectations and states that single-constraint competence does not predict compositional robustness, so weaker-routes-worse is a defensible summary of the routing evidence and not a law #scale #contrary
- [fact] One model moved from rank ten to rank two on output token budget alone with no change to its compositional capacity, so a measured tier gap requires separating capability from sampling budget, alignment training and task shape before it is attributed to capability #confound #budget
- [problem] Instruction-density work reports bias toward earlier instructions, which is a third position claim pointing against both lost-in-the-middle's end-of-context prediction and this repository's measured trailing-beats-in-step null #position #unresolved

### What the remedies are, and what shape their evidence takes

- [outcome] The central remedy result is capability-graded benefit: a training-free instruction-compiler rewrite recovers up to 11 points of follow rate for weaker production-tier models while leaving stronger models essentially unchanged, with controls excluding token count, reordering and measurement headroom #capability-graded #measured
- [insight] Capability grading inverts the default reading of a null — a remedy showing nothing on the strong tier has produced the predicted result rather than a refutation, and a remedy measured only on the strong tier has measured almost nothing #calibration #null-reading
- [fact] Anthropic's internal testing reproduces the grading independently on a different remedy: Opus 4 improved from 49 to 74 percent with the tool search tool enabled while Opus 4.5 improved from 79.5 to 88.1, a 25-point gain against 8.6 #tool-search #grading
- [risk] Those numbers are internal testing across model generations rather than across tiers within one generation, so they corroborate the grading rather than establishing it #tool-search #caveat
- [decision] The tool search mechanism is classified MECHANISM-SPECIFIC and not recommended for adoption: skills already implement three-level disclosure but expose no deferred-loading flag, no search step, and no way for an author to request retrieval rather than model choice #mechanism #gap
- [outcome] A description rewritten by a strong model is not a neutral improvement — a Llama2-70b rewrite gained 7.83 percent for Llama2-13b while a GPT-4 rewrite sharply degraded two other model families — and the paper's recommendation is to choose the rewrite model by the downstream model that will route #rewriter #sign-flip
- [insight] That upgrades the established protocol from measure-on-the-weak-tier to optimise-on-the-weak-tier, since editing a description is an intervention with a direction and that direction has been observed negative #protocol #upgrade
- [problem] The companion description-length result is observational — a fitted line over tools that also differ in functional overlap — so only the rewriter half of that paper carries weight and the two must not be quoted as equally strong #confound #honesty
- [fact] Three independent sources report that a routing remedy's effect is model-dependent: namespacing effects that vary by LLM, examples that may hurt reasoning models, and rewriter benefit that varies by downstream family #model-dependence #convergence
- [decision] There is therefore no portable weak-model phrasing rule to adopt; what the record supports is a method — hold the routing surface fixed, vary one thing, measure on the deployment tier — which this repository already practises #no-portable-rule #method
- [technique] Two vendors prescribe consolidation over proliferation, with fewer and more capable tools said to reduce selection ambiguity, and one benchmark had to merge 390 tools into 198 because overlap made ground truth undefinable #consolidation #overlap
- [technique] Description overlap is mechanically detectable by embedding sibling descriptions and clustering them, which is the operation that benchmark performed, and it bears directly on the eight of nineteen misses here sitting on near-verbatim hook vocabulary #overlap-detection #actionable
- [problem] Every vendor ships a forced-invocation control for tools — Anthropic's tool_choice, Gemini's auto/any/none/validated modes plus an allowed-tools restriction, OpenAI's equivalent — and a Claude Code skill has no analogue beyond a user naming it #forced-invocation #absent
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

## Relations

- extends [[ANALYSIS-004: What Makes a Bundled Reference Get Read]]
- pairs_with [[ANALYSIS-005: Structural Genres of Skill Content]]
- depends_on [[SESSION-2026-08-23_01: Plugin Kit Measurement Tooling Hardening]]
