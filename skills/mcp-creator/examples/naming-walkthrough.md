# Worked example: `acme-devtools`, four servers, every derived name

`plugin-mcp.json` in this directory is a complete, valid plugin `.mcp.json`. This file annotates it and then derives every name that has to agree with it: tool names, an `allowed-tools` grant, a subagent grant, a permission rule, a hook's `server` field, and the README stanza that keeps the whole thing installable by somebody else.

The plugin is called **`acme-devtools`**. That name is not decoration — it is an infix in every tool name below, and changing it changes all of them.

## Table of Contents

- [The manifest it assumes](#the-manifest-it-assumes)
- [The four servers, and why each is shaped that way](#the-four-servers-and-why-each-is-shaped-that-way)
- [The derived tool names](#the-derived-tool-names)
- [The grant that looks right and matches nothing](#the-grant-that-looks-right-and-matches-nothing)
- [The same names in three other places](#the-same-names-in-three-other-places)
- [The README stanza](#the-readme-stanza)

---

## The manifest it assumes

`.claude-plugin/plugin.json`, trimmed to the parts the MCP config depends on:

```json
{
  "name": "acme-devtools",
  "version": "0.3.0",
  "description": "Issue search, code index and sprint metrics for Acme repositories",
  "userConfig": {
    "trackerToken": {
      "type": "string",
      "title": "Issue tracker token",
      "description": "Personal access token for tracker.acme.example.com. Needs the issues:read and issues:write scopes.",
      "sensitive": true,
      "required": true
    },
    "tenantId": {
      "type": "string",
      "title": "Acme tenant id",
      "description": "The tenant slug in your Acme console URL, e.g. 'northwind'.",
      "required": true
    }
  }
}
```

`sensitive: true` on the token routes it to secure storage instead of plaintext on disk. `tenantId` is not a secret, so it is a plain prompted string. Both are reachable from `.mcp.json` as `user_config` placeholders.

---

## The four servers, and why each is shaped that way

### `issue-tracker` — remote, credentials from the manifest

```json
"issue-tracker": {
  "type": "http",
  "url": "${ACME_TRACKER_URL:-https://tracker.acme.example.com/mcp}",
  "headers": {
    "Authorization": "Bearer ${user_config.trackerToken}",
    "X-Acme-Tenant": "${user_config.tenantId}"
  }
}
```

`http` because it is remote, and `http` is the recommendation for remote. The URL carries a default so the entry works unconfigured against production, while `ACME_TRACKER_URL` lets someone point it at staging without editing a shipped file — a default is right here precisely because a hostname is not a secret.

The token comes from `user_config`, which is the strategy that asks least of the user: they are prompted once, in a UI, rather than reading the README to learn which variable to export. Note what is *not* here — no literal token, and no `:-` fallback on the token, because a default secret is a committed secret.

### `repo-index` — local process, bundled code, its own state

```json
"repo-index": {
  "type": "stdio",
  "command": "bun",
  "args": [
    "${CLAUDE_PLUGIN_ROOT}/servers/repo-index/index.ts",
    "--root", "${CLAUDE_PROJECT_DIR}"
  ],
  "env": {
    "REPO_INDEX_CACHE": "${CLAUDE_PLUGIN_DATA}/repo-index",
    "REPO_INDEX_LOG": "${ACME_LOG_LEVEL:-warn}"
  },
  "alwaysLoad": true
}
```

Three anchors, three jobs, and swapping any two is a bug:

- `CLAUDE_PLUGIN_ROOT` locates **shipped code**. It is read-only and replaced wholesale on update.
- `CLAUDE_PROJECT_DIR` is the **user's repository** — the thing being indexed.
- `CLAUDE_PLUGIN_DATA` is where the index **cache** goes, because it survives updates. Writing the cache under the plugin root would silently discard it on every upgrade.

`command` is the bare `bun` rather than a path, which is a deliberate bet that the user has Bun on their `PATH` — recorded in the README below. The bet is worth naming because it has a way out: `bun build --compile` turns that same entry point into a single-file executable, and pointing `command` at the compiled artifact under `${CLAUDE_PLUGIN_ROOT}` removes the runtime requirement altogether at the cost of shipping one binary per platform. Read `../../../shared/references/pure-bun.md` when you take that route, for the compile targets and what the artifact still needs. `alwaysLoad: true` because code search should be available on the first turn without the user asking for it by name; the other three stay lazy.

`ACME_LOG_LEVEL` has a default, so the entry is complete without it.

### `metrics-api` — a computed header and a configured one, side by side

```json
"metrics-api": {
  "type": "http",
  "url": "https://metrics.acme.example.com/mcp",
  "headers": { "X-Acme-Tenant": "${user_config.tenantId}" },
  "headersHelper": "bun \"${CLAUDE_PLUGIN_ROOT}/scripts/mint-metrics-token.ts\""
}
```

This is the shape the plugin-specific `headersHelper` constraint forces, and it is normal rather than a workaround. The bearer token is short-lived and has to be minted per connection, so it comes from the helper. The tenant id comes from the manifest — and it *cannot* come from the helper, because `headersHelper` is shell-parsed and a `user_config` reference inside it arrives unexpanded, producing a header whose value is literal placeholder text.

The plugin path anchors do resolve inside `headersHelper`, which is how the bundled script is addressable at all. The path is quoted, because an unquoted one breaks on the first install directory containing a space.

The helper receives `CLAUDE_CODE_MCP_SERVER_NAME` and `CLAUDE_CODE_MCP_SERVER_URL`, so one script can serve several entries, and it prints a JSON object on stdout:

```json
{ "Authorization": "Bearer eyJhbGciOi..." }
```

### `docs-search` — OAuth, so no credential at all

```json
"docs-search": {
  "type": "http",
  "url": "https://docs.acme.example.com/mcp"
}
```

The whole entry. The server does OAuth, so the user authenticates from `/mcp` or with `claude mcp login docs-search`, and Claude Code stores and refreshes the tokens. Best posture of the four options and the least configuration to get wrong — reach for it whenever the server supports it.

---

## The derived tool names

Template: `mcp__plugin_<plugin>_<server>__<tool>`, then every character outside `A-Za-z0-9_-` replaced with `_`.

| Server | Tool it exposes | Name every grant must use |
|---|---|---|
| `issue-tracker` | `search_issues` | `mcp__plugin_acme-devtools_issue-tracker__search_issues` |
| `issue-tracker` | `get_issue` | `mcp__plugin_acme-devtools_issue-tracker__get_issue` |
| `issue-tracker` | `create_issue` | `mcp__plugin_acme-devtools_issue-tracker__create_issue` |
| `issue-tracker` | `comment_on_issue` | `mcp__plugin_acme-devtools_issue-tracker__comment_on_issue` |
| `repo-index` | `find_symbol` | `mcp__plugin_acme-devtools_repo-index__find_symbol` |
| `repo-index` | `search_code` | `mcp__plugin_acme-devtools_repo-index__search_code` |
| `metrics-api` | `query_timeseries` | `mcp__plugin_acme-devtools_metrics-api__query_timeseries` |
| `metrics-api` | `get_sprint_metrics` | `mcp__plugin_acme-devtools_metrics-api__get_sprint_metrics` |
| `docs-search` | `search_docs` | `mcp__plugin_acme-devtools_docs-search__search_docs` |

Nothing was sanitized here, because every name in this config is already made of letters, digits, hyphens and underscores. That is the reason to choose such names: you never have to derive anything, and the string you read in the config is the string you write in the grant.

Had the server been keyed `metrics.api` instead, the same tool would be `mcp__plugin_acme-devtools_metrics_api__query_timeseries` — dots become underscores — and the config and the grant would no longer look alike. Which is also why a plugin must not ship both `metrics.api` and `metrics_api`: after sanitization they are one namespace.

---

## The grant that looks right and matches nothing

A skill inside this plugin, `skills/triage/SKILL.md`:

```yaml
---
name: triage
description: "..."
allowed-tools: mcp__issue-tracker__search_issues mcp__issue-tracker__get_issue Read
---
```

This is what you get by copying a working grant out of a standalone setup, or out of the server's own README. It is valid YAML, valid frontmatter, and the skill loads. The server connects. The tools work. And the grant applies to nothing, so every call prompts for permission — because those names are the *user-configured* form, and inside a plugin the names carry a `plugin_acme-devtools_` infix.

Correct:

```yaml
---
name: triage
description: "..."
allowed-tools: mcp__plugin_acme-devtools_issue-tracker__search_issues mcp__plugin_acme-devtools_issue-tracker__get_issue Read
---
```

Long, and unavoidably so. The difference between the two is nine characters in the middle of a token, which is why this is the defect that survives review.

Remember what an `allowed-tools` grant is: permission-free use for the turn that invoked the skill, cleared on the next user message. It is not a standing grant, so a wrong name shows up as "it still asks me every time" rather than as an error.

---

## The same names in three other places

**A subagent in this plugin**, `agents/sprint-analyst.md` — the wildcard form works here:

```yaml
tools: ["Read", "Grep", "mcp__plugin_acme-devtools_metrics-api__*", "mcp__plugin_acme-devtools_issue-tracker__search_issues"]
```

Whole-server access to metrics, one specific tool from the tracker, and no write access to issues — an analyst has no business calling `create_issue`.

**A settings permission rule** takes the server prefix to mean the whole server:

```json
{ "permissions": { "allow": ["mcp__plugin_acme-devtools_docs-search"] } }
```

**A hook's `mcp_tool` handler** addresses the server with a completely different form — colon-separated, no `mcp__`, tool in its own field:

```json
{
  "type": "mcp_tool",
  "server": "plugin:acme-devtools:repo-index",
  "tool": "search_code",
  "input": { "query": "TODO(security)" }
}
```

That is the handler object only; the event and matcher around it belong to `hooks.json` and to the hook-creator skill. The point here is the `server` value: `plugin:acme-devtools:repo-index` and `mcp__plugin_acme-devtools_repo-index` name the same server, and neither string works where the other is expected.

---

## The README stanza

A required variable the README does not mention is a support ticket with a delay fuse. Every value a user must supply, and every runtime they must already have:

```markdown
## Setup

Run `/plugin configure acme-devtools` and provide:

| Setting | Required | What it is |
|---|---|---|
| Issue tracker token | yes | Personal access token for tracker.acme.example.com, with `issues:read` and `issues:write` |
| Acme tenant id | yes | The tenant slug in your console URL, e.g. `northwind` |

Optional environment variables:

| Variable | Default | Effect |
|---|---|---|
| `ACME_TRACKER_URL` | `https://tracker.acme.example.com/mcp` | Point the tracker at staging |
| `ACME_LOG_LEVEL` | `warn` | Verbosity of the local code index |

`docs-search` uses OAuth — run `/mcp`, select `docs-search`, and authorize in the
browser. No token to paste.

The `repo-index` server runs on Bun, which must be on your `PATH`. Check the
whole set with `claude mcp list`, and any one server with `claude mcp get <name>`.
```

Note what the table does not contain: any value that is itself a secret. The README says which secrets are needed and where they come from. It never carries one.
