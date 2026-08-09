# Skills inside a Claude Code plugin

A skill bundled in a plugin is the same artifact as a standalone one — same `SKILL.md`, same frontmatter, same taxonomy. What changes is where it lives, how it is discovered, how you test it, and how it is distributed.

---

## Layout

```text
my-plugin/
├── .claude-plugin/
│   └── plugin.json          # the manifest — must be in this directory
├── skills/
│   └── my-skill/
│       ├── SKILL.md         # required, one per skill directory
│       ├── references/
│       └── scripts/
├── agents/                  # optional
└── hooks/
    └── hooks.json           # optional
```

Two structural invariants, both load-bearing and both easy to get wrong:

1. **The manifest goes in `.claude-plugin/plugin.json`.** Claude Code will not recognize a plugin without it in that exact location.
2. **Every component directory sits at the plugin root, *not* nested inside `.claude-plugin/`.** This is the mistake people actually make, and the failure is silent: components misplaced under `.claude-plugin/` are ignored, and `claude plugin validate` reports the plugin as passing.

Use kebab-case for directory and file names throughout. The manifest's `name` must match `/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/`.

---

## Auto-discovery

Claude Code scans `skills/` for subdirectories containing a `SKILL.md`, loads each skill's `name` and `description` always, loads the body when the skill triggers, and loads bundled files on demand. No registration step, no manifest entry required.

Inside a plugin, `name` behaves differently than it does for a personal or project skill: it sets the last segment of the invocation path, so `my-plugin/skills/review/SKILL.md` carrying `name: fancy` is invoked as `/my-plugin:fancy`.

---

## Local testing

```bash
claude --plugin-dir /path/to/my-plugin
```

Then ask something that should trigger the skill and check that it loads. Note the binary is `claude`. Some published documentation shows `cc --plugin-dir`, which is wrong — on macOS `cc` is Apple's C compiler, and running that command invokes a C compiler with an unrecognized option.

`claude plugin validate <path> --strict` is the first-party checker. It validates the manifest *and* walks the component directories, checking skills, agents, commands and hooks. Use it rather than hand-rolling equivalent checks; `--strict` promotes warnings to errors for CI. Its real gaps, which are worth checking by hand or by agent, are: hook command targets that do not resolve, dangling reference links from SKILL.md, secrets committed in config, MCP URLs over plain HTTP, and components misplaced under `.claude-plugin/`.

---

## No packaging

Plugin-bundled skills are distributed as part of the plugin. There is no zip step, no `.skill` file — users get the skills when they install the plugin. `../tools/package-skill.ts` is for standalone skills only.

---

## `commands/` is a legacy format

For a new plugin, a user-invoked slash command should be a skill in `skills/<name>/SKILL.md`, not a file in `commands/`. Both load identically; the only difference is file layout. `commands/` remains an acceptable legacy alternative, so keep using it in a plugin that already does — but do not start there.

A user-invoked skill carries `description`, and optionally `argument-hint` and `allowed-tools`, and its body is written as instructions *for Claude*, not prose addressed to the user.

---

## Manifest

Only `name` is required. A one-field manifest is a working plugin:

```json
{ "name": "my-plugin" }
```

Everything else — `version`, `description`, `author`, `homepage`, `repository`, `license`, `keywords` — is optional metadata for display and distribution. Anthropic's own `plugin-dev` plugin ships four fields and no `version`, which is a better guide to what matters than the aspirational lists in its documentation.

**Component path fields do not all behave the same way, and this is the single most commonly mis-documented thing about plugin manifests.** The `skills` path field **adds** to the default scan; `commands`, `agents` and `workflows` **replace** it.

```json
{
  "name": "my-plugin",
  "commands": ["./commands/ci", "./commands/admin"]
}
```

Under replace semantics, the default `./commands/` scan no longer runs — components sitting there stop loading. Anthropic's `plugin-dev` documentation asserts the opposite ("custom paths supplement defaults — they don't replace them") in four separate places and is wrong; it also omits the `skills` field entirely, which is the one field whose behaviour genuinely *is* additive. Reasoning from that text will mispredict what loads.

Path rules: relative only, must start with `./`, no `../`, forward slashes even on Windows.

### User-configurable values

Declare them as `userConfig` in the manifest rather than inventing a settings file. Options are schema-validated, surfaced through `/plugin configure <plugin>` and `/plugin manage`, and values marked `sensitive` are routed to secure storage instead of sitting in plaintext on disk.

```json
{
  "userConfig": {
    "apiKey": {
      "type": "string",
      "title": "API key",
      "description": "Token used for the upstream service",
      "sensitive": true,
      "required": true
    }
  }
}
```

`type` is one of `string`, `number`, `boolean`, `directory`, `file`. `type`, `title` and `description` are required — `claude plugin validate` errors on a missing `title`. `required`, `sensitive` and `default` are optional.

Older material teaches a hand-rolled `.claude/<plugin>.local.md` file parsed with `sed` and `grep`. That predates `userConfig` and leads authors into storing secrets in plaintext. Use `userConfig`.

---

## Hooks

One non-obvious constraint that will bite: **hook behaviour cannot be hot-swapped within a session.** Changing hook configuration requires a Claude Code restart, so a skill that tells the user to edit a hook and try again needs to tell them to restart too.
