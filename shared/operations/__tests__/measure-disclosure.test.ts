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

import { afterAll, expect, spyOn, test } from "bun:test";
import { rm } from "node:fs/promises";

import { liveReportPath, warnOnInstallConflict } from "../measure-disclosure.ts";

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
