# Designing and measuring the tool surface

Open this when you can edit the server's own source and are writing or revising its tool names, descriptions, input schemas or responses. If the server belongs to somebody else, none of that is a lever you hold — skip to "When the server is not yours to edit" at the end, which covers the two levers that remain.

A server's tools are a routing surface before they are an API. The model sees a name, a description and an input schema, and from those alone decides whether to call the tool, which one, and with what arguments. Everything the server can do is invisible until that decision goes the right way.

That makes tool design the same problem as description writing, and `../../../shared/references/description-writing.md` is the argument and the evidence. Read it first. This file is what changes when the artifact is a tool rather than a skill: there are usually several of them, they compete with each other and with built-ins, their arguments are structured, and their output lands in the context window and stays there.

---

## Naming

The name is read before the description and sometimes instead of it. It should say what the tool does to what.

| Before | After | Why |
|---|---|---|
| `query` | `search_issues` | `query` could belong to any of forty servers. The verb and the object together are the whole disambiguation |
| `get` / `get2` | `get_issue` / `get_issue_comments` | Numbered siblings are a naming failure being deferred to the model |
| `issueSearchV2` | `search_issues` | Version numbers and camelCase are for your codebase. The model matches on words |
| `do_action` | `transition_issue_status` | A generic name forces the model to read the description to find out whether the tool is relevant, and it may not |

Conventions worth holding to: `snake_case`, `verb_noun`, singular for one thing and plural for many (`get_issue`, `list_issues`). Where a server spans domains, prefix by domain rather than repeating the server name — `sprint_metrics` and `issue_search`, not `acme_get_sprint_metrics`, because the server name is already in the namespaced tool name and repeating it spends characters twice.

---

## Descriptions as a routing surface

The two failure modes are the ones a skill description has, and they arrive from opposite directions.

**Too vague** and the tool never gets picked, because a competing tool or a built-in said something more specific.

**Too greedy** and it gets picked for everything, which is worse: the wrong tool called confidently costs a round trip, pollutes context with an irrelevant response, and often produces a plausible wrong answer rather than an obvious failure.

Four criteria, and they are not quite the skill four. Numbers 1, 2 and 4 are the criteria in `../../../shared/references/description-writing.md` applied to a tool — its "deliverable clause" and its two rules about negatives, which collapse into one here because a tool's near-miss is nearly always a named sibling. Number 3 has no equivalent over there, because a skill does not compete with a built-in tool.

**1. Name the concrete return, not the topic.**

| Before | After |
|---|---|
| `Tool for working with issues.` | `Searches issues by full-text query, status, assignee and label. Returns matching issues with id, title, status, assignee and last-updated timestamp — not comment bodies or attachments.` |

The "after" version says what comes back, so the model can tell whether the tool answers the question in front of it. "Working with issues" cannot lose a routing contest because it never enters one.

**2. Exclude the neighbouring case, in the neighbour's vocabulary.**

An exclusion built from words that never appear in the positive clauses excludes nothing, because the near-miss arrives phrased in the positive vocabulary.

| Before | After |
|---|---|
| `Not for unrelated tasks.` | `To read one issue you already have the id for, use get_issue — this tool is for finding issues when you do not know which one you want. For comment text, use get_issue_comments.` |

Naming the sibling tool does double duty: it excludes this tool and routes to the right one, in a single clause the model reads at the moment it is deciding.

**3. Say when *not* to reach past a built-in.** A server exposing `read_file`, `run_query` or `search_code` is competing with `Read`, `Bash` and `Grep`. The model will pick one of them, and which one should win is a design decision you make, not one you leave to chance.

| Before | After |
|---|---|
| `Reads a file from the repository.` | `Reads a file from the indexed remote repository by path. Use for files in a repository not checked out locally; for a file in the current working tree, the built-in Read tool is faster and always current.` |

**4. No universal-quantifier pushiness.** `Always use this tool for anything involving issues` raises true positives at a disproportionate false-positive cost, and it poisons the neighbours — including the other tools on your own server, which is a strictly self-inflicted wound.

**Length.** A description is paid for on every turn, for every tool, in every session — a tool list is resident context in a way a skill body is not. Ten tools at 400 characters is a small standing charge; ten tools at 3,000 characters each is a real one. Spend the length on the four criteria and cut anything that is implementation detail, restatement, or a second exclusion aimed at the case the first one already covered.

---

## Input schemas

The schema is part of the routing surface, not just validation. A model reads the parameter names and their descriptions to work out whether the tool fits the request, and an unclear schema produces a correctly-chosen tool called with wrong arguments — which looks like a tool failure and gets diagnosed as one.

**Describe every property.** A property with a name and no description is a guess.

```json
{ "status": { "type": "string" } }
```

```json
{
  "status": {
    "type": "string",
    "enum": ["open", "in_progress", "blocked", "done"],
    "description": "Issue status. Omit to search all statuses."
  }
}
```

**Prefer enums to free strings** wherever the set is closed. An enum removes an entire class of retry: the model cannot pass `"in progress"` when the API wants `in_progress`, because the valid values are in front of it.

**Keep `required` genuinely minimal.** Every required property is a value the model has to find before it can call the tool at all, and one it may invent rather than admit it lacks. A tool requiring `project_id` when it could accept `project_name` forces a lookup call first — and that lookup is where chains break.

**Do not accept a blob.** `{ "params": { "type": "object" } }` moves the schema out of the schema. The model now has to know the shape from the description, which is exactly the job the schema exists to do, and nothing validates what it sends.

**Avoid overloaded switches.** A single `action` parameter taking `"create" | "update" | "delete"` collapses three tools into one whose required properties depend on the value of another property. Schemas express that poorly and models get it wrong. Three tools with three honest schemas route better and fail more legibly.

---

## Response shape is a context bill

A tool response enters the context window and stays there for the rest of the session. A tool that returns the upstream API's full payload is charging every future turn for fields nobody read.

**Before** — a search returning the API's raw objects:

```json
[{ "id": 1421, "key": "PROJ-1421", "self": "https://.../rest/api/3/issue/1421",
   "fields": { "summary": "...", "issuetype": { "self": "...", "id": "10004",
   "description": "", "iconUrl": "...", "name": "Bug", "subtask": false,
   "avatarId": 10303, "hierarchyLevel": 0 }, "watches": { "self": "...",
   "watchCount": 0, "isWatching": false }, "...": "40 more fields" } }]
```

**After** — the fields an agent acts on:

```json
{
  "total": 63,
  "returned": 20,
  "next_cursor": "eyJvIjoyMH0",
  "issues": [
    { "key": "PROJ-1421", "title": "Login retry loop on expired session",
      "status": "in_progress", "assignee": "rmoss", "updated": "2026-07-31T09:12:04Z" }
  ]
}
```

Three properties of the "after" shape are doing the work, and each is a failure avoided.

**`total` alongside `returned`** tells the model there is more without a second call, so it can decide between paginating and narrowing the query. A bare array of 20 items looks complete.

**An opaque `next_cursor`** is a value the model passes back unchanged. Offset pagination invites arithmetic, and arithmetic across a shifting result set silently skips and duplicates rows. Absent when there is no next page, so its presence is the whole signal.

**Nothing is truncated silently.** If you must cut a long field, say so in the payload — `"body_truncated": true` — because an agent that cannot see the truncation will answer confidently from a partial document. A truncation the model can see is a fact it can work with; one it cannot see is a fabrication waiting to happen.

Two more worth applying by default. Give a tool that can return a lot an explicit `limit`, with a sane default, so the model can ask for less. And where a caller only needs a subset, a `fields` parameter is cheaper than a second tool — but only when the set is enumerated in the schema, otherwise it is a blob by another name.

---

## Errors are instructions

An error message is read by a model deciding what to do next. Its job is to make the next attempt different from the last one, and the difference between a good and a bad error message is usually one retry loop.

| Before | After |
|---|---|
| `Error: 422` | `Unprocessable: "assignee" must be a username, not a display name. Received "Rae Moss". Try "rmoss".` |
| `Not found` | `No project matches "platform". Available projects: platform-web, platform-api, platform-infra. Retry with an exact name.` |
| `Unauthorized` | `The configured token lacks the issues:write scope. This tool cannot complete; ask the user to re-authorize with write access.` |
| `Rate limited` | `Rate limited. Retry after 30 seconds. Reduce cost by raising "limit" and paginating instead of calling per issue.` |
| `Invalid input` | `"since" must be ISO 8601 (2026-07-31 or 2026-07-31T09:12:04Z). Received "last tuesday".` |

The pattern in the right-hand column: state what was wrong, show what was received, and name a next action. The third row also does something the others do not — it says the tool *cannot* succeed on retry, which stops a loop that would otherwise run until something else does.

Distinguish the three cases explicitly, because they need different behaviour and a model cannot infer which is which from a status code: retryable as-is (rate limit, transient), retryable with different arguments (validation, not-found), and not retryable at all (permission, unsupported).

---

## Consolidation

The most common way a tool surface goes wrong is being a faithful mirror of an HTTP API. An API is designed for a program that already knows what it wants. A tool surface is consumed by a model deciding what it wants, and every hop in a chain is a place the chain breaks.

**Before** — four tools, one question:

```
list_projects()                  → find the project id
list_boards(project_id)          → find the board id
list_sprints(board_id)           → find the active sprint id
list_sprint_issues(sprint_id)    → finally, the issues
```

Four round trips, four responses in context, three ids the model has to carry, and four chances to pick the wrong row. The failure is quiet: pick the wrong board and you get a real, plausible, wrong answer.

**After** — one tool that answers the question:

```
get_active_sprint_issues(project: "platform-web", status?: "in_progress")
```

The lookups still happen; they happen inside the server, where they are code with a known-correct path rather than four model judgements. Context cost drops by roughly the three intermediate responses.

**When not to consolidate.** A mega-tool with a mode switch is not consolidation, it is the four tools with a worse schema. The test is whether the consolidated tool answers a question a user would actually ask. `get_active_sprint_issues` passes. `issue_operations(action, ...)` does not — nobody asks for an operation.

Keep the primitives available where they have independent uses; the point is that the common question should not require assembling them. And keep the *count* honest: a surface of forty tools is a routing problem in itself, because every one of them is resident context and a candidate on every turn. If forty is genuinely the right number, invest correspondingly in the exclusion clauses, since that is where forty tools are told apart.

---

## The checklist

Per tool:

- The name is `verb_noun` and says what it does to what
- The description names the concrete return, not the topic
- At least one exclusion, naming the sibling tool or built-in it defers to, in shared vocabulary
- No universal-quantifier phrasing
- Every schema property has a description; closed sets are enums; `required` is minimal
- No free-form object parameter standing in for a schema
- The response carries only fields an agent acts on
- Anything that can be long has `limit`, a `total`, and an opaque cursor
- Truncation is visible in the payload
- Every error says what was received and what to do differently, and marks whether a retry can succeed

Across the surface:

- No two tools' descriptions would both plausibly match the same request without one of them naming the other
- The primitives behind a consolidated tool are still reachable where they have independent uses
- The tool count is defensible, and every tool has earned its standing context cost

---

## Measuring whether the surface routes

The checklist above is judgement. This is evidence, and it is worth the cost once the surface is stable, the server is connected, and the question has become "does the model actually pick the right tool?" rather than "is this description any good?".

Whether the model picks the right tool is a model judgement, so it is measurable the way skill triggering is — and more directly. A skill eval infers a routing decision from a consult; a tool eval reads the tool call itself out of the transcript. Nothing is ambiguous about what counted.

**Synthesize the scenarios from the tool list and the schemas, not from the tool descriptions.** Generating scenarios from the descriptions you are about to optimize is circular: they inherit the descriptions' vocabulary, so every candidate scores well on the cases its own text suggested and the loop certifies the surface against itself. Worse, a capability the descriptions omit generates no scenario, so the omission is never penalised — and that omission is the defect you were looking for.

So read what the server *does*: every tool name, every input schema with its required properties and enums, the resources on offer, the server's README or upstream API docs. Report that inventory back before running anything — "this server appears to let you search issues, comment on them, and read sprint metrics; is that right?" A capability the user confirms that no description mentions is a finding before a single scenario runs, and a misread costs a turn instead of an iteration.

**Hard negatives come from three places**, and must be genuinely hard or the eval certifies everything:

- The neighbouring tool on the same server. `create_issue` versus `update_issue` versus `search_issues` is the discrimination that matters, and it is invisible to a set of clear positives.
- Built-ins that overlap. A server exposing `read_file` or `run_query` competes with `Read` and `Bash`, and whether the model should prefer yours is a design question whose answer belongs in the description.
- Co-installed neighbours. `bun ../../../shared/scripts/validate.ts --target-type skill <skill-dir> --with-environment` names installed skills competing for the same vocabulary; it reads skill descriptions, so point it at the skill fronting this server, because the neighbours it names contest your tool's scenarios too.

**Run each scenario headless with the server connected**, several times, because tool selection is sampled rather than deterministic and one run tells you close to nothing:

```bash
claude -p "<scenario query>" --output-format json > run.json
```

Load an uninstalled plugin from disk with `claude --plugin-dir <plugin-dir>`. A positive passes when a tool-use block names the intended tool; a hard negative passes when none does.

**Split, and select on the held-out half.** The description-optimization loop in `../../../shared/scripts/` runs exactly this shape for a skill description — 60/40 split, several runs per query, candidates proposed from what the train split failed, selection on held-out. It is **not** a drop-in here: it parses a `SKILL.md` and rewrites its `description`, and tool descriptions live in the server's own source rather than in the `.mcp.json` entry. Copy the shape. Select on held-out for the same reason it does — a surface tuned until it aces the scenarios that motivated it has usually just memorized them.

---

## The scoring pass

A single selection rate over the whole set is the wrong output, because it hides which tool is failing behind an average of tools that are fine. Score per tool, then grade.

**Per tool, three numbers and one name.**

| Column | What it is | Read it as |
|---|---|---|
| `chosen` | Of the scenarios written for this tool, the share where a tool-use block named it | Below the surface average is the tool to fix next |
| `lost_to` | When it was not chosen, which tool or built-in was | The single most actionable column; it names the fix |
| `false_positive` | Share of hard negatives where it was chosen anyway | High here with high `chosen` is a greedy description, not a good one |
| `runs` | Scenarios × repetitions behind those shares | A rate over three runs is a rumour; say the denominator |

**Then a graded verdict rather than a pass/fail.** Name the weakest tool, say what its `lost_to` column implies, and state the change. Four patterns cover nearly everything:

- **Lost to a sibling on the same server** — the two descriptions overlap and neither excludes the other. Add an exclusion to the *winner* naming the loser, written in the vocabulary the positives use. This is the most common result and the cheapest fix.
- **Lost to a built-in** (`Read`, `Grep`, `Bash`) — the description never says when to prefer the tool. Add the one sentence that does, with the condition in it.
- **Chosen for hard negatives** — greedy phrasing, usually a universal quantifier. Remove it; the true positives it was buying cost more in false positives than they returned.
- **Chosen for nothing at all** — the description names a topic rather than a return. Rewrite it to say what comes back, and re-measure before touching anything else.

A tool that scores well on its own scenarios and appears in another tool's `lost_to` column is not a success — it is the greedy neighbour, and the finding belongs to it rather than to the tool that lost.

**What a passing score does not tell you.** These scenarios were derived from the surface as it stands, so they cover what the tools claim to do. A capability the surface lacks entirely produces no scenario and no failure, which is why the inventory goes in front of the user before the run rather than after it.

**When the server is not yours to edit**, the description is not a lever and pretending otherwise wastes the loop. Two remain: narrow the grant so there are fewer wrong tools to pick from, and put routing guidance in the body of the skill that fronts the server ("to find an issue use `search_issues`; there is no need to list projects first").
