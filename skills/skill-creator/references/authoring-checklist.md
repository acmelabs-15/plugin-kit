# Authoring checklist

A mechanical pre-flight, run before you spend eval budget on a draft — and run again after fixing what it finds, since the fix is what introduces the next dangling reference.

Be clear about what this is and is not. It catches defects that are *cheap to find by reading* — a dangling reference, a description with no negative space, 900 lines in SKILL.md. Every one of those would otherwise cost a full iteration to discover, and an iteration costs subagent runs, wall-clock and the user's attention. What the checklist cannot tell you is whether the skill **works**. Only measurement does that. Treat a clean checklist as permission to start evaluating, never as evidence of quality.

The `skill-creator:skill-reviewer` agent runs this same audit automatically and reports a verdict; this file is the manual form, and the reference for what the agent is checking.

---

## Structure (4)

- [ ] `SKILL.md` exists and opens with valid `---`-delimited YAML frontmatter
- [ ] Frontmatter carries `name` and `description`; `name` is kebab-case and **matches the directory name** (see `skill-frontmatter.md` — the two runtimes disagree about which wins, so keeping them identical avoids the question)
- [ ] Body is present and substantial — a skill that is only frontmatter is a description, not a skill
- [ ] Every file referenced from SKILL.md actually exists, and references are **one level deep** (`references/x.md`, not `references/sub/x.md`). Nothing first-party catches a dangling reference link, so this box is load-bearing

## Description quality (5)

- [ ] **Capability-first**, not `This skill should be used when…` boilerplate. That opener burns the highest-signal tokens in the file on a constant string; lead with what the skill does
- [ ] A **deliverable clause** names the concrete artifact the skill produces or modifies
- [ ] At least one **"Do not use when…"** clause, and its exclusions share vocabulary with the positive claims — an obviously-irrelevant exclusion defends against nothing
- [ ] No universal-quantifier pushiness (`even if they don't…`, `whenever the user mentions…`, `always use this skill`). See `description-writing.md` for what that phrasing costs, measured
- [ ] **Under the 1,024-character cap**, measured rather than eyeballed — over it the tail is silently truncated and stops triggering. Past ~500, check that each clause is still buying something; `description-writing.md` has what to cut and what never to

## Content quality (9)

- [ ] Body explains *why* rather than issuing MUSTs and ALWAYSes; second person is fine
- [ ] SKILL.md is **under 500 lines and under 5,000 tokens** — check both; a 480-line file with dense paragraphs can still blow the token budget
- [ ] Detail that is not procedure or workflow has moved into `references/`
- [ ] Prescriptiveness is matched to fragility *per section* — a fragile sequence is spelled out and said to be exact, a genuine judgement call is explained rather than over-specified
- [ ] Where several approaches are valid, one is the stated default and the alternatives sit in a clause. A menu of equals hands the decision back
- [ ] A **gotchas section** exists if the domain has real gotchas, and it is in the body rather than behind a pointer — the model cannot open a file about a trap it does not know exists
- [ ] Bundled specimens and examples are complete and correct — an example that does not work teaches the wrong thing more confidently than no example
- [ ] Scripts run, and their usage is documented where the skill invokes them
- [ ] Any bundled script that runs for minutes reports progress to a status file, and the skill documents launching it detached — a long job that prints nothing is indistinguishable from a hung one

## Progressive disclosure (8)

- [ ] Core workflow and pointers in SKILL.md
- [ ] Every reference file over 100 lines opens with the standard table-of-contents block — a `## Table of Contents` heading, then flat anchor-link bullets naming each H2 in order — so a partial read still returns the file's map. Whole-specimen files (no H1, content is the artifact) are exempt; the form itself is specified in `../../shared/references/progressive-disclosure.md`
- [ ] `scripts/` holds only files the model is told to **run** — nothing in there is read into context
- [ ] `references/` holds files the model is told to **read**; `examples/`, if present, holds whole **specimens** of the skill's input or output
- [ ] `assets/` holds files **copied into the output** — templates, fonts, images, boilerplate
- [ ] **Every** bundled file is named somewhere in SKILL.md. An unreferenced file is invisible and its zero pull rate says nothing about its value
- [ ] Every pointer states the **condition** that should make you open the file, not just its path, and says what goes wrong if you skip it where that is not obvious
- [ ] Each reference answers its question completely, or says where the other half is. Two files always needed together are one file

Load mode decides placement, not file type. `progressive-disclosure.md` has the ordered decision rule, the hard cases, and the pointer-condition standard these two boxes check.

## Testing (6)

- [ ] Eval evidence is committed under `evals/results/iteration-<N>/`, fixture-repo copies excluded — a score whose run cannot be re-read is not evidence
- [ ] The skill triggers on the queries you expect it to
- [ ] It does **not** trigger on hard negatives: in-domain, multi-step queries whose deliverable is something else. Easy ones certify everything — that failure is measured in `description-writing.md`
- [ ] Every validator the skill ships is run in a loop — run, fix, run again — rather than once
- [ ] No information is duplicated across SKILL.md and a reference file; one copy will drift
- [ ] References load when needed rather than being pulled in unconditionally

---

Once this is clean, go run the loop in SKILL.md. The checklist told you the skill is well-formed; the benchmark tells you whether it helps.
