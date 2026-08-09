# Verifying a plugin: the deterministic half and the graded half

Open this before the first verification run of Phase 8, and again when a run comes back mixed and you are deciding what to fix. It carries what the body compresses: the full deterministic checklist with what each failure means, the collision procedure, the scorecard, and the two failure patterns that look identical in the numbers and want opposite fixes.

The organising claim: **most of what matters about a plugin is deterministic.** Does every component load, does every path resolve, does the validator pass, does each component appear where the documentation says it will. Those have right answers, so they are checked outright rather than sampled, and sampling them is a waste of budget that also produces a worse answer. Only one plugin-level question is a model judgement, and it is narrower than it first looks.

---

## The deterministic half

Load the plugin from disk, without installing it:

```bash
claude --plugin-dir /path/to/my-plugin
```

Then work the four listings. Each one answers "is this registered?", which is a different question from "does it work", and the difference is invisible anywhere else.

| Listing | Check | A miss means |
|---|---|---|
| `/help` | Every user-invocable skill and command is listed under the name you expect | It is not registered: wrong directory, wrong filename, or a `name` you did not expect |
| `/agents` | Every agent, under its full scoped identifier — `plugin:folder:name` where it sits in a subfolder | Not loaded. A `:` in the `name` field is the first thing to check, since it produces exactly this with no message |
| `/hooks` | Every hook, grouped under the event you registered it on | Either the JSON did not parse, the event name is not real, or the file is somewhere the loader does not scan |
| `/mcp` | Every server reaching connected, with its tool list | A lazily-connected server shows nothing until something uses it, so an empty tool list is not by itself a fault |

Then four checks the listings do not make:

1. **Every path resolves from the installed location, not yours.** Expand the plugin-root anchor to where the plugin actually sits and confirm each target exists — hook commands, MCP `command` and `args`, any script a skill body tells Claude to run. The validator does not resolve these, and a hook pointing at a missing script fails at runtime with nothing useful in the message.
2. **Every component appears where the documentation says.** Read the README as a specification and check it against the tree: a component the README names and the plugin does not carry, or carries under a different name, is a defect in whichever of the two is wrong.
3. **Hooks actually fire.** `claude --debug` during a session that should trigger one. A hook can be correctly listed in `/hooks` and still never match.
4. **Grants match real tool names.** For a plugin-bundled server, compare each `mcp__plugin_*` string in the plugin against the names in `/mcp`. A mismatch prompts for permission rather than erroring, so nothing in the session says it is wrong.

`claude plugin validate <plugin-dir> --strict` and the reviewer agents cover the static half of this list before you ever start a session; this pass is what confirms the runtime agrees with them.

Every item here is pass or fail. Report them that way — a percentage over a deterministic checklist hides which item failed, which is the only thing you needed to know.

---

## The model-judged half: collision

Whether a component fires on the right request is measured per component, and each sibling creator owns that loop: triggering for a skill or a command, delegation for an agent, tool selection for an MCP surface. Running those is not this file's subject.

The plugin-level question is the one **no per-component loop can see from inside a single component**: whether the components collide once they are installed together. Two skills that each score well in isolation will split each other's triggers when co-installed, and neither author's numbers show it — each sees only their own queries, each of which was answered by *something*.

**Step 1 — the static sweep.** Point the overlap checker at each skill in the plugin:

```bash
bun ../../../shared/validate/validate.ts --target-type skill <plugin>/skills/<name> --extended --with-environment
```

It flags a neighbour that both shares domain vocabulary and uses universal-quantifier phrasing, because that conjunction is what identifies a description that will actually steal triggers rather than merely sit nearby. Run it against the installed set *and* read its output for the plugin's own siblings: a pushy description crowds out the neighbours its own author shipped alongside it, which is the one collision entirely within your control.

**Step 2 — run the sets together.** Take each component's own trigger or delegation set and run them all with the whole plugin installed, rather than one component at a time. The unit of interest is a query written for component A that fires component B. That is a collision, it is invisible when the two are measured separately, and it is the only new information this half produces.

**Step 3 — attribute each miss.** For every query that did not route as intended, record what did happen. There are only four outcomes and they want different fixes:

| Outcome | What it means |
|---|---|
| The intended component fired | Nothing to do |
| A sibling in this plugin fired | A collision you own. One of the two descriptions has to narrow |
| A component outside the plugin fired | A collision you do not own. Narrow yours, or accept it and document it |
| Nothing fired; the model did the work itself | Not a collision. The description never made the work sound like it needed the component |

---

## The scorecard

One number over the whole plugin is the wrong output. Score per component and then grade.

| Column | What it is |
|---|---|
| `loads` | Pass or fail, from the deterministic half |
| `paths` | Pass or fail: every path this component names resolves from the installed location |
| `fires` | Share of its own queries that routed to it, with the whole plugin installed |
| `steals` | Number of *other* components' queries that routed to this one |
| `runs` | Queries × repetitions behind those shares — a rate over three runs is a rumour, so say the denominator |

Then a graded verdict rather than a pass/fail: name the weakest component, say which column is weak, and state the change.

**The two that look identical and want opposite fixes.** A component with a low `fires` score looks the same in the aggregate whichever of these it is, and the `steals` column of its neighbours is what tells them apart:

- **It is being out-competed.** Some sibling's `steals` count went up by roughly what this component's `fires` lost. The fix belongs to the *sibling* — narrow its description, or strip the universal-quantifier phrasing that is winning contests it should lose. Rewriting the losing component's description mostly does not work, because the failure lives in the pair rather than in either description alone.
- **It is not being reached at all.** No sibling gained; the model simply did the work itself, or nothing happened. The fix belongs to this component — its description names a topic rather than a deliverable, and it needs to say what the component produces.

Two more patterns worth naming:

- **High `fires` and high `steals` together** is not a strong component. It is a greedy one, and the finding belongs to it rather than to the siblings it is starving.
- **`loads` failing anywhere** invalidates every routing number in the same run. Fix the load failure and re-run before reading anything else; a component that is not registered cannot fire, and its zero says nothing about its description.

**What a passing score does not tell you.** These queries were derived from the components as they stand, so they cover what the plugin claims to do. A capability the plugin lacks produces no query and no failure — which is why the per-component inventories go in front of the user before the runs rather than after.

---

## Close the loop

This is a loop, not a checkpoint. A fix that renames or moves a component changes what both halves see: the deterministic listings, because the invocation name changed, and the routing numbers, because a renamed skill is a different competitor. So the last run has to be the one after the last change, and one clean pass on the first draft says nothing about the fifth.

Stop when the deterministic half is entirely clean and the graded half has no Critical or Major finding left standing, or when the remainder are collisions you have decided to accept and have written down in the README.
