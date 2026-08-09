# Frontmatter portability: the open standard, runtime extensions, and which ones fail open

Read this when the question is *what survives leaving Claude Code* — packaging an artifact for claude.ai or the Skills API, deciding whether a frontmatter flag can be trusted to hold on someone else's runtime, or explaining why a working skill fails the standard's own validator. For *which field to set* on a particular artifact, read that artifact's own frontmatter reference; they partition rather than overlap.

Frontmatter has two layers that look identical in a file and behave very differently across runtimes. Knowing which layer a field belongs to is the difference between an artifact that degrades gracefully elsewhere and one that silently loses a guardrail.

---

## Layer 1 — the Agent Skills open standard

The standard defines **exactly six fields**. This list is closed.

| Field | Required | Constraints | Purpose |
|---|---|---|---|
| `name` | **yes** | 1-64 chars; lowercase alphanumerics and hyphens only; no leading or trailing hyphen; no `--`; must match the parent directory name | Skill identifier |
| `description` | **yes** | 1-1024 chars, non-empty | What the skill does *and when to use it* — the trigger surface |
| `license` | no | short: a license name, or the name of a bundled license file | License covering the skill |
| `compatibility` | no | 1-500 chars | Environment requirements: intended product, system packages, network access |
| `metadata` | no | map of string to string | **The sanctioned escape hatch** — "clients can use this to store additional properties not defined by the Agent Skills spec" |
| `allowed-tools` | no | space-separated string. Marked **Experimental**: "support for this field may vary between agent implementations" | Tools pre-approved to run, e.g. `Bash(git:*) Read` |

Everything else you will see in the wild — `when_to_use`, `version`, `argument-hint`, `arguments`, `user-invocable`, `disable-model-invocation`, `model`, `effort`, `context`, `agent`, `background`, `hooks`, `paths`, `shell`, `disallowed-tools` — is a runtime extension.

The file itself must open with `---`-delimited YAML frontmatter, and that frontmatter must be a YAML mapping.

---

## Layer 2 — Claude Code extensions, split by failure mode

Claude Code **silently ignores unknown top-level frontmatter keys**. It records them as telemetry and loads the skill fully — no error, no warning, no degradation. Invalid *values* on known keys warn and fall back rather than failing. So adding extensions is safe at load time.

What is not uniform is what happens when a *different* runtime ignores them. Extensions split into two classes, and only one is safe to ignore.

### Fail-safe — ignoring costs capability or polish

`when_to_use` · `argument-hint` · `model` · `effort` · `context` / `agent` / `background` · `shell` · `hooks` · `arguments`

Ignored, the skill still works, just less well. Trigger text is lost, a model override does not apply, an autocomplete hint does not appear. Note `allowed-tools` belongs here too: ignoring it produces *more* permission prompts, never fewer. **Add these freely.**

### Fail-open — ignoring removes a restriction

**`disable-model-invocation`** · **`disallowed-tools`** · **`paths`**

Ignored, the guardrail silently vanishes. A `/deploy` skill carrying `disable-model-invocation: true` becomes model-invocable in a runtime that does not implement it. `disallowed-tools` denials evaporate. `paths` scoping evaporates and the skill activates everywhere — which is also the direction of its other trap, since where `paths` *is* honoured it narrows activation rather than adding a trigger.

**This is live, not hypothetical.** OpenCode and VS Code both scan `~/.claude/skills/` and `.claude/skills/` directly. A skill written "only for Claude Code" is already being loaded by other runtimes on the same machine, unchanged, with its fail-open guardrails stripped — OpenCode does not recognize `disable-model-invocation` at all.

**Therefore: an artifact's safety properties belong in its body and in runtime permission settings, never solely in frontmatter.** Frontmatter guardrails are an optimization in Claude Code and a no-op everywhere else. Two separate artifacts are justified only when a fail-open field is genuinely load-bearing for safety — a destructive skill whose only protection is `disable-model-invocation: true` — and in that case, do not place it in a directory other runtimes scan.

---

## Do not gate CI on `skills-ref validate`

The standard ships a reference validator. Its field set is closed, so it **hard-errors on exit 1 for every Claude Code extension**:

```text
$ skills-ref validate ./cc-extended
Validation failed: Unexpected fields in frontmatter: argument-hint, context,
disable-model-invocation, effort, model, paths, user-invocable, when_to_use.
Only ['allowed-tools','compatibility','description','license','metadata','name']
are allowed.
```

A well-formed, fully-functional Claude Code skill fails this by design, on the first extension field. Never put it in a pipeline for a Claude-Code-targeted skill — an author who meets it as a CI break will "fix" it by deleting their extensions.

The standard's own guidance to runtime authors says the opposite of its validator: *"Warn on issues but still load the skill when possible… don't block skill loading on cosmetic issues."* Unknown fields are not among the conditions it lists for skipping a skill. Read the validator as **"does this use only portable fields?"**, not **"will this work?"**. Use it against the standard subset — strip extension keys, then validate — which is what `bun ../scripts/validate.ts --target-type skill <dir>` does by default; `--extended` allows the extensions through.

### The same split decides what a `.skill` bundle may contain

`bun ../scripts/package-skill.ts <dir>` gates on the standard subset for the same reason, and it is a real constraint rather than a strict default: a `.skill` file is how a skill *travels*, and claude.ai upload and the Skills API accept the six fields and nothing else. A bundle built around `model:` or `argument-hint:` would be refused at the far end, so the packager refuses it here, where the message can say why.

`--extended` packages it anyway. What that produces is a bundle Claude Code installs without complaint and those two reject — which is the right trade for a Claude-Code-only skill and the wrong one for anything expected to travel. Skills bundled inside a plugin never pass through the packager at all, so the question only arises for standalone distribution.

If you want one bundle that goes everywhere, the fix is `metadata:` rather than the flag. Version, author and provenance move there and stay portable; `model:` and `argument-hint:` have no standard equivalent, and dropping them costs a model override and an autocomplete hint — both fail-safe, per the split above.

---

## Portability traps worth knowing

**Casing is not consistent across artifact types.** Skill frontmatter is kebab-case (`disallowed-tools`, `disable-model-invocation`, `user-invocable`, `argument-hint`), with `when_to_use` as a lone snake_case outlier. **Agent** frontmatter is camelCase (`disallowedTools`, `permissionMode`, `maxTurns`, `mcpServers`, `initialPrompt`). They are not interchangeable, and a kebab-case key in an agent file is simply ignored.

**`allowed-tools` format.** The standard says space-separated string. Claude Code additionally accepts comma-separated strings and YAML lists — a superset that is not guaranteed to parse elsewhere. Use the space-separated form for portability.

**Boolean spellings.** Claude Code accepts `yes`, `no`, `on`, `off`, `1`, `0` in any case alongside `true`/`false`. The standard's reference parser does no such coercion — `yes` parses as the *string* `"yes"`. All the affected fields are extensions, so the blast radius is small, but the habit is non-portable. Write `true` and `false`.

**`version` at the top level is non-conformant.** It is not in the standard, and Claude Code does not document or use it. Put version, author and provenance under `metadata:` instead — that is the standard's own escape hatch and every conformant client tolerates it. `metadata.version` is fine; bare `version:` is noise. The same applies to `created_by` and `improved_by`, which some generators emit and nothing reads.

**Agents, commands and hooks are not covered by the standard at all.** It defines exactly one artifact, `SKILL.md`. There is no agent, command or hook concept in the specification, so the entire Claude Code frontmatter set for those carries no portability guarantee. Note also the inversion: for agents `name` and `description` are required and the filename need not match; for skills both are optional in Claude Code and the directory name wins.

---

*Standard retrieved 2026-07-28; the specification page carries no version identifier, only a `lastmod` of 2026-05-20. Claude Code behaviour verified against 2.1.220. The standard's prose and its own reference validator contradict each other on unknown fields, which is why this file separates "will it load" from "is it portable".*
