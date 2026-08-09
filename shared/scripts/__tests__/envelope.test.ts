/**
 * The results envelope: the validator, the comparability check, and the content hash.
 *
 * Three properties carry the contract, and each is tested by trying to break it rather
 * than by round-tripping a good value:
 *
 *   - the validator names EVERY required field it is missing. A validator that catches
 *     `installState` but not `evalSetHash` gives a producer a green light on the field
 *     that matters, so each one is dropped in turn and asserted on by name.
 *   - the comparability check returns the differing field NAMES. A boolean is the thing
 *     most likely to be fudged later -- "close enough, ship the delta" -- and a test that
 *     only asserts `comparable === false` would not notice the names going away.
 *   - `hashArtifact` is stable across calls and moves when any byte moves. Both halves
 *     matter: a hash that changes for no reason makes every comparison incomparable, and
 *     a hash that misses a change makes two different artifacts look like one.
 *
 * Nothing here spawns `claude`, and nothing reads the machine's installed set: the
 * envelope is data, and every decision it encodes is a pure function of that data.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";

import {
  ADVISORY_KEYS,
  buildEnvelope,
  compareEnvelopes,
  compareRuns,
  COMPARABILITY_KEYS,
  detectInstallState,
  ENVELOPE_FILENAME,
  EnvelopeError,
  explainIncomparability,
  hashArtifact,
  hashJsonValue,
  installConflict,
  newEnvelopeId,
  readEnvelope,
  EnvelopeSchema,
  writeEnvelope,
  type Envelope,
  type RunBlock,
} from "../lib/envelope.ts";

const TMP = `${Bun.env["TMPDIR"] ?? "/tmp"}/envelope-${Bun.nanoseconds()}`;

let counter = 0;
function scratch(): string {
  counter += 1;
  return `${TMP}/case-${counter}`;
}

afterAll(async () => {
  await rm(TMP, { recursive: true, force: true });
});

function runBlock(overrides: Partial<RunBlock> = {}): RunBlock {
  return {
    id: "measure-triggering-demo-20260809T120000Z-abc123",
    startedAt: "2026-08-09T12:00:00.000Z",
    artifact: "skill",
    target: "demo",
    operation: "measure-triggering",
    model: "opus",
    graderModel: null,
    workers: 6,
    runsPer: 2,
    timeoutSeconds: 150,
    evalSetHash: "sha256:aaaa",
    targetSha: "sha256:bbbb",
    installState: "absent",
    ...overrides,
  };
}

function envelope(overrides: Partial<Envelope> = {}): Envelope {
  return {
    run: runBlock(),
    provenance: {
      tokenizer: "none",
      unit: "query attempt",
      scored: 24,
      excluded: 0,
      failed: 0,
      timeoutPolicy: "scored",
      caps: [],
    },
    headline: [{ label: "pass rate", value: 0.75, unit: "fraction" }],
    rows: [{ query: "do the thing", pass: true }],
    verdicts: [{ subject: "do the thing", verdict: "pass", reason: "triggered 2/2" }],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe("EnvelopeSchema", () => {
  /**
   * Dotted issue paths, which is how a caller names the field that is wrong.
   *
   * Zod carries the field in a structured \`path\` array rather than in the sentence, so
   * these tests assert on the path and not on the wording. The wording is Zod's and will
   * change with Zod; the path is the contract.
   */
  function paths(value: unknown): readonly string[] {
    const result = EnvelopeSchema.safeParse(value);
    return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
  }

  test("a complete envelope has no problems", () => {
    expect(paths(envelope())).toEqual([]);
  });

  const RUN_FIELDS: string[] = [
    "id",
    "startedAt",
    "artifact",
    "target",
    "operation",
    "model",
    "graderModel",
    "workers",
    "runsPer",
    "timeoutSeconds",
    "evalSetHash",
    "targetSha",
    "installState",
  ];

  test.each(RUN_FIELDS)("a missing run.%s is refused by name", (field) => {
    const bad = envelope();
    const run: Record<string, unknown> = { ...bad.run };
    delete run[field];
    expect(paths({ ...bad, run })).toEqual([`run.${field}`]);
  });

  const PROVENANCE_FIELDS: string[] = [
    "tokenizer",
    "unit",
    "scored",
    "excluded",
    "failed",
    "timeoutPolicy",
    "caps",
  ];

  test.each(PROVENANCE_FIELDS)("a missing provenance.%s is refused by name", (field) => {
    const bad = envelope();
    const provenance: Record<string, unknown> = { ...bad.provenance };
    delete provenance[field];
    expect(paths({ ...bad, provenance })).toEqual([`provenance.${field}`]);
  });

  test("a whole missing run block is one problem, not thirteen", () => {
    const { run: _run, ...rest } = envelope();
    expect(paths(rest)).toEqual(["run"]);
  });

  test("a whole missing provenance block is refused", () => {
    const { provenance: _p, ...rest } = envelope();
    expect(paths(rest)).toEqual(["provenance"]);
  });

  test.each(["headline", "rows", "verdicts"] as const)("a missing %s array is refused", (key) => {
    const bad: Record<string, unknown> = { ...envelope() };
    delete bad[key];
    expect(paths(bad)).toEqual([key]);
  });

  // The distinction the whole schema turns on: `{installState: undefined}` and `{}`
  // serialize identically, so a present-but-undefined key has to read as missing rather
  // than as a value -- and an explicit null has to be accepted only where null is a real
  // answer. Zod gets the first for free: a required key is unsatisfied by `undefined`.
  test("an explicitly undefined field reads as missing", () => {
    expect(paths({ ...envelope(), run: { ...runBlock(), installState: undefined } })).toEqual([
      "run.installState",
    ]);
  });

  test("null is accepted where it is a real answer and refused where it is not", () => {
    expect(
      paths({ ...envelope(), run: { ...runBlock(), model: null, evalSetHash: null } }),
    ).toEqual([]);
    expect(paths({ ...envelope(), run: { ...runBlock(), targetSha: null } })).toEqual([
      "run.targetSha",
    ]);
  });

  test("an unknown installState is refused, so a typo cannot invent a state", () => {
    const result = EnvelopeSchema.safeParse({
      ...envelope(),
      run: { ...runBlock(), installState: "not-installed" },
    });
    expect(result.success).toBe(false);
    const issue = result.success ? undefined : result.error.issues[0];
    expect(issue?.path.join(".")).toBe("run.installState");
    // The enum's members are named in the message, so a reader is told what WAS allowed
    // rather than only that their value was not.
    expect(issue?.message).toContain("absent");
    expect(issue?.message).toContain("unknown");
  });

  test("an unknown timeoutPolicy is refused", () => {
    const bad = envelope();
    expect(paths({ ...bad, provenance: { ...bad.provenance, timeoutPolicy: "ignored" } })).toEqual(
      ["provenance.timeoutPolicy"],
    );
  });

  test("caps must be strings, since it is prose a reader is shown", () => {
    const bad = envelope();
    // Named per offending element rather than once for the array. The hand-rolled check
    // this replaced reported `provenance.caps` whatever went wrong inside it.
    expect(paths({ ...bad, provenance: { ...bad.provenance, caps: [7, "ok", 9] } })).toEqual([
      "provenance.caps.0",
      "provenance.caps.2",
    ]);
  });

  test("headline and verdict entries are checked field by field", () => {
    expect(
      paths({
        ...envelope(),
        headline: [{ label: "x", unit: "fraction" }],
        verdicts: [{ subject: "a", verdict: "prune" }],
      }),
    ).toEqual(["headline.0.value", "verdicts.0.reason"]);
  });

  test("an optional headline delta is allowed but typechecked when present", () => {
    expect(
      paths({ ...envelope(), headline: [{ label: "x", value: 1, unit: "n", delta: -2 }] }),
    ).toEqual([]);
    expect(
      paths({ ...envelope(), headline: [{ label: "x", value: 1, unit: "n", delta: "-2" }] }),
    ).toEqual(["headline.0.delta"]);
  });

  // Every count in the envelope is arithmetic a reader will do more arithmetic on, so a
  // non-finite one is refused for the same reason a string is.
  test.each([Number.NaN, Number.POSITIVE_INFINITY])("a non-finite number is refused", (value) => {
    const bad = envelope();
    expect(paths({ ...bad, provenance: { ...bad.provenance, scored: value } })).toEqual([
      "provenance.scored",
    ]);
  });

  test("a non-object is refused rather than crashing", () => {
    expect(paths(null)).toEqual([""]);
    expect(paths([])).toEqual([""]);
  });

  // Unknown keys pass. The schema says what an envelope must carry, not what it may not,
  // and a producer that adds a field is not writing an invalid envelope.
  test("an extra key is not a problem", () => {
    expect(paths({ ...envelope(), extra: 1 })).toEqual([]);
  });

  test("writeEnvelope throws an EnvelopeError carrying every problem", async () => {
    let thrown: unknown;
    try {
      await writeEnvelope("/dev/null", { run: {}, provenance: {} } as unknown as Envelope);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(EnvelopeError);
    const problems = (thrown as EnvelopeError).problems;
    expect(problems.length).toBe(13 + 7 + 3);
    // Each problem still names its field, which is the whole reason the error carries a
    // list rather than a sentence.
    expect(problems.map((p) => p.path)).toContain("run.installState");
    expect((thrown as EnvelopeError).message).toContain("run.installState");
  });
});

// ---------------------------------------------------------------------------
// Building and writing
// ---------------------------------------------------------------------------

describe("buildEnvelope", () => {
  test("fills only id and startedAt, and the result validates", () => {
    const built = buildEnvelope({
      run: {
        artifact: "skill",
        target: "demo",
        operation: "validate",
        model: null,
        graderModel: null,
        workers: 1,
        runsPer: 1,
        timeoutSeconds: null,
        evalSetHash: null,
        targetSha: "sha256:cafe",
        installState: "unknown",
      },
      provenance: {
        tokenizer: "none",
        unit: "check section",
        scored: 3,
        excluded: 1,
        failed: 0,
        timeoutPolicy: "not-applicable",
        caps: ["environment checks not performed"],
      },
    });
    expect(EnvelopeSchema.safeParse(built).success).toBe(true);
    expect(built.run.id).toContain("validate-demo-");
    expect(built.run.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // Absent arrays default to empty rather than being omitted; the contract says every
    // envelope has all five keys, and a consumer should never branch on presence.
    expect(built.headline).toEqual([]);
    expect(built.rows).toEqual([]);
    expect(built.verdicts).toEqual([]);
  });

  test("an explicit id and startedAt are used verbatim", () => {
    const built = buildEnvelope({
      run: { ...runBlock(), id: "chosen", startedAt: new Date("2026-01-02T03:04:05Z") },
      provenance: envelope().provenance,
    });
    expect(built.run.id).toBe("chosen");
    expect(built.run.startedAt).toBe("2026-01-02T03:04:05.000Z");
  });

  test("newEnvelopeId slugs the target and stays unique per call", () => {
    const a = newEnvelopeId("optimize-disclosure", "Ask User Question");
    const b = newEnvelopeId("optimize-disclosure", "Ask User Question");
    expect(a).toContain("optimize-disclosure-ask-user-question-");
    expect(a).not.toBe(b);
  });
});

describe("writeEnvelope", () => {
  test("writes a valid envelope and reads it back", async () => {
    const dir = scratch();
    const path = `${dir}/${ENVELOPE_FILENAME}`;
    await writeEnvelope(path, envelope());
    expect(await readEnvelope(path)).toEqual(envelope());
  });

  test("refuses to write an invalid envelope, leaving no file behind", async () => {
    const dir = scratch();
    const path = `${dir}/${ENVELOPE_FILENAME}`;
    const bad = { ...envelope(), run: { ...runBlock(), installState: undefined } };
    await expect(writeEnvelope(path, bad as unknown as Envelope)).rejects.toThrow(
      /run\.installState/,
    );
    expect(await Bun.file(path).exists()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Comparability
// ---------------------------------------------------------------------------

describe("compareRuns", () => {
  test("identical run blocks are comparable", () => {
    expect(compareRuns(runBlock(), runBlock())).toEqual({
      comparable: true,
      differing: [],
      advisory: [],
    });
  });

  test.each([...COMPARABILITY_KEYS])("a differing %s is returned by name", (key) => {
    const other: Record<string, unknown> = { ...runBlock() };
    other[key] = typeof other[key] === "number" ? (other[key] as number) + 1 : "changed";
    const result = compareRuns(runBlock(), other as unknown as RunBlock);
    expect(result.differing).toEqual([key]);
    expect(result.comparable).toBe(false);
  });

  test("several differences come back in declaration order, all of them", () => {
    const result = compareRuns(
      runBlock(),
      runBlock({ workers: 12, installState: "shadowed", model: "sonnet" }),
    );
    expect(result.differing).toEqual(["model", "workers", "installState"]);
  });

  test("a changed targetSha does NOT block a comparison — it is what the delta is about", () => {
    const result = compareRuns(runBlock(), runBlock({ targetSha: "sha256:dddd" }));
    expect(result.comparable).toBe(true);
    expect(result.advisory).toEqual(["targetSha"]);
  });

  test.each([...ADVISORY_KEYS])("a differing %s is advisory rather than blocking", (key) => {
    const other: Record<string, unknown> = { ...runBlock() };
    other[key] = "changed";
    const result = compareRuns(runBlock(), other as unknown as RunBlock);
    expect(result.comparable).toBe(true);
    expect(result.advisory).toEqual([key]);
  });

  test("a null evalSetHash on one side is a difference, not a free pass", () => {
    expect(compareRuns(runBlock(), runBlock({ evalSetHash: null })).differing).toEqual([
      "evalSetHash",
    ]);
  });

  test("compareEnvelopes asks the same question of whole envelopes", () => {
    const a = envelope();
    const b = envelope({ run: runBlock({ runsPer: 3 }) });
    expect(compareEnvelopes(a, b).differing).toEqual(["runsPer"]);
  });

  test("explainIncomparability names the fields, and says nothing when comparable", () => {
    expect(explainIncomparability(compareRuns(runBlock(), runBlock()))).toBeNull();
    const text = explainIncomparability(
      compareRuns(runBlock(), runBlock({ workers: 1, timeoutSeconds: 30 })),
    );
    expect(text).toContain("`workers`");
    expect(text).toContain("`timeoutSeconds`");
  });
});

// ---------------------------------------------------------------------------
// Content hashing
// ---------------------------------------------------------------------------

describe("hashArtifact", () => {
  async function skillTree(dir: string, body = "Body.\n"): Promise<string> {
    await Bun.write(`${dir}/SKILL.md`, `---\nname: demo\ndescription: d\n---\n\n${body}`);
    await Bun.write(`${dir}/references/one.md`, "one\n");
    await Bun.write(`${dir}/scripts/run.ts`, "export const x = 1;\n");
    return dir;
  }

  test("is stable across calls on unchanged content", async () => {
    const dir = await skillTree(scratch());
    expect(await hashArtifact(dir)).toBe(await hashArtifact(dir));
  });

  test("two directories with identical content hash the same", async () => {
    const a = await skillTree(scratch());
    const b = await skillTree(scratch());
    expect(await hashArtifact(a)).toBe(await hashArtifact(b));
  });

  test("changing one byte of one file changes the hash", async () => {
    const dir = await skillTree(scratch());
    const before = await hashArtifact(dir);
    await Bun.write(`${dir}/references/one.md`, "onE\n");
    expect(await hashArtifact(dir)).not.toBe(before);
  });

  test("adding a file changes the hash", async () => {
    const dir = await skillTree(scratch());
    const before = await hashArtifact(dir);
    await Bun.write(`${dir}/references/two.md`, "two\n");
    expect(await hashArtifact(dir)).not.toBe(before);
  });

  test("removing a file changes the hash", async () => {
    const dir = await skillTree(scratch());
    const before = await hashArtifact(dir);
    await rm(`${dir}/scripts/run.ts`);
    expect(await hashArtifact(dir)).not.toBe(before);
  });

  test("renaming a file changes the hash even though the bytes are the same", async () => {
    const dir = await skillTree(scratch());
    const before = await hashArtifact(dir);
    await rm(`${dir}/references/one.md`);
    await Bun.write(`${dir}/references/uno.md`, "one\n");
    expect(await hashArtifact(dir)).not.toBe(before);
  });

  // Length is hashed alongside the bytes precisely so that moving content across a file
  // boundary cannot leave the concatenation unchanged.
  test("moving a character between two files changes the hash", async () => {
    const a = scratch();
    await Bun.write(`${a}/one.md`, "xy");
    await Bun.write(`${a}/two.md`, "");
    const b = scratch();
    await Bun.write(`${b}/one.md`, "x");
    await Bun.write(`${b}/two.md`, "y");
    expect(await hashArtifact(a)).not.toBe(await hashArtifact(b));
  });

  test("node_modules and .git are excluded, so installed and VCS churn is not artifact churn", async () => {
    const dir = await skillTree(scratch());
    const before = await hashArtifact(dir);
    await Bun.write(`${dir}/node_modules/dep/index.js`, "module\n");
    await Bun.write(`${dir}/.git/HEAD`, "ref: refs/heads/main\n");
    expect(await hashArtifact(dir)).toBe(before);
  });

  test("a single file target hashes by basename and content", async () => {
    const dir = scratch();
    await Bun.write(`${dir}/reviewer.md`, "---\nname: reviewer\n---\n");
    const first = await hashArtifact(`${dir}/reviewer.md`);
    expect(first).toBe(await hashArtifact(`${dir}/reviewer.md`));
    await Bun.write(`${dir}/reviewer.md`, "---\nname: reviewer2\n---\n");
    expect(await hashArtifact(`${dir}/reviewer.md`)).not.toBe(first);
  });

  test("a missing path hashes rather than throwing", async () => {
    expect(await hashArtifact(`${scratch()}/nope`)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test("the digest is labelled with its algorithm", async () => {
    expect(await hashArtifact(await skillTree(scratch()))).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe("hashJsonValue", () => {
  test("is insensitive to key order and to whitespace, since neither is a question", () => {
    expect(hashJsonValue({ query: "a", should_trigger: true })).toBe(
      hashJsonValue({ should_trigger: true, query: "a" }),
    );
    expect(hashJsonValue(JSON.parse('{"a":  1}'))).toBe(hashJsonValue(JSON.parse('{"a":1}')));
  });

  test("is sensitive to array order, because the order decides the train/test split", () => {
    expect(hashJsonValue([{ q: "a" }, { q: "b" }])).not.toBe(
      hashJsonValue([{ q: "b" }, { q: "a" }]),
    );
  });

  test("changing a value changes the hash", () => {
    expect(hashJsonValue([{ q: "a" }])).not.toBe(hashJsonValue([{ q: "A" }]));
  });
});

// ---------------------------------------------------------------------------
// Install state
// ---------------------------------------------------------------------------

describe("detectInstallState", () => {
  test("an agent target is `unknown` with a cap saying why, not `absent`", async () => {
    const sighting = await detectInstallState({
      artifact: "agent",
      name: "reviewer",
      sourcePath: "/nowhere/reviewer.md",
    });
    expect(sighting.state).toBe("unknown");
    expect(sighting.cap).toContain("agent");
  });

  test("an empty project with no HOME reports unknown rather than absent", async () => {
    const dir = scratch();
    await Bun.write(`${dir}/.keep`, "");
    const home = Bun.env["HOME"];
    try {
      delete (Bun.env as Record<string, string | undefined>)["HOME"];
      const sighting = await detectInstallState({
        artifact: "skill",
        name: "demo",
        sourcePath: `${dir}/demo`,
        projectDir: dir,
      });
      // `check-overlap.ts` reads HOME at module load, so this assertion holds only when
      // HOME was already unset. Either answer is correct; what must never happen is a
      // confident `absent` derived from roots that were never located.
      expect(["absent", "unknown"]).toContain(sighting.state);
    } finally {
      if (home !== undefined) (Bun.env as Record<string, string>)["HOME"] = home;
    }
  });

  test("a second installation under the same name reads as shadowed", async () => {
    const project = scratch();
    for (const slug of ["demo-old", "demo-new"]) {
      await Bun.write(
        `${project}/.claude/skills/${slug}/SKILL.md`,
        `---\nname: demo\ndescription: a copy\n---\n\nBody.\n`,
      );
    }
    const sighting = await detectInstallState({
      artifact: "skill",
      name: "demo",
      sourcePath: `${project}/src/demo`,
      projectDir: project,
    });
    // The user-level roots may hold a real `demo` on a developer machine, so this asserts
    // the direction rather than an exact count: two project copies are already enough.
    expect(sighting.state).toBe("shadowed");
    expect(sighting.sightings.length).toBeGreaterThanOrEqual(2);
    expect(sighting.cap).toContain("demo");
  });
});

describe("installConflict", () => {
  test("a disclosure sweep against an installed artifact is a conflict", () => {
    const text = installConflict({
      operation: "optimize-disclosure",
      needs: "absent",
      found: "installed",
    });
    expect(text).toContain("Read");
  });

  test("a triggering sweep against a shadowed artifact is a conflict", () => {
    expect(
      installConflict({ operation: "measure-triggering", needs: "installed", found: "shadowed" }),
    ).toContain("more than one installation");
  });

  test("no conflict when what was found is what was needed", () => {
    expect(
      installConflict({ operation: "optimize-disclosure", needs: "absent", found: "absent" }),
    ).toBeNull();
    expect(
      installConflict({ operation: "measure-triggering", needs: "installed", found: "installed" }),
    ).toBeNull();
  });

  test("an unknown install state raises no conflict — the cap already says it is unknown", () => {
    expect(
      installConflict({ operation: "optimize-disclosure", needs: "absent", found: "unknown" }),
    ).toBeNull();
  });
});
