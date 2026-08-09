#!/usr/bin/env bun
/**
 * PreToolUse guard: refuse a force push to a protected branch.
 *
 * Registered on `PreToolUse` with `matcher: "Bash"` and `if: "Bash(git push *)"`,
 * so the process is only spawned for a Bash call that actually contains a push.
 * Without the `if`, this would run on every `ls` and `cat` Claude makes.
 *
 * It answers through JSON rather than exit 2 because a deny wants to carry a
 * reason Claude can act on, and `permissionDecisionReason` is the field Claude
 * reads. The exit-2 channel would put the reason on stderr, which also works;
 * what does not work is doing both, since JSON is only read on exit 0.
 */

/** Branches this hook will not let a force push reach. */
function protectedBranches(): readonly string[] {
  // A plugin's user config arrives as CLAUDE_PLUGIN_OPTION_<KEY>. Reading it
  // here rather than interpolating `${user_config.*}` into the command keeps
  // the hook working in both exec and shell form.
  const configured = process.env["CLAUDE_PLUGIN_OPTION_PROTECTED_BRANCHES"];
  if (configured !== undefined && configured.trim().length > 0) {
    return configured.split(",").map((branch) => branch.trim()).filter((b) => b.length > 0);
  }
  return ["main", "master", "release", "production"];
}

interface PreToolUsePayload {
  readonly tool_name?: string;
  readonly tool_input?: { readonly command?: string };
}

/** `deny` refuses outright; `ask` hands the decision to the user. */
type Decision = { readonly kind: "allow" } | { readonly kind: "deny" | "ask"; readonly reason: string };

const FORCE_FLAGS = ["--force", "-f", "--force-with-lease", "--force-if-includes"];

/**
 * Decide on one shell command.
 *
 * Exported and pure so `scripts/test-hook.ts` is not the only way to exercise
 * it -- the decision logic is the part worth unit-testing, and it needs no
 * process to run.
 */
export function decide(command: string, branches: readonly string[]): Decision {
  // `if: "Bash(git push *)"` matches each subcommand of a compound command, so
  // this handler can receive `bun test && git push --force`. Split on the shell
  // operators and look at each piece rather than the whole string.
  const segments = command.split(/&&|\|\||;|\|/).map((segment) => segment.trim());

  for (const segment of segments) {
    if (!/(^|\s)git\s+push(\s|$)/.test(segment)) continue;
    const tokens = segment.split(/\s+/);
    const forced = tokens.some((token) => FORCE_FLAGS.includes(token));
    const target = branches.find((branch) => tokens.includes(branch) || tokens.includes(`HEAD:${branch}`));
    if (target === undefined) continue;

    if (forced) {
      return {
        kind: "deny",
        reason:
          `Force-pushing to \`${target}\` rewrites history other people have pulled. ` +
          `Push to a topic branch and open a pull request, or ask the repository owner to ` +
          `lift the protection first.`,
      };
    }
    return {
      kind: "ask",
      reason: `This pushes directly to \`${target}\`, which is a protected branch.`,
    };
  }
  return { kind: "allow" };
}

/** Emit the PreToolUse decision object. `hookEventName` has to match or the whole object is inert. */
function emit(decision: Decision): void {
  if (decision.kind === "allow") return; // Silence means "no opinion" — the normal permission flow applies.
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: decision.kind,
        permissionDecisionReason: decision.reason,
      },
    }),
  );
}

if (import.meta.main) {
  // Every failure path below exits 0 on purpose. This hook sits on a blocking
  // event, so an uncaught exception would become a non-zero exit, and the user
  // would see a hook error on a push that had nothing wrong with it. A guard
  // that cannot read its input has no opinion; it does not have a veto.
  try {
    const raw = await Bun.stdin.text();
    const payload = JSON.parse(raw) as PreToolUsePayload;
    const command = payload.tool_input?.command;
    if (typeof command === "string") emit(decide(command, protectedBranches()));
  } catch (error) {
    // stderr on exit 0 reaches the debug log and nothing else, which is the
    // right place for a diagnostic that should never block anyone.
    console.error(`guard-push: could not evaluate the command: ${String(error)}`);
  }
  process.exit(0);
}
