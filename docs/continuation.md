# plugin-kit — continuation prompt

You are picking up a project mid-restructure. This document is the whole handover: what the
code is, what the design is, the gap between them, the decisions already made and why, and
what to do next. There is no prior conversation to refer to.

**Verify before you act.** Every claim in §1 was read off a snapshot. Check it against the
tree. If something no longer holds, say so and stop rather than working around it.

**Do not relitigate §4.** Those eight are settled, and each carries the evidence that settled
it. Three of them went against the reviewer's own first recommendation — those are marked, and
they are where to look if one turns out wrong.

---

## 1. Where the code is right now

Two commits: `chore: initialize plugin-kit repository`, then
`Restructure: shared layer, generic validate, results envelope`.

**What exists and works:**

```
plugin-kit/
├── .claude-plugin/plugin.json
├── agents/            6 reviewers, 224–302 lines each
├── skills/            5 creators: skill, agent, command, mcp, plugin
├── future/            hook-testing/ — the parked hook-creator
├── evals/
├── docs/
└── shared/
    ├── references/    17 .md
    ├── rules/         10 .ts — per-artifact checks + registry + types + collisions
    ├── scripts/       13 entry points + lib/ (15) + __tests__/ (26)
    └── eval-viewer/   3 .html + theme.ts
```

- `validate.ts` takes `--target-type skill|agent|command|mcp|plugin|hooks`, with
  `--with-environment` gating the collision check. When not passed it reports that collision
  checking **was not performed** — never "no collisions".
- `shared/scripts/lib/envelope.ts` — 919 lines. Emitted by `measure-triggering`,
  `optimize-description`, `optimize-disclosure` and `validate`. Carries `run`
  (`model`, `workers`, `timeoutSeconds`, `runsPer`, `evalSetHash`, `installState`,
  `targetSha`) and `provenance` (`tokenizer`, `unit`, `scored`, `excluded`, `failed`,
  `timeoutPolicy`, `caps`), plus `COMPARABILITY_KEYS`, `compareRuns`,
  `explainIncomparability`.
- **1,131 tests pass, 0 fail.** `tiktoken` is a declared devDependency and about ten tests
  assert warning-free output that a missing tokenizer breaks — run `bun install` before
  concluding anything from a red suite.

**What does not exist:** no `report.ts`, no `measure-disclosure`, no `measure-outcomes`
(benchmark is still a manual procedure in SKILL.md), and no build step.

---

## 2. The design target, and the size of the gap

`docs/` carries an architecture document. **None of its proposed `shared/` tree exists.**
Checked file by file:

| Proposed | Status |
|---|---|
| `bin/`, `shared/cli.ts`, `shared/env.ts`, `shared/capabilities.ts` | missing |
| `shared/{schemas,parse,discover,operations,report,fixtures}/` | missing |
| `shared/{references,rules,scripts,eval-viewer}/` | exist — the restructure's output |

So this is a **rewrite of the shared layer**, not an increment. Roughly 69 `.ts` files get
re-homed, plus new files that have no antecedent (`cli.ts`, `env.ts`, `capabilities.ts`, the
fixtures corpus, `template.html`).

That is fine — the proposed tree is better than what exists, because it names files by
**function** (`parse`, `discover`, `validate`, `operations`, `report`) where the current tree
names them by **provenance** (`scripts` means "was a CLI", `scripts/lib` means "was imported
by a CLI", `rules` means "added during the restructure"). But know the size before you start.

**Two gaps in the proposed tree, to close before building it:**

1. **No home for the domain-free stdlib.** Ten modules exist today with no destination in the
   proposed layout: `pool`, `mt19937`, `stats`, `fnmatch`, `mime`, `pyfloat`, `zipwriter`,
   `subprocess`, `progress`, `browser`. They import nothing above them and belong in a
   `shared/util/` the doc does not have. Add it, with the rule that nothing in it may import
   from `operations/`, `validate/` or `schemas/`.
2. **`operations/` collapses measure and optimize.** It lists one file per operation, but
   decision 6 below needs a measure entry point that is not an optimizer, and there is already
   evidence the split is real: two independent callers contort `optimize-disclosure` with
   `--max-iterations 1 --holdout 0` to get a plain measurement out of it. Model measure and
   optimize as separate entry points over shared machinery.

**What the architecture document supersedes:** an earlier proposal in the review thread for a
`bin/ core/ checks/ schema/ util/` layout. Discard that. The architecture document's
function-named tree is the target, amended by §4 and the two gaps above.

---

## 3. How it got here

The constraints below are not preferences. Each came from something that went wrong.

**The kit was skill-shaped.** All tooling lived inside `skills/skill-creator/`, and the five
sibling creators reached it by climbing out of their own directory — 13 traversals to
`../skill-creator/references/…`. That works for six creators and breaks the moment a second
artifact wants `validate`. The restructure moved the shared layer out and made `validate`
generic over `--target-type`.

**Hooks were dropped as a creator**, on the evidence of the moved code's own docblock: *"A hook
fires deterministically, so it can be tested rather than sampled."* Everything else here is
sampled — run N times, compute a rate, because a model's choice is stochastic. Different
epistemology, different tooling. See decision 7 for what happened to the checks.

**A triggering sweep once reported 21% recall. The real figure was 71%.** A stale copy of the
target was installed under a previous name and won sixteen probes. Nothing in the output said
an older copy existed. `installState` and `targetSha` in the envelope are that fix, and they
are why §4.1 refuses to drop those fields.

**A test asserted something against itself.** A temp-path test built `root` by concatenating
`TMPDIR`, then compared the implementation's output to that same string. On Linux `TMPDIR` is
unset, both sides were byte-identical, and the assertion passed by comparing a string to
itself. On macOS `TMPDIR` ends in `/`, the implementation normalised `//` to `/`, and the
tautology broke. The same defect shape appears again in decision list item "fixtures guard"
below — check for it whenever a test builds its own expectation.

**Measurement records are immutable.** During the restructure the evals still named
pre-rename reference files. A mapping note was added rather than the records being edited,
because editing a record to match a later rename is how a measurement stops being evidence.
Keep doing that.

---

## 4. The eight decisions

### 4.1 The results contract — wrap, do not replace

`{input, output}` is the **outer wrapper**. The existing `run` and `provenance` blocks go
**inside** it, unchanged.

```ts
const ReportEnvelope = z.object({
  input:      z.object({ artifact: ArtifactRef, operation: OperationName }),
  run:        RunBlock,      // from lib/envelope.ts — do not redefine
  provenance: Provenance,    //  ”
  output:     OperationResult,
});
```

The reason is the content model, not the existing code. `run` and `provenance` are the only
design that records the conditions under which a number is valid — see the 21%/71% incident
above. `compareRuns` and `explainIncomparability` keep their job: the report **refuses** to
draw a delta between runs whose `run` blocks disagree, and names the fields that moved.

### 4.2 Schemas are Zod, two layers per artifact · *changed on evidence*

The architecture document gave four reasons against Zod for artifact validation. **Two are
wrong**, tested directly:

| Claim | Result |
|---|---|
| "Zod short-circuits" | False. A three-field object with three bad fields returned **3 issues**. |
| "Zod has no warning tier" | False. `superRefine` + `params: { severity }` + `fatal: false` returns both, tagged. |

So Zod is the schema mechanism, in two layers:

```ts
export const SkillShape = z.object({ /* pure: fields, types, limits */ });
export const SkillFull  = SkillShape.superRefine(async (v, ctx) => { /* disk reads */ });
```

Unit tests parse the pure layer, so a description-length test needs no filesystem. This
supersedes both the hand-rolled-collector split and an earlier plain-data-records proposal.

### 4.3 Zod ships by auto-install — no build step

Source stays the shipped artifact. Bun auto-installs on first run. No `dist/`, no `bun build`,
no compile.

`check-bun-purity.ts` scans for **spawned runtimes** — `node`, `npx`, `npm`, `python3` as
command tokens — so a package import does not trip it. CI stays green.

- **Amend `pure-bun.md`**: its opening says nothing is assumed on the machine except git. Add
  that a network is assumed on the first run.
- **Pin exactly.** `zod@^4.1.0` permits `4.9.x`. Use `zod@4.1.0`.

### 4.4 `envelope.ts` — schema to Zod, keep the logic

- **Delete** `validateEnvelope` and `assertValidEnvelope`. Zod covers both.
- **Convert** `RunBlock`, `Provenance`, `HeadlineMetric`, `Verdict`, `Envelope` to Zod; types
  come from `z.infer`.
- **Keep untouched** `compareRuns`, `explainIncomparability`, the hashing, `detectInstallState`,
  `installConflict`. Domain logic, and Zod adds nothing to it.

About a third of the file. Count how many existing tests touch the two validators first.

### 4.5 Report flow — the script injects, the agent narrates

Replace the architecture document's five-step flow:

1. A **script** reads the envelope and writes the page with the data already embedded.
2. **Claude** then edits only the `<!-- AGENT: findings -->` slot, 3–5 one-line items.

Data cannot be half-injected. A missing narrative shows as an empty section rather than as
wrong numbers — which is what the old "Edit the JSON in" step produced silently.

### 4.6 The plugin total is measured, not optimized · *narrower than first proposed*

Plugin gets `measure --property disclosure`, summing the always-on cost against the
**25,000-token combined re-attach budget**. It does **not** get a fourth optimizer.

An optimizer proposes a restructure, and every fix for an over-budget plugin lands inside one
skill. The only plugin-level proposal available is which skills ship together, which is a
packaging decision.

### 4.7 Hooks are retired · *against the recommendation*

Delete `shared/rules/hooks.ts` with the creator. No hooks row, no `hooks` key in
`CAPABILITIES`.

The dependency is clean, checked: only `registry.ts:11` imports `hooksRules`, and
`rules/plugin.ts` references hooks as a **layout path** (`"hooks": "hooks/hooks.json"`) rather
than calling the checks. Removing it is `hooks.ts`, the registry import, and the `hooks`
target-type entry. Nothing else breaks.

Going unchecked from here: matcher syntax, handler existence, the exit-code contract.

### 4.8 Five reviewers, one per artifact

Keep `skill-`, `agent-`, `command-`, `mcp-` and `plugin-reviewer` — 224 to 302 lines each. Do
**not** merge into one `artifact-reviewer.md`. `hook-reviewer.md` goes with 4.7.

`plugin-creator` keeps the names it routes to. While you are here, read the five and check how
much prose repeats — shared review doctrine belongs in `shared/references/`, not five times.

---

## 5. Open — decide these, do not guess

**The matrix cannot express "measure without optimize".** Its four columns are validate,
benchmark, optimize-description, optimize-disclosure. Decision 4.6 creates a plugin capability
that is none of them. Either add measure columns, or place the plugin measurement outside the
grid and say so.

**Where the 25,000-token figure comes from.** It is now load-bearing for a capability that
exists because of it. Find the source.

**`when_to_use` and the 1,536-character cap.** `when_to_use` is not one of the six frontmatter
fields that survive packaging (`name`, `description`, `license`, `compatibility`, `metadata`,
`allowed-tools`). Either it belongs to a different surface, or the figure is about something
other than SKILL.md frontmatter. Cite it before a validation tier depends on it.

**Reference count.** `shared/references/` is 17 files, 2,980 lines. The eval cluster is 837
lines across five files — `grader`, `blind-comparison`, `comparison-analysis`,
`benchmark-notes`, `eval-evidence` — and `schemas.md` alone is 645. Both look over-split. **Do
not hand-merge.** `optimize-disclosure` reports per-file pull rates and has never been run on
this repo; run it and let co-pull decide. Files pulled on the same runs merge; files pulled on
different runs do not.

---

## 6. Sequence

Do not attempt several of these in one pass. Report after each.

1. **Apply the corrections that are not decisions** (below). Cheap, and they stop the
   architecture document from being wrong while it is being implemented.
2. **Retire hooks** (4.7) — three edits, clean dependency.
3. **`shared/util/`** — give the ten domain-free modules a home and add the import-direction
   test. Mechanical, and it unblocks the re-home.
4. **Zod schemas, two layers** (4.2) — one artifact first, end to end, before doing five.
5. **`envelope.ts` to Zod** (4.4) — schema only; leave the domain logic.
6. **Re-home into the function-named tree** (§2) — `parse`, `discover`, `validate`,
   `operations`, `report`. Biggest diff, no behaviour change; do it when the suite is green
   and nothing else is in flight.
7. **`measure-disclosure`** — split the fused optimizer, then delete the
   `--max-iterations 1 --holdout 0` contortion from both callers.
8. **`report.ts`** (4.5) — after several operations emit the envelope. A shared renderer built
   against one operation's data is a fifth renderer with a better name.
9. **`measure-outcomes`** — the benchmark as a script, with per-artifact baselines. Largest
   job; depends on everything above.

**Per-artifact baselines, since they do not generalise:** skill → same prompt, skill absent;
agent → same task, no delegation; mcp → server removed; plugin → uninstalled;
**command → no natural baseline, because the user typed it.** The only comparison available
for a command is the same request without the command's body, which benchmarks the body rather
than the artifact. Label it as a different measurement.

### Corrections that are not decisions

| Fix | Where |
|---|---|
| `vitest` → `bun:test` | The house rule names this case, and 1,131 tests already run under `bun test`. Keep `tiktoken` — the 5,000-token check degrades without it. |
| The fixtures guard test | It cannot fail: fixtures live at `shared/fixtures/**`, which never matches `skills/**`. Assert the **scan roots** exclude `shared/`, and assert the corpus is non-empty so the replacement cannot go vacuous too. |
| Cell count | 15, not 14. `4 + 4 + 3 + 2 + 2`. |

---

## 7. Standing conventions

Several are not recoverable from the code.

1. **A measurement record is immutable.** Renames get a mapping note beside the record, never
   an edit to the record.
2. **Removing or renaming an artifact requires re-measuring every description that named it.**
   The removal is not done until that list is enumerated.
3. **`caps` is only for coverage** — what the run did not look at. A caveat about what a
   *field* means belongs beside that field.
4. **Every optimizable property has a doctrine reference and a measurement reference.** Do not
   merge `description-writing` + `description-optimization`, or `progressive-disclosure` +
   `disclosure-optimization`. Different moments, different readers.
5. **Do not hand-merge references.** Measure co-pull first.
6. **`validate` never branches on artifact type.** Per-artifact behaviour lives behind the
   registry.
7. **Neither timeout policy is unified** — each operation declares whether a timed-out unit is
   `scored`, `excluded` or `not-applicable`.
8. **Empty matrix cells are the predicates working.** `optimize description` applies iff a
   model chooses the artifact from natural language; `optimize disclosure` applies iff the
   artifact has content that can be deferred. Do not fill a cell because the grid looks
   incomplete.
9. **Rate limiting corrupts rather than slows a measurement**, because a rate-limited run is
   recorded as a failed run. Do not raise worker counts without watching the failure counts.
10. **A collision check that could not look must say so**, never report clean.
11. **Nothing caches a resolved `${CLAUDE_PLUGIN_ROOT}`**, and nothing writes state there — an
    update replaces that directory.

---

## 8. Evidence hygiene

Two figures may appear in older notes and were measured in a **different repo**
(`ask-user-question`), not here:

- needed-reference retrieval moving from 70% to 80% after splitting a reference by moment-of-need;
- a triggering recall figure of 21% that was really 71% once a stale duplicate was removed.

Both are real and both motivate conventions above. Neither was measured in plugin-kit. Do not
cite them as local evidence — `evals/README.md` documents the same stale-target failure class
from this repo's own history, and that is the better citation.
