# Progressive disclosure: what goes where, and how big things get

Skills load in three levels, and the whole point of the directory taxonomy is to control which level a given file lands in:

1. **Metadata** (`name` + `description`) — always in context, for every installed skill
2. **SKILL.md body** — in context whenever the skill triggers
3. **Bundled files** — only when needed, and scripts can execute without entering context at all

---

## Size limits

**SKILL.md: under 500 lines and under 5,000 tokens.** Both, not either. The line count comes from the standard's structural guidance; the token budget is the progressive-disclosure recommendation for the instructions level. They are not redundant — a 480-line file with long paragraphs can be 7,000 tokens and blow the budget while passing the line check. Measure both.

When you approach the limit, the answer is another layer of hierarchy with clear pointers about where to go next, not tighter prose. Move detail into `references/` and leave a sentence in SKILL.md saying what is in there and when to read it.

**Keep file references one level deep.** `references/grading.md`, not `references/prompts/grading.md`. Deeply nested reference chains make the model traverse to find out whether traversal was worth it.

**Reference files can be large.** A 2,000-line `references/api.md` is fine — it is only paid for when read. For very large ones, either put a table of contents at the top or, better, tell SKILL.md what to grep for: "search `references/tables.md` for the table name" costs a fraction of reading it.

**Information lives in one place.** If something is in SKILL.md *and* in a reference file, one of them will drift and the model will read both. Prefer the reference file for anything detailed, and keep SKILL.md to procedure, workflow and pointers.

---

## Pointers carry conditions, not just paths

Deferral only works if the model knows *when* to reach. A pointer that names a file and stops — "`references/schemas.md`." — tells the model the file exists, which is not the same as telling it to open the file at the right moment and only then. That gap is the single most common reason a well-written reference is never read, and it looks identical in the data to a reference nobody needs.

Three things earn their place in a pointer. The file, the condition that should make you open it, and — where it is not obvious — what goes wrong if you skip it. The third is what stops the model deciding it can guess.

> Read `references/events.md` **when** you are choosing which event to match, before writing the handler, because picking the wrong event is the defect that costs a whole debugging session.

Both failure directions are real defects, and they need opposite fixes:

| Symptom | What it means | Fix |
|---|---|---|
| Pulled on nearly every run | Body content paying an extra tool call to arrive late | Inline it |
| Pulled on no run, body points at it | Nothing needs it | Delete it |
| Pulled on no run, body never names it | It could not have loaded; its zero says nothing | Write the pointer |
| Pulled speculatively, then unused | The condition is vague — "for more detail" | Name the trigger |

A skill's own reader is the test: open SKILL.md, find each bundled file's mention, and ask whether it tells you what would have to be true for you to stop and read it. `../scripts/measure-disclosure.ts` measures the same thing empirically, and `../scripts/optimize-disclosure.ts` goes on to restructure from what it found; read `disclosure-optimization.md` when you have one of its reports open and are deciding what to adopt.

**Flow matters as much as placement.** A reference should be openable at the moment its condition fires and answer the question completely. Where two files are always needed together, that is one file. Where one answers half a question, it should say where the other half is — a reader who has to guess at the second hop usually does not take it.

**Vocabulary has to match across the boundary.** If the body says "tool grant" and the reference says "permissions", the model bridges that itself and sometimes will not. One term per concept, everywhere.

## Two things that belong in the body regardless of size

**Gotchas.** Environment-specific facts that defy a reasonable assumption — a field that silently means the opposite of what it looks like, an exit code that discards stdout. These invert the disclosure rule: the model cannot decide to open a file about a trap it does not know exists, so a gotcha behind a pointer is a gotcha that arrives after the mistake. Keep them in the body, keep them concrete, and keep general advice ("handle errors appropriately") out of the list.

**The validation loop.** If the skill ships a validator, the body says to run it, fix, and run it again until it passes. Mentioning a validator once produces one run; describing the loop produces the loop.

## Diagrams cost tokens on every invocation

A mermaid graph in a SKILL.md body is *text the model reads*, paid for on every invocation, and against a table it is usually more tokens for less clarity. So the question is never "would a diagram look good here" but "is the branching structure itself the content".

Worth it: a decision tree with real branches (which event, which transport, which component type), or a fan-out-and-barrier shape that prose flattens badly. Put those in `references/`, behind a condition, so only the reader standing at that fork pays for them. Not worth it: anything in a body that restates a table or list already there, a sequence diagram of a two-step process, or decoration for a section that looks plain.

Keep any diagram under roughly fifteen nodes. One nobody can follow in raw source has failed for the model and for the human at once.

---

## The taxonomy is decided by load mode, not content genre

This is the part that gets miscategorised. The three standard directories are not "code, docs, and files" — they are three different things the model can do with a file:

| Load mode | What enters context | Directory |
|---|---|---|
| **Execute** | only the output; never the source | `scripts/` |
| **Read** | the file's full content | `references/` |
| **Copy into output** | ideally nothing | `assets/` |

`examples/` is not a fourth load mode. It is a labelled *genre* inside the read mode: a complete **specimen** of the skill's input or output, valuable for its shape rather than for prose explaining it.

**The decisive evidence** is a skill in Anthropic's own public repository that ships `.ts`-equivalent scripts in *both* `scripts/` and `examples/`, with opposite instructions. Its `scripts/` are documented as black boxes — *"use `--help` to see usage, then invoke directly… DO NOT read the source… they exist to be called directly rather than ingested into your context window."* Its `examples/` sit under a heading reading **"Reference Files"**, described as patterns to look at. Same file type, same language, opposite verb. The file type tells you nothing; what SKILL.md tells the model to *do* with the file tells you everything.

---

## The decision rule

Apply in order; first match wins. The test is always the verb SKILL.md uses.

1. **`scripts/`** — SKILL.md tells the model to *run* this file, and only its output matters.
   *Check:* is the file named inside a command invocation (`bun scripts/x.ts`, `bash scripts/x.sh`, `./scripts/x`)?

2. **`assets/`** — the file is copied, embedded, or filled in to become part of the artifact the model produces; the model needs its bytes, not its meaning.
   *Check:* does the produced artifact contain this file, or a filled-in version of it? Fonts, logos, images, document shells, HTML or React boilerplate, output templates.

3. **`examples/`** — the model *reads* this file as a whole specimen of the skill's input or output and imitates its shape.
   *Check:* is it a complete instance of the thing the skill consumes or produces, valuable for its structure rather than for prose about it — and does SKILL.md say *read* or *follow this pattern* rather than *run* or *copy*?

4. **`references/`** — the model *reads* this file for explanation, rules, schemas, or API detail. Prose about the domain, not a specimen of it. The default for anything read-into-context that is not a whole specimen.

5. **Anything else** (a LICENSE, plugin metadata, a single small template) → skill root, flat.

**Two guardrails that catch most misfiling:**

- **A `scripts/` file is never read; an `examples/` file is never run.** If SKILL.md violates that, the file is in the wrong directory. This one check catches the confusion the taxonomy exists to prevent.
- **Do not create a directory for one file.** A single specimen belongs at the skill root as `example.md`, not `examples/example.md`. Plenty of good skills have no subdirectories at all.

### Hard cases

**An example that is runnable code.** `examples/` if SKILL.md says read it and write something similar; `scripts/` if SKILL.md says invoke it. Runnability is irrelevant — the verb decides.

**A template the model fills in.** `assets/`. If the model *fills in* the file, it is a template. If the model looks at a filled-in one to learn the shape and then writes its own from scratch, that is a specimen and belongs in `examples/`.

**A worked walkthrough in prose.** `references/`. Distinguishing test: delete the explanatory prose. If a usable artifact remains, it was a specimen; if nothing remains, it was documentation.

**Sample input or output data.** Split by role. Data the model *reads* to learn a format goes to `examples/` if it is a whole specimen and `references/` if it is a schema or field description. Data the model *hands to a script* as a fixture, or *ships inside* the output, goes to `assets/`. One caveat worth knowing so you do not fail a skill that followed the spec literally: the specification lists "data files (lookup tables, schemas)" under `assets/`, which sits awkwardly with the same spec's framing of `assets/` as files not loaded into context — a schema is read by definition. Practice sits on the spec's side.

---

## The status of `examples/`

`scripts/`, `references/` and `assets/` are named in the Agent Skills specification, each with its own section. **`examples/` is not.**

It is nonetheless standard-*conformant*: the spec's directory tree ends with "any additional files or directories", and its optional-directories section is not exhaustive-by-exclusion. Claude Code's own documentation names `examples/` with a precise semantic ("example output showing the expected format"), VS Code's documentation names it, and Anthropic uses it in its public skills repository.

So: **a reviewer must never flag `examples/` as non-conformant, and must never require it.** A skill that folds its specimens into `references/`, or keeps a flat `examples.md` at the root, is fully correct. Treat `examples/` as an optional, widely-used, spec-permitted specialization of `references/` — one that exists because `references/` otherwise conflates "documentation explaining X" with "a specimen of X".

Keep `assets/`. Its low usage in developer-tooling skills is a sampling artefact of what those skills do; skills that produce documents, decks, spreadsheets or branded artifacts use `assets/` as their primary payload directory, and the spec's own best-practice guidance names it as the home for output templates.

---

## When a fifth directory earns its place

Four names cover placement for nearly every skill, and a fifth should be treated as a smell until it defends itself. This skill ships one that does: `eval-viewer/`.

It holds the eval report generators, the modules they share, and the HTML templates they fill in — one sub-application whose parts are only meaningful together. Split by load mode it would land in two places: generators in `scripts/`, templates in `assets/`, with nothing in either saying they are one component. That split changes nothing about what enters context, which is the only thing the taxonomy exists to control — the generators are still run and the templates are still filled in. It costs legibility and buys conformance to a rule whose purpose is already met.

So the question for a fifth directory is not whether the four could have absorbed the files. It is whether holding them together preserves something the split would destroy, and whether a reader can still tell at a glance how the contents load. Where either answer is no, use the four.
