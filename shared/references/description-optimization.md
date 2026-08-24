# Running the description optimization loop

The mechanics. What makes a description *good* is `description-writing.md` —
read that first if you have not, because this loop can only pick between the
candidates you give it. This file is how to measure one against another and let
the numbers pick.

The loop applies to any artifact whose routing is a model judgement — a skill, a
subagent's delegation, a slash command. `--target-type` selects which.

## Table of Contents

- [Step 1: Generate the trigger eval queries](#step-1-generate-the-trigger-eval-queries)
- [Step 2: Review the set with the user](#step-2-review-the-set-with-the-user)
- [Step 3: Run the loop](#step-3-run-the-loop)
- [Reading the results](#reading-the-results)
- [Step 4: Apply the result](#step-4-apply-the-result)

## Step 1: Generate the trigger eval queries

Twenty queries, roughly half should-trigger and half should-not, shaped
`[{"query": "...", "should_trigger": true}, ...]`. Derive them rather than
inventing them:

```bash
bun ../operations/synthesize-scenarios.ts --target <skill-dir> --out evals/trigger-eval.json
```

The script reads what the artifact *does* — body, references, scripts, examples,
and for an agent its system prompt and tool grant — and deliberately not the
description you are about to optimize.

That exclusion is the whole design constraint rather than a detail. Queries
generated from the description under test inherit its vocabulary and framing, so
every candidate scores well on the cases its own text suggested and the loop
certifies the description against itself. Worse, a capability the description
omits entirely generates no queries at all, so the omission — the most valuable
thing the loop could have found — is never penalised.

Hard negatives — the should-not-trigger half — come from three places, because a
hard negative has to be genuinely tempting or the set certifies everything:

- the artifact's stated non-goals, phrased in the *positive* vocabulary
- the adjacent capability one step outside the boundary — the request a
  reasonable person would assume this handles, and it does not
- the co-installed neighbours `--with-environment` finds, which is the most
  realistic source available, since those are the skills actually competing for
  the query on the user's machine

The script prints a capability inventory before it generates anything. Put that
in front of the user: they correct a misread before it costs an iteration, and a
capability they confirm but the description never mentions is a finding in its
own right, surfaced before a single query has run.

Use `--inventory-only` when you want that conversation first and the queries
after.

### What a good query looks like

Whether the script wrote them or you did, the set is only as good as the queries,
and this is the standard to hold them to before Step 2 puts them in front of the
user. `../../skills/skill-creator/examples/trigger-eval-set.json` is a finished set built to it.

Make them things a real user would actually type: concrete and specific, with
file paths, personal context about the user's job or situation, column names and
values, company names, URLs, a little backstory. Some in lowercase, some with
abbreviations or typos or casual speech. Mixed lengths. Aim at edge cases rather
than clear-cut ones.

Bad: `"Format this data"`, `"Extract text from PDF"`, `"Create a chart"`

Good: `"ok so my boss just sent me this xlsx file (its in my downloads, called
something like 'Q4 sales final FINAL v2.xlsx') and she wants me to add a column
that shows the profit margin as a percentage. The revenue is in column C and
costs are in column D i think"`

**Should-trigger (8-10):** chase coverage. Different phrasings of the same
intent, formal and casual. Cases where the user never names the skill or the file
type but clearly needs it. Uncommon uses. Cases where this skill competes with
another and should win.

**Should-not-trigger (8-10):** hard negatives only, to the standard in
`description-writing.md`, section "Your trigger eval set decides whether any of
this is visible". Anything with an obvious one-step first action is wasted
budget — it never reaches the point where skill selection happens, so it scores
zero for every candidate and discriminates nothing.

## Step 2: Review the set with the user

Get it signed off before running anything. Read `../../skills/skill-creator/assets/eval_review.html`,
replace `__EVAL_DATA_PLACEHOLDER__` with the JSON array — unquoted, it is a JS
variable assignment — and `__SKILL_NAME_PLACEHOLDER__` and
`__SKILL_DESCRIPTION_PLACEHOLDER__` with the artifact's name and current
description. Write it somewhere temporary and open it.

The user edits and toggles entries, then clicks "Export Eval Set", which
downloads to `~/Downloads/eval_set.json`. Check for a newer duplicate like
`eval_set (1).json` — the browser will not overwrite.

## Step 3: Run the loop

Tell the user it takes a while and that you will check in periodically. Save the
eval set to `evals/`, then launch it detached rather than babysitting it — the
script opens its own dashboard, so `nohup ... &` is complete:

```bash
nohup bun ../operations/optimize-description.ts \
  --eval-set <path-to-trigger-eval.json> \
  --target-path <path-to-skill-or-agent> \
  --target-type skill \
  --model <model-id-powering-this-session> \
  --max-iterations 5 \
  --verbose > /dev/null 2>&1 &
```

Read `running-detached.md` once the job is launched and you are wondering whether
it is alive: it covers the dashboard, what each row's pid answers, and why a
report and a status file can disagree.

Use the model ID from your own system prompt, so the triggering test matches what
the user actually experiences rather than a cheaper proxy.

What it does: splits the set 60% train / 40% held-out, evaluates the current
description at 3 runs per query for a stable trigger rate, asks Claude to propose
improvements from what failed, and re-evaluates each candidate on both splits, up
to `--max-iterations`. It opens an HTML report and returns JSON containing
`best_description`, **selected on the held-out score rather than the train
score** — a description tuned until it aces its own training queries has usually
just memorized them.

The shape is a fan-out to independent workers and a barrier, once per candidate,
which is the part that is hard to hold in prose and matters for reading progress:
nothing is comparable until every attempt in a round has landed.

```mermaid
flowchart LR
  S[trigger eval set] --> T[train 60%]
  S --> H[held-out 40%]
  T --> B[candidate description]
  B --> W1[worker 1]
  B --> W2[worker 2]
  B --> Wn[worker n]
  W1 --> R{{barrier: every attempt landed}}
  W2 --> R
  Wn --> R
  R -->|from what failed| P[propose next candidate]
  P --> B
  R -->|same candidate| H
  H --> SEL[select on held-out score]
```

Each worker holds one QUERY and runs its attempts in sequence; `--num-workers`
sets how many queries are in flight. The barrier is why a per-query verdict shown
mid-round can still flip — the trigger rate is not decided until the last attempt
for that query arrives.

Attempts are siblings inside one worker rather than independent pool items so that
a query can stop early: once its remaining attempts cannot move the verdict, they
are not run. That is where roughly a third of a sweep's calls go, since most useful
queries score 0/3 or 3/3 and are settled by their first two attempts. Ranking is
unaffected — iterations are compared on pass COUNTS, not on mean trigger rate — but
the per-query rates in `results.json` become rates over attempts actually run, and
`--no-early-stop` restores full-N ones. The scheduling is coarser than an
attempt-level pool, so set `--num-workers` at or above the query count when you can;
below it, a slow query can extend the tail.

### Iterating on a slice

The loop above always runs the whole eval set, and that is right for the loop —
it selects between candidates, and a selection made on a hand-picked slice is a
selection made on whichever rows you happened to pick. But while you are editing
a description by hand and want to know whether the six rows that edit was about
moved, paying for the other forty-eight is what makes an edit expensive, and an
expensive edit is one nobody makes twice.

For that, run the measurement entry point on a named slice instead:

```bash
# by row index, as the rows are ordered in the eval set file
bun ../operations/measure-triggering.ts \
  --eval-set evals/trigger.json --target-path <path> --only 3,7,12

# by group, resolved through an annotation sidecar
bun ../operations/measure-triggering.ts \
  --eval-set evals/trigger.json --target-path <path> \
  --groups evals/trigger.groups.json --only group:gap-cost,group:gap-evidence
```

A sidecar is a JSON file with an `items` array of `{index, group}` rows joining
to the eval set by position — kept beside the set rather than inside it because
the eval-set schema warns once per unrecognized key per row, and fifty annotated
rows would print fifty benign warnings and bury a real one. Selectors compose,
resolve to rows in set order, and deduplicate. An unknown index or group is a
hard error listing what exists, never an empty run: a sweep of zero rows reports
0/0, which reads as a finished measurement.

**A slice iterates; it never records.** The run stamps itself: `results.json`
gains a `subset` block naming what ran and what was excluded, the terminal says
so before and after the sweep, and the dashboard row carries a not-of-record
chip. Those figures are real — the rows that ran, ran properly — but they are
over a different denominator from a full sweep, so quoting one against the other
reports a difference in *which rows ran* as a difference in *result*.

That rule is enforced rather than merely stated, which is worth knowing before
you try to work around it. `run.evalSetHash` in the envelope is computed over
the rows that ran rather than over the file, and `evalSetHash` is a
comparability key — so `compareRuns` refuses a delta between a subset and a full
sweep, and between two subsets that selected differently. Re-run the full set
before quoting anything.

### Target types

| `--target-type` | What counts as a trigger |
|---|---|
| `skill` (default) | the `Skill` tool, or a `Read` naming the skill |
| `agent` | the `Agent` tool invoked with a matching `subagent_type` |
| `command` | as `skill` |

The agent path installs the definition under a unique alias the same way the
skill path does, so no other artifact on the machine can absorb the match. The
alias is hyphen-suffixed rather than colon-scoped, because a subagent `name`
containing `:` is silently not loaded — a colon alias would install nothing and
score every query zero, which looks identical to a broken description.

## Reading the results

Claude only consults a skill for work it cannot easily handle alone, so a
one-step query like "read this PDF" may not trigger even when the description
matches perfectly. Simple queries make poor trigger queries in either direction.

What counts as a trigger is a consult at any point **before the first mutating
tool** — `Edit`, `Write` or `NotebookEdit`. Read-only reconnaissance beforehand
is expected rather than disqualifying: for a skill whose subject is a working
repository, the model often cannot tell whether the skill applies until it has
looked, so recon-then-consult is the same routing decision made a beat later with
more information. The first edit is the real negative signal — at that point the
model has committed to doing the job without consulting.

A description that is manually invoked only (`disable-model-invocation: true`)
has no description in context to optimize, so the loop does not apply. That is a
complete answer rather than a gap.

**Power the comparison on the tier that will route, and read a strong-tier null
as the predicted result rather than as a refutation.** Instruction Stacking
Collapse (arXiv 2608.02639) stacked verifier-checked instructions over three
current production tiers and measured a rewrite remedy that "recovers up to +11
points of follow rate for weaker models, which are also the models most often
deployed at scale, while leaving stronger models, which already internalise the
same structure, essentially unchanged" — with cluster-robust tests and
same-baseline controls attributing the gain to the rewrite rather than to token
count, reordering or measurement headroom (measured, external). Anthropic's own
tool-search testing reproduces the grading on a different remedy entirely: "Opus
4 improved from 49% to 74%, and Opus 4.5 improved from 79.5% to 88.1% with Tool
Search Tool enabled" — 25 points to the weaker model against 8.6 to the stronger
(internal testing, not externally reproducible). A candidate measured only on the
strong tier has measured almost nothing, and a null there is what a
capability-graded remedy is expected to produce.

**The cross-tier sweep is the identification instrument, and it wants one metric
per tier rather than one question per tier.** Anthropic prescribes the test —
"Test your Skill with all the models you plan to use it with" — but publishes it
as three different qualitative questions, one per model, and three impressions
cannot be subtracted (guidance, unquantified). Community tooling goes the other
way and makes the matrix the default output shape rather than a feature to
assemble: promptfoo takes `providers` as a list, and "Running promptfoo eval over
this config will result in a matrix view that you can use to evaluate GPT vs
Gemini" (shipped practice). This loop already has the shape the published
protocol lacks — the same trigger rate, both tiers, subtractable — so diff the
tiers rather than forming an impression of each.

## Step 4: Apply the result

Take `best_description`, update the frontmatter, show the user before and after,
and report both scores — the train score as well as the held-out one, since the
gap between them is the honest measure of how much the loop overfitted.
