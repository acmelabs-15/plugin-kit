# Optimizing progressive disclosure by measurement

Read this when a disclosure run has finished and you are deciding what to adopt, or before starting one to know what it will cost. For the doctrine underneath it — which directory a file belongs in, the body's size budget, and the pointer-condition standard — that is `progressive-disclosure.md`, and it is the better read when you are doing this by judgement rather than by measurement. What doctrine cannot tell you is *which* content should move, because that depends on what the skill is actually asked to do.

`../scripts/optimize-disclosure.ts` answers that by measuring it. It runs the skill on real evals, watches which bundled files get read and how often, counts what each run costs, and restructures the layout to cut the cost — with the expectation pass rate as the thing a restructure is not allowed to break.

```bash
bun ../scripts/optimize-disclosure.ts \
  --skill-path ../my-skill \
  --scenarios ../my-skill/evals/evals.json \
  --model opus \
  --results-dir ../my-skill/evals/results/disclosure
```

`--scenarios` is spelled that way on the command line but takes the `evals.json` you already have — `{skill_name, evals: [{id, prompt, expectations}]}` — or a bare array of the same rows; scenario and eval are the same thing here. Those `expectations` are the guardrail, and a set with none leaves the loop free to strip the skill to nothing and call it an improvement, which is why the run warns loudly when it finds none.

---

## What one run measures

| Quantity | Where it comes from | Why it matters |
|---|---|---|
| **Body tokens** | The SKILL.md body, tokenized | The bill every invocation pays, whether or not it needs the content |
| **Which bundled files were read** | `Read` tool calls whose path lands inside the skill directory | The evidence for whether deferral is working |
| **Total context tokens** | The `result` event's `usage` block | What the whole run cost, deferral included |
| **Expectation pass rate** | A grader pass over the transcript and any files produced | The guardrail — a cheaper skill that stopped working is a regression |

The grader runs on `--grader-model`, which defaults to `sonnet` and deliberately does **not** inherit `--model`. Grading is one single-turn call with the transcript and the produced files already in the prompt, judged against an explicit list — there is nothing to plan and no tool to call. It matters for wall clock because the grading call is serial with the scenario inside the same worker slot, so a run on `--model opus` used to wait on the heavy model twice; measured over two attempts each, opus averaged 13.1s against sonnet's 11.0s.

The obvious move — grade on the cheapest model — was measured and rejected. Against a run whose own final response admitted it had left a pointer without a load condition, `haiku` returned `passed: true` twice while `sonnet` and `opus` returned `passed: false` twice, and haiku was not even faster (11.8s). A grader that fails open is worse than a slow one, because this is the guardrail deciding whether a restructure broke the skill.

The guardrail also depends on the grader being *held constant*: a candidate's pass rate is judged against a baseline graded by the same model, so a stricter or slacker grader moves both numbers and not the gap between them. Change it with `--grader-model`, not with `--model`, and change it between runs rather than within one.

Token figures come from `tiktoken` where it is installed. It is a devDependency of this repository rather than a runtime one, because a skill's scripts run with nothing but Bun; when it is absent the loop falls back to the published characters-over-four estimator and says so on every surface — in the terminal, in `results.json`, and at the top of the report. A body measured at 4,800 estimated tokens against a 5,000-token budget has not been shown to be inside it.

Invocation is held constant. The prompt names the skill outright rather than relying on the description to route to it, because whether the description triggers is what `../scripts/optimize-description.ts` measures. Holding it fixed here is what makes these numbers about the layout instead of about routing.

---

## The decision rule

The rule falls out of the pull rate rather than out of taste. Load mode is checked first, and that is not a formality — a `scripts/` file has a pull rate of zero when everything is working, because its text is never supposed to enter context at all.

| Verdict | Condition | The fix |
|---|---|---|
| **inline** | A `references/` or `examples/` file pulled on ≥ 80% of runs | It is body content paying an extra tool call to arrive late. Splice it into the body. |
| **prune** | Pulled on no run, and the body points straight at it | The pointer works and nothing needs the file. Deleting it is a hypothesis the loop tests. |
| **signpost** | Pulled on no run, and nothing in the body names it | It could never have loaded, so its zero says nothing about its value yet. |
| **misfiled** | An `execute`- or `copy`-mode file that *was* read | Either the body asks for the wrong verb, or the file is in the wrong directory. |
| **keep** | Anything in between | Genuinely conditional content, which is what deferral is for. |

The split between **prune** and **signpost** is the part worth dwelling on. Both look identical in the data — a file nobody read — and they need opposite fixes. So the loop checks whether the body points at the file before it proposes anything, and only proposes deletion for one of them. The other is reported as a finding rather than acted on, because where a pointer belongs in a body is an editorial decision; a sentence bolted onto the end would measure the wrong thing and then get rejected for costing tokens.

### The other direction: pushing a body section out

A body section needed on a minority of runs is taxing every invocation that does not need it. That one cannot be read straight off the stream — the body arrives whole, so nothing distinguishes the section a run used from the one it skipped past. The loop asks a model which sections are minority-use, given the body, the scenarios and the measured pull rates, and treats the answer as a **hypothesis rather than a verdict**.

What makes it a measurement is what happens on the next iteration. A section pushed out becomes a bundled file with a pull rate of its own. If that rate comes back near one, the mechanical rule above says to inline it again — so a bad extraction is caught by the same arithmetic that would have caught a bad reference. The loop corrects its own proposals, which is why the model step is allowed to be a proposal at all.

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

**What actually got read** — one row per bundled file, with its load mode, its cost if read, its pull rate as a bar, whether the body points at it, and its verdict. Read the *signposted* column before reacting to a zero: a file the body never names could not have loaded, and its zero is about the pointer rather than the file.

**Body tokens against the guardrail** — one row per layout measured, baseline first. The body-token bar shows the trend; the pass-rate bar beside it is the guardrail at each step. Rejected candidates stay in the table, greyed, with the reason they lost. Selection reads the held-out column only, so a candidate that looks good on train and lost on held-out is showing you an overfit that the split caught.

**Before adopting this layout** appears above the file table when the rewrite hit something it could not decide alone. The rewrite works on paragraphs rather than lines, because a pointer sentence is routinely wrapped and deleting the line that happens to hold the path leaves the rest of the clause dangling. The case it cannot resolve is a sentence that points at two files — deleting it to remove one takes the pointer to the other with it, and that loss is silent, where a dangling reference is loud: `../scripts/validate.ts` and the skill-reviewer agent both flag one. So the sentence stays, and the note tells you to rewrite it.

The winning layout is written to `--apply <dir>`, or to `<results-dir>/best-layout/` when you gave one. **The source skill is never modified**, on any path — adopting the result stays a diff someone reads rather than something that already happened while they watched a progress bar.

---

## What the measurement cannot see

Worth knowing before you act on a zero.

- **A pull is a `Read` tool call.** A file opened another way — piped through a shell command, globbed and concatenated — is invisible here and reads as never pulled.
- **Scripts are counted by whether they were read, not whether they ran.** A `scripts/` file's execution is correct behaviour and shows as a zero pull rate, which is why load mode is checked before the pull rate rather than after.
- **Grading reads the transcript and the head of up to three files the run produced.** An expectation about something further inside a large artifact is judged on a truncated view.
- **Pull rates are only as stable as the run count.** Two runs per scenario is the smallest number that can distinguish "always" from "sometimes"; when verdicts flip between iterations, that is the symptom of too little evidence rather than of an unstable skill.

---

## Cost

One baseline sweep, then `(--max-iterations - 1) × --max-candidates` more, each of `scenarios × --runs-per-scenario` runs — and every run does the skill's real work rather than answering a routing question. With the defaults and five scenarios that is seventy runs plus their grading calls, **worst case**.

Usually less, because a candidate is measured on the train scenarios first and only reaches the held-out scenarios if it is still in contention there — it has to at least tie the incumbent on context cost and stay inside `--pass-rate-tolerance` on pass rate. At the default `--holdout 0.4` a candidate that loses on train costs three fifths of a sweep instead of a whole one. The report shows those rows with an em dash in the held-out column and the gate's reason beside them, which is how you tell "measured and rejected" from "never measured".

This is a filter rather than a change to the selection rule: selection still happens on the held-out split, and a candidate the gate retires is simply never eligible. What it gives up is the candidate that regresses on train and would have reversed on the held-out split — a layout that costs more on the scenarios it was proposed from and then wins on a smaller split is describing sampling noise, and it is not worth two fifths of the budget to keep looking for it.

That cost is why `--max-iterations` defaults to 3 where the description loop defaults to 5. An iteration there scores one candidate description; an iteration here materializes and scores up to three whole layouts. Three iterations is already nine full measurement passes, which is about as much wall clock as a restructure is worth before a human looks at the result.

Scenarios that write files need `--permission-mode acceptEdits`. It is left off by default because applying a permission mode to someone's machine is their call, not a default this script makes quietly.
