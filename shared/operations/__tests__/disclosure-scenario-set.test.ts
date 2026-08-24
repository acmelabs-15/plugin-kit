/**
 * `parseScenarioSet` as the boundary it claims to be.
 *
 * The rules are covered against the schema in
 * `../../schemas/__tests__/scenario-set.test.ts`. What is checked here is the wiring, and
 * one property above all: the scenario set that used to slide silently into measuring a
 * skill against nothing now says so, while still parsing -- because it is a usable file
 * and refusing it would be a second defect.
 */

import { expect, spyOn, test } from "bun:test";

import { parseScenarioSet } from "../disclosure.ts";

/** Run `parseScenarioSet` with stderr captured, returning what it said. */
function parseSaying(raw: unknown): {
  readonly scenarios: ReturnType<typeof parseScenarioSet>;
  readonly said: string;
} {
  const stderr = spyOn(console, "error").mockImplementation(() => {});
  try {
    const scenarios = parseScenarioSet(raw, "evals.json");
    return { scenarios, said: stderr.mock.calls.map((call) => call.join(" ")).join("\n") };
  } finally {
    stderr.mockRestore();
  }
}

test("a legitimate scenario set parses to exactly what it always did, and says nothing", () => {
  const { scenarios, said } = parseSaying({
    skill_name: "invoice-parser",
    evals: [
      {
        id: 1,
        prompt: "Pull the line items",
        expected_output: "A CSV",
        files: ["evals/files/invoice.pdf"],
        expectations: ["A CSV is produced"],
      },
    ],
  });

  // Including the numeric id stringified, which is the contract the split depends on.
  expect(scenarios).toEqual([
    { id: "1", prompt: "Pull the line items", expectations: ["A CSV is produced"] },
  ]);
  expect(said).toBe("");
});

test("a row that legitimately carries no expectations stays silent", () => {
  // Documented as the state of the file before the first runs are in flight, and already
  // warned about once per set downstream. Warning here would make the honest case noisy.
  const { scenarios, said } = parseSaying([{ prompt: "Do the thing" }]);
  expect(scenarios).toEqual([{ id: "scenario-1", prompt: "Do the thing", expectations: [] }]);
  expect(said).toBe("");
});

test("a misspelled expectations key is reported rather than silently defaulted", () => {
  // THE defect. Every expectation in the set is mistyped, so the loop would optimize
  // context cost against a pass rate of 1 computed over zero expectations -- free to
  // strip the skill to nothing and call it an improvement.
  const { scenarios, said } = parseSaying({
    skill_name: "invoice-parser",
    evals: [
      { id: 1, prompt: "One", expectatons: ["a"] },
      { id: 2, prompt: "Two", expectatons: ["b"] },
    ],
  });

  // Still parses: an empty expectations set is legal, and the file is usable.
  expect(scenarios.map((scenario) => scenario.expectations)).toEqual([[], []]);
  expect(said).toContain("did you mean `expectations`");
  expect(said).toContain("measured against nothing");
  expect(said).toContain("scenario 0");
  expect(said).toContain("scenario 1");
});

test("the messages the existing callers match on are unchanged", () => {
  expect(() => parseScenarioSet([{ prompt: "" }], "s.json")).toThrow(/no non-empty string/);
  expect(() => parseScenarioSet({}, "s.json")).toThrow(/expected a JSON array/);
  expect(() => parseScenarioSet({}, "s.json")).toThrow(TypeError);
});

test("a misspelled top-level `evals` is named instead of reading as an empty set", () => {
  const stderr = spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(() => parseScenarioSet({ skill_name: "x", evels: [{ prompt: "One" }] }, "s.json"))
      .toThrow(/expected a JSON array/);
    const said = stderr.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(said).toContain("did you mean `evals`");
  } finally {
    stderr.mockRestore();
  }
});
