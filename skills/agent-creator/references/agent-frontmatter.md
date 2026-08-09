# Subagent frontmatter: every field, and when it earns its place

An agent definition is a Markdown file whose YAML frontmatter configures the runtime and whose body becomes the agent's system prompt. Two fields are required; the other fourteen exist to be left out most of the time.

Before the field list, three things that shape everything below.

**Agent frontmatter is camelCase.** `disallowedTools`, `maxTurns`, `mcpServers`, `initialPrompt`. Skill frontmatter is kebab-case (`disallowed-tools`, `argument-hint`). They are not interchangeable, and a kebab-case key in an agent file is simply ignored — no warning, no fallback. This is the single most common way an author's intent quietly fails to apply.

**No agent field is "Plugin only."** Plugin-specific behaviour for agents lives in the directory layout rather than in a field: a subfolder under `agents/` becomes part of the scoped name, which is why `name` may not contain `:`. Read `delegation.md` when you are choosing where in `agents/` a definition goes, or when an agent you installed is running as a version you do not recognise — it has the subfolder rule and the five-level precedence order behind both.

**"Standalone" here means a file in `.claude/agents/` or `~/.claude/agents/`, not portability.** The Agent Skills open standard defines exactly one artifact, `SKILL.md`. There is no agent concept in the specification, so nothing in this file carries a portability guarantee outside Claude Code — unlike `../../../shared/references/portability.md`, where the portable subset is a real and enforceable thing.

---

## Scope table

| Field | Required | Scope | One-line purpose |
|---|---|---|---|
| `name` | **yes** | Both | The identifier Claude delegates to |
| `description` | **yes** | Both | The delegation surface |
| `tools` | no | Both | Allowlist; omitted means inherit everything |
| `disallowedTools` | no | Both | Subtracted before `tools` resolves |
| `model` | no | Both | Model tier for this agent's turns |
| `maxTurns` | no | Both | Hard ceiling on the agent's turns |
| `skills` | no | Both | Skill content preloaded at startup |
| `memory` | no | Both | Cross-session learning, scoped |
| `background` | no | Both | Run detached (default) or in the invoking turn |
| `effort` | no | Both | Reasoning budget per turn |
| `isolation` | no | Both | Run inside a git worktree |
| `color` | no | Both | Transcript colour |
| `initialPrompt` | no | Both | Opening message under `--agent <name>` |
| `permissionMode` | no | **Standalone only** | **Ignored for plugin subagents** |
| `mcpServers` | no | **Standalone only** | **Ignored for plugin subagents** |
| `hooks` | no | **Standalone only** | **Ignored for plugin subagents** |

## The three that go silent inside a plugin

`permissionMode`, `mcpServers` and `hooks` are **ignored for plugin subagents**. Not rejected, not warned about — ignored. The plugin installs, `claude plugin validate --strict` passes, the agent loads and runs, and the field does nothing.

That matters most for `permissionMode`, because it is the one authors reach for as a safety measure. An agent carrying `permissionMode: plan` inside a plugin has no plan mode and no indication that it lacks one. If the agent must not mutate anything, express that as a tool grant — `tools: ["Read", "Grep", "Glob"]` holds in every scope, because it is resolved by the same code path that decides which tools exist.

The same reasoning applies to the other two, less dramatically. An agent that depends on `mcpServers` for its data source will run in a plugin and simply find no such tools. An agent whose `hooks` enforce a convention will run in a plugin with the convention unenforced.

If the agent genuinely needs one of the three, it cannot ship in a plugin. Ship it as a project agent in `.claude/agents/` and say why in a comment, so the next person does not helpfully move it.

---

## The fields

### `name` — required, Both

The identifier Claude delegates to and the one `@agent-<name>` and `--agent <name>` take. Lowercase letters and hyphens.

**It may not contain `:`.** That character is reserved for plugin scoping, and a file that breaks the rule is **not loaded at all** — no error, no entry in `/agents`, nothing. An agent that has simply vanished is worth checking for a colon first.

Unlike a skill, an agent's `name` need not match its filename, and Claude Code will load it either way. Keep them identical regardless: every diagnostic, every duplicate-name report from `/doctor`, and every human reading the directory listing works off the filename, and a mismatch means the thing you grep for is not the thing that loaded.

*Earns its place:* always. It is required.

### `description` — required, Both

Drives automatic delegation, and it is the only text Claude reads when deciding. Written to the four criteria in `../../../shared/references/description-writing.md`; read `delegation.md` as well when you write the `<example>` blocks, or when you are weighing "use proactively".

*Earns its place:* always, and it deserves more of your attention than the rest of this file combined. An agent with a perfect body and a vague description is never invoked.

### `tools` — Both

An allowlist of the tools the agent may use.

**Value forms.** A YAML sequence or a comma-separated scalar; both parse.

```yaml
tools: ["Read", "Grep", "Glob"]
tools: Read, Grep, Glob
```

Anything else is a defect, and one form fails in a particularly nasty way: a sequence written as a quoted scalar (`tools: "[\"Read\"]"`) parses as a single tool name that matches nothing, which strips the agent of every tool it asked for while looking correct in the file.

MCP grants accept `mcp__<server>`, `mcp__<server>__*` and `mcp__*`. Remember that a plugin-bundled server's tools are named `mcp__plugin_<plugin-name>_<server-name>__<tool-name>`, so a grant written against the bare server name matches nothing.

**Default:** omitted means the agent inherits every tool available to subagents.

*Earns its place:* almost always, and its absence is a decision rather than a default. Inheriting everything is right for a general-purpose worker that could be asked to do anything; it is wrong for every agent with a job. Two specific wins: an agent that reports rather than mutates is strictly more useful without `Write` and `Edit`, because the author keeps the accept-or-reject decision; and an agent without `Task` cannot spend the caller's nesting and concurrency budget behind its back.

#### Granting `Task`: the budget the agent spends and cannot see

Two runtime caps bound the whole tree, and they are the reason `Task` is the one grant worth arguing about.

| Cap | Default | Override |
|---|---|---|
| Nesting depth below the main conversation | 3 layers | `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` |
| Concurrent subagents | 20 | `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` |

An agent has no reliable way to know how deep it already is, so an orchestrator written on the assumption that it sits one level below the user behaves differently when something else delegates to it. Verify what your runtime does at the depth boundary before building a design that depends on the answer.

The concurrency cap turns into arithmetic quickly. Eight subagents running in parallel, each fanning out three ways, is twenty-four against a cap of twenty. The excess queues rather than failing, which is worse in one specific way: the fan-out was presumably chosen for wall-clock, and queuing quietly removes exactly that benefit while everything still appears to work.

Two design consequences.

**Prefer wide and shallow to deep.** Depth costs more than the cap. Each layer re-summarizes for the layer above, so a finding three levels down reaches the user through three lossy compressions, and the user cannot ask the subagent that found it a follow-up question. A fan-out from the main conversation keeps every result one summary away from the person reading it.

**Withhold `Task` unless the agent's job is orchestration.** It is the easiest grant to hand out by omitting `tools` entirely, and the hardest consequence to see in a transcript.

### `disallowedTools` — Both

A denylist, **applied before `tools` resolves**. `tools` then selects from what remains, so a tool named in both lists is removed. That is the composition rule rather than a conflict to reason about.

```yaml
# inherit everything except the two that mutate
disallowedTools: ["Write", "Edit"]
```

**Default:** empty.

*Earns its place:* when the sentence you would write is "everything except X". Enumerating an allowlist to express that is fragile — the list goes stale as the tool set grows, and each new tool silently fails to be granted. Reach for the allowlist when the agent has a small known job, and for the denylist when it has a broad one with a specific prohibition.

### `model` — Both

**Value forms:** an alias (`opus`, `sonnet`, `haiku`), a full model ID, or `inherit`.

**Resolution order,** highest first: the `CLAUDE_CODE_SUBAGENT_MODEL` environment variable, then a per-invocation parameter, then this field, then the main conversation's model. Worth knowing before debugging why a pinned model did not apply — the two above it win silently.

*Earns its place:* when the agent's work sits clearly above or below the caller's tier. Pin a cheaper tier for mechanical extraction and enumeration. Write `inherit` explicitly — even though it is the effective default — for judgement work, where the point is that a reviewer must reason at the same level as the thing it is reviewing; the explicit value makes that intent legible to the next reader instead of looking like an oversight.

### `maxTurns` — Both

A hard ceiling on how many turns the agent takes before it is stopped.

**Default:** unset, meaning no explicit cap.

*Earns its place:* on agents with a search-shaped job, where "keep looking" has no natural end — flake hunting, dependency tracing, log trawling. It converts an unbounded cost into a bounded one. Use it as a diagnostic too: an agent that routinely hits its cap is under-specified rather than under-budgeted, and the fix is a clearer termination condition in the body, not a bigger number.

### `skills` — Both

Skill content preloaded into the agent at startup, by name.

```yaml
skills: ["my-plugin:house-style"]
```

A skill marked `disable-model-invocation: true` cannot be preloaded.

*Earns its place:* when the agent needs that skill on **every** run. Preloading converts a delegation gamble into a certainty, and pays the skill's body tokens unconditionally in exchange. If the agent needs the skill on a minority of runs, leaving it to normal skill invocation is cheaper. The other good reason is de-duplication: when two agents keep needing the same explanation, write it once as a skill and preload it in both rather than copying prose between two system prompts that will drift.

### `memory` — Both

Enables cross-session learning, scoped to `user`, `project` or `local`.

*Earns its place:* when judgement should improve with exposure and the accumulated notes belong at that scope. A reviewer that learns a repository's sanctioned exceptions stops re-reporting them, which is the difference between an agent people keep and one they mute. Two costs worth weighing before adding it. The agent stops being a pure function of its definition, so a behaviour change between two runs may be the memory rather than your edit — clear or pin it while measuring. And the scope is a real decision: `project` memory is shared with everyone on the repository, so anything the agent writes there is a note to your colleagues.

### `background` — Both

Whether the agent runs detached from the invoking turn.

**Default: `true`.** Subagents run in the background unless told otherwise, and **background subagents get a smaller built-in tool set**.

*Earns its place:* set `false` when the caller needs the result inside the turn that asked for it — a pre-flight check whose whole purpose is to gate the next step. Also set it `false` when an agent that worked during interactive testing behaves as though a tool is missing, because that is exactly the symptom of the smaller background tool set.

### `effort` — Both

Reasoning budget per turn: `low`, `medium`, `high`, `xhigh`, `max`. Available levels depend on the model.

*Earns its place:* it is the cheapest quality-versus-cost lever available and the one most often left untouched. Drop it for mechanical work where the answer is lookup rather than judgement. Raise it for an agent whose whole value is a hard call made well — a reviewer distinguishing a real defect from a house convention is doing the kind of work that improves with more of it.

### `isolation` — Both

`isolation: worktree` runs the agent inside a git worktree branched from the default branch.

*Earns its place:* when several agents mutate the same repository concurrently, which is otherwise a race with no diagnostic; or when the work should land somewhere discardable, so a bad run costs a branch deletion instead of a revert. The constraint that bites: **a command resolving outside the worktree fails.** An agent that reads a config from the user's home directory, or writes to a sibling checkout, works without isolation and fails with it — and the error names the command, not the field that caused it. Check the agent's paths before adding this.

### `color` — Both

One of `red`, `blue`, `green`, `yellow`, `purple`, `orange`, `pink`, `cyan`.

*Earns its place:* purely legibility, and it is not nothing. When three agents run concurrently, distinct colours are how a human reads the transcript. Worth setting for any agent that will run alongside others; skip it for a solo agent.

### `initialPrompt` — Both

The opening message when the agent is launched as the main session with `--agent <name>`.

*Earns its place:* only for an agent that is a whole session persona rather than a delegate. A delegate is always handed a task by its caller, so an initial prompt would be talking over the brief. If you find yourself wanting one on a delegate, what you actually want is a clearer default behaviour in the body.

### `permissionMode` — Standalone only

Sets the agent's permission mode. Accepts the modes the CLI's `--permission-mode` flag takes: `default`, `acceptEdits`, `plan`, `bypassPermissions`. **Ignored for plugin subagents.**

*Earns its place:* rarely, and never as a safety mechanism. `acceptEdits` on a project agent doing bulk mechanical edits saves a prompt per file and is a genuine ergonomic win. Anything you would reach for to *prevent* an action belongs in the tool grant instead, which holds in every scope.

### `mcpServers` — Standalone only

A map of MCP server definitions private to this agent, the same shape as an `.mcp.json` entry. **Ignored for plugin subagents.**

*Earns its place:* when an agent needs a server no other part of the session should see — a write-capable database connection scoped to one migration agent, for instance. If the agent ships in a plugin, declare the server in the plugin's `.mcp.json` and grant its tools through `tools` instead, remembering the `mcp__plugin_*` naming.

### `hooks` — Standalone only

Hook definitions scoped to this agent, the same shape as a `hooks.json` event map. **Ignored for plugin subagents.**

*Earns its place:* when a convention must be enforced mechanically for this agent and only this agent — deterministic enforcement beats asking the model nicely. In a plugin, put the hook in `hooks/hooks.json` and match on the agent type in `SubagentStart` / `SubagentStop` instead.

---

## Three worked examples

### Minimal

Two fields. Everything else defaults: it inherits the full subagent tool set, the caller's model, background execution.

```yaml
---
name: changelog-drafter
description: "Drafts a CHANGELOG entry from the commits since the last tag..."
---
```

Right when the agent's value is entirely in its system prompt and it needs no restriction. The thing to notice is what the absence of `tools` means: this agent can edit and run commands. That is a decision, made by omission, and it should be a deliberate one.

### Read-only reviewer

```yaml
---
name: schema-reviewer
description: "Reviews a database migration for lock risk, backfill cost and rollback safety..."
# Read-only by construction. A reviewer able to edit would hand back findings
# and changes fused together, and the author could no longer decline half.
tools: ["Read", "Grep", "Glob"]
# `inherit` is the effective default; stated so the intent is legible. Judging
# whether a migration is risky is the caller's own reasoning problem.
model: inherit
# The agent runs alongside other reviewers; distinct colours make the
# concurrent transcript readable.
color: cyan
---
```

Four fields, three of them load-bearing. Note what is *not* here: no `permissionMode`, because the tool grant already makes mutation impossible and would keep doing so inside a plugin; no `maxTurns`, because reviewing a finite diff terminates on its own.

### Heavyweight

```yaml
---
name: dependency-upgrader
description: "Upgrades a named dependency across the repository, runs the test suite..."
# Bash to run the package manager and the tests; Write/Edit to apply the
# upgrade; Read/Grep/Glob to find call sites. Task is deliberately absent —
# this agent already runs in a fan-out and must not spawn its own.
tools: ["Read", "Grep", "Glob", "Edit", "Write", "Bash"]
# Several of these run at once against one repository. Without a worktree
# each they race on the lockfile. Every path this agent touches is inside
# the repo, which is the precondition for isolation being safe.
isolation: worktree
# The caller waits: the upgrade either lands or it does not, and the next
# step depends on knowing which.
background: false
# Upgrade-then-test is a loop with no natural end when a test keeps failing.
maxTurns: 40
# Reading a breaking-change note and deciding whether a call site is affected
# is the hard part of this job.
effort: high
# The repository's known upgrade hazards accumulate here across runs.
memory: project
---
```

Six optional fields, each answering a specific failure this agent would otherwise have. That is the bar: a field belongs here because leaving it out breaks something concrete, not because it was available. An agent with this frontmatter and a two-paragraph body is misconfigured, not configured.

---

*Field semantics recorded against Claude Code 2.1.x behaviour as documented at the time of writing: `name` colon restriction from 2.1.218, worktree path enforcement from 2.1.203, preload restriction on `disable-model-invocation` skills from 2.1.205, `background` defaulting to true from 2.1.198. Where this file and the current Claude Code documentation disagree, the documentation wins — and the disagreement is worth reporting.*
