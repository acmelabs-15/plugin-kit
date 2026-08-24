/**
 * `parseEvalSet` as the boundary it claims to be.
 *
 * The rules themselves are covered against the schema in
 * `../../schemas/__tests__/eval-set.test.ts`. What is checked here is the wiring: that a
 * warning actually reaches the operator instead of being computed and dropped, that a
 * warning alone does not fail the file, and that the value a legitimate file parses to
 * is byte-for-byte what it always was -- adding a schema must not change that.
 */

import { expect, spyOn, test } from "bun:test";

import { parseEvalSet } from "../measure-triggering.ts";

/** Run `parseEvalSet` with stderr captured, returning what it said. */
function parseSaying(raw: unknown): {
  readonly items: ReturnType<typeof parseEvalSet>;
  readonly said: string;
} {
  const stderr = spyOn(console, "error").mockImplementation(() => {});
  try {
    const items = parseEvalSet(raw, "trigger.json");
    return { items, said: stderr.mock.calls.map((call) => call.join(" ")).join("\n") };
  } finally {
    stderr.mockRestore();
  }
}

test("a legitimate eval set parses to exactly what it always did, and says nothing", () => {
  const { items, said } = parseSaying([
    { query: "Turn this into a skill", should_trigger: true },
    { query: "What is the capital of France", should_trigger: false },
  ]);

  expect(items).toEqual([
    { query: "Turn this into a skill", should_trigger: true },
    { query: "What is the capital of France", should_trigger: false },
  ]);
  expect(said).toBe("");
});

test("a misspelled should_trigger alongside the real key is said out loud, not swallowed", () => {
  // This file used to parse in total silence. `shouldTrigger` is not read by anything,
  // so an author who wrote it and meant it believed they had set the polarity.
  const { items, said } = parseSaying([
    { query: "Do the thing", should_trigger: true, shouldTrigger: false },
  ]);

  // Still usable, and the value taken is still the one from the correct key.
  expect(items).toEqual([{ query: "Do the thing", should_trigger: true }]);
  expect(said).toContain("`shouldTrigger`");
  expect(said).toContain("did you mean `should_trigger`");
});

test("a misspelled should_trigger INSTEAD of the real key throws naming the culprit", () => {
  // The old message named the row index and nothing else, which reads as "a key is
  // missing" when the key is right there under a different spelling.
  const stderr = spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(() => parseEvalSet([{ query: "Do the thing", shouldTrigger: true }], "trigger.json"))
      .toThrow(/has no boolean "should_trigger".*`shouldTrigger`/);
  } finally {
    stderr.mockRestore();
  }
});

test("every problem in the file is reported in one throw, not one run at a time", () => {
  let message = "";
  try {
    parseEvalSet(
      [
        { query: "ok", should_trigger: true },
        { query: 42, should_trigger: true },
        { query: "ok", should_trigger: "yes" },
      ],
      "trigger.json",
    );
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  expect(message).toContain("item 1");
  expect(message).toContain("item 2");
});

test("the non-array message is unchanged, so callers matching on it keep working", () => {
  expect(() => parseEvalSet({ evals: [] }, "trigger.json")).toThrow(
    /trigger\.json: expected a JSON array of eval items/,
  );
});

test("it still throws a TypeError, which is what the CLI reporting path expects", () => {
  expect(() => parseEvalSet("nope", "trigger.json")).toThrow(TypeError);
});
