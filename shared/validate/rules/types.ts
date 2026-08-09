/**
 * The contract every artifact's rules module implements.
 *
 * The point of the split is that `../validate.ts` never learns what an
 * artifact is. It parses argv, picks a module out of the registry, runs it, and
 * renders whatever sections come back. Supporting a seventh artifact is a new
 * file in this directory and one line in `registry.ts` -- not a new script, and
 * not a new branch in the entry point.
 *
 * Pure Bun, no dependencies.
 */

/** Conformance tier, for the artifacts where portability is a real question. */
export type Tier = "standard" | "extended";

export interface RuleContext {
  /** Exactly what the user pointed at, unresolved, for messages. */
  readonly path: string;
  readonly tier: Tier;
  /**
   * Whether the caller asked for checks that read the machine's installed set.
   * A module that has environment-dependent checks must run them when this is
   * true and say they were skipped when it is false -- never report a clean
   * result it did not actually establish.
   */
  readonly withEnvironment: boolean;
}

/**
 * One group of findings, rendered as its own heading.
 *
 * Sections exist rather than one flat list because the checks answer different
 * questions -- "is this well-formed", "does it need something the user has not
 * got", "will a neighbour steal its triggers" -- and a reader fixing one wants
 * the others out of the way. `note` carries what a section has to say when it
 * found nothing, which is the whole mechanism behind the collision check
 * refusing to look clean when it did not look.
 */
export interface Section {
  readonly title: string;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  /** Shown under the heading whether or not there were findings. */
  readonly note?: string;
}

/** Thrown by a rules module when it cannot reach a verdict at all. */
export class RuleAbort extends Error {}

export interface RuleModule {
  readonly targetType: string;
  /** One line in `--help`, so the documented surface cannot drift from the code. */
  readonly summary: string;
  /** Whether `--standard` / `--extended` mean anything for this artifact. */
  readonly honoursTier: boolean;
  /** Whether this artifact has any environment-dependent checks at all. */
  readonly honoursEnvironment: boolean;
  /** What `<path>` should point at, for the usage line and error messages. */
  readonly expects: string;
  run(context: RuleContext): Promise<readonly Section[]>;
}

export function section(
  title: string,
  errors: readonly string[],
  warnings: readonly string[],
  note?: string,
): Section {
  return note === undefined ? { title, errors, warnings } : { title, errors, warnings, note };
}
