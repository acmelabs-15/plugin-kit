# Writing a description that fires on the right queries

The `description` field is the entire trigger surface. Claude sees every installed skill's name and description, and decides from that alone whether to consult one. Everything else in the skill is invisible until after that decision.

**Two vendors now state that as a two-surface architecture, and it is worth having in those terms.** OpenAI's function-calling guide, on deferred tools: "put detailed guidance in the function description and keep the namespace description concise. The namespace helps the model choose what to load; the function description helps it use the loaded tool correctly" (guidance, unquantified). Anthropic's define-tools page puts a floor under the routing half — "Provide extremely detailed descriptions. This is by far the most important factor in tool performance", with "at least 3-4 sentences for each tool description, more if the tool is complex" (guidance, unquantified). Map it onto a skill and the division is exact: frontmatter is the routing surface, the body is the instruction surface, bundled references are the deep surface. This repository has confirmed the same separation from the other side, by measuring that body genre does not move triggering at all. **The practical consequence is that effort spent on the body to fix a triggering problem is spent on the wrong surface** — and the 3-to-4-sentence floor is the vendor's own guidance for the surface that does move it.

The rule this file argues for is short:

> **A description must be matchable on the artifact it produces, not the topic it is about. State the deliverable, and exclude at least one same-domain, different-deliverable case.**

The rest of this file is why that rule exists, four criteria you can check mechanically, and — importantly — an honest account of what following it does *not* buy you.

## Table of Contents

- [The failure mode: topic-matching](#the-failure-mode-topic-matching)
- [Four checkable criteria](#four-checkable-criteria)
- [Length is a budget, not a limit](#length-is-a-budget-not-a-limit)
- [The honest limit: this is good citizenship, not self-defence](#the-honest-limit-this-is-good-citizenship-not-self-defence)
- [Your trigger eval set decides whether any of this is visible](#your-trigger-eval-set-decides-whether-any-of-this-is-visible)
- [Three further cautions](#three-further-cautions)
- [Provenance](#provenance)

---

## The failure mode: topic-matching

A description that lists its subject matter fires on anything about that subject, including work with a completely different output.

This skill's own predecessor shipped with:

> Create new skills, modify and improve existing skills, and measure skill performance. Use when users want to create a skill from scratch, edit, or optimize an existing skill, run evals to test a skill, benchmark skill performance with variance analysis, or optimize a skill's description for better triggering accuracy.

Every noun there is a **topic**: skills, evals, benchmarks, descriptions, variance. Nothing names an **output**. So a query whose subject is skills but whose deliverable is a slide deck matches on topic and fires.

A rewrite that adds negative space, keeping the capability claim verbatim in the first sentence:

> Create new skills, modify and improve existing skills, and measure skill performance. Use when the skill file itself is the deliverable — writing a SKILL.md from scratch, editing or optimizing an existing one, running evals, benchmarking with variance analysis, or tuning a description for triggering accuracy. Do NOT use when a skill is merely the subject matter rather than the artifact being produced: reviewing or auditing someone else's skill for security or quality, debugging why an installed skill errors at runtime, writing documentation or explanations about skills, listing or discovering installed skills, or moving and configuring skill files. Do NOT use when the user asks you to follow a plan, brief, or spec that happens to mention skills or plugins among its inputs — follow that document instead. Benchmarking or variance analysis of anything other than skill triggering is out of scope.

### What that change measured

Both descriptions were installed as real plugin skills with **identical names and identical bodies**, so the description was the only variable, and run against the same query set on the same model in the same clean environment.

| | shipped description | negative-space rewrite |
|---|---|---|
| True-positive rate (16-query set, sonnet) | 85.7% | **90.5%** |
| Hard near-miss false-positive rate, sonnet | 29.2% (7/24) | **8.3%** (2/24) |
| Hard near-miss false-positive rate, opus | 14.3% (3/21) | **4.8%** (1/21) |

Note the true-positive rate went *up*. This is not a precision-for-recall trade.

*These figures were measured under a narrower detection rule than the loop now uses and are not comparable to a fresh run — see Provenance at the end of this file before treating them as targets.*

The single cleanest result is one query:

> "Put together a training deck for new hires on how to write good skill descriptions, with worked before-and-after examples of weak and strong ones and an exercise at the end."

Pooled across both models, that query fired the shipped description **9 times out of 9** and the rewrite **0 times out of 9**. Subject matter: skill descriptions. Deliverable: a training deck. Exactly the topic-versus-deliverable failure the rule names.

---

## Four checkable criteria

A reviewer can apply these by reading, and a validator can warn on most of them.

**1. A deliverable clause.** Some sentence names a concrete output artifact the skill produces or modifies — "Use when X is the deliverable", "produces/edits/creates X". A description that only lists topics and verbs fails this. *Mechanically: warn when no sentence names an output artifact.*

**2. At least one negative clause.** A "Do not use when…" or "Not for…" segment exists. *Mechanically: greppable — warn when no negation is present.*

**3. Negatives share vocabulary with positives.** Each exclusion is in the same domain as the capability claim. Excluding something obviously irrelevant is worthless: "not for writing a fibonacci function" defends a PDF skill against nothing, because nothing was ever going to route there. The exclusions that do work are the ones that were genuinely tempting. *Mechanically: warn when the negative segment's content words barely overlap the positive segment's.*

**4. No universal-quantifier pushiness.** Phrases like `even if they don't…`, `whenever the user mentions…`, `always use this skill`, `even if they describe the goal without using the word…`. *Mechanically: a literal regex — highest signal, lowest false-alarm rate of the four.*

### Why these are criteria and not phrasings

Each of the four is a checkable property of the text — a clause is present, vocabulary overlaps, a regex does not match. None of them is a wording template, and that is deliberate: three independent sources report that the *sign* of a phrasing intervention depends on the model receiving it.

- Anthropic, on tool-name namespacing: "We have found selecting between prefix- and suffix-based namespacing to have non-trivial effects on our tool-use evaluations. **Effects vary by LLM** and we encourage you to choose a naming scheme according to your own evaluations" (guidance, unquantified).
- OpenAI, on worked examples inside a description: "Include examples and edge cases, especially to rectify any recurring failures. (**Note: Adding examples may hurt performance for reasoning models.**)" (guidance, unquantified) — a remedy class whose sign flips with model class.
- MetaTool (arXiv 2310.03128) varied only the rewriter, holding tools and queries fixed across eight downstream models: a Llama2-70b rewrite gained one model 7.83% and left another family unmoved, while a GPT-4 rewrite "caused a sharp decline in the performance of ChatGLM and Llama2 series, while significantly boosting the Vicuna series" (measured, external). Its models are the 2023 generation and the transfer to current Claude tiers is untested.

- Vercel, varying only the wording of a routing instruction and holding skill and docs fixed: "You MUST invoke the skill" produced "Misses project context", while "Explore project first, then invoke skill" produced "Better results" — summarised as "Same skill. Same docs. Different outcomes based on subtle wording changes", and reacted to with "If small wording tweaks produce large behavioral swings, the approach feels brittle for production use" (measured, external; the post names no model). **The maximally forceful phrasing was the worse one**, which is a direct counterexample to the instinct that a missed pointer wants a stronger imperative.

So there is no portable phrasing rule to write down here, because no phrasing has a sign that holds across models. What a standard can encode is the **method**: hold the surface fixed, vary one thing, measure on the tier that will route, keep the result. The four criteria are written to be checkable without asserting that any wording is better, and a fifth criterion prescribing a phrase would be claiming something the record does not support.

Criterion 4 is worth stating plainly because of where it fires. It fires on the predecessor skill's **own authoring guidance**, which told authors to make descriptions "a little bit pushy" and offered as its model example "*Make sure to use this skill whenever the user mentions dashboards, data visualization, internal metrics, or wants to display any kind of company data, even if they don't explicitly ask for a 'dashboard.'*" And it fires on the widely-installed `create-skill` description, which ends "*— even if they describe the goal without using the word 'skill'*". Both were written to fight under-triggering, which is a real problem; the measurements below are what that fix costs.

---

## Length is a budget, not a limit

The hard cap is **1,024 characters** (`skill-frontmatter.md`), and it is a real cliff rather than a guideline: a description over it is silently truncated, so its tail stops participating in triggering at all and nothing warns you. One skill in a plugin surveyed for this file sits at 1,056 and is truncated today. Measure before shipping.

Below the cap, treat length as a budget spent on the four criteria rather than a number to minimise. **Roughly 500 characters is where to start asking what each clause buys**, not a threshold to pass; the `skill-reviewer` agent reports over-500 as a Minor finding on exactly that reading.

It cannot be a hard limit, and the evidence is in this file. The negative-space rewrite that beat its predecessor on true positives *and* false positives is **905 characters**, and it won because of the exclusions that make it long — trimming it to 500 would delete the clauses the measured improvement is attributed to. For calibration, every description shipped alongside this reference is deliberately over 500 too, because each one names all five of its sibling skills in its exclusions and that is what the characters buy.

So when a description runs long, ask which clause is not working rather than which sentence is longest. Three that usually are not:

- **A clause describing runtime mechanics** instead of when to route here. The body covers mechanics better, and the description is not read again once the skill loads.
- **A second exclusion aimed at the same near-miss as the first.** Two negatives covering one case are one negative.
- **Restatement** — the deliverable named twice in different words.

What not to cut: an exclusion that names a *different* competing skill, and the deliverable clause. Those are what the measurements here credit for the gain.

`<example>` blocks are exempt. An agent description carrying three of them is mostly examples by character count, and they do work no prose clause replaces.

---

## The honest limit: this is good citizenship, not self-defence

It is tempting to read the rule as protection. It is not. It stops *your* skill from stealing *other people's* queries; it barely stops other people's skills from stealing yours.

Measured, with a deliberately pushy competitor co-installed alongside a well-formed skill:

| description | its own true-positive rate alone | with the pushy neighbour installed |
|---|---|---|
| shipped | 85.7% (18/21) | **0.0%** (0/21) |
| negative-space rewrite | 90.5% (19/21) | **19.0%** (4/21) |

The shipped description lost **every single one** of its own true positives to the neighbour. The negative-space rewrite recovered 4 of 21 — a real effect, and nowhere near a defence. *(Sonnet only, n=21 per arm; not replicated on other models.)*

The aggregate trigger rate barely moved, so the work still got picked up — what changed was *who* picked it up. Territory capture is displacement of a correct trigger, not manufacture of an incorrect one, and the two need different fixes. Editing your own description does not solve the first. That needs an ecosystem-level mechanism: namespace or territory declaration, install-time overlap detection, or a lint that flags two installed skills claiming the same domain.

The last of those ships here. `bun ../validate/validate.ts --target-type skill <skill-dir> --with-environment` reads the installed set and names the neighbours that both share this skill's domain vocabulary and use the pushy phrasing measured above — the conjunction, because shared vocabulary alone flags every skill in a domain and most of them coexist fine. It is a detector, not a defence: what it gives you is the name of the skill absorbing your queries, and then a decision only a human can make about whether to narrow it, uninstall it, or live with it.

So: follow the rule because it makes you a good neighbour and because it demonstrably improves your own precision. Do not expect it to defend you.

**Co-installation does not manufacture false positives.** Every measured collision arm scored at or below both of its constituents measured alone. If a skill is over-firing, the cause is its own description, not the company it keeps.

---

## Your trigger eval set decides whether any of this is visible

A **hard negative** is a should-not-trigger query written to be genuinely tempting — a near-miss. A set of easy ones certifies everything.

A first, plausible-looking set of nine — "review this third-party skill for security problems", "debug this skill's ModuleNotFoundError", "what skills do I have installed" — returned a **0% false-positive rate in every condition tested**, including the shipped description, the negative-space rewrite, the pushy competitor, and a deliberately narrow control that was failing 52% of its true positives. It discriminated nothing, and would have certified the worst description in the set as flawless.

The reason is in how triggering works: Claude only consults a skill for work it cannot easily handle on its own. Every one of those nine queries has an obvious first action — read a file, run a command, answer directly — so none of them ever reach the point where skill selection happens.

**A hard negative earns its place only if it is complex, multi-step, and squarely inside the skill's declared subject matter, with a deliverable that is something else.** The queries that discriminated looked like:

- "Put together a training deck for new hires on how to write good skill descriptions, with worked before-and-after examples and an exercise at the end."
- "Our platform team wants a one-page cheat sheet of the house rules for writing SKILL.md frontmatter. Draft it and circulate a version for comment."
- "Grade these five skill descriptions on a 1-to-5 scale for trigger precision, then write up the rubric you used so other reviewers can apply it consistently."

All three are deep in the domain. All three produce a document, not a skill.

**Harden the set before trusting any comparison run through it.** Vercel published its own suite's defects before publishing its findings: "Our initial test suite had ambiguous prompts, tests that validated implementation details rather than observable behavior, and **a focus on APIs already in model training data**. We weren't measuring what we actually cared about." Their repair was three controls — remove the leakage, assert on observable behaviour rather than implementation detail, and repeat runs "to rule out model variance" (technique, external). This loop already does the third at 3 runs per query. The first is the one most likely to be missing, and it has a twin on the positive side of the set: **a should-trigger query whose answer the model can already produce without the skill passes either way**, so its pass is evidence of nothing and it cannot detect a triggering failure. Audit for that the same way you audit hard negatives for being too easy — the defect is identical, and it is simply pointing the other direction.

---

## Three further cautions

**Negative space only protects the cases it names.** The rewrite above eliminated the two failures it explicitly excluded and introduced a new one — a query about grading descriptions for trigger precision, which sits almost exactly on its own positive clause "tuning a description for triggering accuracy". Adding exclusions is not the same as achieving precision; expect a residual and go looking for it.

**The residual moves between models.** The rewrite's one remaining leak was a different query on sonnet than on opus. An author who evaluates on a single model should not assume the residual they can see is the only one they have.

**Optimise on the tier that will route, not merely measure on it.** The rewriter result above is a manipulation rather than an observation — same tools, same queries, only the rewriting model varied — and a strong model's rewrite degraded two of the families it was applied to while improving a third. A description tuned by or for the strongest tier is therefore a specific intervention with a measurable sign, and that sign has been observed negative. This is why the loop in `description-optimization.md` selects candidates on measurement against the routing tier rather than on how the wording reads to a strong model, and why a rewrite that a strong model likes is not thereby an improvement.

When you are ready to write the queries themselves rather than judge them, that is `description-optimization.md`, section "What a good query looks like" — it is deliberately over there, because the queries only exist as an input to that loop.

---

## Provenance

Every number here comes from controlled runs in which the description was the only variable — same skill name, same body, same queries, same runs-per-query, same environment. Single-skill arms were measured on sonnet and replicated on opus; the collision result (territory capture) is **sonnet only** and is labelled as such above.

**These figures were measured under a detection rule the loop no longer uses, and are not comparable to a run made today.** They counted a trigger only when the *first* tool call named the skill, 3 runs per query, a query counted as triggering at a rate of 0.5 or above. Detection now counts a consult at any point before the first mutating tool (`Edit`, `Write`, `NotebookEdit`), and the one-turn cap that used to end a run after a single tool call is gone.

The rule changed because first-call-only cannot measure a skill whose subject is a working repository. Such a query provokes read-only reconnaissance first — the model often cannot tell whether the skill applies until it has seen what changed — and one measured run reached its `Skill` call at position 4, with every call landing in its own turn. Scoring that as a refusal measures turn-ordering rather than description quality, and floors every candidate for that class of skill at zero, which leaves this loop unable to tell two descriptions apart.

The new rule is a strict superset: anything that scored a trigger at call 1 still does. So a rerun of these arms would be expected to score the same or higher, and a higher number would mean the ruler changed rather than the description improved. Treat the table above as a record of what the negative-space rewrite achieved relative to its own baseline, measured consistently, rather than as a target to reproduce.
