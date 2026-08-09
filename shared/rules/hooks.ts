/**
 * Hook rules: matcher syntax, handler existence, and the exit-code contract.
 *
 * Hooks have no creator skill, but they remain a shipped artifact, and the three
 * things that go wrong with them all fail silently. A matcher that matches
 * nothing, a handler path that does not resolve, and a guard on an event that
 * discards its exit code all produce the same symptom -- the hook does not fire,
 * and nothing says why.
 *
 * The per-event table below is copied from the parked hook-testing harness
 * rather than imported. Copied because `future/` is parked: a live validator
 * that reaches into it would make the parking a lie and would break the moment
 * the directory is moved or pruned. The cost is that the table has to be
 * re-copied if Claude Code adds an event, which is cheap and visible; the
 * alternative cost is an import that nobody expects to be load-bearing.
 */

import {
  expandAnchors,
  isDirectory,
  isRecord,
  pathExists,
  PLUGIN_ROOT_TOKEN,
  readText,
  resolvePath,
} from "./lib.ts";
import { RuleAbort, section, type RuleContext, type RuleModule, type Section } from "./types.ts";

/**
 * What exit code 2 does on an event.
 *
 * `ignored` is the one worth checking for: the exit code and stderr are both
 * discarded, so a handler written as a guard on one of those events is
 * decorative. It looks like a block and is not one.
 */
export type BlockMode = "blocks" | "feedback" | "ignored" | "aborts" | "user-only";

export interface EventRule {
  /** Payload field the `matcher` is tested against; `null` when the event takes none. */
  readonly matcherField: string | null;
  readonly blocking: BlockMode;
  /** Default timeout in seconds for `command`, `http` and `mcp_tool` handlers. */
  readonly defaultTimeoutSeconds: number;
}

/** Every event Claude Code fires, with the semantics a validator needs. */
export const EVENT_RULES: Readonly<Record<string, EventRule>> = {
  SessionStart: { matcherField: "source", blocking: "user-only", defaultTimeoutSeconds: 600 },
  Setup: { matcherField: "trigger", blocking: "user-only", defaultTimeoutSeconds: 600 },
  InstructionsLoaded: { matcherField: "load_reason", blocking: "ignored", defaultTimeoutSeconds: 600 },
  UserPromptSubmit: { matcherField: null, blocking: "blocks", defaultTimeoutSeconds: 30 },
  UserPromptExpansion: { matcherField: "command_name", blocking: "blocks", defaultTimeoutSeconds: 600 },
  MessageDisplay: { matcherField: null, blocking: "ignored", defaultTimeoutSeconds: 10 },
  PreToolUse: { matcherField: "tool_name", blocking: "blocks", defaultTimeoutSeconds: 600 },
  PermissionRequest: { matcherField: "tool_name", blocking: "blocks", defaultTimeoutSeconds: 600 },
  PermissionDenied: { matcherField: "tool_name", blocking: "ignored", defaultTimeoutSeconds: 600 },
  PostToolUse: { matcherField: "tool_name", blocking: "feedback", defaultTimeoutSeconds: 600 },
  PostToolUseFailure: { matcherField: "tool_name", blocking: "feedback", defaultTimeoutSeconds: 600 },
  PostToolBatch: { matcherField: null, blocking: "blocks", defaultTimeoutSeconds: 600 },
  Notification: { matcherField: "notification_type", blocking: "user-only", defaultTimeoutSeconds: 600 },
  SubagentStart: { matcherField: "agent_type", blocking: "user-only", defaultTimeoutSeconds: 600 },
  SubagentStop: { matcherField: "agent_type", blocking: "blocks", defaultTimeoutSeconds: 600 },
  TaskCreated: { matcherField: null, blocking: "blocks", defaultTimeoutSeconds: 600 },
  TaskCompleted: { matcherField: null, blocking: "blocks", defaultTimeoutSeconds: 600 },
  Stop: { matcherField: null, blocking: "blocks", defaultTimeoutSeconds: 600 },
  StopFailure: { matcherField: "error", blocking: "ignored", defaultTimeoutSeconds: 600 },
  TeammateIdle: { matcherField: null, blocking: "blocks", defaultTimeoutSeconds: 600 },
  ConfigChange: { matcherField: "source", blocking: "blocks", defaultTimeoutSeconds: 600 },
  CwdChanged: { matcherField: null, blocking: "ignored", defaultTimeoutSeconds: 600 },
  DirectoryAdded: { matcherField: "source", blocking: "ignored", defaultTimeoutSeconds: 600 },
  FileChanged: { matcherField: "file_path", blocking: "ignored", defaultTimeoutSeconds: 600 },
  WorktreeCreate: { matcherField: null, blocking: "aborts", defaultTimeoutSeconds: 600 },
  WorktreeRemove: { matcherField: null, blocking: "ignored", defaultTimeoutSeconds: 600 },
  PreCompact: { matcherField: "trigger", blocking: "blocks", defaultTimeoutSeconds: 600 },
  PostCompact: { matcherField: "trigger", blocking: "ignored", defaultTimeoutSeconds: 600 },
  Elicitation: { matcherField: "mcp_server_name", blocking: "blocks", defaultTimeoutSeconds: 600 },
  ElicitationResult: { matcherField: "mcp_server_name", blocking: "blocks", defaultTimeoutSeconds: 600 },
  SessionEnd: { matcherField: "reason", blocking: "user-only", defaultTimeoutSeconds: 600 },
};

export const EVENT_NAMES: readonly string[] = Object.keys(EVENT_RULES).sort();

/**
 * Two events use a narrower exact-match character set than the rest -- letters,
 * digits, `_` and `|` only. A hyphen or comma in a matcher for either one keeps
 * it on the regular-expression path instead, which is a surprising difference
 * worth checking for rather than remembering.
 */
export const NARROW_MATCHER_EVENTS: ReadonlySet<string> = new Set(["FileChanged", "StopFailure"]);

/**
 * Edit distance, capped -- only used to turn a misspelled event name into a
 * suggestion, where anything past a couple of edits is not a typo any more.
 */
export function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1]! + 1, previous[j]! + 1, previous[j - 1]! + cost);
    }
    previous = current;
  }
  return previous[b.length]!;
}

/** The closest real event name, when the given one is close enough to be a typo. */
export function suggestEvent(name: string): string | undefined {
  let best: string | undefined;
  let bestScore = 3;
  for (const candidate of EVENT_NAMES) {
    if (candidate.toLowerCase() === name.toLowerCase()) return candidate;
    const score = editDistance(name, candidate);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

const BROAD_EXACT = /^[A-Za-z0-9_\- ,|]*$/;
const NARROW_EXACT = /^[A-Za-z0-9_|]*$/;

export type MatcherPath = "wildcard" | "exact" | "regex" | "invalid-regex";

/**
 * Which path Claude Code will take for this matcher on this event.
 *
 * The path is chosen by the characters in the matcher rather than by any syntax
 * the author opts into, which is why `mcp__memory` matches nothing -- it is an
 * exact string, and no tool is named that -- while `mcp__memory__.*` matches
 * every tool on that server. Reporting the chosen path is more useful than
 * reporting a verdict, because the bug is nearly always "I thought this was a
 * pattern and it is a literal".
 */
export function classifyMatcher(matcher: string, event: string): MatcherPath {
  if (matcher === "" || matcher === "*") return "wildcard";
  const exact = NARROW_MATCHER_EVENTS.has(event) ? NARROW_EXACT : BROAD_EXACT;
  if (exact.test(matcher)) return "exact";
  try {
    new RegExp(matcher);
    return "regex";
  } catch {
    return "invalid-regex";
  }
}

const HANDLER_TYPES = new Set(["command", "http", "mcp_tool", "prompt"]);

/**
 * `mcp__<server>` with no tool segment: a server name where a tool name is read.
 *
 * Alternation is fine here (`mcp__a|mcp__b` is two literals), so every
 * alternative has to look like a bare server for this to be the mistake.
 */
export function isBareMcpServer(matcher: string): boolean {
  const parts = matcher.split(/[,|]/).map((p) => p.trim()).filter((p) => p !== "");
  if (parts.length === 0) return false;
  return parts.every((p) => /^mcp__[A-Za-z0-9_-]+$/.test(p) && p.split("__").length === 2);
}

interface Collector {
  readonly errors: string[];
  readonly warnings: string[];
}

/** Check one handler entry: its type, where it points, and whether that exists. */
async function checkHandler(
  handler: unknown,
  where: string,
  event: string,
  pluginRoot: string,
  out: Collector,
): Promise<void> {
  if (!isRecord(handler)) {
    out.errors.push(`${where}: handler must be an object, got ${typeof handler}.`);
    return;
  }

  const type = handler["type"];
  if (typeof type !== "string") {
    out.errors.push(`${where}: handler is missing \`type\`. Expected one of ${[...HANDLER_TYPES].sort().join(", ")}.`);
    return;
  }
  if (!HANDLER_TYPES.has(type)) {
    out.errors.push(
      `${where}: handler \`type\` is \`${type}\`, which Claude Code does not run. ` +
        `Expected one of ${[...HANDLER_TYPES].sort().join(", ")}.`,
    );
    return;
  }

  if (type === "command") {
    const command = handler["command"];
    if (typeof command !== "string" || command === "") {
      out.errors.push(`${where}: a \`command\` handler needs a non-empty \`command\`.`);
      return;
    }
    // The handler file is what actually goes missing. `command` is usually the
    // runtime (`bun`), and the script it runs is the first argument.
    const args = handler["args"];
    const scripts = Array.isArray(args) ? args.filter((a): a is string => typeof a === "string") : [];
    const candidates = scripts.length > 0 ? scripts : [command];
    for (const candidate of candidates) {
      if (!candidate.includes("/")) continue; // a bare runtime name, resolved from PATH
      if (!candidate.includes(PLUGIN_ROOT_TOKEN) && candidate.startsWith("/")) {
        out.errors.push(
          `${where}: \`${candidate}\` is an absolute path, so it breaks the moment anyone ` +
            `else installs the plugin. Anchor it with the plugin-root token instead.`,
        );
        continue;
      }
      const expanded = expandAnchors(candidate, pluginRoot);
      if (!expanded.startsWith("/")) {
        out.warnings.push(
          `${where}: \`${candidate}\` is a bare relative path, so it resolves against the ` +
            `user's project rather than the plugin. Anchor it with the plugin-root token.`,
        );
        continue;
      }
      if (!(await pathExists(expanded))) {
        out.errors.push(`${where}: handler \`${candidate}\` does not exist (looked at \`${expanded}\`).`);
      }
    }
  }

  const timeout = handler["timeout"];
  if (timeout !== undefined && (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout <= 0)) {
    out.errors.push(`${where}: \`timeout\` must be a positive number of seconds.`);
  }

  // The exit-code contract. A guard on an event that discards exit codes is the
  // failure this check exists for: it reads as protection and is decorative.
  const rule = EVENT_RULES[event]!;
  if (rule.blocking === "ignored" && handler["async"] !== true) {
    out.warnings.push(
      `${where}: \`${event}\` discards a handler's exit code and stderr, so this cannot ` +
        `block or report anything back. Move the guard to an event whose exit code is read ` +
        `(exit 2 blocks on PreToolUse, and is shown to Claude on PostToolUse), or accept ` +
        `that this handler runs only for its side effects.`,
    );
  }
  if (rule.blocking === "user-only") {
    out.warnings.push(
      `${where}: on \`${event}\` stderr reaches the user and never Claude, so a message ` +
        `written here to steer the model will not.`,
    );
  }
}

async function checkEventEntry(
  event: string,
  entry: unknown,
  index: number,
  pluginRoot: string,
  out: Collector,
): Promise<void> {
  const where = `\`hooks.${event}[${index}]\``;
  if (!isRecord(entry)) {
    out.errors.push(`${where}: expected an object with \`matcher\` and \`hooks\`.`);
    return;
  }

  const rule = EVENT_RULES[event]!;
  const matcher = entry["matcher"];
  if (matcher !== undefined) {
    if (typeof matcher !== "string") {
      out.errors.push(`${where}: \`matcher\` must be a string.`);
    } else if (rule.matcherField === null) {
      out.warnings.push(
        `${where}: \`${event}\` takes no matcher — there is no payload field to test it ` +
          `against — so \`${matcher}\` is ignored and the entry fires every time.`,
      );
    } else {
      const path = classifyMatcher(matcher, event);
      if (path === "invalid-regex") {
        out.errors.push(
          `${where}: \`${matcher}\` is not an exact-match string and does not parse as a ` +
            `regular expression, so it matches nothing and the hook never fires.`,
        );
      } else if (path === "exact" && (matcher.includes(".") || matcher.includes("*"))) {
        out.warnings.push(
          `${where}: \`${matcher}\` is matched as a literal string against \`${rule.matcherField}\`, ` +
            `not as a pattern — every character in it is on the exact-match set. If a pattern ` +
            `was intended, add a character that forces the regular-expression path.`,
        );
      } else if (path === "exact" && rule.matcherField === "tool_name" && isBareMcpServer(matcher)) {
        // The canonical version of the same mistake, worth its own message
        // because it looks like a server-wide filter and is a literal that
        // matches nothing: no tool is ever named `mcp__memory`.
        out.errors.push(
          `${where}: \`${matcher}\` is an exact string, and no tool is named that — MCP tools ` +
            `are \`${matcher}__<tool>\`, so this matches nothing and the hook never fires. ` +
            `Write \`${matcher}__.*\` to cover every tool on that server.`,
        );
      }
      if (NARROW_MATCHER_EVENTS.has(event) && /[,\- ]/.test(matcher) && path === "regex") {
        out.warnings.push(
          `${where}: \`${event}\` uses the narrow exact-match set (letters, digits, \`_\` and ` +
            `\`|\` only), so \`${matcher}\` falls through to the regular-expression path. A ` +
            `hyphen or comma here does not separate alternatives the way it does elsewhere.`,
        );
      }
    }
  }

  const handlers = entry["hooks"];
  if (!Array.isArray(handlers)) {
    out.errors.push(`${where}: \`hooks\` must be an array of handlers.`);
    return;
  }
  if (handlers.length === 0) {
    out.warnings.push(`${where}: \`hooks\` is empty, so this entry does nothing.`);
  }
  for (const [i, handler] of handlers.entries()) {
    await checkHandler(handler, `\`hooks.${event}[${index}].hooks[${i}]\``, event, pluginRoot, out);
  }
}

/**
 * Locate the plugin root a `${CLAUDE_PLUGIN_ROOT}` path would expand against.
 *
 * A `hooks.json` normally sits at `<plugin>/hooks/hooks.json`, so the root is
 * two levels up. Falling back to the file's own directory keeps a standalone
 * file checkable rather than erroring on a layout question.
 */
export function pluginRootFor(hooksFile: string): string {
  const resolved = resolvePath(hooksFile);
  const parts = resolved.split("/");
  if (parts.at(-2) === "hooks") return parts.slice(0, -2).join("/");
  return parts.slice(0, -1).join("/");
}

export const hooksRules: RuleModule = {
  targetType: "hooks",
  summary: "hooks.json event names, matcher syntax, handler existence, exit-code contract",
  honoursTier: false,
  honoursEnvironment: false,
  expects: "a hooks.json, or the plugin directory holding hooks/hooks.json",

  async run(context: RuleContext): Promise<readonly Section[]> {
    let file = resolvePath(context.path);
    if (!(await pathExists(file))) throw new RuleAbort(`No such path: ${context.path}`);
    // Point at the file or at the plugin holding it; both are natural.
    if (await isDirectory(file)) {
      let found: string | undefined;
      for (const candidate of [`${file}/hooks/hooks.json`, `${file}/hooks.json`]) {
        if (await pathExists(candidate)) {
          found = candidate;
          break;
        }
      }
      if (found === undefined) throw new RuleAbort(`No hooks.json found under ${context.path}`);
      file = found;
    }

    const text = await readText(file);
    if (text === undefined) throw new RuleAbort(`Cannot read ${file}`);

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      return [section("Structure", [`\`${file}\` is not valid JSON: ${(error as Error).message}`], [])];
    }
    if (!isRecord(parsed)) {
      return [section("Structure", [`\`${file}\` must hold a JSON object.`], [])];
    }

    const out: Collector = { errors: [], warnings: [] };
    // Both shapes are live: a plugin's own file wraps the map in `hooks`, while
    // a settings-style file is the map itself.
    const raw = isRecord(parsed["hooks"]) ? parsed["hooks"] : parsed;
    const events = Object.keys(raw).filter((k) => k !== "description");
    if (events.length === 0) out.warnings.push("No events declared, so this file registers nothing.");

    for (const event of events.sort()) {
      if (EVENT_RULES[event] === undefined) {
        const near = suggestEvent(event);
        out.errors.push(
          `\`${event}\` is not an event Claude Code fires, so nothing under it ever runs.` +
            (near === undefined ? "" : ` Did you mean \`${near}\`? Event names are case-sensitive.`),
        );
        continue;
      }
      const entries = raw[event];
      if (!Array.isArray(entries)) {
        out.errors.push(`\`hooks.${event}\` must be an array of matcher groups.`);
        continue;
      }
      const pluginRoot = pluginRootFor(file);
      for (const [index, entry] of entries.entries()) {
        await checkEventEntry(event, entry, index, pluginRoot, out);
      }
    }

    return [
      section(
        "Structure",
        out.errors,
        out.warnings,
        `Checked \`${file}\` against ${EVENT_NAMES.length} known events; ` +
          `plugin root taken as \`${pluginRootFor(file)}\`.`,
      ),
    ];
  },
};
