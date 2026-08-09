---
name: mcp-creator
argument-hint: "[which server to wire in, or which tool surface to shape]"
allowed-tools: Read, Grep, Glob
model: opus
metadata:
  component-type: mcp-server
license: MIT
compatibility: "Claude Code — the CLI, the IDE extensions, and Claude Desktop's Code and Cowork tabs; an `http` server also reaches claude.ai and the API. Bun runs any server or helper script this skill writes; no other runtime is required."
description: |
  Use when the deliverable is MCP wiring inside Claude Code — a `.mcp.json` or manifest `mcpServers` entry, choosing stdio vs http/sse, keeping tokens out of committed files (env vars, `userConfig`, OAuth, `headersHelper`), resolving scope/precedence conflicts between user, project and plugin entries, fixing a permission or `allowed-tools` grant whose `mcp__plugin_*` tool name matches nothing, or debugging a server that connects but is never used. Also use for shaping the tool surface a server advertises: tool names, descriptions the model routes on, input schemas, response size, and error text. Not for writing the server's implementation code (mcp-builder), not for read-only audits (mcp-reviewer), and not for scaffolding skills, subagents, hooks, commands, or plugin structure. Not for repackaging a server into a different distribution format such as an MCPB/desktop-extension bundle — that is a separate artifact, not a config edit.
---

# MCP Creator

Two artifacts, failing in different ways.

The **configuration** — a `.mcp.json` entry, its transport, its credentials — is a small JSON object with about eight keys, and almost nobody gets the schema wrong. What they get wrong is the *name* the rest of Claude Code knows the server by, and *where the credential lives* once the plugin is on somebody else's machine.

The **tool surface** — the names, descriptions and schemas the server advertises — is a routing surface with exactly the failure modes of a skill description. Too vague and the model never reaches for the tool; too greedy and it reaches for it on everything. This is the half authors skip, and the half that decides whether the server is worth anything once it connects.

Work out which half the user is on. "It connects but Claude never uses it" is the second. "My `allowed-tools` grant does nothing" is the first, and it is nearly always the naming section below. The config half runs in order, and it is worth putting on a todo list: pick the home, pick the transport, derive the tool names every grant has to match, decide where the credential comes from, connect and read `/mcp`, run the pre-flight until it is clean, then measure. Only the first two are expensive to change later. On vocabulary: "transport" and "environment variable" are safe with anyone who has got this far; "handshake", "OAuth flow" and "namespace" want a five-word gloss the first time. "Connector" is claude.ai's word for a remote MCP server, so a user asking for a connector usually wants an `http` entry that also works outside Claude Code.

---

## Gotchas

Five facts that defy a reasonable assumption. Every one fails quietly rather than erroring, so read them now — none announces itself when you hit it, and each is expanded in the section it belongs to.

- **A plugin's tool names carry an infix**: `mcp__plugin_<plugin>_<server>__<tool>`, not `mcp__<server>__<tool>`. A grant copied out of the server's own README is valid, matches nothing, and prompts for permission every time instead of erroring.
- **An unset environment variable with no default does not fail.** The entry loads with the placeholder's own characters as the value, plus a warning. The server replies 401 and it reads as a credential problem.
- **Precedence replaces whole entries and never merges fields.** A user-scope entry carrying only a `url` deletes the `headers` a plugin entry of the same name had.
- **`headersHelper` cannot see `user_config` values.** It is shell-parsed, so the reference arrives unexpanded and the header is sent as literal placeholder text.
- **A `stdio` server is silently absent on web and mobile.** No error; its tools are simply not in the model's tool list, and the user reports that Claude got it wrong on their phone.

---

## Decide the home before writing anything

Where the entry lives changes the tool names, the credential options, and who has to trust it. Settle it first, because retrofitting means rewriting every grant.

A **plugin** carries the server in a `.mcp.json` at its root, or inline as `mcpServers` in the manifest when a second file feels like overhead. A committed **project** `.mcp.json` gives everyone on the repo the same server. **User scope** (`claude mcp add`) is one person across every project; **local scope** is what you would not commit. Only the plugin homes produce the `mcp__plugin_*` tool names, and only they can prompt for credentials through the manifest.

Wiring a server into a plugin that already exists is this skill's job end to end, including the edit to its `.mcp.json`; `../plugin-creator/SKILL.md` owns the manifest and directory tree around it, not the entry.

Read `references/server-entry.md` once you know which home you are writing into — every location with its scope marker, and the field-by-field list per transport. Writing an entry from memory is how a field lands on a transport that ignores it: a silent no-op rather than a validation error.

---

## Choosing a transport

| `type` | Address field | Use it for |
|---|---|---|
| `stdio` | `command` (plus `args`, `env`) | A local process. A server this plugin writes is `bun` on a bundled TypeScript entry point, or a `bun build --compile` binary when the user should need no runtime |
| `http` | `url` | Anything remote — the recommendation. Also accepted as `streamable-http` |
| `sse` | `url` | Deprecated, still supported. Correct only when the server offers nothing else |
| `ws` | `url` | A server that speaks only WebSocket |

An inherited `sse` entry is not broken and needs no emergency fix — but a server publishing both an `sse` and an `http` endpoint is telling you which one it intends to keep. Change the `type`, point `url` at the streamable endpoint; nothing else moves.

### Where this ships

That table is also the distribution decision, so make it with the destination in view. An `http` server reaches every surface — Claude Code, all three Claude Desktop tabs, claude.ai on the web, mobile, and the API. A `stdio` server runs a local process, so it reaches Claude Code and Claude Desktop and is silently absent on web and mobile. Two things do not travel: as Desktop reads a plugin `.mcp.json` it takes `type` rather than `transport` and reads only `url`, `headers` and `oauth`, so a computed header arrives unauthenticated there; and Desktop's Chat tab takes no plugin at all, so a server aimed at it ships as an MCPB bundle rather than a repackaging.

Read the transport decision tree in `references/server-entry.md` when the choice is not obvious from the table — it runs the local-process question and the which-surfaces question together, because they are one decision. Read `../../shared/references/distribution-targets.md` when the answer has to hold for a surface you cannot test from here: the matrix, the MCPB manifest, and the two directory submissions.

---

## The tool name is not what you think it is

The single most common reason a plugin's `allowed-tools` grant or permission rule silently matches nothing. Nothing errors: the grant is syntactically fine, the server connects, the tool works — it just prompts for permission every time, because the string being granted names a tool that does not exist.

A server the **user** configured produces tools named:

```
mcp__<server-name>__<tool-name>
```

A server **bundled in a plugin** produces:

```
mcp__plugin_<plugin-name>_<server-name>__<tool-name>
```

then every character outside `A-Za-z0-9_-` in that string is replaced with `_`.

Worked, for a plugin `acme-devtools` holding a server `issue-tracker` exposing `search_issues`: substituting gives `mcp__plugin_acme-devtools_issue-tracker__search_issues`, and sanitizing leaves it unchanged, since hyphens are inside `A-Za-z0-9_-`.

Sanitizing bites only when a name carries something else: a server keyed `metrics.api` exposing `query.run` in that plugin gives `mcp__plugin_acme-devtools_metrics_api__query_run`. Which is also a warning — after sanitizing, `metrics.api` and `metrics_api` are the same server to every grant, so do not ship both.

The two forms differ by an *infix*, not a prefix, which is why `mcp__issue-tracker__search_issues` looks entirely plausible inside a plugin and is exactly what a standalone setup or the server's own README hands you.

### The same server, named three other ways

None substitutes for another: a subagent grant takes `mcp__plugin_<plugin>_<server>__*`, a settings permission rule takes the bare prefix to mean the whole server, and a hook's `mcp_tool` handler writes `plugin:<plugin>:<server>` in its `server` field — colon-separated, no `mcp__` at all, because a hook addresses the *server* and names the tool separately. Read the resource-reference form off `/mcp` rather than deriving it; it is the one form this plugin has not verified end to end for a plugin-bundled server.

Read `examples/naming-walkthrough.md` before writing any of these strings, rather than after one fails to work: it derives all of them from a real four-server config and puts the grant that looks right and matches nothing beside the one that works. They differ by nine characters in the middle of a token, which is why eyeballing a grant does not catch it.

---

## Credentials in a plugin that ships to other people

A plugin lands on machines you will never see, so "it works on mine" is not a strategy. There is a default here rather than a choice of four: **OAuth wherever the server offers it**, which puts no credential in your repo or theirs and leaves Claude Code to store and refresh the tokens; failing that, **`userConfig` in the plugin manifest**, which prompts the user once in a UI, schema-validates the answer, and with `sensitive: true` keeps it out of plaintext on disk. Reach past those two only for a value that is not a secret — a base URL, a region — where an environment variable with a `:-` fallback is simpler. An entry with no credential field at all is what the first option looks like, not an oversight.

`headersHelper` sits alongside all of them rather than among them: a command run at connection time that prints a JSON object of headers, for a value computed fresh per connection — a short-lived token, a request signature, a credential-store lookup. Because it is shell-parsed it cannot see `user_config` values, so a plugin normally splits its headers across both, configured values in `headers` and computed ones in the helper. That is the shape, not a workaround.

Read the credential section of `references/server-entry.md` once you have picked a source — the `userConfig` option schema, what each source costs a user who is not you, and the README obligation an environment variable creates. Guessing that schema is how a `user_config` reference ends up naming a key the manifest never declares: it resolves to nothing, prompts nobody, and surfaces as a connection error pointing at nothing.

**What never goes in the file.** A token, key, password or signed URL written literally into `.mcp.json` or `plugin.json` is committed the moment the repo is, and git history keeps it after deletion, so recovery is rotation rather than a follow-up commit. The check is mechanical: every credential-shaped value is a placeholder, and the README names each variable the user must supply — an omitted one is a support ticket with a delay fuse, and `mcp-reviewer` cross-checks exactly that.

---

## Interpolation, and the failure that does not fail

Environment-variable placeholders — the dollar-brace form, and the same form carrying a `:-` fallback — resolve in `command`, `args`, `env`, `url` and `headers`; the plugin path anchors resolve in those five plus `headersHelper`. Read the grid in `references/server-entry.md` before putting a placeholder in any other field: one outside the grid is inert, and inert here means literal text sent to a server rather than an error you can see.

Copy the braced forms from `references/server-entry.md` or `examples/plugin-mcp.json` rather than from this body, which names the placeholders instead of printing them: a skill body is injected with shell-style substitution applied, so a braced token written here can arrive with a value already pasted in — precisely the mistake this section exists to prevent.

The behaviour worth internalising is an unset variable with no default:

```
Input:   a header whose value is the placeholder for an unset ACME_TRACKER_TOKEN
Output:  that placeholder text sent verbatim as the header value, plus a warning
```

### Paths for a `stdio` command

The `command` runs on the user's machine from a working directory you do not control, so a bare relative path points into whatever project the user is sitting in — it may not exist, or worse, may exist and be something else. A path into the plugin's own files uses the plugin-root anchor, quoted. Copy the literal token from `../plugin-creator/references/path-anchors.md`, which is read rather than injected and so carries it unexpanded. Read the command-resolution table in `references/server-entry.md` when `command` is anything other than a bundled script — absolute paths, bare binaries on `PATH` and package runners each fail on somebody else's machine in a different way, and the table says which cost you are choosing.

---

## Scope, precedence, and trust

Highest wins, first match:

```
local  →  project .mcp.json  →  user  →  plugin  →  claude.ai connectors
```

The first three match by **server name**, the last two by **URL or endpoint**. The decisive detail: the winning source supplies the **whole entry**, and fields are never merged. A user-scope entry named `issue-tracker` carrying only a `url` completely replaces a plugin entry of that name that had `url`, `headers` and a `timeout` — the headers are not inherited, they are gone, and debugging that as "my headers stopped working" goes nowhere until you know precedence is entry-level. `claude mcp get <name>` prints which source won. It is also the argument for naming a plugin's servers distinctively: one called `github` or `postgres` is eventually shadowed by a user-scope entry on somebody's machine, and neither of you intended it.

**Workspace trust.** A project `.mcp.json` does not connect in an interactive session until the user accepts trust for that workspace — a repo you just cloned should not be able to start processes at you. Headless sessions load it without prompting, and that asymmetry reads both ways: a server that "only works in CI" is usually a trust prompt nobody saw, and behaving in CI is no evidence it behaves for a human.

**`alwaysLoad` and lazy connection.** Claude Code can defer connecting until something needs the server, which keeps startup fast — at the cost that an unconnected server's tools are not in the model's tool list, and the model cannot choose a tool it cannot see. `alwaysLoad: true` connects at session start instead. Reach for it when a tool must be discoverable on the first turn without being named; leave it off for a server that is occasional, slow to start, or behind an auth prompt.

---

## Verify

```bash
claude mcp list          # every configured server and its scope
claude mcp get <name>    # the resolved entry for one server, and which source won
```

Then `/mcp` in a session for the interactive view — per-server state, tools, resources, and an authenticate option where the server wants one. A lazily-connected server shows nothing until something uses it, so an absent tool list is not by itself a fault.

Read the state table in `references/server-entry.md` when a server sits in any state other than connected. Each of the four says something different about where the fault is, and the guesses they invite are wrong in expensive ways: "connected" is routinely read as "granted", and "not listed" as a parse error when it is usually a higher-precedence scope having replaced the entry.

**Resources**, where a server exposes them, are referenced as `@server:protocol://path` and pull their content into context — material the model should read rather than call, costing nothing until named.

---

## Designing the tool surface

A tool's name, description and input schema are the entire basis on which the model decides to call it — the job a skill description does, under the same constraints and with the same two failure modes, so the discipline transfers directly. Read `../../shared/references/description-writing.md` before writing tool descriptions: match on the concrete thing the tool returns rather than the topic it concerns, exclude the same-domain case belonging to a neighbouring tool, and expect a vague description to *lose* to a specific one rather than merely underperform.

Three problems specific to tool surfaces:

- **Chatty APIs make bad tool surfaces.** An API needing four calls to answer one question becomes four tools the model must chain correctly every time or fail. Consolidate toward the question the user actually asks and let the server chain, where it is code rather than four model judgements.
- **Response shape is a context bill.** A tool returning the upstream API's full JSON spends thousands of tokens per call on fields nobody reads, for the rest of the session. Return what the model acts on, paginate with an opaque cursor and a stated total, and when you truncate say so in the payload — silent truncation makes the model confident about an incomplete answer.
- **Errors are instructions.** `Error: 422` tells the model nothing, so it retries the same call. `No project matches "platform". Available: platform-web, platform-api. Retry with an exact name.` tells it what to do differently, and it does.

Read `references/tool-surface.md` when you can edit the server's own source and are writing or revising its tool names, descriptions, schemas or responses — a before/after pair for each of the three above, the input-schema rules, and the per-tool checklist. Working from the summary here instead is how a surface ends up with a free-form `object` parameter standing in for a schema, which moves the routing information to somewhere the router cannot see it.

Where the server is somebody else's, none of that is a lever you hold. Two remain: narrow the grant so there are fewer wrong tools to pick from, and put routing guidance in the body of the skill fronting the server ("to find an issue use `search_issues`; there is no need to list projects first").

---

## Pre-flight

```bash
claude plugin validate <plugin-dir> --strict
```

Fix what it reports and run it again, until it exits clean. Then run the `skill-creator:mcp-reviewer` agent on the plugin or config directory and close the same loop: apply the findings, re-run the agent, repeat until the verdict is PASS. It reads and never edits, and concentrates on what `validate` passes over: a grant whose tool name cannot match the server's namespace, a committed secret, a `command` that does not resolve, an unset variable with no default, a `headersHelper` reaching for `user_config`, tool descriptions failing the routing criteria. Treat a FAIL as gating the measurement below, since every finding would otherwise cost a full iteration to discover. A static audit cannot tell you whether the surface *works*, which is what the next section is for.

---

## Measure: does the grant match, and does the model pick the right tool?

Two halves, and only one is a sample. Getting that backwards is the usual mistake — authors sample the half with a right answer and eyeball the half that varies.

**Deterministic: the grant names.** Whether a grant's `mcp__plugin_*` string names a tool the server actually exposes is a string comparison with a right answer, so check every grant rather than a sample. Derive each name as above, sanitize it, and compare against the real list from `/mcp` or the server's own tool registration. A mismatch is a defect, not a low score — and `mcp-reviewer` performs this derivation, so the pre-flight above closes this half with nothing left to re-run.

**Model-judged: tool selection.** Given the descriptions the server advertises, does the model pick the right tool for a task? A routing decision, measurable the way skill triggering is and more directly, since the transcript carries the tool call itself rather than a consult to interpret.

Synthesize from the tool list and the schemas, never from the descriptions you are about to change: scenarios drawn from a description certify it against itself, and a capability the descriptions omit produces no scenario, is never penalized, and is the defect you were hunting. The scenario builder in `../../shared/scripts/` stops before generating, so you can correct its reading first:

```bash
bun ../../shared/scripts/synthesize-scenarios.ts \
  --target <path-to-.mcp.json> --target-type mcp --inventory-only
```

It finds a tool list only where the entry points at a local implementation it can follow — a `.mcp.json` says how to *reach* a server, not what it exposes — and says so when it cannot, in which case paste in the `/mcp` listing. Put the inventory in front of the user first: a capability they confirm that no description mentions is a finding before a single scenario runs.

Then run each scenario headless several times, since selection is sampled and one run says almost nothing, and select on a held-out split rather than on the scenarios that motivated the rewrite. Read `references/tool-surface.md`, section "Measuring whether the surface routes", before that first run — hard-negative sources, the run command, and why the description loop in `../../shared/scripts/` is not a drop-in here. `../../shared/references/running-detached.md` covers launching a long run so it survives the turn that started it.

**Grade it rather than count it.** One rate over the whole set hides which tool is failing. The result worth producing is a per-tool row — how often its own scenarios chose it, which tool won when it lost, how often it was picked for a hard negative — and then a verdict naming the weakest tool and the change that would raise it. The next section of that same file, "The scoring pass", has the columns and what each failure pattern asks for.

---

## Bundled files

- `references/server-entry.md` — open it while writing or debugging an entry: every location with its scope marker, the fields for each transport, a transport decision tree, `stdio` command resolution, the interpolation grid, the four credential sources and what each costs, precedence, and the naming derivations side by side
- `references/tool-surface.md` — open it when you can edit the server's own source and are shaping the tools it advertises: naming, descriptions as a routing surface, input schemas, responses, errors, consolidation, the per-tool checklist, and the loop that measures whether the model picks the right tool, with its scorecard
- `examples/plugin-mcp.json` — copy from it when you are writing a plugin's first entry: four servers across two transports and four credential strategies, all valid
- `examples/naming-walkthrough.md` — read it before writing a grant: every derived name from that config, including the grant that looks right and matches nothing

Cross-skill: `../../shared/references/description-writing.md` (before writing tool descriptions), `../../shared/references/plugin-skills.md` (when a credential comes from `userConfig`), `../plugin-creator/references/path-anchors.md` (for the literal path-anchor tokens), `../../shared/references/distribution-targets.md` (when the server has to reach a surface beyond Claude Code).
