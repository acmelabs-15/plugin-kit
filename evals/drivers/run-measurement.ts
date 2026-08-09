#!/usr/bin/env bun
/**
 * Driver for the measurement pass recorded in `evals/MEASUREMENTS.md`.
 *
 * Kept in the repository because the numbers in that file are only checkable if
 * the thing that produced them is checkable too — a measurement nobody can
 * re-run is an assertion, not evidence.
 *
 * Runs skills in pairs. That is not arbitrary: each phase already fans out to
 * its own workers, and the box these ran on had two cores, so a third
 * concurrent skill bought queueing rather than throughput.
 *
 * Usage:
 *   bun evals/drivers/run-measurement.ts <phase> [--skills a,b] [--out <dir>]
 *
 *   phase: trigger | optimize | disclosure
 */

import { mkdir } from "node:fs/promises";

const ALL_SKILLS = [
  "skill-creator",
  "agent-creator",
  "hook-creator",
  "mcp-creator",
  "command-creator",
  "create-plugin",
] as const;

const PHASES = {
  trigger: {
    script: "shared/operations/measure-triggering.ts",
    defaultOut: "evals/results/baseline",
    // `--no-early-stop` is the one flag here that costs wall clock on purpose. The sweep
    // normally stops a query as soon as its verdict is settled, which never changes a
    // pass or a fail but does report the rate over attempts actually run -- at
    // `--runs-per-query 2` a query that triggers first time would come back 1/1 instead
    // of 2/2. The numbers in MEASUREMENTS.md are RATES compared against each other across
    // runs, so every one of them has to share a denominator.
    args: (skill: string) => [
      "--eval-set", `evals/trigger/${skill}.json`,
      "--target-path", `skills/${skill}`,
      "--target-type", "skill",
      "--runs-per-query", "2",
      "--num-workers", "6",
      "--timeout", "150",
      "--no-early-stop",
    ],
  },
  optimize: {
    script: "shared/operations/optimize-description.ts",
    defaultOut: "evals/results/optimize",
    args: (skill: string, out: string) => [
      "--eval-set", `evals/trigger/${skill}.json`,
      "--target-path", `skills/${skill}`,
      "--target-type", "skill",
      "--model", "opus",
      "--runs-per-query", "2",
      "--num-workers", "6",
      "--timeout", "150",
      "--max-iterations", "2",
      "--holdout", "0.4",
      "--report", "none",
      "--results-dir", `${out}/${skill}`,
    ],
  },
  disclosure: {
    script: "shared/operations/measure-disclosure.ts",
    defaultOut: "evals/results/disclosure",
    // The measurement entry point, not the optimizer driven with `--max-iterations 1
    // --holdout 0`. Those flags used to mean "just measure" here, which worked but said it
    // in the optimizer's vocabulary and left `--apply` and `--max-candidates` in reach of a
    // driver that has no business with either. The sweep underneath is the same code.
    args: (skill: string, out: string) => [
      "--skill-path", `skills/${skill}`,
      "--scenarios", `evals/disclosure/${skill}.json`,
      "--model", "opus",
      "--runs-per-scenario", "1",
      "--num-workers", "5",
      "--timeout", "600",
      "--report", "none",
      "--results-dir", `${out}/${skill}`,
      "--verbose",
    ],
  },
} as const;

type PhaseName = keyof typeof PHASES;

function flag(name: string): string | undefined {
  const i = Bun.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : Bun.argv[i + 1];
}

async function runOne(phase: PhaseName, skill: string, out: string): Promise<void> {
  const spec = PHASES[phase];
  const args = (spec.args as (s: string, o: string) => string[])(skill, out);
  const stdout = Bun.file(`${out}/${skill}.json`);
  const stderr = Bun.file(`${out}/${skill}.log`);
  const proc = Bun.spawn(["bun", spec.script, ...args], {
    stdout,
    stderr,
    stdin: "ignore",
  });
  const code = await proc.exited;
  const line = `${skill} exit=${code} ${new Date().toISOString().slice(11, 19)}\n`;
  const progress = `${out}/PROGRESS`;
  const prior = (await Bun.file(progress).exists()) ? await Bun.file(progress).text() : "";
  await Bun.write(progress, prior + line);
}

const phase = Bun.argv[2] as PhaseName | undefined;
if (phase === undefined || !(phase in PHASES)) {
  console.error("Usage: bun evals/drivers/run-measurement.ts <trigger|optimize|disclosure> [--skills a,b] [--out <dir>]");
  process.exit(2);
}

const skills = (flag("skills")?.split(",") ?? [...ALL_SKILLS]).map((s) => s.trim());
const out = flag("out") ?? PHASES[phase].defaultOut;
await mkdir(out, { recursive: true });
await Bun.write(`${out}/PROGRESS`, `START ${new Date().toISOString().slice(11, 19)}\n`);

for (let i = 0; i < skills.length; i += 2) {
  const pair = skills.slice(i, i + 2).filter((s): s is string => s !== undefined);
  await Promise.all(pair.map((s) => runOne(phase, s, out)));
}

const done = `ALL DONE ${new Date().toISOString().slice(11, 19)}\n`;
await Bun.write(`${out}/PROGRESS`, (await Bun.file(`${out}/PROGRESS`).text()) + done);
console.log(done.trim());
