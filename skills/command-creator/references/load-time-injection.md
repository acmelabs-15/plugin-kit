# Load-time context injection

The capability that makes an invocation-first entry point worth more than a saved prompt: the file can carry shell commands that run **before Claude sees it**, so the model receives the branch name, the diff, the failing test list as data rather than as an errand.

Everything here is safe to copy verbatim. This file is read into context rather than rendered as a command, so the syntax below arrives intact.

---

## The two syntaxes

**Inline** — an exclamation mark immediately followed by a backtick-quoted command:

```markdown
Current branch: !`git rev-parse --abbrev-ref HEAD`
```

**Fenced** — for several commands, a code fence whose opening carries a trailing exclamation mark:

````markdown
## Environment
```!
bun --version
git status --short
git rev-parse --abbrev-ref HEAD
```
````

Both are replaced by the command's output as plain text, in place.

`shell: powershell` in frontmatter switches the interpreter for both forms in that file. It applies where the PowerShell tool is enabled — on by default on Windows without Git Bash, and available elsewhere with `CLAUDE_CODE_USE_POWERSHELL_TOOL=1`. It is a per-file choice about what language the injections are written in, not a general Windows setting.

---

## The recognition rule

The inline form is recognised only when the exclamation mark is **at the start of a line or immediately after whitespace**. Following any other character, it is left alone as literal text and the command does not run.

| Written | Result |
|---|---|
| `Branch: !`git branch --show-current`` | runs |
| `!`date`` at column 0 | runs |
| ``KEY=!`cmd` `` | **does not run** — literal text reaches Claude |
| ``(!`cmd`)`` | **does not run** — the `(` is not whitespace |
| `` `!`cmd`` `` inside a code span | runs — the backtick before it is not whitespace, so this one does *not* |

That last row is the trap in both directions. Authors who wrap the placeholder in punctuation to make it read nicely — parentheses, an equals sign, a leading angle bracket — silently disable it, and the failure is visible only in the render. Authors who want to *document* the syntax discover the opposite: put it at the start of a line in a live file and it executes, code fence or not.

There is no way to escape the sequence. To write about it in a file that will be rendered, describe it in prose or move the discussion into a reference file like this one.

---

## Output is never re-scanned

Substitution runs once over the original file. Command output is inserted as plain text and is not examined for further placeholders, so a command cannot emit a placeholder for a later pass to expand.

```markdown
Config: !`cat .claude/context-cmd.txt`
```

If that file contains ``!`aws sts get-caller-identity` ``, Claude receives the literal text, not the identity. This is a safety property worth relying on: text your command prints — from a file, a network response, a commit message written by someone else — cannot turn into a new command. Injection through the output channel is closed.

It also means no indirection. There is no include mechanism, no way to build a command string dynamically and have it run. If the command needs logic, write a script and call the script.

---

## What Claude sees, and does not

Claude receives the rendered result and nothing else. It does not see the command, does not run it, is not prompted for permission, and cannot decide to skip it.

That determinism is the point. "Start by running `git diff`" is a request the model may reorder, batch, or judge unnecessary. An injected diff is simply present. For a command whose whole job is *look at this specific state and act on it*, injection converts a hope into a guarantee.

The flip side is that the model cannot recover from a bad injection. If the command printed an error, Claude reads the error as context and reasons from it. There is no signal that says *this section is broken, ignore it*.

---

## Security posture

**This runs on the user's machine, at load time, without asking.** Not in a sandbox, not behind a permission prompt, not after Claude decided it was reasonable. The moment someone types `/name`, your commands execute with their credentials and their filesystem.

So a command file you distribute is code you are asking someone to trust, and it should read like it:

- Every injected command should be one you would be comfortable watching someone run in your own terminal.
- Read-only by default. `git`, `gh`, `ls`, `cat`, a test runner in report mode. If an injection mutates state, it is doing work that belongs in the body where the model — and therefore the user — can see it happen.
- No network calls to hosts the user has not already chosen to talk to.
- No `sudo`, no writes outside a scratch path, nothing that depends on ambient credentials the user did not know were in play.

On the receiving side: a project's `.claude/` files run after the workspace trust dialog is accepted, which makes accepting trust on an unfamiliar repository a decision about arbitrary code execution. Review the commands in a repo's commands and skills before trusting it, and say so in the README of anything you ship.

### Secrets leak upward, not outward

The likelier accident is not a malicious command; it is a useful one that prints too much.

```markdown
Environment: !`env`
Config: !`cat ~/.aws/credentials`
Recent CI: !`gh run view --log`
```

None of those is hostile. All of them put credentials into a conversation, where they persist for the session, travel to the model, and land in any transcript or eval artifact the session produces. Context is not a place you can take something back from.

Scope the output instead of the command: `env | grep -E '^(NODE_ENV|CI)='` rather than `env`; a specific config key rather than the file; the failing test names rather than the full log.

### The kill switch you do not control

`"disableSkillShellExecution": true` in settings turns the mechanism off for skills and commands from user, project, plugin and additional-directory sources. Each command is replaced with `[shell command execution disabled by policy]` instead of running. Bundled and managed skills are unaffected. It is most often set in managed settings, where users cannot override it.

So an enterprise user may run your command and receive that string where the diff should have been. A command whose body says "summarise the changes below" then summarises a policy notice. Write the body so it degrades into a question — "if the context section below is empty or shows a policy message, ask the user to paste the diff" — rather than into confident nonsense.

---

## Failure and cost

**Failure.** The documented contract is that the command's output replaces the placeholder. There is no documented separate path for a non-zero exit, a missing binary, or a hung process, so the safe assumption is that whatever the shell produced is what Claude reads — including nothing at all. Design so that neither outcome is confusing:

```markdown
Open PRs: !`gh pr list --limit 10 2>/dev/null || echo "(gh unavailable)"`
Coverage: !`cat coverage/summary.txt 2>/dev/null || echo "(no coverage report; run the suite first)"`
```

An explicit fallback string turns a silent hole into a fact the model can act on. `2>/dev/null` keeps a tool's diagnostic chatter out of the prompt; the `||` branch replaces it with something meaningful. Both matter — suppressing stderr without a fallback produces an empty section, which reads as "there is nothing" rather than "this did not work".

**Cost.** Every injection runs on every invocation, before anything else happens. Two prices:

- **Latency.** The user is waiting. A four-second injection is a four-second pause on every use, including the uses where the output turned out to be irrelevant. Time each command in a terminal before committing it.
- **Tokens.** The output is pasted in whole. `git diff` on a large branch is thousands of tokens the user pays for every time, and re-invoking the command with different output appends the full content to the conversation again rather than deduplicating it. Bound the output at the source: `--stat`, `--name-only`, `-n 20`, `head -c 4000`.

A useful test for whether an injection has earned its place: if the output is needed on fewer than half the invocations, it is a tax on the rest. Move it into the body as an instruction, where the model fetches it only when the task turns out to need it.

---

## Patterns worth stealing, and what they turn into

### Current branch and working state

```markdown
Branch: !`git rev-parse --abbrev-ref HEAD`
Status: !`git status --short`
```

Cheap, bounded, almost always relevant to a repo-scoped command.

**Anti-pattern:** `!`git log`` — unbounded, pages of history, and the command almost certainly wanted `--oneline -n 10`.

### The changed files, not the change

```markdown
Changed files: !`git diff --name-only origin/main...HEAD`
Summary: !`git diff --stat origin/main...HEAD`
```

The file list is usually enough to direct the work, and it is two orders of magnitude smaller than the diff. Let the model read the files it decides matter.

**Anti-pattern:** `!`git diff origin/main...HEAD`` on a branch of unknown size. It is the single most common way a command becomes unusable on a real repository — fine on the three-file branch you tested it on, thousands of lines on the refactor someone else runs it against.

### Failing tests, not the whole run

```markdown
Failing tests: !`bun test --reporter=dot 2>&1 | grep -E "^(fail|✗)" | head -40 || echo "(suite did not run)"`
```

The failure names are what the task needs. Filter and bound at the source.

**Anti-pattern:** `!`bun test`` — runs the entire suite on every invocation, so a command meant to explain one failure now takes ninety seconds and pastes a full log, most of which is passes.

### Open pull requests

```markdown
Open PRs: !`gh pr list --limit 10 --json number,title,author --jq '.[] | "#\(.number) \(.title) — \(.author.login)"' 2>/dev/null || echo "(gh unavailable)"`
```

Shaped and capped, with a fallback for the machine that has no `gh` or no auth.

**Anti-pattern:** `!`gh pr list --json ...`` with no `--limit` and no shaping, dumping raw JSON. The model reads JSON fine; the user pays for the field names on every invocation.

### Issue detail for a command that takes an issue number

```markdown
Issue $0: !`gh issue view "$0" --json title,body,labels 2>/dev/null || echo "(could not fetch issue)"`
```

Injection and arguments compose: the argument is substituted into the command text before the command runs, which makes the injected context specific to this invocation rather than generic. It is the most valuable pattern in this file.

It is also the sharpest edge, and the details matter.

---

## Arguments inside injected commands are not escaped

Argument placeholders are resolved throughout the file before these commands run — that is the ordering `arguments.md` describes, and it is what makes the composition work at all. The substitution is plain text replacement with no shell quoting. Two things follow, and the first is far more common than the second.

**Ordinary text breaks the command.** An apostrophe is enough:

```
/summarise-note don't ship on Friday
```

with a body containing ``!`echo $ARGUMENTS`` produces a bash syntax error — *unexpected EOF while looking for matching `'`* — and the section renders as an error message. Spaces, quotes, parentheses and ampersands all do their own version of this. Any argument a human types in prose will eventually contain one.

**Shell metacharacters execute.** An argument containing `$(...)`, backticks or `;` is evaluated as part of the command line. `/my-command "; ls ~"` runs the `ls`.

This was reported against Claude Code and closed as not planned, so it is behaviour to design around rather than a bug to wait out.

The design rule that follows:

- **Free text never goes into an injection.** Put it in the prose, where the model reads it as data. That is where a search term, a review focus, a commit message or a description belongs anyway.
- **Constrained values may.** An issue number, a branch name, an enum from `argument-hint` — small, predictable vocabularies. Quote the placeholder: `"$0"` stops word-splitting and neutralises `;`, `|`, `&` and glob characters, which covers the accidental cases that make up nearly all of the real ones.
- **Know what quoting does not buy.** Inside double quotes, `$(...)` and backticks still expand. If the value could come from anywhere other than the person at the keyboard — pasted from an issue, produced by automation, forwarded by another tool — do not put it in an injection at all.

The threat model is worth naming plainly, because it changes what counts as sufficient. For a command the user typed themselves, the person supplying the argument already owns the machine, so the realistic failure is the apostrophe, not an attack. The exposure that matters is a *file* someone else wrote, or a value that arrived from somewhere the user did not look at.

**Anti-pattern:** `!`curl -s https://api.example.com/search?q=$ARGUMENTS`` — unquoted, unbounded, network-dependent, and it hands raw user prose to a shell. Every one of those four is fixable except the last, which is fixed by not doing it.

---

## Review checklist

- Is each exclamation mark at line start or after whitespace?
- Has each command been run in a terminal, and timed?
- Is the output bounded — a limit, a stat, a head?
- Does each command have a fallback, so a missing tool produces a fact rather than a hole?
- Does anything print an environment, a config file, or a raw log?
- Does the body still make sense if an injection is empty or shows the policy-disabled string?
- Does any user-supplied argument reach a shell? If so, is it a constrained value, and is the placeholder quoted?
- Has it been invoked once with an argument containing an apostrophe?
- Is anything here mutating state, and should it be in the body instead?
