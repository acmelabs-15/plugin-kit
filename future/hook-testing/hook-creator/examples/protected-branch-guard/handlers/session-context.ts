#!/usr/bin/env bun
/**
 * SessionStart context: tell Claude where the repository stands.
 *
 * Registered with `matcher: "startup|resume"` so it does not run again on
 * `clear` or after a compaction. SessionStart is one of the three events whose
 * plain stdout is added to Claude's context, so a hook that only injects text
 * can `echo` and skip JSON entirely. This one uses the JSON form because it
 * also sets `sessionTitle`, and mixing plain text with a field means JSON.
 */

import { $ } from "bun";

/** Run a git command, returning empty string rather than throwing outside a repo. */
async function git(...args: readonly string[]): Promise<string> {
  const result = await $`git ${args}`.quiet().nothrow();
  return result.exitCode === 0 ? result.text().trim() : "";
}

/**
 * Facts, phrased as facts.
 *
 * Text framed as out-of-band instructions ("You must run the tests") can trip
 * Claude's prompt-injection defenses, which surfaces the text to the user
 * instead of treating it as context. Statements about the world do not.
 */
export function formatContext(branch: string, dirty: readonly string[], recent: string): string {
  const lines: string[] = [];
  if (branch !== "") lines.push(`Current branch: ${branch}`);
  lines.push(
    dirty.length === 0
      ? "Working tree: clean"
      : `Uncommitted changes in ${dirty.length} file(s): ${dirty.slice(0, 10).join(", ")}`,
  );
  if (recent !== "") lines.push("Recent commits:", recent);
  return lines.join("\n");
}

if (import.meta.main) {
  try {
    const branch = await git("branch", "--show-current");
    const status = await git("status", "--porcelain");
    const dirty = status === "" ? [] : status.split("\n").map((line) => line.slice(3));
    const recent = await git("log", "--oneline", "-5");

    console.log(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext: formatContext(branch, dirty, recent),
          // Naming the session after the branch makes a list of resumable
          // sessions readable. Ignored on `clear` and `compact`, which is why
          // the matcher restricts this hook to startup and resume anyway.
          ...(branch === "" ? {} : { sessionTitle: branch }),
        },
      }),
    );
  } catch (error) {
    // SessionStart cannot block, so a failure here costs context, not the
    // session. Say so in the debug log and get out of the way.
    console.error(`session-context: ${String(error)}`);
  }
  process.exit(0);
}
