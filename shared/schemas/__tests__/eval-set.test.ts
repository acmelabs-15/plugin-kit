/**
 * The defect under test is silence, so most assertions here are about a file that used
 * to parse clean and must now report something.
 *
 * No filesystem: the schema is handed an already-read value, which is the whole point of
 * the two-layer split in `../skill.ts`. The one test that does read the disk reads the
 * eval sets this repository actually ships, because a validator that rejects the corpus
 * it was written for is worse than no validator.
 */

import { describe, expect, test } from "bun:test";

import { Glob } from "bun";
import { resolve } from "node:path";

import { EVAL_ITEM_KEYS, evalSetFindings } from "../eval-set.ts";

const REPO_ROOT = resolve(import.meta.dir, "..", "..", "..");

function findings(raw: unknown): {
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
} {
  return evalSetFindings(raw, "trigger.json");
}

describe("a well-formed eval set", () => {
  test("reports nothing at all", () => {
    expect(
      findings([
        { query: "Turn this into a skill", should_trigger: true },
        { query: "What is the capital of France", should_trigger: false },
      ]),
    ).toEqual({ errors: [], warnings: [] });
  });

  test("an empty array is not an error here, matching the reader it validates", () => {
    expect(findings([])).toEqual({ errors: [], warnings: [] });
  });
});

describe("a misspelled should_trigger is reported rather than accepted", () => {
  test("camelCase INSTEAD of the real key errors, and the error names the culprit", () => {
    const { errors, warnings } = findings([{ query: "Do the thing", shouldTrigger: true }]);

    // The message the reader has always thrown, so nothing downstream stops matching.
    expect(errors[0]).toContain('has no boolean "should_trigger"');
    // What it could never say: the key you are looking straight at is the wrong one.
    expect(errors[0]).toContain("`shouldTrigger`");
    expect(warnings[0]).toContain("did you mean `should_trigger`");
  });

  test("camelCase ALONGSIDE the real key used to pass in total silence", () => {
    const { errors, warnings } = findings([
      { query: "Do the thing", should_trigger: true, shouldTrigger: false },
    ]);

    // Legal, so it must not fail: the value the reader takes is still the right one.
    expect(errors).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("`shouldTrigger`");
    expect(warnings[0]).toContain("did you mean `should_trigger`");
    expect(warnings[0]).toContain("item 0");
  });

  test("a misspelled query is reported the same way", () => {
    const { errors } = findings([{ querry: "Do the thing", should_trigger: true }]);
    expect(errors[0]).toContain('has no string "query"');
    expect(errors[0]).toContain("`querry`");
  });
});

describe("structural problems", () => {
  test("a non-array names the shape it wanted", () => {
    expect(findings({ evals: [] }).errors[0]).toContain("expected a JSON array of eval items");
  });

  test("every bad row is reported, not just the first", () => {
    const { errors } = findings([
      { query: "ok", should_trigger: true },
      { query: 42, should_trigger: true },
      { query: "ok", should_trigger: "yes" },
    ]);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain("item 1");
    expect(errors[1]).toContain("item 2");
  });

  test("a row that is not an object at all reports both missing keys", () => {
    expect(findings([null]).errors).toHaveLength(2);
  });

  test("an unrecognized key with no near miss lists what is recognized", () => {
    const { errors, warnings } = findings([
      { query: "ok", should_trigger: true, rationale: "hard negative" },
    ]);
    expect(errors).toEqual([]);
    expect(warnings[0]).toContain("`rationale`");
    expect(warnings[0]).not.toContain("did you mean");
    expect(warnings[0]).toContain("query, should_trigger");
  });
});

describe("the sets this repository ships", () => {
  test("EVAL_ITEM_KEYS is exactly what the reader consults", () => {
    expect([...EVAL_ITEM_KEYS].sort()).toEqual(["query", "should_trigger"]);
  });

  test("every eval set on disk parses with no errors and no warnings", async () => {
    const paths: string[] = ["skills/skill-creator/examples/trigger-eval-set.json"];
    for await (const rel of new Glob("*.json").scan(resolve(REPO_ROOT, "evals/trigger"))) {
      paths.push(`evals/trigger/${rel}`);
    }
    // Guards against a scan that silently found nothing and passed.
    expect(paths.length).toBeGreaterThanOrEqual(7);

    const offenders: string[] = [];
    for (const path of paths) {
      const raw: unknown = await Bun.file(resolve(REPO_ROOT, path)).json();
      const result = evalSetFindings(raw, path);
      if (result.errors.length > 0 || result.warnings.length > 0) {
        offenders.push(`${path}: ${[...result.errors, ...result.warnings].join("; ")}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
