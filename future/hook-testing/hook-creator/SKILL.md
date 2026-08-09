---
name: hook-creator
argument-hint: "[what should happen, and on which event]"
allowed-tools: Read, Grep, Glob
model: opus
metadata:
  component-type: hook
license: MIT
compatibility: "Claude Code — the CLI, the IDE extensions, and Claude Desktop's Code and Cowork tabs. Bun runs the bundled payload harness and the TypeScript handlers this skill writes; no other runtime is required."
description: |
  Use when the user is building, testing, or fixing a Claude Code hook — behaviour that must fire automatically on an event (a tool about to run, a file written, a session starting or ending), whatever Claude decides. Covers picking the event and matcher, writing the handler, its exit codes and JSON, whether it blocks, and debugging one that never fires or fires on everything.

  Skip when the user is only describing how they want Claude to behave or judge — be careful, be confident, follow a rule — with no event or hook named; that is guidance, not a hook. Skip for preparing a repo so Claude Code on the web can run tests and linters at session start (session-start-hook owns that). Skip for writing the lint/test/format command a hook merely calls, for skills, subagents, MCP servers, slash commands or plugins, and for read-only hook audits (hook-reviewer).
---

# Hook Creator

A hook is the one Claude Code component whose behaviour is not a model judgement. A skill triggers because a description persuaded the model; an agent runs because delegation looked right. A hook fires because an event happened and a matcher matched. Same input, same outcome, every time.

That changes what "did this work?" means. Everywhere else in this plugin the honest answer comes from running something many times and reading a rate; here you feed the handler a payload and assert the result — a test, not a sample. `scripts/test-hook.ts` is that harness, and the loop below is built around it.

Three words, used precisely here and in the references. A **hook entry** is the JSON object naming an event and its matcher. A **handler** is one element of that entry's `hooks` array — the part that runs. A **hook** is the two together.

The loop, worth putting on a todo list:

1. Decide whether the work wants a hook at all
2. Plan the entry — event, matcher, `if`, handler type, decision channel
3. Validate that plan against `references/events.md` before writing any code
4. Write the handler
5. Run the harness, fix what it reports, run it again until it passes
6. Wire it in
7. Debug what the first real session shows

Steps 2 and 3 are the cheap half, and they are where the expensive defects are caught: every fact the plan rests on — whether the event takes a matcher, what that matcher is compared against, whether exit 2 does anything there — is in one table, so validating a plan costs one read. A hook registered on the wrong event costs a debugging session, because it appears correctly in `/hooks` and does nothing.

Work out where the user already is and start there. "My hook never fires" jumps straight to debugging; an existing handler with a new requirement starts at the handler.

---

## Does this want a hook?

The first real question, and the one that saves the most work when the answer is no.

**A hook is for behaviour that must fire on an event.** Not when the user asks — when something *happens*. A tool is about to run, a session starts, a file changes, Claude wants to stop. Nobody requests it and nobody can forget it.

Behaviour that should fire when the user asks for it is a skill. Behaviour that needs its own context window and tool set is a subagent. If you find yourself writing "and then Claude should notice that…", that is a skill description, not a hook.

What a hook buys is determinism. What it costs is the model's judgement. A `PreToolUse` hook denying `Bash(rm *)` cannot tell a `rm -rf /` from a `rm ./tmp/scratch.log` unless you write that distinction out as a pattern, and it will not learn the difference from context the way the model would.

That trade is right when:

- The rule is expressible and the stakes are asymmetric. Blocking one legitimate push costs a sentence of explanation; missing one force push to `main` costs a rewritten history.
- The behaviour must survive a persuasive user. A hook `deny` holds even under `bypassPermissions`; a skill instruction does not.
- It has to happen every time, including on the run where the model is distracted by something else.

When the decision genuinely needs judgement, the `prompt` and `agent` handler types are the escape hatch: a model evaluates the payload instead of a pattern. Reach for them knowingly — they give up the determinism that was the reason to write a hook, so the same input can answer differently on two runs and you are sampling again rather than testing. Pair either one with a narrow `if` so the model is consulted only on the cases that need it. Read `references/handlers.md` before writing either, because `ok: false` behaves differently per event and `continueOnBlock` decides whether Claude can adapt or the turn simply ends.

Two limits to design around. A hook cannot invoke a slash command or call a tool — stdin, stdout, stderr and an exit code are the whole channel. And **hooks tighten permissions, never loosen them**: a `deny` holds even under `bypassPermissions`, while an `allow` does not override a settings deny rule or an organization `ask`.

## Pick the narrowest event

Narrowest that does the job. A hook on a broad event with no matcher and no `if` runs constantly, and every run is a process spawn on the path of something the user is waiting for.

Group the choice by what you are trying to do.

**Gate an action before it happens.** `PreToolUse` for any tool call, in every permission mode. `PermissionRequest` when you only care about calls that would have prompted the user. `UserPromptSubmit` to reject a prompt outright. `PreCompact` to stop a compaction, `ConfigChange` to stop a settings edit taking effect. `TaskCreated`, `TaskCompleted`, `Stop`, `SubagentStop` to refuse an ending.

**React to something that already happened.** `PostToolUse` and `PostToolUseFailure` for one call, `PostToolBatch` for a whole parallel batch. `PermissionDenied` after the auto-mode classifier refused something. `FileChanged`, `CwdChanged`, `DirectoryAdded` for the world moving underneath the session. Nothing here can undo anything; the value is logging, formatting, and telling Claude what changed.

**Inject context.** `SessionStart`, `UserPromptSubmit` and `UserPromptExpansion` are the three events whose plain stdout is added to Claude's context, so a hook that only supplies text can `echo` and skip JSON entirely. Write it as statements about the world rather than instructions — text framed as out-of-band commands can trip prompt-injection defenses and end up shown to the user instead of used. For anything that never changes, CLAUDE.md is cheaper: no process, no timeout.

**React to session lifecycle.** `SessionStart` and `SessionEnd`, `Setup` for one-time CI preparation, `SubagentStart` and `SubagentStop`, `Notification` when Claude wants attention, `PreCompact`/`PostCompact` around a context squeeze.

Then narrow inside the event with the matcher. **What the matcher is compared against varies per event** — tool name on tool events, but how the session started on `SessionStart`, agent type on the subagent events, notification type on `Notification`, literal filenames on `FileChanged`. Ten events take no matcher at all.

How the string itself is read depends on the characters in it rather than on any syntax you opt into:

| Matcher | Read as |
|---|---|
| `*`, `""`, or omitted | every occurrence |
| letters, digits, `_`, `-`, space, `,`, `\|` only | an exact string, or a `\|`/`,`-separated list of exact strings |
| anything else | a JavaScript regular expression, **unanchored** |

Unanchored is the trap: `Edit.*` also matches `NotebookEdit`, so write `^Edit$` when you mean only `Edit`. The same rule explains why `mcp__memory` matches nothing — it is all exact-match characters and no tool is named exactly that, while `mcp__memory__.*` matches them all.

Everything else about an event — its payload fields, what its matcher is compared against, whether exit 2 stops anything there — is `references/events.md`. Read it when choosing rather than after: picking the wrong event is the defect that costs a whole debugging session, because the hook appears correctly in `/hooks` and does nothing. It opens with a decision tree over the thirty-one events, which is the fastest way in when you know what should happen but not what it is called.

## The `if` field is where the cost lives

`matcher` picks the tool. `if` looks at the arguments, using permission-rule syntax, **before the process is spawned**:

```json
{ "type": "command", "command": "…", "if": "Bash(git push *)" }
```

Without it, a `PreToolUse` hook on `Bash` starts a process for every `ls` and `cat` Claude runs while orienting. With it, nothing is spawned unless a subcommand matches. That is the difference between a hook that costs nothing and one the user feels.

It fails open — an unparseable Bash command runs the handler anyway — so it is a cost filter, not enforcement. Hard enforcement is a permission rule.

Read the matching table in `references/handlers.md` before writing the rule itself: a Bash pattern is checked per subcommand and inside `$()`, so `Bash(rm *)` fires on `echo $(rm -rf /)`, and one handler takes one rule.

## Pick the handler type

**Use `command`.** Your script, the payload as JSON on stdin, an exit code and stdout back. It is the type the harness tests, the type every example here uses, and the right answer unless one of the other four is specifically true:

- `http` — the policy lives in a service several machines share, and a network round trip per call is acceptable
- `mcp_tool` — an already-connected MCP server already has the check
- `prompt` — the rule needs judgement and cannot be written as a pattern, single-turn
- `agent` — the judgement needs to read files before deciding. Experimental, slower, and it gives up the determinism that was the reason to write a hook

Read `references/handlers.md` when you have chosen anything other than `command`, or when a `command` handler needs a field beyond `command`, `args` and `timeout`. It carries the per-type fields, the default timeouts, and the full JSON output reference. Skipping it on a non-`command` type is how a handler ends up returning fields that type never reads, which fails as silence rather than as an error.

Two choices inside `command` matter more than they look. **Exec form** — set `args`, even to `[]` — spawns the executable directly with no shell, so each argument passes through verbatim and a plugin path with a space in it stays one argument. **Shell form** — omit `args` — gives you pipes and `&&`. Use exec form whenever a path placeholder is involved; the plugin-root anchor is spelled `$CLAUDE_PLUGIN_ROOT` here and braced in real use, because a skill body is injected with shell-style substitution applied and the braced form would arrive already expanded. Copy the literal token out of `references/handlers.md`, which is read rather than injected and carries it intact.

## Gotchas

Facts that defy a reasonable assumption. Read them before writing the handler: each fails silently, so none announces itself.

**On exit 2, stdout is ignored.** Only stderr reaches Claude. A handler that exits 2 while printing its decision as JSON has decided nothing: the JSON is discarded. Pick one channel per handler — exit 0 with JSON, or exit 2 with a reason on stderr. Using both is the most common defect in a handler.

**Exit 1 blocks nothing.** It is the conventional Unix failure code, and here it is a non-blocking error: the action proceeds and the user sees a hook-error notice. Only 2 blocks, and only on events that can block.

**Hooks on the same event all run in parallel, and one hook's deny does not stop its siblings.** Every matching handler runs to completion; only then are results merged, most restrictive first (`deny` > `defer` > `ask` > `allow`). So a logging hook beside a guard hook still writes its entry for the call that was blocked. Never rely on one hook's decision to suppress another's side effects, and never have two hooks write `updatedInput` for the same tool — they race, and the last to finish wins.

**An `if` field on a non-tool event disables the handler entirely.** `if` is evaluated only on `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest` and `PermissionDenied`. Anywhere else the handler never runs at all, which is a quiet way to switch off a hook you thought you had narrowed.

**A matcher on an event that takes none is silently ignored**, and so is an event name that is not real. Both are accepted, neither warns, and the hook never fires. `references/events.md` lists the ten events that take no matcher.

**An uncaught exception in a blocking handler becomes the user's problem.** On a blocking event a non-zero exit stops their work, and an uncaught exception is a non-zero exit. Catch everything and exit 0 on any path where the handler cannot form a real opinion: a guard that failed to parse its input has no opinion, not a veto. Write the diagnostic to stderr, where on exit 0 it reaches the debug log and goes no further.

**`Stop` hooks need a loop guard.** Read `stop_hook_active` from the payload and exit 0 when it is true, or the hook blocks its own continuation. Claude Code overrides one after eight consecutive blocks.

## Write the handler

The handler reads JSON on stdin and answers through two channels.

**Exit codes.**

```
Input:  a handler that exits 0, printing nothing
Output: no opinion. The normal permission flow applies

Input:  a handler that exits 0, printing valid JSON to stdout
Output: the JSON is parsed as a decision

Input:  a handler that exits 2, printing "Blocked: …" to stderr
Output: the action is blocked and Claude is shown the stderr text

Input:  a handler that exits 2, printing JSON to stdout
Output: the JSON is discarded. Only stderr is read. Whatever it decided did not happen
```

Not every event honours exit 2. Nine discard it outright, so a guard written on one of those is decorative; five more render it as a hook-error notice to the user and prevent nothing; `WorktreeCreate` goes the other way and aborts on any non-zero exit. Read the exit-2 column in `references/events.md` for the event you chose before relying on a block — that check is why step 3 of the loop exists.

**JSON output.** Exit 0 and print exactly one object.

```
Input:  {"hookSpecificOutput": {"hookEventName": "PreToolUse",
         "permissionDecision": "deny", "permissionDecisionReason": "…"}}
Output: the tool call is denied and Claude is told why

Input:  the same object with "hookEventName": "PostToolUse"
Output: nothing. A mismatched event name makes the whole object inert

Input:  {"decision": "block", "reason": "…"}
Output: blocked, on the events that read a top-level decision — not PreToolUse,
        which reads hookSpecificOutput.permissionDecision instead

Input:  {"continue": false, "stopReason": "…"}
Output: Claude stops entirely, overriding every event-specific decision
```

Stdout has to contain *only* the object. A shell profile that echoes on startup prepends its text and the parse fails — the fix is guarding those echoes behind an interactive check, not in your handler.

Handlers this plugin ships are Bun and TypeScript. Read `../../../shared/references/pure-bun.md` when the handler wants an API you would otherwise add a dependency for, and `../../../shared/references/typescript-standard.md` when you add its tests, for where they go. A handler doing real work deserves its logic in a pure exported function so it can be unit-tested without a process.

Read `examples/protected-branch-guard/` when you want a finished specimen to copy: a plugin `hooks.json` with three hooks — one blocking, one reacting, one injecting context — the handlers behind them, and a `README.md` annotating every field and why it is set that way.

## Test it, and keep testing until it passes

This is the step that makes hooks different from everything else in this plugin, and it is a loop rather than a checkpoint: run the harness, read what it reports, fix the handler, run it again. Do not wire a hook into a live session with an expectation still failing — the next thing it does is block somebody's work.

Run one handler against a synthetic payload:

```bash
bun scripts/test-hook.ts --event PreToolUse --command bun --arg ./hooks/guard.ts \
  --set 'tool_input.command=git push --force origin main' \
  --expect-decision deny
```

Then run the entry itself, matchers and all, which also checks that the matcher selects the handler you think it does:

```bash
bun scripts/test-hook.ts --config hooks/hooks.json --event PostToolUse \
  --plugin-root "$PWD" --set tool_name=Write --expect-exit 0
```

Then fix and repeat. The harness exits 0 when everything passes, 1 on a failed expectation, 2 on a usage error, and it names the expectation that failed and the value it saw — so a failure is a diff rather than a search. Iterate until every case below exits 0.

Cover, at minimum: the case that should be blocked, the near-miss that should not, and a malformed payload — a handler that crashes on unexpected input is a handler that blocks the user's work. Because the payloads are enumerable from the event schema rather than guessed, the set writes itself: `--fixture <EventName>` generates a realistic default for any of the 31 events, `--payload <file>` uses one you captured, and `--set a.b=value` edits either.

What a pass covers, so you know what it does not: the exit code, that stderr carries a reason when the handler blocks, that stdout parsed and held nothing before the first brace and nothing at all on exit 2, that `hookEventName` matches, and that every field returned is one the event reads.

`scripts/lib/events.ts` holds the event table the harness runs against, including the per-event matcher field and what exit 2 does there. Extend it when a new event appears; `scripts/__tests__/test-hook.test.ts` is what keeps it honest.

## Wire it in

Where the entry goes decides its scope: `~/.claude/settings.json` for every project, `.claude/settings.json` for one shared project, `.claude/settings.local.json` for one private to you, a plugin's `hooks/hooks.json` for something distributed, or skill and agent frontmatter for something scoped to that component's lifetime. Entries **merge** across levels rather than replacing each other. Read the locations table in `references/handlers.md` when the same hook is defined in two places, or when you are putting one in subagent frontmatter: a duplicate across settings files runs once while a plugin's copy runs again, and a frontmatter `Stop` hook becomes `SubagentStop`.

Adding a hook to an existing plugin is this skill's job end to end, including the edit to its `hooks/hooks.json`; `../../../skills/plugin-creator/SKILL.md` owns the manifest and directory tree around it, not the entry.

Never commit a credential into a hook config. An `http` handler takes its token through `headers` with `allowedEnvVars` naming what may be interpolated; a plugin reads user configuration from `CLAUDE_PLUGIN_OPTION_<KEY>`. A settings file is often in version control and a plugin config always is.

Before the first live run, two cheap checks. `bun scripts/test-hook.ts` on each handler, then the `skill-creator:hook-reviewer` agent on the hook config and its handlers — it audits statically for a handler path that does not resolve, an event name that is not real, a matcher whose semantics do not fit its event, and the exit-code misuses above. Static audit and payload test complement each other: the reviewer cannot tell you whether the handler works, and the harness cannot tell you the hook is registered on an event that does not exist.

### Where this ships

A hook is a Claude Code concept end to end: the event loop that fires one exists in the CLI, in the IDE extensions, and in Claude Desktop's Code and Cowork tabs, and nowhere else — Desktop's Chat tab, claude.ai and the API have no event to match. So a hook has **no standalone install path**: it travels bundled in a plugin, or written into a settings file on a machine someone controls. And because Cowork syncs what the claude.ai account has enabled rather than reading `~/.claude`, a hook that has to reach Cowork ships in a plugin.

Read `../../../shared/references/distribution-targets.md` when the hook has to reach a surface beyond the machine you are on, or when the plugin carrying it also ships skills or an MCP server whose reach differs — it has the artifact-by-surface matrix and the traps that look portable and are not.

## Debug

In order of what it costs to check.

**`/hooks`** — a read-only browser showing every configured hook grouped by event, with the source each came from. If the hook is not here, it is not registered: check the JSON is valid, the file is where you think, and the event name is spelled exactly right.

**If it is listed but never runs** — the matcher is the usual cause, and matchers are case-sensitive. Confirm what this event's matcher is compared against in `references/events.md`; a tool-name matcher on a session event matches nothing. Re-check the exact-versus-regex table above. Check for an `if` field on a non-tool event, which suppresses the handler entirely.

**If it runs and nothing happens** — an exit 0 hook shows nothing by design. Confirm by its effect, or read the debug log: `claude --debug-file /tmp/claude.log`, then tail it. `/debug` mid-session turns it on and prints the path. `CLAUDE_CODE_DEBUG_LOG_LEVEL=verbose` adds matcher-level detail.

**"command not found"** — use the plugin-root anchor rather than a relative path, and switch to exec form to sidestep quoting. On macOS and Linux a shell-form script also needs its executable bit.

**Hooks do not appear after an edit** — the file watcher normally picks up settings changes within a few seconds, so edit-and-retry is usually enough. When it misses one — most often a settings file created inside a directory that did not exist when the session started, because there was nothing there to watch — restarting the session forces a reload. Check the JSON parses first: a trailing comma loses the whole file, not one entry.

`"disableAllHooks": true` turns everything off while you bisect. There is no way to disable a single hook without removing it.

---

## Bundled files

- `references/events.md` — **while choosing an event, and again before relying on exit 2**
- `references/handlers.md` — **for any handler type other than `command`; for a field beyond `command`/`args`/`timeout`; when writing an `if` rule; for the JSON output reference and the literal path-anchor tokens; when the same hook is defined in two places**
- `scripts/test-hook.ts` — the payload harness, run in the loop above; `scripts/lib/events.ts` is the event table it runs against, and `scripts/__tests__/test-hook.test.ts` keeps that table honest
- `examples/protected-branch-guard/` — **when you want a working hook to copy**
