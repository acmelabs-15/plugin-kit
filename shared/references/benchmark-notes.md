# Benchmark notes: the analyst pass over `benchmark.json`

The subagent prompt for the analyst pass in Step 4 of the eval loop — the one that runs
every iteration. Hand this file to the subagent rather than a paraphrase, or read it
yourself if you are writing the notes inline.

Its output is a flat JSON array of observation strings that becomes the `notes` field of
`benchmark.json`. It surfaces patterns the aggregates hide and deliberately suggests
nothing; improvements are the next step's job, and mixing the two makes a benchmark read
like an argument for a conclusion it was supposed to test.

For the other analyst pass — the rare post-hoc one that unblinds a comparison verdict and
writes a structured suggestion document — that is `comparison-analysis.md`.

---

## Role

Review all benchmark run results and generate freeform notes that help the user understand skill performance. Focus on patterns that wouldn't be visible from aggregate metrics alone.

## Inputs

You receive these parameters in your prompt:

- **benchmark_data_path**: Path to the in-progress benchmark.json with all run results
- **skill_path**: Path to the skill being benchmarked
- **output_path**: Where to save the notes (as JSON array of strings)

## Process

### Step 1: Read Benchmark Data

1. Read the benchmark.json containing all run results
2. Note the configurations tested (with_skill, without_skill)
3. Understand the run_summary aggregates already calculated

### Step 2: Analyze Per-Expectation Patterns

For each expectation across all runs:

- Does it **always pass** in both configurations? (may not differentiate skill value)
- Does it **always fail** in both configurations? (may be broken or beyond capability)
- Does it **always pass with skill but fail without**? (skill clearly adds value here)
- Does it **always fail with skill but pass without**? (skill may be hurting)
- Is it **highly variable**? (flaky expectation or non-deterministic behavior)

### Step 3: Analyze Cross-Eval Patterns

Look for patterns across evals:

- Are certain eval types consistently harder/easier?
- Do some evals show high variance while others are stable?
- Are there surprising results that contradict expectations?

### Step 4: Analyze Metrics Patterns

Look at time_seconds, tokens, tool_calls:

- Does the skill significantly increase execution time?
- Is there high variance in resource usage?
- Are there outlier runs that skew the aggregates?

### Step 5: Generate Notes

Write freeform observations as a list of strings. Each note should:

- State a specific observation
- Be grounded in the data (not speculation)
- Help the user understand something the aggregate metrics don't show

Examples:

- "Expectation 'Output is a PDF file' passes 100% in both configurations - may not differentiate skill value"
- "Eval 3 shows high variance (50% ± 40%) - run 2 had an unusual failure that may be flaky"
- "Without-skill runs consistently fail on table extraction expectations (0% pass rate)"
- "Skill adds 13s average execution time but improves pass rate by 50%"
- "Token usage is 80% higher with skill, primarily due to script output parsing"
- "All 3 without-skill runs for eval 1 produced empty output"

### Step 6: Write Notes

Save notes to `{output_path}` as a JSON array of strings:

```json
[
  "Expectation 'Output is a PDF file' passes 100% in both configurations - may not differentiate skill value",
  "Eval 3 shows high variance (50% ± 40%) - run 2 had an unusual failure",
  "Without-skill runs consistently fail on table extraction expectations",
  "Skill adds 13s average execution time but improves pass rate by 50%"
]
```

## Guidelines

Worth doing:

- Report what you observe in the data
- Be specific about which evals, expectations or runs you are referring to
- Note patterns the aggregate metrics would hide
- Provide context that helps interpret the numbers

Worth avoiding, and each for a reason:

- Suggesting improvements to the skill — that is the improvement step's job, and mixing the two makes a benchmark read like an argument for a conclusion
- Subjective quality judgments ("the output was good") — the human review covers those, and a number cannot support them
- Speculating about causes without evidence
- Repeating what `run_summary` already says, which is the most common way these notes end up worthless
