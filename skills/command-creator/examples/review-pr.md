# Specimen: arguments and injected context together

The other end of the range from `minimal-command.md`: named arguments, load-time shell injection, a scoped tool grant, and a body written to survive every one of them failing. The render is shown below the source, because a command with injection is not finished until you have seen what it renders to.

---

## The file

`.claude/skills/review-pr/SKILL.md`

`````markdown
---
name: review-pr
description: Reviews an open pull request against this repository's conventions and returns findings grouped by severity, with a concrete fix for each. Use when a specific PR number is the thing being reviewed. Do not use to review uncommitted local changes, to write the pull request description, or to merge — those touch the same code with a different deliverable.
argument-hint: "[pr-number] [focus, optional]"
arguments: [pr, focus]
disable-model-invocation: true
allowed-tools: Bash(gh pr view *) Bash(gh pr diff *)
compatibility: Requires the GitHub CLI (`gh`) authenticated against this repository.
---

## Pull request #$pr

```!
gh pr view "$pr" --json title,author,baseRefName \
  --jq '"Title: \(.title)\nAuthor: \(.author.login)\nTarget: \(.baseRefName)"' \
  2>/dev/null || echo "(could not read PR $pr — is gh authenticated?)"
```

Files changed:

!`gh pr diff "$pr" --name-only 2>/dev/null | head -60 || echo "(no diff available)"`

Change size:

!`gh pr diff "$pr" 2>/dev/null | diffstat -s 2>/dev/null || echo "(size unknown)"`

## Your task

Review pull request #$pr against this repository's conventions.

The context above is machine-generated and may be empty, truncated to the first
60 files, or replaced by a policy message. If it is missing or clearly wrong,
say so and ask me for what you need rather than reviewing from nothing.

Read the files that matter rather than the whole diff. Start from the changed
file list, and open only what the change actually turns on.

Pay particular attention to: $focus

If nothing was given for the focus, use your own judgement about where the risk
in this change is, and say which area you chose and why.

Group findings by severity — Critical for anything that breaks at runtime or
loses data, Major for anything that works but misbehaves, Minor for style. Give
each finding a location, a reason, and a concrete fix. A short review with no
findings is a correct result; do not manufacture findings to fill the shape.
`````

---

## What it renders to

**Invocation** `/review-pr 412 "the new retry logic"`

**Output** — the text the model receives, with the shell output pasted in:

```text
## Pull request #412

Title: Retry transient S3 failures in the uploader
Author: dana-k
Target: main

Files changed:

src/upload/client.ts
src/upload/retry.ts
src/upload/__tests__/retry.test.ts

Change size:

3 files changed, 148 insertions(+), 12 deletions(-)

## Your task

Review pull request #412 against this repository's conventions.

The context above is machine-generated and may be empty, truncated to the first
60 files, or replaced by a policy message. If it is missing or clearly wrong,
say so and ask me for what you need rather than reviewing from nothing.

...

Pay particular attention to: the new retry logic

...
```

Claude never sees `gh`. It sees a pull request.

---

## Annotations

### The frontmatter

**`arguments: [pr, focus]`** declares two names bound to positions in order, so `$pr` is the first argument and `$focus` the second. They are labels for positions, not keyword arguments — the user still types values in order. Names were worth it here because `$pr` appears in four places and `$focus` in prose; in a four-line file, `$0` and `$1` would have been clearer than the indirection.

**`argument-hint: "[pr-number] [focus, optional]"`** names the slots in the order the file consumes them, in the user's vocabulary rather than the variable's, and marks the optional one. It is the only documentation that reaches the user before they commit to a syntax.

**`allowed-tools`** grants the two `gh` subcommands the body needs and nothing else. Note that this grant is for tools *Claude* may call during the turn — it is unrelated to the injected commands above, which run at load time outside the permission system entirely. The two look similar in a file and are different mechanisms; the grant here exists because the review itself may want to pull a comment thread.

**`compatibility`** is inert in Claude Code and worth setting anyway. Every injected command depends on an authenticated `gh`, and a stranger who runs this on a machine without one gets three fallback strings and no explanation. One line of frontmatter is the explanation.

**`disable-model-invocation: true`** because reviewing PR 412 is a thing the user decides to do. It also means the description never enters context, so the file costs nothing in the skill listing.

### The injected context

**The fenced form for the multi-line command, the inline form for one-liners.** A fence opened with a trailing exclamation mark takes several lines; the inline form takes one. Mixing them in one file is normal — use whichever keeps the line readable.

**Each command is quoted, bounded and has a fallback.** Three habits, each earning its place:

- `"$pr"` rather than bare `$pr`. The argument is substituted into the command text before the command runs, with no shell escaping, so quoting is what stops a stray character from breaking the line. It is sufficient here because a PR number is a constrained value the user typed themselves. It would not be sufficient for `$focus`, which is why `$focus` appears only in prose — free text in an injection is a shell syntax error waiting for its first apostrophe. Reading the render back is how you confirm a placeholder resolved inside an injected command rather than reaching the shell as literal text.
- `head -60` on the file list. The command was tested on a three-file PR; it will be run on a two-hundred-file one. The bound is what makes the cost predictable, and the body tells the model the truncation exists so it does not conclude the change is smaller than it is.
- `2>/dev/null || echo "(...)"`. Suppressing stderr alone leaves an empty section, which reads as *there is nothing here* rather than *this did not work*. The fallback string turns a hole into a fact the model can act on.

**`diffstat -s` rather than the diff.** The size in one line is what the review needs to calibrate; the diff itself is thousands of tokens paid on every invocation. The model can open the files it decides matter.

**What is not injected:** the diff body, the comment thread, the CI log. Each was tempting and each is unbounded. The rule of thumb: if the output is needed on fewer than half of invocations, it is a tax on the rest — make it something the model fetches when the task turns out to need it.

### The body

**It tells the model the context might be broken.** Injected output can be empty, truncated, or replaced with `[shell command execution disabled by policy]` on a machine whose settings disable the mechanism. A body that assumes its context arrived will confidently review nothing. Two sentences turn that into a question.

**It handles the missing optional argument explicitly.** `$focus` expands to the empty string when the user gives one argument, which would otherwise leave "Pay particular attention to:" hanging. Neither placeholder form stops on a missing argument, so the body has to.

**It says a clean review is a correct result.** Without that, a reviewer under instruction to group findings by severity will find some.

---

## What was deliberately left out

**No `context: fork`.** Forking would keep the diff out of the main conversation, which is attractive — but a review the user then wants to discuss is worse in isolation, and forking also ends command stacking, so `/review-pr` could never be chained after another command in one message.

**No `paths`.** It constrains automatic activation, and `disable-model-invocation: true` has already removed automatic activation. Setting both is not an error and does nothing.

**No bundled script.** The three injections are one line each. The moment they become a script — and a fetch-and-shape step for a large PR quickly does — this needs a `scripts/` directory, which is where `skill-creator` takes over.
