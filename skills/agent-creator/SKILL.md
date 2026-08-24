---
name: agent-creator
license: MIT
compatibility: "Claude Code, for authoring and for the `claude plugin validate` pre-flight. The measurement scripts it calls live in the sibling skill-creator skill and run on Bun."
metadata:
  component-type: agent
allowed-tools: Read, Grep, Glob
argument-hint: "[what the agent should do]"
model: opus
# Keep description as ONE double-quoted line: a blank line in a block scalar silently truncates it.
description: "Use when the thing being built, fixed, or reasoned about is a Claude Code subagent — the markdown file under agents/, its frontmatter, its system prompt, and the tool grant that bounds it. Covers deciding whether the work wants a subagent at all rather than a skill, choosing which tools to grant and which to deny and what happens when one appears in both, writing a description so Claude actually delegates instead of doing the work inline, adding delegation examples, running a static check over the file before spending eval budget, building a set of test queries to check whether delegation happens, and diagnosing an agent that never fires, collided with another of the same name, or whose frontmatter field silently did nothing. Skip when the artifact is a skill, a hook, an MCP server, a slash command, or the plugin around them — each has its own creator. Skip for a read-only audit of an agent you are not changing (agent-reviewer)."
---

# Agent Creator

A skill for writing Claude Code subagent definitions and improving them, with measurement rather than vibes as the evidence that a change helped.

The loop parallels the one in `skill-creator`, because the two artifacts fail the same way — by never being reached:

- Decide whether the work wants a subagent at all
- Capture what the agent is for, and what it must not be able to do
- Write the definition: frontmatter, tool grant, system prompt, description
- Pre-flight — validate, then run the `agent-reviewer` agent
- Synthesize a delegation scenario set from the agent's body and grant, and get it signed off
- Measure whether Claude actually delegates, and improve from what the failures show
- Tune the description separately, then ship the file

Find where in that loop the user already is and jump in there. An existing agent that never fires goes straight to the description work; "just write me the file" is a legitimate answer. It is a default, not a gate.

---

## Does the work want a subagent at all?

This is the question most worth getting right, because the wrong answer costs a whole artifact. A subagent buys two things and charges for two others.

**What it buys.** *A separate context window* — work that reads forty files to produce one paragraph costs the caller one paragraph, and the exploration is discarded. *A tool grant the caller cannot widen* — an agent defined with `tools: ["Read", "Grep", "Glob"]` cannot edit, whatever its prompt asks of it. That second one is a runtime property rather than a promise in prose, which makes it the only constraint here that still holds when the model is confused.

**What it costs.** *A round trip* — the caller waits or backgrounds, and the agent starts cold; for work that is three tool calls, the overhead is the work. *The conversation* — the agent sees the prompt it was handed and nothing else, so every constraint the user established four turns ago has to be restated, and callers routinely forget. That second one is the failure authors do not anticipate: the agent performs correctly against a brief missing half the requirements, and nothing in the transcript looks wrong.

So delegate when **the intermediate context is large and the answer is small**, or when **the restriction has to be enforced rather than requested**. Do not delegate work whose substance is the conversation.

Against the neighbouring artifact: a skill changes how *this* Claude works; an agent is a different Claude with a different job. If the work needs knowledge — "here is how we do X" — that is a skill, and `../skill-creator/SKILL.md` writes it. If it needs a fresh context and a narrower grant, it is an agent. If it needs both, write both and have the agent preload the skill with `skills:`.

Read `references/delegation.md` when that call is not obvious on one reading — the work has some of both shapes, or someone has already argued for the other one. It opens with the decision as a four-question tree.

---

## Capture intent

The conversation above is often the spec — "make this a reviewer agent" usually means the checks the user has been asking for by hand are the body. Mine it before asking anything, then confirm; an agent built on a misread is cheap to produce and expensive to evaluate.

1. What job does the agent do, and what does it hand back? The caller sees only the final message, so "hands back" is the real interface.
2. What must it be unable to do? Answer this before the tool grant, not after, or you will grant tools and then rationalize them.
3. When should Claude reach for it unprompted — what would the user be saying at that moment?
4. Does it need the repository as it stands or a clean copy, and is it a delegate or a whole session via `--agent <name>`? Those two answers pick `isolation` and `initialPrompt`.

---

## Gotchas — the failures that say nothing

Each of these fails silently rather than raising an error, which is why they sit in the body rather than behind a pointer: you cannot recognise the trigger for a gotcha you have not read.

- **`permissionMode`, `mcpServers` and `hooks` are ignored for plugin subagents.** The plugin installs, `claude plugin validate --strict` passes, the agent runs, and the field does nothing. That bites hardest on `permissionMode`, the field authors reach for as a safety measure — express a restriction as a tool grant, which resolves the same way in every scope. An agent that genuinely needs one of the three cannot ship in a plugin; make it a project agent in `.claude/agents/` and say why in a comment.
- **A `name` containing `:` is not loaded at all.** The colon is the plugin scope separator. No error, no entry in `/agents`. An agent that has simply vanished is worth checking for a colon first.
- **Agent frontmatter is camelCase; skill frontmatter is kebab-case.** `disallowedTools`, `maxTurns`, `initialPrompt`. A kebab-case key in an agent file is ignored with no fallback.
- **A quoted sequence in `tools` strips every tool.** `tools: "[\"Read\"]"` parses as one tool name matching nothing. `tools: ["Read", "Grep"]` and `tools: Read, Grep` both work; the quoted form looks right and leaves the agent with nothing.
- **A plugin-bundled server's MCP tools are named `mcp__plugin_<plugin>_<server>__<tool>`.** A grant copied from that server's README matches nothing, and matching nothing reports nothing.
- **`background` defaults to `true`, and background subagents get a smaller built-in tool set.** An agent that worked in interactive testing can lose a tool it depended on.
- **There is no `paths` field for an agent, and it is not the gap it looks like.** On the skill side `paths` *limits* activation to matching files rather than adding a trigger, so an authoring skill carrying it stops firing whenever no matching file is open — most of the time. Scoping an agent is the description's job.

---

## Write the definition

### Frontmatter

`name` and `description` are required; everything else is optional and most of it should stay that way.

Read `references/agent-frontmatter.md` when you are about to set any field beyond `name`, `description` and `tools`, or when a field you did set appears to have done nothing. It gives each field's accepted value forms, its scope marker, and the concrete failure it prevents. Guessing a value form is the expensive mistake: several parse without complaint and mean something other than what you wrote.

### The tool grant

Omitting `tools` inherits every tool available to subagents — convenient, and the wrong default for anything whose job is to report.

Grant the narrowest set that does the job. The reasoning is not only safety: **a read-only agent that reports is more useful than one that can rewrite what it was asked to judge**, because it leaves the author able to accept or reject each finding. An agent that fixes as it reviews hands back findings and changes fused together, and declining half means reading a diff to work out which half.

`disallowedTools` is applied first; `tools` then resolves against what remains, so a tool named in both is removed — the composition rule, not a contradiction. That makes `disallowedTools` the instrument for "inherit everything except the dangerous one": leave `tools` unset and subtract.

```yaml
tools: ["Read", "Grep", "Glob"]        # allowlist — an agent that reports
disallowedTools: ["Write", "Edit"]      # subtract from the inherited set
```

Two grants are wider than they look. `Bash` re-admits nearly everything else — an agent holding `Bash` and no `Write` can still redirect into a file, so "no Write" becomes a statement of intent rather than a boundary. And `Task` lets the agent spawn subagents, spending depth and concurrency budget the caller did not plan for. Read `references/agent-frontmatter.md`, section `tools`, before granting `Task` — for the two runtime caps and the arithmetic that turns a planned fan-out into a silent queue.

For MCP the grant patterns are `mcp__<server>`, `mcp__<server>__*` and `mcp__*`, written against the name the tool actually has.

### The system prompt body

The body becomes the agent's system prompt. It replaces the persona rather than supplementing it, which changes how it should be written in four ways:

- **Open with the identity.** "You review Claude Code skills and report findings. You never edit." A first line that establishes role and prohibition does more work than a page of procedure, because everything after it is read in that frame.
- **Assume no history.** The agent has only the prompt it was handed. Say what it will receive, what to do when the brief is thin, and what to report as unknown rather than guess — an agent that silently fills gaps produces confident output about the wrong thing.
- **Specify the hand-back precisely.** Only the final message crosses back, and the caller is often another Claude parsing it, so give a literal output template rather than a description of one.
- **Say what done looks like.** Without a termination condition an agent keeps finding one more thing to check.

Second person throughout, and explain why a rule exists rather than issuing it in caps: given the reasoning, the agent generalizes to the case you did not anticipate; given a bare rule, it stops where the rule does. Keep clear which constraints are real, too — prose in the body is advisory to the model, the tool grant is enforced by the runtime, and safety belongs in the grant.

Open `examples/flake-triage.md` before writing your first body, and imitate its shape rather than inventing one: identity line, thin-brief handling, an ordered method, a literal report template, edge cases, with every frontmatter choice annotated inline.

### The description

The description is the delegation surface. Claude sees every agent's name and description and decides from that alone; the body is invisible until after the decision. Four criteria, in impact order: a **deliverable clause** naming what the agent produces rather than the topic it concerns; a **negative clause** built from the positives' own vocabulary, since a negative made of words the positives never use excludes nothing; **trigger phrasing** a real user would type; and **no universal-quantifier pushiness**, which buys true positives at a disproportionate false-positive cost. Read `../../shared/references/description-writing.md` when writing or rewriting one — the criteria transfer intact, and it carries the measurements behind them, which is what keeps the rewrite from becoming a matter of taste.

Two things differ for an agent. The competitor set is wider — an agent competes with other agents, with skills, and most often with the model simply doing the work itself. And "use proactively" is the one sanctioned lever for encouraging automatic delegation; it is still pushiness, so reach for it when the agent's value depends on firing unasked, such as a reviewer that should run after an edit, rather than as a default.

**The `<example>` / `<commentary>` convention.** Widely-shipped agents carry two or three blocks inside the description, each showing the delegation decision as a short transcript:

```text
<example>
Context: <the state of the world, not the request restated>
user: "<what a user actually types, sometimes without naming the agent>"
assistant: "I'll use the <name> agent to <what it hands back>."
<commentary>
<why this delegates rather than being done inline — not a repeat of the job.>
</commentary>
</example>
```

Nothing parses those tags: they work as few-shot demonstrations sitting in the only text read when the decision is made, so the length guidance above does not apply to them.

Read `references/delegation.md` when you write those blocks, and again when a finished agent is not being delegated to. It has what makes a block earn its characters, and a worked pair showing why a vague description loses to a specific sibling — the mechanism behind most non-delegation, and not one the failing transcript shows you, because in it the work simply got done by someone else.

---

## Mechanical pre-flight

Two cheap checks before spending eval budget — the bundled validator on the definition itself, and the first-party one on the plugin around it:

```bash
bun ../../shared/validate/validate.ts --target-type agent <agent-file>
claude plugin validate <plugin-path> --strict
```

The first catches what an agent file gets wrong in particular: a missing `name` or `description`, a kebab-case key where agent frontmatter is camelCase and so silently ignored, and the three fields a plugin ignores.

Then run the `skill-creator:agent-reviewer` agent on the definition. It audits statically — frontmatter shape, the plugin-ignored-field trap, grants wider than the prompt justifies or naming tools that do not exist, whether the stated job is achievable with what was granted, description quality, body substance. It never runs the agent, which is why it complements measurement instead of replacing it: a static audit cannot tell you whether the agent is *delegated to*.

Close the loop rather than reading the output once: fix what each reports, run both again, repeat until the validator is clean and the reviewer returns no FAIL. Every finding left standing costs a full eval iteration to rediscover. `/doctor` reports duplicate agent names, worth a glance when the agent joins an installed set.

---

## Build the delegation scenario set

Delegation is measurable the same way skill triggering is: run a query, and watch whether the model calls `Task` with this agent's `subagent_type` before starting the work itself.

**Synthesize the scenarios from what the agent does, not from what it says about itself.** Generating queries from the description you are about to optimize is circular: the queries inherit its vocabulary, so a capability the description omits produces no query, is never penalized, and the score comes back clean with the gap intact. Read the system prompt body for every job and output it promises, the `skills:` preloads and `memory` for capabilities it assumes rather than states, and — the signal specific to agents — the tool grant. An agent granted `Bash` is being asked to run something; if the description implies only reading, that gap is a finding before a single query runs.

Hard negatives have to be genuinely hard or the eval certifies everything: an easy near-miss has an obvious one-step first action, so the model never reaches the delegation decision at all. Draw them from the agent's stated non-goals phrased in the *positive* vocabulary; from the adjacent capability just outside the boundary, which a reasonable person would assume this agent handles; and from co-installed neighbours, since a skill that absorbs the query is a delegation that did not happen.

One command does all three readings and the neighbour sweep, then stops before generating anything:

```bash
bun ../../shared/operations/synthesize-scenarios.ts \
  --target agents/<name>.md --target-type agent --inventory-only
```

**Put that capability inventory in front of the user before running anything** — "this agent appears to do X, Y and Z; is that right?" Two things fall out for free: the user corrects a misread before it costs an iteration, and a capability they confirm that the description never mentions is a finding in its own right, surfaced before any eval runs. Drop `--inventory-only` and add `--out` once the inventory is agreed.

Then get the query set signed off. Twenty queries, roughly half should-delegate:

```json
[
  {"query": "the user prompt", "should_trigger": true},
  {"query": "another prompt", "should_trigger": false}
]
```

When the set is ready for the user to approve rather than read in chat, `../skill-creator/assets/eval_review.html` is the sign-off harness, and `../skill-creator/SKILL.md` says how to fill its placeholders and where the export lands.

---

## Measure

```bash
bun ../../shared/operations/optimize-description.ts \
  --eval-set evals/delegation-eval.json \
  --target-type agent \
  --model <model-id-powering-this-session> \
  --max-iterations 5 \
  --verbose
```

Use the model ID from your own system prompt, so the test matches what the user experiences. Launch it detached rather than babysitting it: read `../../shared/references/running-detached.md` before the first such run, because a job started in the foreground dies with the turn and takes its partial results with it.

`--target-type agent` watches the `Task` call and its `subagent_type` instead of the `Skill` call. Nothing else changes: 60/40 train and held-out split, three runs per query, candidates proposed from what failed, and **selection on the held-out score** — a description tuned until it aces its own training queries has usually just memorized them.

Two things when reading the results. Claude delegates only for work it cannot easily handle alone, so a one-step query may not delegate even when the description matches perfectly — simple queries make poor evals in either direction. And an agent carrying `memory` is not a pure function of its definition: a difference between two runs may be accumulated state rather than your change, so clear or pin it while measuring and say which you did.

---

## Improve

Failures come in two kinds that want different fixes, and only the transcripts tell them apart.

**Never delegated to** — a description problem. Check whether the model did the work itself or handed it to a sibling: losing to a sibling is a boundary problem, while doing it inline usually means the description did not make the work sound like it needed a separate context.

**Delegated to and came back wrong** — a body or grant problem. Either the brief was thinner than the body assumed, in which case the body needs to say what to do with a thin brief, or the agent lacked a tool it needed, or it used one it should not have had.

Generalize past the handful of cases in front of you; the agent will be invoked on prompts you never see. When something proves stubborn, resist the fiddly overfitted patch and try a different framing of the role, or a different division of labour — cheap, and occasionally much better. If two agents keep needing the same explanation, that explanation is a skill and both should preload it. Then rerun and compare on held-out.

---

## Claude Code leverage worth reaching for

Each of these earns its place in a specific situation and costs something everywhere else. This table is when to want them; open `references/agent-frontmatter.md` once one of them looks like the answer, for the accepted value forms and the resolution order — the row tells you to reach, the field entry tells you what to write.

| Field | Reach for it when | What it costs |
|---|---|---|
| `memory` | Judgement should improve with exposure — a reviewer that learns the house exceptions stops re-reporting them | Behaviour is partly written by runs you never saw |
| `isolation: worktree` | Several agents mutate one repository at once, or the work should land somewhere discardable | Any path outside the worktree fails, and the error names the command, not the field |
| `skills: [...]` | The agent needs that skill on every run | Its tokens are paid unconditionally; a `disable-model-invocation: true` skill cannot be preloaded |
| `background: false` | The caller needs the result inside the invoking turn | Nothing — the default `true` is what costs you the smaller tool set |
| `effort` | The work is mechanical (drop it) or genuinely hard (raise it) | Nothing; the cheapest lever here and the most often left untouched |
| `maxTurns` | The job is search-shaped and "keep looking" has no natural end | A cap hit routinely means under-specified, not under-budgeted |
| `initialPrompt` | The agent is a whole session via `--agent <name>` | Meaningless for an agent always handed a task |

---

## Ship it

An agent is a single file, so there is nothing to package. It goes in `agents/<name>.md` at a plugin root, `.claude/agents/<name>.md` for a project, or `~/.claude/agents/<name>.md` for a person — and inside a plugin, never under `.claude-plugin/`, where components are silently ignored while `claude plugin validate` still passes.

Read `references/delegation.md` when the name might already be taken, by an installed plugin or by a project file someone added: it has the five-level precedence order and how a subfolder scopes the name. A shadowed agent is invisible rather than broken — nothing announces the collision, the wrong one simply runs. For plugin layout and `--plugin-dir` testing, `../../shared/references/plugin-skills.md`.

### Where this ships

A subagent runs wherever Claude Code runs: the CLI, the IDE extensions, and Desktop's Code and Cowork tabs, which consume the same plugin format. Two agent-specific facts change design decisions and belong here rather than in the matrix. Cowork loads what is enabled on the claude.ai account and never reads `~/.claude`, so a personal agent in `~/.claude/agents/` reaches the CLI and the Code tab and is invisible there. And there is **no standalone install path off Claude Code** — the Agent Skills standard defines no agent concept, so a subagent travels only inside a plugin, which makes the plugin a distribution requirement rather than a packaging preference. For a user who works on claude.ai the answer is a different artifact, not a different manifest.

Read `../../shared/references/distribution-targets.md` when the user names a surface, or asks where the agent will be available. Its matrix is what stops you promising Cowork on the strength of a file in `~/.claude/agents/`.

---

## Bundled files, and when each one fires

- `references/agent-frontmatter.md` — **when setting a field beyond `name`, `description` and `tools`; when a field you set did nothing; before granting `Task`.** Value forms, scope markers, resolution orders, the two spawn caps, three worked examples.
- `references/delegation.md` — **when choosing between an agent and a skill; when writing the `<example>` blocks; when the name may collide; when a finished agent is never delegated to.**
- `examples/flake-triage.md` — **before writing your first system prompt body.** A complete annotated specimen to imitate.

Cross-plugin, each with its own moment: `../../shared/references/description-writing.md` when writing the description, `../../shared/references/running-detached.md` before launching the measurement run, `../../shared/references/distribution-targets.md` when a surface is named, `../../shared/references/plugin-skills.md` when laying out the plugin, `../skill-creator/SKILL.md` when the artifact turns out to be a skill.

---

Put the loop's steps on your todo list if you have one. The step most often dropped is measuring delegation at all — and an agent nothing delegates to is indistinguishable from an agent that does not exist.
