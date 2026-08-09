#!/usr/bin/env bun
/**
 * validate -- one "is this OK" for every artifact this plugin builds.
 *
 * WHAT IT REPLACED, AND WHY
 * -------------------------
 * Three scripts answered this question, split by implementation rather than by
 * what a user wanted: `validate-skill.ts` read frontmatter, `check-bun-purity.ts`
 * read code, `check-overlap.ts` read the machine. An author shipping a skill had
 * to know all three existed and run them in order, and in practice ran one. They
 * are now one command with per-artifact rules behind it.
 *
 * The split that survived is the one that is real: the collision check depends
 * on what is installed, where everything else is static. That is `--with-environment`
 * rather than a separate binary, and it is opt-in for a reason given below.
 *
 * WHY THE RULES LIVE ELSEWHERE
 * ----------------------------
 * `../rules/<artifact>.ts` holds the checks; this file holds argv, ordering and
 * rendering. Nothing here branches on artifact type. Adding a seventh artifact
 * is a new rules module and a line in `../rules/registry.ts`, which is the whole
 * point of the shape -- the previous design grew a script per question, and six
 * artifacts times three questions is not a set of scripts anyone maintains.
 *
 * ENVIRONMENT-DEPENDENT CHECKS
 * ----------------------------
 * `--with-environment` turns on the checks that read `~/.claude` and the
 * project's `.claude`. Three outcomes, all of them explicit:
 *
 *   passed, readable      the check runs and the report names the roots it read
 *   passed, unreadable    exit 2 with what could not be read; no verdict
 *   not passed            the report states the check was not performed
 *
 * The middle case is the reason the flag exists. A collision check that reports
 * "no problems" because it could not see the installed set is worse than one
 * that refuses -- the author reads a clean bill of health and ships.
 *
 * EXIT
 *   0  valid
 *   1  at least one error
 *   2  usage error, or a check that could not be performed
 */

import { CliError, formatHelp, parseArgs, type ParsedArgs, type Spec } from "./lib/cli.ts";
import { RULES, TARGET_TYPES } from "../rules/registry.ts";
import { RuleAbort, type RuleContext, type Section, type Tier } from "../rules/types.ts";
import { baseName, isDirectory, resolvePath } from "../rules/lib.ts";
import {
  buildEnvelope,
  detectInstallState,
  hashArtifact,
  HASH_EXCLUDED_SEGMENTS,
  writeEnvelope,
  type ArtifactKind,
  type Envelope,
  type HeadlineMetric,
  type InstallState,
  type Verdict,
} from "./lib/envelope.ts";

export const CLI_SPEC: Spec = {
  "target-type": {
    kind: "string",
    help: `artifact to check: ${TARGET_TYPES.join(", ")}`,
  },
  standard: {
    kind: "boolean",
    default: false,
    help: "check against the portable Agent Skills field set only",
  },
  extended: {
    kind: "boolean",
    default: false,
    help: "allow the Claude Code extension fields",
  },
  "with-environment": {
    kind: "boolean",
    default: false,
    help: "also run checks that read the installed set (fails loudly if it cannot)",
  },
  // Additive and opt-in. The markdown on stdout is what a human and every caller of this
  // script read, and it does not change; the envelope is a second, machine-readable file
  // carrying the conditions the run was performed under -- which tier, which artifact,
  // whether the environment was read, what the artifact hashed to -- none of which the
  // report has room for and all of which decide whether two validations can be compared.
  envelope: {
    kind: "string",
    help: "also write the results envelope (run conditions + findings) to this path",
  },
  help: { kind: "boolean", short: "h", default: false, help: "show this message" },
};

export const USAGE = [
  `Usage: bun shared/scripts/validate.ts --target-type <${TARGET_TYPES.join("|")}> <path> [options]`,
  "",
  "Artifacts:",
  ...TARGET_TYPES.map((t) => {
    const rule = RULES[t]!;
    const flags = [rule.honoursTier ? "--standard/--extended" : "", rule.honoursEnvironment ? "--with-environment" : ""]
      .filter((f) => f !== "")
      .join(", ");
    return `  ${t.padEnd(9)}${rule.summary}${flags === "" ? "" : `\n           honours ${flags}`}`;
  }),
].join("\n");

/**
 * Map the two tier flags onto a single tier.
 *
 * Passing both is rejected rather than resolved by precedence: they make
 * opposite claims about what the artifact is for, and silently honouring one
 * would report a verdict the caller did not ask for.
 */
export function resolveTier(flags: ParsedArgs["flags"]): Tier {
  const standard = flags["standard"] === true;
  const extended = flags["extended"] === true;
  if (standard && extended) {
    throw new CliError("--standard and --extended are mutually exclusive");
  }
  return extended ? "extended" : "standard";
}

/**
 * Read `--target-type`.
 *
 * Required rather than defaulting to `skill`. A default would mean a mistyped
 * `--target-type agnet` quietly validated the file as a skill and reported
 * frontmatter errors about an artifact the user never named.
 */
export function requireTargetType(flags: ParsedArgs["flags"]): string {
  const raw = flags["target-type"];
  if (raw === undefined) {
    throw new CliError(`missing --target-type (one of ${TARGET_TYPES.join(", ")})\n\n${USAGE}`);
  }
  if (typeof raw !== "string" || RULES[raw] === undefined) {
    throw new CliError(`--target-type must be one of ${TARGET_TYPES.join(", ")}, got: ${String(raw)}`);
  }
  return raw;
}

/** Render sections as markdown, matching this plugin's markdown-first CLI output. */
export function formatReport(
  sections: readonly Section[],
  targetType: string,
  path: string,
  tier: Tier,
  withEnvironment: boolean,
): string {
  const rule = RULES[targetType]!;
  const errors = sections.flatMap((s) => s.errors);
  const warnings = sections.flatMap((s) => s.warnings);

  const lines = [
    `# ${targetType} validation: \`${baseName(path)}\``,
    "",
    `- **Path**: \`${resolvePath(path)}\``,
    ...(rule.honoursTier ? [`- **Tier**: ${tier === "standard" ? "standard (portable Agent Skills field set)" : "extended (Claude Code)"}`] : []),
    ...(rule.honoursEnvironment ? [`- **Environment checks**: ${withEnvironment ? "included" : "not performed"}`] : []),
    "",
  ];

  for (const s of sections) {
    lines.push(`## ${s.title}`, "");
    if (s.note !== undefined) lines.push(s.note, "");
    if (s.errors.length > 0) {
      lines.push(`**Errors (${s.errors.length})**`, "");
      for (const e of s.errors) lines.push(`- ${e}`);
      lines.push("");
    }
    if (s.warnings.length > 0) {
      lines.push(`**Warnings (${s.warnings.length})**`, "");
      for (const w of s.warnings) lines.push(`- ${w}`);
      lines.push("");
    }
    if (s.errors.length === 0 && s.warnings.length === 0 && s.note === undefined) {
      lines.push("Nothing to report.", "");
    }
  }

  lines.push(
    errors.length === 0
      ? `**${targetType} is valid.**${warnings.length > 0 ? ` ${warnings.length} warning(s).` : ""}`
      : `**${targetType} is invalid.** ${errors.length} error(s), ${warnings.length} warning(s).`,
  );
  return lines.join("\n");
}

export async function runValidation(
  targetType: string,
  context: RuleContext,
): Promise<readonly Section[]> {
  return await RULES[targetType]!.run(context);
}

// ---------------------------------------------------------------------------
// The results envelope
// ---------------------------------------------------------------------------

/**
 * `validate` is the operation that proves the envelope is not a measurement format.
 *
 * Everything else that writes one spawns a model, samples repeatedly and reports rates.
 * This spawns nothing, samples nothing and reports a list. If the contract only fitted the
 * first kind it would be a measurement schema with an ambitious name, and the interesting
 * work here is separating the fields that genuinely cannot apply from the ones it would be
 * merely lazy to leave empty. Field by field, with the reasoning kept next to the choice
 * rather than in a commit message:
 *
 *   model / graderModel  `null`, and the contract says `null` is a real answer. Nothing is
 *                        asked of a model here. The nullable-model doc requires a `caps`
 *                        sentence from a producer that OMITTED `--model` and let the
 *                        environment choose; this producer has no such flag, so the
 *                        absence of that cap is itself the statement that no model ran.
 *   timeoutSeconds       `null`. Nothing is spawned, so nothing can exceed a budget.
 *   evalSetHash          `null`. No questions are asked, so there is no question set.
 *   workers              `1`. The contract already says `1` means sequential and `0` is
 *                        never right; a run that does its work in one pass is honestly 1,
 *                        not absent.
 *   runsPer              `1`, read the same way. Every file is examined exactly once, and
 *                        a validator that examined a file twice would return the same
 *                        answer -- there is no sampling here to have a repeat count for.
 *                        `1` is the truthful repeat count, not a stand-in for "unknown".
 *   installState         `unknown` unless `--with-environment` was passed, which is
 *                        precisely what the contract reserves `unknown` for: the sweep did
 *                        not run. Writing `absent` there would be a claim about a machine
 *                        nothing looked at.
 *
 * ONE FIELD DOES NOT FIT, AND IT IS NOT FILLED IN WITH A GUESS
 * ------------------------------------------------------------
 * `run.target` is specified as "the artifact's authored name -- `ask-user-question`, not a
 * path", and it is required and non-nullable. This entry point cannot supply one. Two
 * reasons, and the second is the load-bearing one:
 *
 *   - a validator is pointed at artifacts whose name is missing, empty, not a string or
 *     not kebab-case, because reporting exactly that is its job. "The artifact has no
 *     name" is a state the field cannot represent, and it is a state this operation sees
 *     constantly.
 *   - reading a name means knowing where each artifact keeps one -- frontmatter for a
 *     skill, a different frontmatter key for an agent, JSON for `mcp` and `plugin` -- and
 *     branching on artifact type is the one thing this file is built never to do. The
 *     whole shape exists so that a sixth artifact is a rules module and a registry line.
 *
 * So the path's basename goes in, matching the report's own header, and a `caps` sentence
 * says that is what it is. That is the honest handling of a field that does not fit: fill
 * it with something defined, and say plainly that it is not what the field asked for.
 */

/** One finding, in the envelope's row vocabulary. */
export interface ValidationRow {
  /**
   * The file the finding is about, exactly as the finding named it.
   *
   * Two shapes, and neither is rewritten into the other. A section that named a file names
   * it the way it chose to -- the purity scanner reports paths relative to the scanned root
   * deliberately, so its output is stable across machines -- and re-anchoring that to an
   * absolute path here would throw away a property somebody picked on purpose. A finding
   * that named no file gets the resolved artifact path, which is the true answer for a
   * frontmatter error about a single-file agent: the finding really is about that file.
   *
   * A consumer that needs one form joins on the artifact rather than guessing, which is why
   * `section` travels alongside.
   */
  readonly file: string;
  /** 1-indexed, or `null` when the finding is about the file rather than a line in it. */
  readonly line: number | null;
  readonly severity: "error" | "warning";
  /**
   * What was violated. A purity finding carries a real rule slug; everything else carries
   * the section that produced it, which is the coarsest true answer rather than an invented
   * identifier.
   */
  readonly rule: string;
  readonly message: string;
  /** The heading this finding was rendered under, so a row can be traced back. */
  readonly section: string;
}

/**
 * `\`file:line\` — **rule** — message`, the shape `../rules/skill.ts` renders a purity
 * finding in. Nothing else in the rules tree emits it, which is exactly why it is matched
 * rather than assumed.
 */
const STRUCTURED_FINDING = /^`([^`]+)` — \*\*([^*]+)\*\* — ([\s\S]+)$/;

/**
 * Recover a finding's structure from the string a section rendered it as.
 *
 * The `Section` contract carries `errors` and `warnings` as plain markdown strings, with
 * no field for a file or a line, because it was built for a report that prints them. The
 * envelope's row wants five columns. Rather than widen `Section` -- which would touch every
 * rules module and this entry point's whole reason for existing -- the structure is read
 * back out of the one rendering that has it, and every other finding degrades to a row
 * that is still completely true: the file is the artifact, the line is `null` because
 * there genuinely is no line recorded, and the rule is the section heading.
 *
 * The degradation is what makes this safe. A parse that fails loses nothing, because
 * `message` always holds the finding verbatim when no prefix was recognized; there is no
 * path where a mis-parse silently drops text a reader needed.
 */
export function parseFinding(params: {
  readonly text: string;
  readonly severity: "error" | "warning";
  readonly section: string;
  /** Where the artifact under validation lives, for findings that name no file. */
  readonly fallbackFile: string;
}): ValidationRow {
  const match = STRUCTURED_FINDING.exec(params.text);
  if (match === null) {
    return {
      file: params.fallbackFile,
      line: null,
      severity: params.severity,
      rule: params.section,
      message: params.text,
      section: params.section,
    };
  }
  const [, locator = "", rule = "", message = ""] = match;
  // `file:line`, but only when the tail is digits. A Windows-style `C:/x` or a path with a
  // colon in it must not lose its last segment to a line number that was never there.
  const colon = locator.lastIndexOf(":");
  const tail = colon === -1 ? "" : locator.slice(colon + 1);
  const hasLine = tail !== "" && /^\d+$/.test(tail);
  const line = hasLine ? Number(tail) : null;
  return {
    file: hasLine ? locator.slice(0, colon) : locator,
    // `0` is the purity scanner's "about the file, not a line" sentinel. It becomes `null`
    // here rather than travelling as a line number no editor can jump to.
    line: line === 0 ? null : line,
    severity: params.severity,
    rule: rule.trim(),
    message: message.trim(),
    section: params.section,
  };
}

/** Every finding in every section, flattened into rows in the order they were reported. */
export function findingRows(
  sections: readonly Section[],
  fallbackFile: string,
): readonly ValidationRow[] {
  const rows: ValidationRow[] = [];
  for (const s of sections) {
    for (const text of s.errors) {
      rows.push({ ...parseFinding({ text, severity: "error", section: s.title, fallbackFile }) });
    }
    for (const text of s.warnings) {
      rows.push({ ...parseFinding({ text, severity: "warning", section: s.title, fallbackFile }) });
    }
  }
  return rows;
}

/** What the run had in front of it, for `provenance`. */
export interface FileCensus {
  /** Files the checks could open. This is `provenance.scored`. */
  readonly examined: number;
  /** Files that are there and would not open. Both `excluded` and `failed`. */
  readonly unreadable: number;
}

/**
 * Count the files the validation was run over.
 *
 * The same enumeration and the same two exclusions {@link hashArtifact} uses, deliberately:
 * `provenance.scored` and `run.targetSha` then describe the same set of files, and a
 * reader can take the count as the size of the thing that was hashed. Counting
 * `node_modules` would also make the number a report on somebody's install rather than on
 * the artifact -- it can outnumber the authored files by three orders of magnitude.
 *
 * A file that enumerates and will not `stat` is counted apart rather than skipped. Skipping
 * would let a file that vanished mid-run, or one this process cannot see, be indistinguishable
 * from a file that was checked and found clean -- which is the exact shape of the failure
 * `--with-environment` exists to refuse.
 */
export async function censusArtifactFiles(path: string): Promise<FileCensus> {
  const root = resolvePath(path);
  if (!(await isDirectory(root))) {
    try {
      await Bun.file(root).stat();
      return { examined: 1, unreadable: 0 };
    } catch {
      return { examined: 0, unreadable: 1 };
    }
  }

  const names = await Array.fromAsync(
    new Bun.Glob("**/*").scan({ cwd: root, onlyFiles: true, followSymlinks: false }),
  );
  let examined = 0;
  let unreadable = 0;
  for (const name of names) {
    const relPath = name.split("\\").join("/");
    if (relPath.split("/").some((segment) => HASH_EXCLUDED_SEGMENTS.includes(segment))) continue;
    try {
      await Bun.file(`${root}/${relPath}`).stat();
      examined += 1;
    } catch {
      unreadable += 1;
    }
  }
  return { examined, unreadable };
}

/**
 * The artifact kinds this entry point can validate, checked against the envelope's union.
 *
 * `satisfies` makes the compiler reject an entry the envelope does not know, so the two
 * lists cannot drift apart silently in that direction. The other direction -- a sixth
 * artifact added to `../rules/registry.ts` -- is caught at runtime by
 * {@link asArtifactKind} and by a test that walks `TARGET_TYPES`, because `RULES` is keyed
 * by plain strings and nothing about it is a type the compiler can compare against.
 */
export const ENVELOPE_ARTIFACTS = [
  "skill",
  "agent",
  "command",
  "mcp",
  "plugin",
] as const satisfies readonly ArtifactKind[];

/** Map a `--target-type` onto the envelope's artifact vocabulary, refusing to invent one. */
export function asArtifactKind(targetType: string): ArtifactKind {
  const match = ENVELOPE_ARTIFACTS.find((kind) => kind === targetType);
  if (match === undefined) {
    throw new CliError(
      `--target-type ${targetType} is validated here but is not one of the artifact kinds ` +
        `the results envelope knows (${ENVELOPE_ARTIFACTS.join(", ")}). Add it to ` +
        `\`ArtifactKind\` in \`lib/envelope.ts\` before asking for an envelope, rather than ` +
        `recording it as something it is not.`,
    );
  }
  return match;
}

export interface ValidationEnvelopeInput {
  readonly sections: readonly Section[];
  readonly targetType: string;
  /** Exactly what the user pointed at, unresolved. Resolved once, here. */
  readonly path: string;
  readonly tier: Tier;
  readonly withEnvironment: boolean;
  readonly census: FileCensus;
  readonly targetSha: string;
  readonly installState: InstallState;
  /** Extra coverage caveats from the caller -- install sightings, mostly. */
  readonly caps?: readonly string[];
  readonly startedAt?: Date;
}

/**
 * Build the envelope for one validation run.
 *
 * Pure and exported, like the other producers' builders, and for a slightly different
 * reason: nothing here costs API time, but the judgements -- which fields are `null`
 * because they cannot apply, which caps a `--standard` run has to declare, whether a check
 * that was not performed reads as a pass -- are exactly the ones that would rot silently.
 */
export function buildValidationEnvelope(
  input: ValidationEnvelopeInput,
): Envelope<ValidationRow> {
  // Resolved first, before anything reads `RULES`. Every artifact kind the envelope knows
  // is in the registry, so a target type this rejects is also one `RULES[...]` would have
  // dereferenced as `undefined` — and a `TypeError` on a missing property is a far worse
  // report of "the registry and the envelope's vocabulary have drifted" than the sentence
  // `asArtifactKind` throws.
  const artifact = asArtifactKind(input.targetType);
  const rule = RULES[input.targetType]!;
  const resolved = resolvePath(input.path);
  const rows = findingRows(input.sections, resolved);
  const errors = rows.filter((row) => row.severity === "error");
  const warnings = rows.filter((row) => row.severity === "warning");

  const headline: HeadlineMetric[] = [
    { label: "errors", value: errors.length, unit: "findings" },
    { label: "warnings", value: warnings.length, unit: "findings" },
    { label: "files examined", value: input.census.examined, unit: "files" },
  ];

  const caps: string[] = [...(input.caps ?? [])];
  // First, because it qualifies `run.target` itself rather than the coverage. See the
  // block comment above this section for why the name cannot be read here.
  caps.push(
    `\`run.target\` is the path's basename rather than the artifact's authored name. This ` +
      `entry point never branches on artifact type, so it has nowhere to read a name from — ` +
      `and a validator is routinely pointed at artifacts whose name is missing or malformed, ` +
      `which is a state the field cannot express.`,
  );
  caps.push(
    `Only the \`${input.targetType}\` rules ran (\`--target-type\`). Nothing here checked ` +
      `the artifact against any other artifact's rules, and a file that is both — a plugin ` +
      `holding skills, say — needs a pass per kind.`,
  );
  if (rule.honoursTier && input.tier === "standard") {
    caps.push(
      "Checked against the portable Agent Skills field set only (`--standard`). Claude " +
        "Code's extension fields were treated as unknown rather than validated, so an " +
        "artifact that passes here may still carry an extension field with a bad value.",
    );
  }
  if (rule.honoursEnvironment && !input.withEnvironment) {
    caps.push(
      "The environment-dependent checks were NOT performed (`--with-environment` was not " +
        "passed), so nothing looked at the installed set. A neighbour installed under a " +
        "colliding name would not have been noticed, and this run says nothing either way.",
    );
  }
  if (input.census.unreadable > 0) {
    caps.push(
      `${input.census.unreadable} file(s) inside the artifact could not be opened and were ` +
        `left out of the count above. A file that is there and will not read has not been ` +
        `checked, and this run cannot say whether it is clean.`,
    );
  }

  // One verdict per section, plus the artifact's own. `not-checked` is the vocabulary the
  // contract names for this operation, and it exists because "the collision check found
  // nothing" and "the collision check did not run" render identically as a clean section
  // and mean opposite things -- which is the failure `--with-environment` was built around.
  const verdicts: Verdict[] = [];
  verdicts.push({
    subject: baseName(input.path),
    verdict: errors.length === 0 ? "valid" : "invalid",
    reason:
      errors.length === 0
        ? `No errors across ${input.sections.length} section(s)` +
          `${warnings.length > 0 ? `, ${warnings.length} warning(s)` : ""}. ` +
          `This is a verdict about what was checked; see \`provenance.caps\` for what was not.`
        : `${errors.length} error(s) and ${warnings.length} warning(s) across ` +
          `${input.sections.length} section(s).`,
  });
  for (const s of input.sections) {
    const sectionErrors = s.errors.length;
    const sectionWarnings = s.warnings.length;
    verdicts.push({
      subject: s.title,
      // `no-findings` rather than `pass`, and the distinction is the whole reason this
      // entry point has a `--with-environment` flag at all. A section that ran and was
      // satisfied and a section that declined to look both arrive here as zero errors and
      // zero warnings, and this file cannot tell them apart without branching on artifact
      // type -- `Section` carries no field saying whether the check was performed, only a
      // `note` in prose. `pass` would be a judgement this code has not earned on the second
      // of those; `no-findings` is a report of what came back, which is true of both. The
      // note is appended verbatim because it is where a declining section says so.
      verdict: sectionErrors > 0 ? "invalid" : sectionWarnings > 0 ? "warned" : "no-findings",
      reason:
        `${sectionErrors} error(s), ${sectionWarnings} warning(s).` +
        (s.note === undefined ? "" : ` ${s.note}`),
    });
  }
  if (rule.honoursEnvironment && !input.withEnvironment) {
    verdicts.push({
      subject: "environment-dependent checks",
      verdict: "not-checked",
      reason:
        "`--with-environment` was not passed, so nothing read the installed set. A clean " +
        "report is not a clean bill of health on collisions — the check did not run.",
    });
  }

  return buildEnvelope<ValidationRow>({
    run: {
      ...(input.startedAt === undefined ? {} : { startedAt: input.startedAt }),
      artifact,
      target: baseName(input.path),
      operation: "validate",
      model: null,
      graderModel: null,
      workers: 1,
      runsPer: 1,
      timeoutSeconds: null,
      evalSetHash: null,
      targetSha: input.targetSha,
      installState: input.installState,
    },
    provenance: {
      // No token figure is reported anywhere in this envelope. A skill's body-token check
      // does print a count inside a finding's prose when `tiktoken` is installed, but that
      // is a sentence in a message rather than a field here, and claiming `tiktoken` would
      // be a statement about numbers this file does not carry.
      tokenizer: "none",
      unit: "file examined",
      scored: input.census.examined,
      // Identical to `failed` for this operation, and reported anyway. The two answer
      // different questions -- how many were dropped from the count, and how many broke --
      // and they coincide here only because the timeout policy is `not-applicable`. Under
      // `measure-triggering`'s `scored` policy the same failures land inside the numbers
      // and the two counts diverge, which is the comparison this pair exists to make
      // possible.
      excluded: input.census.unreadable,
      failed: input.census.unreadable,
      // Nothing here spawns anything, so nothing can exceed a budget. This is the value the
      // contract defines for exactly that case, not a hedge.
      timeoutPolicy: "not-applicable",
      caps,
    },
    headline,
    rows,
    verdicts,
  });
}

if (import.meta.main) {
  try {
    const { flags, positionals } = parseArgs(Bun.argv.slice(2), CLI_SPEC);

    if (flags["help"] === true) {
      console.log(formatHelp(USAGE, CLI_SPEC));
      process.exit(0);
    }

    const targetType = requireTargetType(flags);
    const rule = RULES[targetType]!;

    const path = positionals[0];
    if (path === undefined) throw new CliError(`missing <path> — expected ${rule.expects}\n\n${USAGE}`);
    if (positionals.length > 1) {
      throw new CliError(`unexpected extra argument: ${positionals[1]}\n\n${USAGE}`);
    }

    const tier = resolveTier(flags);
    const withEnvironment = flags["with-environment"] === true;

    // Rejected rather than ignored. The flag is a claim about what the run
    // covered, and accepting it where nothing reads the environment would make
    // the claim meaningless on exactly the artifacts where it is cheapest to
    // believe.
    if (withEnvironment && !rule.honoursEnvironment) {
      throw new CliError(
        `--with-environment has no environment-dependent checks for --target-type ${targetType}. ` +
          `It applies to: ${TARGET_TYPES.filter((t) => RULES[t]!.honoursEnvironment).join(", ")}.`,
      );
    }
    if ((flags["standard"] === true || flags["extended"] === true) && !rule.honoursTier) {
      throw new CliError(
        `--standard and --extended do not apply to --target-type ${targetType}; the Agent ` +
          `Skills standard defines no ${targetType} artifact, so there is no portable subset ` +
          `to check against.`,
      );
    }

    const sections = await runValidation(targetType, { path, tier, withEnvironment });
    console.log(formatReport(sections, targetType, path, tier, withEnvironment));

    // After the report and before the exit. The markdown is what a human and every existing
    // caller read, so it goes out first and unchanged; an envelope that could not be written
    // must not cost anyone the verdict they asked for.
    const envelopePath = flags["envelope"];
    if (typeof envelopePath === "string" && envelopePath !== "") {
      // `unknown` unless the run actually read the machine. The contract is explicit that
      // this is the honest value for a sweep that did not happen and that `absent` would be
      // a claim -- and a validator asserting an artifact is not installed, on a run where
      // nothing looked, is the same shape of lie as a collision check reporting clean
      // because it could not enumerate.
      let installState: InstallState = "unknown";
      const caps: string[] = [];
      if (withEnvironment) {
        const sighting = await detectInstallState({
          artifact: asArtifactKind(targetType),
          name: baseName(path),
          sourcePath: path,
        });
        installState = sighting.state;
        if (sighting.cap !== null) caps.push(sighting.cap);
      }
      await writeEnvelope(
        envelopePath,
        buildValidationEnvelope({
          sections,
          targetType,
          path,
          tier,
          withEnvironment,
          census: await censusArtifactFiles(path),
          targetSha: await hashArtifact(resolvePath(path)),
          installState,
          caps,
        }),
      );
      console.error(`Envelope written to: ${envelopePath}`);
    }

    process.exit(sections.some((s) => s.errors.length > 0) ? 1 : 0);
  } catch (error) {
    if (error instanceof RuleAbort) {
      console.log(`Error: ${error.message}`);
      process.exit(2);
    }
    if (!(error instanceof CliError)) throw error;
    console.log(`Error: ${error.message}`);
    process.exit(2);
  }
}
