# TypeScript conventions

Where tests and fixtures live, and why the answer is a convention rather than a requirement. Worth reading when you are adding the first test to a bundled script, or moving a suite that already exists — the migration hazard in the last section is the reason to read it beforehand, since a fixture path built by counting `..` hops breaks by resolving to a real-looking path that does not exist, which no type checker catches.

## Tests

**A test goes in a `__tests__/` directory sibling to the file it tests, named `<file>.test.ts`.**

```text
src/
├── audit.ts
├── report.ts
└── __tests__/
    ├── audit.test.ts
    └── report.test.ts
```

Nothing enforces this. Bun discovers tests by **filename suffix alone** — `*.test.*`, `*_test.*`, `*.spec.*`, `*_spec.*` — and ignores directory structure entirely. Verified: a co-located test, one inside `__tests__/`, one inside a top-level `tests/` and one using `.spec.` are all collected; a file inside `__tests__/` *without* a test suffix is not. Vitest behaves the same way, matching on suffix with no directory clause. Only Jest's `testMatch` default privileges the directory name, and it also matches the suffix form, so even there the directory was never required.

So this is a **legibility** rule, and it earns its place on those grounds:

- A reader opening `src/` sees the modules, not a file list doubled by tests.
- A test sits next to what it tests, so the pair moves and gets deleted together.
- A glob targets predictably. The symptom of having no rule is a `package.json` script that hand-enumerates paths, which is what happens once layout stops being guessable.

Be honest about provenance when applying it: `__tests__/` is a **React and Jest lineage** convention rather than a TypeScript one. Surveyed by repo, a separate `test/` or `tests/` tree leads it roughly ten to three, with co-location a distant third — Bun's own repository keeps 1,997 tests in `test/` and three in `__tests__/`. Any of the three is defensible. What no surveyed repository does is run several at once, and that is the actual defect worth fixing.

### A test with no single subject

Sibling-to-the-file-it-tests answers nothing for a test that exercises six modules at once. Those exist in any codebase with round-trip or invariant tests, and forcing one next to an arbitrarily chosen module makes the location lie.

**Integration tests go in `__tests__/` at the package root.** Unit tests stay beside their subject:

```text
packages/models/
├── src/
│   ├── parsers/
│   │   ├── plan-note.ts
│   │   └── __tests__/plan-note.test.ts        # tests that file
│   └── schemas/
│       ├── plan-note.ts
│       └── __tests__/plan-note.test.ts
└── __tests__/
    ├── round-trip.test.ts                     # tests the package
    └── mutation-invariants.test.ts
```

The rule for deciding is what the test imports: one or two modules is a unit test, several is an integration test. Both directories carry the same name, so the convention stays single — what differs is depth, and the depth is the claim. A test beside a file says it tests that file; a test at the package root says it tests the package.

This plugin's own suites are all at one root — `../scripts/__tests__/` holds the tests for `../scripts/`, for `../scripts/lib/` and for `../eval-viewer/` — which is a deliberate deviation rather than an oversight, and worth knowing before you read them as the worked example of the rule above. At this size the alternative is three directories of two files each, and the depth claim buys nothing when a reader can see the whole test surface in one listing. The point at which it starts to buy something is when a subdirectory grows enough that "which of these tests my file" stops being obvious.

One migration hazard worth stating, because it is the whole cost of adopting this: **moving a test changes every relative path it holds.** Subject imports shift by a directory, and any fixture path built by counting `..` hops from `import.meta.dir` breaks silently — it resolves to a real-looking path that does not exist. Compute those from the file's actual location rather than a hardcoded chain, and watch for the same anchor defined twice, once in a test and once in a helper at a different depth. That pair is the classic way a migration looks finished while a coverage test quietly fails.

## Fixtures

**Fixtures go in `fixtures/`. Not `__fixtures__/`.**

```text
src/__tests__/
├── parser.test.ts
└── fixtures/
    ├── valid-note.md
    └── malformed-frontmatter.md
```

The dunder spelling looks like it should parallel `__tests__/`, and it does not exist as a convention. Across eighteen major TypeScript repositories: **220** `fixtures/` directories against **one** `__fixtures__/`. No test runner's defaults reference the dunder form. React — the source of the `__tests__/` convention — nests a plain `fixtures/` *inside* a `__tests__/` directory, which settles the question about whether the two are meant to match.

Fixtures may sit inside `__tests__/` or beside it. Inside is usually better: it keeps the test directory self-contained, and a fixture with no test is then obviously orphaned.

## Naming

| Thing | Form |
|---|---|
| Test file | `<file-under-test>.test.ts` |
| Test directory | `__tests__/` |
| Fixture directory | `fixtures/` |
| Fixture file | descriptive of the case, not the index — `malformed-frontmatter.md`, never `case-3.md` |

The `.test.ts` suffix is the one genuinely settled piece of all this. Every runner keys on it, and it is what makes a file a test regardless of where it sits.

## Applying it to an existing codebase

Moving tests is mechanical and the risk is in the imports, not the moves. A test that moves one level deeper needs its relative imports adjusted, and a runner that finds nothing after a migration usually means a glob in `package.json` still names the old layout.

Two things worth doing in the same pass, because they are what the migration is for:

- Delete any hand-enumerated test paths from scripts. `bun test` with a consistent layout needs no argument list.
- Check for tests that were never running. An inconsistent layout hides them, and a migration is when they surface.
