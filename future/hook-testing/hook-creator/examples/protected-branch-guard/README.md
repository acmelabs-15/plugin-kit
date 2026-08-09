# Worked example: protected-branch-guard

A plugin's complete `hooks/hooks.json` and the three handlers behind it. Three hooks, chosen so the set covers the decisions an author actually has to make: one that blocks, one that reacts, one that injects context.

Copy the shape, not the branch names.

```text
protected-branch-guard/
├── hooks.json                     # goes at hooks/hooks.json in the plugin
└── handlers/
    ├── guard-push.ts              # PreToolUse — denies a force push
    ├── tidy-edit.ts               # PostToolUse — normalises the file just written
    └── session-context.ts         # SessionStart — injects repository state
```

## Hook 1 — `PreToolUse` on `Bash`, blocking

```json
{
  "matcher": "Bash",
  "hooks": [{
    "type": "command",
    "command": "bun",
    "args": ["${CLAUDE_PLUGIN_ROOT}/handlers/guard-push.ts"],
    "if": "Bash(git push *)",
    "timeout": 10,
    "statusMessage": "Checking the push target"
  }]
}
```

Line by line:

- **`matcher: "Bash"`** — an exact string, so it matches the `Bash` tool and nothing else. `Bash.*` would also match a future `BashOutput`.
- **`if: "Bash(git push *)"`** — the reason this hook costs nothing. Without it the handler process spawns on every Bash call Claude makes, reads stdin, decides it does not care, and exits. With it, the process is never created unless a subcommand matches. `if` is checked against each subcommand, so `bun test && git push --force` still reaches the handler — which is why the handler splits the command again itself.
- **`command` + `args`** — exec form. `${CLAUDE_PLUGIN_ROOT}` is substituted into the argument as a plain string with no shell involved, so an install directory with a space in it is one argument rather than two. The shell-form equivalent needs `bun "${CLAUDE_PLUGIN_ROOT}"/handlers/guard-push.ts`, and the quotes are the whole difference between working and silently not.
- **`timeout: 10`** — the default is 600s. A guard on the path of every push should fail fast rather than hang the session for ten minutes if git blocks.
- **`statusMessage`** — what the user sees spinning. Worth setting on anything that can take a visible moment.

The handler answers with JSON on exit 0 rather than exit 2, because a deny should carry a reason Claude can act on and `permissionDecisionReason` is the field it reads. Both channels work; using both does not, since JSON is only parsed on exit 0.

Every failure path in `guard-push.ts` exits 0 deliberately. This is a blocking event, so an uncaught exception becomes a non-zero exit and the user sees a hook error on a push that was fine. A guard that cannot read its input has no opinion — it does not have a veto.

## Hook 2 — `PostToolUse` on `Edit|Write`, reacting

```json
{
  "matcher": "Edit|Write",
  "hooks": [{
    "type": "command",
    "command": "bun",
    "args": ["${CLAUDE_PLUGIN_ROOT}/handlers/tidy-edit.ts"],
    "if": "Edit(**/*.ts)",
    "async": true,
    "timeout": 60
  }]
}
```

- **`if: "Edit(**/*.ts)"`** — narrows to TypeScript. The `**/` prefix matters: `Edit(src/**)` matches only a `src` directory in the working directory, while `Edit(**/src/**)` matches one at any depth.
- **`async: true`** — the file is already written, so there is nothing to block. Claude carries on while the handler runs. An async hook cannot decide anything: `decision`, `permissionDecision` and `continue` are all inert on one, because the action they would have governed already happened. Its only channel is the side effect.
- **Exec form again**, for the reason hook 1 used it: a path placeholder is involved. The obvious shell-form alternative — selecting `.tool_input.file_path` out of the payload with one tool and piping it into a formatter with another — reads as less code and is not. It is a pipeline of three processes where one would do, and it converts a plugin that needed only Bun into a plugin that also needs `jq`, a package runner, a network on first run, and whichever formatter version resolves that day. The handler reads the same payload from stdin in three lines.

`tidy-edit.ts` strips trailing horizontal whitespace and normalises the file to exactly one closing newline, and writes only when something actually changed. That is deliberately the subset of formatting that needs no formatter — unambiguous, semantically inert, and responsible for most of the noise in a diff. Anything with an opinion about quote style or line width is a tool with an opinion, and adopting it is a dependency decision rather than a hook decision.

Two properties worth copying regardless of what the handler does. **Write only on a real change**, because rewriting an identical file bumps its mtime and re-triggers every watcher pointed at it. And **exit 0 on every path**, including the failure paths: nothing is waiting on an async hook, so a non-zero exit cannot prevent anything and only produces a hook-error notice about work that already finished.

`PostToolUse` fires only for the `Edit` and `Write` tools. Claude can also change files by running a shell command, and this hook will not see that. If the requirement is "see every change", a `Stop` hook that scans the working tree once per turn is the shape that actually covers it.

## Hook 3 — `SessionStart`, injecting context

```json
{
  "matcher": "startup|resume",
  "hooks": [{
    "type": "command",
    "command": "bun",
    "args": ["${CLAUDE_PLUGIN_ROOT}/handlers/session-context.ts"],
    "timeout": 15
  }]
}
```

- **`matcher: "startup|resume"`** — `SessionStart`'s matcher is compared against *how the session started*, not against a tool name. The other values are `clear`, `compact` and `fork`. Restricting to two keeps the hook from re-running after every compaction.
- No `if` field, and that is not an oversight: `if` is evaluated only on tool events, and a handler carrying it on any other event **never runs at all**.

The handler prints JSON because it sets `sessionTitle` alongside the context. A hook that only injected context could print plain text — `SessionStart`, `UserPromptSubmit` and `UserPromptExpansion` are the three events whose plain stdout is added to Claude's context.

The injected text is written as statements about the world rather than as instructions. Text framed as out-of-band system commands can trigger Claude's prompt-injection defenses, which surfaces it to the user instead of using it.

## Testing it

Every hook here can be tested before it is wired in, because hook firing is deterministic:

```bash
# The whole config, against a synthetic Bash payload
bun ../../scripts/test-hook.ts --config hooks.json --event PreToolUse \
  --plugin-root "$PWD" \
  --set 'tool_input.command=git push --force origin main' \
  --expect-decision deny

# The permitted case, which matters as much as the blocked one
bun ../../scripts/test-hook.ts --config hooks.json --event PreToolUse \
  --plugin-root "$PWD" \
  --set 'tool_input.command=git push origin feature/retry' \
  --expect-decision none

# The compound command the `if` filter lets through
bun ../../scripts/test-hook.ts --config hooks.json --event PreToolUse \
  --plugin-root "$PWD" \
  --set 'tool_input.command=bun test && git push --force origin main' \
  --expect-decision deny

# The async reaction, pointed at a scratch file so the side effect is checkable
bun ../../scripts/test-hook.ts --config hooks.json --event PostToolUse \
  --plugin-root "$PWD" \
  --set tool_name=Edit --set "tool_input.file_path=$PWD/scratch.ts" \
  --expect-exit 0

# Session context: assert it stays out of the way rather than what it says
bun ../../scripts/test-hook.ts --config hooks.json --event SessionStart \
  --plugin-root "$PWD" --expect-exit 0
```

The harness runs an `async` handler synchronously and waits for it, which is the point — asynchrony is a scheduling decision Claude Code makes, not a property of the handler, so the contract under test is the same one either way. `tidy-edit.ts` also exports `tidy()` as a pure function, so the interesting half is a `bun test` assertion with no process and no file involved.

The harness also reports which handlers the matcher selected, so a matcher that quietly selects nothing shows up as "No command handlers matched" rather than as a hook that seems fine and never fires.
