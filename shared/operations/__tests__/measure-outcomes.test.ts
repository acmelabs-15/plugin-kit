/**
 * What is worth testing about an outcome measurement, given that its expensive half --
 * spawning `claude` twice per eval -- is deliberately behind a seam.
 *
 * Two things. First, baseline SELECTION: the command case is a different question wearing
 * the same shape, and every guard that keeps it from being read as an artifact-contribution
 * number is a decision made in code and therefore testable in code. Second, the failure and
 * partial paths: a throttled cell must never arrive as a result, and a run that stopped
 * short must say so in its own output. Both are the failures that produce a well-formed,
 * wrong file, which is exactly the kind a suite has to catch because a reader cannot.
 */

import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

import { EnvelopeSchema, readEnvelope, writeEnvelope, type ArtifactKind } from "../../envelope.ts";
import {
  assertWritableOut,
  buildOutcomesEnvelope,
  classifyFailureText,
  deltaLabel,
  measureOutcomes,
  parseGrading,
  parseOutcomeEvalSet,
  planCells,
  readRunStream,
  runCell,
  selectBaseline,
  summarizeArm,
  TREATMENT_CONFIGURATION,
  type CompletedRun,
  type Grader,
  type OutcomeEval,
  type OutcomesOutput,
  type RunExecutor,
  type RunOutcome,
} from "../measure-outcomes.ts";

const EVALS: readonly OutcomeEval[] = [
  { id: 1, name: "extracts-tables", prompt: "Pull the tables out of report.pdf", expectations: ["a", "b"] },
  { id: 2, name: "writes-summary", prompt: "Summarize report.pdf", expectations: ["c"] },
];

const completed = (over: Partial<CompletedRun> = {}): CompletedRun => ({
  kind: "completed",
  transcript: "did the thing",
  durationSeconds: 12,
  tokens: 100,
  toolCalls: 3,
  ...over,
});

/** Passes every expectation in the treatment arm and none in the baseline arm. */
const armGrader: Grader = async ({ evalItem, request }) => ({
  kind: "graded",
  expectations: evalItem.expectations.map((text) => ({
    text,
    passed: request.configuration === TREATMENT_CONFIGURATION,
    evidence: "stub",
  })),
});

const alwaysCompletes: RunExecutor = async () => completed();

const envelopeInput = (output: OutcomesOutput, inProgress: boolean) => ({
  output,
  inProgress,
  model: "opus",
  graderModel: "sonnet",
  workers: 2,
  runsPer: 1,
  timeoutSeconds: 600,
  evalSetHash: "sha256:eval",
  targetSha: "sha256:target",
  installState: "absent" as const,
  isolation: "verified" as const,
});

// ---------------------------------------------------------------------------
// Baseline selection -- the reason this operation was built last
// ---------------------------------------------------------------------------

test("every artifact kind has a baseline, and only the command one is not a control", () => {
  const kinds: readonly ArtifactKind[] = ["skill", "agent", "command", "mcp", "plugin"];
  for (const kind of kinds) {
    const baseline = selectBaseline(kind);
    expect(baseline.mechanism.length).toBeGreaterThan(0);
    expect(baseline.question.length).toBeGreaterThan(0);
    expect(baseline.answersArtifactContribution).toBe(kind !== "command");
  }
});

test("the four artifact-withheld baselines name what withholding means for their kind", () => {
  expect(selectBaseline("skill").mechanism).toContain("skill absent");
  expect(selectBaseline("agent").mechanism).toContain("no delegation");
  expect(selectBaseline("mcp").mechanism).toContain("server removed");
  expect(selectBaseline("plugin").mechanism).toContain("uninstalled");
  for (const kind of ["skill", "agent", "mcp", "plugin"] as const) {
    expect(selectBaseline(kind).control).toBe("artifact-withheld");
    expect(selectBaseline(kind).caps).toEqual([]);
  }
});

test("the command baseline is named, capped and labelled as a different measurement", () => {
  const command = selectBaseline("command");
  expect(command.control).toBe("body-withheld");
  // A different configuration name, so no consumer can group the two arms as one column.
  expect(command.configuration).not.toBe(selectBaseline("skill").configuration);
  expect(command.caps.length).toBeGreaterThan(0);
  expect(command.caps.join(" ")).toContain("not whether the command artifact helped");
  expect(command.question).toContain("no would-it-have-fired control exists");
});

test("the delta label differs between a command run and every other kind", () => {
  const commandLabel = deltaLabel(selectBaseline("command"));
  for (const kind of ["skill", "agent", "mcp", "plugin"] as const) {
    expect(deltaLabel(selectBaseline(kind))).not.toBe(commandLabel);
  }
  expect(commandLabel).toContain("NOT artifact contribution");
});

test("a command's arms differ by the body; every other kind's arms differ by availability", () => {
  const commandCells = planCells({
    evals: EVALS,
    baseline: selectBaseline("command"),
    runsPerConfiguration: 1,
    timeoutSeconds: 60,
    model: undefined,
    commandBody: "COMMAND BODY",
  });
  const [treatment, control] = commandCells;
  expect(treatment?.prompt).toContain("COMMAND BODY");
  expect(control?.prompt).toBe(EVALS[0]?.prompt);
  // A command is invoked by being typed, so nothing is installed in either arm.
  expect(treatment?.artifactAvailable).toBe(false);

  const skillCells = planCells({
    evals: EVALS,
    baseline: selectBaseline("skill"),
    runsPerConfiguration: 1,
    timeoutSeconds: 60,
    model: undefined,
  });
  expect(skillCells[0]?.prompt).toBe(skillCells[1]?.prompt);
  expect(skillCells[0]?.artifactAvailable).toBe(true);
  expect(skillCells[1]?.artifactAvailable).toBe(false);
  expect(skillCells).toHaveLength(EVALS.length * 2);
});

test("a command measurement without the body is refused rather than run", async () => {
  await expect(
    measureOutcomes({
      artifact: "command",
      targetName: "review",
      evals: EVALS,
      runsPerConfiguration: 1,
      numWorkers: 1,
      timeoutSeconds: 60,
      model: undefined,
      executor: alwaysCompletes,
      grader: armGrader,
    }),
  ).rejects.toThrow(/command body/);
});

test("a command envelope carries the body-content label and the cap in its own output", async () => {
  const output = await measureOutcomes({
    artifact: "command",
    targetName: "review",
    evals: EVALS,
    runsPerConfiguration: 1,
    numWorkers: 2,
    timeoutSeconds: 60,
    model: undefined,
    commandBody: "BODY",
    executor: alwaysCompletes,
    grader: armGrader,
  });
  const envelope = buildOutcomesEnvelope(envelopeInput(output, false));
  const delta = envelope.headline.find((metric) => metric.label.includes("delta"));
  expect(delta?.label).toContain("body-content measure");
  expect(envelope.provenance.caps.join(" ")).toContain("not whether the command artifact helped");
  expect(envelope.verdicts.find((v) => v.subject === "baseline")?.verdict).toBe("body-withheld");
  // Per-eval verdicts are suffixed so a grep for "improved" cannot mistake the two.
  const evalVerdict = envelope.verdicts.find((v) => v.subject === "eval:extracts-tables");
  expect(evalVerdict?.verdict).toBe("improved (body-content)");
});

// ---------------------------------------------------------------------------
// Failure paths -- a run that did not happen is never a result
// ---------------------------------------------------------------------------

test("rate-limit text is classified as a throttle, ordinary failure text is not", () => {
  expect(classifyFailureText("Claude AI usage limit reached")).toBe("throttled");
  expect(classifyFailureText("HTTP 429 Too Many Requests")).toBe("throttled");
  expect(classifyFailureText("overloaded_error")).toBe("throttled");
  expect(classifyFailureText("ENOENT: claude not found")).toBe("failed");
});

test.each([
  ["timeout", { kind: "timeout", seconds: 60 } as RunOutcome, "timeout"],
  ["throttle", { kind: "throttled", message: "rate limit" } as RunOutcome, "throttled"],
  ["spawn error", { kind: "failed", message: "ENOENT" } as RunOutcome, "error"],
])("a %s cell is excluded, never scored", async (_name, outcome, failureKind) => {
  const row = await runCell({
    request: planCells({
      evals: EVALS,
      baseline: selectBaseline("skill"),
      runsPerConfiguration: 1,
      timeoutSeconds: 60,
      model: undefined,
    })[0] as never,
    executor: async () => outcome,
    grader: armGrader,
  });
  expect(row.status).toBe("excluded");
  expect(row.failureKind).toBe(failureKind as never);
  expect(row.passRate).toBeNull();
  expect(row.passed).toBeNull();
});

test("a failed executor whose message names a rate limit is recorded as throttled", async () => {
  const request = planCells({
    evals: EVALS,
    baseline: selectBaseline("skill"),
    runsPerConfiguration: 1,
    timeoutSeconds: 60,
    model: undefined,
  })[0] as never;
  const thrown = await runCell({
    request,
    executor: async () => {
      throw new Error("stream closed: usage limit reached");
    },
    grader: armGrader,
  });
  expect(thrown.failureKind).toBe("throttled");
  const returned = await runCell({
    request,
    executor: async () => ({ kind: "failed", message: "429 from the gateway" }),
    grader: armGrader,
  });
  expect(returned.failureKind).toBe("throttled");
});

test("a grader that fails or returns nothing excludes the cell rather than scoring zero", async () => {
  const request = planCells({
    evals: EVALS,
    baseline: selectBaseline("skill"),
    runsPerConfiguration: 1,
    timeoutSeconds: 60,
    model: undefined,
  })[0] as never;
  const failed = await runCell({
    request,
    executor: alwaysCompletes,
    grader: async () => ({ kind: "failed", message: "no JSON" }),
  });
  expect(failed.status).toBe("excluded");
  expect(failed.failureKind).toBe("grader-failed");
  // Metrics the run DID produce survive the exclusion; only the score is withheld.
  expect(failed.durationSeconds).toBe(12);

  const empty = await runCell({
    request,
    executor: alwaysCompletes,
    grader: async () => ({ kind: "graded", expectations: [] }),
  });
  expect(empty.failureKind).toBe("grader-failed");

  const threw = await runCell({
    request,
    executor: alwaysCompletes,
    grader: async () => {
      throw new Error("grader exploded");
    },
  });
  expect(threw.failureKind).toBe("grader-failed");
});

test("an eval with no expectations is excluded and does not count as a failure", async () => {
  const output = await measureOutcomes({
    artifact: "skill",
    targetName: "pdf",
    evals: [{ id: 9, name: "unchecked", prompt: "do something", expectations: [] }],
    runsPerConfiguration: 1,
    numWorkers: 1,
    timeoutSeconds: 60,
    model: undefined,
    executor: alwaysCompletes,
    grader: armGrader,
  });
  const envelope = buildOutcomesEnvelope(envelopeInput(output, false));
  expect(envelope.provenance.scored).toBe(0);
  expect(envelope.provenance.excluded).toBe(2);
  expect(envelope.provenance.failed).toBe(0);
  expect(envelope.provenance.caps.join(" ")).toContain("no expectations");
});

test("a throttled sweep reports its failures rather than a clean zero", async () => {
  let call = 0;
  const executor: RunExecutor = async () => {
    call += 1;
    return call > 2 ? { kind: "throttled", message: "rate limit reached" } : completed();
  };
  const output = await measureOutcomes({
    artifact: "skill",
    targetName: "pdf",
    evals: EVALS,
    runsPerConfiguration: 1,
    numWorkers: 1,
    timeoutSeconds: 60,
    model: undefined,
    executor,
    grader: armGrader,
  });
  const envelope = buildOutcomesEnvelope(envelopeInput(output, false));
  expect(envelope.provenance.failed).toBeGreaterThan(0);
  expect(envelope.provenance.excluded).toBe(envelope.provenance.failed);
  expect(envelope.provenance.timeoutPolicy).toBe("excluded");
  expect(envelope.provenance.caps.join(" ")).toContain("throttled by the API and are EXCLUDED");
  expect(output.exit_reason).toStartWith("partial");
  expect(envelope.verdicts.find((v) => v.subject === "run")?.verdict).toBe("partial");
});

// ---------------------------------------------------------------------------
// Partial versus complete
// ---------------------------------------------------------------------------

test("a snapshot says in progress; the final write says complete", async () => {
  const snapshots: OutcomesOutput[] = [];
  const output = await measureOutcomes({
    artifact: "skill",
    targetName: "pdf",
    evals: EVALS,
    runsPerConfiguration: 1,
    numWorkers: 1,
    timeoutSeconds: 60,
    model: undefined,
    executor: alwaysCompletes,
    grader: armGrader,
    onCell: (rows, settled, planned) => {
      snapshots.push({
        artifact: "skill",
        target_name: "pdf",
        baseline: selectBaseline("skill"),
        planned_cells: planned,
        rows: [...rows],
        exit_reason: settled < planned ? "in progress" : "settled",
      });
    },
  });
  expect(snapshots[0]?.exit_reason).toBe("in progress");
  const partial = buildOutcomesEnvelope(envelopeInput(snapshots[0] as OutcomesOutput, true));
  expect(partial.verdicts.find((v) => v.subject === "run")?.verdict).toBe("in-progress");
  expect(partial.provenance.caps.join(" ")).toContain("Run in progress");

  expect(output.exit_reason).toBe("complete");
  const complete = buildOutcomesEnvelope(envelopeInput(output, false));
  expect(complete.verdicts.find((v) => v.subject === "run")?.verdict).toBe("complete");
  expect(complete.provenance.caps.join(" ")).not.toContain("Run in progress");
  expect(complete.provenance.scored).toBe(4);
  expect(complete.provenance.failed).toBe(0);
});

test("a delta needs both arms, and the skill arm's win shows as a positive delta", async () => {
  const output = await measureOutcomes({
    artifact: "skill",
    targetName: "pdf",
    evals: EVALS,
    runsPerConfiguration: 2,
    numWorkers: 3,
    timeoutSeconds: 60,
    model: undefined,
    executor: alwaysCompletes,
    grader: armGrader,
  });
  const envelope = buildOutcomesEnvelope(envelopeInput(output, false));
  const delta = envelope.headline.find((metric) => metric.label.includes("delta"));
  expect(delta?.value).toBe(1);
  expect(delta?.label).toBe("pass rate delta (artifact withheld)");
  expect(summarizeArm(output.rows, TREATMENT_CONFIGURATION).passRate.mean).toBe(1);

  const oneArmed = buildOutcomesEnvelope(
    envelopeInput(
      { ...output, rows: output.rows.filter((row) => row.configuration === TREATMENT_CONFIGURATION) },
      false,
    ),
  );
  expect(oneArmed.headline.some((metric) => metric.label.includes("delta"))).toBe(false);
  expect(oneArmed.verdicts.find((v) => v.subject === "eval:writes-summary")?.verdict).toBe(
    "undetermined",
  );
});

test("caps always name the manual steps this operation does not perform", async () => {
  const output = await measureOutcomes({
    artifact: "skill",
    targetName: "pdf",
    evals: EVALS,
    runsPerConfiguration: 1,
    numWorkers: 1,
    timeoutSeconds: 60,
    model: undefined,
    executor: alwaysCompletes,
    grader: armGrader,
  });
  const caps = buildOutcomesEnvelope({ ...envelopeInput(output, false), model: null }).provenance.caps.join(" ");
  expect(caps).toContain("analyst pass");
  expect(caps).toContain("human review");
  expect(caps).toContain("No model was pinned");
});

// ---------------------------------------------------------------------------
// The envelope contract
// ---------------------------------------------------------------------------

test("the emitted envelope validates against EnvelopeSchema and survives a round trip", async () => {
  const output = await measureOutcomes({
    artifact: "skill",
    targetName: "pdf",
    evals: EVALS,
    runsPerConfiguration: 1,
    numWorkers: 2,
    timeoutSeconds: 60,
    model: undefined,
    executor: alwaysCompletes,
    grader: armGrader,
  });
  const envelope = buildOutcomesEnvelope(envelopeInput(output, false));
  expect(EnvelopeSchema.safeParse(envelope).success).toBe(true);
  expect(envelope.run.operation).toBe("measure-outcomes");

  const dir = await mkdtemp(`${tmpdir()}/measure-outcomes-test-`);
  try {
    await writeEnvelope(`${dir}/envelope.json`, envelope);
    const back = await readEnvelope(`${dir}/envelope.json`);
    expect(back.run.operation).toBe("measure-outcomes");
    expect(back.rows).toHaveLength(4);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Inputs, stream reading and the protected output paths
// ---------------------------------------------------------------------------

test("an eval set parses from either shape and rejects an eval with no prompt", () => {
  const wrapped = parseOutcomeEvalSet({ evals: [{ id: 3, prompt: "p", expectations: ["x"] }] }, "f");
  expect(wrapped[0]?.name).toBe("eval-3");
  const bare = parseOutcomeEvalSet([{ eval_name: "named", prompt: "p" }], "f");
  expect(bare[0]?.name).toBe("named");
  expect(bare[0]?.expectations).toEqual([]);
  expect(() => parseOutcomeEvalSet([{ id: 1 }], "f")).toThrow(/no "prompt"/);
  expect(() => parseOutcomeEvalSet("nope", "f")).toThrow(/expected an array/);
});

test("a stream that closes without a result event is not a completed run", () => {
  const withResult = readRunStream([
    JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use" }], usage: { input_tokens: 10, output_tokens: 5 } } }),
    JSON.stringify({ type: "result", subtype: "success", result: "done" }),
  ]);
  expect(withResult.sawResult).toBe(true);
  expect(withResult.tokens).toBe(15);
  expect(withResult.toolCalls).toBe(1);
  expect(withResult.errorText).toBeNull();

  const exhausted = readRunStream([JSON.stringify({ type: "assistant", message: { content: [] } }), "not json"]);
  expect(exhausted.sawResult).toBe(false);
  expect(exhausted.tokens).toBeNull();

  const errored = readRunStream([
    JSON.stringify({ type: "result", subtype: "error_during_execution", is_error: true, result: "rate limit" }),
  ]);
  expect(errored.errorText).toBe("rate limit");
  expect(classifyFailureText(errored.errorText ?? "")).toBe("throttled");
});

test("a grader reply that is not gradeable fails rather than passing nothing", () => {
  expect(parseGrading('prose {"expectations":[{"text":"a","passed":true,"evidence":"e"}]} more')).toEqual({
    kind: "graded",
    expectations: [{ text: "a", passed: true, evidence: "e" }],
  });
  expect(parseGrading("no json here").kind).toBe("failed");
  expect(parseGrading("{not json}").kind).toBe("failed");
  expect(parseGrading('{"expectations": "nope"}').kind).toBe("failed");
  expect(parseGrading('{"expectations": [{"text":"a"}]}').kind).toBe("failed");
});

test("the immutable measurement directories are refused as output locations", () => {
  for (const path of ["evals/results", "./evals/trigger/x", "evals/disclosure/run/"]) {
    expect(() => assertWritableOut(path)).toThrow(/immutable/);
  }
  expect(() => assertWritableOut("measurements/outcomes")).not.toThrow();
  expect(() => assertWritableOut("evals/results-of-mine")).not.toThrow();
});
