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
