# Renamed and retired artifacts

Measurement records are immutable. When an artifact is renamed, moved or retired,
the records that measured it stay exactly as they were recorded, and this file
maps the name they use to what exists today. Nothing in `results/`, `trigger/`,
`disclosure/` or `MEASUREMENTS.md` is edited or re-run to match a later reality.
Sibling note: `MEASUREMENT-CAVEATS.md`, which records defects in the harness that
produced these records.

Every record in this corpus was produced on 2026-08-08 against a tree that no
longer exists under those names. If a record names something you cannot find, look
here before assuming the record is wrong.

## Skills

### `create-plugin` → `plugin-creator` — renamed 2026-08-09

The skill was renamed. `skills/create-plugin/` is now `skills/plugin-creator/`,
and its frontmatter reads `name: plugin-creator`. Nothing about what it does
changed in the rename, so the 2026-08-08 numbers remain measurements of this
skill — read under its old name.

Records naming `create-plugin`:

- `disclosure/create-plugin.json`
- `trigger/create-plugin.json`
- `trigger/create-plugin-inventory.md`
- `results/baseline/create-plugin.json`
- `results/after/create-plugin.json`
- `results/final/create-plugin.json`
- `results/optimize/create-plugin.json`
- `results/disclosure/create-plugin.json`
- the `.log` beside each of those `.json` files
- `results/{baseline,after,final,optimize,disclosure}/PROGRESS`
- `MEASUREMENTS.md`, at seven sites
- `drivers/run-measurement.ts`, in `ALL_SKILLS`

Two records also name its bundled files under the old path. `references/path-anchors.md`
and `references/shared-code-architecture.md` moved with the skill and are now under
`skills/plugin-creator/references/`. `skills/plugin-creator/references/verification.md`
postdates the run and appears in no record.

`MEASUREMENT-CAVEATS.md` refers to this skill by its current name, `plugin-creator`,
because that note was written after the rename. Both names mean the same skill.

### `hook-creator` and `hook-reviewer` — retired 2026-08-09

Hook validation was removed from the plugin. The `hook-creator` skill and the
`hook-reviewer` agent no longer ship, and hooks are now an uncovered component:
no creator skill, no validator target type, no reviewer agent. The skill's source
was not deleted — it is parked, unshipped, at `future/hook-testing/hook-creator/`,
with all nine bundled files the disclosure record measured still present under
that path.

Records naming `hook-creator`:

- `disclosure/hook-creator.json`
- `trigger/hook-creator.json`
- `trigger/hook-creator-inventory.md`
- `results/baseline/hook-creator.json`
- `results/after/hook-creator.json`
- `results/disclosure/hook-creator.json`
- `results/optimize/hook-creator.json`
- the `.log` beside each of those `.json` files
- `results/{baseline,after,disclosure,optimize}/PROGRESS`
- `MEASUREMENTS.md`
- `drivers/run-measurement.ts`, in `ALL_SKILLS`

Records embedding `hook-reviewer` inside stored description strings:

- `results/baseline/hook-creator.json`
- `results/optimize/hook-creator.json`

These runs happened. The numbers in them are valid measurements of artifacts the
plugin no longer ships. Do not edit them to drop the retired names, and do not
re-run them against the current tree — a re-run would measure a different set of
artifacts and silently overwrite evidence of what was actually observed on
2026-08-08. Read them as history, and read `MEASUREMENTS.md` alongside them,
which also predates the retirement.

## Repository

### `skill-creator` → `plugin-kit`

The repository was renamed. Every `trigger/*-inventory.md` records its target as an
absolute path on the measurement box, rooted at the old name:

```text
- **Target**: `/home/claude/work/skill-creator/skills/create-plugin`
```

Read `/home/claude/work/skill-creator/` as the repository root. The skill named
`skill-creator` still exists and is unrelated to the repository name — the
collision is why this entry is here.

## Bundled files — renamed

The `results/disclosure/*.json` records name each bundled file that was offered to
a scenario. These names changed after the run.

| Name in record | Today | Evidence |
|---|---|---|
| `references/analyzer.md` | split into `shared/references/benchmark-notes.md` and `shared/references/comparison-analysis.md` | `MEASUREMENTS.md` naming note |
| `references/comparator.md` | `shared/references/blind-comparison.md` | `MEASUREMENTS.md` naming note |
| `skills/skill-creator/references/frontmatter.md` | `skills/skill-creator/references/skill-frontmatter.md` | `MEASUREMENTS.md` naming note |
| `skills/agent-creator/references/frontmatter.md` | `skills/agent-creator/references/agent-frontmatter.md` | `MEASUREMENTS.md` naming note |
| `skills/command-creator/references/frontmatter.md` | `skills/command-creator/references/command-frontmatter.md` | `MEASUREMENTS.md` naming note |
| `scripts/run-eval.ts` | `shared/scripts/measure-triggering.ts` | file header: "Port of run_eval.py" |
| `scripts/run-loop.ts` | `shared/scripts/optimize-description.ts` | file header: "Port of run_loop.py" |
| `scripts/quick-validate.ts` | `shared/scripts/validate-skill.ts` | file header: "Port of skill-creator's `quick_validate.py`"; 19,525 → 19,542 bytes |
| `scripts/aggregate-benchmark.ts` | `shared/scripts/aggregate-results.ts` | 32,066 → 32,067 bytes |
| `scripts/shoot-page.ts` | `shared/scripts/capture-page.ts` | 9,346 → 9,368 bytes |
| `scripts/improve-description.ts` | `shared/scripts/propose-description.ts` | 17,705 → 18,362 bytes; `optimize-description.ts` names it as its proposal step |

`shared/scripts/validate.ts` and `shared/scripts/lib/envelope.ts` are new work from
the same restructure and appear in no record. Three records name a `frontmatter.md`,
one per skill, and the three resolve to three different files — check which record
you are reading before resolving that name.

## Bundled files — moved, same name

The shared-layer restructure lifted most of `skill-creator`'s bundled files out of
the skill. The disclosure record for `skill-creator` names all of them under the
skill; only two are still there.

| Recorded under | Today |
|---|---|
| `references/authoring-checklist.md` | `skills/skill-creator/references/` — unmoved |
| `assets/eval_review.html` | `skills/skill-creator/assets/` — unmoved |
| `references/{description-optimization,description-writing,disclosure-optimization,distribution-targets,environments,eval-evidence,grader,plugin-skills,progressive-disclosure,pure-bun,running-detached,schemas,typescript-standard}.md` | `shared/references/` |
| `scripts/**` — the twenty files whose names did not change | `shared/scripts/` |
| `eval-viewer/**` — seven files | `shared/eval-viewer/` |

`shared/references/portability.md` postdates the run and appears in no record.

The four other skills' bundled files kept both name and location, except for the
`frontmatter.md` renames above and `create-plugin`'s move under the skill rename.

## Not covered here

`drivers/run-measurement.ts` is the harness driver, not a record. It still points
at `skills/skill-creator/scripts/` for all three phases and still lists
`create-plugin` and `hook-creator` in `ALL_SKILLS`, so it cannot run as written.
Fixing it is a code change and is out of scope for this file, which maps names in
records rather than repairing tools.
