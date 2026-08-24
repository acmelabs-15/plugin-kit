# Authoring checklist

A mechanical pre-flight, run before you spend eval budget on a draft — and run again after fixing what it finds, since the fix is what introduces the next dangling reference.

Be clear about what this is and is not. It catches defects that are *cheap to find by reading* — a dangling reference, a description with no negative space, 900 lines in SKILL.md. Every one of those would otherwise cost a full iteration to discover, and an iteration costs subagent runs, wall-clock and the user's attention. What the checklist cannot tell you is whether the skill **works**. Only measurement does that. Treat a clean checklist as permission to start evaluating, never as evidence of quality.

The `plugin-kit:skill-reviewer` agent runs this same audit automatically and reports a verdict; this file is the manual form, and the reference for what the agent is checking.

---

## Structure (4)

- [ ] `SKILL.md` exists and opens with valid `---`-delimited YAML frontmatter
- [ ] Frontmatter carries `name` and `description`; `name` is kebab-case and **matches the directory name** (see `skill-frontmatter.md` — the two runtimes disagree about which wins, so keeping them identical avoids the question)
- [ ] Body is present and substantial — a skill that is only frontmatter is a description, not a skill
- [ ] Every file referenced from SKILL.md actually exists, and references are **one level deep** (`references/x.md`, not `references/sub/x.md`). Nothing first-party catches a dangling reference link, so this box is load-bearing

## Description quality (6)

- [ ] **Capability-first**, not `This skill should be used when…` boilerplate. That opener burns the highest-signal tokens in the file on a constant string; lead with what the skill does
- [ ] A **deliverable clause** names the concrete artifact the skill produces or modifies
- [ ] At least one **"Do not use when…"** clause, and its exclusions share vocabulary with the positive claims — an obviously-irrelevant exclusion defends against nothing
- [ ] No universal-quantifier pushiness (`even if they don't…`, `whenever the user mentions…`, `always use this skill`). See `description-writing.md` for what that phrasing costs, measured
- [ ] **Under the 1,024-character cap**, measured rather than eyeballed — over it the tail is silently truncated and stops triggering. Past ~500, check that each clause is still buying something; `description-writing.md` has what to cut and what never to
- [ ] **No sibling claims the same ground.** Where skills ship together, check this description's domain vocabulary against its neighbours': overlapping and vague descriptions are the confusion mechanism two vendors name, and one benchmark had to merge 390 tools down to 198 before its ground truth was even definable, because an overlapped query has no single correct answer to score against (measured, external, on tools). Consolidating related work into one broader skill is the vendor-stated remedy (guidance, unquantified). `--with-environment` names the neighbours mechanically; deciding what to do about one is a judgement

## Content quality (10)

- [ ] Body explains *why* rather than issuing MUSTs and ALWAYSes; second person is fine
- [ ] SKILL.md is **under 500 lines and under 5,000 tokens** — check both; a 480-line file with dense paragraphs can still blow the token budget
- [ ] Detail that is not procedure or workflow has moved into `references/`
- [ ] Prescriptiveness is matched to fragility *per section* — a fragile sequence is spelled out and said to be exact, a genuine judgement call is explained rather than over-specified
- [ ] Where several approaches are valid, one is the stated default and the alternatives sit in a clause. A menu of equals hands the decision back
- [ ] The body's **shape is chosen rather than imitated** — a numbered workflow as its spine, and every table, checklist, diagram or specimen present because its mechanism fits this problem. `../../../shared/references/body-structure.md` catalogs the available shapes and labels each measured, merely shipped, or refuted; two structural rules that sounded right were killed by measurement, so "other skills do this" is not a reason
- [ ] A **gotchas section** exists if the domain has real gotchas, and it is in the body rather than behind a pointer — the model cannot open a file about a trap it does not know exists
- [ ] Bundled specimens and examples are complete and correct — an example that does not work teaches the wrong thing more confidently than no example
- [ ] Scripts run, and their usage is documented where the skill invokes them
- [ ] Any bundled script that runs for minutes reports progress to a status file, and the skill documents launching it detached — a long job that prints nothing is indistinguishable from a hung one

## Progressive disclosure (8)

- [ ] Core workflow and pointers in SKILL.md
- [ ] Every reference file over 100 lines opens with the standard table-of-contents block — a `## Table of Contents` heading, then flat anchor-link bullets naming each H2 in order — so a partial read still returns the file's map. Whole-specimen files (no H1, content is the artifact) are exempt; the form itself is specified in `../../../shared/references/progressive-disclosure.md`
- [ ] `scripts/` holds only files the model is told to **run** — nothing in there is read into context
- [ ] `references/` holds files the model is told to **read**; `examples/`, if present, holds whole **specimens** of the skill's input or output
- [ ] `assets/` holds files **copied into the output** — templates, fonts, images, boilerplate
- [ ] **Every** bundled file is named somewhere in SKILL.md. An unreferenced file is invisible and its zero pull rate says nothing about its value
- [ ] Every reference is **named where its content is relevant**, so a reader meets the pointer at the moment the file would help. Check coverage, not phrasing — no pointer form has measured evidence, so none of them is a guarantee you can lean on
- [ ] Each reference answers its question completely, or says where the other half is. Two files always needed together are one file

Load mode decides placement, not file type. `progressive-disclosure.md` has the ordered decision rule and the hard cases, and — for the two boxes above — what is and is not known about pointers: no form has evidence behind it, the file-plus-condition-plus-cost rule is struck, and moving a pointer into the step that needs it was tested and halved reach.

## Testing (9)

- [ ] Eval evidence is committed under `evals/results/iteration-<N>/`, fixture-repo copies excluded — a score whose run cannot be re-read is not evidence
- [ ] The skill triggers on the queries you expect it to
- [ ] It does **not** trigger on hard negatives: in-domain, multi-step queries whose deliverable is something else. Easy ones certify everything — that failure is measured in `description-writing.md`
- [ ] Every validator the skill ships is run in a loop — run, fix, run again — rather than once
- [ ] No information is duplicated across SKILL.md and a reference file; one copy will drift
- [ ] References load when needed rather than being pulled in unconditionally
- [ ] **Measured on the tier that will route**, not only on the strongest one to hand. The tiers fail in opposite directions, and a remedy's benefit is capability-graded — measured externally at "up to +11 points of follow rate for weaker models… while leaving stronger models… essentially unchanged", with controls excluding token count and reordering. So a strong-tier null is the predicted result, not a refutation, and a sweep run only on the strong tier has measured almost nothing
- [ ] **No should-fire scenario is inert.** A scenario whose expected output the model can already produce without the skill passes either way, so its pass is evidence of nothing. Two independent sources make reversion to the training prior the observable that separates a working disclosure mechanism from a broken one (technique, external). The ablation harness produces this audit for free: a scenario whose score does not move when the skill is stripped had its answer in the model already
- [ ] **The installed set is sized deliberately.** Three vendors bound the set a model routes among — Anthropic 30-50 tools, Google 10-20, OpenAI under 20 — none with a published derivation, which is why the three disagree and why the label is guidance rather than measurement. Whether the figures transfer from tools to skills is untested, so read a large installed set as a reason to measure triggering rather than as a cap to enforce. Never read them onto bundled reference files: vendors bound routing surfaces and decline to bound disclosure surfaces

---

Once this is clean, go run the loop in SKILL.md. The checklist told you the skill is well-formed; the benchmark tells you whether it helps.
