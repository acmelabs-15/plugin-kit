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
  applyScenarioOnly,
  buildMeasurementEnvelope,
  liveReportPath,
  MEASURE_FLAGS,
  MEASUREMENT_MODEL,
  MEASUREMENT_PERMISSION_MODE,
  measureDisclosure,
  removedFlagError,
  reportWarnings,
  warnOnInstallConflict,
  type MeasureOutput,
} from "../measure-disclosure.ts";
import type { MeasureParams } from "../disclosure-measure.ts";
import { NO_GROUND_TRUTH } from "../disclosure.ts";
import type { DisclosureScenario, ScenarioRun } from "../disclosure.ts";
import { SubsetError, type ScenarioSubsetStamp } from "../subset.ts";
import type { DisclosureRow, RunTally } from "../optimize-disclosure.ts";
import {
  COMPARABILITY_KEYS,
  compareEnvelopes,
  EnvelopeSchema,
  explainIncomparability,
  hashJsonValue,
  type Envelope,
} from "../../envelope.ts";

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
interface MeasurementOptions {
  readonly tierStudy?: string;
  /** Defaults to one scenario. Widened for the subset cases, which need something to omit. */
  readonly scenarios?: readonly DisclosureScenario[];
  readonly subset?: ScenarioSubsetStamp;
}

async function runMeasurement(options: MeasurementOptions): Promise<{
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
      scenarios: options.scenarios ?? [
        { id: "s1", prompt: "Do the thing.", expectations: ["It happened"] },
      ],
      runsPerScenario: 1,
      numWorkers: 1,
      timeoutSeconds: 60,
      inlineThreshold: 0.8,
      ...(options.tierStudy === undefined ? {} : { tierStudy: options.tierStudy }),
      ...(options.subset === undefined ? {} : { subset: options.subset }),
      sweep: async (params) => {
        seen = params;
        // One run per scenario the sweep was actually handed, so a narrowed set produces
        // narrowed runs rather than a fixed row that would hide the filtering.
        return params.scenarios.map(
          (scenario): ScenarioRun => ({
            scenarioId: scenario.id,
            attempt: 1,
            filesRead: ["references/guide.md"],
            skillLoaded: true,
            loadedVia: "skill",
            contextTokens: 1000,
            assertionsPassed: 1,
            assertionsTotal: 1,
            durationMs: 1000,
          }),
        );
      },
    });
    return { output, seen };
  } finally {
    stderr.mockRestore();
  }
}

async function capturedMeasureParams(
  options: MeasurementOptions,
): Promise<MeasureParams | undefined> {
  return (await runMeasurement(options)).seen;
}

async function measuredOutput(options: MeasurementOptions): Promise<MeasureOutput> {
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

// `--only` runs a slice of the scenario set so a small change can be checked against the
// scenarios it was about. Everything below guards the same thing the tier-study marker
// guards: that a narrowed run cannot be mistaken for a measurement of record, and that a
// run which was NOT narrowed is untouched by the existence of the flag.

const THREE: readonly DisclosureScenario[] = [
  { id: "alpha", prompt: "A.", expectations: ["a"] },
  { id: "beta", prompt: "B.", expectations: ["b"] },
  { id: "gamma", prompt: "C.", expectations: ["c"] },
];

describe("applyScenarioOnly", () => {
  test("no --only hands the set straight back, as the very same array", () => {
    const result = applyScenarioOnly({ scenarios: THREE, only: undefined });
    // Identity, not equality: a copy would pass a deep comparison while proving nothing
    // about whether the rows were touched on the way through.
    expect(result.scenarios).toBe(THREE);
    expect(result.subset).toBeNull();
  });

  test("--only selects exactly the named scenarios and stamps what it left out", () => {
    const { scenarios, subset } = applyScenarioOnly({ scenarios: THREE, only: "gamma,alpha" });
    // Set order, not selector order, so a subset's table reads as a sub-table of the full one.
    expect(scenarios.map((scenario) => scenario.id)).toEqual(["alpha", "gamma"]);
    expect(subset?.ids).toEqual(["alpha", "gamma"]);
    expect(subset?.selected).toBe(2);
    expect(subset?.excluded).toBe(1);
    expect(subset?.of).toBe(3);
    expect(subset?.not_of_record).toBe(true);
  });

  test("an unknown id is refused with the ids that exist, never swept as nothing", () => {
    // A sweep of zero scenarios does not fail. It reports a 0% pass rate over nothing and
    // a file table of `prune` verdicts, which is the exact shape of a wrong conclusion.
    expect(() => applyScenarioOnly({ scenarios: THREE, only: "delta" })).toThrow(SubsetError);
    expect(() => applyScenarioOnly({ scenarios: THREE, only: "delta" })).toThrow(
      /no such scenario id.*alpha, beta, gamma/s,
    );
  });
});

describe("the subset marker", () => {
  test("an ordinary run carries no marker at all, so results.json keeps its shape", async () => {
    const output = await measuredOutput({});
    // ABSENT, not false -- the same rule `tier_study` follows, and for the same reason.
    expect(output).not.toHaveProperty("subset");
  });

  test("only the named scenarios reach the sweep, and the count reports them", async () => {
    const { scenarios, subset } = applyScenarioOnly({ scenarios: THREE, only: "beta" });
    const { output, seen } = await runMeasurement({ scenarios, subset: subset! });

    expect(seen?.scenarios.map((scenario) => scenario.id)).toEqual(["beta"]);
    // The count is the rows that ran, so nothing downstream reports a denominator of three.
    expect(output.scenario_count).toBe(1);
    expect(output.subset?.ids).toEqual(["beta"]);
    expect(output.subset?.not_of_record).toBe(true);
    expect(output.subset?.note).toContain("NOT A MEASUREMENT OF RECORD");
  });

  test("a subset does not disturb the fixed model or permission mode", async () => {
    const { scenarios, subset } = applyScenarioOnly({ scenarios: THREE, only: "alpha" });
    const seen = await capturedMeasureParams({ scenarios, subset: subset! });
    // Narrowing is orthogonal to the two values that are hardcoded because they were
    // being got wrong. A subset must not become a second way to vary them.
    expect(seen?.model).toBe(MEASUREMENT_MODEL);
    expect(seen?.permissionMode).toBe(MEASUREMENT_PERMISSION_MODE);
  });

  test("a subset and a tier study stack, each keeping its own marker", async () => {
    const { scenarios, subset } = applyScenarioOnly({ scenarios: THREE, only: "alpha" });
    const output = await measuredOutput({ scenarios, subset: subset!, tierStudy: "opus" });
    // Two independent reasons the same run is not of record. Either collapsing into the
    // other would lose a caveat a reader needs.
    expect(output.tier_study).toBe("opus");
    expect(output.subset?.ids).toEqual(["alpha"]);
  });

  test("the flag is advertised, and says what it costs the run", () => {
    expect(MEASURE_FLAGS).toHaveProperty("only");
    expect(MEASURE_FLAGS["only"]?.help).toContain("not a measurement of record");
  });
});

/**
 * A `MeasureOutput` with nothing interesting in it.
 *
 * At module scope rather than inside one `describe` because the envelope block below needs
 * the same fixture: an envelope is built FROM this shape, so a second hand-written copy
 * would be free to drift from the one the warnings are asserted against.
 */
function output(overrides: Partial<MeasureOutput> = {}): MeasureOutput {
  return {
    skill_name: "probe",
    skill_path: "skills/probe",
    install_state: "absent",
    install_conflict: null,
    token_method: "estimator:chars-over-4",
    tokens_are_estimated: true,
    scenario_count: 1,
    runs_per_scenario: 1,
    runs_without_skill: 0,
    runs_loaded_via_file: 0,
    body_tokens: 100,
    context_tokens: 1000,
    pass_rate: 1,
    assertions_passed: 1,
    assertions_total: 1,
    files: [],
    ground_truth: NO_GROUND_TRUTH,
    ...overrides,
  };
}

function subsetOf(ids: readonly string[]): ScenarioSubsetStamp {
  const { subset } = applyScenarioOnly({ scenarios: THREE, only: ids.join(",") });
  if (subset === null) throw new Error("expected a subset");
  return subset;
}

describe("the report banner", () => {
  test("an ordinary run raises nothing, so its report is what it always was", () => {
    expect(reportWarnings(output())).toEqual([]);
  });

  test("a subset raises a qualifying warning carrying the note", () => {
    // `qualifying`, not `invalidating`: the figures are real and the run did what it was
    // asked. It answers a narrower question, which is a different thing from being void.
    const warnings = reportWarnings(output({ subset: subsetOf(["alpha"]) }));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.severity).toBe("qualifying");
    expect(warnings[0]?.text).toContain("NOT A MEASUREMENT OF RECORD");
  });

  test("a subset and a tier study each raise their own, rather than one standing in", () => {
    const warnings = reportWarnings(
      output({ tier_study: "opus", subset: subsetOf(["alpha", "beta"]) }),
    );
    expect(warnings).toHaveLength(2);
    expect(warnings.map((warning) => warning.severity)).toEqual(["qualifying", "qualifying"]);
    expect(warnings[0]?.text).toContain("TIER STUDY");
    expect(warnings[1]?.text).toContain("SUBSET RUN");
  });

  test("an install conflict still outranks them as invalidating", () => {
    // The severities are not degrees of one thing. A sweep answered by an installed copy
    // floors every pull rate at zero, so its table is a table of nothing — while a subset's
    // figures are real. Collapsing the two would lose that.
    const warnings = reportWarnings(
      output({ install_conflict: "a copy is installed", subset: subsetOf(["alpha"]) }),
    );
    expect(warnings.map((warning) => warning.severity)).toEqual(["invalidating", "qualifying"]);
  });

  test("the rendered report puts the banner above the metric tiles", async () => {
    // Unmissable means ABOVE the figures, not beside them. A reader who meets a pull rate
    // first has already formed the view the caveat exists to prevent.
    const { generateDisclosureReport } = await import("../../report/disclosure-report.ts");
    const stamp = subsetOf(["alpha"]);
    const html = generateDisclosureReport(
      {
        skillName: "probe",
        skillPath: "skills/probe",
        tokenMethod: "estimator:chars-over-4",
        estimatedTokens: true,
        baselineBodyTokens: 100,
        bestBodyTokens: 100,
        baselineContextTokens: 1000,
        bestContextTokens: 1000,
        holdoutFraction: 0,
        trainSize: 1,
        holdoutSize: 0,
        runsPerScenario: 1,
        files: [],
        groundTruth: NO_GROUND_TRUTH,
        iterations: [],
        exitReason: "measurement_only",
        appliedTo: null,
        notes: [],
        warnings: reportWarnings(output({ subset: stamp })),
      },
      { autoRefresh: false },
    );
    const banner = html.indexOf("NOT A MEASUREMENT OF RECORD");
    const tiles = html.indexOf('class="g4"');
    expect(banner).toBeGreaterThan(-1);
    expect(tiles).toBeGreaterThan(-1);
    expect(banner).toBeLessThan(tiles);
  });
});

// ---------------------------------------------------------------------------
// The results envelope
// ---------------------------------------------------------------------------

/**
 * The measurement entry point was the only measured operation writing no envelope, so a
 * disclosure run's conditions — which model, which scenarios, what the machine's installed
 * set looked like, which runs were left out and why — survived nowhere. Everything below
 * drives the pure builder, for the reason the rest of this file gives: a judgement reachable
 * only by spending an hour of API time is a judgement with no coverage.
 */
describe("the measurement envelope", () => {
  /** A tally in which every run was measured, which is the uninteresting baseline. */
  const cleanTally = (over: Partial<RunTally> = {}): RunTally => ({
    measured: 2,
    unloaded: 0,
    timeout: 0,
    error: 0,
    ...over,
  });

  function envelope(
    over: Partial<MeasureOutput> = {},
    tally: RunTally = cleanTally(),
    scenarios: readonly DisclosureScenario[] = THREE,
  ): Envelope<DisclosureRow> {
    return buildMeasurementEnvelope({
      output: output({ scenario_count: scenarios.length, runs_per_scenario: 1, ...over }),
      tally,
      workers: 4,
      timeoutSeconds: 600,
      inlineThreshold: 0.8,
      graderModel: "sonnet",
      scenarioSetHash: hashJsonValue(scenarios),
      targetSha: "sha256:abc",
    });
  }

  const capsOf = (env: Envelope<DisclosureRow>): string => env.provenance.caps.join("\n");

  test("the run block names this operation, not the optimizer it borrows the builder from", () => {
    const env = envelope();
    expect(env.run.operation).toBe("measure-disclosure");
    expect(env.run.artifact).toBe("skill");
    expect(env.run.target).toBe("probe");
  });

  test("the model is the hardcoded instrument and is never null", () => {
    // The strongest comparability property this operation has, and it comes free from the
    // model being hardcoded rather than defaulted: two runs cannot silently differ by
    // whatever each operator had configured.
    expect(envelope().run.model).toBe(MEASUREMENT_MODEL);
  });

  test("a tier study records the substituted model, so the two arms differ on a key", () => {
    expect(envelope({ tier_study: "opus" }).run.model).toBe("opus");
  });

  test("the install state and its conflict are carried, not swept a second time", () => {
    // Re-sweeping would let the envelope disagree with the warning the operator was shown
    // and with the banner on the report, which are the other two places this sentence lands.
    const env = envelope({ install_state: "installed", install_conflict: "a copy is installed" });
    expect(env.run.installState).toBe("installed");
    expect(env.provenance.caps[0]).toBe("a copy is installed");
    // A verdict of its own, whose subject is the skill rather than a file, so a consumer
    // rendering only verdicts still meets it.
    expect(env.verdicts[0]).toEqual({
      subject: "probe",
      verdict: "unsound",
      reason: "a copy is installed",
    });
  });

  test("the timeout policy is `excluded`, the opposite of the trigger harness's", () => {
    expect(envelope().provenance.timeoutPolicy).toBe("excluded");
    expect(envelope().provenance.unit).toBe("scenario run");
  });

  // COUNTED VERSUS ALL. `assertions_total` has always been a counted-runs figure that did
  // not say so, and comparing two runs' headline denominators with nothing naming the
  // excluded runs is what produced the interrupted-pair misdiagnosis.

  test("the envelope names both totals and the cause of every excluded run", () => {
    const env = envelope(
      { runs_without_skill: 1, runs_loaded_via_file: 2, assertions_total: 4 },
      { measured: 6, unloaded: 1, timeout: 2, error: 1 },
    );
    const caps = capsOf(env);
    // Seven error-free runs (measured + unloaded), of which one never loaded and two loaded
    // by the model reading SKILL.md, leaves four behind the assertion figures.
    expect(caps).toContain("out of 7 error-free run(s)");
    expect(caps).toContain("`assertionsTotal` is 4");
    expect(caps).toContain("1 where the body never reached context");
    expect(caps).toContain("2 where it reached context because the model READ SKILL.md");
    expect(caps).toContain("2 timeout(s)");
    expect(caps).toContain("1 hard failure(s)");
    // And the trap named: `scored` counts the file-loaded runs IN, so it is not the
    // assertion denominator even though both are "runs that worked".
    expect(env.provenance.scored).toBe(6);
    expect(caps).toContain("`provenance.scored` is 6 and is NOT this denominator");
  });

  test("the excluded and failed counts follow this operation's policy, not the trigger one", () => {
    const env = envelope({}, { measured: 6, unloaded: 1, timeout: 2, error: 1 });
    // `excluded` folds unloaded runs in; `failed` counts only what the harness could not
    // complete. The two are deliberately not disjoint from `scored`.
    expect(env.provenance.excluded).toBe(4);
    expect(env.provenance.failed).toBe(3);
  });

  // THE OPTIMIZER'S VOCABULARY MUST NOT LEAK. `caps` is the field a reader consults to find
  // out what bounded the coverage; a sentence there naming a flag this tool does not have is
  // a false one, and a reader who catches it stops believing the rest of the list.

  test("no cap names machinery a measurement does not have", () => {
    const caps = capsOf(envelope());
    for (const absent of ["--max-candidates", "--max-iterations", "--holdout", "candidate layout"]) {
      expect(caps).not.toContain(absent);
    }
    expect(envelope().headline.map((metric) => metric.label)).not.toContain("iterations run");
  });

  test("it says instead that nothing was restructured, which is the real bound", () => {
    expect(capsOf(envelope())).toContain("Nothing was restructured");
    expect(capsOf(envelope())).toContain("no candidate was built");
  });

  test("baseline equals best, so no headline reports a saving of zero", () => {
    // A delta of zero beside a body-token count invites the conclusion that a restructure
    // was attempted and achieved nothing.
    for (const metric of envelope().headline) expect(metric).not.toHaveProperty("delta");
  });

  test("a subset run declares the cap that explains why a comparison will be refused", () => {
    const caps = capsOf(envelope({ subset: subsetOf(["alpha"]) }));
    expect(caps).toContain("--only ran 1 of 3 row(s)");
    expect(caps).toContain("NOT a measurement of record");
  });

  test("a tier study declares its cap, and names the comparability consequence", () => {
    const caps = capsOf(envelope({ tier_study: "opus" }));
    expect(caps).toContain("TIER STUDY");
    expect(caps).toContain("comparability key");
  });

  test("an ordinary run declares neither, so its caps carry no not-of-record claim", () => {
    const caps = capsOf(envelope());
    expect(caps).not.toContain("TIER STUDY");
    expect(caps).not.toContain("--only ran");
  });

  test("the envelope survives writeEnvelope, which is the only validator", () => {
    // Building an envelope the schema would refuse is a defect that otherwise surfaces on
    // the operator's machine at the end of an hour-long sweep.
    expect(() => EnvelopeSchema.parse(envelope())).not.toThrow();
  });
});

describe("comparing two disclosure runs", () => {
  function arm(options: {
    readonly scenarios?: readonly DisclosureScenario[];
    readonly tierStudy?: string;
    readonly subset?: ScenarioSubsetStamp;
  }): Envelope<DisclosureRow> {
    const scenarios = options.scenarios ?? THREE;
    return buildMeasurementEnvelope({
      output: output({
        scenario_count: scenarios.length,
        runs_per_scenario: 1,
        ...(options.tierStudy === undefined ? {} : { tier_study: options.tierStudy }),
        ...(options.subset === undefined ? {} : { subset: options.subset }),
      }),
      tally: { measured: scenarios.length, unloaded: 0, timeout: 0, error: 0 },
      workers: 4,
      timeoutSeconds: 600,
      inlineThreshold: 0.8,
      graderModel: "sonnet",
      // Over the rows that RAN, which is what makes the refusal below mechanical rather
      // than a matter of whoever is reading two files noticing.
      scenarioSetHash: hashJsonValue(scenarios),
      targetSha: "sha256:abc",
    });
  }

  test("two full-set arms over the identical scenario set compare comparable", () => {
    // The case that has to keep working. If the hash or the model varied per run for any
    // reason of its own, every legitimate before/after would be refused and the check would
    // be worse than useless — it would train a reader to ignore it.
    const result = compareEnvelopes(arm({}), arm({}));
    expect(result.comparable).toBe(true);
    expect(result.differing).toEqual([]);
  });

  test("a full-set arm and a subset arm are refused, on the set hash", () => {
    const full = arm({});
    const narrow = arm({ scenarios: [THREE[0]!], subset: subsetOf(["alpha"]) });
    const result = compareEnvelopes(full, narrow);
    expect(result.comparable).toBe(false);
    expect(result.differing).toContain("evalSetHash");
    // Mechanically, from the rows themselves: the stamp SAYS the run is narrow, and the
    // hash over the rows that ran is what makes the tooling act on it.
    expect(full.run.evalSetHash).not.toBe(narrow.run.evalSetHash);
    expect(explainIncomparability(result)).toContain("`evalSetHash`");
  });

  test("two different subsets of one file are refused against each other too", () => {
    const a = arm({ scenarios: [THREE[0]!], subset: subsetOf(["alpha"]) });
    const b = arm({ scenarios: [THREE[1]!], subset: subsetOf(["beta"]) });
    expect(compareEnvelopes(a, b).differing).toContain("evalSetHash");
  });

  test("a tier-study arm and a run of record are refused, on the model", () => {
    // Two different instruments. A stronger tier reaches the right file in spite of a bad
    // pointer, so a delta between these two reports a change of instrument as a change of
    // layout — which is precisely what the comparability check exists to prevent.
    const result = compareEnvelopes(arm({}), arm({ tierStudy: "opus" }));
    expect(result.comparable).toBe(false);
    expect(result.differing).toEqual(["model"]);
    expect(explainIncomparability(result)).toContain("`model`");
  });

  test("every comparability key is filled in, so none of them can compare equal by absence", () => {
    // A key left `undefined` on both sides compares equal and silently stops discriminating.
    const run = arm({}).run;
    for (const key of COMPARABILITY_KEYS) expect(run[key]).toBeDefined();
  });
});

test("the acceptEdits rule is stated in words, not left to the help text", () => {
  // The removed flag's fence was a quiet default. Honouring it means being loud.
  expect(ACCEPT_EDITS_NOTICE).toContain(MEASUREMENT_PERMISSION_MODE);
  expect(ACCEPT_EDITS_NOTICE).toContain("writes files");
  expect(ACCEPT_EDITS_NOTICE).toContain("Not configurable");
});
