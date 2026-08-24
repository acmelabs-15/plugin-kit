/**
 * Per-run proof that a spawned child saw only what it was meant to see.
 *
 * WHY A PROOF RATHER THAN A FLAG
 * ------------------------------
 * `util/subprocess.ts` documents, at length and with measurements, the flags that isolate a
 * spawned `claude -p` from the operator's machine. Every one of those measurements was made
 * once, by hand, on one machine, against one version of the CLI. What ships afterwards is a
 * REQUEST for isolation: an argv array that was correct when someone last checked.
 *
 * That is the same shape of claim `installState` exists to distrust. A sweep that reports
 * `absent` because it could not look is indistinguishable, in the output, from one that
 * looked and found nothing -- so the envelope refuses to let the two share a word. Isolation
 * has the identical problem one layer down: a flag that stopped working, a CLI upgrade that
 * renamed a setting source, a machine whose config reaches the child by a route nobody
 * measured, all produce a run that looks exactly like a clean one. Nothing in the output
 * disagrees, because nothing in the output was ever about the child's actual surface.
 *
 * So the child is asked. Every `claude -p --output-format stream-json --verbose` run emits a
 * `system`/`init` event as its FIRST line, and that event enumerates what the child can
 * reach: its skills, its plugins, its MCP servers, its tools, and the directory its
 * auto-memory is loaded from. The proof reads that line -- which the run was already
 * producing and already parsing -- and asserts the surface is the artifact under test plus
 * Claude Code's own built-ins and nothing else.
 *
 * The cost is one JSON parse of a line already in hand. No extra spawn, no extra API call,
 * no per-sweep probe. That is what makes it affordable to run on EVERY run rather than once
 * per sweep, and running on every run is the point: a sweep-level probe establishes that the
 * first child was clean and says nothing about the four hundredth.
 *
 * WHAT IT CAUGHT ON THE DAY IT WAS WRITTEN
 * ----------------------------------------
 * Measured, 2026-08-24, CLI 2.1.241, in an empty temporary project root with exactly one
 * skill installed and `--setting-sources project --strict-mcp-config` applied -- the flags
 * the repository already believed were sufficient:
 *
 *   "memory_paths": { "auto": "/Users/<operator>/.claude/memory/" }
 *
 * and, asked directly, the child quoted that file's first heading back verbatim. The
 * operator's private cross-session memory index -- a couple of hundred lines of behavioural
 * instruction accumulated over months, none of it about the artifact under test -- was in
 * the system prompt of every eval child and every grader this repository has ever spawned.
 * `--setting-sources project` does not fence it, because the auto-memory directory is not
 * resolved through the setting-source allow-list.
 *
 * Nothing in the harness could have noticed. There is no flag whose absence it would have
 * shown up in, and the contamination is the kind that moves a number without breaking a run.
 *
 * WHAT IS CHECKED HARD, AND WHAT IS CHECKED SOFTLY
 * ------------------------------------------------
 * The surface fields split into two groups with different fragility, and conflating them
 * would make the proof either weak or annoying enough to be switched off.
 *
 * The HARD checks are version-independent facts about the run's own arrangement: the
 * artifact under test is visible (or, on a control arm, is not), no plugin is loaded, no MCP
 * server is connected, no auto-memory directory is in play, the messaging tools are absent,
 * and the child is running in the throwaway root the run built for it. None of these can
 * false-positive on a CLI upgrade, and every one of them is a route contamination has
 * actually taken or could take tomorrow.
 *
 * The SOFT check is the built-in skill allow-list. Claude Code ships skills of its own, they
 * are legitimately present, and the set changes between releases -- so an unrecognised name
 * is a violation on the version the list was measured against, and a recorded caveat on any
 * other. Failing hard there would halt every sweep the morning after an auto-update, and a
 * guard that halts sweeps for a benign reason is a guard that gets deleted.
 *
 * Pure Bun. No spawned tool, no filesystem access -- the surface arrives as text.
 */

import { z } from "zod@4.1.0";

import { MESSAGING_TOOLS } from "./util/subprocess.ts";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * Whether the run's isolation was established, and how it failed if it was not.
 *
 * The same four-way distinction `InstallStateSchema` draws, for the same reason: "we did not
 * check" and "we checked and it was clean" are opposite claims that a two-valued field would
 * render identically.
 *
 *   verified        The child's surface was read and matched the artifact plus built-ins.
 *   violated        The surface was read and carried something else. The run measured a
 *                   different arrangement from the one it reports, and its numbers are void.
 *   unverified      No surface was read. The init event was absent, unparseable, or the
 *                   caller did not collect one. Never write it to mean "probably clean".
 *   not-applicable  The operation spawns no child, so there is no surface to read.
 */
export const IsolationStateSchema = z.enum([
  "verified",
  "violated",
  "unverified",
  "not-applicable",
]);
export type IsolationState = z.infer<typeof IsolationStateSchema>;

/** The artifact kinds that can be installed into a child's project root and looked for. */
export type IsolationTargetKind = "skill" | "agent" | "command";

/**
 * What the child said it could reach, read from its `system`/`init` event.
 *
 * Deliberately a flat record of exactly the fields the checks below consult, rather than the
 * whole init event. The event carries a great deal else -- session ids, output styles,
 * analytics flags -- and widening this type would invite checks on fields whose meaning
 * nobody has established.
 */
export interface IsolationSurface {
  /** `claude_code_version`. The key that decides whether the built-in list still applies. */
  readonly claudeVersion: string;
  /** The child's resolved working directory. */
  readonly cwd: string;
  readonly skills: readonly string[];
  readonly agents: readonly string[];
  readonly slashCommands: readonly string[];
  readonly plugins: readonly string[];
  readonly mcpServers: readonly string[];
  readonly tools: readonly string[];
  /** `memory_paths.auto`, or null when the child loads no auto-memory at all. */
  readonly autoMemoryPath: string | null;
  /**
   * The inbox the child bound for cross-session messaging, or null when it bound none.
   *
   * Recorded rather than checked. A child binds its own socket and registers itself in the
   * peer directory before any flag this repository controls is consulted, so its presence is
   * not a defect the harness can fix -- see {@link MESSAGING_TOOLS} for what the harness can
   * do. Carrying it makes the residual channel visible per run instead of forgotten.
   */
  readonly messagingSocketPath: string | null;
}

/** The outcome of one proof. Shaped like `InstallSighting`, and for the same reasons. */
export interface IsolationVerdict {
  readonly state: IsolationState;
  /** One sentence per hard check that failed. Empty unless `state` is `violated`. */
  readonly violations: readonly string[];
  /** A sentence for `provenance.caps`, or null when there is nothing to say. */
  readonly cap: string | null;
  /** What was read, so a reader can audit the judgement rather than trust it. */
  readonly surface: IsolationSurface | null;
}

// ---------------------------------------------------------------------------
// The measured baseline
// ---------------------------------------------------------------------------

/**
 * The CLI version {@link BUILTIN_SKILLS} was measured against.
 *
 * Compared against the child's own `claude_code_version`. A mismatch does not invalidate the
 * hard checks -- those are about the run's arrangement, not about what ships in the binary --
 * but it does downgrade an unrecognised skill name from a violation to a caveat.
 */
export const BASELINE_CLAUDE_VERSION = "2.1.241";

/**
 * Skills Claude Code ships in the binary, present in every child regardless of isolation.
 *
 * Measured 2026-08-24 at {@link BASELINE_CLAUDE_VERSION}, by spawning into an empty
 * temporary root holding one skill and reading the init event. Established as built-in
 * rather than inherited by running the same spawn twice, once with the operator's real
 * `HOME` and once with `HOME` pointed at an empty directory: both runs reported the same
 * set, which no user-scope or plugin-scope skill could survive.
 *
 * An ALLOW-LIST, so a name missing from a child is not a finding -- `schedule` is absent
 * from an unauthenticated child, and a run that legitimately lacks a built-in has not been
 * contaminated by anything. Only an EXTRA name is evidence.
 *
 * One entry deserves a note because it looks like a leak and is not: `deep-research` is both
 * a Claude Code built-in and, on the machine this was measured on, a user-scope skill. The
 * `HOME`-stripped run is what tells them apart, and it is why this list is measured rather
 * than assembled by subtracting the operator's inventory -- that subtraction would have
 * reported a false violation on every run.
 */
export const BUILTIN_SKILLS: readonly string[] = [
  "batch",
  "claude-api",
  "code-review",
  "dataviz",
  "debug",
  "deep-research",
  "design-sync",
  "doctor",
  "fewer-permission-prompts",
  "loop",
  "run",
  "run-skill-generator",
  "schedule",
  "simplify",
  "update-config",
  "verify",
];

/**
 * Tools that let a child reach a DIFFERENT Claude Code session, and must not be advertised.
 *
 * IMPORTED from the spawn layer rather than restated, because this list and the
 * `--disallowedTools` argument built from it are two encodings of one fact. Written out
 * twice, a third tool added to one and not the other fails invisibly: the deny would be
 * incomplete while the check reported clean, or the reverse. Re-exported so a reader of the
 * proof does not have to know which layer owns it.
 *
 * This is the channel a spawned eval worker used, observed live on 2026-08-24, to message
 * the session orchestrating its own sweep and escalate its scenario's fictional dilemma as
 * though it were real work. The child had been asked to role-play a scenario; the session it
 * reached had no idea a scenario existed.
 *
 * The child is not enrolled by inheriting anything. It unsets the parent's socket and token
 * on its first line of setup, binds an inbox of its own, registers itself in the shared peer
 * directory under `HOME`, and finds its neighbours by scanning that directory -- so no amount
 * of environment scrubbing severs it. What DOES sever it is denying the tools: measured, a
 * bare name passed to `--disallowedTools` is filtered out of the advertised tool list
 * entirely rather than merely denied at call time, so a child given this deny has no
 * instrument with which to reach anyone. Verified by reading the init event's own `tools`
 * array, which is the same line this proof already parses.
 *
 * Checked here as well as requested in `util/subprocess.ts` because the request is the part
 * that can silently stop working.
 */
export { MESSAGING_TOOLS };

// ---------------------------------------------------------------------------
// Reading the surface
// ---------------------------------------------------------------------------

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

/**
 * Read a list whose members may be bare strings or `{name}` objects, preserving its LENGTH.
 *
 * ONE reader for every list, and the uniformity is the point rather than tidiness. An
 * earlier draft filtered non-strings out of `tools`, `skills` and `agents` while padding
 * `plugins` and `mcp_servers`, on the grounds that only the latter two were known to appear
 * in object form. That asymmetry hardened exactly the two fields whose object form would
 * fail LOUDLY -- a dropped plugin reads as clean, and someone would eventually notice a
 * plugin they knew was loaded -- and left the one whose object form fails SILENTLY. A
 * `tools` list of objects would have emptied the array, found no `SendMessage` in it, and
 * reported `verified` on the precise check that exists because a spawned worker used that
 * channel live.
 *
 * A guard that fails to CLEAN is worse than no guard, because it is believed. So the name is
 * recovered from either encoding, and a member carrying neither still counts toward the
 * length: an unnamed member is not a reason to under-report how many there were.
 */
function labelsOf(value: unknown, unnamed: string): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    if (typeof entry === "string") return entry;
    if (typeof entry === "object" && entry !== null) {
      const name = (entry as Record<string, unknown>)["name"];
      if (typeof name === "string") return name;
    }
    return unnamed;
  });
}

/**
 * Read one `stream-json` line, returning a surface only if it is the init event.
 *
 * Returns null rather than throwing for every other line, because this is called on every
 * line of a stream whose other members are assistant messages and tool results. A parse
 * failure is also null: the harness's own readers already tolerate an unparseable line, and
 * a proof that crashes a measurement it was added to protect is a worse outcome than one
 * that reports `unverified`.
 *
 * `plugins` is read defensively. The CLI emits it as an array whose members are objects in
 * some versions and strings in others, and the only question asked of it is whether it is
 * empty -- so the length is taken from the raw array while the names, used only in the
 * violation sentence, come from whichever members happen to be strings.
 */
export function parseIsolationSurface(line: string): IsolationSurface | null {
  let event: unknown;
  try {
    event = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof event !== "object" || event === null) return null;
  const record = event as Record<string, unknown>;
  if (record["type"] !== "system" || record["subtype"] !== "init") return null;

  const memory = record["memory_paths"];
  const autoMemory =
    typeof memory === "object" && memory !== null
      ? (memory as Record<string, unknown>)["auto"]
      : undefined;

  return {
    claudeVersion: stringOr(record["claude_code_version"], "unknown"),
    cwd: stringOr(record["cwd"], ""),
    skills: labelsOf(record["skills"], "<unnamed skill>"),
    agents: labelsOf(record["agents"], "<unnamed agent>"),
    slashCommands: labelsOf(record["slash_commands"], "<unnamed command>"),
    plugins: labelsOf(record["plugins"], "<unnamed plugin>"),
    mcpServers: labelsOf(record["mcp_servers"], "<unnamed server>"),
    tools: labelsOf(record["tools"], "<unnamed tool>"),
    autoMemoryPath: typeof autoMemory === "string" ? autoMemory : null,
    messagingSocketPath:
      typeof record["messaging_socket_path"] === "string"
        ? record["messaging_socket_path"]
        : null,
  };
}

/**
 * A line handler that keeps the first init event it sees and forwards every line onward.
 *
 * Exists so a caller can add the proof to an existing stream reader without restructuring
 * it. The three measurement harnesses each drive `runStreamingLines` with a handler that
 * owns the decision, and wrapping is the only change that does not put this module in the
 * path of that decision.
 *
 * The FIRST init event is kept and later ones ignored. A stream carries exactly one today;
 * keeping the first is the choice that stays correct if that ever stops being true, since
 * the surface the run began under is the one its numbers were produced against.
 */
export function createSurfaceReader<T>(
  onLine: (line: string) => T | undefined,
): {
  readonly onLine: (line: string) => T | undefined;
  readonly surface: () => IsolationSurface | null;
} {
  let seen: IsolationSurface | null = null;
  return {
    onLine: (line: string): T | undefined => {
      if (seen === null) {
        const parsed = parseIsolationSurface(line);
        if (parsed !== null) seen = parsed;
      }
      return onLine(line);
    },
    surface: () => seen,
  };
}

// ---------------------------------------------------------------------------
// Judging the surface
// ---------------------------------------------------------------------------

/**
 * macOS resolves `/tmp` to `/private/tmp`, and the init event reports the resolved form
 * while the harness holds the path it created. Stripping the prefix from both is narrower
 * than calling `realpath` -- it needs no filesystem access, and this module deliberately
 * touches none.
 */
function normalizeRoot(path: string): string {
  const withoutPrivate = path.startsWith("/private/") ? path.slice("/private".length) : path;
  return withoutPrivate.endsWith("/") ? withoutPrivate.slice(0, -1) : withoutPrivate;
}

/** Which surface member an artifact of this kind announces itself in. */
function surfaceListFor(kind: IsolationTargetKind, surface: IsolationSurface): readonly string[] {
  if (kind === "agent") return surface.agents;
  if (kind === "command") return surface.slashCommands;
  return surface.skills;
}

export interface IsolationExpectation {
  /** The unique alias the run installed, as the child would name it. */
  readonly name: string;
  readonly kind: IsolationTargetKind;
  /**
   * Whether the artifact should be visible.
   *
   * `absent` is not a hypothetical: `measure-outcomes` runs a control arm into a root with
   * nothing installed, and a control that can see the artifact is measuring the treatment.
   */
  readonly expect: "present" | "absent";
  /** The throwaway root the run built. The child must be running in it. */
  readonly root: string;
}

/**
 * Decide whether one run's child was isolated.
 *
 * Pure, and separated from the reading for the reason `decideInstallState` is separated from
 * its sweep: the rule is the part worth testing exhaustively, and every branch of it is
 * reachable from a literal without arranging a machine to produce one.
 */
export function checkIsolation(params: {
  readonly surface: IsolationSurface | null;
  readonly expected: IsolationExpectation;
  readonly builtinSkills?: readonly string[];
  readonly baselineVersion?: string;
}): IsolationVerdict {
  const surface = params.surface;
  if (surface === null) {
    return {
      state: "unverified",
      violations: [],
      surface: null,
      cap:
        `Isolation was not verified: the child emitted no readable \`init\` event, so what ` +
        `it could reach was never established. The run has NOT been shown to have measured ` +
        `the artifact under test in isolation from the operator's machine.`,
    };
  }

  const expected = params.expected;
  const builtins = new Set(params.builtinSkills ?? BUILTIN_SKILLS);
  const baseline = params.baselineVersion ?? BASELINE_CLAUDE_VERSION;
  const violations: string[] = [];

  // The artifact itself. A run whose child never saw the target measured the absence of the
  // target, and every rate it reports is a floor rather than a result -- which is exactly
  // how the skill-execution grant defect read before anyone found it.
  const visible = surfaceListFor(expected.kind, surface);
  const isVisible = visible.includes(expected.name);
  if (expected.expect === "present" && !isVisible) {
    violations.push(
      `The ${expected.kind} under test (\`${expected.name}\`) was NOT visible to the child. ` +
        `It reached for nothing, so every rate this run reports is floored rather than measured.`,
    );
  }
  if (expected.expect === "absent" && isVisible) {
    violations.push(
      `The ${expected.kind} \`${expected.name}\` WAS visible to a child that was meant to run ` +
        `without it, so this arm measured the treatment rather than the control.`,
    );
  }

  if (surface.plugins.length > 0) {
    violations.push(
      `${surface.plugins.length} plugin(s) were loaded (${surface.plugins.join(", ")}). The ` +
        `operator's plugin inventory competes with the artifact under test, and a run made ` +
        `under it is not reproducible on another machine.`,
    );
  }

  if (surface.mcpServers.length > 0) {
    violations.push(
      `${surface.mcpServers.length} MCP server(s) were connected ` +
        `(${surface.mcpServers.join(", ")}). No measurement here needs one, and each is a ` +
        `tool surface the artifact under test did not ask for.`,
    );
  }

  if (surface.autoMemoryPath !== null) {
    violations.push(
      `Auto-memory was loaded from \`${surface.autoMemoryPath}\`. Its \`MEMORY.md\` is ` +
        `injected verbatim into the child's system prompt, so the operator's accumulated ` +
        `instructions were part of the context this run measured.`,
    );
  }

  const messaging = MESSAGING_TOOLS.filter((tool) => surface.tools.includes(tool));
  if (messaging.length > 0) {
    violations.push(
      `The cross-session messaging tool(s) ${messaging.join(", ")} were advertised to the ` +
        `child, so it could reach the session orchestrating its own sweep. A spawned worker ` +
        `has done exactly that.`,
    );
  }

  // A child that reported no working directory has not been shown to have run in the root
  // the harness built, which is the same non-answer `installState` refuses to call `absent`.
  if (surface.cwd === "") {
    violations.push(
      `The child reported no working directory, so it was never established that it ran in ` +
        `the throwaway root \`${expected.root}\` rather than in the operator's own project.`,
    );
  } else if (normalizeRoot(surface.cwd) !== normalizeRoot(expected.root)) {
    violations.push(
      `The child ran in \`${surface.cwd}\` rather than the throwaway root ` +
        `\`${expected.root}\`, so its project scope was not the one this run built.`,
    );
  }

  // The soft check. Anything the child listed that is neither a built-in nor the artifact
  // reached it through a scope the isolation flags were supposed to close.
  //
  // The artifact is exempted only when it IS a skill. An agent or command under test lives
  // in a different surface list, so adding its name here would exempt an unrelated SKILL
  // that happened to share it -- which is an exemption granted to precisely the kind of
  // name collision this check exists to notice.
  // Conditioned on `expect` as well as on kind. On a control arm the artifact's name is the
  // one name that must NOT be there, so exempting it would grant the allow-list's protection
  // to precisely the name under suspicion. The hard check above catches that case today and
  // phrases it better, which is exactly why this would go unnoticed if the hard check were
  // ever gated or softened.
  const allowed = new Set(
    expected.kind === "skill" && expected.expect === "present"
      ? [...builtins, expected.name]
      : builtins,
  );
  const unexpected = surface.skills.filter((name) => !allowed.has(name));
  const versionMatches = surface.claudeVersion === baseline;
  if (unexpected.length > 0 && versionMatches) {
    violations.push(
      `${unexpected.length} unexpected skill(s) were visible (${unexpected.join(", ")}). ` +
        `Neither the artifact under test nor a Claude Code built-in, so they arrived through ` +
        `a scope the isolation flags were meant to close.`,
    );
  }

  // What the check could not stand behind, gathered before the verdict so that a VIOLATED
  // run keeps them too. A contaminated run is the one a reader studies hardest, and dropping
  // its caveats on the floor is the wrong moment to become terse.
  const notes: string[] = [];
  if (!versionMatches && unexpected.length > 0) {
    // Gated on there being something to caveat. The CLI updates itself, so an ungated note
    // would attach to every clean run within days of the pin going stale -- and a caveat
    // that appears on everything is one readers learn to skip past.
    notes.push(
      `the built-in skill list is pinned to CLI ${baseline} and this child ran ` +
        `${surface.claudeVersion}, so ${unexpected.length} unrecognised skill name(s) were ` +
        `recorded rather than treated as contamination (${unexpected.join(", ")})`,
    );
  }
  if (surface.messagingSocketPath !== null) {
    notes.push(
      `the child still bound a cross-session inbox at \`${surface.messagingSocketPath}\` and ` +
        `registered itself among the operator's live sessions -- it cannot address a session ` +
        `it can no longer enumerate, but the registration itself is not preventable from the ` +
        `spawn side`,
    );
  }

  if (violations.length > 0) {
    return {
      state: "violated",
      violations,
      surface,
      cap:
        `Isolation FAILED for this run, so its numbers describe an arrangement other than ` +
        `the one reported: ${violations.join(" ")}` +
        (notes.length === 0 ? "" : ` Also noted: ${notes.join("; ")}.`),
    };
  }

  return {
    state: "verified",
    violations: [],
    surface,
    cap: notes.length === 0 ? null : `Isolation was verified, with caveats: ${notes.join("; ")}.`,
  };
}

/**
 * Fold many per-run verdicts into the one a sweep's envelope carries.
 *
 * A sweep is only as isolated as its worst run, which is why a single violation wins: a rate
 * computed over four hundred runs of which one was contaminated is a contaminated rate, and
 * reporting the majority verdict would be reporting the number the reader must not trust.
 * `unverified` beats `verified` for the same reason one step weaker -- a run nobody could
 * check is not evidence of a clean sweep.
 *
 * `not-applicable` is handled explicitly rather than falling through to `unverified`,
 * because the enum draws that distinction deliberately and a fold that erases it commits the
 * conflation the enum exists to prevent, one level up. It survives only when EVERY verdict
 * carries it; mixed with anything else it means some units spawned a child and some did not,
 * and the ones that did were not checked.
 */
export function foldIsolation(verdicts: readonly IsolationVerdict[]): IsolationState {
  if (verdicts.length === 0) return "unverified";
  if (verdicts.some((verdict) => verdict.state === "violated")) return "violated";
  if (verdicts.every((verdict) => verdict.state === "not-applicable")) return "not-applicable";
  if (verdicts.some((verdict) => verdict.state !== "verified")) return "unverified";
  return "verified";
}

// ---------------------------------------------------------------------------
// Collecting a sweep's worth
// ---------------------------------------------------------------------------

/** Accumulates per-run verdicts into the one state and the few sentences a sweep reports. */
export interface IsolationLedger {
  readonly record: (verdict: IsolationVerdict) => void;
  readonly state: () => IsolationState;
  /** Deduplicated cap sentences, each carrying how many runs produced it. */
  readonly caps: () => readonly string[];
  readonly counts: () => Readonly<Record<IsolationState, number>>;
}

/**
 * A sweep-wide ledger, so a harness spends one import and one call per run on this.
 *
 * TWO behaviours here rather than at the call sites, because both were got wrong in the
 * obvious first draft.
 *
 * Caps are DEDUPLICATED and counted. A contaminated machine contaminates every run
 * identically, so the naive version appends the same sentence four hundred times and the
 * envelope's `caps` array -- the field whose whole purpose is that a reader will actually
 * read it -- becomes unreadable. `12 of 400 runs: <sentence>` says strictly more in one line.
 *
 * The FIRST violation prints to stderr immediately. Isolation is a property of the machine
 * rather than of a run, so if run one is contaminated then run four hundred will be too, and
 * the operator should learn that while the sweep is still cheap to stop rather than from a
 * field in a file afterwards. It prints once per ledger and not once per run, because four
 * hundred identical warnings is the same unreadability one channel over.
 *
 * The sweep is NOT aborted. A violated run's transcript still diagnoses what went wrong, and
 * throwing away paid-for API calls at the moment they became interesting is the wrong trade
 * -- the envelope stamps `violated`, which is what stops the numbers being believed.
 */
export function createIsolationLedger(warn: (message: string) => void = console.error): IsolationLedger {
  const verdicts: IsolationVerdict[] = [];
  const capCounts = new Map<string, number>();
  let warned = false;

  return {
    record: (verdict: IsolationVerdict): void => {
      verdicts.push(verdict);
      if (verdict.cap !== null) capCounts.set(verdict.cap, (capCounts.get(verdict.cap) ?? 0) + 1);
      if (verdict.state === "violated" && !warned) {
        warned = true;
        warn(
          `\nISOLATION FAILED. This run's child did not see what it was meant to, so the ` +
            `numbers from this sweep describe a different arrangement from the one they will ` +
            `be reported under:\n` +
            verdict.violations.map((line) => `  - ${line}`).join("\n") +
            `\nThe sweep is continuing and its envelope will be stamped \`violated\`. Stop it ` +
            `if you were about to spend on a result you intended to trust.\n`,
        );
      }
    },
    state: (): IsolationState => foldIsolation(verdicts),
    caps: (): readonly string[] =>
      [...capCounts.entries()].map(
        ([sentence, count]) => `${count} of ${verdicts.length} run(s): ${sentence}`,
      ),
    counts: (): Readonly<Record<IsolationState, number>> => ({
      verified: verdicts.filter((v) => v.state === "verified").length,
      violated: verdicts.filter((v) => v.state === "violated").length,
      unverified: verdicts.filter((v) => v.state === "unverified").length,
      "not-applicable": verdicts.filter((v) => v.state === "not-applicable").length,
    }),
  };
}
