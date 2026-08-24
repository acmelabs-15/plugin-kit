/**
 * The isolation proof: reading a child's surface, judging it, and folding many judgements.
 *
 * The module exists because a request for isolation and a proof of isolation look identical
 * in a run's output. Its tests have to be written the same way round, or they inherit the
 * defect they were added to catch: a test that hands `checkIsolation` a clean surface and
 * asserts `verified` passes just as happily against a function whose every check has been
 * commented out. So almost nothing below asserts a happy path. Each check gets its own
 * surface, broken in exactly one way, and the assertion names the branch it expects to fire.
 *
 * Three properties carry the contract.
 *
 *   - `parseIsolationSurface` returns null for everything that is not an init event, and
 *     never throws. It runs on every line of a stream whose other members are assistant
 *     messages, tool results and occasional garbage, so the interesting inputs are the
 *     malformed ones -- a scalar, an array, a truncated line, a `system` event of the wrong
 *     subtype. A parse that threw would crash the measurement it was added to protect.
 *
 *   - the surface it builds distinguishes ABSENT from EMPTY. `memory_paths` missing entirely
 *     is the fence holding; `memory_paths.auto` present is the contamination this module was
 *     written the day someone found. A parser that collapsed the two into `""` would report
 *     a clean run for the exact arrangement that motivated the file. The same distinction
 *     drives the length-preserving read of `plugins` and `mcp_servers`: the CLI emits both as
 *     objects in some versions, and a member that cannot be named still has to COUNT, because
 *     the count is what the check consults.
 *
 *   - `checkIsolation` is asymmetric on purpose, and the asymmetry is the part most likely to
 *     be "tidied" later. Hard checks are facts about the run's own arrangement and cannot
 *     false-positive on a CLI upgrade. The one soft check -- an unrecognised skill name --
 *     is a violation on the pinned version and a recorded caveat on any other. A test that
 *     got that backwards would silently make the guard brittle enough to be switched off,
 *     which is the failure mode the module's own comments say it is designed around. Both
 *     halves are asserted against the SAME skill name, so neither can pass by accident.
 *
 * The fixture is a real captured init event, measured 2026-08-24 against CLI 2.1.241. It is
 * a CONTAMINATED surface -- auto-memory loaded, both messaging tools advertised -- because
 * that is what an unfenced run actually looked like, and a fixture invented to be clean would
 * not have caught it either. The clean variant is built from it by removing exactly the two
 * things the fence is supposed to remove.
 *
 * Pure. This module reads no file and spawns nothing, so neither does its test: every branch
 * is reachable from a literal.
 */

import { describe, expect, test } from "bun:test";

import {
  BASELINE_CLAUDE_VERSION,
  BUILTIN_SKILLS,
  checkIsolation,
  createSurfaceReader,
  foldIsolation,
  IsolationStateSchema,
  MESSAGING_TOOLS,
  parseIsolationSurface,
  type IsolationExpectation,
  type IsolationState,
  type IsolationSurface,
  type IsolationVerdict,
} from "../isolation.ts";

// ---------------------------------------------------------------------------
// The measured fixture
// ---------------------------------------------------------------------------

/**
 * One real `system`/`init` line, exactly as CLI 2.1.241 emitted it on 2026-08-24.
 *
 * Kept as text rather than as an object literal, because the thing under test is a parse.
 * Reconstructing the line with `JSON.stringify` would test the parser against this file's
 * idea of the event shape instead of against the CLI's.
 */
const CAPTURED_INIT_LINE: string =
  '{"type":"system","subtype":"init","cwd":"/private/tmp/isoprobe-opfP50",' +
  '"session_id":"54fb82a7-900b-4ae8-a7ae-e586aed694a9",' +
  '"tools":["Task","Bash","Edit","Read","Skill","SendMessage","ListAgents","Write"],' +
  '"mcp_servers":[],"model":"claude-sonnet-5","permissionMode":"default",' +
  '"slash_commands":["probe-target-xyz123","doctor"],"apiKeySource":"none",' +
  '"claude_code_version":"2.1.241","output_style":"default",' +
  '"agents":["claude","Explore","general-purpose","Plan"],' +
  '"skills":["probe-target-xyz123","deep-research","design-sync","dataviz","update-config",' +
  '"verify","debug","code-review","simplify","batch","fewer-permission-prompts","doctor",' +
  '"loop","schedule","claude-api","run","run-skill-generator"],' +
  '"plugins":[],"memory_paths":{"auto":"/Users/peter.kloss/.claude/memory/"},' +
  '"messaging_socket_path":"/tmp/cc-socks/47064.sock"}';

/** The unique alias the measured run installed into its throwaway root. */
const TARGET = "probe-target-xyz123";

/** The throwaway root, as the harness holds it (unresolved) and as the child reports it. */
const ROOT_RESOLVED = "/private/tmp/isoprobe-opfP50";

/**
 * The captured surface with the two contaminations removed, and nothing else changed.
 *
 * Built by subtraction from the real event rather than assembled from scratch, so a field
 * whose realistic value would trip a check cannot be quietly omitted here.
 */
function cleanSurface(overrides: Partial<IsolationSurface> = {}): IsolationSurface {
  return {
    claudeVersion: BASELINE_CLAUDE_VERSION,
    cwd: ROOT_RESOLVED,
    skills: [TARGET, ...BUILTIN_SKILLS],
    agents: ["claude", "Explore", "general-purpose", "Plan"],
    slashCommands: [TARGET, "doctor"],
    plugins: [],
    mcpServers: [],
    tools: ["Task", "Bash", "Edit", "Read", "Skill", "Write"],
    autoMemoryPath: null,
    messagingSocketPath: null,
    ...overrides,
  };
}

function expectation(overrides: Partial<IsolationExpectation> = {}): IsolationExpectation {
  return { name: TARGET, kind: "skill", expect: "present", root: ROOT_RESOLVED, ...overrides };
}

/** Judge one surface against the default expectation, so each case states only its break. */
function judge(
  surface: IsolationSurface | null,
  expected: Partial<IsolationExpectation> = {},
  extra: { builtinSkills?: readonly string[]; baselineVersion?: string } = {},
): IsolationVerdict {
  return checkIsolation({ surface, expected: expectation(expected), ...extra });
}

/** The violation sentences as one blob, for asserting that a branch named its own subject. */
function violationText(verdict: IsolationVerdict): string {
  return verdict.violations.join(" ");
}

/** A verdict carrying only a state, for folding. Nothing in the fold reads the other fields. */
function stateOnly(state: IsolationState): IsolationVerdict {
  return { state, violations: [], cap: null, surface: null };
}

// ---------------------------------------------------------------------------
// Reading the line
// ---------------------------------------------------------------------------

describe("parseIsolationSurface", () => {
  test("reads every field it consults out of a real captured init event", () => {
    const surface = parseIsolationSurface(CAPTURED_INIT_LINE);
    expect(surface).not.toBeNull();
    expect(surface?.claudeVersion).toBe("2.1.241");
    expect(surface?.cwd).toBe("/private/tmp/isoprobe-opfP50");
    expect(surface?.skills).toContain(TARGET);
    expect(surface?.skills.length).toBe(17);
    expect(surface?.agents).toEqual(["claude", "Explore", "general-purpose", "Plan"]);
    expect(surface?.slashCommands).toEqual([TARGET, "doctor"]);
    expect(surface?.plugins).toEqual([]);
    expect(surface?.mcpServers).toEqual([]);
    expect(surface?.tools).toContain("SendMessage");
    expect(surface?.autoMemoryPath).toBe("/Users/peter.kloss/.claude/memory/");
    expect(surface?.messagingSocketPath).toBe("/tmp/cc-socks/47064.sock");
  });

  // Every line of the stream reaches this function, and all but one of them is something
  // else. Returning null rather than throwing is the contract; a throw here would take the
  // measurement down with it.
  test.each([
    ['{"type":"assistant","message":{"role":"assistant","content":[]}}', "an assistant event"],
    ['{"type":"result","subtype":"success","is_error":false}', "a result event"],
    ['{"type":"system","subtype":"compact_boundary"}', "a system event of another subtype"],
    ['{"type":"system"}', "a system event with no subtype at all"],
    ['{"subtype":"init","cwd":"/tmp/x"}', "an init-shaped event with no type"],
  ])("returns null for %s (%s)", (line) => {
    expect(parseIsolationSurface(line)).toBeNull();
  });

  test.each([
    ["", "an empty line"],
    ["not json at all", "prose"],
    ['{"type":"system","subtype":"ini', "a truncated line"],
    ["{,}", "broken punctuation"],
  ])("returns null rather than throwing for %s (%s)", (line) => {
    expect(parseIsolationSurface(line)).toBeNull();
  });

  // Valid JSON that is not an object. `typeof null === "object"` is the one that would get
  // through a naive guard and throw on property access.
  test.each([["null"], ["7"], ['"init"'], ["true"], ['["type","system"]'], ["[]"]])(
    "returns null for the JSON scalar or array %s",
    (line) => {
      expect(parseIsolationSurface(line)).toBeNull();
    },
  );

  // The distinction the module was written for. Absent means the fence held; present means
  // the operator's cross-session instructions were in the child's system prompt.
  test("an absent memory_paths reads as null, which is the fence holding", () => {
    const surface = parseIsolationSurface('{"type":"system","subtype":"init","cwd":"/tmp/x"}');
    expect(surface?.autoMemoryPath).toBeNull();
  });

  test("a present memory_paths.auto is carried verbatim", () => {
    const surface = parseIsolationSurface(
      '{"type":"system","subtype":"init","memory_paths":{"auto":"/Users/op/.claude/memory/"}}',
    );
    expect(surface?.autoMemoryPath).toBe("/Users/op/.claude/memory/");
  });

  test.each([
    ['{"type":"system","subtype":"init","memory_paths":{}}', "an empty memory_paths object"],
    ['{"type":"system","subtype":"init","memory_paths":null}', "an explicitly null memory_paths"],
    [
      '{"type":"system","subtype":"init","memory_paths":{"auto":7}}',
      "a non-string memory_paths.auto",
    ],
  ])("reads %s as no auto-memory (%s)", (line) => {
    expect(parseIsolationSurface(line)?.autoMemoryPath).toBeNull();
  });

  test("an absent messaging_socket_path reads as null", () => {
    expect(
      parseIsolationSurface('{"type":"system","subtype":"init","cwd":"/tmp/x"}')
        ?.messagingSocketPath,
    ).toBeNull();
  });

  // The count is the whole question asked of `plugins` and `mcp_servers`, and the CLI emits
  // them as objects in some versions. A member that cannot be named still has to count, or
  // the object form silently reports a clean run.
  test("object-form plugins and mcp_servers keep both their count and their names", () => {
    // The CLI emits these as strings in some versions and as objects in others, and the
    // reader has to survive both without the violation sentence degrading into placeholders
    // an operator cannot act on. "2 plugins were loaded" tells them to go looking; "brain,
    // oncall" tells them which two.
    const surface = parseIsolationSurface(
      '{"type":"system","subtype":"init",' +
        '"plugins":[{"name":"brain","version":"1"},{"name":"oncall"}],' +
        '"mcp_servers":[{"name":"figma","status":"connected"}]}',
    );
    expect(surface?.plugins).toEqual(["brain", "oncall"]);
    expect(surface?.mcpServers).toEqual(["figma"]);
  });

  test("string-form plugins and mcp_servers keep their names", () => {
    const surface = parseIsolationSurface(
      '{"type":"system","subtype":"init","plugins":["brain","oncall"],"mcp_servers":["figma"]}',
    );
    expect(surface?.plugins).toEqual(["brain", "oncall"]);
    expect(surface?.mcpServers).toEqual(["figma"]);
  });

  test("a member carrying no name still counts, so the length cannot under-report", () => {
    // The placeholder is reserved for a member that genuinely has no name to recover. It
    // exists so an unreadable entry cannot silently shrink the count -- under-reporting how
    // many plugins were loaded is the one failure mode that reads as clean.
    const surface = parseIsolationSurface(
      '{"type":"system","subtype":"init","plugins":["brain",{"name":"oncall"},null]}',
    );
    expect(surface?.plugins).toEqual(["brain", "oncall", "<unnamed plugin>"]);
  });

  test.each([
    ['{"type":"system","subtype":"init"}', "a missing key"],
    ['{"type":"system","subtype":"init","plugins":{},"mcp_servers":"none"}', "a non-array value"],
  ])("reads %s as no plugins and no servers (%s)", (line) => {
    const surface = parseIsolationSurface(line);
    expect(surface?.plugins).toEqual([]);
    expect(surface?.mcpServers).toEqual([]);
  });

  test("missing scalars fall back rather than making the surface null", () => {
    const surface = parseIsolationSurface('{"type":"system","subtype":"init"}');
    expect(surface).not.toBeNull();
    expect(surface?.claudeVersion).toBe("unknown");
    expect(surface?.cwd).toBe("");
    expect(surface?.skills).toEqual([]);
    expect(surface?.tools).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Reading it out of a stream
// ---------------------------------------------------------------------------

describe("createSurfaceReader", () => {
  test("forwards every line unchanged and returns the wrapped value verbatim", () => {
    const seen: string[] = [];
    const reader = createSurfaceReader<string>((line) => {
      seen.push(line);
      return line === "keep" ? "kept" : undefined;
    });
    expect(reader.onLine("keep")).toBe("kept");
    // `undefined` is a value the wrapper must pass through rather than normalise, since the
    // harnesses use it to mean "this line was not the one I wanted".
    expect(reader.onLine("drop")).toBeUndefined();
    expect(reader.onLine(CAPTURED_INIT_LINE)).toBeUndefined();
    expect(seen).toEqual(["keep", "drop", CAPTURED_INIT_LINE]);
  });

  test("captures an init event appearing anywhere in the stream", () => {
    const reader = createSurfaceReader<undefined>(() => undefined);
    reader.onLine('{"type":"assistant","message":{}}');
    reader.onLine("garbage");
    expect(reader.surface()).toBeNull();
    reader.onLine(CAPTURED_INIT_LINE);
    reader.onLine('{"type":"result","subtype":"success"}');
    expect(reader.surface()?.cwd).toBe(ROOT_RESOLVED);
  });

  // The surface the run BEGAN under is the one its numbers were produced against, so a
  // second init event must not overwrite the first.
  test("keeps the first init event when a stream carries two", () => {
    const reader = createSurfaceReader<undefined>(() => undefined);
    reader.onLine(CAPTURED_INIT_LINE);
    reader.onLine('{"type":"system","subtype":"init","cwd":"/somewhere/else"}');
    expect(reader.surface()?.cwd).toBe(ROOT_RESOLVED);
  });

  test("is null when no init line ever arrives, which is unverified rather than clean", () => {
    const reader = createSurfaceReader<undefined>(() => undefined);
    for (const line of ['{"type":"result"}', "", "not json"]) reader.onLine(line);
    expect(reader.surface()).toBeNull();
    expect(judge(reader.surface()).state).toBe("unverified");
  });
});

// ---------------------------------------------------------------------------
// Judging the surface
// ---------------------------------------------------------------------------

describe("checkIsolation", () => {
  test("a null surface is unverified, and the cap refuses to claim a clean run", () => {
    const verdict = judge(null);
    expect(verdict.state).toBe("unverified");
    expect(verdict.violations).toEqual([]);
    expect(verdict.surface).toBeNull();
    expect(verdict.cap).not.toBeNull();
    // The sentence has to say which of the two a reader is holding. "Not checked" reading
    // as "checked and clean" is the entire failure this module exists to prevent.
    expect(verdict.cap).toContain("not verified");
    expect(verdict.cap).toContain("NOT been shown");
    expect(verdict.cap).not.toContain("Isolation was verified");
  });

  test("a clean surface is verified, with nothing to caveat", () => {
    const verdict = judge(cleanSurface());
    expect(verdict.state).toBe("verified");
    expect(verdict.violations).toEqual([]);
    expect(verdict.cap).toBeNull();
    // The surface is carried through, so a reader can audit the judgement rather than
    // trust it.
    expect(verdict.surface?.cwd).toBe(ROOT_RESOLVED);
  });

  test("the captured contaminated event fails as it stood on the day it was measured", () => {
    const surface = parseIsolationSurface(CAPTURED_INIT_LINE);
    const verdict = judge(surface);
    expect(verdict.state).toBe("violated");
    expect(violationText(verdict)).toContain("Auto-memory was loaded from");
    expect(violationText(verdict)).toContain("cross-session messaging tool(s)");
    expect(verdict.cap).toContain("Isolation FAILED");
  });

  // --- the artifact itself -------------------------------------------------

  test("the target missing when it was expected present is a violation", () => {
    const verdict = judge(cleanSurface({ skills: [...BUILTIN_SKILLS] }));
    expect(verdict.state).toBe("violated");
    expect(violationText(verdict)).toContain("was NOT visible to the child");
    expect(violationText(verdict)).toContain(TARGET);
    // The consequence, not just the fact: a floored rate is worse than a missing one,
    // because it looks like a result.
    expect(violationText(verdict)).toContain("floored rather than measured");
  });

  test("the target present on a control arm is a violation, the other way round", () => {
    const verdict = judge(cleanSurface(), { expect: "absent" });
    expect(verdict.state).toBe("violated");
    expect(violationText(verdict)).toContain("WAS visible to a child");
    expect(violationText(verdict)).toContain("measured the treatment rather than the control");
  });

  test("the target absent on a control arm is exactly right", () => {
    const verdict = judge(cleanSurface({ skills: [...BUILTIN_SKILLS] }), { expect: "absent" });
    expect(verdict.state).toBe("verified");
  });

  // --- the run's arrangement -----------------------------------------------

  test("a loaded plugin is a violation, named", () => {
    const verdict = judge(cleanSurface({ plugins: ["brain", "oncall"] }));
    expect(verdict.state).toBe("violated");
    expect(violationText(verdict)).toContain("2 plugin(s) were loaded");
    expect(violationText(verdict)).toContain("brain, oncall");
  });

  test("an unnameable plugin still counts, so the object form cannot slip past", () => {
    const verdict = judge(cleanSurface({ plugins: ["<unnamed plugin>"] }));
    expect(verdict.state).toBe("violated");
    expect(violationText(verdict)).toContain("1 plugin(s) were loaded");
  });

  test("a connected MCP server is a violation, named", () => {
    const verdict = judge(cleanSurface({ mcpServers: ["figma"] }));
    expect(verdict.state).toBe("violated");
    expect(violationText(verdict)).toContain("MCP server(s) were connected");
    expect(violationText(verdict)).toContain("figma");
  });

  test("a loaded auto-memory directory is a violation, named", () => {
    const verdict = judge(cleanSurface({ autoMemoryPath: "/Users/op/.claude/memory/" }));
    expect(verdict.state).toBe("violated");
    expect(violationText(verdict)).toContain("Auto-memory was loaded from");
    expect(violationText(verdict)).toContain("/Users/op/.claude/memory/");
  });

  test.each([
    ["SendMessage", ["SendMessage"]],
    ["ListAgents", ["ListAgents"]],
    ["SendMessage, ListAgents", ["SendMessage", "ListAgents"]],
  ] as const)("an advertised messaging tool set (%s) is a violation, named", (named, extra) => {
    const verdict = judge(cleanSurface({ tools: ["Read", ...extra, "Write"] }));
    expect(verdict.state).toBe("violated");
    expect(violationText(verdict)).toContain(`messaging tool(s) ${named} were advertised`);
  });

  test("a tool merely resembling a messaging tool is not one", () => {
    const verdict = judge(cleanSurface({ tools: ["Read", "SendMessageDraft", "listagents"] }));
    expect(verdict.state).toBe("verified");
  });

  // --- the working directory -----------------------------------------------

  test("a child running outside the throwaway root is a violation, quoting both paths", () => {
    const verdict = judge(cleanSurface({ cwd: "/Users/op/Dev/real-project" }));
    expect(verdict.state).toBe("violated");
    expect(violationText(verdict)).toContain("rather than the throwaway root");
    expect(violationText(verdict)).toContain("/Users/op/Dev/real-project");
    expect(violationText(verdict)).toContain(ROOT_RESOLVED);
  });

  // macOS resolves /tmp to /private/tmp, and the init event reports the resolved form while
  // the harness holds what it created. Treating those as different roots would fail every
  // run on the platform this is developed on.
  test("a /private-resolved cwd matches the /tmp root the harness created", () => {
    const verdict = judge(cleanSurface({ cwd: "/private/tmp/isoprobe-x" }), {
      root: "/tmp/isoprobe-x",
    });
    expect(verdict.state).toBe("verified");
  });

  test("the same normalisation applies to the root, not only to the cwd", () => {
    const verdict = judge(cleanSurface({ cwd: "/tmp/isoprobe-x" }), {
      root: "/private/tmp/isoprobe-x",
    });
    expect(verdict.state).toBe("verified");
  });

  test.each([
    ["/tmp/isoprobe-x/", "/private/tmp/isoprobe-x"],
    ["/private/tmp/isoprobe-x/", "/tmp/isoprobe-x"],
  ])("a trailing slash on the root %s does not invent a mismatch", (root, cwd) => {
    expect(judge(cleanSurface({ cwd }), { root }).state).toBe("verified");
  });

  test("normalisation does not make two genuinely different roots equal", () => {
    expect(judge(cleanSurface({ cwd: "/private/tmp/other" }), { root: "/tmp/isoprobe-x" }).state).toBe(
      "violated",
    );
  });

  // --- the soft check ------------------------------------------------------

  // Both halves of the calibration, asserted against the SAME name, so neither can pass by
  // accident. Hard on the pinned version; a caveat on any other, because failing hard the
  // morning after an auto-update produces a guard someone deletes.
  const STRAY = "operator-private-skill";

  test("an unexpected skill is a violation on the pinned CLI version", () => {
    const verdict = judge(cleanSurface({ skills: [TARGET, ...BUILTIN_SKILLS, STRAY] }));
    expect(verdict.state).toBe("violated");
    expect(violationText(verdict)).toContain("1 unexpected skill(s) were visible");
    expect(violationText(verdict)).toContain(STRAY);
  });

  test("the same unexpected skill is only a caveat on a different CLI version", () => {
    const verdict = judge(
      cleanSurface({ skills: [TARGET, ...BUILTIN_SKILLS, STRAY], claudeVersion: "2.9.999" }),
    );
    expect(verdict.state).toBe("verified");
    expect(verdict.violations).toEqual([]);
    // The caveat has to say what it could not stand behind: the pinned version, the
    // version actually seen, and the name it declined to judge.
    expect(verdict.cap).toContain(BASELINE_CLAUDE_VERSION);
    expect(verdict.cap).toContain("2.9.999");
    expect(verdict.cap).toContain(STRAY);
  });

  // The list is an allow-list. `schedule` is genuinely absent from an unauthenticated child,
  // and a run that lacks a built-in has not been contaminated by anything.
  test("a built-in missing from the child is not a finding", () => {
    const verdict = judge(cleanSurface({ skills: [TARGET] }));
    expect(verdict.state).toBe("verified");
    expect(verdict.cap).toBeNull();
  });

  test("the target itself is never counted as an unexpected skill", () => {
    const verdict = judge(cleanSurface({ skills: [TARGET] }));
    expect(violationText(verdict)).not.toContain(TARGET);
  });

  // --- which list a kind is looked up in -----------------------------------

  test("an agent target is looked for among agents, not among skills", () => {
    // The name IS in `skills` on this surface, so a check reading the wrong list would
    // report it visible and pass.
    const verdict = judge(cleanSurface(), { kind: "agent" });
    expect(verdict.state).toBe("violated");
    expect(violationText(verdict)).toContain("The agent under test");
    expect(violationText(verdict)).toContain("was NOT visible to the child");
  });

  test("an agent target present among agents is visible", () => {
    // `skills` is overridden because an agent run installs `.claude/agents/<alias>.md` and
    // nothing under `.claude/skills/`, so a real child would not list the alias there. The
    // allow-list exempts the artifact's name only for a SKILL target, which makes that
    // override load-bearing rather than cosmetic -- see the case below.
    const verdict = judge(
      cleanSurface({ skills: [...BUILTIN_SKILLS], agents: ["claude", TARGET] }),
      { kind: "agent" },
    );
    expect(verdict.state).toBe("verified");
  });

  test("a skill sharing the agent-under-test's name is contamination, not the target", () => {
    // The exemption is granted per surface list. An agent named `foo` does not license a
    // SKILL named `foo` to be present -- that skill is a separate installation that can
    // steal the very triggers the run is measuring, which is exactly what must be noticed.
    const verdict = judge(cleanSurface({ agents: ["claude", TARGET] }), { kind: "agent" });
    expect(verdict.state).toBe("violated");
    expect(violationText(verdict)).toContain(TARGET);
  });

  test("a command target is looked for among slash commands", () => {
    const clean = cleanSurface({ skills: [...BUILTIN_SKILLS] });
    expect(judge(clean, { kind: "command" }).state).toBe("verified");
    const missing = judge({ ...clean, slashCommands: ["doctor"] }, { kind: "command" });
    expect(missing.state).toBe("violated");
    expect(violationText(missing)).toContain("The command under test");
  });

  // --- accumulation --------------------------------------------------------

  test("every simultaneous violation is reported, not just the first", () => {
    const verdict = judge(
      cleanSurface({
        skills: [...BUILTIN_SKILLS, "stray-one"],
        plugins: ["brain"],
        mcpServers: ["figma"],
        autoMemoryPath: "/Users/op/.claude/memory/",
        tools: ["Read", "SendMessage"],
        cwd: "/Users/op/Dev/real-project",
      }),
    );
    expect(verdict.state).toBe("violated");
    const text = violationText(verdict);
    for (const fragment of [
      "was NOT visible to the child",
      "plugin(s) were loaded",
      "MCP server(s) were connected",
      "Auto-memory was loaded from",
      "messaging tool(s) SendMessage were advertised",
      "rather than the throwaway root",
      "unexpected skill(s) were visible",
    ]) {
      expect(text).toContain(fragment);
    }
    expect(verdict.violations.length).toBe(7);
    // The cap carries the sentences rather than replacing them with a count, so a reader
    // who sees only the envelope still learns what went wrong.
    expect(verdict.cap).toContain("Isolation FAILED");
    expect(verdict.cap).toContain("Auto-memory was loaded from");
  });

  // --- recorded, not checked -----------------------------------------------

  // The child binds its own inbox and registers itself before any flag this repository
  // controls is consulted, so the registration is not a defect the harness can fix. Making
  // it a violation would fail every clean run; dropping it would hide a live channel.
  test("a residual messaging inbox is a caveat on a verified run, never a violation", () => {
    const verdict = judge(cleanSurface({ messagingSocketPath: "/tmp/cc-socks/47064.sock" }));
    expect(verdict.state).toBe("verified");
    expect(verdict.violations).toEqual([]);
    expect(verdict.cap).toContain("Isolation was verified, with caveats");
    expect(verdict.cap).toContain("/tmp/cc-socks/47064.sock");
    // Why it is recorded rather than fixed. A reader who learns only that a socket exists
    // will file a bug against the spawn flags, which is not where the channel comes from.
    expect(verdict.cap).toContain("is not preventable from the spawn side");
  });

  test("both caveats appear together when both apply", () => {
    const verdict = judge(
      cleanSurface({
        claudeVersion: "2.9.999",
        skills: [TARGET, ...BUILTIN_SKILLS, STRAY],
        messagingSocketPath: "/tmp/cc-socks/1.sock",
      }),
    );
    expect(verdict.state).toBe("verified");
    expect(verdict.cap).toContain(STRAY);
    expect(verdict.cap).toContain("/tmp/cc-socks/1.sock");
  });

  // --- injection -----------------------------------------------------------

  test("a supplied builtinSkills list replaces the measured one", () => {
    // Nothing is a built-in any more, so every name the child listed is unexpected.
    const strict = judge(cleanSurface(), {}, { builtinSkills: [] });
    expect(strict.state).toBe("violated");
    expect(violationText(strict)).toContain(`${BUILTIN_SKILLS.length} unexpected skill(s)`);

    // And a name the measured list does not carry can be admitted without editing it.
    const widened = judge(
      cleanSurface({ skills: [TARGET, STRAY] }),
      {},
      { builtinSkills: [STRAY] },
    );
    expect(widened.state).toBe("verified");
  });

  test("a supplied baselineVersion decides which side of the soft check a run lands on", () => {
    const surface = cleanSurface({ claudeVersion: "3.0.0", skills: [TARGET, STRAY] });
    // Against the module's pinned baseline this is a caveat...
    expect(judge(surface).state).toBe("verified");
    // ...and against a baseline that matches the child, the same surface is a violation.
    const pinned = judge(surface, {}, { baselineVersion: "3.0.0" });
    expect(pinned.state).toBe("violated");
    expect(violationText(pinned)).toContain(STRAY);
  });

  test("the caveat quotes the supplied baseline rather than the module's", () => {
    const verdict = judge(
      cleanSurface({ claudeVersion: "3.0.0", skills: [TARGET, ...BUILTIN_SKILLS, "stray"] }),
      {},
      { baselineVersion: "2.0.0" },
    );
    expect(verdict.state).toBe("verified");
    expect(verdict.cap).toContain("2.0.0");
    expect(verdict.cap).toContain("3.0.0");
    expect(verdict.cap).toContain("stray");
  });

  test("a stale pin over a clean skill list produces no caveat at all", () => {
    // The calibration that keeps the guard usable. The CLI updates itself, so the pin goes
    // stale on its own within days; a caveat attached to every clean run from that moment on
    // is one readers learn to scroll past, and the next real one goes with it.
    const verdict = judge(cleanSurface({ claudeVersion: "3.0.0" }), {}, { baselineVersion: "2.0.0" });
    expect(verdict.state).toBe("verified");
    expect(verdict.cap).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Folding a sweep
// ---------------------------------------------------------------------------

/**
 * A sweep is only as isolated as its worst run. Every case below is about that ordering, not
 * about the majority: a rate computed over four hundred runs of which one was contaminated is
 * a contaminated rate, and a fold that reported the common case would be reporting the number
 * the reader must not trust.
 */
describe("foldIsolation", () => {
  test("no verdicts at all is unverified, never verified", () => {
    expect(foldIsolation([])).toBe("unverified");
  });

  test("all verified is verified", () => {
    expect(foldIsolation([stateOnly("verified"), stateOnly("verified")])).toBe("verified");
  });

  test("one violation among many clean runs wins", () => {
    const verdicts = [
      ...Array.from({ length: 20 }, () => stateOnly("verified")),
      stateOnly("violated"),
      ...Array.from({ length: 20 }, () => stateOnly("verified")),
    ];
    expect(foldIsolation(verdicts)).toBe("violated");
  });

  test("one unchecked run among many clean ones downgrades the sweep", () => {
    expect(
      foldIsolation([stateOnly("verified"), stateOnly("unverified"), stateOnly("verified")]),
    ).toBe("unverified");
  });

  test("violated beats unverified, because a known break outranks an unknown one", () => {
    expect(foldIsolation([stateOnly("unverified"), stateOnly("violated")])).toBe("violated");
    expect(foldIsolation([stateOnly("violated"), stateOnly("unverified")])).toBe("violated");
  });

  test("a single verdict folds to itself, for the three states a run can produce", () => {
    for (const state of ["verified", "violated", "unverified"] as const) {
      expect(foldIsolation([stateOnly(state)])).toBe(state);
    }
  });

  /**
   * Documenting current behaviour rather than endorsing it. `not-applicable` is defined as
   * "the operation spawns no child, so there is no surface to read", but the fold's second
   * clause is `state !== "verified"`, so a sweep made entirely of operations that spawn
   * nothing reports `unverified` -- "we did not check" for something there was nothing to
   * check. That is the same conflation the state enum exists to prevent, one level up.
   */
  test("not-applicable survives only a unanimous fold, and any mixture downgrades it", () => {
    // The enum draws this distinction deliberately -- "there was nothing to check" against
    // "a check that should have happened did not" -- and a fold that collapsed the first
    // into the second would commit, one level up, the conflation the enum exists to prevent.
    // A MIXTURE is genuinely `unverified` though: some units spawned a child and those were
    // not checked.
    expect(foldIsolation([stateOnly("not-applicable")])).toBe("not-applicable");
    expect(foldIsolation([stateOnly("not-applicable"), stateOnly("not-applicable")])).toBe(
      "not-applicable",
    );
    expect(foldIsolation([stateOnly("verified"), stateOnly("not-applicable")])).toBe("unverified");
    expect(foldIsolation([stateOnly("violated"), stateOnly("not-applicable")])).toBe("violated");
  });

  test("the fold reads checkIsolation's own output, not only hand-built states", () => {
    const clean = judge(cleanSurface());
    const dirty = judge(cleanSurface({ plugins: ["brain"] }));
    expect(foldIsolation([clean, clean])).toBe("verified");
    expect(foldIsolation([clean, dirty])).toBe("violated");
    expect(foldIsolation([clean, judge(null)])).toBe("unverified");
  });
});

// ---------------------------------------------------------------------------
// The measured constants
// ---------------------------------------------------------------------------

describe("the measured baseline", () => {
  test("BUILTIN_SKILLS is non-empty and carries no duplicate", () => {
    expect(BUILTIN_SKILLS.length).toBeGreaterThan(0);
    expect(new Set(BUILTIN_SKILLS).size).toBe(BUILTIN_SKILLS.length);
  });

  test("MESSAGING_TOOLS names both instruments a child could reach a session with", () => {
    expect(MESSAGING_TOOLS.length).toBeGreaterThan(0);
    expect(new Set(MESSAGING_TOOLS).size).toBe(MESSAGING_TOOLS.length);
    expect(MESSAGING_TOOLS).toContain("SendMessage");
    expect(MESSAGING_TOOLS).toContain("ListAgents");
  });

  // The pin is what the soft check compares against, so a value that does not look like a
  // version would silently put every run on the caveat side of the calibration.
  test("BASELINE_CLAUDE_VERSION is the version the built-in list was measured against", () => {
    expect(BASELINE_CLAUDE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(parseIsolationSurface(CAPTURED_INIT_LINE)?.claudeVersion).toBe(BASELINE_CLAUDE_VERSION);
  });

  test("every state the module can return survives the schema, so each is a real wire value", () => {
    for (const state of ["verified", "violated", "unverified", "not-applicable"]) {
      expect(IsolationStateSchema.safeParse(state).success).toBe(true);
    }
    expect(IsolationStateSchema.safeParse("clean").success).toBe(false);
  });
});
