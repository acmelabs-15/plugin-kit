/**
 * The neighbour sweep must never hand the target's own description back as a
 * neighbour: synthesize-scenarios feeds neighbour descriptions into a prompt that
 * is guarded against the target's description, so a copy of the target found under
 * another path trips the circularity guard (measured: 40 leaks from a results
 * snapshot plus the target itself, 2026-08-30). Two defences, both pinned here:
 * the target's `name` is excluded wherever it appears, and `evals/` (where
 * skill-creator writes `results/skill-snapshot/SKILL.md`) is never scanned.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { discoverSkills, findNeighbours } from "../check-overlap";

const skill = (name: string, description: string) =>
  `---\nname: ${name}\ndescription: "${description}"\n---\n\n# ${name}\n`;

const project = await mkdtemp(join(tmpdir(), "overlap-"));
const skills = join(project, ".claude", "skills");
await mkdir(join(skills, "session", "evals", "results", "skill-snapshot"), { recursive: true });
await mkdir(join(skills, "run-scripts"), { recursive: true });
await mkdir(join(skills, "session-copy"), { recursive: true });
await writeFile(
  join(skills, "session", "SKILL.md"),
  skill("session", "Runs the session ritual: start, entry, end."),
);
await writeFile(
  join(skills, "session", "evals", "results", "skill-snapshot", "SKILL.md"),
  skill("session", "Runs the session ritual: start, record, end (older)."),
);
await writeFile(
  join(skills, "session-copy", "SKILL.md"),
  skill("session", "Runs the session ritual: start, entry, end."),
);
await writeFile(
  join(skills, "run-scripts", "SKILL.md"),
  skill("run-scripts", "Drive the session tool; append, check a session log."),
);

afterAll(async () => {
  await rm(project, { recursive: true, force: true });
});

describe("discoverSkills", () => {
  test("skips SKILL.md files under evals/ and every skill carrying the target's name", async () => {
    const target = join(skills, "session", "SKILL.md");
    const names = (await discoverSkills(project, target, "session")).map((s) => s.name);
    expect(names).not.toContain("session");
    expect(names).toContain("run-scripts");
  });

  test("without excludeName only the exact path is excluded (the old behaviour)", async () => {
    const target = join(skills, "session", "SKILL.md");
    const paths = (await discoverSkills(project, target)).map((s) => s.path);
    expect(paths).toContain(join(skills, "session-copy", "SKILL.md"));
    expect(paths).not.toContain(join(skills, "session", "evals", "results", "skill-snapshot", "SKILL.md"));
  });
});

describe("findNeighbours", () => {
  test("a target handed in from a scratch copy still cannot match itself by name", async () => {
    const report = await findNeighbours({
      targetTerms: new Set(["session", "ritual", "append", "check"]),
      excludePath: "/somewhere/else/session/SKILL.md",
      excludeName: "session",
      projectDir: project,
      minShared: 1,
    });
    // The sweep also reads ~/.claude/skills, so the machine's own skills may appear;
    // the assertion is about the target, not the rest of the list.
    const names = report.neighbours.map((n) => n.skill.name);
    expect(names).toContain("run-scripts");
    expect(names).not.toContain("session");
  });
});
