# Retired artifacts

Measurement records are immutable. When an artifact is renamed or retired, the
records that measured it stay exactly as they were recorded, and this file maps
the name they use to what happened to it. Nothing in `results/`, `trigger/`,
`disclosure/` or `MEASUREMENTS.md` is edited or re-run to match a later reality.

## `hook-creator` and `hook-reviewer` — retired 2026-08-09

Hook validation was removed from the plugin. The `hook-creator` skill and the
`hook-reviewer` agent no longer ship, and hooks are now an uncovered component:
no creator skill, no validator target type, no reviewer agent.

Records naming `hook-creator`:

- `disclosure/hook-creator.json`
- `trigger/hook-creator.json`
- `trigger/hook-creator-inventory.md`
- `results/baseline/hook-creator.json`
- `results/after/hook-creator.json`
- `results/disclosure/hook-creator.json`
- `results/optimize/hook-creator.json`

Records embedding `hook-reviewer` inside stored description strings:

- `results/baseline/hook-creator.json`
- `results/optimize/hook-creator.json`

These runs happened. The numbers in them are valid measurements of artifacts the
plugin no longer ships. Do not edit them to drop the retired names, and do not
re-run them against the current tree — a re-run would measure a different set of
artifacts and silently overwrite evidence of what was actually observed on
2026-08-08. Read them as history, and read `MEASUREMENTS.md` alongside them,
which also predates the retirement.
