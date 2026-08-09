---
name: command-creator
license: MIT
compatibility: "Claude Code, which is the only runtime with a `/name` entry point and load-time shell injection. The measurement scripts it calls live in the sibling skill-creator skill and run on Bun."
metadata:
  component-type: command
allowed-tools: Read, Grep, Glob
argument-hint: "[what the command should do]"
model: opus
description: |
  Use when the thing being built or fixed is a slash command — something a user invokes by typing /name. Covers deciding whether it belongs in a command file or its own skill folder, wiring up arguments and deciding what happens when someone omits one, the order in which argument substitution and load-time shell injection actually run, previewing the exact text Claude will receive once everything is rendered, the autocomplete hint, running a static check over the frontmatter before setting up an eval loop, and controlling whether Claude may invoke it unprompted or only a human may.

  Skip when the artifact needs bundled scripts, references or assets — that is a skill, and skill-creator writes those. Skip when it is a subagent, a hook, an MCP server, or the plugin around them, and skip for read-only audits (command-reviewer).
---

# Command Creator

An invocation-first entry point: the thing whose defining property is that a person types `/name` and something happens. This skill covers the machinery that serves that property — arguments, autocomplete, load-time context injection, and the decision about who is allowed to invoke it at all.

**Request:** $ARGUMENTS

A note on how this file is written, because it changes when you have to open a reference: a skill body is rendered before Claude sees it, so writing the live syntax here would mean this skill *ran* the examples it is trying to show. The body escapes the dollar-sign forms with a leading backslash and describes the backtick-bang form in prose. So when you are about to write a placeholder or an injection into a real file, copy it from `references/arguments.md` or `references/load-time-injection.md` rather than from anything above — those are read rather than rendered, so they carry the tokens intact. A spelling reconstructed from the escaped form here is the one bug this file cannot show you.

---

## The layout question, settled

`.claude/commands/deploy.md` and `.claude/skills/deploy/SKILL.md` both produce `/deploy`. Same frontmatter fields, same argument substitution, same load-time injection, same entry in the `/` menu. The flat file is not deprecated and no sunset has been announced; the docs say plainly that files in `.claude/commands/` support the same frontmatter and keep working.

So the choice is not correctness. It is what the entry point will need later:

| Situation | Layout |
|---|---|
| One file of instructions, nothing bundled | `skills/<name>/SKILL.md` by default, since it forecloses nothing. `commands/<name>.md` when the smaller diff matters more than the option |
| It needs a script to run, a reference to read, a template to copy | `skills/<name>/SKILL.md` — a flat file cannot carry a directory |
| Claude should be able to decide to load it | `skills/<name>/SKILL.md`, and the description becomes the artifact that matters |
| An existing `commands/*.md` has outgrown itself | `mkdir skills/<name> && git mv commands/<name>.md skills/<name>/SKILL.md`. Nothing else changes |

That is the entire difference, and it is why skills are the recommended shape for new work.

One naming rule beyond the collision in the gotchas: a plugin command lands under the plugin's namespace, `/my-plugin:deploy`, with the bare `/deploy` also working unless something already claims it.

### When this skill hands off

Stop here and use `skill-creator` at either of these moments:

- **Bundled files.** The moment the entry point wants a `scripts/`, `references/`, `assets/` or `examples/` directory, the deliverable is a skill and progressive disclosure becomes the central design problem. Read `../../shared/references/progressive-disclosure.md` at that moment, before deciding what goes where — the split is by load mode rather than by topic, and a directory laid out by topic has to be redone.
- **Model invocation is the point.** If the value is Claude noticing on its own that this applies, the description is the artifact and it needs the measured description loop rather than an argument contract. `../../shared/references/description-writing.md` is where that starts.

Handing off is not a downgrade and it costs nothing — the file you have written becomes the `SKILL.md` unchanged.

### Where this ships

A slash command is a Claude Code entry point and nothing else. Inside Claude Code it has merged with skills, as above. Outside it there is no `/name` concept to install into — not in Claude Desktop's Chat tab, not on claude.ai, not through the API. Desktop's Code and Cowork tabs run the plugin format, so a plugin command reaches those two and stops there.

The trap is that the file *looks* uploadable: it is Markdown with YAML frontmatter, the same shape as a skill that travels fine. The fields that make it a command — `argument-hint`, `arguments`, `disable-model-invocation`, `user-invocable` — are precisely the ones that are a hard error outside Claude Code, and load-time injection does nothing there either.

Read `references/command-frontmatter.md` when someone asks to upload, package or share this file, or names a surface outside Claude Code: it quotes the exact rejection message, which settles the question faster than arguing it. Read `../../shared/references/distribution-targets.md` when the answer has to be *what to build instead* — it has the surface matrix and the shape a second, portable artifact would take.

---

## Gotchas — the failures that render cleanly and are still wrong

A command has no error channel. It renders, the model reads whatever came out, and the work proceeds from it. These are the ways that goes wrong quietly, which is why they are here rather than behind a pointer.

- **`\$N` is 0-based.** `\$0` is the *first* argument, not the command name. A file written on the shell habit is off by one in every slot and renders without complaint.
- **Argument substitution is plain text replacement with no shell escaping.** An argument reaching an injected command arrives unquoted, so `don't` is a bash syntax error and the section renders as the error, while `$(...)` and backticks in an argument execute. Free text belongs in the prose, never in an injection; a constrained value may go in, quoted.
- **A missing argument does not stop anything, and the two forms fail differently.** An indexed placeholder with nothing behind it survives as the literal `\$2`; a named one expands to the empty string and the sentence quietly loses a word. If a missing argument should stop the command, the body has to say so.
- **The inline injection is recognised only at line start or after whitespace.** Wrap it in parentheses, or put an `=` before it, and it silently becomes literal text — the command never runs and Claude reads the source instead of the output.
- **Outside Claude Code an unpermitted frontmatter key is a hard error, not an ignored field.** Only `name`, `description`, `license`, `compatibility`, `metadata` and `allowed-tools` are accepted, so `argument-hint` alone makes the file unpackageable for claude.ai and the Skills API.
- **A skill and a command with the same name are not an error — the skill wins.** Nothing reports the shadowing.
- **`disable-model-invocation: true` plus `user-invocable: false` leaves nothing that can reach the file.** It loads, validates, and never runs.
- **`disableSkillShellExecution` can turn injection off underneath you**, usually through managed settings the user cannot override. Each injected command is replaced by `[shell command execution disabled by policy]`, so write the body to degrade into a question rather than into confident nonsense.

---

## 1. Decide who may invoke it

This is the command author's central design question, and it is two independent axes rather than one setting.

| Frontmatter | User types `/name` | Claude may invoke | Description in context |
|---|---|---|---|
| *(default)* | yes | yes | always |
| `disable-model-invocation: true` | yes | no | **no** |
| `user-invocable: false` | no | yes | always |
| both | **no** | **no** | no |

The second row is the one command authors want most often, and its second effect gets missed. `disable-model-invocation: true` also drops the description out of context. So it costs nothing in the skill listing, cannot be truncated when that listing overflows, and cannot steal a sibling's triggers — but the description is now purely documentation for whoever reads `/help`. No amount of description tuning changes when it fires, because nothing but a typed slash fires it.

Reach for it when the command has effects you would not want inferred: `/deploy`, `/commit`, `/send-invoice`, anything that spends money or touches production. Timing is the user's call, not the model's. Claude Code blocks the model's attempt and tells it not to reproduce the steps another way, so the failure mode is a suggestion to run it yourself rather than a silent workaround.

`user-invocable: false` is the opposite artifact — background knowledge with no action behind it. Reaching for it usually means this is not a command any more, and `skill-creator` is the better fit.

One portability note: `disable-model-invocation` is fail-open. A runtime that does not implement it loads the skill without the guardrail, and other editors do scan `.claude/skills/`. Read `../../shared/references/portability.md` when a frontmatter flag is the only thing standing between a user and a destructive action — it separates the fields that fail safe from the ones that fail open, and the distinction decides whether the guardrail also has to exist in the body and in permission settings.

The two axes together, and where each combination is the right answer, are drawn as a decision in `references/command-frontmatter.md`. Open it when the command has effects and you are weighing who should be able to set them off.

---

## 2. Decide the argument contract

Four placeholder forms, and the difference between them is what a user has to remember when they type.

| Form | Gets | Use it when |
|---|---|---|
| `\$ARGUMENTS` | everything after the command name, as typed | the command takes one free-text blob — an issue description, a commit message |
| `\$ARGUMENTS[0]`, `\$ARGUMENTS[1]` | one argument by **0-based** index | positions are distinct and few |
| `\$0`, `\$1` | the same thing, shorter | same, when the file stays readable without the longer name |
| `$issue`, `$branch` | named arguments declared in the `arguments:` frontmatter list | positions are distinct and the file is long enough that `\$2` stops being self-explanatory |

Choose between the two failure modes deliberately, since neither form stops on a missing argument: named arguments degrade into vague instructions, indexed ones degrade into visible garbage. Whichever you pick, say in the body what should happen when the argument is absent — "if no ticket number was given, ask for one before doing anything else."

Open `references/arguments.md` before writing the first placeholder into a real file, and again whenever the question is "what will this actually render to". It has the copyable spellings this body cannot show, plus precedence, quoting, surplus and missing arguments, the escaping rules, and Input/Output pairs putting a command file beside the text the model receives. Guessing instead is how a file ends up off by one, or with a `\$1,200` in its prose silently rewritten.

### The autocomplete hint

`argument-hint` is what the user sees in the `/` menu while they are still deciding what to type, so it is the only documentation that arrives before the mistake.

```yaml
argument-hint: "[pr-number] [reviewer]"
```

A good one names each positional slot in the order the file consumes it, in the user's vocabulary rather than the variable's. `[pr-number] [reviewer]` teaches the shape; `[args]` teaches nothing; `[string] [string]` is worse than nothing because it looks informative. Put optional slots last and mark them, and keep it to the arguments the command actually reads — a hint that has drifted from the body is a hint that lies.

---

## 3. Decide what context it needs at load time

This is the capability that makes an invocation-first entry point worth more than a saved prompt, and the part most worth getting right.

A command file can carry shell commands that run **before Claude sees the file**. Their output replaces the placeholder as plain text, so the model receives the branch name, the diff, the failing test list — not an instruction to go and fetch them. Written in prose because writing it live here would execute it: an exclamation mark immediately followed by a backtick-quoted command, inline; or a fenced block whose opening fence carries a trailing exclamation mark, for several commands at once.

Three consequences follow, and each one changes how you write:

- **Claude never runs these.** It cannot see the command, only the result. So there is no permission prompt, no tool call, and no chance of the model deciding to skip the step. That determinism is the whole advantage over "start by running `git diff`".
- **The user's machine runs them, on their behalf, every time.** A command you ship is code you are asking someone to trust. Review it the way you would review a script you asked them to `curl | sh`.
- **They run on every invocation.** A command that takes four seconds to render costs four seconds every single time, including the times the output was not needed.

Open `references/load-time-injection.md` before writing any injection into a real file — it carries the two syntaxes in copyable form, which this body cannot. Read the rest of it when you are choosing *what* to inject: it pairs each pattern worth stealing (current branch, changed files, failing tests, open PRs) with the unbounded anti-pattern it is one flag away from, and covers recognition, non-recursion, failure, and what a slow or empty command does to the render. Skipping it is how a command tested on a three-file branch pastes four thousand lines on someone else's refactor.

### The substitutions

Four values Claude Code fills in without a shell. Each is written as a dollar sign followed by the name in braces; spelled here without the braces because this body is itself substituted, so copy the braced form from `references/arguments.md` when you use one.

- `CLAUDE_SESSION_ID` — for log filenames and for correlating output with a session
- `CLAUDE_EFFORT` — the active effort level, so a command can say what to do differently at `low`
- `CLAUDE_SKILL_DIR` — the directory holding this file, so a bundled script resolves regardless of the working directory. For a plugin skill this is the skill's own subdirectory, not the plugin root
- `CLAUDE_PROJECT_DIR` — the project root, the same path hooks receive

The skill-directory and project-directory forms also substitute inside `Bash(...)` rules in `allowed-tools`, which is the mechanism for pre-approving exactly the bundled script the body tells Claude to run — the rule and the instruction match because they were written from the same variable.

---

## 4. Write it

Order the file the way it will be read: frontmatter, then the injected context, then the task. Claude reads top to bottom, and putting the data before the instruction means the instruction arrives already grounded.

```markdown
---
name: fix-issue
description: <what it produces, and when not to reach for it>
argument-hint: "[issue-number]"
disable-model-invocation: true
allowed-tools: Bash(gh issue view *)
---

## Context
<injected shell output goes here>

## Your task
<what to do with it, in sentences>
```

Two specimens to imitate rather than descriptions of them. Open one before drafting, whichever end of the range the command sits at:

- `examples/minimal-command.md` — **when the command has no arguments and no injection.** The smallest thing that earns its place, annotated with why each line is there and what was deliberately left out.
- `examples/review-pr.md` — **when it has arguments, injection, or a tool grant.** All three at once, annotated line by line, with the rendered result shown beside the source, which is the part that is hard to picture from a description.

Read `references/command-frontmatter.md` when reaching for any field beyond the five above — `model`, `effort`, `context: fork`, `agent`, `shell: powershell`, `disallowed-tools`, `paths`, `hooks`. Each entry says what the field does, when it earns its place, and which scope it applies in. Two are easy to get wrong from the name alone: `paths` constrains automatic activation and is inert on a manual-only command, and `shell: powershell` changes the interpreter for the load-time injections in this file only, so it is a statement about the language they are written in rather than a Windows setting.

---

## 5. Check the rendering

A command's rendering is deterministic: substitution and injected output either produce what you intended or they do not, and finding out costs a minute. Do it before any statistical measurement, because a broken render makes every downstream number meaningless.

**First, run each injected command in a terminal yourself.** What you see is character-for-character what gets pasted into the prompt. Time it. Look at the volume — a diff that prints 400 lines is 400 lines on every invocation. Check what it reveals: an environment dump, a config print, a verbose CI log will carry secrets into context, and context is not a place you can take something back from.

**Then invoke the command for real** with the arguments a real user would type, in a throwaway session, and ask Claude to repeat back verbatim the instruction text it was just given. The rendered content enters the conversation as a message, so it can be read back. Compare against your intent, one item at a time:

- Every argument placeholder resolved, and to the position you meant — this is where the 0-based indexing shows up
- No placeholder left behind as literal text, which means an index the invocation never filled
- No sentence that lost a word, which means a named argument the invocation never filled
- Each injected block holds output, not the command text — a command left as literal text means the exclamation mark was not in a recognised position
- Nothing sensitive that you did not decide to include

**Then invoke it wrongly on purpose.** No arguments, one too few, one too many, an argument containing spaces without quotes, and — if any argument reaches an injected command — one containing an apostrophe, which is the gotcha above arriving in practice. You are not looking for a crash; you are looking at what the model is told to do when the user fumbles, which should degrade into a question rather than a confident wrong action.

Derive the invocations to test from what the command *does* — the argument declarations, the injected commands, the branches in the body — rather than from how it describes itself. Generating them from the description you are about to judge is circular: they inherit its vocabulary, so a capability the description never mentions is never probed and never penalised. One command does that reading and stops before generating, so you can correct the inventory first:

```bash
bun ../../shared/scripts/synthesize-scenarios.ts \
  --target <command-file-or-skill-dir> --target-type command --inventory-only
```

Put the inventory in front of the user — "this command appears to do X, Y and Z; is that right?" A capability they confirm that the description never mentions is a finding before any run. Drop `--inventory-only` and add `--out` once it is agreed.

---

## 6. Measure the triggering, when there is triggering to measure

If the command carries `disable-model-invocation: true`, there is nothing statistical to measure. Its description is not in context; a typed slash is the only path in. The render check above is the whole loop, and that is a complete answer rather than a missing step.

Otherwise the command is competing for triggers exactly like a skill, and the same loop applies:

```bash
bun ../../shared/scripts/optimize-description.ts \
  --eval-set <path-to-trigger-eval.json> \
  --skill-path <path-to-command-as-a-skill-directory> \
  --model <model-id-powering-this-session> \
  --max-iterations 5 \
  --verbose
```

The loop installs a **skill directory** under a unique alias, so a flat `commands/<name>.md` needs a temporary skill-shaped copy — one more small argument for authoring in the skill layout from the start. It splits the set into train and held-out and selects on held-out, because a description tuned until it aces its own training queries has usually just memorized them. `../../shared/references/description-writing.md` covers how to build a set that can discriminate at all; the short version is that easy near-misses certify everything.

The validator's `--with-environment` half is worth a run when the command ships alongside others: it finds installed neighbours whose descriptions will absorb your triggers, and what it names is also the best available source of genuinely hard negatives for the eval set.

---

## Pre-flight

Before spending eval budget, run the `skill-creator:command-reviewer` agent on the file. It reads statically and never invokes anything, which is why it complements measurement rather than replacing it: it catches an argument the body references but the frontmatter never declares, an unreachable invocation combination, an exclamation mark in a position that will not be recognised, an injected command that leaks or stalls, and a command that has outgrown the layout.

```bash
bun ../../shared/scripts/validate.ts --target-type command <dir> --extended --with-environment
```

Frontmatter, the argument contract, and the fail-open flags; `--with-environment` adds the collision check and refuses rather than reporting clean when it cannot read the installed set. Drop `--extended` to check the portable field set instead — the right question only when the file is headed for claude.ai, where the extension fields are a hard error. For a command staying in Claude Code, a bare-form failure is the expected result rather than a defect.

Close the loop rather than reading either output once: fix what they report, run both again, repeat until the validator is clean and the reviewer returns no FAIL. Each finding left standing costs a full eval iteration to rediscover.

---

## Bundled files, and when each one fires

- `references/arguments.md` — **before writing the first placeholder into a real file**, since this body cannot show the live spellings, and **whenever the question is what the file renders to.**
- `references/load-time-injection.md` — **before writing any injection**, for the same copyable-spelling reason, and **when choosing what to inject.**
- `references/command-frontmatter.md` — **when reaching for a field beyond `name`, `description`, `argument-hint`, `arguments` and `disable-model-invocation`; when weighing who may invoke the command; when anyone asks about uploading or packaging it.**
- `examples/minimal-command.md` — **before drafting a command with no arguments and no injection.**
- `examples/review-pr.md` — **before drafting one with arguments, injection or a tool grant.**

Cross-plugin: `../../shared/references/progressive-disclosure.md` when the file grows a directory, `../../shared/references/description-writing.md` when the description has to trigger, `../../shared/references/portability.md` when a fail-open flag is carrying safety, `../../shared/references/distribution-targets.md` when a surface outside Claude Code is named.

---

Write the file, read each injected command in a terminal, invoke it once with real arguments and once wrongly, and only then argue about the description. The render check finds in a minute what an eval run finds in twenty.
