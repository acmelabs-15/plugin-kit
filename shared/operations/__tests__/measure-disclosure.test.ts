/**
 * Tests for the install-state guard on the measurement entry point.
 *
 * Nothing here spawns `claude`, for the reason `optimize-disclosure.test.ts` gives: a
 * judgement reachable only by spending an hour of API time is a judgement with no coverage.
 * That applies with particular force to this one. The guard exists because a sweep against an
 * installed copy comes back with every pull rate floored at zero and a full table of `prune`
 * verdicts resting on nothing, and the whole point of the change is that the tool now says so
 * out loud -- which is worth nothing at all if the saying is untested.
 *
 * Both cases use a randomized skill name. `detectInstallState` sweeps the user and plugin
 * skill roots as well as the project it is given, so a fixed name like `demo` would let
 * whatever the developer happens to have installed decide the outcome.
 */

import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { rm } from "node:fs/promises";

import {
  ACCEPT_EDITS_NOTICE,
  liveReportPath,
  MEASURE_FLAGS,
  MEASUREMENT_MODEL,
  MEASUREMENT_PERMISSION_MODE,
  measureDisclosure,
  removedFlagError,
  warnOnInstallConflict,
  type MeasureOutput,
} from "../measure-disclosure.ts";
import type { MeasureParams } from "../disclosure-measure.ts";
import type { ScenarioRun } from "../disclosure.ts";

const TMP = `${Bun.env["TMPDIR"] ?? "/tmp"}/measure-disclosure-${Bun.nanoseconds()}`;

let counter = 0;
function scratch(): string {
  counter += 1;
  return `${TMP}/case-${counter}`;
}

function uniqueName(): string {
  return `measure-disclosure-probe-${Bun.nanoseconds()}`;
}

afterAll(async () => {
  await rm(TMP, { recursive: true, force: true });
});

test("an installed copy is reported as a conflict, and said out loud", async () => {
  const project = scratch();
  const name = uniqueName();
  await Bun.write(
    `${project}/.claude/skills/${name}/SKILL.md`,
    `---\nname: ${name}\ndescription: an installed copy\n---\n\nBody.\n`,
  );

  const stderr = spyOn(console, "error").mockImplementation(() => {});
  try {
    const result = await warnOnInstallConflict({
      // The source under test, which is excluded from the sweep. It need not exist: what is
      // being asked is what ELSE on the machine answers to this name.
      skillPath: `${project}/src/${name}`,
      skillName: name,
      projectDir: project,
    });

    expect(result.state).toBe("installed");
    // Asserted on the mechanism rather than on the phrasing. A sentence that says a copy was
    // found and stops there does not tell the reader why the table below it is void.
    expect(result.conflict).toContain("Read");
    expect(result.conflict).toContain("measure-disclosure");
    const said = stderr.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(said).toContain("WARNING");
    expect(said).toContain(result.conflict ?? "");
  } finally {
    stderr.mockRestore();
  }
});

test("nothing installed under the name says nothing", async () => {
  const project = scratch();
  await Bun.write(`${project}/.keep`, "");
  const name = uniqueName();

  const stderr = spyOn(console, "error").mockImplementation(() => {});
  try {
    const result = await warnOnInstallConflict({
      skillPath: `${project}/src/${name}`,
      skillName: name,
      projectDir: project,
    });

    // Null for `absent`, and null for `unknown` as well -- a sweep that could not see the
    // machine has nothing to report, and `installConflict` deliberately refuses to guess.
    expect(result.conflict).toBeNull();
    expect(stderr).not.toHaveBeenCalled();
  } finally {
    stderr.mockRestore();
  }
});

// The dashboard serves a run's real report only when `detail.reportPath` is set, and
// falls back to the progress page when it is not. A measurement published `resultsDir`
// alone, so every dashboard link for a measured sweep dead-ended on a status table while
// the report sat written on disk beside it. These pin the path the run now advertises.

test("a results directory advertises the report written inside it", () => {
  expect(liveReportPath("none", "/tmp/out")).toBe("/tmp/out/report.html");
});

test("an explicit --report wins, because it is the path the caller named", () => {
  expect(liveReportPath("/tmp/elsewhere.html", "/tmp/out")).toBe("/tmp/elsewhere.html");
});

test("an explicit --report stands on its own with no results directory", () => {
  expect(liveReportPath("/tmp/elsewhere.html", undefined)).toBe("/tmp/elsewhere.html");
});

test("a run writing no report advertises none, rather than a path that never appears", () => {
  expect(liveReportPath("none", undefined)).toBeUndefined();
});

// The knobs are gone. These pin the three things that replaced them: a fixed measurement
// model that actually reaches the spawn, a purpose-named escape hatch that marks its own
// output, and an interception that tells a habitual caller what to reach for instead.

/**
 * Run `measureDisclosure` against a throwaway skill with the sweep injected.
 *
 * The sweep is where `claude` would be spawned, so injecting it is what makes the two
 * hardcoded values assertable at all — and asserting them on the real call site rather
 * than on a helper is the whole point, since the defect being closed was a value that
 * silently failed to reach the spawn.
 */
async function runMeasurement(options: { readonly tierStudy?: string }): Promise<{
  readonly output: MeasureOutput;
  readonly seen: MeasureParams | undefined;
}> {
  const dir = `${scratch()}/${uniqueName()}`;
  await Bun.write(
    `${dir}/SKILL.md`,
    "---\nname: probe\ndescription: A throwaway skill used to drive the measurement.\n---\n\nSee references/guide.md.\n",
  );
  await Bun.write(`${dir}/references/guide.md`, "Guide.\n");

  let seen: MeasureParams | undefined;
  const stderr = spyOn(console, "error").mockImplementation(() => {});
  try {
    const output = await measureDisclosure({
      skillPath: dir,
      scenarios: [{ id: "s1", prompt: "Do the thing.", expectations: ["It happened"] }],
      runsPerScenario: 1,
      numWorkers: 1,
      timeoutSeconds: 60,
      inlineThreshold: 0.8,
      ...(options.tierStudy === undefined ? {} : { tierStudy: options.tierStudy }),
      sweep: async (params) => {
        seen = params;
        const run: ScenarioRun = {
          scenarioId: "s1",
          attempt: 1,
          filesRead: ["references/guide.md"],
          skillLoaded: true,
          loadedVia: "skill",
          contextTokens: 1000,
          assertionsPassed: 1,
          assertionsTotal: 1,
          durationMs: 1000,
        };
        return [run];
      },
    });
    return { output, seen };
  } finally {
    stderr.mockRestore();
  }
}

async function capturedMeasureParams(options: {
  readonly tierStudy?: string;
}): Promise<MeasureParams | undefined> {
  return (await runMeasurement(options)).seen;
}

async function measuredOutput(options: {
  readonly tierStudy?: string;
}): Promise<MeasureOutput> {
  return (await runMeasurement(options)).output;
}

describe("the measurement model is fixed, not inherited", () => {
  test("sonnet is the instrument, and the constant says so rather than a default", () => {
    // Hardcoded on purpose: unset, this used to inherit the environment's model, so the
    // sweep varied by operator without saying so.
    expect(MEASUREMENT_MODEL).toBe("sonnet");
    expect(MEASUREMENT_PERMISSION_MODE).toBe("acceptEdits");
  });

  test("the fixed model and permission mode reach the spawn on an ordinary run", async () => {
    const seen = await capturedMeasureParams({});
    expect(seen?.model).toBe(MEASUREMENT_MODEL);
    expect(seen?.permissionMode).toBe(MEASUREMENT_PERMISSION_MODE);
  });

  test("a tier study substitutes the model and nothing else", async () => {
    const seen = await capturedMeasureParams({ tierStudy: "opus" });
    expect(seen?.model).toBe("opus");
    // The sandbox rule is not part of what a tier study varies.
    expect(seen?.permissionMode).toBe(MEASUREMENT_PERMISSION_MODE);
  });
});

describe("the tier-study marker", () => {
  test("an ordinary run carries no marker at all, so results.json keeps its shape", async () => {
    const output = await measuredOutput({});
    expect(output).not.toHaveProperty("tier_study");
  });

  test("a tier study stamps the model it swept on", async () => {
    const output = await measuredOutput({ tierStudy: "opus" });
    expect(output.tier_study).toBe("opus");
  });
});

describe("removed flags meet an education, not a mystery", () => {
  test("--model names its replacement and carries the value across", () => {
    const message = removedFlagError(["--skill-path", "s", "--model", "opus"]);
    expect(message).toContain("--model is removed");
    expect(message).toContain(MEASUREMENT_MODEL);
    expect(message).toContain("--tier-study opus");
  });

  test("the equals form is recognized too", () => {
    expect(removedFlagError(["--model=haiku"])).toContain("--tier-study haiku");
  });

  test("a bare --model still gets a usable suggestion rather than an empty one", () => {
    expect(removedFlagError(["--model"])).toContain("--tier-study <model>");
    // A following flag is not a model name.
    expect(removedFlagError(["--model", "--verbose"])).toContain("--tier-study <model>");
  });

  test("--permission-mode names the rule that replaced it", () => {
    const message = removedFlagError(["--permission-mode", "plan"]);
    expect(message).toContain("--permission-mode is removed");
    expect(message).toContain(MEASUREMENT_PERMISSION_MODE);
  });

  test("--grader-model is a real flag and is not swept up by the name match", () => {
    // A substring match on "model" would retire the one model flag that still exists.
    expect(removedFlagError(["--grader-model", "sonnet"])).toBeNull();
    expect(removedFlagError(["--grader-model=sonnet"])).toBeNull();
  });

  test("an ordinary argument list passes through untouched", () => {
    expect(removedFlagError(["--skill-path", "s", "--tier-study", "opus"])).toBeNull();
  });

  test("neither removed flag survives in the spec, so help cannot advertise them", () => {
    expect(MEASURE_FLAGS).not.toHaveProperty("model");
    expect(MEASURE_FLAGS).not.toHaveProperty("permission-mode");
    expect(MEASURE_FLAGS).toHaveProperty("tier-study");
    // The grader model is a different decision and stays configurable.
    expect(MEASURE_FLAGS).toHaveProperty("grader-model");
  });
});

test("the acceptEdits rule is stated in words, not left to the help text", () => {
  // The removed flag's fence was a quiet default. Honouring it means being loud.
  expect(ACCEPT_EDITS_NOTICE).toContain(MEASUREMENT_PERMISSION_MODE);
  expect(ACCEPT_EDITS_NOTICE).toContain("writes files");
  expect(ACCEPT_EDITS_NOTICE).toContain("Not configurable");
});
