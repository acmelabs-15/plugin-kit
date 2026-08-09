#!/usr/bin/env bun
/**
 * PostToolUse reaction: tidy the file Claude just wrote.
 *
 * Registered on `PostToolUse` with `matcher: "Edit|Write"`, an `if` filter
 * narrowing to TypeScript, and `async: true`. The file is already on disk by
 * the time this runs, so there is nothing to block and no decision to make --
 * the value is entirely in the side effect.
 *
 * It strips trailing horizontal whitespace and normalises the end of the file to
 * exactly one newline. That is deliberately the subset of formatting that needs
 * no formatter: it is unambiguous, it never changes what the code means, and it
 * removes the two things that show up as noise in every diff. A hook wanting
 * opinionated formatting -- quote style, line width, import order -- is asking
 * for a tool with an opinion, and shelling out to one turns a plugin that
 * needed only Bun into a plugin that also needs that tool installed, at the
 * version you assumed, on every machine it lands on.
 *
 * The whole payload is read from stdin and parsed here rather than sliced out
 * by a shell filter, which is what keeps this a one-process hook with no
 * external command in it.
 */

interface PostToolUsePayload {
  readonly tool_name?: string;
  readonly tool_input?: { readonly file_path?: string };
}

/**
 * Normalise trailing whitespace.
 *
 * Exported and pure so the interesting half is unit-testable without a process
 * or a file. Returns the input unchanged when there is nothing to do, which is
 * what lets the caller skip the write.
 */
export function tidy(text: string): string {
  if (text === "") return text;
  const body = text.replace(/[ \t]+$/gm, "").replace(/\n+$/, "");
  return `${body}\n`;
}

/** Files this hook will rewrite. Anything else is left alone. */
const TIDY_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".json", ".md", ".css"];

export function shouldTidy(path: string): boolean {
  return TIDY_EXTENSIONS.some((extension) => path.endsWith(extension));
}

if (import.meta.main) {
  // Exit 0 on every path. An async hook cannot decide anything, so a non-zero
  // exit here buys nothing and costs the user a hook-error notice about work
  // that was already finished before this process started.
  try {
    const payload = JSON.parse(await Bun.stdin.text()) as PostToolUsePayload;
    const path = payload.tool_input?.file_path;

    if (typeof path === "string" && path !== "" && shouldTidy(path)) {
      const file = Bun.file(path);
      // The file can be gone already -- Claude may have moved or deleted it
      // between the write and this process starting, since nothing is waiting
      // on an async hook.
      if (await file.exists()) {
        const original = await file.text();
        const tidied = tidy(original);
        // Only write on a real change. Rewriting an unchanged file bumps its
        // mtime, which re-triggers file watchers and makes build tools redo
        // work for nothing.
        if (tidied !== original) await Bun.write(path, tidied);
      }
    }
  } catch (error) {
    // An async hook's stdout is discarded, so stderr and the debug log are the
    // only place a diagnostic can go.
    console.error(`tidy-edit: ${String(error)}`);
  }
  process.exit(0);
}
