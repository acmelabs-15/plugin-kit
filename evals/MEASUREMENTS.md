# Measured results

Run 2026-08-08 against this repository, using the plugin's own harness on itself.
Everything here is an executed measurement. Where a number is soft, it says so.

## Method

Trigger queries were synthesized per skill with
`scripts/synthesize-scenarios.ts`, which reads the artifact's body, references,
scripts and examples and deliberately **not** the description under test — 20
queries each, 10 should-fire and 10 hard negatives, 120 in total.

Each query ran through `scripts/measure-triggering.ts` at 2 runs per query. A trigger is a
consult before the first mutating tool. 2 runs per query is fewer than the
harness default of 3, chosen to fit the wall clock; the noise that buys is
quantified below rather than ignored.

Disclosure was measured with `scripts/optimize-disclosure.ts --max-iterations 1`
— the baseline sweep only — over 5 hand-authored task scenarios per skill, one
run each. That answers "which bundled files actually get read" without paying for
the restructure loop.

## Triggering

| Skill | Start | After loop | Final | Fires when it should | Stays quiet when it should |
|---|---|---|---|---|---|
| skill-creator | 11/20 | 16/20 | **16/20** | 1/10 → 6/10 | 10/10 → 10/10 |
| agent-creator | 13/20 | 13/20 | **20/20** | 3/10 → 10/10 | 10/10 → 10/10 |
| hook-creator | 16/20 | 17/20 | **17/20** | 9/10 → 10/10 | 7/10 → 7/10 |
| mcp-creator | 15/20 | 19/20 | **19/20** | 6/10 → 9/10 | 9/10 → 10/10 |
| command-creator | 11/20 | 14/20 | **17/20** | 3/10 → 10/10 | 8/10 → 7/10 |
| create-plugin | 10/20 | 11/20 | **18/20** | 1/10 → 9/10 | 9/10 → 9/10 |
| **Total** | **76/120** | **90/120** | **107/120** | 23/60 → 54/60 | 53/60 → 53/60 |

63% → 89%.

### What the starting numbers showed

The failure was entirely on the positive side. Negatives were near-perfect from
the start (53/60) and did not move. Positives began at 23/60, and two skills fired
on **one query out of ten** that should have routed to them.

The cause was a design decision made without measuring it: every description had
been written to enumerate all five siblings in "Do not use when…" clauses, so the
partition between them would be explicit. Measured, that trade is bad. Half of
each description was spent saying what it was not, the positive clause was
starved, and the skills stopped firing. Exclusion was never the problem.

The corroborating detail: `hook-creator` scored best on positives at the start
(9/10) and had the most concrete positive vocabulary — "adding one, deciding
whether it should block, or fixing a hook that never fires or fires on
everything."

### Loop-authored versus hand-authored

`scripts/optimize-description.ts` ran on all six at 2 iterations, 60/40 split, selecting on
held-out. It produced a winner for three (`skill-creator`, `hook-creator`,
`mcp-creator`) and for the other three refused its own candidates because
held-out did not back up the training score. `create-plugin`'s iteration-2
candidate scored 11/12 on train and still lost — held-out selection working
exactly as designed.

The three the loop could not improve were then rewritten by hand **from the loop's
own failure list**, and those three scored higher than the loop's winners:
agent-creator 20/20, create-plugin 18/20, command-creator 17/20.

That is worth recording honestly: at 2 iterations the loop's largest contribution
was not the descriptions it wrote but the per-query failure data it produced.
Every hand-written gain came from reading which specific queries missed and
noticing they named capabilities the description never mentioned. A longer run
might close that gap; this one did not test that.

### The noise floor

Three skills kept an unchanged description between the first and second full
sweep, which makes them an accidental control group: agent-creator moved 0,
create-plugin +1, command-creator +3. So run-to-run noise at 2 runs per query is
roughly ±3 on a 20-query set.

Against that floor, the gains that are clearly real are skill-creator (+5),
mcp-creator (+4), agent-creator (+7), create-plugin (+8) and command-creator
(+6). hook-creator's +1 is inside the noise and should not be claimed.

### What is still wrong

Six false fires survive, and three of them are genuinely arguable rather than
defects:

- hook-creator fires on *"block anyone from ever running rm -rf, no exceptions"* —
  a permission deny rule is the better answer, but a hook does work.
- hook-creator fires on *"SessionStart hook so Claude Code on the web can run our
  tests at session start"* — a differently-named skill owns that in this
  environment.
- command-creator fires on *"set up /morning so it runs every weekday"* — a
  `/morning` skill is installed here, so this is neighbour collision rather than a
  description defect. `check-overlap.ts` reports the same pair.

The remainder are real: command-creator still fires on a command that has outgrown
its layout and should become a skill, which its own description says to skip.

## Progressive disclosure

Baseline sweep, 5 task scenarios per skill, one run each. Pull rate is the
fraction of scenario runs that actually read the file.

| Skill | Body tokens | Context/run | Task pass rate | References pulled |
|---|---|---|---|---|
| skill-creator | 4,973 | 837k | 40% (2/5) | **6 of 19** |
| agent-creator | 4,988 | 504k | 100% (5/5) | 3 of 3 |
| hook-creator | 4,929 | 814k | 60% (3/5) | 6 of 7 |
| mcp-creator | 4,808 | 449k | 100% (5/5) | 4 of 4 |
| command-creator | 4,989 | 582k | 80% (4/5) | 5 of 5 |
| create-plugin | 4,828 | 338k | 80% (4/5) | 2 of 2 |

### The five smaller skills are clean

Every reference in `agent-creator`, `mcp-creator`, `command-creator` and
`create-plugin` was pulled at least once, and `hook-creator` missed only
`tidy-edit.ts`, an example handler. Nothing is sitting there never being loaded.

### skill-creator is the outlier, and it is the flagship

> **Note on file names.** These runs predate a naming pass. `analyzer.md` was split into
> `benchmark-notes.md` and `comparison-analysis.md`; `comparator.md` became
> `blind-comparison.md`; and the three `frontmatter.md` files became `skill-frontmatter.md`,
> `agent-frontmatter.md` and `command-frontmatter.md`. The names below are left as measured,
> because editing a record to match a later rename is how a measurement stops being evidence.

Thirteen of nineteen references were never opened across five realistic
scenarios. It also has the worst task pass rate (40%) and the highest context cost
per run (837k tokens).

Pulled: `description-writing.md` 2/5, and `eval-evidence.md`, `frontmatter.md`,
`progressive-disclosure.md`, `pure-bun.md`, `typescript-standard.md` at 1/5 each.

Never pulled: `analyzer.md`, `authoring-checklist.md`, `comparator.md`,
`description-optimization.md`, `disclosure-optimization.md`,
`distribution-targets.md`, `environments.md`, `grader.md`, `plugin-skills.md`,
`running-detached.md`, `schemas.md`, and both files in `examples/`.

**The honest caveat.** Several of those only fire during an executed eval —
`grader.md`, `comparator.md`, `analyzer.md`, `running-detached.md`, `schemas.md`.
The five scenarios described wanting evals but no run completed a full eval loop
inside its budget, so those zeros measure scenario coverage as much as they
measure the references. Testing them properly needs scenarios that run the loop
end to end, which costs an order of magnitude more.

The zeros that are **not** explained away are `distribution-targets.md` (4,112
tokens), `environments.md`, `plugin-skills.md` and `authoring-checklist.md`. None
of those needs an eval to fire, and none of them fired.

### The finding the tool could not act on

Six references came back at or above the 0.8 inline threshold — agent-creator's
`delegation.md`, `frontmatter.md` and `flake-triage.md` at 4/5, mcp-creator's
`server-entry.md` at 4/5, command-creator's `review-pr.md` and
`load-time-injection.md` at 4/4. The decision rule says inline them: a reference
read on nearly every run is body content paying an extra tool call to arrive late.

None of them can be inlined. Every body sits at 4,808–4,989 tokens against a
5,000-token ceiling, so there is no room. The rule and the budget are in direct
conflict here and the tool does not model that. Resolving it means either
extracting something else in the same edit or accepting the extra tool call
deliberately — and `optimize-disclosure.ts` should say so rather than emitting a
verdict that cannot be applied.

## Reproducing

```bash
bun shared/scripts/synthesize-scenarios.ts --target skills/<name> \
  --out evals/trigger/<name>.json --count 20

bun shared/scripts/measure-triggering.ts --eval-set evals/trigger/<name>.json \
  --target-path skills/<name> --runs-per-query 2 --num-workers 6 --no-early-stop

bun shared/scripts/optimize-description.ts --eval-set evals/trigger/<name>.json \
  --target-path skills/<name> --model opus --max-iterations 2 --holdout 0.4

bun shared/scripts/optimize-disclosure.ts --skill-path skills/<name> \
  --scenarios evals/disclosure/<name>.json --model opus --max-iterations 1
```

Raw output is under `evals/results/{baseline,optimize,after,final,disclosure}/`,
the synthesized query sets under `evals/trigger/`, and the disclosure task
scenarios under `evals/disclosure/`.

`--no-early-stop` on the first command is deliberate and is the reason it is the
slowest of the four relative to its size. By default a query stops as soon as its
verdict can no longer change, which leaves every pass and fail identical but makes
`trigger_rate` a rate over the attempts actually run — at `--runs-per-query 2` a
query that triggers first time reports 1/1 rather than 2/2. The rates in this file
are compared against each other across runs, so they all have to share a
denominator. The `optimize-description.ts` and `optimize-disclosure.ts` lines want the default:
both rank on counts rather than on mean rates.
