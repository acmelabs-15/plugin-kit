# Arguments and substitutions: what a command renders to

This is the file to open when the question is *"what text will the model actually receive?"*

Everything here is safe to copy verbatim. This file is read into context, not rendered as a command, so the placeholders below arrive intact rather than being substituted on the way in.

---

## When substitution happens

Claude Code renders the file **once, over the original text, before Claude sees anything**. In order:

1. Argument placeholders and the `${CLAUDE_*}` values are resolved throughout the text — **including inside the load-time shell commands themselves**, which is what lets an injected command be specific to this invocation.
2. Those shell commands run, now carrying the resolved values, and their output replaces the placeholders as plain text (`load-time-injection.md`).
3. The finished text enters the conversation as one message.

Three consequences follow:

- **Nothing is re-scanned.** The search for injection placeholders happened over the original file, so neither an argument nor a command's output can introduce one. A user who types `/note $ARGUMENTS` does not get a second expansion.
- **An argument that reaches a shell reaches it unescaped.** Step 1 is plain text replacement with no shell quoting, so an apostrophe in an argument is a syntax error and `$(...)` in an argument is a command. `load-time-injection.md` has the detail and the design rule; the short version is not to interpolate free text into an injection.
- **The model cannot see the source.** Claude receives the rendered result. It never sees which placeholder produced which word, so a wrong placeholder does not look wrong to it — it looks like what you meant.

---

## The four argument forms

| Form | Expands to | Notes |
|---|---|---|
| `$ARGUMENTS` | everything after the command name, as typed, quotes and all | one blob, unsplit |
| `$ARGUMENTS[N]` | argument number N, **0-based** | `$ARGUMENTS[0]` is the first |
| `$N` | shorthand for `$ARGUMENTS[N]` | `$0` is the first, `$1` is the **second** |
| `$name` | a name declared in the `arguments:` frontmatter list | names map to positions in declaration order |

### `$0` is the first argument

The shorthand indexes the same 0-based array the long form does. It is not the shell convention, where `$1` is the first argument and `$0` is the program name.

```
/migrate-component SearchBar React Vue
```

| Placeholder | Value |
|---|---|
| `$ARGUMENTS` | `SearchBar React Vue` |
| `$ARGUMENTS[0]` / `$0` | `SearchBar` |
| `$ARGUMENTS[1]` / `$1` | `React` |
| `$ARGUMENTS[2]` / `$2` | `Vue` |

Writing `$1` where you meant the first argument shifts every slot by one and renders silently. It is the single commonest rendering bug in this family, and one invocation of the real command finds it.

### Splitting and quoting

Indexed access splits the input using shell-style quoting, so a multi-word value needs quotes to stay one argument.

```
/my-command "hello world" second
```

- `$0` → `hello world`
- `$1` → `second`
- `$ARGUMENTS` → `"hello world" second` — the full string as typed, quote characters included

That last row is the one that surprises people. `$ARGUMENTS` is not the joined array; it is the raw text. If you interpolate it into a shell command, the quotes come along.

---

## Named arguments

Declare names in frontmatter and reference them as `$name` in the body. Names map to argument positions in declaration order — they are labels for positions, not keyword arguments, so the user still types values positionally.

Both value forms are accepted:

```yaml
arguments: [issue, branch]
```

```yaml
arguments: issue branch
```

```markdown
---
name: start-fix
description: Begin work on an issue in a new branch
argument-hint: "[issue-number] [branch-name]"
arguments: [issue, branch]
---

Start work on issue $issue in a branch named $branch.
```

`/start-fix 412 fix/login-safari` renders as:

```text
Start work on issue 412 in a branch named fix/login-safari.
```

Names earn their place once the file is long enough that `$2` stops being self-explanatory, or once a value is referenced in several paragraphs. A four-line command with one argument does not need them.

---

## Too few arguments, too many, and none

The three cases behave differently, and the differences decide how your command fails in a stranger's hands.

| Situation | What happens |
|---|---|
| Indexed placeholder with no argument behind it | **Stays in the text unchanged.** Claude receives the literal `$2` |
| Named placeholder with no argument behind it | Expands to the **empty string**. The sentence loses a word |
| `$ARGUMENTS` with no arguments at all | Expands to the empty string |
| More arguments than placeholders | The surplus is still in `$ARGUMENTS` and still reachable by index; nothing errors |
| Arguments passed, but the file contains no `$ARGUMENTS` | Claude Code appends `ARGUMENTS: <what the user typed>` to the end of the content |

That last row is a safety net, not a design. It means a command that forgot its placeholder still shows Claude the input, but as an unexplained trailer rather than in the sentence where it belonged.

**Input** — `.claude/commands/triage.md`

```markdown
---
name: triage
description: Triage an incoming bug report
arguments: [severity, component]
---

Triage this as a $severity issue in $component. Cross-check $1 against the owners file.
```

**Invocation** `/triage p1`

**Output** — what the model receives

```text
Triage this as a p1 issue in . Cross-check $1 against the owners file.
```

Two failures in one line, both silent: `$component` vanished, and `$1` — which is the *second* argument, `$component` again — survived as literal text. Neither raised anything.

Since neither form stops on a missing argument, say what should happen in the body:

```markdown
Triage this as a $severity issue in $component.

If either the severity or the component is missing, ask for it before doing anything else — do not guess a severity.
```

---

## Escaping a literal dollar sign

A single backslash directly before the token escapes it:

| Written | Renders as |
|---|---|
| `\$1.00` | `$1.00` |
| `\$ARGUMENTS` | `$ARGUMENTS` |
| `\$issue` (with `issue` declared) | `$issue` |
| `\$PATH` | `\$PATH` — backslash left in place, because `PATH` is not a digit, `ARGUMENTS`, or a declared name |
| `\\$1` | `\\$1` with `$1` **still expanded** — both backslashes stay and the escape does not apply |

The rule is narrow on purpose: only a single backslash, directly before a token that would otherwise expand. A prose command that discusses prices, regexes or shell snippets is the usual place this bites — `$1,200` in a body with one argument declared becomes `SearchBar,200`.

There is no documented escape for the braced `${CLAUDE_*}` forms. If a file needs to *discuss* one rather than use it, spell it out in prose, or put the discussion in a reference file like this one, which is read rather than rendered.

---

## The `${CLAUDE_*}` substitutions

| Variable | Value |
|---|---|
| `${CLAUDE_SESSION_ID}` | the current session ID — log filenames, session-scoped scratch files, correlating output with a session |
| `${CLAUDE_EFFORT}` | the active effort level: `low`, `medium`, `high`, `xhigh`, `max` |
| `${CLAUDE_SKILL_DIR}` | the directory containing this file. For a plugin skill this is the skill's own subdirectory, **not** the plugin root |
| `${CLAUDE_PROJECT_DIR}` | the project root — the same path hooks and MCP servers receive |

`${CLAUDE_PROJECT_DIR}` requires Claude Code v2.1.196 or later.

`${CLAUDE_SKILL_DIR}` and `${CLAUDE_PROJECT_DIR}` are substituted in **two** places: the markdown body, and `Bash(...)` rules inside `allowed-tools`. Using the same variable in both is how a bundled script runs without a permission prompt — the rule and the instruction are generated from one source, so they cannot drift apart.

```markdown
---
name: render-chart
description: Render a chart from a CSV file
allowed-tools: Bash(bun ${CLAUDE_SKILL_DIR}/scripts/render.ts *)
---

Run `bun ${CLAUDE_SKILL_DIR}/scripts/render.ts <csv-file>` to render the chart.
```

Installed at `~/.claude/skills/render-chart/`, both occurrences expand to that directory, the permission rule matches the exact command the body names, and nothing prompts.

A hardcoded path breaks the moment someone else installs the file, and a bare relative path resolves against the user's working directory rather than the file's. Neither fails loudly.

---

## Stacking commands in one message

Typing several at the start of a message loads them all and passes the trailing text to each as `$ARGUMENTS`:

```
/write-tests /fix-issue 123
```

Both load; both receive `123`.

Claude Code expands the first plus up to five more. Expansion stops at the first token that is not an inline user-invocable command — a command that runs as a forked subagent ends the run there, and so does one whose own arguments may start with a slash. That token and everything after it become the argument text for every command that did expand.

Two design consequences:

- A command intended to be stacked should tolerate arguments that were meant for its neighbour. If it cannot, it should say so in the body rather than acting on them.
- A command with `context: fork` cannot be stacked *after* anything. If stacking matters, do not fork it.

---

## Worked pairs

### Free text, one blob

**Input** — `.claude/commands/fix-issue.md`

```markdown
---
name: fix-issue
description: Fix a GitHub issue by number, following house coding standards
argument-hint: "[issue-number]"
disable-model-invocation: true
---

Fix GitHub issue $ARGUMENTS following our coding standards.

1. Read the issue description
2. Implement the fix
3. Write tests
4. Create a commit
```

**Invocation** `/fix-issue 123`

**Output**

```text
Fix GitHub issue 123 following our coding standards.

1. Read the issue description
2. Implement the fix
3. Write tests
4. Create a commit
```

### Positional, three slots

**Input**

```markdown
---
name: migrate-component
description: Migrate a component from one framework to another
argument-hint: "[component] [from-framework] [to-framework]"
---

Migrate the $0 component from $1 to $2.
Preserve all existing behavior and tests.
```

**Invocation** `/migrate-component SearchBar React Vue`

**Output**

```text
Migrate the SearchBar component from React to Vue.
Preserve all existing behavior and tests.
```

Written with the long form, `$ARGUMENTS[0]` / `$ARGUMENTS[1]` / `$ARGUMENTS[2]`, it renders identically. Written on the shell habit — `$1` / `$2` / `$3` — it renders as "Migrate the React component from Vue to $3", which reads as a plausible instruction and is wrong.

### A quoted argument

**Input**

```markdown
---
name: label
description: Apply a label to an issue
arguments: [issue, text]
---

Add the label "$text" to issue $issue.
Raw input was: $ARGUMENTS
```

**Invocation** `/label 412 "needs design review"`

**Output**

```text
Add the label "needs design review" to issue 412.
Raw input was: 412 "needs design review"
```

The named placeholder got the unquoted value; `$ARGUMENTS` kept the quote characters. If you are pasting `$ARGUMENTS` into a shell command inside the body, that difference is the bug you are about to write.

### Session-scoped output path

**Input**

```markdown
---
name: session-logger
description: Log activity for this session to a session-scoped file
---

Log the following to logs/${CLAUDE_SESSION_ID}.log:

$ARGUMENTS
```

**Invocation** `/session-logger deploy started`

**Output**

```text
Log the following to logs/0f9c2a1e-....log:

deploy started
```

---

## Checklist for a render review

- Is every index 0-based? `$0` is the first argument
- Does every `$name` in the body appear in the `arguments:` list, and every declared name get used?
- Does `argument-hint` name the same slots, in the same order, that the body reads?
- What does the body do when an argument is missing — is there an instruction, or just a hole?
- If `$ARGUMENTS` goes into a shell command, are the quotes handled?
- Is there a literal dollar sign anywhere in the prose that needs escaping?
