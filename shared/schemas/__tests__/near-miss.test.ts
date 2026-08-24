/**
 * The suggester is only useful if it is precise, so most of this suite is about what it
 * declines to suggest. A wrong suggestion sends an author to rename a field that was
 * deliberate, which is worse than the silence the whole mechanism replaces.
 */

import { describe, expect, test } from "bun:test";

import { misspellingHint, nearestKey, unknownKeyMessage, unknownKeysOf } from "../near-miss.ts";

const SCENARIO_KEYS = ["id", "prompt", "expectations", "assertions", "expected_output", "files"];

describe("nearestKey", () => {
  test("a case or separator variant is the same key, which is the commonest real typo", () => {
    expect(nearestKey("shouldTrigger", ["query", "should_trigger"])).toBe("should_trigger");
    expect(nearestKey("SHOULD_TRIGGER", ["query", "should_trigger"])).toBe("should_trigger");
    expect(nearestKey("should-trigger", ["query", "should_trigger"])).toBe("should_trigger");
    expect(nearestKey("expected-output", SCENARIO_KEYS)).toBe("expected_output");
  });

  test("a one- or two-character slip on a long key is suggested", () => {
    expect(nearestKey("expectatons", SCENARIO_KEYS)).toBe("expectations");
    expect(nearestKey("expectaions", SCENARIO_KEYS)).toBe("expectations");
    expect(nearestKey("expectations", SCENARIO_KEYS)).toBe("expectations");
    expect(nearestKey("assertion", SCENARIO_KEYS)).toBe("assertions");
    expect(nearestKey("prompts", SCENARIO_KEYS)).toBe("prompt");
  });

  test("a short key needs a closer match, or `id` would match half the alphabet", () => {
    expect(nearestKey("ids", ["id", "prompt"])).toBe("id");
    // One edit from `id`, which is the budget a two-character key gets.
    expect(nearestKey("is", ["id", "prompt"])).toBe("id");
    // Two edits. At the flat tolerance of 2 a longer key gets, `url` would be reported
    // as a typo for `id`, and the author would be told to rename a deliberate field.
    expect(nearestKey("aid", ["id", "prompt"])).toBe("id");
    expect(nearestKey("url", ["id", "prompt"])).toBeUndefined();
  });

  test("a deliberate annotation matches nothing rather than matching something", () => {
    expect(nearestKey("note", SCENARIO_KEYS)).toBeUndefined();
    expect(nearestKey("owner", SCENARIO_KEYS)).toBeUndefined();
    expect(nearestKey("tags", SCENARIO_KEYS)).toBeUndefined();
    expect(nearestKey("rationale", SCENARIO_KEYS)).toBeUndefined();
  });

  test("an empty candidate set suggests nothing rather than throwing", () => {
    expect(nearestKey("anything", [])).toBeUndefined();
  });

  test("ties break alphabetically, so the message does not depend on key order", () => {
    // `ab` is one edit from both. Order of the candidate list must not decide.
    expect(nearestKey("ab", ["abc", "abd"])).toBe("abc");
    expect(nearestKey("ab", ["abd", "abc"])).toBe("abc");
  });
});

describe("unknownKeyMessage", () => {
  test("names the key and the nearest legitimate one", () => {
    const message = unknownKeyMessage("expectatons", "scenario 0", SCENARIO_KEYS);
    expect(message).toContain("`expectatons`");
    expect(message).toContain("did you mean `expectations`");
    expect(message).toContain("scenario 0");
    expect(message).toContain("ignored");
  });

  test("lists the recognized keys when there is nothing to suggest", () => {
    const message = unknownKeyMessage("note", "scenario 3", SCENARIO_KEYS);
    expect(message).not.toContain("did you mean");
    expect(message).toContain("Recognized keys are: assertions, expectations, expected_output");
  });
});

describe("unknownKeysOf", () => {
  test("returns only unrecognized keys, sorted", () => {
    const row = { prompt: "x", zeta: 1, alpha: 2, id: 3 };
    expect(unknownKeysOf(row, new Set(["prompt", "id"]))).toEqual(["alpha", "zeta"]);
  });

  test("a fully recognized row has none", () => {
    expect(unknownKeysOf({ prompt: "x" }, new Set(["prompt"]))).toEqual([]);
  });
});

describe("misspellingHint", () => {
  test("names the unknown key that is a near miss for the required one", () => {
    expect(misspellingHint(["shouldTrigger"], "should_trigger")).toContain("`shouldTrigger`");
  });

  test("is empty when no unknown key is close, so the error is not padded with noise", () => {
    expect(misspellingHint(["note", "owner"], "should_trigger")).toBe("");
    expect(misspellingHint([], "should_trigger")).toBe("");
  });
});
