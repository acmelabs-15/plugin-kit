# Handlers: the five types, the JSON contract, and the environment

A hook entry is an event name, an optional matcher, and a list of handlers. The handler is the part that does work:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          { "type": "command", "command": "bun", "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/format.ts"], "timeout": 30 }
        ]
      }
    ]
  }
}
```

A plugin's `hooks/hooks.json` takes the same object plus an optional top-level `description`.

## Fields every handler type shares

| Field | Required | What it does |
|---|---|---|
| `type` | yes | `command` \| `http` \| `mcp_tool` \| `prompt` \| `agent` |
| `if` | no | One permission rule — `Bash(git *)`, `Edit(*.ts)` — that has to match before the handler runs at all |
| `timeout` | no | Seconds. Defaults below |
| `statusMessage` | no | The spinner text shown while it runs |
| `once` | no | Runs once per session then removes itself. **Honoured only in skill frontmatter**; ignored in settings files and in agent frontmatter |

Default timeouts: **600s** for `command`, `http` and `mcp_tool`; **30s** for `prompt`; **60s** for `agent`. `UserPromptSubmit` lowers the first three to 30s and `MessageDisplay` to 10s. All `SessionEnd` hooks share a 1.5s budget, raised to match a longer per-hook `timeout` up to 60s.

### `if` — the difference between free and expensive

`matcher` picks the tool; `if` looks at the arguments. Without it, a `PreToolUse` hook on `Bash` spawns a process on every single Bash call — including the twenty `ls` and `cat` calls Claude makes while orienting — and the handler's first act is to read stdin, decide the command is uninteresting, and exit 0. With `if: "Bash(git push *)"` the process is never spawned.

`if` is evaluated **only on tool events**: `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`, `PermissionDenied`. On any other event, a handler with `if` set never runs at all — which is a quiet way to disable a hook you thought you had narrowed.

One rule per handler. There is no `&&`, `||` or list form; two conditions means two handlers.

Bash patterns are matched per subcommand, and generously:

| `if` | Bash command | Runs |
|---|---|---|
| `Bash(git *)` | `FOO=bar git push` | yes — leading assignments stripped |
| `Bash(git *)` | `bun test && git push` | yes — each subcommand checked |
| `Bash(rm *)` | `echo $(rm -rf /)` | yes — `$()` and backticks checked |
| `Bash(rm *)` | `echo $(date)` | no |
| `Bash(git push *)` | `echo $(date)` | yes — a pattern beyond the command name runs anyway on `$()`, backticks or `$VAR` |

It also fails open when a command cannot be parsed. So `if` is a cost filter, not an enforcement mechanism. Hard enforcement belongs in permission rules.

For file tools, `Edit(src/**)` matches only `src` in the working directory; `Edit(**/src/**)` matches a `src` at any depth.

---

## `command`

Extra fields: `command`, `args`, `async`, `asyncRewake`, `shell`.

The default and the one to reach for first. Your script gets the payload as JSON on stdin and answers through its exit code, stdout and stderr.

**Exec form** — `args` present. `command` is resolved on `PATH` and spawned directly. No shell, so each `args` element is one argument exactly as written and apostrophes, `$` and backticks pass through verbatim. Path placeholders are substituted as plain strings into `command` and into each element.

```json
{ "type": "command", "command": "bun", "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/guard.ts", "--strict"] }
```

**Shell form** — `args` absent. The string goes to `sh -c` (Git Bash or PowerShell on Windows), which tokenizes it and gives you pipes, `&&`, redirects and globs.

```json
{ "type": "command", "command": "bun \"${CLAUDE_PLUGIN_ROOT}\"/hooks/audit.ts >> \"${CLAUDE_PLUGIN_DATA}\"/audit.log 2>&1" }
```

That redirect is the whole reason to be in shell form. Anything a shell would otherwise be doing for you — selecting a field out of the payload, feeding a path to a second tool — is work the handler can do itself in a few lines, and doing it there keeps the hook to one process and to dependencies you actually ship. A pipeline is also where external commands accumulate: the classic version of the example above pipes the payload through `jq` into a package runner into a formatter, which is three tools the user's machine has to have before your hook works at all.

Reach for exec form whenever a path placeholder is involved. It sidesteps quoting entirely, which is the single most common reason a hook silently does not run: an install directory with a space in it turns an unquoted shell-form path into two arguments and the handler is never found. Adding `"args": []` is enough to switch forms even with no arguments to pass.

`async: true` runs the handler in the background and lets Claude carry on. An async hook cannot block or decide anything — `decision`, `permissionDecision` and `continue` are all inert, because the action they would have governed already happened. Its `additionalContext` is delivered on the next turn. `asyncRewake: true` implies `async` and wakes Claude on exit 2, showing stderr as a system reminder — the shape for a long test run that should interrupt when it fails.

On Windows, exec form needs a real executable. A package manager's `.cmd` and `.bat` shims cannot be spawned without a shell, which is a second reason to name a runtime rather than a shim: `"command": "bun", "args": ["…/hooks/guard.ts"]` works everywhere, because `bun.exe` is a real binary and Bun runs the TypeScript directly.

## `http`

Extra fields: `url`, `headers`, `allowedEnvVars`.

The payload is POSTed as the request body with `Content-Type: application/json`; the response body uses the same JSON output schema.

```json
{
  "type": "http",
  "url": "https://policy.internal/hooks/pre-tool-use",
  "timeout": 30,
  "headers": { "Authorization": "Bearer $POLICY_TOKEN" },
  "allowedEnvVars": ["POLICY_TOKEN"]
}
```

Env interpolation in `headers` only resolves names listed in `allowedEnvVars`; anything unlisted becomes an empty string. That is an allow-list on purpose — it keeps a header template from exfiltrating whatever else is in the environment.

Error handling differs from `command`: 2xx with an empty body is a silent success, 2xx with text adds that text as context, 2xx with JSON is parsed as a decision, and a non-2xx status, a connection failure or a timeout is a **non-blocking** error. An HTTP hook cannot block through a status code — to deny, return 2xx with the deny JSON.

Earns its place when the policy lives in a service several machines share, and is the wrong choice for anything on the latency path of every tool call.

## `mcp_tool`

Extra fields: `server`, `tool`, `input`.

Calls a tool on an already-connected MCP server. The tool's text output is treated exactly like command stdout: JSON becomes a decision, anything else becomes text.

```json
{
  "type": "mcp_tool",
  "server": "plugin:my-plugin:scanner",
  "tool": "security_scan",
  "input": { "file_path": "${tool_input.file_path}" }
}
```

`server` for a plugin-bundled server is the scoped `plugin:<plugin-name>:<server-name>`, not the bare key. String values in `input` take `${path}` substitutions from the payload.

The server has to be connected already — the hook never triggers a connection or an OAuth flow, and a disconnected server is a non-blocking error. `SessionStart` and `Setup` usually fire before servers finish connecting, so expect that error on the first run there.

## `prompt`

Extra fields: `prompt`, `model`, `continueOnBlock`. Default timeout 30s.

Single-turn evaluation by a model (Haiku unless `model` says otherwise). `$ARGUMENTS` in the prompt is replaced by the hook input JSON. The model answers `{"ok": true|false, "reason": "…"}`.

```json
{
  "type": "prompt",
  "prompt": "Does this command delete data that is not reproducible? Answer no unless you are confident.\n\n$ARGUMENTS",
  "if": "Bash(rm *)"
}
```

This is the escape hatch for a rule you cannot express as a pattern. It buys judgement and gives up determinism — the same input can now answer differently on two runs, which means it is back to being sampled rather than tested. Pair it with a narrow `if` so the model is only consulted on the cases that genuinely need judging.

`ok: false` behaves differently per event. On `PreToolUse` the call is denied and, by default, the turn ends with the reason shown as a warning; `continueOnBlock: true` returns the reason to Claude as the tool error so it can adapt instead. Same shape on `PostToolUse` and `TeammateIdle`. On `Stop` and `SubagentStop` the reason is fed back and Claude keeps working. On `PostToolUseFailure` and `TaskCreated` the reason always returns to Claude regardless of `continueOnBlock`.

## `agent`

Extra fields: `prompt`, `model`. Default timeout 60s. **Experimental.**

A multi-turn subagent with tool access — `Read`, `Grep`, `Glob` — so it can go and look before deciding. Everything said about `prompt` applies, more so: it is slower, it costs more, and it is non-deterministic. It earns its place when the decision genuinely needs evidence from the repository that the payload does not carry.

---

## JSON output

Exit 0 and print one JSON object on stdout. **Only exit 0 is parsed** — on exit 2 the JSON is discarded and stderr is used instead. Pick one channel per handler.

Stdout must contain only the object. A shell profile that echoes on startup prepends its text and the parse fails; guard those echoes behind an interactive check.

Output strings — `additionalContext`, `systemMessage`, plain stdout — are capped at 10,000 characters. Past that the text is written to a file and Claude gets a preview and the path.

### Universal fields

| Field | Default | Effect |
|---|---|---|
| `continue` | `true` | `false` stops Claude entirely after the hook. Takes precedence over every event-specific decision |
| `stopReason` | — | Shown to the user when `continue` is `false`. Not shown to Claude |
| `suppressOutput` | `false` | Hides the hook's stdout from the transcript; it still reaches the debug log |
| `systemMessage` | — | A warning shown to the user |
| `terminalSequence` | — | An escape sequence Claude Code emits for you. Restricted to OSC 0/1/2/9/99/777 and BEL; anything else and the field is dropped. This is how a hook rings a bell or raises a desktop notification, because hooks have no controlling terminal |
| `hookSpecificOutput` | — | Nested object, requires `hookEventName` set to the event name |

### `hookSpecificOutput` by event

`hookEventName` has to match the event the hook is registered on. A mismatch makes the whole object inert — no error, no warning, just a decision that did not happen.

| Events | Keys they read |
|---|---|
| `PreToolUse` | `permissionDecision` (`allow`\|`deny`\|`ask`\|`defer`), `permissionDecisionReason`, `updatedInput`, `additionalContext` |
| `PermissionRequest` | `decision` object: `behavior` (`allow`\|`deny`), `updatedInput`, `updatedPermissions`, `message`, `interrupt` |
| `PermissionDenied` | `retry: true` — tells the model it may retry the denied call |
| `PostToolUse` | `additionalContext`, `updatedToolOutput`, `updatedMCPToolOutput` |
| `SessionStart` | `additionalContext`, `initialUserMessage`, `sessionTitle`, `watchPaths`, `reloadSkills` |
| `Setup`, `SubagentStart`, `Stop`, `SubagentStop`, `UserPromptSubmit`, `UserPromptExpansion`, `PostToolUseFailure`, `PostToolBatch` | `additionalContext` |
| `MessageDisplay` | `displayContent` — changes only what is drawn, not the transcript or what Claude sees |
| `WorktreeCreate` | `worktreePath` |
| `Elicitation`, `ElicitationResult` | `action` (`accept`\|`decline`\|`cancel`), `content` |

### Top-level `decision`

`UserPromptSubmit`, `UserPromptExpansion`, `PostToolUse`, `PostToolUseFailure`, `PostToolBatch`, `Stop`, `SubagentStop`, `ConfigChange` and `PreCompact` read a top-level `{"decision": "block", "reason": "…"}`. The only value is `"block"`; to allow, omit the field or print nothing.

`PreToolUse` used to accept this shape and no longer does — it reads `hookSpecificOutput.permissionDecision`. The old `"approve"` and `"block"` values map to `"allow"` and `"deny"`.

### Rewriting rather than blocking

- `PreToolUse` → `updatedInput` replaces the tool's arguments before it runs. It replaces the **whole** input object, so carry the unchanged fields through. Several hooks writing `updatedInput` on one tool is a race: they run in parallel and the last to finish wins.
- `PermissionRequest` → `updatedInput` inside `decision`, re-evaluated against deny and ask rules.
- `PostToolUse` → `updatedToolOutput` replaces the result before Claude sees it. The value has to match the tool's output shape.
- `UserPromptSubmit` cannot replace the prompt; it can only add context alongside it.

Redaction therefore intercepts at `PreToolUse` going out and `PostToolUse` coming back.

### `updatedPermissions` entries

`PermissionRequest`'s `updatedPermissions` and its incoming `permission_suggestions` share one shape, so a hook can echo a suggestion back — the equivalent of the user picking "always allow".

| `type` | Fields | Effect |
|---|---|---|
| `addRules` | `rules`, `behavior`, `destination` | Adds rules. `rules` is `{toolName, ruleContent?}[]`; `behavior` is `allow`\|`deny`\|`ask` |
| `replaceRules` | same | Replaces all rules of that behavior at that destination |
| `removeRules` | same | Removes matching rules |
| `setMode` | `mode`, `destination` | `default`, `auto`, `acceptEdits`, `dontAsk`, `bypassPermissions`, `plan`, `manual` |
| `addDirectories` / `removeDirectories` | `directories`, `destination` | Working directories |

`destination` is `session` (in memory), `localSettings`, `projectSettings` or `userSettings`. A hook writing to `projectSettings` is editing a file under version control — be deliberate about that.

---

## Environment available to a handler

| Variable | When |
|---|---|
| `CLAUDE_PROJECT_DIR` | always — the project root |
| `CLAUDE_PLUGIN_ROOT` | plugin hooks — the install directory, replaced on every update |
| `CLAUDE_PLUGIN_DATA` | plugin hooks — persistent state that survives updates |
| `CLAUDE_PLUGIN_OPTION_<KEY>` | plugin hooks — a user-config value, e.g. `CLAUDE_PLUGIN_OPTION_WEBHOOK_URL` |
| `CLAUDE_ENV_FILE` | `SessionStart`, `Setup`, `CwdChanged`, `FileChanged` — append `export` lines to persist variables into later Bash commands |
| `CLAUDE_EFFORT` | tool-use contexts that support effort |
| `CLAUDE_CODE_REMOTE` | `"true"` in remote web environments; unset in the local CLI |
| `CLAUDE_CODE_BRIDGE_SESSION_ID` | while a Remote Control connection is active (v2.1.199+) |

The handler inherits the rest of the parent environment, with one deliberate exception: `OTEL_*` exporter variables are stripped from every subprocess Claude Code spawns.

`$ANTHROPIC_MODEL` is readable if your shell sets it, but it does not follow `/model` changes during a session, so treat it as a launch-time value rather than the current model.

## Paths and quoting

Three placeholders resolve in `command` and in every `args` element: `${CLAUDE_PROJECT_DIR}`, `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`. All three are also exported as environment variables, so a script can read `process.env.CLAUDE_PLUGIN_ROOT` whichever form launched it.

A bare relative path resolves against the working directory, which is the user's project rather than your plugin. It may not exist; worse, it may exist and be something else. `${CLAUDE_PLUGIN_ROOT}` is the only form that answers "where am I installed".

In shell form, wrap each placeholder in double quotes — an unquoted path breaks on the first install directory with a space in it:

```json
{ "type": "command", "command": "bun \"${CLAUDE_PLUGIN_ROOT}\"/hooks/guard.ts" }
```

In exec form no quoting is needed or wanted, because there is no shell to re-parse anything:

```json
{ "type": "command", "command": "bun", "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/guard.ts"] }
```

A plugin hook substitutes `${user_config.*}` values in **exec form only**. A shell-form command referencing one fails with an error rather than running; read `$CLAUDE_PLUGIN_OPTION_<KEY>` instead, or add `"args"` and switch forms.

On macOS and Linux a shell-form script also needs its executable bit set. `chmod +x` is the fix, and a script that "isn't running at all" with no error is usually this.

## Where a hook can live

| Location | Scope | Shareable |
|---|---|---|
| `~/.claude/settings.json` | every project | no |
| `.claude/settings.json` | one project | yes, committed |
| `.claude/settings.local.json` | one project | no, gitignored |
| managed policy settings | the organization | admin only |
| plugin `hooks/hooks.json` | while the plugin is enabled | yes |
| skill or agent frontmatter | while the component is active | yes |

Entries **merge** across levels rather than replacing each other, so a project hook adds to the user's rather than overriding it. The same handler defined in two settings files runs once; a plugin's or skill's copy of it stays separate and runs again.

For a subagent, a `Stop` hook in frontmatter is converted to `SubagentStop`, since that is the event that actually fires. Frontmatter hooks in a project subagent run only after the workspace-trust dialog is accepted for that folder.

`"disableAllHooks": true` turns everything off. It respects the managed hierarchy: only the managed level can disable managed hooks. There is no way to disable one hook while leaving it configured.
