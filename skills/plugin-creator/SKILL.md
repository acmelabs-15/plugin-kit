---
name: plugin-creator
argument-hint: "[what the plugin should do]"
# Read-only orientation, pre-approved so the skill can read an existing
# manifest, find sibling components and check what is installed without a
# permission prompt per file. The grant is additive, not a ceiling — the phases
# below still write files and run the validator through the normal permission
# flow. `Write`, `Edit` and `Bash` are deliberately absent: pre-approving a
# mutation on the user's behalf is not this skill's decision to make, and the
# grant would last the whole turn.
allowed-tools: Read, Grep, Glob
model: opus
# Free-form map. Claude Code ignores it; this plugin's own reviewers and
# scripts read it to know which artifact type a skill authors.
metadata: { component-type: plugin }
license: MIT
compatibility: "Claude Code — CLI, IDE, and the Desktop Code and Cowork tabs. Needs the `claude` CLI on PATH for the `claude plugin validate` gate, and Bun for any script it writes into a plugin."
description: |
  Use when the plugin itself is what is being built or debugged — the directory tree, .claude-plugin/plugin.json and its version field, the marketplace entry, and getting claude plugin validate --strict to pass. Covers where each component must sit for Claude Code to find it, why a component is not loading, how a path inside a plugin has to be anchored so it survives somebody else installing it rather than pointing at your machine, where a plugin may persist data across an update, how a subfolder scopes a component name, sharing code between two components, and which frontmatter or config a component silently ignores because it is running inside a plugin rather than standing alone.

  Skip when the work is the content of one component — skill-creator, agent-creator, mcp-creator and command-creator each own their own artifact. Skip for read-only component audits (the reviewer agents).
---

# Create a plugin

Produce a working, validating Claude Code plugin. Work through the phases in order; the design phase determines whether the result is any good, so do not compress it.

**Request:** $ARGUMENTS

Put the eight phases on your todo list before starting:

- [ ] Phase 1 — Purpose
- [ ] Phase 2 — Where it ships
- [ ] Phase 3 — Components
- [ ] Phase 4 — Design (gate)
- [ ] Phase 5 — Scaffold
- [ ] Phase 6 — Implement
- [ ] Phase 7 — Validate (loop)
- [ ] Phase 8 — Verify (loop)

The order is load-bearing rather than tidy: the target surfaces decide which components are possible at all, the components decide the layout, and the layout decides what the validator accepts, so a phase out of turn usually has to be redone. Phase 4 is a gate where an underspecified plan gets caught while it is still cheap; Phases 7 and 8 are loops that run until they come back clean.

## Gotchas — the silent failures that only happen inside a plugin

What is true *because* a component ships inside a plugin rather than standing alone — facts a single-component view cannot see, every one failing silently: no error, no warning, just a setting that bought nothing. They sit in the body rather than behind a pointer, since you cannot recognise the moment to look one up before you have read it.

- **A subfolder scopes an agent's identifier.** `agents/review/security.md` in plugin `my-plugin` is invoked as `my-plugin:review:security`. That is also why an agent `name` may not contain `:` — a file that breaks the rule is not loaded at all, with no message.
- **Three agent frontmatter fields are ignored for plugin subagents** — `permissionMode`, `mcpServers` and `hooks`. Each is meaningful in a standalone agent file. Inside a plugin they buy nothing while looking like they bought something, which is the worst way for a setting to fail.
- **Paths** — every path into the plugin, whether from a hook, a skill script or an MCP entry, uses the plugin-root anchor and is quoted. Written out that is a dollar sign then `{CLAUDE_PLUGIN_ROOT}`, spelled that way here because a skill body is injected with shell-style substitution applied and the braced form would arrive already expanded. Read `references/path-anchors.md` **when you are about to write a path into the plugin's own files**: it is read rather than injected, so it carries the token intact and names which of the three anchors each job wants. A hardcoded path breaks the moment anyone else installs the plugin; a bare relative path silently resolves into the user's project; and state under the wrong anchor is deleted on the next update.
- **A plugin server's MCP tools are named differently from a user-configured server's**: `mcp__plugin_<plugin>_<server>__<tool>`, with any character outside `A-Za-z0-9_-` replaced by `_`. Every `allowed-tools` grant, subagent `tools` entry and permission rule has to match that exact string, and the two forms differ by an infix rather than a prefix — so the grant copied out of the server's README looks plausible and matches nothing. Nothing errors; the tool prompts for permission every time.
- **The plugin `.mcp.json` accepts less than a standalone config does.** As Desktop reads it, entries use `type` rather than `transport` and only `url`, `headers` and `oauth` are read, so a server depending on a computed header works in Claude Code and arrives unauthenticated there.
- **Hooks, agents and commands have no life outside a plugin.** None has a standalone install path off Claude Code, so for anything distributed the plugin is their only delivery mechanism. Skills are the exception, at the cost of the Claude Code frontmatter and body features — read `../../shared/references/distribution-targets.md` before telling a user a skill from this plugin will work on claude.ai, because most of what makes it good does not travel.
- **Shared code** is a workspace package the plugin depends on, bundled into `dist/` by one build step; components invoke the built output, and nothing in the source tree imports from `dist/`. Read `references/shared-code-architecture.md` when you sit down to write `scripts/build.ts` — the entry-point rule, the `splitting` setting and the post-build path rewrite each fail by producing a `dist/` that looks correct and does not load.

Scripts are Bun and TypeScript: read `../../shared/references/pure-bun.md` when choosing an API for a script, and `../../shared/references/typescript-standard.md` when deciding where its tests and fixtures go.

## Phase 1 — Purpose

Establish what the plugin is for before naming a single file. If the request already makes the purpose clear, restate it in one sentence and confirm; if it does not, ask what problem this solves, who runs it and when, and what it produces. Wait for the answer.

## Phase 2 — Where it ships

Settle the target surfaces before the component list: the answer changes what can be built at all, not only how.

The framing to get right first: there is no separate "Claude Desktop plugin". Desktop is one application with three tabs — Chat, Cowork and Code — and plugins are the *Claude Code* format, consumed by Cowork and Code. **The Chat tab does not use plugins**, so a plugin aimed at it cannot exist; that surface takes an MCPB bundle (`.mcpb`, the renamed `.dxt`), a zip of a manifest plus a local stdio MCP server, which is a different artifact rather than a repackaging of this one.

Ask which the user means, and expect more than one:

| Destination | What it can carry |
|---|---|
| Claude Code — CLI and IDE | the whole plugin: skills, agents, hooks, commands, MCP |
| Desktop Code tab | the same, plus MCP servers from `claude_desktop_config.json` |
| Desktop Cowork tab | the same plugin, loaded from what is **enabled on the claude.ai account** — it never reads `~/.claude`, so a CLI install is invisible there |
| Desktop Chat tab | an MCPB bundle, or a remote connector. No plugin |
| claude.ai web, mobile | uploaded skills and remote connectors only. No local process, so no stdio server |

**When the answer is "everywhere", the recommendation is to ship two things:** a remote MCP server with OAuth, plus a plugin whose skills wrap it. The server reaches every surface including web and mobile; the plugin adds the skills, agents and hooks on the three that can load one. They compose rather than duplicate — a plugin references the remote server by URL, so a user holding both sees one set of tools. There is a distribution reason too: skills cannot be submitted to a directory on their own, so a plugin is how a skill gets published at all.

**One manifest can serve two targets, and should not.** Claude Code ignores unrecognized top-level fields, so a single file can also read as a VS Code extension manifest, an npm `package.json` or an MCPB manifest — but `--strict` promotes those fields to errors, so the merged file passes ordinary validation and fails the gate Phase 7 runs. **Keep the manifests separate:** two files cost a few duplicated fields once, and dropping `--strict` costs every check it adds for the life of the repo. Merge only where the other target requires one file, and say so in the README.

**Two directories, two submissions** — the Connectors Directory for remote MCP servers, MCPB bundles and MCP Apps, the plugin directory for plugins. A missing privacy policy is an immediate rejection from either, and it is a document rather than a code change, so raise it now.

Read `../../shared/references/distribution-targets.md` **when the user names a surface outside Claude Code itself** — Desktop Chat, claude.ai web, mobile, a managed fleet, or a directory submission. It carries the artifact-by-surface matrix, the MCPB manifest fields, the rest of the submission requirements, the admin precedence rules deciding whether a fleet install can be overridden, the traps that look portable and are not, and what is unverified. Skipping it is how a plugin gets built for a surface that cannot load one, discovered at the end rather than here.

## Phase 3 — Components

Decide what the plugin is made of. Every component type is optional, and each has a sibling skill owning its depth.

| Component | Directory | Use it when | Written with |
|---|---|---|---|
| Skill | `skills/<name>/SKILL.md` | Specialized knowledge, or a user-invoked action | `../skill-creator/SKILL.md` |
| Agent | `agents/<name>.md` | Work needing its own context window and tool set | `../agent-creator/SKILL.md` |
| Hook | `hooks/hooks.json` | Behaviour that must fire on an event, not a request | this skill, then `hook-reviewer` |
| MCP server | `.mcp.json` | An external service — database, API, LSP | `../mcp-creator/SKILL.md` |
| Slash command | `skills/<name>/SKILL.md` | An entry point whose point is that a person types `/name` | `../command-creator/SKILL.md` |
| Shared library | `packages/<name>/` (outside the plugin root) | Two or more components need the same code | `references/shared-code-architecture.md` |

Most plugins need no shared library, and not having one is the default. Read `references/shared-code-architecture.md` **when two or more components turn out to need the same schema, parser or client** — here rather than in Phase 5, because the answer moves the plugin root down a directory and retrofitting that means rewriting every path in the plugin. It also carries the constraint forcing the pattern: an installed plugin cannot reach files outside its own directory.

The `commands/` directory is a **legacy** layout rather than the home of the command component. A `commands/<name>.md` and a `skills/<name>/SKILL.md` load identically and both produce `/name`; only the skill layout can carry a directory of supporting files. Write new entry points as skills, and touch `commands/` only when maintaining a plugin that already uses it.

Present the plan as a table of component / count / purpose and get agreement before building.

## Phase 4 — Design

For each planned component, find what is underspecified and ask about it. This is the phase that gets skipped, and the one whose absence shows up in the finished plugin.

- **Skills** — what does it produce? What phrasing should trigger it, and what must it *not* trigger on? Does it need scripts, references, assets or examples?
- **Agents** — proactive or on request? Which tools, and why not fewer? What does it return?
- **Hooks** — which event? Command-based or prompt-based? What does it do on failure?
- **MCP** — remote or stdio? What credentials, and where do they come from?

Each sibling creator asks these in far more depth once building starts; the point here is to surface what is underspecified while the plan is cheap to change. If the user says "whatever you think is best", make a specific recommendation and get an explicit yes — deference is not a blank cheque.

## Phase 5 — Scaffold

```bash
mkdir -p <plugin>/.claude-plugin
mkdir -p <plugin>/skills/<skill-name>   # one directory per skill
mkdir -p <plugin>/agents                # only if needed
mkdir -p <plugin>/hooks                 # only if needed
```

That tree assumes the plugin root **is** the repo root, which is right for a plugin with no shared library. Where Phase 3 chose one, the plugin moves into a subdirectory so the package can sit outside it, and the scaffold also needs a root `package.json` declaring `workspaces`, a `packages/<name>/` with an enumerated `exports` map, a `scripts/build.ts`, and `plugin/dist/` gitignored. Read `references/shared-code-architecture.md` before writing that tree — guessing at the build settings produces a `dist/` that looks correct on disk and fails at runtime with a module-not-found.

`claude plugin init` also exists, but scaffolds to `~/.claude/skills/<name>/` — a personal skill, not a plugin in the working directory. Use it only when that is what the user wants.

### The manifest

`.claude-plugin/plugin.json`. **`name` is the only required field.** Everything else is optional — but ship these:

```json
{
  "name": "my-plugin",
  "description": "Produces X — use when the user wants Y",
  "version": "0.1.0",
  "author": { "name": "...", "email": "..." },
  "homepage": "https://github.com/owner/repo",
  "repository": "https://github.com/owner/repo",
  "license": "MIT",
  "keywords": ["..."]
}
```

**Always set `version`.** Two independent reasons: `--strict` warns without it, and when it is absent Claude Code falls back to the git commit SHA, so every commit registers as a new version. Use `MAJOR.MINOR.PATCH`; `"1.0"` is not valid semver and will be flagged.

**Do not set component-path overrides** (`commands`, `agents`, `hooks`, `skills` keys pointing elsewhere). `skills` *adds* to the default scan, while `commands` and `agents` *replace* it — so an override on those silently stops the default directory loading, which is a permanent liability bought for a one-time convenience. Where one is unavoidable it must be relative and `./`-prefixed: neither `/Users/name/commands` nor `hooks/hooks.json` resolves.

`description` follows the same rule as a skill description: **match on the artifact produced, not the topic.** Name what the plugin makes, and avoid universal-quantifier phrasing (`even if they don't…`, `whenever the user mentions…`, `always use this`) — it inflates false triggers and crowds out co-installed plugins.

Also write `README.md`, `.gitignore`, and a `LICENSE`.

## Phase 6 — Implement

Each component type is owned by a sibling skill carrying its frontmatter, its failure modes and the measured loop showing whether it works. Load the one the Phase 3 table names rather than a one-line summary:

`../skill-creator/SKILL.md` · `../agent-creator/SKILL.md` · `../mcp-creator/SKILL.md` · `../command-creator/SKILL.md`

Hooks have no creator skill: written here, checked by the Phase 8 validator under `--target-type hooks`, audited by `hook-reviewer`.

The handoff runs the other way too, and decides which skill should have been loaded first. A request to add one component to a plugin that already exists — "add a hook to my plugin", "write a reviewer agent for this repo" — is that creator's work from the first turn. The plugin is the artifact again only when the manifest or the layout is wrong.

## Phase 7 — Validate

Two gates, each a loop rather than a single run.

**The validator.**

```bash
claude plugin validate <plugin-dir> --strict
```

Fix what it reports and run it again. Repeat until it comes back clean: fixing one error routinely uncovers the next, and the run that reports nothing is the only evidence that the manifest and the layout are sound.

**The reviewers.** The validator checks the manifest and the structure. It does **not** catch a dangling reference link, a hook command pointing at a missing file, a skill `name` disagreeing with its directory, a malformed `tools` value, a hardcoded absolute path, a grant whose `mcp__plugin_*` name cannot match, or a component silently ignored for sitting in the wrong directory. The read-only reviewer agents cover that gap. Run `plugin-reviewer` always, and each component reviewer matching something the plugin carries:

| The plugin carries | Run |
|---|---|
| the plugin itself — manifest, layout, anchoring, marketplace entry, cross-component names | `plugin-reviewer` |
| `skills/<name>/SKILL.md` | `skill-reviewer` |
| `agents/<name>.md` | `agent-reviewer` |
| `hooks/hooks.json`, or a `hooks:` block | `hook-reviewer` |
| `.mcp.json`, or an inline `mcpServers` | `mcp-reviewer` |
| an entry point whose value is a person typing `/name` | `command-reviewer` |

`plugin-reviewer` reviews the plugin *around* the components and hands each component-level finding to the reviewer that owns it, so the two layers never argue about one line; its coverage statement also names the reviewers you have not run. Each returns findings by severity with a concrete fix. Apply the Critical and Major ones, then re-run the validator *and* the affected reviewers — a fix that moves or renames a file changes what all of them see, so the last run has to follow the last change.

- [ ] `claude plugin validate --strict` reports nothing
- [ ] `plugin-reviewer` has been run and its coverage statement is satisfied
- [ ] Every component reviewer matching something the plugin carries has been run
- [ ] Every Critical and Major finding is fixed, or has a stated reason for staying
- [ ] All three gates were re-run after the final fix

Minor findings are a judgement call and can ship. If Phase 2 settled on a shared manifest, `--strict` is the flag that will reject it — decide that deliberately here rather than deleting fields to make the gate pass.

## Phase 8 — Verify

Two questions, and only one is a sample. Most of what matters about a plugin has a right answer, so check that half outright.

**Deterministic: does every component load, and does every path resolve?** Load the plugin from disk without installing it:

```bash
claude --plugin-dir /path/to/my-plugin
```

Then check the four listings — `/help`, `/agents`, `/hooks`, `/mcp` — for every component under the identifier you expect, folder scoping included; that each hook fires under `claude --debug`; that every path resolves from the installed location rather than yours; and that every component the README names is there under that name. Absent from a listing means not registered, a different fault from misbehaving, and those listings are the only place the difference shows. `references/verification.md` has the row-by-row version, with what a miss in each listing implies.

**Model-judged: do the components route correctly together?** Whether each fires on the right request is per-component measurement, and each sibling creator owns that loop — triggering for a skill or command, delegation for an agent, tool selection for an MCP surface. None of them sees **whether they collide**: two skills that each score well alone will split each other's triggers once co-installed, and neither author's numbers show it.

```bash
bun ../../shared/scripts/validate.ts --target-type skill <plugin>/skills/<name> --extended --with-environment
```

`--with-environment` is what reads the installed set; without it that half is skipped and says so. Run it per skill, including against the plugin's own siblings, since a pushy description crowds out the neighbours it shipped with. Then run each component's trigger set with the whole plugin installed rather than one at a time: a query written for one skill that fires another is a collision, invisible when the two are measured apart.

**Grade it rather than pass it.** Produce a row per component — does it load, does every path resolve, does it fire on its own queries, does it steal any — then a verdict naming the weakest component and the change that would raise it. Read `references/verification.md` before the first run: the collision procedure, the scorecard, and the two patterns that look identical in the numbers and want opposite fixes. Then loop, as in Phase 7 — a fix that renames or moves a component changes what both halves see.

## Diagnostics

Symptom to check, in the order worth trying. `plugin-reviewer` sweeps the first two classes across the whole tree at once, so reach for it rather than walking the tables by hand when more than one component is affected.

**A component does not load at all**

| Check | Detail |
|---|---|
| Location | Right directory, right extension, and **at the plugin root** — never inside `.claude-plugin/`, where components are ignored while `validate` still passes |
| Skill filename | Exactly `SKILL.md` — not `README.md`, not `skill.md` |
| Naming | kebab-case; a skill `name` matching its directory, no `:` in an agent `name`, and valid YAML between the `---` fences |
| Path override | A `commands` or `agents` key in the manifest replaces the default scan instead of adding to it |
| Enabled | Plugin is enabled in settings; restart Claude Code to reload. Missing only in Cowork means it is not enabled on the claude.ai account, which is the only place Cowork looks |

**Paths do not resolve**

| Check | Detail |
|---|---|
| Hardcoded, or the wrong anchor | Three anchors, not interchangeable; `references/path-anchors.md` says which this job wants and carries the token to copy |
| Manifest paths | Relative and `./`-prefixed — never absolute |
| Target exists | The file is there once the anchor is expanded |
| From inside a hook | `echo $CLAUDE_PLUGIN_ROOT` to see what it expands to |

**Manifest rejected by `validate`**

| Symptom | Fix |
|---|---|
| Invalid name — `"My Plugin"` | kebab-case: `"my-plugin"` |
| Invalid version — `"1.0"` | `"1.0.0"` |
| Version warning under `--strict` | Add `version`, or the git SHA becomes it |
| Path error — `"/Users/name/commands"` | Relative: `"./commands"` |
| Path error — `"hooks/hooks.json"` | Add the prefix: `"./hooks/hooks.json"` |

**A skill exists but never triggers.** A description defect rather than a manifest one, so it leaves this skill: `../skill-creator/SKILL.md` owns the criteria and the loop showing whether a rewrite helped, and `skill-reviewer` audits a description without changing it. Carry one thing across, invisible from inside the skill — a neighbour with pushy universal-quantifier phrasing absorbs triggers belonging elsewhere, so run the Phase 8 collision check before rewriting anything.

**Two plugins collide.** Give components unique, descriptive names; namespace with the plugin name where a clash is plausible; document known conflicts in the README.

## Finish

Report what was created — the plugin name and purpose, each component and what it does, and the resulting tree. Then state what is left: verification not yet done, which of the Phase 2 surfaces this artifact actually reaches, and directory submission if the user wants it, remembering that the two directories are separate submissions.
