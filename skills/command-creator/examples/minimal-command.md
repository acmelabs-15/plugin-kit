# Specimen: the smallest command that earns its place

A command with no arguments, no injected context, and four lines of frontmatter. Most commands should look roughly like this. The second specimen, `review-pr.md`, shows what the extra machinery buys and what it costs.

---

## The file

`.claude/commands/commit.md` — or `.claude/skills/commit/SKILL.md`, identically.

````markdown
---
name: commit
description: Stages the current changes and writes a Conventional Commits message for them. Use when the working tree has finished work that needs committing. Do not use to push, tag, open a pull request, or rewrite history — those are separate actions with separate consequences.
disable-model-invocation: true
allowed-tools: Bash(git status *) Bash(git diff *) Bash(git add *) Bash(git commit *)
---

Commit the current changes.

1. Run `git status --short` and `git diff` to see what is actually changing.
   If the working tree is clean, say so and stop.
2. Group the changes into one commit if they are one idea, or tell me they
   should be split if they are two. Do not split them yourself.
3. Write a Conventional Commits subject line under 72 characters: a type, an
   optional scope, and what the change does in the imperative.
4. Add a body only when the change is not self-explanatory from the diff, and
   use it to say why rather than what — the diff already says what.
5. Stage and commit. Do not push.

Never add co-author trailers, tool attribution, or emoji unless this repository's
existing history uses them. Match what `git log -n 20 --oneline` shows.
````

---

## Annotations

**`name: commit`** matches the file name, so the command is `/commit` either way. In the flat layout `name` is a display label only and the file name decides; keeping them identical means nobody has to know that.

**`description`** does two jobs at once here. It names the artifact — a staged commit with a Conventional Commits message — rather than the topic, which is what keeps it from competing with every git-adjacent skill installed. And its negatives are built from the same vocabulary as its positives: push, tag, pull request, history. A negative made of words that never appear in the positives excludes nothing, because near-miss requests arrive phrased in the positive vocabulary.

There is a subtlety worth knowing: with `disable-model-invocation: true`, this description never enters the model's context. It is read by the human scrolling `/help`. Writing it to the triggering standard anyway costs nothing and means the file survives a later decision to make it model-invocable.

**`disable-model-invocation: true`** is the whole reason this is a command rather than a skill. Committing is a decision about when, and the person who should make it is the one who knows whether the work is finished. If Claude attempts it anyway, Claude Code blocks the call and tells it not to reproduce the steps another way, so the user sees a suggestion to run `/commit` rather than a commit they did not ask for.

**`allowed-tools`** lists four narrow patterns rather than `Bash(*)`. The command's job is a known sequence, so a prompt on each step turns one keystroke into five — but the grant should cover that sequence and nothing else. Note what is absent: no `Bash(git push *)`, which means that even if the model decided to push, the user would be asked. The frontmatter and the body's "do not push" say the same thing twice, deliberately, because one of them is advice and the other is a permission boundary.

The grant lasts for the turn that invoked the command and clears on the next message.

**The body** is instructions to another instance of Claude, written to explain rather than command. Step 2 says *tell me they should be split* rather than *split them*, because a command that silently makes two commits when the user expected one has made a decision that was not its to make. Step 4 explains why a body is for the why — given the reason, the model handles the diff you did not anticipate.

The closing paragraph points at `git log` rather than stating a house style. A rule that reads the repository stays right when the repository changes.

---

## What was deliberately left out

**No `argument-hint`.** The command reads no arguments, and a hint that promises input the file ignores is worse than silence. If a message were passed as `/commit fix the login bug`, Claude Code would append `ARGUMENTS: fix the login bug` to the end of the content — visible, but as an unexplained trailer rather than in the sentence where it belonged. If that is a use you want, add `$ARGUMENTS` to step 3 and a hint saying `[optional subject]`.

**No injected context.** ``!`git diff`` in the frontmatter-adjacent position would work, and it is a real temptation — the model would have the diff without a tool call. It was left out because the diff is unbounded. On the branch you tested it on it is forty lines; on someone's refactor it is four thousand, paid on every invocation before anything else happens. Step 1 asks for the diff instead, so the model reads what it needs and stops.

That is the general trade: injection buys determinism and pays in unconditional cost. Take the trade when the output is small and always relevant, as `review-pr.md` does with a file list.

**No `model` or `effort`.** Both would be pinning a preference into a file that outlives the preference. Inheriting the session's settings is right until there is a specific reason it is not.

**No `context: fork`.** The command is short and its output is the thing the user wants in front of them. Forking would isolate it from the conversation it exists to serve.

**No bundled files.** Nothing here needs a script to run or a reference to read, which is exactly why the flat layout is sufficient. The moment one of those appears, this becomes `skills/commit/SKILL.md` with a `git mv` and nothing else changes.
