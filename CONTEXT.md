# plugin-kit

Builds the things that extend Claude Code, and measures whether each one works.
This glossary fixes the words. One word per concept, the same word every time.

## Language

### What gets built

**Component**:
A thing a plugin carries: a skill, a subagent, a hook, an MCP server, or a slash
command. The kit builds and measures five of them; hook authoring is parked under
`future/`.
_Avoid_: Artifact, target type

**Plugin**:
The container that carries components and installs as one unit.

**Skill**:
A `SKILL.md` and the files bundled beside it.

**Subagent**:
A component that runs in its own context under its own tool grant, defined by a
markdown file under `agents/`.
_Avoid_: Agent (alone), reviewer agent

**Prompt payload**:
Text a script sends to a model as part of a request. Claude Code does not know it
exists.
_Avoid_: Agent, prompt file

**Creator**:
The skill that authors one kind of component. Five ship.

**Reviewer**:
The subagent that audits one kind of component and reports findings without
changing it. Read-only by construction.
_Avoid_: Auditor, validator

**Finding**:
One defect a reviewer or a validator reports, carrying its own fix.

### Where files go inside a skill

**Load mode**:
What the model does with a bundled file: execute it, read it, or copy it into the
output. Load mode decides the directory, not the file type.

**Reference**:
A bundled file the model reads on demand. Lives in `references/`.

**Script**:
A bundled file the model runs without reading. Lives in `scripts/`.

**Asset**:
A bundled file the model copies into its output. Lives in `assets/`.

**Specimen**:
A complete example of a skill's input or output, valuable for its shape. Lives in
`examples/`.
_Avoid_: Sample, template

**Pointer**:
The sentence in a body that sends the model to a reference.

**Progressive disclosure**:
Keeping the body small by putting detail behind pointers, so a file costs tokens
only when it is needed.

### Measuring a component

**Triggering**:
Whether Claude reaches a component on a query that should route to it. A
competition between co-installed components, not a property of one.
_Avoid_: Firing, activation, invocation

**Delegation**:
Triggering, for a subagent.

**Description**:
The frontmatter text Claude routes on. The whole surface triggering is decided
from.

**Query**:
One user request in a trigger eval set.

**Trigger eval set**:
The queries a component is measured against, each marked should-trigger or
should-not-trigger.
_Avoid_: Test set, benchmark

**Hard negative**:
A should-not-trigger query written to be genuinely tempting. A set of easy ones
certifies everything.
_Avoid_: Distractor, near-miss

**Scenario**:
One task a component is run through end to end, to measure what it reads and what
it produces.

**Scenario set**:
The scenarios a component is measured against.

**Pull rate**:
How often a bundled file was read across the runs. Cannot separate *rarely
needed* from *needed and missed*.

**Recall**:
Reached, over should-have-reached. The keep-or-prune verdict rests on this rather
than on pull rate.

**Held-out split**:
The share of an eval set kept back from tuning, so a candidate is selected on
queries it never saw.
_Avoid_: Test split, validation set

**Weaker tier**:
The less capable model an experiment runs on. The strong model reaches nearly
everything and hides signposting defects, so only the weaker one detects them.

### Paths

**Path anchor**:
A variable naming a directory the plugin must not hardcode:
`${CLAUDE_PLUGIN_ROOT}` for shipped code, `${CLAUDE_PLUGIN_DATA}` for the
plugin's own state, `${CLAUDE_PROJECT_DIR}` for the user's project, and
`${CLAUDE_SKILL_DIR}` for one skill's directory.

**Pure Bun**:
The rule that nothing in this repository spawns `node`, `npx`, `python` or `uv`.
A `node:` builtin import satisfies it, because Bun implements those natively.
