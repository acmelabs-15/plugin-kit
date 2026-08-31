# Running the long jobs detached, and watching them

Every script here that calls `claude -p` is slow for a reason no flag fixes: time-to-first-tool-call
is an 11-14 second floor, and measured per-call durations ranged from 13 to 124 seconds. A twenty-query
set at three runs each is sixty of those. So these jobs are meant to be **launched detached and
watched**, not babysat in a terminal.

```bash
nohup bun ../operations/optimize-description.ts --eval-set <path> --skill-path <path> &
```

That is a complete invocation. The script starts the dashboard itself and opens a window.

## Table of Contents

- [Nothing waits on a timeout](#nothing-waits-on-a-timeout)
- [The attempts a trigger sweep does not run](#the-attempts-a-trigger-sweep-does-not-run)
- [The dashboard](#the-dashboard)
- [Screenshotting a page](#screenshotting-a-page)
- [A report is a snapshot; the status file is the truth](#a-report-is-a-snapshot-the-status-file-is-the-truth)
- [A crash no longer costs the completed work](#a-crash-no-longer-costs-the-completed-work)
- [Resuming a run that died](#resuming-a-run-that-died)
- [How a stopped run is reported](#how-a-stopped-run-is-reported)
- [Progress inside the description report](#progress-inside-the-description-report)

## Nothing waits on a timeout

Worth knowing, because it is the usual reason someone wraps these in a guessed wall-clock cap and then
sits through it. `--timeout` is a **per-query ceiling**, not a duration: the stream reader returns the
moment it reaches a verdict and the child is killed immediately. Measured, a run with a 180-second
ceiling returned in 69 seconds.

**The ceiling has to clear the slowest legitimate call.** It defaults to 180 seconds because calls were
measured at up to 124: a timed-out call scores as a non-trigger, indistinguishable from a genuine
decline, so a ceiling inside the measured range quietly converts slow calls into failures. Lowering it
to go faster does not work — it corrupts the result instead, the same way a rate-limited run does. A
timeout warns on stderr when it happens, so a budget that is too tight says so rather than hiding in
the score.

What governs total wall clock is the worker count (the tool picks twice the core count, capped at 24; `--num-workers` overrides), `--runs-per-query`, and the model. There
is no flag that makes a single call shorter.

Raising the worker count much past the default is unlikely to help: each worker is one `claude -p`
child making an API call, so this is network-bound rather than CPU-bound, and the ceiling is API rate
limiting. Runs that fail on a rate limit are scored as non-triggers, which corrupts the measurement
rather than speeding it up.

The disclosure loop shares that worker default, and its `--timeout` is 600
seconds rather than 180. Both differ for the same reason: a scenario run does the skill's whole job
instead of answering a routing question, so it takes longer and its fixed per-call cost amortizes
worse at low concurrency. The ten-minute ceiling is the other side of that — a scenario still running
after ten minutes has almost always stopped making progress, and until it is killed it holds a worker
slot that nothing else can use.

## The attempts a trigger sweep does not run

A query stops as soon as its remaining attempts cannot change its verdict. The verdict is a threshold
on a rate over a fixed denominator, so it is settled once the triggers so far already clear the bar,
or once a clean sweep of what is left would still fall short. At the defaults — three runs, threshold
0.5 — that means two concordant attempts decide it, and a query scoring 0/3 or 3/3 costs two calls
rather than three.

**This never changes a pass or a fail.** What it changes is `trigger_rate`, which becomes a rate over
the attempts actually run: a query that triggered twice and stopped reports 2/2, not 2/3. Every result
row carries `early_stopped` so you can tell which ones those are, and `--no-early-stop` runs the full
budget when the rate itself is the number you are reading — comparing two descriptions' rates against
each other, or filling in a measurements table where every figure needs the same denominator.

One consequence for the progress bar: the total it counts against is the maximum, so a sweep that
stopped queries early finishes at something like `48/60` and stops. That is the work not needed rather
than a run that was cut off.

## The dashboard

```bash
bun ../report/generate-dashboard.ts                  # serves on 127.0.0.1:3118
bun ../report/generate-dashboard.ts --static <path>  # snapshot; implies --no-open
bun ../report/generate-dashboard.ts --no-open        # serve without opening a window
```

`--refresh <seconds>` sets the poll interval, default 5.

`SKILL_CREATOR_NO_OPEN=1` suppresses **every** window this codebase opens — the dashboard, the
description report and the eval viewer alike — for CI or a headless box where no flag reaches the
command. The check lives inside `openInBrowser` rather than at each call site, so a call site added
later cannot forget it. Per-command equivalents exist where you want one window and not another:
`--no-open` on the dashboard and the viewer, `--report none` on `optimize-description.ts`.

In `--static` the snapshot has no server behind it, so only runs that wrote their own HTML report link
anywhere — the rest resolve against a route that is not being served.

Status files live under `$TMPDIR/skill-creator-progress/`, overridden by `SKILL_CREATOR_STATUS_DIR`.
Read `schemas.md`, section "Run status files", when you are writing a script that reports progress, or
when a dashboard row renders blank and you need to know which field it was looking for — every
`detail.*` field is optional and a missing one falls back silently rather than erroring.

**One dashboard, one window, however many runs.** A launch that finds one already serving reuses it,
and the page picks up new runs on its next poll — discovery is a glob over status files, not a
registry. Three runs therefore give you one window rather than three.

Each row carries the run's progress, its pid, and the command line that started it. When something
looks stuck, the pid answers the only question that matters: `ps -p <pid>` says whether the process is
still alive.

Status files for finished or stale runs are deleted after a week, so the list stays a recent history
rather than a full one. A run that is still refreshing its status cannot age out: it rewrites the file
every few seconds against a window measured in days.

## Screenshotting a page

```bash
bun ../tools/capture-page.ts <url> [--theme light|dark|both] [--click <selector>]
```

Defaults to **both** themes, which is the whole reason it exists. Five defects in these pages were
invisible to the type checker, to the test suite and to reading the diff, and showed up only in a
render — an inverted table header, a textarea falling back to browser grey, duplicated headings, a
failed run drawing a healthy progress bar, and two surfaces disagreeing about the same run. A headless
browser also inherits the machine's colour preference, so checking one theme on a dark-preference box
leaves a light-mode regression free to ship.

**Every row opens.** Click anywhere on a row — the whole card is the target, and Enter works on a
focused one — and you land on that run's own page, which shows progress while it is in flight and its
results once it finishes. Every page carries a header naming the run and a link back. What you get
depends on what the run produced: the description loop's own per-iteration report, the eval viewer for
a review run, or a page rendered from the run's status for anything that writes no HTML of its own. An
eval sweep's page lists every query with its expectation and its trigger rate so far, each row filling
in as its attempts land.

**A stopped run can be restarted**, from its row or its page. The button appears only on a run that has
`failed` or stopped reporting — a slow-but-live run has nothing to restart, and offering it there is how
an hour-long job gets relaunched by accident. It confirms first, quoting the exact invocation, and
re-runs the command line the status recorded.

## A report is a snapshot; the status file is the truth

Worth knowing because the two can disagree. `optimize-description.ts` writes its report after each iteration, so a
crash leaves the last snapshot describing an iteration that never finished — and that file then says so
forever. Measured on a real failed run: the report claimed progress while the status said `failed`.

The dashboard resolves this at serve time rather than trusting the file. Open a stopped run and the page
carries a banner above the snapshot stating that the run failed, with the error text, and its
self-refresh is stripped so a dead page stops re-polling. The snapshot's own table is preserved, because
it holds per-iteration detail nothing else has — but it no longer gets to claim the run is alive.

## A crash no longer costs the completed work

`--results-dir` is written after every iteration, not once at the end. A run that scores iteration 1 and
then dies keeps iteration 1. Before this, a real failure in the improvement step discarded 200 completed
scored attempts because the step *after* them failed.

A failing improvement step also no longer kills the run. The loop stops proposing candidates, reports
every iteration it did score, exits non-zero, and records `improvement_error` in its output — so
`best_description` is still the best of what was actually measured.

## Resuming a run that died

Both loops take `--resume-from <results.json>`, the file a dead run left under its `--results-dir`
(each run writes into its own timestamped subdirectory: `<dir>/<timestamp>/results.json`). The
scored iterations in it are carried, so the loop continues at the next iteration rather than
re-measuring the baseline and every candidate it already paid for.

```bash
nohup bun ../operations/optimize-description.ts --eval-set <path> --skill-path <path> \
  --results-dir <dir> --resume-from <dir>/<timestamp>/results.json &

nohup bun ../operations/optimize-disclosure.ts --skill-path <path> --scenarios <path> \
  --results-dir <dir> --resume-from <dir>/<timestamp>/results.json &
```

The disclosure loop's candidate layouts are directories under `<dir>/<timestamp>/workspace`, and
the resumed run reads the incumbent from there by the absolute path the file records rather than
materializing it again — so that directory has to still exist; the resumed run itself gets a new
timestamped subdirectory. The file is validated before anything is spent — unreadable, malformed,
holding no scored layout, or naming a best layout whose directory is gone, it is refused as a
partial resume.
What is **not** checked is comparability: nothing reads the dead run's `envelope.json`, so a resume
under a different model, scenario set or target inherits figures that were never measured alike.
Resume with the same inputs, or start over.

## How a stopped run is reported

A stopped run says so rather than sitting at `running` forever, and a run that was killed outright is
reported as no longer reporting. The exact exit paths covered, the stale threshold and why it is set
where it is are in `schemas.md`, section "Run status files" — read it when a run's reported state and
its actual state disagree, since that section also says why status writes are never gated on `--verbose`.

That distinction is the whole point of the feature. A run in progress and a dead run look identical
from the outside, and the ambiguity is what makes people guess at durations.

## Progress inside the description report

The report `optimize-description.ts` opens shows a progress bar in the row where the running iteration's results
will appear, replaced by the real row when that iteration finishes. The baseline evaluation before
iteration 1 gets the same treatment, so the period that used to show nothing at all is now visible.

The one-line stderr indicator remains for the foreground case.
