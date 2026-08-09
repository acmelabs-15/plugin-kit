# SKILL.md frontmatter: which field to set, and what to leave out

This file is organised by what a skill author decides, in the order they decide it. Read `../../../shared/references/portability.md` instead when the question is *portability* rather than which field to set — when the skill is headed for a `.skill` bundle, claude.ai or another runtime, or when a frontmatter flag is the only thing standing between a user and a destructive action. That file carries the six-field standard subset, the standard-versus-extension split, which extensions fail open when another runtime ignores them, and why `skills-ref validate` rejects a working Claude Code skill by design.

---

## Recipe

1. Satisfy the six standard fields first, to the **standard's** stricter constraints rather than Claude Code's looser ones: `name` present, lowercase, no `--`, matching the directory; `description` present and within 1024 chars.
2. Put bookkeeping under `metadata:`.
3. Layer Claude Code extensions below the standard fields.
4. Keep the skill's behavioural contract in the body, so it still reads correctly when the extensions are dropped.

---

## A worked default set, and what was left out

The skills in this plugin carry the same set. It is a defensible default for a plugin-bundled authoring skill rather than a rule, and the reasoning is more useful than the list:

```yaml
name: my-skill
description: "…"                    # the trigger surface; see description-writing.md
argument-hint: "[what to work on]"  # shows in the / menu, where the user decides
allowed-tools: Read, Grep, Glob     # read-only orientation without a prompt per file
license: MIT
compatibility: "Claude Code; needs Bun on PATH for the bundled scripts."
metadata:
  component-type: skill             # free-form; our own reviewers read it
model: opus
```

`allowed-tools` is deliberately read-only. It lets a skill orient itself — read the artifact, find siblings, check what is installed — without a permission prompt per file, while every mutation still goes through the normal flow. Granting `Write`, `Edit` or `Bash` there pre-approves them for the rest of the turn on the user's behalf, which is a decision to leave with the user. Note the comma form above is Claude Code's superset; a skill headed for a `.skill` bundle should use the space-separated form the standard specifies.

Four fields worth *not* adding, each for a reason an author will otherwise rediscover the hard way:

- **`paths`** — it **limits** activation to matching globs rather than adding a trigger. An authoring skill is usually invoked with no relevant file open ("write me a skill for X"), so setting it suppresses the majority of legitimate triggers. It earns its place only on a skill that genuinely applies to a file already in play.
- **`context: fork`** — a forked context loses the conversation above, and for a skill whose first step is "the transcript above is usually the spec" that is the whole input.
- **`disable-model-invocation`** — fine for a destructive `/deploy`, wrong for anything you want Claude to reach for on its own, and fail-open elsewhere. `../../../shared/references/portability.md` has the failure-mode split and what to do when the flag is carrying real safety.
- **`effort`** — it overrides an effort level the user set deliberately. Where capability is the concern, `model:` pins it without touching that.

---

## The name trap, where both runtimes are right

**`name` and the directory disagree.** The standard requires `name` to match the parent directory. Claude Code documents `name` as an optional *display* name defaulting to the directory. Empirically: a directory `dirname-alpha/` containing `name: totally-different-name` loads in Claude Code and is invoked as **`dirname-alpha`** — the directory wins for personal and project skills. The standard's validator rejects the same skill outright. Keep them identical and the question never arises.

Inside a *plugin*, `name` does set the last command segment, so Claude Code gives the field two different meanings depending on scope. `bun shared/scripts/validate.ts --target-type skill <dir>` warns on the mismatch and names which one the loader would use.

---

*Claude Code behaviour verified against 2.1.220.*
