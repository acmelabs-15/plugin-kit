# Parked: hook authoring and the hook test harness

Moved here rather than deleted, in one move so the history stays legible.

## Why it left the kit

Every other artifact in plugin-kit is **sampled**: run it N times, compute a rate,
because the model's choice is stochastic. A hook is **tested** — one payload in,
one assertion on exit code and stdout shape. `scripts/test-hook.ts` says so in its
own docblock, and that difference in epistemology is why hook-creator was the only
creator carrying its own `scripts/` and `scripts/lib/`.

Against the four standard operations a hook fills one cell of four. There is no
description to optimize, because a hook is matched on events rather than chosen
from natural language. There is nothing deferred, so no disclosure to optimize.
And "benchmark a hook" collapses into the test. A whole row for one cell.

## What is still supported, and where

Removing the creator did not remove support for the artifact:

- **`validate --target-type hooks`** covers matcher syntax, handler existence and
  the exit-code contract.
- **`plugin-creator`** keeps its hooks section, because plugins bundle them.

## What is worth keeping here

`scripts/test-hook.ts` and `scripts/lib/events.ts` are good and they belong in a
testing kit rather than a measurement kit. `lib/events.ts` in particular is the
machine-readable twin of the event table — per-event matcher semantics, exit-2
behaviour, and which `hookSpecificOutput` keys each event reads — and it is
asserted against its own fixtures.
