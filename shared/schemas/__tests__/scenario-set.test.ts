/**
 * The first test in "a misspelled expectations key" is the one this whole schema exists
 * for. A scenario set with every expectations key mistyped used to parse clean, measure
 * the skill against nothing, and hand the optimizer a pass rate of 1 -- while the
 * optimizer's own guardrail was warning about precisely that state and never fired,
 * because the default had already filled the gap in silence.
 */

import { describe, expect, test } from "bun:test";

import { Glob } from "bun";
import { resolve } from "node:path";

import { SCENARIO_KEYS, SCENARIO_SET_KEYS, scenarioSetFindings } from "../scenario-set.ts";

const REPO_ROOT = resolve(import.meta.dir, "..", "..", "..");

function findings(raw: unknown): {
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
} {
  return scenarioSetFindings(raw, "evals.json");
}

describe("a well-formed scenario set", () => {
  test("the object form reports nothing", () => {
    expect(
      findings({
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
      }),
    ).toEqual({ errors: [], warnings: [] });
  });

  test("a bare array reports nothing", () => {
    expect(findings([{ prompt: "Do the thing", expectations: ["It happened"] }])).toEqual({
      errors: [],
      warnings: [],
    });
  });

  test("the older `assertions` spelling is legitimate, not a typo", () => {
    expect(findings([{ prompt: "Do the thing", assertions: ["It happened"] }])).toEqual({
      errors: [],
      warnings: [],
    });
  });

  test("a row with no expectations at all stays SILENT -- that state is legal", () => {
    // `optimize-disclosure.ts` already warns once per set when nothing carries
    // expectations. Warning again per row would make the legitimate case noisy, and an
    // existing test depends on this row parsing clean.
    expect(findings([{ prompt: "Do the thing" }])).toEqual({ errors: [], warnings: [] });
  });
});

describe("a misspelled expectations key is reported rather than silently defaulted", () => {
  test("the typo is named, and so is the consequence", () => {
    const { errors, warnings } = findings([
      { id: 1, prompt: "Pull the line items", expectatons: ["A CSV is produced"] },
    ]);

    // Not an error: the file is usable, and an empty expectations set is legal.
    expect(errors).toEqual([]);
    // Two findings -- the unknown key, and the default it caused.
    expect(warnings).toHaveLength(2);
    expect(warnings.join("\n")).toContain("did you mean `expectations`");
    expect(warnings.join("\n")).toContain("measured against nothing");
    expect(warnings.join("\n")).toContain("scenario 0");
  });

  test("every row of a wholly misspelled set is reported, not just the first", () => {
    const { warnings } = findings({
      skill_name: "x",
      evals: [
        { id: 1, prompt: "One", expectatons: ["a"] },
        { id: 2, prompt: "Two", expectatons: ["b"] },
        { id: 3, prompt: "Three", expectatons: ["c"] },
      ],
    });
    expect(warnings.filter((w) => w.includes("measured against nothing"))).toHaveLength(3);
  });

  test("a misspelled `assertions` is caught by the same path", () => {
    const { warnings } = findings([{ prompt: "Do the thing", assertion: ["It happened"] }]);
    expect(warnings.join("\n")).toContain("did you mean `assertions`");
  });

  test("a typo ALONGSIDE a correct key does not claim the default fired", () => {
    const { warnings } = findings([
      { prompt: "Do the thing", expectations: ["It happened"], expectatons: ["stray"] },
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("did you mean `expectations`");
    expect(warnings[0]).not.toContain("measured against nothing");
  });

  test("an unrelated key does not trigger the expectations finding", () => {
    const { warnings } = findings([{ prompt: "Do the thing", owner: "ops" }]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).not.toContain("measured against nothing");
  });
});

describe("structural problems keep the messages the reader already threw", () => {
  test("an empty prompt errors", () => {
    expect(findings([{ prompt: "" }]).errors[0]).toContain('no non-empty string "prompt"');
  });

  test("a whitespace-only prompt errors, since it is not a task", () => {
    expect(findings([{ prompt: "   " }]).errors[0]).toContain('no non-empty string "prompt"');
  });

  test("an object with no rows errors, naming both accepted shapes", () => {
    expect(findings({}).errors[0]).toContain("expected a JSON array of scenarios");
    expect(findings({}).errors[0]).toContain('"evals"');
  });

  test("an empty array errors WITHOUT being told about a key it never had", () => {
    // `[]` and `{}` used to share one message, so an author who passed an empty array was
    // pointed at `"evals"` and could not tell whether the shape or the contents was wrong.
    // Asserted on the quoted key rather than the bare word, because the source path in
    // the message is `evals.json` and contains it.
    const message = scenarioSetFindings([], "scenarios.json").errors[0] ?? "";
    expect(message).toContain("this array is empty");
    expect(message).not.toContain("evals");
  });

  test("a misspelled prompt names the culprit rather than only the index", () => {
    const { errors } = findings([{ prompts: "Do the thing" }]);
    expect(errors[0]).toContain('no non-empty string "prompt"');
    expect(errors[0]).toContain("`prompts`");
  });

  test("a misspelled top-level `evals` is named, not just reported as empty", () => {
    const { errors, warnings } = findings({ skill_name: "x", evels: [{ prompt: "One" }] });
    expect(errors[0]).toContain("expected a JSON array of scenarios");
    expect(warnings.join("\n")).toContain("did you mean `evals`");
  });
});

describe("silent id hazards", () => {
  test("a non-scalar id is reported rather than becoming [object Object]", () => {
    const { errors, warnings } = findings([{ id: { a: 1 }, prompt: "One" }]);
    expect(errors).toEqual([]);
    expect(warnings.join("\n")).toContain("[object Object]");
  });

  test("a repeated id is reported, because it collapses the held-out split", () => {
    const { errors, warnings } = findings([
      { id: 1, prompt: "One" },
      { id: 1, prompt: "Two" },
    ]);
    expect(errors).toEqual([]);
    expect(warnings.join("\n")).toContain("repeats the id");
  });

  test("rows with no id are not treated as sharing one", () => {
    expect(
      findings([{ prompt: "One" }, { prompt: "Two" }]).warnings,
    ).toEqual([]);
  });
});

describe("the sets this repository ships", () => {
  test("the recognized key sets are the ones the reader and the format document", () => {
    expect([...SCENARIO_KEYS].sort()).toEqual([
      "assertions",
      "eval_id",
      "eval_name",
      "expectations",
      "expected_output",
      "files",
      "id",
      "prompt",
    ]);
    expect([...SCENARIO_SET_KEYS].sort()).toEqual(["evals", "skill_name"]);
  });

  test("every scenario set on disk parses with no errors and no warnings", async () => {
    const paths: string[] = ["skills/skill-creator/examples/evals.json"];
    for await (const rel of new Glob("*.json").scan(resolve(REPO_ROOT, "evals/disclosure"))) {
      paths.push(`evals/disclosure/${rel}`);
    }
    // Guards against a scan that silently found nothing and passed.
    expect(paths.length).toBeGreaterThanOrEqual(7);

    const offenders: string[] = [];
    for (const path of paths) {
      const raw: unknown = await Bun.file(resolve(REPO_ROOT, path)).json();
      const result = scenarioSetFindings(raw, path);
      if (result.errors.length > 0 || result.warnings.length > 0) {
        offenders.push(`${path}: ${[...result.errors, ...result.warnings].join("; ")}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
