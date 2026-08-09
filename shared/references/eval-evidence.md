# Eval evidence: what to commit, and why it lives in the repo

Eval results go in `evals/results/iteration-<N>/`, inside the repository that holds
the skill, organized by iteration and then by eval.

## Why in-repo rather than a scratch sibling directory

These runs are the evidence behind every claim the skill makes about itself.

A transcript that is not committed cannot be re-read when a later change moves a
number, and the summary JSON alone does not say *why* a run scored what it did —
it records that an expectation failed, not the three turns of the model talking
itself into the wrong shape beforehand. That reasoning is usually the finding.

Keeping the runs versioned means a description change and the runs that justified
it land in the same commit history. A reviewer can then check a figure instead of
taking it on trust, and a regression six months later can be diffed against the
run that first established the number rather than argued about.

The alternative — a scratch directory beside the repo — makes every claim
unfalsifiable the moment the directory is cleaned up. That is the failure mode
worth spending disk on avoiding.

## What to commit

- the transcripts
- `benchmark.json` and `benchmark.md`
- `grading.json` for each run
- `timing.json` for each run, which is the only record of tokens and duration
  (those numbers exist nowhere else and cannot be recovered afterwards)
- the loop log
- `feedback.json` once the human review is submitted

## What to leave out

Copies of fixture repositories the runs operated on. Three reasons, and any one
of them is sufficient:

- they are reproducible from `evals/fixtures/`, so the copy carries no information
- each carries its own nested `.git` directory, so committing one produces a
  repository inside your repository — which git handles badly and reviewers
  handle worse
- they are usually the largest thing in the run directory by an order of
  magnitude, and they grow with every iteration

Where an eval needs a fixture, point it at `evals/fixtures/` and let the run work
on a temporary copy. The repository's `.gitignore` already excludes
`evals/results/**/repo/` for exactly this reason.

## Directory shape

```
evals/
  evals.json                    the evals
  fixtures/                     source fixtures, committed once
  results/
    skill-snapshot/             the arrived-with version, when improving one
    iteration-1/
      <eval-name>/
        with_skill/
          outputs/
          grading.json
          timing.json
        without_skill/          or old_skill/, when the baseline is a prior version
          outputs/
          grading.json
          timing.json
      benchmark.json
      benchmark.md
      feedback.json
    iteration-2/
      ...
```

`aggregate-results.ts` accepts both this layout and the older
`eval-<id>/<config>/run-<K>/` shape, so an existing results tree keeps working.

Naming the baseline matters more than it looks: configurations are classified
rather than sorted alphabetically, so `with_skill` and `new_skill` are read as the
primary arm and `without_skill` and `old_skill` as the baseline, and the reported
delta is primary minus baseline regardless of how the names happen to sort. If you
are about to name a directory something outside that set of four, read
`schemas.md`, section "benchmark.json", first — an unrecognized configuration name
is not an error, it just quietly stops being counted as either arm.
