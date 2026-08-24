# Measurement caveats

Measurement records are immutable. When a defect is found in the harness that
produced a record, the record stays exactly as it was recorded and the caveat is
written here. Nothing in `MEASUREMENTS.md`, `results/`, `trigger/` or
`disclosure/` is edited or re-run to match a later reality. Sibling note:
`RETIRED-ARTIFACTS.md`, which maps names those records use to artifacts that no
longer ship.

## Truncated descriptions in the 2026-08-08 triggering run — found 2026-08-09

The run recorded in `MEASUREMENTS.md` read each artifact's description through
`shared/scripts/lib/frontmatter.ts`, whose block-scalar collection ends at the
first line not opening with two spaces or a tab. A blank line opens with neither,
so collection stopped at the first paragraph break and everything after it was
dropped.

Every number in that run is a real measurement of a real string. It is not the
string the artifact ships.

| skill | ships | measured | loss |
|---|---|---|---|
| `skill-creator` | 947 | 567 | 40% |
| `command-creator` | 832 | 586 | 30% |
| `plugin-creator` | 891 | 688 | 23% |
| `agent-creator` | 942 | 735 | 22% |
| `mcp-creator` | 943 | 943 | 0% |

Characters, whitespace-collapsed so the reader's newline-to-space join is not
counted as loss. `plugin-creator` is the skill `MEASUREMENTS.md` records under its
former name, `create-plugin`.

`mcp-creator` lost nothing to truncation — its description carries no blank line.
All five, however, had their paragraph breaks flattened to single spaces, so even
`mcp-creator`'s row describes a differently-shaped string than the one that ships.

Agent descriptions were affected far worse, losing 78-81% with every `<example>`
block among the dropped text. No agent has ever appeared in a triggering run, so
no record here carries an agent measurement.

The measurement path was corrected on 2026-08-09 — agents in `54dba23`, skills
alongside this note. Measurements taken after that fix are not comparable with the
2026-08-08 baseline: they describe longer, differently-shaped strings. That is the
correct outcome rather than a regression. The baseline measured what the harness
could see; the harness can now see what ships.

## The disclosure reproduction command is obsolete (2026-08-09)

`MEASUREMENTS.md` reproduces the disclosure numbers with:

```bash
bun shared/scripts/optimize-disclosure.ts --skill-path skills/<name> \
  --max-iterations 1 --holdout 0 ...
```

Those two flags were never optimizer settings. They were how the driver said "just
measure": `--max-iterations 1` stops after the baseline sweep, `--holdout 0` stops
the sweep splitting a set nothing is going to be selected on. Two callers arrived
at the same workaround independently, which is the usual sign of a missing entry
point rather than a shared preference.

That entry point now exists — `shared/scripts/measure-disclosure.ts` — and
`evals/drivers/run-measurement.ts` uses it. The sweep underneath is unchanged and
shared: both scripts call `shared/scripts/lib/disclosure-measure.ts` for the run,
the grading and the fold from runs into a file table, so a measurement pass and the
optimizer's baseline cannot disagree.

The command line in `MEASUREMENTS.md` is left exactly as it was. It records what was
run on 2026-08-08 and it still works — `--max-iterations 1 --holdout 0` remains a
valid way to drive the optimizer. Reproducing that record should use it. New
measurements should use `measure-disclosure.ts`.

Two shapes differ, so the outputs are not byte-comparable even where the numbers
agree. `measure-disclosure.ts` writes a flat `MeasureOutput` — `body_tokens`,
`context_tokens`, `pass_rate`, `files` — where the optimizer writes a selection:
`baseline_*` against `best_*`, an `iterations` array, `applied_edits`. Under
`--max-iterations 1` every one of those pairs held the same number twice, which
invited a reader to compare them and conclude a restructure had been evaluated.
The stored results under `evals/results/disclosure/` are in the optimizer's shape
and stay that way.

## The `/morning` false fire was not neighbour collision — found 2026-08-23

`MEASUREMENTS.md:94-96` writes off one of `command-creator`'s false fires:

> command-creator fires on *"set up /morning so it runs every weekday"* — a
> `/morning` skill is installed here, so this is neighbour collision rather than a
> description defect. `check-overlap.ts` reports the same pair.

The harness isolates each run from the machine, so a `/morning` installed at user
scope was not reachable by the model that answered that query. Every sweep copies
the target into a throwaway project root under a unique alias —
`measure-triggering.ts:277-279` and `:351-352` — and runs `claude` there with
`--setting-sources project` and `--strict-mcp-config` (`:709-710`, `:713`), cwd set
to that root (`:719`).

Measured 2026-08-23 rather than inferred. A probe composed the same argv against a
temp root holding one uniquely-named skill:

| condition | skills enumerated |
|---|---|
| with `--setting-sources project --strict-mcp-config` | 11 — the probe skill and ten built-ins |
| same cwd, flags removed | 118 — loose user skills and the whole plugin layer |

Nothing at user scope survived the isolated enumeration, `ask-user-question`
included — installed loose in `~/.claude/skills`, and the direct analogue of
`/morning`. Behaviour agreed with the enumeration: one routing query produced no
tool calls isolated, and reached for a plugin skill and issued a `Read` with the
flags removed.

The evidence the record cites is machine-scoped, and both halves of it are the same
observation. `check-overlap.ts:166` scans `${HOME}/.claude/skills` and tags what it
finds `origin: "user"`; that is where `command-creator-inventory.md:57` gets
`` `morning` (user) ``, and it is also what "`check-overlap.ts` reports the same
pair" means. Neither speaks to what loaded during the run. The harness states the
distinction itself at `measure-triggering.ts:1563-1565`: what `detectInstallState`
reports "is the MACHINE's state, not the run's."

There was no run-scoped alternative to consult. No run in this corpus wrote an
envelope, so no `installState` was recorded for any of them, and a machine-scoped
sighting was the only install evidence available to whoever wrote the line.

**Consequence.** That false fire is a `command-creator` description defect, and it
is open. `MEASUREMENTS.md:86` counts six surviving false fires and calls three
"genuinely arguable rather than defects"; two are arguable, and this one belongs
with the real ones.

**No number moves.** The query is a hard negative that fired, and it scored as a
miss either way — reclassifying its cause changes no trigger rate, no row, no
total. This corrects an interpretation, not a measurement.

**What this does not establish.** The probe ran against the current harness. The
flags are present in the earliest committed form of it —
`525f5f5:shared/scripts/measure-triggering.ts:679,683`, the same commit that
published this record — so every version of the harness existing in this repository
isolates. The working tree that actually produced the 2026-08-08 run was never
committed, and that run happened on another machine
(`command-creator-inventory.md:3` records `/home/claude/work/skill-creator/`), so
its exact harness state is unrecoverable. If that tree lacked the flags, the line
was correct when written and is wrong now.
