# Authoring a skill in this repo

Placement inside a skill is decided by **load mode** — what the model does with the
file — never by file type.

| Load mode | Directory | What enters context |
|---|---|---|
| Execute | `scripts/` | only the output, never the source |
| Read | `references/` | the file's full content |
| Copy into output | `assets/` | ideally nothing |

`examples/` is not a fourth load mode. It holds a **specimen**: a complete example
of the skill's input or output, valuable for its shape.

The decisive test is the verb in `SKILL.md`. The same `.ts` file belongs in
`scripts/` if the body says invoke it and in `examples/` if the body says read it
and write something similar. Runnability decides nothing.

`shared/references/progressive-disclosure.md` carries the hard cases — a template
the model fills in, a worked walkthrough, sample data — and the test for when a
fifth directory earns its place.

## Body size

Under 500 lines **and** under 5,000 tokens. Both, not either: a 480-line file with
long paragraphs blows the token budget while passing the line check.

The 5,000 figure is the compaction boundary. Auto-compaction re-attaches the first
5,000 tokens of each skill and drops the rest, so a body past it silently loses its
tail until the skill is re-invoked.

## Depth is bounded at one

Every reference links directly from `SKILL.md`. A reference reached from another
reference gets partially read — Claude previews nested files with `head -100`
rather than reading them whole.

Fan-out is unbounded; depth is not.

## Cross-skill references

Skills reach into `shared/references/` by relative path
(`../../shared/references/description-writing.md`). Keep the vocabulary in
`CONTEXT.md` when writing them — the terms are shared across all five creators, so
a synonym coined here contradicts the other four.
