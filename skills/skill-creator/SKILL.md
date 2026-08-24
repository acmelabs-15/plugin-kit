---
name: skill-creator
argument-hint: "[skill to build, or path to one to improve]"
allowed-tools: Read, Grep, Glob
license: MIT
compatibility: "Claude Code. Bundled scripts need Bun on PATH; the measured loops additionally need subagents and the claude CLI. claude.ai and Cowork run reduced forms of the loop — see ../../shared/references/environments.md."
metadata:
  component-type: skill
model: opus
# Keep description as ONE double-quoted line: a blank line in a block scalar silently truncates it.
description: "Use when the thing being built, fixed, or shipped is a Claude skill itself — a SKILL.md plus whatever references, scripts, or assets ride along with it. Covers the whole life of one: capturing a workflow into a first draft, editing or restructuring an existing skill, debugging frontmatter and packaging errors, bundling a skill into a portable .skill file to hand to someone, running evals and benchmarks to prove a change helped, and rewriting a description so Claude actually fires the skill on the phrasings real users type (or stops firing it on the wrong ones). Reach for this whenever a skill is the object being worked on rather than a tool being used. Not for building the neighbouring component types — subagents, hooks, MCP servers, slash commands, or a whole plugin — which have their own creators. Not for a read-only audit or rating of skills you aren't changing, and not for tasks that merely happen to invoke a skill along the way."
---

# Skill Creator

A skill for creating skills and iteratively improving them, with measurement rather than vibes as the evidence that a change helped.

The loop: decide what the skill should do; write a draft; write a few evals — realistic prompts with checkable expectations — and run claude-with-the-skill on them alongside a baseline; help the user judge the results qualitatively **and** quantitatively; rewrite from what they say and what the numbers show; repeat with a larger eval set; optionally tune the description for triggering, then package.

Work out where in that loop the user already is and jump in there. "I want a skill for X" starts at the top; an existing draft goes straight to evaluate-and-iterate; "skip the evals, just vibe with me" is a legitimate answer. The loop is a default, not a gate.

People arrive here with wildly different backgrounds — plumbers as well as staff engineers who will be annoyed if you explain what JSON is. Read the context cues: "evaluation" and "benchmark" are usually fine, while "JSON" and "expectation" want some signal the user knows those words, and a five-word gloss costs nothing.

## Gotchas

Facts that defy a reasonable guess. They are here rather than behind a pointer because you cannot decide to open a file about a trap you do not know exists.

- **`paths:` narrows activation, it does not add a trigger.** A skill carrying it fires only while a matching file is in play, so on an authoring skill — usually invoked with nothing relevant open — it suppresses most legitimate triggers.
- **Outside Claude Code an unpermitted frontmatter key is a hard error, not an ignored field.** Claude Code ignores unknown keys silently; claude.ai upload, the Skills API and the packager reject the skill and name the key. `model:` costs nothing locally and is fatal on the way out.
- **A description over 1,024 characters is silently truncated**, so its tail stops triggering anything and nothing warns you. Measure it; the validator does.
- **`name` disagreeing with the directory name is a live fork.** Claude Code invokes a personal or project skill by its *directory* name; the open standard's validator rejects the mismatch outright. Keep them identical and the question never arises.
- **`${CLAUDE_SKILL_DIR}` and dynamic context injection do nothing outside Claude Code** — no error, just an unsubstituted string. A body relying on them is Claude-Code-only however portable its frontmatter.
- **A subagent's completion notification is the only source of that run's token and duration figures.** They are in no transcript and no file. Capture them as each arrives (Step 3) or they are gone.

---

## Creating a skill

### Capture intent

The conversation may already contain the workflow the user wants captured — "turn this into a skill" usually means the transcript above is the spec. Mine it first: tools used, order of steps, corrections the user made, formats you saw. Then fill the gaps with them and confirm before moving on.

1. What should this skill let Claude do?
2. When should it trigger — what would the user actually be saying?
3. What is the expected output?
4. Should there be evals? Objectively checkable outputs (file transforms, data extraction, code generation, fixed workflows) benefit a lot; subjective ones (writing style, visual design) usually do not. Suggest the fitting default, let the user overrule it.

Settle edge cases, formats, example files, success criteria and dependencies *before* writing eval prompts — a prompt written against a misunderstanding wastes a whole iteration. Where research would help, run it in parallel via subagents.

### Write the SKILL.md

- **name** — kebab-case, matching the directory name.
- **description** — the highest-leverage field in the file and the one most often written wrong. The rule: match on the artifact the skill *produces*, not the topic it is *about*, and name at least one same-domain case it is not for. Read `../../shared/references/description-writing.md` before writing one or defending one you inherited — four criteria a reviewer applies, what a long description may spend characters on, and the measured cost of phrasings that feel like they fight under-triggering ("whenever the user mentions…") and demonstrably do not.
- **body** — instructions for another instance of Claude, written to explain rather than command.
- **any other frontmatter field** — read `references/skill-frontmatter.md` the moment you reach past `name` and `description`. It separates the six standardized fields from the Claude Code extensions and marks the three that *fail open*: ignored elsewhere, those remove a restriction rather than a nicety, which is how a skill keeps the appearance of a guardrail and none of the effect.

Structure follows load mode, not content genre: `scripts/` for files the agent runs, `references/` for files it reads, `assets/` for files it copies into output. Read `../../shared/references/progressive-disclosure.md` when you are placing a bundled file, or when the body crosses 500 lines or 5,000 tokens — ordered decision rule, the hard cases that actually cause misfiling (a runnable example, a fill-in template, sample data), and what to move when the body is over budget.

Anything in `scripts/` is Bun and TypeScript. Read `../../shared/references/pure-bun.md` before the first script, because what counts as pure is the surprising part: a `node:` builtin is Bun, and a spawned `python3` is a machine the user may not have. Read `../../shared/references/typescript-standard.md` when you add the first test.

### Writing style

Explain *why* something matters rather than issuing musty MUSTs. Given the reasoning, a model generalizes past the letter of an instruction to cases you did not anticipate; given only a rule, it follows the rule exactly as far as it goes and no further. Catching yourself writing ALWAYS or NEVER in caps, or building rigid structure around something that wants judgment, is a signal to reframe and explain instead.

Match how prescriptive you are to how fragile the step is, section by section rather than once for the file: where several approaches work, explain the purpose and leave the choice; where a sequence must hold or an operation breaks quietly, give it exactly and say that it is exact. Where options exist, pick a default and put the alternative in a clause — "use X; for the scanned-PDF case use Y instead" — since a menu of three equals hands back a decision you already made.

Put environment-specific gotchas in the body rather than behind a pointer, the one place the disclosure rule inverts, for the reason this skill's Gotchas section gives. Teach a procedure rather than one instance's answer, and keep the skill general rather than welded to your three examples.

Two patterns worth reaching for: an output format as a literal template the skill fills in, and a behaviour as an `Input:` / `Output:` pair. Both beat a paragraph describing them.

A skill's contents should not surprise a user who has read its description: no malware, no exploit code, nothing built for unauthorized access or exfiltration. "Roleplay as a pirate" is fine — the line is deception and harm, not whimsy.

### Pre-flight, run as a loop

Cheap checks before spending eval budget on a draft. Run it, fix what it reports, rerun — the fix is what introduces the next dangling reference, so one clean pass on the first draft says nothing about the fifth.

```bash
bun ../../shared/validate/validate.ts --target-type skill <skill-dir> --extended --with-environment
```

Frontmatter, body size, dangling references, and Bun purity where the skill ships scripts. `--extended` permits the Claude Code extensions a plugin-bundled skill carries; bare, it checks the six standardized fields alone, the right question only for a `.skill` bundle. `--with-environment` adds the collision check over the installed set; it refuses rather than reporting clean when it cannot read that set, and without the flag the report says so.

Before rewriting a description in response to a collision, read `../../shared/references/description-writing.md`, section "The honest limit": the failure lives in the pair rather than in either description, so editing your own is mostly not the fix.

Then run the `skill-creator:skill-reviewer` agent on the skill directory, and loop that too — fix, re-run, stop when it comes back clean or the remainder are findings you can defend out loud. It audits statically and never executes the skill, so it complements the measured loop below rather than replacing it: nothing static tells you whether the skill helps. Treat a failing verdict as gating the eval run, since every finding otherwise costs a full iteration to discover. Read `references/authoring-checklist.md` when you cannot run that agent — outside Claude Code, or when the user wants to see the audit rather than a verdict.

### Write the evals

An eval is one realistic prompt plus the expectations its output has to satisfy. Write 2-3 — what a real user would type, not an abstracted version — and show them to the user ("Here are a few cases I'd like to try. Do these look right?") before running anything. Save them to `evals/evals.json`, shaped `{skill_name, evals: [{id, prompt, expected_output, files, expectations}]}`.

Open `examples/evals.json` rather than inventing the shape from that sketch: a finished three-eval specimen, whose expectations are specific in the way yours should be. Reach for `../../shared/references/schemas.md` only when you need a field the specimen does not show.

Leave `expectations` empty for now — you will draft them while the runs are in flight, and expectations written after seeing a couple of transcripts are sharper anyway.

---

## Running and evaluating the evals

One continuous sequence — stopping partway leaves the user with runs and no way to look at them.

Results go in `evals/results/iteration-<N>/`, **inside the repository that holds the skill**, organized by iteration then by eval. Commit them — a number nobody can re-derive is not evidence. Read `../../shared/references/eval-evidence.md` before that first commit: what it tells you to leave out (fixture-repo copies, each carrying its own nested `.git`) is unpleasant to undo afterwards.

### Step 1: Spawn every run — with-skill and baseline — in the same turn

For each eval, spawn two subagents *in the same turn*. Running the with-skill half first and collecting baselines later makes the halves finish minutes apart and wastes wall-clock you could spend drafting expectations.

**With-skill run:**

```
Execute this task:
- Skill path: <path-to-skill>
- Task: <eval prompt>
- Input files: <eval files if any, or "none">
- Save outputs to: evals/results/iteration-<N>/<eval-name>/with_skill/outputs/
- Outputs to save: <what the user cares about — e.g. "the .docx file", "the final CSV">
```

**Baseline run** — the same prompt with a different or absent skill:

- **A new skill** → no skill at all, into `without_skill/outputs/`.
- **A skill the user arrived with** → that version, into `old_skill/outputs/`. Snapshot it *before* editing anything (`cp -r <skill-path> evals/results/skill-snapshot/`); once you have edited in place, the baseline is gone.
- **Your own earlier revision** → the previous iteration's skill, same `old_skill/` layout, when the question is "did this change help" rather than "does the skill help at all".

Keep whichever baseline you pick fixed across iterations, so the numbers stay comparable.

Write an `eval_metadata.json` per eval — `{"eval_id": 0, "eval_name": "descriptive-name-here", "prompt": "…", "expectations": []}`. Name each eval for what it tests rather than `eval-0` and use that name for its directory too, since `eval_name` is what the viewer prints as each section header. New or modified prompts need new files; they do not carry over between iterations.

### Step 2: While the runs are in flight, draft the expectations

Do not idle. Draft the quantitative expectations for each eval and explain them to the user; if `evals/evals.json` already has some, review and explain those. A good expectation is objectively verifiable and worded so it reads clearly in the viewer — someone glancing at the results should understand what it checks without asking. Leave subjective qualities to the human review; an expectation forced onto something that needs judgment produces a number that means nothing.

Write them into `evals/evals.json` and into each `eval_metadata.json`, under the key `expectations` in both — the second copy is a hand-off to the grader that nothing machine-reads, while the one read by name is the grader's output, `grading.json.expectations`. Then tell the user what they are about to see: qualitative outputs in one tab, the quantitative benchmark in the other.

### Step 3: As each run completes, capture its timing immediately

As each completion notification arrives — not batched afterwards, see Gotchas — write that run's `timing.json`:

```json
{"total_tokens": 84852, "duration_ms": 23332, "total_duration_seconds": 23.3}
```

### Step 4: Grade, aggregate, analyze, then put it in front of the human

1. **Grade each run.** Spawn a grader subagent whose prompt tells it to read `../../shared/references/grader.md` first — that file *is* the grader's instructions, and read it yourself if you are grading inline. It writes `grading.json` into the run directory, whose `expectations` array must use exactly `text`, `passed` and `evidence` — the viewer reads those names literally and shows blanks for anything else. Where an expectation is checkable by code, write a script rather than eyeballing it.

2. **Aggregate**, from the skill's directory:

   ```bash
   bun ../../shared/operations/aggregate-results.ts evals/results/iteration-N --skill-name <name>
   ```

   This writes `benchmark.json` and `benchmark.md` with pass rate, time and tokens per configuration, each as mean ± stddev plus the delta from the configuration under test, so a positive delta means the skill helped. It exits non-zero when nothing was graded. If you ever build `benchmark.json` by hand, read `../../shared/references/schemas.md` first: the viewer matches field names literally and renders zeros rather than erroring, so `config` for `configuration` gives a clean, wrong report.

3. **Do an analyst pass.** Read `../../shared/references/benchmark-notes.md` before writing the notes: it is what the pass looks for — expectations that pass regardless of the skill and so measure nothing, high-variance evals that may be flaky, time-versus-token tradeoffs. Without it, notes tend to restate aggregates the user can already see.

4. **Launch the viewer.**

   ```bash
   nohup bun ../../shared/report/generate-review.ts evals/results/iteration-N \
     --skill-name "my-skill" --benchmark evals/results/iteration-N/benchmark.json \
     > /dev/null 2>&1 &
   ```

   From iteration 2, add `--previous-workspace evals/results/iteration-<N-1>`; with no display, `--static <output_path>` writes a standalone HTML file instead of serving one. Use `generate-review.ts` rather than custom HTML, so every iteration looks the same.

   **Do this before forming your own opinion of the outputs.** You wrote the skill; you will read its outputs generously, and getting them in front of the human first is what keeps the loop honest.

5. **Tell the user** what they are looking at: "I've opened the results in your browser — 'Outputs' to click through each case and leave feedback, 'Benchmark' for the quantitative comparison. Come back here when you're done." "Submit All Reviews" writes `feedback.json`.

### Step 5: Read the feedback

`feedback.json` holds a `reviews` array of `{run_id, feedback, timestamp}`. Empty feedback means the case was fine; concentrate on where the user said something specific. When a review looks missing, `../../shared/references/schemas.md` has how `run_id` is composed, which is usually the answer.

Then stop the viewer with `pkill -f generate-review.ts` rather than `kill $VIEWER_PID` — a shell variable set in an earlier call is gone, so `kill` would run bare. Either this or Ctrl-C records the run as `done` rather than failed, since a deliberate shutdown is not a failure.

---

## Improving the skill

The heart of the loop, and where most of the value is created.

1. **Generalize from the feedback.** The skill will be used across prompts you will never see; you iterate on three because that is fast, not because those three are the target, and a change that fixes exactly those three is worthless. When an issue proves stubborn, resist the fiddly overfitted patch and the oppressive MUST — try a different metaphor, or a different working pattern altogether.

2. **Keep it lean.** Cut what is not pulling its weight. Read the transcripts, not only the outputs: if the skill is sending the model down unproductive paths, delete the part causing that and see what happens.

3. **Explain the why.** Even when the feedback is terse or exasperated, work out what the user actually wants and why, then transmit *that* rather than the surface correction. A model that understands the goal handles the case you did not write down.

4. **Look for repeated work across evals.** If all three subagents independently wrote their own chart builder, the skill should bundle it — write it once into `scripts/` so future invocations stop reinventing it.

Thinking is not the bottleneck — draft a revision, then look at it fresh and improve it again.

**The iteration loop:** apply the improvements, rerun every eval into `iteration-<N+1>/` including baselines, launch the viewer with `--previous-workspace`, wait for review, read the new feedback, improve again. Stop when the user is happy, when the feedback comes back empty, or when you stop making meaningful progress.

When the question narrows to "is the new version better?" and the human review cannot settle it, there is a stricter option most users will not need: `../../shared/references/blind-comparison.md` is a subagent prompt for judging two outputs without being told which skill produced which, and `../../shared/references/comparison-analysis.md` turns that verdict into changes to make. Hand each subagent only its own file — the second reads the first's output shape, and also names which side is which, which is the one thing the first must not see.

---

## Description optimization

The description decides whether Claude ever invokes the skill, so optimize it separately once the skill itself is good — a different question from whether the skill works, and mixing the two makes both harder to read.

Read `../../shared/references/description-writing.md` first if you have not already; candidates proposed without it are variations on one defect. Then read `../../shared/references/description-optimization.md` *before* generating the trigger queries, because its first step is where the trap is: a query set derived from the description you are about to change certifies that description against itself. Open `examples/trigger-eval-set.json` when judging whether your hard negatives are hard enough.

Read `../../shared/references/running-detached.md` before launching this loop or the disclosure loop below. Both run for tens of minutes; it covers detaching them, the dashboard, and why lowering `--timeout` to go faster corrupts the result rather than speeding it up.

The same loop measures a subagent's delegation (`--target-type agent`) and a slash command, so the sibling creator skills share it rather than each inventing one.

---

## Progressive disclosure optimization

Description optimization decides whether the skill is reached. This decides what it costs once it is, and it is the same shape of loop: measure, propose, re-measure, select on a held-out split. The evidence is the **pull rate** — how often each bundled file was actually read — with expectation pass rate alongside as the guardrail, since a restructure that cuts tokens and breaks the work is a regression rather than an optimization.

```bash
bun ../../shared/operations/optimize-disclosure.ts --skill-path <skill-dir> --scenarios evals/evals.json
```

Read `../../shared/references/disclosure-optimization.md` when the run finishes and you are deciding what to adopt: it has the verdict table the report prints against, where *prune* and *signpost* look identical in the data and need opposite fixes. Read `../../shared/references/progressive-disclosure.md` instead when you are doing this by judgement — it is the doctrine the script automates, including why a pointer without a condition is the usual reason a file goes unread.

---

## Shipping, packaging and other environments

Four questions that arrive at the end and are much cheaper answered at the start.

- **Does it have to run outside Claude Code?** Read `../../shared/references/distribution-targets.md` while you are still deciding where files go. Its surface-by-surface matrix is what stops a body being written around features that silently do nothing elsewhere, and it explains the trap underneath most of them: Cowork loads what is enabled on the claude.ai account, the Desktop Code tab reads `~/.claude`, and neither sees the other.
- **Is it a standalone skill to hand over?** Package it and point the user at the resulting `.skill` path — only where the `present_files` tool exists to deliver it, since otherwise there is nowhere for the file to go.

  ```bash
  bun ../../shared/tools/package-skill.ts <path/to/skill-directory>
  ```

  The packager refuses a skill carrying `model` or another extension, and `--extended` produces a bundle Claude Code installs and the other two reject. Read `references/skill-frontmatter.md` when the user wants one bundle that goes everywhere: the way out is `metadata:`, not the flag.
- **Does it live inside a plugin?** Then it needs no packaging. Read `../../shared/references/plugin-skills.md` before moving files around — two layout invariants there fail silently, and `claude plugin validate` passes a plugin whose components sit in the wrong place.
- **Are you outside Claude Code, or editing a skill that is already installed?** Read `../../shared/references/environments.md` before Step 1, not at the point it bites: claude.ai has no subagents and Cowork no display, and the adaptation changes how runs are spawned. It also carries the three rules that keep an update an update — preserve the name, copy somewhere writeable first, snapshot before the first change — rather than leaving the user with two skills.

---

Put the loop's steps on your todo list if you have one. The step most often dropped is generating the viewer, and dropping it turns a measured loop back into guesswork.
