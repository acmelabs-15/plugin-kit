---
title: "ADR-002: Component is the canonical term, not artifact"
type: decision
status: ACCEPTED
date: 2026-08-31
updated: 2026-08-31
permalink: decisions/adr-002-component-is-the-canonical-term
tags:
- decision
- domain-model
- vocabulary
---

# ADR-002: Component is the canonical term, not artifact

## Status

ACCEPTED (2026-08-31)

## Context

The repository named one concept — the five things a plugin carries — with three
words at once. `artifact` held about 450 sites, all in `shared/*.ts`. `component`
held about 167, all in `skills/` and `agents/` prose. The CLI flag called the same
thing `--target-type`. `README.md` used both words for the same things in one
document.

The code already carried the seam. `shared/validate/validate.ts` defines
`asArtifactKind()` whose only job is translating the flag's vocabulary into the
envelope's, and `ENVELOPE_ARTIFACTS` restates a list that `RULES` in
`shared/validate/rules/registry.ts` already holds. Both lists are the same five
kinds, so the words are exact synonyms rather than different scopes.

The first `CONTEXT.md` forced the choice: a glossary cannot canonize two words for
one concept.

## Decision

**Component** is the canonical term. `artifact` and `target type` go under
`_Avoid_` in `CONTEXT.md`.

`artifact` lost on collision. It already carries two further senses inside this
repository's own subject matter: a shipped distribution unit (`README.md` calls an
MCPB bundle "its artifact") and a retired eval set (`evals/RETIRED-ARTIFACTS.md`).
A glossary entry cannot own a word doing three jobs. `component` also matches the
word Claude Code's own documentation uses for what a plugin carries, and it
already dominates the human-facing surface, where a wrong word costs most.

## Consequences

The code contradicts the glossary until it is renamed. `ArtifactKind`,
`ArtifactKindSchema`, `ENVELOPE_ARTIFACTS` and `asArtifactKind` keep the
non-canonical word across roughly 450 sites. The rename was deliberately deferred
rather than forgotten: it is mechanical, it touches the results envelope that eval
JSON is written against, and it deserves its own change with its own test run.

`--target-type` is a published CLI flag. Renaming it breaks every documented
invocation, so it stays until a version boundary makes the break acceptable.
