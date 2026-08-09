#!/usr/bin/env bun
/**
 * Propose a replacement skill description from eval results.
 *
 * One proposal per call. Deciding whether the proposal is actually better is
 * `optimize-description.ts`'s job -- it measures the candidate against a held-out
 * split -- so nothing here claims an improvement, only a candidate.
 *
 * Takes eval results (from measure-triggering.ts) and generates an improved description by
 * calling `claude -p` as a subprocess (same auth pattern as measure-triggering.ts -- uses
 * the session's Claude Code auth, no separate ANTHROPIC_API_KEY needed).
 *
 * Port of improve_description.py. The prompt text is reproduced verbatim,
 * whitespace included, because it is the behavioural contract of this script.
 */

import { parseSkillMd } from "./lib/frontmatter.ts";
import { runCommand } from "../util/subprocess.ts";
import {
  flagBoolean,
  flagString,
  isRecord,
  parseCli,
  requireFlag,
  type EvalOutput,
  type QueryResult,
} from "./measure-triggering.ts";

/** Hard ceiling stated in the prompt. Descriptions past it get truncated by the harness. */
const DESCRIPTION_CHAR_LIMIT = 1024;

/** Default budget for one `claude -p` improvement call, in seconds. */
const IMPROVE_TIMEOUT_SECONDS = 300;

/**
 * The subset of an eval output this module actually reads. `optimize-description.ts` passes a
 * synthesised train-only slice that has no skill_name/description, so the wider
 * `EvalOutput` would be too strict here.
 */
export interface ScoredResults {
  readonly results: readonly QueryResult[];
  readonly summary: { readonly passed: number; readonly failed: number; readonly total: number };
}

/**
 * One prior attempt, as rendered into the prompt. Fields are optional because the
 * shape differs between the loop (train_*) and the standalone CLI (passed/total).
 */
export interface ProposeHistoryEntry {
  readonly description: string;
  readonly passed?: number;
  readonly failed?: number;
  readonly total?: number;
  readonly train_passed?: number;
  readonly train_failed?: number;
  readonly train_total?: number;
  readonly test_passed?: number | null;
  readonly test_total?: number | null;
  readonly results?: readonly QueryResult[];
  readonly note?: string;
  readonly iteration?: number;
  readonly train_results?: readonly QueryResult[];
}

export interface ProposeParams {
  readonly skillName: string;
  readonly skillContent: string;
  readonly currentDescription: string;
  readonly evalResults: ScoredResults;
  readonly history: readonly ProposeHistoryEntry[];
  readonly model: string;
  readonly testResults?: ScoredResults | undefined;
  readonly logDir?: string | undefined;
  readonly iteration?: number | undefined;
}

/** CPython `len()` counts code points; JS `.length` counts UTF-16 units. */
function charLength(text: string): number {
  return [...text].length;
}

/** CPython `str.strip('"')`: strip every leading and trailing quote, not just one. */
function stripQuotes(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && text[start] === '"') start += 1;
  while (end > start && text[end - 1] === '"') end -= 1;
  return text.slice(start, end);
}

/** Mirrors `text.strip().strip('"')` -- note it does not re-trim after unquoting. */
function extractDescription(text: string): string {
  const match = /<new_description>([\s\S]*?)<\/new_description>/.exec(text);
  const inner = match?.[1];
  return stripQuotes((inner ?? text).trim());
}

/**
 * Run `claude -p` with the prompt on stdin and return the text response.
 *
 * The prompt goes over stdin (not argv) because it embeds the full SKILL.md body
 * and can easily exceed a comfortable argv length.
 */
async function callClaude(
  prompt: string,
  model: string | undefined,
  timeoutSeconds: number = IMPROVE_TIMEOUT_SECONDS,
): Promise<string> {
  const cmd = ["claude", "-p", "--output-format", "text"];
  if (model !== undefined && model !== "") cmd.push("--model", model);

  const outcome = await runCommand(cmd, {
    stdin: prompt,
    timeoutMs: timeoutSeconds * 1000,
  });

  switch (outcome.kind) {
    case "timeout":
      throw new Error(`claude -p timed out after ${timeoutSeconds}s`);
    case "error":
      throw new Error(`claude -p could not be started: ${outcome.message}`);
    case "ok":
      if (outcome.exitCode !== 0) {
        throw new Error(`claude -p exited ${outcome.exitCode}\nstderr: ${outcome.stderr}`);
      }
      return outcome.stdout;
  }
}

function buildPrompt(params: ProposeParams): string {
  const failedTriggers = params.evalResults.results.filter(
    (result) => result.should_trigger && !result.pass,
  );
  const falseTriggers = params.evalResults.results.filter(
    (result) => !result.should_trigger && !result.pass,
  );

  const trainScore = `${params.evalResults.summary.passed}/${params.evalResults.summary.total}`;
  const scoresSummary =
    params.testResults === undefined
      ? `Train: ${trainScore}`
      : `Train: ${trainScore}, Test: ${params.testResults.summary.passed}/${params.testResults.summary.total}`;

  let prompt = `You are optimizing a skill description for a Claude Code skill called "${params.skillName}". A "skill" is sort of like a prompt, but with progressive disclosure -- there's a title and description that Claude sees when deciding whether to use the skill, and then if it does use the skill, it reads the .md file which has lots more details and potentially links to other resources in the skill folder like helper files and scripts and additional documentation or examples.

The description appears in Claude's "available_skills" list. When a user sends a query, Claude decides whether to invoke the skill based solely on the title and on this description. Your goal is to write a description that triggers for relevant queries, and doesn't trigger for irrelevant ones.

Here's the current description:
<current_description>
"${params.currentDescription}"
</current_description>

Current scores (${scoresSummary}):
<scores_summary>
`;

  if (failedTriggers.length > 0) {
    prompt += "FAILED TO TRIGGER (should have triggered but didn't):\n";
    for (const result of failedTriggers) {
      prompt += `  - "${result.query}" (triggered ${result.triggers}/${result.runs} times)\n`;
    }
    prompt += "\n";
  }

  if (falseTriggers.length > 0) {
    prompt += "FALSE TRIGGERS (triggered but shouldn't have):\n";
    for (const result of falseTriggers) {
      prompt += `  - "${result.query}" (triggered ${result.triggers}/${result.runs} times)\n`;
    }
    prompt += "\n";
  }

  if (params.history.length > 0) {
    prompt +=
      "PREVIOUS ATTEMPTS (do NOT repeat these — try something structurally different):\n\n";
    for (const entry of params.history) {
      const trainScoreText = `${entry.train_passed ?? entry.passed ?? 0}/${entry.train_total ?? entry.total ?? 0}`;
      const hasTestScore = entry.test_passed !== undefined && entry.test_passed !== null;
      const testScoreText = hasTestScore
        ? `${entry.test_passed ?? "?"}/${entry.test_total ?? "?"}`
        : undefined;
      const scoreText =
        `train=${trainScoreText}` + (testScoreText === undefined ? "" : `, test=${testScoreText}`);
      prompt += `<attempt ${scoreText}>\n`;
      prompt += `Description: "${entry.description}"\n`;
      if (entry.results !== undefined) {
        prompt += "Train results:\n";
        for (const result of entry.results) {
          const status = result.pass ? "PASS" : "FAIL";
          prompt += `  [${status}] "${result.query.slice(0, 80)}" (triggered ${result.triggers}/${result.runs})\n`;
        }
      }
      if (entry.note !== undefined && entry.note !== "") prompt += `Note: ${entry.note}\n`;
      prompt += "</attempt>\n\n";
    }
  }

  prompt += `</scores_summary>

Skill content (for context on what the skill does):
<skill_content>
${params.skillContent}
</skill_content>

Based on the failures, write a new and improved description that is more likely to trigger correctly. When I say "based on the failures", it's a bit of a tricky line to walk because we don't want to overfit to the specific cases you're seeing. So what I DON'T want you to do is produce an ever-expanding list of specific queries that this skill should or shouldn't trigger for. Instead, try to generalize from the failures to broader categories of user intent and situations where this skill would be useful or not useful. The reason for this is twofold:

1. Avoid overfitting
2. The list might get loooong and it's injected into ALL queries and there might be a lot of skills, so we don't want to blow too much space on any given description.

Concretely, your description should not be more than about 100-200 words, even if that comes at the cost of accuracy. There is a hard limit of 1024 characters — descriptions over that will be truncated, so stay comfortably under it.

Here are some tips that we've found to work well in writing these descriptions:
- The skill should be phrased in the imperative -- "Use this skill for" rather than "this skill does"
- The skill description should focus on the user's intent, what they are trying to achieve, vs. the implementation details of how the skill works.
- The description competes with other skills for Claude's attention — make it distinctive and immediately recognizable.
- If you're getting lots of failures after repeated attempts, change things up. Try different sentence structures or wordings.

I'd encourage you to be creative and mix up the style in different iterations since you'll have multiple opportunities to try different approaches and we'll just grab the highest-scoring one at the end.${" "}

Please respond with only the new description text in <new_description> tags, nothing else.`;

  return prompt;
}

/** Call Claude to improve the description based on eval results. */
export async function proposeDescription(params: ProposeParams): Promise<string> {
  const prompt = buildPrompt(params);
  const text = await callClaude(prompt, params.model);
  let description = extractDescription(text);

  const transcript: Record<string, unknown> = {
    iteration: params.iteration ?? null,
    prompt,
    response: text,
    parsed_description: description,
    char_count: charLength(description),
    over_limit: charLength(description) > DESCRIPTION_CHAR_LIMIT,
  };

  // Safety net: the prompt already states the 1024-char hard limit, but if the
  // model blew past it anyway, make one fresh single-turn call that quotes the
  // too-long version and asks for a shorter rewrite. (The old SDK path did this
  // as a true multi-turn; `claude -p` is one-shot, so we inline the prior output
  // into the new prompt instead.)
  //
  // The rewrite's result is accepted WITHOUT re-checking its length, and there is
  // exactly one attempt. That is faithful to the source, not an oversight: a
  // second over-limit answer is left to the harness to truncate.
  if (charLength(description) > DESCRIPTION_CHAR_LIMIT) {
    const shortenPrompt =
      `${prompt}\n\n` +
      `---\n\n` +
      `A previous attempt produced this description, which at ` +
      `${charLength(description)} characters is over the 1024-character hard limit:\n\n` +
      `"${description}"\n\n` +
      `Rewrite it to be under 1024 characters while keeping the most ` +
      `important trigger words and intent coverage. Respond with only ` +
      `the new description in <new_description> tags.`;
    const shortenText = await callClaude(shortenPrompt, params.model);
    const shortened = extractDescription(shortenText);

    transcript["rewrite_prompt"] = shortenPrompt;
    transcript["rewrite_response"] = shortenText;
    transcript["rewrite_description"] = shortened;
    transcript["rewrite_char_count"] = charLength(shortened);
    description = shortened;
  }

  transcript["final_description"] = description;

  if (params.logDir !== undefined && params.logDir !== "") {
    // Python mkdir'd first; Bun.write creates missing parents on its own.
    // `iteration or 'unknown'` treats 0 as absent, which this reproduces.
    const label = params.iteration ? String(params.iteration) : "unknown";
    await Bun.write(`${params.logDir}/improve_iter_${label}.json`, JSON.stringify(transcript, null, 2));
  }

  return description;
}

/**
 * Boundary parsers. Python read these files with no validation at all, so a
 * malformed row surfaced as `undefined/undefined` rendered into the improvement
 * prompt. These build the typed value instead of asserting it.
 */
function parseQueryResults(raw: readonly unknown[], source: string): QueryResult[] {
  return raw.map((entry, index) => {
    const item = isRecord(entry) ? entry : {};
    const query = item["query"];
    const shouldTrigger = item["should_trigger"];
    const triggerRate = item["trigger_rate"];
    const triggers = item["triggers"];
    const runs = item["runs"];
    const passed = item["pass"];
    // Defaulted rather than required, and `false` is the correct default rather than a
    // convenient one: every results file written before early stopping existed ran the
    // full budget on every query, which is exactly what `early_stopped: false` asserts.
    const earlyStopped = item["early_stopped"];
    if (
      typeof query !== "string" ||
      typeof shouldTrigger !== "boolean" ||
      typeof triggerRate !== "number" ||
      typeof triggers !== "number" ||
      typeof runs !== "number" ||
      typeof passed !== "boolean"
    ) {
      throw new TypeError(`${source}: result ${index} has an unexpected shape`);
    }
    return {
      query,
      should_trigger: shouldTrigger,
      trigger_rate: triggerRate,
      triggers,
      runs,
      pass: passed,
      early_stopped: earlyStopped === true,
    };
  });
}

function parseEvalOutput(raw: unknown, source: string): EvalOutput {
  if (!isRecord(raw)) throw new TypeError(`${source}: expected a JSON object of eval results`);
  const description = raw["description"];
  const results = raw["results"];
  const summary = isRecord(raw["summary"]) ? raw["summary"] : {};
  const skillName = raw["skill_name"];
  const passed = summary["passed"];
  const failed = summary["failed"];
  const total = summary["total"];

  if (typeof description !== "string") {
    throw new TypeError(`${source}: missing string "description"`);
  }
  if (!Array.isArray(results)) throw new TypeError(`${source}: missing "results" array`);
  if (typeof passed !== "number" || typeof failed !== "number" || typeof total !== "number") {
    throw new TypeError(`${source}: "summary" needs numeric passed/failed/total`);
  }

  return {
    skill_name: typeof skillName === "string" ? skillName : "",
    description,
    results: parseQueryResults(results, source),
    summary: { passed, failed, total },
  };
}

function parseHistory(raw: unknown, source: string): ProposeHistoryEntry[] {
  if (!Array.isArray(raw)) throw new TypeError(`${source}: expected a JSON array of attempts`);
  return raw.map((entry, index) => {
    const item = isRecord(entry) ? entry : {};
    const description = item["description"];
    if (typeof description !== "string") {
      throw new TypeError(`${source}: attempt ${index} has no string "description"`);
    }
    const number = (key: string): number | undefined => {
      const value = item[key];
      return typeof value === "number" ? value : undefined;
    };
    const results = item["results"];
    const note = item["note"];
    return {
      description,
      passed: number("passed"),
      failed: number("failed"),
      total: number("total"),
      train_passed: number("train_passed"),
      train_failed: number("train_failed"),
      train_total: number("train_total"),
      test_passed: number("test_passed"),
      test_total: number("test_total"),
      iteration: number("iteration"),
      results: Array.isArray(results) ? parseQueryResults(results, source) : undefined,
      note: typeof note === "string" ? note : undefined,
    };
  });
}

async function main(): Promise<void> {
  const { flags } = parseCli(
    {
      "eval-results": { kind: "string", help: "Path to eval results JSON (from measure-triggering.ts)" },
      "skill-path": { kind: "string", help: "Path to skill directory" },
      history: { kind: "string", help: "Path to history JSON (previous attempts)" },
      model: { kind: "string", help: "Model for improvement" },
      verbose: { kind: "boolean", default: false, help: "Print thinking to stderr" },
      help: { kind: "boolean", short: "h", help: "Show this message" },
    },
    "Usage: bun shared/scripts/propose-description.ts --eval-results <path> --skill-path <path> --model <id>",
  );
  const evalResultsPath = requireFlag(flags, "eval-results");
  const skillPath = requireFlag(flags, "skill-path");
  const model = requireFlag(flags, "model");
  const verbose = flagBoolean(flags, "verbose");

  if (!(await Bun.file(`${skillPath}/SKILL.md`).exists())) {
    console.error(`Error: No SKILL.md found at ${skillPath}`);
    process.exit(1);
  }

  const rawResults: unknown = await Bun.file(evalResultsPath).json();
  const evalResults = parseEvalOutput(rawResults, evalResultsPath);
  const historyPath = flagString(flags, "history");
  const history: ProposeHistoryEntry[] =
    historyPath === undefined
      ? []
      : parseHistory(await Bun.file(historyPath).json(), historyPath);

  const { name, content } = await parseSkillMd(skillPath);
  const currentDescription = evalResults.description;

  if (verbose) {
    console.error(`Current: ${currentDescription}`);
    console.error(`Score: ${evalResults.summary.passed}/${evalResults.summary.total}`);
  }

  const newDescription = await proposeDescription({
    skillName: name,
    skillContent: content,
    currentDescription,
    evalResults,
    history,
    model,
  });

  if (verbose) console.error(`Improved: ${newDescription}`);

  console.log(
    JSON.stringify(
      {
        description: newDescription,
        history: [
          ...history,
          {
            description: currentDescription,
            passed: evalResults.summary.passed,
            failed: evalResults.summary.failed,
            total: evalResults.summary.total,
            results: evalResults.results,
          },
        ],
      },
      null,
      2,
    ),
  );
}

if (import.meta.main) await main();
