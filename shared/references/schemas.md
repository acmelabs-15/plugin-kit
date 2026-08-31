# JSON schemas

Every JSON structure the scripts, the viewer and the subagents read or write. This is a lookup file rather than a read-through one: open it when you are hand-writing or repairing one of these files, or when a report renders blank and you need to know which name it was matching on. Jump to the section named after the file — `evals.json`, `eval_metadata.json`, `grading.json`, `metrics.json`, `timing.json`, `benchmark.json`, `comparison.json`, `analysis.json`, `feedback.json`, description-optimization outputs, disclosure outputs, `envelope.json`, run status files.

Field names are literal. The viewer in particular matches them exactly and renders empty or zero values for anything it does not recognize, without erroring — so a typo here shows up as a silently blank report rather than a crash. That is the failure this file exists to prevent, and it is why "it produced no error" is not evidence a hand-built file is right.

Exactly one structure here is machine-checked rather than trusted: `envelope.json` is refused at the moment it is written if a required field is missing. Everything else on this page is a convention, and a convention is only as good as the reader who remembers it.

## Table of Contents

- [evals.json](#evalsjson)
- [eval_metadata.json](#eval_metadatajson)
- [grading.json](#gradingjson)
- [metrics.json](#metricsjson)
- [timing.json](#timingjson)
- [benchmark.json](#benchmarkjson)
- [comparison.json](#comparisonjson)
- [analysis.json](#analysisjson)
- [feedback.json](#feedbackjson)
- [Description-optimization outputs](#description-optimization-outputs)
- [Disclosure outputs](#disclosure-outputs)
- [envelope.json — the results envelope](#envelopejson--the-results-envelope)
- [Run status files](#run-status-files)
- [history.json — documented but unused](#historyjson--documented-but-unused)

---

## evals.json

The evals for a skill. Located at `evals/evals.json` inside the skill directory.

```json
{
  "skill_name": "example-skill",
  "evals": [
    {
      "id": 1,
      "prompt": "User's example prompt",
      "expected_output": "Description of expected result",
      "files": ["evals/files/sample1.pdf"],
      "expectations": [
        "The output includes X",
        "The skill used script Y"
      ]
    }
  ]
}
```

- `skill_name` — matches the skill's frontmatter `name`
- `evals[].id` — unique integer
- `evals[].prompt` — the task to execute
- `evals[].expected_output` — human-readable description of success
- `evals[].files` — optional input file paths, relative to the skill root
- `evals[].expects_references` — optional, skill-relative paths this scenario SHOULD send the model to. In live use rather than merely recognized by the reader: one annotated corpus, the `ask-user-question` disclosure evals, populates it today, so a set carrying this key is a set the figures below are already computed over. Read by both `measure-disclosure.ts` and `optimize-disclosure.ts` to report RECALL: of the scenarios that ought to have reached a reference, how many did. A pull rate alone cannot answer that, because a reference only three scenarios need shows a low rate however good its pointer is, which is indistinguishable in the data from a pointer nobody follows. An **empty array is meaningful** and is the negative case — this scenario should reach nothing — without which a layout that pulled every file on every run would score perfectly. Omit the key entirely to declare no ground truth for that scenario. Absent and empty are **not** interchangeable: an omitted key keeps the row out of every denominator, an empty array puts it into the over-fetch denominator, and a reader that collapses the two turns every unannotated scenario into a negative case and makes recall look perfect. What the two figures come out as is under "Disclosure outputs" below
- `evals[].expectations` — verifiable statements; added after the first runs are in flight, not when the file is created

---

## eval_metadata.json

Per-eval metadata. Located at `evals/results/iteration-N/<eval-dir>/eval_metadata.json`.

```json
{
  "eval_id": 0,
  "eval_name": "descriptive-name-here",
  "prompt": "The user's task prompt",
  "expectations": []
}
```

- `eval_name` — a description of what this eval tests. It becomes the section header in the viewer, so `handles-multi-page-input` reads far better than `eval-0`. Use the same string for the directory name.
- `expectations` — may be empty when the file is first written; filled in during Step 2. `aggregate-results.ts` reads `eval_id` and `eval_name` from this file and nothing else, so this key is a hand-off to whoever grades rather than a contract. Older result trees spell it `assertions`; both are inert, and one spelling across `evals.json`, here and `grading.json` is worth more than compatibility with a field nothing reads

Written per eval directory, per iteration. New or modified prompts need new files; they do not carry over between iterations.

---

## grading.json

Output from the grading pass (`grader.md`). Located at `<run-dir>/grading.json`.

```json
{
  "expectations": [
    {
      "text": "The output includes the name 'John Smith'",
      "passed": true,
      "evidence": "Found in transcript Step 3: 'Extracted names: John Smith, Sarah Johnson'"
    },
    {
      "text": "The spreadsheet has a SUM formula in cell B10",
      "passed": false,
      "evidence": "No spreadsheet was created. The output was a text file."
    }
  ],
  "summary": {
    "passed": 2,
    "failed": 1,
    "total": 3,
    "pass_rate": 0.67
  },
  "execution_metrics": {
    "tool_calls": {
      "Read": 5,
      "Write": 2,
      "Bash": 8
    },
    "total_tool_calls": 15,
    "total_steps": 6,
    "errors_encountered": 0,
    "output_chars": 12450,
    "transcript_chars": 3200
  },
  "timing": {
    "executor_duration_seconds": 165.0,
    "grader_duration_seconds": 26.0,
    "total_duration_seconds": 191.0
  },
  "claims": [
    {
      "claim": "The form has 12 fillable fields",
      "type": "factual",
      "verified": true,
      "evidence": "Counted 12 fields in field_info.json"
    }
  ],
  "user_notes_summary": {
    "uncertainties": ["Used 2023 data, may be stale"],
    "needs_review": [],
    "workarounds": ["Fell back to text overlay for non-fillable fields"]
  },
  "eval_feedback": {
    "suggestions": [
      {
        "expectation": "The output includes the name 'John Smith'",
        "reason": "A hallucinated document that mentions the name would also pass"
      }
    ],
    "overall": "Expectations check presence but not correctness."
  }
}
```

- `expectations[]` — graded expectations with evidence. **The field names are `text`, `passed` and `evidence`** — not `name`/`met`/`details` or any other variant. The viewer depends on these exactly.
- `summary` — aggregate pass and fail counts
- `execution_metrics` — tool usage and output size, copied from the executor's `metrics.json`
- `timing` — wall clock, from `timing.json`
- `claims` — claims extracted from the output and verified
- `user_notes_summary` — issues the executor flagged
- `eval_feedback` — optional; present only when the grader found something about the evals themselves worth raising

---

## metrics.json

Output from the executor. Located at `<run-dir>/outputs/metrics.json`.

```json
{
  "tool_calls": {
    "Read": 5,
    "Write": 2,
    "Bash": 8,
    "Edit": 1,
    "Glob": 2,
    "Grep": 0
  },
  "total_tool_calls": 18,
  "total_steps": 6,
  "files_created": ["filled_form.pdf", "field_values.json"],
  "errors_encountered": 0,
  "output_chars": 12450,
  "transcript_chars": 3200
}
```

- `tool_calls` — count per tool type; `total_tool_calls` is their sum
- `total_steps` — number of major execution steps
- `files_created` — output files produced
- `output_chars` / `transcript_chars` — size proxies

---

## timing.json

Wall clock for a run. Located at `<run-dir>/timing.json`.

**How to capture:** the subagent's task-completion notification carries `total_tokens` and `duration_ms`. Write them the moment the notification arrives. They are not persisted anywhere else and cannot be recovered afterwards.

```json
{
  "total_tokens": 84852,
  "duration_ms": 23332,
  "total_duration_seconds": 23.3,
  "executor_start": "2026-01-15T10:30:00Z",
  "executor_end": "2026-01-15T10:32:45Z",
  "executor_duration_seconds": 165.0,
  "grader_start": "2026-01-15T10:32:46Z",
  "grader_end": "2026-01-15T10:33:12Z",
  "grader_duration_seconds": 26.0
}
```

---

## benchmark.json

Written by `bun ../operations/aggregate-results.ts`, and read by the viewer.

```json
{
  "metadata": {
    "skill_name": "pdf",
    "skill_path": "/path/to/pdf",
    "executor_model": "claude-sonnet-4-20250514",
    "analyzer_model": "most-capable-model",
    "timestamp": "2026-01-15T10:30:00Z",
    "evals_run": [1, 2, 3],
    "runs_per_configuration": 3
  },

  "runs": [
    {
      "eval_id": 1,
      "eval_name": "Ocean",
      "configuration": "with_skill",
      "run_number": 1,
      "result": {
        "pass_rate": 0.85,
        "passed": 6,
        "failed": 1,
        "total": 7,
        "time_seconds": 42.5,
        "tokens": 3800,
        "tool_calls": 18,
        "errors": 0
      },
      "expectations": [
        {"text": "...", "passed": true, "evidence": "..."}
      ],
      "notes": [
        "Used 2023 data, may be stale"
      ]
    }
  ],

  "run_summary": {
    "with_skill": {
      "pass_rate": {"mean": 0.85, "stddev": 0.05, "min": 0.80, "max": 0.90},
      "time_seconds": {"mean": 45.0, "stddev": 12.0, "min": 32.0, "max": 58.0},
      "tokens": {"mean": 3800, "stddev": 400, "min": 3200, "max": 4100}
    },
    "without_skill": {
      "pass_rate": {"mean": 0.35, "stddev": 0.08, "min": 0.28, "max": 0.45},
      "time_seconds": {"mean": 32.0, "stddev": 8.0, "min": 24.0, "max": 42.0},
      "tokens": {"mean": 2100, "stddev": 300, "min": 1800, "max": 2500}
    },
    "delta": {
      "pass_rate": "+0.50",
      "time_seconds": "+13.0",
      "tokens": "+1700"
    }
  },

  "notes": [
    "Expectation 'Output is a PDF file' passes 100% in both configurations - may not differentiate skill value",
    "Eval 3 shows high variance (50% ± 40%) - may be flaky or model-dependent",
    "Skill adds 13s average execution time but improves pass rate by 50%"
  ]
}
```

- `metadata` — about the benchmark run itself
- `runs[]` — individual run results
  - `eval_id` — numeric identifier
  - `eval_name` — human-readable name, **used as the section header in the viewer**
  - `configuration` — one of four literal strings the viewer and the aggregator both match on: `"with_skill"` and `"new_skill"` are the configurations under test, `"without_skill"` and `"old_skill"` are the baselines they are measured against. Which pair a run uses depends on the baseline mode (`SKILL.md`, Step 1); the class decides colour in the viewer, and it decides the direction of the delta, which is always primary minus baseline
  - `run_number` — integer, 1-based
  - `result` — nested object holding `pass_rate`, `passed`, `total`, `time_seconds`, `tokens`, `errors`
- `run_summary` — per-configuration aggregates, each with `mean` and `stddev`, plus a `delta` of formatted difference strings. Key order matters: the configuration under test comes first, and the viewer renders the keys in the order it finds them, so a hand-built file listing the baseline first would print a delta whose sign contradicts its own columns
- `notes` — freeform observations from the analyst pass

**The viewer reads these names exactly.** Using `config` instead of `configuration`, or hoisting `pass_rate` to the top level of a run instead of nesting it under `result`, produces a report full of zeros rather than an error. Consult this section whenever you generate `benchmark.json` by hand.

> **Deliberate fix, recorded so the change is legible:** the original aggregator never read `eval_name`, so every run record it emitted omitted the field — even though this schema documents it as the viewer's per-eval section header and the viewer reads it. `aggregate-results.ts` now reads `eval_name` from `eval_metadata.json`, right next to `eval_id`, and emits it. Sections render with the descriptive name instead of falling back to "Eval &lt;id&gt;". When the metadata file is absent the field is `""`, which the viewer already treats as "use the fallback" — so give each eval a real `eval_name` in Step 1 and it will show up here.

---

## comparison.json

Output from the blind comparison pass (`blind-comparison.md`). Located at `<grading-dir>/comparison-N.json`.

```json
{
  "winner": "A",
  "reasoning": "Output A provides a complete solution with proper formatting and all required fields. Output B is missing the date field and has formatting inconsistencies.",
  "rubric": {
    "A": {
      "content": {"correctness": 5, "completeness": 5, "accuracy": 4},
      "structure": {"organization": 4, "formatting": 5, "usability": 4},
      "content_score": 4.7,
      "structure_score": 4.3,
      "overall_score": 9.0
    },
    "B": {
      "content": {"correctness": 3, "completeness": 2, "accuracy": 3},
      "structure": {"organization": 3, "formatting": 2, "usability": 3},
      "content_score": 2.7,
      "structure_score": 2.7,
      "overall_score": 5.3
    }
  },
  "output_quality": {
    "A": {
      "score": 9,
      "strengths": ["Complete solution", "Well-formatted", "All fields present"],
      "weaknesses": ["Minor style inconsistency in header"]
    },
    "B": {
      "score": 5.3,
      "strengths": ["Readable output", "Correct basic structure"],
      "weaknesses": ["Missing date field", "Formatting inconsistencies"]
    }
  },
  "expectation_results": {
    "A": {
      "passed": 4,
      "total": 5,
      "pass_rate": 0.80,
      "details": [{"text": "Output includes name", "passed": true}]
    },
    "B": {
      "passed": 3,
      "total": 5,
      "pass_rate": 0.60,
      "details": [{"text": "Output includes name", "passed": true}]
    }
  }
}
```

`winner` is `"A"`, `"B"` or `"TIE"`. Omit `expectation_results` entirely when no expectations were supplied.

---

## analysis.json

Output from the post-hoc comparison analysis (`comparison-analysis.md`). Located at `<grading-dir>/analysis.json`.

```json
{
  "comparison_summary": {
    "winner": "A",
    "winner_skill": "path/to/winner/skill",
    "loser_skill": "path/to/loser/skill",
    "comparator_reasoning": "Brief summary of why comparator chose winner"
  },
  "winner_strengths": [
    "Clear step-by-step instructions for handling multi-page documents",
    "Included validation script that caught formatting errors"
  ],
  "loser_weaknesses": [
    "Vague instruction 'process the document appropriately' led to inconsistent behavior",
    "No script for validation, agent had to improvise"
  ],
  "instruction_following": {
    "winner": {"score": 9, "issues": ["Minor: skipped optional logging step"]},
    "loser": {
      "score": 6,
      "issues": [
        "Did not use the skill's formatting template",
        "Invented own approach instead of following step 3"
      ]
    }
  },
  "improvement_suggestions": [
    {
      "priority": "high",
      "category": "instructions",
      "suggestion": "Replace 'process the document appropriately' with explicit steps",
      "expected_impact": "Would eliminate ambiguity that caused inconsistent behavior"
    }
  ],
  "transcript_insights": {
    "winner_execution_pattern": "Read skill -> Followed 5-step process -> Used validation script",
    "loser_execution_pattern": "Read skill -> Unclear on approach -> Tried 3 different methods"
  }
}
```

The other analyst pass, `benchmark-notes.md`, writes nothing in this shape: its output is a plain JSON array of observation strings that becomes the `notes` field of `benchmark.json`.

---

## feedback.json

Written by the viewer when the user clicks "Submit All Reviews". Located at the iteration root, `evals/results/iteration-N/`; in a `--static` viewer it downloads to the browser's download directory and you copy it in.

```json
{
  "reviews": [
    {"run_id": "eval-0-with_skill", "feedback": "the chart is missing axis labels", "timestamp": "2026-01-15T11:02:31Z"},
    {"run_id": "eval-1-with_skill", "feedback": "", "timestamp": "2026-01-15T11:03:04Z"}
  ],
  "status": "complete"
}
```

- `run_id` — `<eval-dir>-<configuration>`
- `feedback` — free text; empty means the user was satisfied
- `status` — `"complete"` once the user has submitted

---

## Description-optimization outputs

`bun ../operations/optimize-description.ts` writes two files that the original documentation omitted. Both land under `<--results-dir>/<timestamp>/`, and **only when `--results-dir` is passed** — without it the run keeps its results in memory, prints them, and leaves nothing behind but a report in a temp directory. Pass it if you want either file on disk afterwards.

**`results.json`** — the machine-readable result of the optimization run: per-iteration candidate descriptions with their train and held-out scores, and the selected `best_description`. `best_description` is chosen on the **held-out** score. This is the file to read programmatically.

**`report.html`** — the human-readable version of the same data. The live copy is opened in the browser immediately and rewritten after every iteration, so it is something to watch rather than something to wait for; it lives wherever `--report` points, which is a temp directory by default. The copy under the results directory is that same report in its final state, written once the run ends. Presentation only; nothing reads either back.

---

## Disclosure outputs

`bun ../operations/measure-disclosure.ts` and `bun ../operations/optimize-disclosure.ts` both write a `results.json` under `--results-dir`, and both carry the same two ground-truth figures. The fields below are additive — everything a consumer read before is unchanged and in place.

**`files[].recall`** — per bundled file, how often the runs that SHOULD have reached it did. `null` when no scenario declared that file, which is **not** a recall of zero: null means nothing claims the file is ever needed, zero means every run that needed it failed to open it, and the two argue for opposite actions.

```json
{
  "files": [
    {
      "path": "references/rubric.md",
      "loadMode": "read", "tokens": 1840,
      "pulls": 3, "countedRuns": 12, "pullRate": 0.25,
      "recall": {"reads": 3, "expectedRuns": 4, "rate": 0.75},
      "signposted": true, "verdict": "keep"
    },
    {
      "path": "references/legacy.md",
      "loadMode": "read", "tokens": 620,
      "pulls": 0, "countedRuns": 12, "pullRate": 0,
      "recall": null,
      "signposted": true, "verdict": "prune"
    }
  ]
}
```

- `recall.reads` — of the runs below, how many read the file
- `recall.expectedRuns` — runs of the scenarios whose `expects_references` names this file. **A different denominator from `countedRuns`**, and much smaller: a reference three scenarios need is judged against those three scenarios' runs. Both fractions are reported because a ratio over four runs and a ratio over ninety print identically
- `recall.rate` — `reads / expectedRuns`

Both denominators are taken over the same runs the pull rate uses: error-free, and the body delivered by the skill system rather than read out of the directory by the model.

**`ground_truth`** — what the scenario set declared, and what its negative rows measured. Always written, including for a set that declared none, because that state is the reason every `recall` above is null.

```json
{
  "ground_truth": {
    "annotatedScenarios": 5,
    "negativeScenarios": 2,
    "annotatedRuns": 10,
    "overFetch": {"scenarios": 2, "runs": 4, "runsThatRead": 1, "rate": 0.25}
  }
}
```

- `annotatedScenarios` — scenarios carrying `expects_references` at all. Rows omitting the key are **not** counted here
- `negativeScenarios` — of those, the ones declaring the empty array
- `annotatedRuns` — counted runs whose scenario declared ground truth, positive or negative
- `overFetch` — the share of delivered runs of the negative scenarios that read any file in the inventory. Over-fetch is a property of a RUN, so a run that read three files it should not have is one over-fetch and not three; a read of something outside the inventory (`node_modules/`, `__tests__/`, a lockfile, a dotfile) is not one at all. **`null` when no scenario declares the empty array** — a rate over no runs is not zero, and a 0% over-fetch is a clean bill of health that a set which never checked has not earned

A set with `annotatedScenarios: 0` is the honest shape of having measured nothing: every `recall` is null, `overFetch` is null, and both scripts say so on stderr rather than printing a column of zeros. The optimizer additionally carries this as a `provenance.caps` sentence in `envelope.json`, and each of its `rows` carries the same `recall` field as `files[]` above.

**Ground truth decides the verdict, and it is the only thing that unlocks a deletion.** `decideFileVerdict` branches on what evidence exists rather than on the pull rate alone:

| What is known about the file | Verdict |
|:--|:--|
| At least one scenario declares it, and recall is below 0.5 | `signpost` — regardless of the raw pull rate; a file most of the runs that needed it could not reach is a broken pointer, and inlining it would bury the defect under a copy of the content |
| At least one scenario declares it, recall is at or above 0.5, pull rate at or above the inline threshold | `inline` |
| At least one scenario declares it, anything else | `keep` |
| No scenario declares it, but the set declares ground truth somewhere, pull rate 0 | `prune` — the only deletion verdict, and the only one backed by positive evidence that nothing needs the file. Note it does not consult `signposted`: the ground truth already answered the question signposting was standing in for |
| No scenario declares it, but the set declares ground truth somewhere, pull rate above 0 | `keep` |
| The set declares no ground truth at all, pull rate 0, body names the file | `unmeasured` |
| The set declares no ground truth at all, pull rate 0, body does not name the file | `signpost` |
| The set declares no ground truth at all, otherwise | `inline` at or above the threshold, else `keep` |

An unannotated set therefore reaches **no deletion verdict at any pull rate**. `unmeasured` is the state the old rule called `prune`: signposted, read by no run, and nothing declaring what should have reached it, so rarely-needed and needed-but-never-reached are indistinguishable in the data. The action is to add `expects_references` to the scenarios and measure again, and the optimizer proposes nothing at all for these files — deletion candidates are generated only from `prune`, and pointer repairs are an editorial decision the measurement does not make. An annotated set and a bare one thus diverge in how honest they are about what is unknown, never in how destructive they are about what is unproven.

---

**If what you actually need from a results directory is "under what conditions was this produced, and can I compare it to last week's run", neither of these files has it** — a `results.json` records what a run found and says nothing about the model, the concurrency, the timeout, the eval set or the installed state it found it under. That is `envelope.json`, documented in the next section, and it is written beside `results.json` by the loops that support it.

---

## envelope.json — the results envelope

One shape that every measured operation writes alongside its own output. Defined as a Zod schema, `EnvelopeSchema`, in `../envelope.ts`, which is both the type source (every exported envelope type is inferred from it) and the only validator; the filename is fixed as `envelope.json` by the `ENVELOPE_FILENAME` constant.

**What it is for.** A `results.json` answers "what did the run find". An envelope answers the two questions a reader has *before* they are willing to believe it: under what conditions was this produced, and is it comparable to the last one. Those questions are the same for every operation, so only `rows` varies by producer — the other four blocks mean the same thing whether the run measured trigger rates, pull rates or frontmatter errors.

```json
{
  "run": {
    "id": "optimize-disclosure-my-skill-20260809T031500Z-a1b2c3",
    "startedAt": "2026-08-09T03:15:00.000Z",
    "artifact": "skill",
    "target": "my-skill",
    "operation": "optimize-disclosure",
    "model": "opus",
    "graderModel": "sonnet",
    "workers": 12,
    "runsPer": 2,
    "timeoutSeconds": 600,
    "evalSetHash": "sha256:9f2c…",
    "targetSha": "sha256:a85b…",
    "installState": "absent"
  },
  "provenance": {
    "tokenizer": "tiktoken",
    "unit": "scenario run",
    "scored": 18,
    "excluded": 2,
    "failed": 2,
    "timeoutPolicy": "excluded",
    "caps": [
      "2 of 5 scenario(s) were held out for selection (`--holdout 0.4`). Pull rates and verdicts in `rows` are computed over the 3 TRAIN scenario(s) only."
    ]
  },
  "headline": [
    {"label": "body tokens", "value": 4200, "unit": "tokens", "delta": -800}
  ],
  "rows": [
    {"path": "references/advanced.md", "loadMode": "read", "tokens": 900,
     "pulls": 0, "countedRuns": 6, "pullRate": 0, "recall": {"reads": 0, "expectedRuns": 2, "rate": 0},
     "signposted": true, "verdict": "prune"}
  ],
  "verdicts": [
    {"subject": "references/advanced.md", "verdict": "prune",
     "reason": "read on 0/6 run(s), although the body points straight at it. The pointer works and nothing needed the file."}
  ]
}
```

### `run` — the comparability key

**Every field is required and no key may be absent.** `null` is permitted only where it is a real answer — `"model": null` means no model was involved — and the difference matters because an absent key and a null value read identically to a consumer while meaning opposite things. Omitting a key is refused by name; writing `null` where the table below says nullable is fine.

| Field | Nullable | Meaning |
|---|---|---|
| `id` | no | Unique per run, readable in a directory listing. Filled in by the builder |
| `startedAt` | no | ISO 8601, UTC. Filled in by the builder |
| `artifact` | no | `skill`, `agent`, `command`, `mcp`, `plugin` or `hooks`. An unlisted value is refused |
| `target` | no | The artifact's authored name — `ask-user-question`, not a path |
| `operation` | no | `measure-triggering`, `measure-disclosure`, `optimize-description`, `optimize-disclosure` or `validate`. A closed set, so a typo cannot invent an operation that consumers then group by |
| `model` | **yes** | The model the run swept on: `MEASUREMENT_MODEL` unless `--tier-study` named another, in which case a `caps` sentence marks the run as a study. `null` only where no model was involved (`validate`) |
| `graderModel` | **yes** | The grading model, `null` when the operation has no grading step. Only `optimize-disclosure` fills it today |
| `workers` | no | Concurrent units of work. `1` for a sequential operation, never `0` |
| `runsPer` | no | Repeats per unit — runs per query, runs per scenario. `1` where there is no sampling |
| `timeoutSeconds` | **yes** | Per-unit wall clock budget, `null` when nothing can time out |
| `evalSetHash` | **yes** | Content hash of the questions asked, `null` when the operation asks none. Hashed from the **parsed** set, so reindenting a file does not make two runs look incomparable while renaming a query correctly does |
| `targetSha` | no | Content hash of the artifact under test, `sha256:<64 hex>`. Excludes `node_modules` and `.git` and nothing else |
| `installState` | no | `absent`, `installed`, `shadowed`, `not-reachable` or `unknown` — see below |

**`installState` is an observation, not an assertion.** It records what the machine's installed set looked like, because the operations genuinely disagree about what they need: a triggering sweep needs the artifact installed for the router to reach it, and a disclosure sweep needs it *not* to be — content served through the skill system never produces a `Read`, so a disclosure run against an installed copy floors every pull rate at zero and produces a clean-looking table of `prune` verdicts resting on nothing. The same value is healthy for one operation and fatal for another, and only the operation can say which.

**`absent` is itself a claim, so three of the five values are about the quality of the answer rather than about the machine.** "Nothing is installed" and "I could not find out" produce the same empty sighting list and mean opposite things — the same absent-versus-empty distinction `expects_references` draws above, where an omitted key and an empty array are not interchangeable. `absent` is reserved for a sweep that covered its roots and established absence.

| Value | What it says |
|---|---|
| `absent` | The sweep covered its roots and nothing claims the target's name |
| `installed` | Exactly one copy is installed under its own name |
| `shadowed` | More than one installation answers to the name and can win its probes |
| `not-reachable` | A sweep ran and was blind to part of the install surface, so absence *and* uniqueness were both left unestablished |
| `unknown` | No sweep applied, or none ran |

`not-reachable` and `unknown` are both non-answers and are still not the same one. `unknown` means no sweep was applicable — the target is an agent and the sweep only globs `**/SKILL.md` — or discovery threw before reading anything: a standing limitation nothing at the call site can act on. `not-reachable` means a sweep ran, was supposed to answer, and came back partially blind: a root that exists and would not enumerate, or `HOME` unset so three of the four roots could not be named. That one is a machine that can be repaired and re-run.

The asymmetry carries into `installConflict`, which returns `null` for `unknown` and a sentence for `not-reachable`. Blindness also downgrades a *positive* answer: one copy found while another root is unreadable is `not-reachable`, not `installed`, because `installed` claims uniqueness that a partial sweep has not earned. Two or more sightings stay `shadowed` under blindness, since an unread root can only add copies. Never write `unknown` to mean "probably absent", never write `absent` on a run where nothing looked, and never let a blind sweep report either.

### `provenance` — how the numbers were arrived at, and what bounded them

| Field | Meaning |
|---|---|
| `tokenizer` | `tiktoken`, `estimated` or `none`. `none` is the honest answer for an operation reporting no token figure at all — it exists so such an operation cannot be forced to claim `tiktoken` (a lie about precision) or `estimated` (a lie about there being a number) |
| `unit` | What one unit of `scored`/`excluded`/`failed` is, in words: `"query attempt"`, `"scenario run"`, `"file examined"`. `"scored": 24` is meaningless without it, and it is not recoverable from `runsPer` |
| `scored` | Units that reached the numbers in `headline` and `rows` |
| `excluded` | Units that ran, or partly ran, and were deliberately left out of the denominators |
| `failed` | Units the harness could not complete — a timeout, or a spawn that errored |
| `timeoutPolicy` | `scored`, `excluded` or `not-applicable` — see below |
| `caps` | Anything that bounded coverage, one plain sentence each. Required, and empty by declaration rather than optional |

**`failed` is deliberately not disjoint from the other two.** The invariant is `scored + excluded = attempted`, with `failed` a cross-cutting count that lands on one side or the other according to `timeoutPolicy`. Making the three disjoint would destroy the thing the pair exists to show: under a `scored` policy a timeout is *inside* the numbers, and a reader has to be able to see both that it happened and that it counted.

**`caps` is the field whose absence is invisible.** A silently applied top-N, an early-stopping rule that skipped a third of the planned attempts, a held-out split that kept scenarios out of a phase, a check that was not performed — each reads as "we looked at everything" unless the report says otherwise. An empty array is a claim that the run really did look at everything it was pointed at.

### `timeoutPolicy` — what a timed-out unit did to the numbers

This repository holds two opposite policies, both defensible, and neither is being changed. What the field adds is that each run now *says* which one produced its figures, so a reader comparing a disclosure rate against a triggering rate can see that the same `failed` count landed on opposite sides of the line instead of inferring it from two source files.

| Value | Meaning | Used by |
|---|---|---|
| `scored` | A timed-out unit is folded into the numbers as a definite negative outcome | `measure-triggering`, `optimize-description` |
| `excluded` | A timed-out unit is dropped from the denominators | `optimize-disclosure`, `measure-disclosure` |
| `not-applicable` | Nothing in this operation can time out, because it spawns nothing | `validate` |

`measure-triggering` scores a timeout as a non-trigger: the router demonstrably did not reach for the artifact within the budget, and a description that only triggers after 150 seconds has not triggered. `optimize-disclosure` excludes it: a run that never finished says nothing about whether its scenario needed a reference, and treating silence as evidence of absence would push the loop toward deleting files whose only crime was being needed by a slow scenario. Under `excluded`, `failed` and `excluded` are the same number; under `scored` they are not, and that difference is the whole point of reporting both.

### `headline`, `rows` and `verdicts`

All three are required arrays. Empty is fine; absent is refused.

- **`headline[]`** — `label`, `value` and `unit`, plus an optional numeric `delta`. `unit` is whatever makes the number readable: `"fraction"`, `"tokens"`, `"files"`, `"of 24"`. A metric is **omitted rather than reported as zero** when its numerator does not exist — a recall of 0 computed over no positive queries reads as a total failure to trigger, and a pass rate of 1 over no assertions reads as a perfect score.
- **`rows[]`** — the operation's own table, and the only block whose shape varies. Producers keep them in the envelope's camelCase vocabulary even where their `results.json` is snake_case, so a consumer never has to guess the convention per field.
- **`verdicts[]`** — `subject`, `verdict` and `reason`. `verdict` is a free string because the vocabulary is genuinely per-operation; `reason` is what makes that survivable, since a verdict a reader has never seen before still arrives with its justification attached.

| Operation | One row is | Verdict vocabulary |
|---|---|---|
| `measure-triggering` | one query: `query`, `shouldTrigger`, `triggers`, `runs`, `triggerRate`, `pass`, `earlyStopped` | `pass`, `fail` |
| `optimize-description` | one iteration: `iteration`, `description`, `trainPassed`, `trainTotal`, `testPassed`, `testTotal`, `selected` | `selected`, `scored` |
| `optimize-disclosure`, `measure-disclosure` | one bundled file: `path`, `loadMode`, `tokens`, `pulls`, `countedRuns`, `pullRate`, `recall`, `signposted`, `verdict` | `inline`, `prune`, `signpost`, `unmeasured`, `misfiled`, `keep`, plus `unsound` for the whole skill when the install state conflicts |
| `validate` | one finding: `file`, `line`, `severity`, `rule`, `message`, `section` | `valid`/`invalid` for the artifact, `invalid`/`warned`/`no-findings` per section, `not-checked` for a check that did not run |

**`no-findings` is not `pass`, and the distinction is load-bearing.** A section that ran and was satisfied and a section that declined to look both come back as zero errors and zero warnings. `pass` would be a judgement the validator has not earned on the second, so a clean section says only what came back, and a check that did not run gets its own `not-checked` verdict beside it.

**`measure-disclosure` shares that row rather than having one of its own, and shares the builder that produces it.** `buildDisclosureEnvelope` takes an `operation` parameter for exactly this, and `buildMeasurementEnvelope` in `../operations/measure-disclosure.ts` calls it: the rows, the per-file verdict reasons and the exclusion accounting are the judgements the two entry points must never disagree about, so there is one implementation of them and not two. `results.json` is unchanged to the byte — the envelope is a second file beside it, and `install_state` and `install_conflict` stay on `MeasureOutput` as well as reaching `run.installState` and the first line of `caps`.

What differs between the two callers is which caps are *true*, and the builder gates those on `operation` rather than filling them in with ones and zeros. A measurement pass restructures nothing, so it declares no iteration budget, no candidate budget and no train/held-out split — a `caps` entry naming `--max-candidates` on a run whose `--help` has no such flag is not a weaker caveat but a false one, and a reader who catches one stops believing the list. In their place it declares that nothing was restructured, and that every scenario is evidence about the same unmodified layout.

**Both disclosure callers declare counted-versus-all, with the cause of every excluded run named and counted.** `provenance.scored` counts the runs the harness completed with the body in context; the assertion and context figures are over the runs the *skill system delivered*, which is smaller by exactly the runs where the model read `SKILL.md` itself. `assertionsTotal` has always been a counted-runs figure that did not say it was one, and the cost of not saying it is on the record — a reader comparing two runs' headline denominators, with no artifact naming which runs each had dropped and why, concluded a pair had been interrupted. The cap names both totals, the per-cause counts (never loaded, loaded by file read, timed out, failed outright), and the fact that `scored` is not the assertion denominator.

### Comparability — why a delta is sometimes refused

Change `workers`, `model` or `timeoutSeconds` and a run is incomparable with every earlier one, but the numbers still line up in a table and still look like a trend. `compareRuns` in `../envelope.ts` makes that judgement in code rather than leaving it to whoever is squinting at two files. Six fields block a comparison, each because it changes what the number *means* rather than what it measures:

| Key | Why a difference is disqualifying |
|---|---|
| `model` | A different router makes a different routing decision |
| `workers` | Concurrency changes contention, and contention changes timeouts |
| `timeoutSeconds` | The budget decides how many slow units are scored as failures |
| `runsPer` | A rate over 2 attempts and a rate over 10 are not the same estimate |
| `evalSetHash` | Different questions |
| `installState` | A shadowed target answers with somebody else's description |

`artifact`, `target`, `operation`, `graderModel` and `targetSha` are reported as **advisory** differences instead: they are worth showing a reader and are not grounds to refuse. `targetSha` heads that list and its exclusion is the point — the artifact changing is the thing a before/after delta is *about*, so treating it as incomparability would reject every useful comparison.

**A `headline[].delta` is only ever filled in after that check has passed.** Producers running in isolation leave it absent, because there is nothing legitimate to subtract. The one exception is a delta between two figures from *inside the same run* — a disclosure body-token saving, a description loop's improvement over its own baseline — where both numbers sit under one `run` block and the only thing that changed between them is the variable under test.

### Where each producer writes it

`--envelope` is additive everywhere: the existing stdout JSON and `results.json` keep their exact shape, and the envelope is a second file beside them.

| Producer | Flag | Default when the flag is omitted |
|---|---|---|
| `../operations/measure-triggering.ts` | `--envelope <path>` | none — no flag, no envelope |
| `../operations/optimize-disclosure.ts` | `--envelope <path>` | `<--results-dir>/<timestamp>/envelope.json`, when `--results-dir` was passed |
| `../operations/measure-disclosure.ts` | `--envelope <path>` | `<--results-dir>/envelope.json`, when `--results-dir` was passed |
| `../validate/validate.ts` | `--envelope <path>` | none — no flag, no envelope |

`../operations/optimize-description.ts` writes it beside `results.json` when `--results-dir` is passed (and wherever `--envelope` names); the row and verdict shapes above are what it emits.

**Why the two disclosure entry points default the envelope on and `measure-triggering.ts` does not.** It is not a disagreement: `measure-triggering.ts` has no `--results-dir` to hang a default off, so `--envelope` is the only way to name a path. Where a results directory exists, an operator saving a run's output wants the conditions that output was produced under, and requiring a second flag to get them is the habit-flag pattern rather than a guard against one — correct behaviour available to whoever remembered to ask for it is behaviour that goes missing. Nothing is traded by defaulting it on, because `results.json` does not change.

### It is validated on the way out

`writeEnvelope` refuses an invalid envelope rather than writing one, and lists every problem by field path in one go. Validating on the way *out* is what makes the contract hold: a producer that forgets `installState` finds out on its own machine at the moment it writes, rather than three weeks later when a reporting layer renders a blank column. This is the one file on this page where "it produced no error" *is* evidence — so do not hand-write one, build it with `buildEnvelope` and let it be checked.

---

## Run status files

Every long-running script writes one status file per run, and `../report/generate-dashboard.ts` discovers them by glob. They live under `$TMPDIR/skill-creator-progress/` — override with `SKILL_CREATOR_STATUS_DIR` — named `<runId>.json`. They are scratch, not evidence: a status file describes a run in flight and is safe to delete at any time.

```json
{
  "runId": "description-loop-my-skill-20260802-143012-a1b2c3",
  "kind": "description-loop",
  "label": "my-skill — description optimization",
  "settled": 41,
  "total": 180,
  "startedAt": 1785725875594,
  "updatedAt": 1785725875741,
  "state": "running",
  "pid": 37630,
  "commandLine": "optimize-description.ts --eval-set evals/trigger.json --max-iterations 5",
  "detail": {
    "iteration": 2,
    "maxIterations": 5,
    "phase": "evaluating iteration 2",
    "trainScore": "8/12",
    "testScore": "6/8",
    "reportPath": "/tmp/skill_description_report_my-skill_20260802143012.html"
  }
}
```

| Field | Meaning |
|---|---|
| `runId` | Stable for the run's lifetime, and the file's basename |
| `kind` | `description-loop`, `eval-sweep`, `review` or `benchmark` |
| `label` | Human-readable row title on the dashboard |
| `settled` / `total` | Units of work finished and expected. `total` is 0 when the size is not countable |
| `startedAt` / `updatedAt` | Epoch **milliseconds**, not ISO strings — staleness is arithmetic on them |
| `state` | `running`, `done` or `failed`. Never `stale` (see below) |
| `error` | Present only when `state` is `failed` |
| `pid` | Writing process id. `ps -p <pid>` answers "is it still alive", the first question about a run that looks stuck |
| `commandLine` | Script name and arguments. A detached run's real flags are otherwise unrecoverable once the launching shell is gone |
| `detail` | Per-operation extras, all optional — see below |

Everything inside `detail` is optional, and the page renders whatever is present. **Note the nesting**: these are `status.detail.*`, not `status.*`. A writer that hangs one on the status root produces a page that silently falls back, with no error attached to it.

| `detail` field | Meaning |
|---|---|
| `phase` | Free-form name of what is happening now — "baseline evaluation", "improving description" |
| `iteration` / `maxIterations` | Where the description loop is up to |
| `trainScore` / `testScore` | Latest scores, as `passed/total` strings |
| `reportPath` | A page the run WROTE. Served as-is — nothing here improves on `optimize-description.ts`'s own report |
| `externalUrl` | A page the run SERVES, for a script that is itself a server. `generate-review.ts` records its own URL, and the dashboard redirects rather than reproducing it — only while the run lives, since a closed port would redirect to a connection error |
| `queries` | Per-query tallies for an eval sweep: `query`, `should_trigger`, `triggered`, `settled`, `total`. Counts rather than a verdict, because the verdict depends on `triggerThreshold` and is not decided until every attempt for a query lands — a pass/fail shown mid-run could flip |
| `artifactPaths` | Files the run produced. Read at serve time, so the page shows the current file rather than a snapshot from when the path was recorded |

**Every run has a page.** `/report/<runId>` is one route for every kind: it serves `externalUrl` by redirect while the run lives, else `reportPath` when that file exists, else a page rendered from the status itself. That is why a kind needs no renderer of its own to be clickable — the status already carries progress, phase, timings and tallies.

**A served `reportPath` is reconciled against the status.** A report the run wrote is a snapshot taken at a moment; the status is current. When they disagree — a crash freezes a report mid-claim — the page is served with a status-derived banner above it and its self-refresh stripped, so a dead run cannot keep asserting progress. The snapshot's own content is left intact, because it holds detail the status does not.

**`POST /retry/<runId>`** relaunches a run from its recorded `commandLine`. POST-only so no prefetch can fire it, refused with 409 unless the run is `failed` or stale, and the script name is resolved against a fixed allow-list of entrypoints rather than spawned as a path — a status file is hand-editable, and trusting a path from one would make a local dashboard an execution primitive.

Three properties are load-bearing rather than incidental:

**Writes are atomic.** Each update goes to a temp path and is then renamed, so a dashboard polling mid-write reads either the whole previous file or the whole new one — never a truncated prefix that parses as malformed JSON.

**Writes are never gated on `--verbose`.** The stderr progress indicator is, which is right for a terminal — but a detached run has no operator to pass the flag, so gating the status write the same way would leave the dashboard blank for exactly the runs it exists to observe. The status file is the primary channel and the stderr line is a courtesy for the foreground case; if they ever disagree, the file is the source of truth.

**`stale` is derived, never stored.** A run records a terminal state on every exit path it can observe — a normal return, a thrown error, `SIGINT` and `SIGTERM`. The one case no handler covers is `SIGKILL`, which leaves `running` on disk forever, and that is what stale detection is the backstop for rather than the primary mechanism. The reader treats a `running` status whose `updatedAt` is older than ~214s as stale and reports it as "no longer reporting". That threshold clears the slowest thing that legitimately blocks an update — individual `claude -p` calls were measured at up to 124s — so a healthy run waiting on one slow child is not misreported. This is also why writers refresh `updatedAt` on a heartbeat even when no counter moved: the timestamp is the liveness signal.

---

## history.json — documented but unused

Earlier documentation described a `history.json` at the workspace root, tracking version progression during improvement:

```json
{
  "started_at": "2026-01-15T10:30:00Z",
  "skill_name": "pdf",
  "current_best": "v2",
  "iterations": [
    {"version": "v0", "parent": null, "expectation_pass_rate": 0.65, "grading_result": "baseline", "is_current_best": false},
    {"version": "v1", "parent": "v0", "expectation_pass_rate": 0.75, "grading_result": "won", "is_current_best": true}
  ]
}
```

**Nothing writes this file and nothing reads it.** It is retained here only so that an author who encounters it in an old workspace, or in inherited documentation, knows it is inert. Do not generate it — iteration history lives in the `iteration-N/` directory structure and in each iteration's `benchmark.json`.
