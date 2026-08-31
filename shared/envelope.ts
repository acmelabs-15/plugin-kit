/**
 * The results envelope -- one JSON shape that every measured operation writes.
 *
 * WHY A CONTRACT RATHER THAN A RENDERER
 * -------------------------------------
 * This repository renders reports six separate ways: `report/viewer.html`,
 * `report/run-page.html`, `report/dashboard.html`, `report/generate-report.ts`,
 * `report/disclosure-report.ts` and `skill-creator/assets/eval_review.html`. Every one of
 * them re-derives "what was measured, under what conditions, and can I compare it to the
 * last run" from a differently-shaped payload, so the renderer count grows with the
 * operation count and nothing is shared but the CSS.
 *
 * The fix is not a seventh renderer. A shared renderer written against a single producer
 * is just another renderer with a better name -- it encodes that producer's shape and the
 * second producer bends to fit or forks. So the envelope comes first, several producers
 * are retrofitted onto it at once, and the reporting layer is built later against a
 * contract that already has more than one implementation.
 *
 * WHAT THE ENVELOPE IS FOR
 * ------------------------
 * Only `rows` varies by operation. Everything else answers a question a reader has about
 * ANY measurement:
 *
 *   run          under what conditions was this produced, and is it comparable
 *   provenance   what bounded the coverage, and how were the numbers arrived at
 *   headline     the two or three figures a reader wants without reading the table
 *   rows         the operation's own table
 *   verdicts     what the operation concluded, per subject, with a reason
 *
 * THE `run` BLOCK IS THE COMPARABILITY KEY, NOT BOOKKEEPING
 * ---------------------------------------------------------
 * Two silent failure modes motivate it, both of which produce numbers that look fine.
 *
 * First, a stale installation. A triggering sweep can report a badly wrong recall figure
 * because an older duplicate of the target is installed under a previous name and wins the
 * probes; nothing in the output says a second copy exists. The related failure is already
 * documented for the trigger harness -- a stale target constant does not error, every
 * comparison simply misses, and the run reports 0 percent, which reads as a broken
 * description rather than a broken constant. `installState` and `targetSha` are what let a
 * reader tell those apart afterwards.
 *
 * Second, a changed knob. Change `workers`, `model` or `timeoutSeconds` and the run is
 * incomparable with every earlier one -- but the numbers still line up in a table and
 * still look like a trend. {@link compareRuns} exists so that judgement is made by code
 * rather than by whoever is squinting at two files.
 *
 * `provenance` IS REQUIRED, NOT A NICETY
 * --------------------------------------
 * The repository already does this correctly in exactly one place. `operations/disclosure.ts`
 * carries a `TokenMethod` alongside every count and `report/disclosure-report.ts` prints the
 * estimate warning, on the grounds that "a body measured at 4,800 estimated tokens against
 * a 5,000-token budget has not been shown to be inside it". That is one script's good
 * habit; here it is the contract. A report carries the conditions under which its number
 * is valid, or it does not get written.
 *
 * `caps` matters most, because its absence is invisible. A silently applied top-N, an
 * early-stopping rule that skipped a third of the planned attempts, a check that was not
 * performed -- each reads as "we looked at everything" unless the report says otherwise.
 *
 * Pure Bun. `Bun.Glob`, `Bun.file`, `Bun.write` and `Bun.CryptoHasher`; no npm runtime
 * dependency, no spawned tool.
 */

import { z } from "zod@4.1.0";

import { IsolationStateSchema } from "./isolation.ts";
import { discoverSkillsWithStatus, type Discovery } from "./tools/check-overlap.ts";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * Structural deep-readonly, applied to every type inferred below.
 *
 * Zod infers mutable properties and the interfaces this file used to hand-write were
 * `readonly` throughout, so dropping the modifier would be a source-visible change rather
 * than the representation change this conversion is. Zod's own `.readonly()` would express
 * it inside the schema but freezes the parsed object at runtime, which is a behaviour
 * change; this keeps the change in the type system where it belongs.
 */
type Immutable<T> = T extends readonly (infer Element)[]
  ? readonly Immutable<Element>[]
  : T extends object
    ? { readonly [K in keyof T]: Immutable<T[K]> }
    : T;

/** The artifact kinds this plugin measures. Mirrors `./validate/rules/registry.ts`. */
export const ArtifactKindSchema = z.enum(["skill", "agent", "command", "mcp", "plugin"]);
export type ArtifactKind = z.infer<typeof ArtifactKindSchema>;

/**
 * The operations that write an envelope, named after the entrypoint that produces them.
 *
 * A closed union rather than a free string. A typo in an operation name silently creates a
 * new operation as far as any consumer grouping by it is concerned, and the whole point of
 * this file is that the reporting layer can group runs without asking the producer.
 */
export const OperationNameSchema = z.enum([
  "measure-triggering",
  "measure-disclosure",
  "measure-outcomes",
  "optimize-description",
  "optimize-disclosure",
  "validate",
]);
export type OperationName = z.infer<typeof OperationNameSchema>;

/**
 * What the machine's installed set looked like from the run's point of view.
 *
 * The operations genuinely differ in what they need, which is why this records what WAS
 * rather than asserting what should be. A disclosure sweep against an installed artifact
 * scores every bundled file zero -- the content arrives through the skill system and no
 * `Read` ever happens -- while a triggering sweep needs the artifact installed for the
 * router to reach it at all. So the same value is healthy for one operation and fatal for
 * another, and only the operation can say which.
 *
 * `absent` IS A CLAIM; THE TWO WAYS OF NOT HAVING ONE ARE KEPT APART
 * ------------------------------------------------------------------
 * "Nothing is installed" and "I could not find out" produce the same empty list and mean
 * opposite things, which is the same absent-versus-empty distinction the scenario sets draw
 * with `expects_references`: a scenario declaring the empty list has measured something, and
 * a scenario declaring nothing has not. So three of the five values below are about the
 * QUALITY of the answer rather than about the machine, and `absent` is reserved for a sweep
 * that actually established absence.
 *
 * `not-reachable` and `unknown` are both non-answers and are still not the same non-answer.
 * `unknown` says no sweep was applicable or none ran -- the target is an agent and the sweep
 * only globs `**\/SKILL.md`, or discovery threw before it read anything. `not-reachable`
 * says a sweep DID run and came back partially blind: a root that exists and would not
 * enumerate, or `HOME` unset so three of the four roots could not even be named. The
 * difference is actionable. `unknown` is a standing limitation nobody can fix at the call
 * site; `not-reachable` is a machine that can be repaired, re-run, and turned into an answer.
 *
 *   absent         The sweep covered its roots and nothing claims the target's name.
 *   installed      Exactly one copy of the target is installed under its own name.
 *   shadowed       More than one installation answers to the name and can win its probes.
 *   not-reachable  A sweep ran and was blind to part of the install surface, so absence and
 *                  uniqueness were BOTH left unestablished. Never collapse this into `absent`.
 *   unknown        No sweep applied, or none ran. Never write it to mean "probably absent".
 */
export const InstallStateSchema = z.enum([
  "absent",
  "installed",
  "shadowed",
  "not-reachable",
  "unknown",
]);
export type InstallState = z.infer<typeof InstallStateSchema>;

/**
 * How the number was arrived at, for reports that carry token counts.
 *
 * `none` is not a hedge -- it is the honest answer for an operation that reports no token
 * figure at all, and it exists so that such an operation cannot be forced to claim
 * `tiktoken` (a lie about precision) or `estimated` (a lie about there being a number).
 */
export const TokenizerKindSchema = z.enum(["tiktoken", "estimated", "none"]);
export type TokenizerKind = z.infer<typeof TokenizerKindSchema>;

/**
 * What the operation does with a unit of work that timed out.
 *
 * This lives in `provenance` rather than in `run` because it is a condition under which
 * the numbers are valid, not a knob that was set. It is here at all because the repository
 * holds two opposite, individually defensible policies:
 *
 *   - `operations/disclosure.ts` `scoreRuns` filters `run.error === undefined`, so a timed-out
 *     scenario run is EXCLUDED from the disclosure rates. Defensible: a run that never
 *     finished says nothing about whether its scenario needed a reference, and treating
 *     silence as evidence of absence would push the loop toward deleting files whose only
 *     crime was being needed by a slow scenario.
 *   - `measure-triggering.ts` SCORES a timed-out query as a non-trigger. Also defensible:
 *     the router demonstrably did not reach for the artifact within the budget, and a
 *     description that only triggers after 150 seconds has not triggered.
 *
 * Neither is being changed. What changes is that each now says which one it uses, so a
 * reader comparing a disclosure rate against a triggering rate can see that the same
 * `failed` count landed on opposite sides of the line.
 *
 *   scored         A timed-out unit is folded into the numbers as a definite negative.
 *   excluded        A timed-out unit is dropped from the denominators.
 *   not-applicable  Nothing in this operation can time out, because it spawns nothing.
 */
export const TimeoutPolicySchema = z.enum(["scored", "excluded", "not-applicable"]);
export type TimeoutPolicy = z.infer<typeof TimeoutPolicySchema>;

// ---------------------------------------------------------------------------
// The envelope
// ---------------------------------------------------------------------------

/**
 * The conditions the run was produced under.
 *
 * Every field is required. `null` is permitted where it is a real answer -- `model: null`
 * means no model was involved, not "we forgot" -- but the KEY is never absent, because an
 * absent key and a null value read identically to a consumer while meaning opposite
 * things. {@link EnvelopeSchema} enforces exactly that distinction: a required key is unsatisfied by
 * `undefined`, and `.nullable()` marks the places where null is a real answer.
 */
export const RunBlockSchema = z.object({
  /** Unique per run and readable in a directory listing. */
  id: z.string(),
  /** ISO 8601, UTC. */
  startedAt: z.string(),
  artifact: ArtifactKindSchema,
  /** The artifact's authored name -- `ask-user-question`, not a path. */
  target: z.string(),
  operation: OperationNameSchema,
  /**
   * The model the run pinned, or `null` when this run's model is not part of the record.
   *
   * `null` covers two cases and they are told apart by `provenance.caps`, not by this
   * field: an operation that spawns no model at all (`validate`), and a caller that left
   * the choice to the environment (no measured operation does so any more; the model is
   * fixed in the tool and `--tier-study` is the recorded override). A producer taking the second
   * path MUST add a cap saying so, because two runs that both say `null` compare as
   * equal here while having been answered by whatever each machine had configured --
   * which is precisely the incomparability {@link compareRuns} exists to catch.
   */
  model: z.string().nullable(),
  /** The grading model, or `null` when the operation has no grading step. */
  graderModel: z.string().nullable(),
  /** Concurrent units of work. `1` for a sequential operation, never `0`. */
  workers: z.number(),
  /** Repeats per unit -- runs per query, runs per scenario. */
  runsPer: z.number(),
  /** Per-unit wall clock budget, or `null` when nothing can time out. */
  timeoutSeconds: z.number().nullable(),
  /**
   * Content hash of the questions asked, or `null` when the operation asks none.
   *
   * From {@link hashJsonValue} over the PARSED set rather than over the file bytes, so
   * reformatting an eval set does not make two runs look incomparable while renaming a
   * query correctly does.
   */
  evalSetHash: z.string().nullable(),
  /** Content hash of the artifact under test, from {@link hashArtifact}. */
  targetSha: z.string(),
  installState: InstallStateSchema,
  /**
   * Whether the spawned children were PROVEN to have seen only the artifact under test.
   *
   * The strictly stronger companion to `installState`, and the two answer adjacent halves of
   * one question. `installState` sweeps the MACHINE and reports what a run might have been
   * competing with; `isolation` reads what the child actually enumerated and reports what it
   * WAS competing with. A sweep can be `absent` and `violated` at the same time -- nothing
   * shadowed the target's name, and the operator's auto-memory was in its context regardless.
   *
   * Required rather than optional, in line with every other member: an absent key and a
   * `"unverified"` value would read identically to a consumer while meaning "this producer
   * has not been updated" versus "this run was not checked". A producer that spawns no child
   * writes `"not-applicable"`, which is a real answer and not a default.
   *
   * See `./isolation.ts` for what is checked and for the contamination it was written after
   * finding.
   */
  isolation: IsolationStateSchema,
});
export type RunBlock = Immutable<z.infer<typeof RunBlockSchema>>;

/** How the numbers were arrived at, and what bounded them. */
export const ProvenanceSchema = z.object({
  tokenizer: TokenizerKindSchema,
  /**
   * What one unit of `scored`/`excluded`/`failed` is, in words -- "query attempt",
   * "scenario run", "check section".
   *
   * `"scored": 24` is meaningless without it, and the unit is not recoverable from
   * `runsPer` because the two operations count different things.
   */
  unit: z.string(),
  /** Units that reached the numbers in `headline` and `rows`. */
  scored: z.number(),
  /** Units that ran, or partly ran, and were deliberately left out of the denominators. */
  excluded: z.number(),
  /**
   * Units the harness could not complete -- a timeout, or a spawn that errored.
   *
   * DELIBERATELY NOT DISJOINT FROM THE OTHER TWO. The invariant is
   * `scored + excluded = attempted`, with `failed` a cross-cutting count that lands on one
   * side or the other according to {@link timeoutPolicy}. Making the three disjoint would
   * destroy the thing this exists to show: under a `scored` policy a timeout is in the
   * numbers, and a reader has to be able to see both that it happened and that it counted.
   */
  failed: z.number(),
  timeoutPolicy: TimeoutPolicySchema,
  /**
   * Anything that bounded coverage, one plain sentence each.
   *
   * Empty means the run really did look at everything it was pointed at. This is the field
   * whose absence is invisible, so it is required and empty-by-declaration rather than
   * optional.
   */
  caps: z.array(z.string()),
});
export type Provenance = Immutable<z.infer<typeof ProvenanceSchema>>;

/** One figure a reader should see without opening the table. */
export const HeadlineMetricSchema = z.object({
  label: z.string(),
  value: z.number(),
  /** `"fraction"`, `"tokens"`, `"queries"` -- whatever makes the number readable. */
  unit: z.string(),
  /**
   * Difference from a comparable earlier run.
   *
   * Optional, and absent by default, because a producer running in isolation has nothing
   * legitimate to subtract. A delta is only ever filled in after {@link compareRuns} has
   * said the two runs are comparable; that is the whole reason the check exists.
   */
  delta: z.number().optional(),
});
export type HeadlineMetric = Immutable<z.infer<typeof HeadlineMetricSchema>>;

/**
 * What the operation concluded about one subject.
 *
 * `verdict` is a free string rather than a union because the vocabulary is genuinely
 * per-operation -- `prune`/`inline`/`keep` for disclosure, `pass`/`fail` for triggering,
 * `invalid`/`not-checked` for validation -- and forcing them into one enum would either
 * lose meaning or grow a union nobody can read. `reason` is what makes that survivable:
 * a verdict a reader has never seen before still arrives with its justification attached.
 */
export const VerdictSchema = z.object({
  subject: z.string(),
  verdict: z.string(),
  reason: z.string(),
});
export type Verdict = Immutable<z.infer<typeof VerdictSchema>>;

/**
 * The envelope. `Row` is the operation's own table row type.
 *
 * Generic rather than `unknown[]` so a producer's rows stay typed at the producer, which
 * is the only place their shape is known. Consumers reading a file back get the default.
 */
export const EnvelopeSchema = z.object({
  run: RunBlockSchema,
  provenance: ProvenanceSchema,
  headline: z.array(HeadlineMetricSchema),
  rows: z.array(z.unknown()),
  verdicts: z.array(VerdictSchema),
});

/**
 * `rows` is the one member overridden rather than inferred, because it is the generic hole:
 * the schema can only say "an array of something", and the producer is the only place the
 * something is known. Every other member comes straight off {@link EnvelopeSchema}.
 */
export type Envelope<Row = unknown> = Omit<
  Immutable<z.infer<typeof EnvelopeSchema>>,
  "rows"
> & { readonly rows: readonly Row[] };

/** The filename producers write alongside their existing `results.json`. */
export const ENVELOPE_FILENAME = "envelope.json";

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

/**
 * What a producer must supply.
 *
 * `id` and `startedAt` are the only fields the builder will fill in, because they are the
 * only two that are pure bookkeeping -- nothing about comparability depends on them. Every
 * other field of `run` and `provenance` is required here, so a producer that has not
 * decided what its `installState` was gets a type error rather than a default.
 */
export interface EnvelopeInput<Row = unknown> {
  readonly run: Omit<RunBlock, "id" | "startedAt"> & {
    readonly id?: string;
    readonly startedAt?: string | Date;
  };
  readonly provenance: Provenance;
  readonly headline?: readonly HeadlineMetric[];
  readonly rows?: readonly Row[];
  readonly verdicts?: readonly Verdict[];
}

/** `<operation>-<target>-<timestamp>-<random>`, same readable shape as a run status id. */
export function newEnvelopeId(
  operation: OperationName,
  target: string,
  now: Date = new Date(),
): string {
  const slug = target.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "target";
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `${operation}-${slug}-${stamp}-${crypto.randomUUID().slice(0, 6)}`;
}

/**
 * Assemble an envelope, filling in only the two bookkeeping fields.
 *
 * The builder deliberately does NOT default anything the validator checks. A builder that
 * quietly supplied `installState: "absent"` for a producer that forgot to pass one would
 * defeat the validator entirely -- the envelope would be well-formed and wrong, which is
 * the exact failure this module exists to prevent.
 */
export function buildEnvelope<Row = unknown>(input: EnvelopeInput<Row>): Envelope<Row> {
  const startedAt =
    input.run.startedAt === undefined
      ? new Date().toISOString()
      : input.run.startedAt instanceof Date
        ? input.run.startedAt.toISOString()
        : input.run.startedAt;
  const { id: _id, startedAt: _startedAt, ...rest } = input.run;
  return {
    run: {
      ...rest,
      id: input.run.id ?? newEnvelopeId(input.run.operation, input.run.target),
      startedAt,
    },
    provenance: input.provenance,
    headline: input.headline ?? [],
    rows: input.rows ?? [],
    verdicts: input.verdicts ?? [],
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** One thing wrong with a candidate envelope. `path` is dotted, so it names a field. */
export interface EnvelopeProblem {
  readonly path: string;
  readonly message: string;
}

/**
 * Render a Zod issue path the way this module has always named a field: dotted for keys,
 * bracketed for indices, so a problem reads `headline[0].value` rather than
 * `headline.0.value`. The empty string is the envelope itself.
 */
function formatIssuePath(path: readonly PropertyKey[]): string {
  let rendered = "";
  for (const segment of path) {
    if (typeof segment === "number") rendered += `[${segment}]`;
    else rendered += rendered === "" ? String(segment) : `.${String(segment)}`;
  }
  return rendered;
}

/**
 * Zod issues as the `{path, message}` pairs {@link EnvelopeError} promises its callers.
 *
 * A mapping, not a second validator. Every rule lives in {@link EnvelopeSchema} and nowhere
 * else; this exists only because a caller wants to assert that omitting `installState` was
 * caught BY NAME rather than that something somewhere went wrong, and Zod carries the name
 * in a structured path rather than in the sentence.
 */
function problemsOf(error: z.ZodError): readonly EnvelopeProblem[] {
  return error.issues.map((issue) => {
    const path = formatIssuePath(issue.path);
    return { path, message: path === "" ? issue.message : `${path}: ${issue.message}` };
  });
}


/** Thrown by {@link writeEnvelope} and {@link readEnvelope}. */
export class EnvelopeError extends Error {
  constructor(readonly problems: readonly EnvelopeProblem[]) {
    super(
      `invalid results envelope:\n${problems.map((p) => `  - ${p.message}`).join("\n")}`,
    );
    this.name = "EnvelopeError";
  }
}

/**
 * Parse against {@link EnvelopeSchema}, throwing {@link EnvelopeError} with every problem.
 *
 * The parsed data is deliberately discarded. `z.object` strips keys it does not know, and
 * this is the gate a whole envelope passes through on its way to and from disk -- returning
 * the stripped copy would silently drop a producer's extra field on read and change what a
 * round trip means. Validation is all that is wanted here, so validation is all it does.
 */
function assertEnvelope(value: unknown): asserts value is Envelope {
  const result = EnvelopeSchema.safeParse(value);
  if (!result.success) throw new EnvelopeError(problemsOf(result.error));
}

// ---------------------------------------------------------------------------
// Reading and writing
// ---------------------------------------------------------------------------

/**
 * Write an envelope, refusing an invalid one.
 *
 * Validating on the way OUT rather than on the way in is what makes the contract hold:
 * a producer that forgets `installState` finds out at the moment it writes, on its own
 * machine, rather than three weeks later when a reporting layer renders a blank column.
 * The whole reason this repository has a `schemas.md` warning that "it produced no error"
 * is not evidence a hand-built file is right is that nothing was checking.
 */
export async function writeEnvelope(path: string, envelope: Envelope<unknown>): Promise<void> {
  assertEnvelope(envelope);
  await Bun.write(path, `${JSON.stringify(envelope, null, 2)}\n`);
}

/** Read an envelope back, validating it. Throws {@link EnvelopeError} on a bad file. */
export async function readEnvelope(path: string): Promise<Envelope> {
  const parsed: unknown = await Bun.file(path).json();
  assertEnvelope(parsed);
  return parsed;
}

// ---------------------------------------------------------------------------
// Comparability
// ---------------------------------------------------------------------------

/**
 * The fields whose disagreement makes a delta illegitimate.
 *
 * Each one changes what the number MEANS rather than what it measures:
 *
 *   model           a different router makes a different routing decision
 *   workers         concurrency changes contention, and contention changes timeouts
 *   timeoutSeconds  the budget decides how many slow units are scored as failures
 *   runsPer         a rate over 2 attempts and a rate over 10 are not the same estimate
 *   evalSetHash     different questions
 *   installState    a shadowed target answers with somebody else's description
 *   isolation       a contaminated child answered a different question from a clean one
 *
 * `isolation` earns its place on the same argument as `installState`, one layer in. A run
 * whose child carried the operator's auto-memory in its system prompt was answering with
 * several hundred lines of unrelated instruction in context; a run whose child did not, was
 * not. Subtracting one from the other reports a change in the operator's machine as a change
 * in the artifact. That a `verified` run and an `unverified` one also fail this check is
 * intended and not incidental: an unverified run has not been shown to be either.
 */
export const COMPARABILITY_KEYS = [
  "model",
  "workers",
  "timeoutSeconds",
  "runsPer",
  "evalSetHash",
  "installState",
  "isolation",
] as const;

export type ComparabilityKey = (typeof COMPARABILITY_KEYS)[number];

/**
 * Fields that differ without blocking a comparison, reported anyway.
 *
 * `targetSha` heads the list and its exclusion is the point: the artifact changing is the
 * thing a before/after delta is ABOUT, so treating it as incomparability would make the
 * check reject every useful comparison. The rest are context a reader may want -- a run
 * from a different day, under a different grader -- without being grounds to refuse.
 */
export const ADVISORY_KEYS = [
  "artifact",
  "target",
  "operation",
  "graderModel",
  "targetSha",
] as const;

export type AdvisoryKey = (typeof ADVISORY_KEYS)[number];

export interface Comparability {
  /** True only when `differing` is empty. */
  readonly comparable: boolean;
  /**
   * The comparability keys that disagree, by name, in {@link COMPARABILITY_KEYS} order.
   *
   * Names rather than a bare boolean because "not comparable" is not actionable and
   * "`workers` and `timeoutSeconds` differ" is: it tells the reader which knob to put back,
   * or which sentence to write under the table explaining why the delta is missing.
   */
  readonly differing: readonly ComparabilityKey[];
  /** Differences that do not block the comparison. See {@link ADVISORY_KEYS}. */
  readonly advisory: readonly AdvisoryKey[];
}

/**
 * Decide whether a delta between two runs is legitimate.
 *
 * Takes the `run` blocks rather than whole envelopes, so the reporting layer can ask the
 * question about a run it has only the header of, and so this stays testable without
 * building two complete envelopes.
 */
export function compareRuns(a: RunBlock, b: RunBlock): Comparability {
  const differing = COMPARABILITY_KEYS.filter((key) => a[key] !== b[key]);
  const advisory = ADVISORY_KEYS.filter((key) => a[key] !== b[key]);
  return { comparable: differing.length === 0, differing, advisory };
}

/** {@link compareRuns} over whole envelopes, for the common call site. */
export function compareEnvelopes(a: Envelope<unknown>, b: Envelope<unknown>): Comparability {
  return compareRuns(a.run, b.run);
}

/**
 * One sentence naming why two runs cannot be compared, or null when they can.
 *
 * Here rather than in a renderer because every renderer would otherwise phrase it
 * differently, and the phrasing is the part that has to survive: a reader who sees
 * "not comparable" learns nothing, and a reader who sees which fields moved can act.
 */
export function explainIncomparability(result: Comparability): string | null {
  if (result.comparable) return null;
  const names = result.differing.map((key) => `\`${key}\``).join(", ");
  return (
    `These runs are not comparable: ${names} ` +
    `differ${result.differing.length === 1 ? "s" : ""} between them, which changes what the ` +
    `numbers mean rather than what they measure. Any delta shown between them would be a ` +
    `difference in method reported as a difference in result.`
  );
}

// ---------------------------------------------------------------------------
// Content hashing
// ---------------------------------------------------------------------------

/**
 * Directories excluded from an artifact hash.
 *
 * Kept to two, and both are things that are not the artifact: `.git` is version-control
 * metadata that changes on every commit without the shipped content changing, and
 * `node_modules` is installed rather than authored and can be enormous enough to make
 * hashing the dominant cost of a run. Everything else is included, binaries included,
 * because the question `targetSha` answers is "are these two copies the same bytes" and
 * every exclusion is a way for two different copies to hash the same.
 */
export const HASH_EXCLUDED_SEGMENTS: readonly string[] = ["node_modules", ".git"];

function isHashExcluded(relPath: string): boolean {
  return relPath.split("/").some((segment) => HASH_EXCLUDED_SEGMENTS.includes(segment));
}

/**
 * A deterministic content hash of the artifact under test.
 *
 * Determinism is the entire requirement, so every input to the digest is stable across
 * machines and across runs:
 *
 *   - paths are collected with `Bun.Glob`, normalized to forward slashes, and SORTED, so
 *     filesystem enumeration order cannot change the answer;
 *   - each entry contributes its relative path, its byte length and its bytes, with `\0`
 *     separators, so `{a: "xy", b: ""}` and `{a: "x", b: "y"}` cannot collide by
 *     concatenation;
 *   - nothing about the filesystem's own bookkeeping goes in -- no mtime, no mode, no
 *     inode -- because a fresh `git clone` would otherwise hash differently from the
 *     directory it was cloned from, and the two are the same artifact;
 *   - symlinks are not followed, so a link into a directory outside the artifact cannot
 *     drag unrelated content into the digest or produce a cycle.
 *
 * A single file is hashed as a one-entry directory keyed by its basename, which is what an
 * agent target (`agents/reviewer.md`) needs.
 *
 * @returns `sha256:<64 hex>`. The algorithm is in the string so a later change of digest
 *   is visible in old files rather than silently comparing unequal for a new reason.
 */
export async function hashArtifact(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  let isDirectory = false;
  try {
    isDirectory = (await Bun.file(path).stat()).isDirectory();
  } catch {
    // A path that does not exist hashes as an empty artifact rather than throwing. The
    // caller is a measurement that has already failed for a better reason by this point,
    // and a hash function that throws would replace that reason with a stack trace.
    return `sha256:${hasher.digest("hex")}`;
  }

  const entries: string[] = isDirectory
    ? (
        await Array.fromAsync(
          new Bun.Glob("**/*").scan({ cwd: path, onlyFiles: true, followSymlinks: false }),
        )
      )
        .map((name) => name.split("\\").join("/"))
        .filter((relPath) => !isHashExcluded(relPath))
        .sort()
    : [path.slice(path.lastIndexOf("/") + 1)];

  for (const relPath of entries) {
    const filePath = isDirectory ? `${path}/${relPath}` : path;
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await Bun.file(filePath).arrayBuffer());
    } catch {
      // Unreadable is recorded as a distinct state rather than skipped: skipping would let
      // a file that vanished between the glob and the read hash the same as one that was
      // never there.
      hasher.update(`${relPath}\0unreadable\0`);
      continue;
    }
    hasher.update(`${relPath}\0${bytes.length}\0`);
    hasher.update(bytes);
    hasher.update("\0");
  }
  return `sha256:${hasher.digest("hex")}`;
}

/**
 * A deterministic hash of parsed JSON data -- the eval set, the scenario set.
 *
 * Over the PARSED value rather than the file bytes, with object keys sorted, so that
 * reindenting an eval set or reordering two frontmatter-style keys does not make two runs
 * look incomparable. Array order IS significant, because the order of an eval set decides
 * the train/test split and two different splits are two different measurements.
 */
export function hashJsonValue(value: unknown): string {
  return `sha256:${new Bun.CryptoHasher("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

// ---------------------------------------------------------------------------
// Install state
// ---------------------------------------------------------------------------

export interface InstallSighting {
  readonly state: InstallState;
  /** Absolute paths of installations answering to the target's name, excluding the source. */
  readonly sightings: readonly string[];
  /** Roots that exist and refused to enumerate. Non-empty is why a state can be `unknown`. */
  readonly blindRoots: readonly string[];
  /**
   * A sentence for `provenance.caps`, or null when there is nothing to say.
   *
   * Produced here rather than at the call site so that every operation phrases the same
   * observation the same way -- and so that an operation which knows a sighting CONFLICTS
   * with what it needs can say so in the one place a reader looks for coverage caveats.
   */
  readonly cap: string | null;
}

/**
 * Look for an installation that answers to the target's name.
 *
 * Reuses `check-overlap.ts`'s sweep rather than opening a second one. That sweep already
 * distinguishes the three outcomes that matter -- a root that is absent is the observation
 * "nothing installed here", a root that exists and will not enumerate is a blind spot, and
 * a scanned root is an answer -- and a second implementation of that distinction is how
 * the two would drift.
 *
 * Only skills are discoverable this way. For an agent or a flat command file the answer is
 * `unknown` with a cap that says why, which is the honest outcome: `discoverSkillsWithStatus`
 * globs `**\/SKILL.md`, and inventing a second discovery for agents is a bigger change than
 * this contract needs and would be untested against a real installed set.
 *
 * WHY THE PLUGIN CACHE IS NOT SWEPT, DELIBERATELY
 * -----------------------------------------------
 * The sweep covers `~/.claude/skills`, `~/.claude/plugins/marketplaces`,
 * `~/.claude/plugins/repos` and the project root. It does NOT cover
 * `~/.claude/plugins/cache`, and that looks at first like the blind spot this whole state
 * exists to prevent -- measured on one developer machine, the cache held 700 `SKILL.md`
 * files, six of them named `skill-creator`, which is a name this repository measures.
 *
 * Adding it would make the answer WORSE, for two measured reasons.
 *
 * The cache is a VERSION-KEYED content store rather than an install set. Those six copies
 * are `anthropic-agent-skills/claude-api/{f379e5ad66e2,b29e7cf65e5c,3b3fad96af16}/`,
 * `claude-plugins-official/skill-creator/unknown/`, `ACMElabs/plugin-kit/0.4.0/` and
 * `ACMElabs/skill-creator/0.2.0/` -- three of them the same plugin at three revisions. A
 * single installed plugin with an upgrade history would therefore report `shadowed`, and
 * `shadowed` is a COMPARABILITY key: the run would start refusing legitimate deltas because
 * somebody had updated a plugin. Half the same tree (364 of the 700) sits under `temp_git_*`
 * clone staging that a later plugin operation deletes.
 *
 * And a cached copy provably cannot win a probe in an isolated run. Measured at CLI 2.1.241
 * against that same machine: a child spawned with `--setting-sources project` reports
 * `"plugins": []` and a skill list of the artifact under test plus sixteen binary built-ins.
 * Nothing in the cache reaches it.
 *
 * The validity claim those runs need is now carried by `run.isolation`, which reads what the
 * child ACTUALLY enumerated rather than inferring it from what the machine holds. That is
 * the stronger instrument, and it is why widening a weaker one into false positives is not
 * worth doing. See `./isolation.ts`.
 */
export async function detectInstallState(params: {
  readonly artifact: ArtifactKind;
  readonly name: string;
  /** The source under test. Excluded from the sweep -- it is not an installation. */
  readonly sourcePath: string;
  readonly projectDir?: string;
}): Promise<InstallSighting> {
  if (params.artifact !== "skill" && params.artifact !== "command") {
    return {
      state: "unknown",
      sightings: [],
      blindRoots: [],
      cap:
        `Install state was not determined: the installed-set sweep discovers skills ` +
        `(\`**/SKILL.md\`) and this run's target is a ${params.artifact}. A stale copy ` +
        `installed under this name would not have been noticed.`,
    };
  }

  const projectDir = params.projectDir ?? process.cwd();
  const exclude = `${params.sourcePath.replace(/\/$/, "")}/SKILL.md`;
  let discovery: Discovery;
  try {
    discovery = await discoverSkillsWithStatus(projectDir, exclude);
  } catch (error) {
    return {
      state: "unknown",
      sightings: [],
      blindRoots: [],
      cap:
        `Install state was not determined: the installed-set sweep failed ` +
        `(${error instanceof Error ? error.message : String(error)}).`,
    };
  }

  return decideInstallState({ name: params.name, discovery });
}

/**
 * Turn one sweep into a state, without touching the filesystem.
 *
 * Split out and exported because the rule is the part worth testing and the sweep is not:
 * `check-overlap.ts` owns and tests the sweep, while the decision below is where a blind
 * root either downgrades a claim or silently fails to. Reaching every branch through real
 * directories is not possible on any machine — a sighting in one root while another root is
 * unreadable needs two roots the test can write to, and three of the four are `HOME`-derived
 * and read once at module load. A branch reachable only by rearranging somebody's home
 * directory is a branch with no coverage, and this one decides whether a void measurement
 * reads as a clean one.
 */
export function decideInstallState(params: {
  readonly name: string;
  readonly discovery: Discovery;
}): InstallSighting {
  const discovery = params.discovery;
  const blindRoots = discovery.roots.filter((r) => r.status === "unreadable").map((r) => r.root);
  const sightings = discovery.skills
    .filter((skill) => skill.name === params.name)
    .map((skill) => skill.path);

  // Why the sweep could not see the whole install surface, if it could not. Established
  // BEFORE the state is decided, because blindness governs what a sighting count is entitled
  // to claim -- it is not a footnote appended to a claim already made. That was the old
  // shape's defect: a blind root only downgraded the answer when the sighting list happened
  // to be empty, so one copy found plus one root unread reported a confident `installed`.
  const blindness: string | null = discovery.homeless
    ? "`HOME` is unset, so the user and plugin skill roots could not be located and only " +
      "the project root was swept"
    : blindRoots.length > 0
      ? `${blindRoots.length} search root(s) exist and could not be read ` +
        `(${blindRoots.join(", ")})`
      : null;

  // The source's own SKILL.md is excluded from the sweep, so every sighting here is a
  // SEPARATE copy. Two or more means the router had a choice, nothing records which way it
  // went, and the measured description may not be the one under test.
  //
  // This is the one conclusion blindness cannot take away, which is why it is tested first:
  // a root the sweep could not read can only ADD copies, and `shadowed` already says there
  // is more than one. Every other conclusion below is a claim about what is NOT there, and a
  // partially blind sweep has not earned one.
  if (sightings.length > 1) {
    return {
      state: "shadowed",
      sightings,
      blindRoots,
      cap:
        `${sightings.length} installations answer to \`${params.name}\` ` +
        `(${sightings.join(", ")}). Whichever the router picked is the one that was ` +
        `measured, and it is not necessarily the source under test.` +
        (blindness === null ? "" : ` There may be more: ${blindness}.`),
    };
  }

  if (blindness !== null) {
    // The distinction the state exists for: "nothing found" and "nothing found where I could
    // look" are the same output and opposite claims. A single sighting under blindness is the
    // same problem one step along -- it establishes that a copy is installed and NOT that it
    // is the only one, so the `installed` claim of uniqueness is not available either.
    return {
      state: "not-reachable",
      sightings,
      blindRoots,
      cap:
        `Install state was not established: ${blindness}. ` +
        (sightings.length === 0
          ? `A copy installed under an unread root would not appear here, so this run has ` +
            `NOT been shown to be free of a competing copy.`
          : `A copy of \`${params.name}\` was seen at ${sightings[0]}, but a second one ` +
            `under an unread root would not have appeared, so this run has NOT been shown ` +
            `to have measured that copy rather than another.`),
    };
  }

  if (sightings.length === 0) {
    return { state: "absent", sightings, blindRoots, cap: null };
  }

  return {
    state: "installed",
    sightings,
    blindRoots,
    cap:
      `A copy of \`${params.name}\` is installed at ${sightings[0]}. Anything this run ` +
      `measured through the skill system was served by that copy, not by the source ` +
      `directory.`,
  };
}

/**
 * Note a mismatch between what the operation needs and what the sweep found.
 *
 * Separate from {@link detectInstallState} because the detector reports the machine and
 * only the operation knows what it wanted. A disclosure sweep needs the artifact NOT to be
 * installed -- if it is, content reaches the model through the skill system, no `Read`
 * happens, and every bundled file scores a pull rate of zero, which reads as "delete all
 * of these". A triggering sweep needs the opposite.
 *
 * A NON-ANSWER IS A CONFLICT WHEN A SWEEP WAS SUPPOSED TO PRODUCE ONE
 * -------------------------------------------------------------------
 * `not-reachable` returns a sentence and `unknown` returns null, and the asymmetry is the
 * point. `unknown` means no sweep was applicable to this target at all -- a standing,
 * declared limitation that {@link detectInstallState} has already written into `caps`, and
 * that nothing at the call site can act on. `not-reachable` means a sweep ran, was supposed
 * to answer, and came back blind to part of the machine. The condition that would void the
 * run is live and merely unobserved, which is exactly the case that must not read as clean:
 * every sweep this repository has been burned by looked healthy, and the one documented
 * cause was a copy nobody had checked for.
 *
 * @returns a `caps` sentence, or null when there is no conflict.
 */
export function installConflict(params: {
  readonly operation: OperationName;
  readonly needs: "installed" | "absent";
  readonly found: InstallState;
}): string | null {
  if (params.found === "unknown") return null;
  if (params.found === "not-reachable") {
    return (
      `\`${params.operation}\` needs the target ${params.needs === "absent" ? "NOT " : ""}` +
      `to be installed, and the sweep could not establish whether it is: part of the ` +
      `install surface could not be read. ` +
      (params.needs === "absent"
        ? `An unseen installed copy floors every pull rate at zero — content served through ` +
          `the skill system never produces a \`Read\` — so this run has not been shown to ` +
          `have measured anything. Treat the figures as unverified rather than clean, and ` +
          `re-run once the unread roots are readable.`
        : `An unseen second copy would have answered the probes with a different ` +
          `description from the one under test, so this run has not been shown to have ` +
          `measured the target. Re-run once the unread roots are readable.`)
    );
  }
  if (params.needs === "absent" && params.found !== "absent") {
    return (
      `\`${params.operation}\` needs the target NOT to be installed, and it is ` +
      `(${params.found}). Content served through the skill system never produces a \`Read\`, ` +
      `so pull rates measured under this condition are floored at zero and the file verdicts ` +
      `below cannot be trusted.`
    );
  }
  if (params.needs === "installed" && params.found === "shadowed") {
    return (
      `\`${params.operation}\` needs the target installed, and more than one installation ` +
      `answers to its name. The probes may have been won by a copy carrying a different ` +
      `description from the one under test.`
    );
  }
  return null;
}
