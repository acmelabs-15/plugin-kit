/**
 * The two-severity finding tier, expressed in Zod's issue vocabulary.
 *
 * Zod has one outcome -- an issue -- and the validators being mirrored have two:
 * an error that fails the artifact and a warning that does not. The carrier is
 * `params.severity`, which Zod passes through untouched, plus `fatal: false` so a
 * warning never aborts the checks queued behind it.
 *
 * A parse carrying only warnings still reports `success: false`; that is Zod's
 * contract and not something to fight. `partitionIssues` is what turns the issue
 * list back into the errors/warnings split the report layer speaks.
 */

export const SEVERITIES = ["error", "warning"] as const;
export type Severity = (typeof SEVERITIES)[number];

/**
 * A type alias rather than an interface on purpose: only an alias gets TypeScript's
 * implicit index signature, and without one it is not assignable to the
 * `Record<string, any>` Zod declares for `params`.
 */
export type SeverityParams = { readonly severity: Severity };

/** One finding, already split out of a Zod issue list. */
export interface Finding {
  readonly severity: Severity;
  readonly message: string;
}

/**
 * The slice of a Zod refinement context these helpers need.
 *
 * Declared structurally rather than imported as `z.RefinementCtx` so the helpers
 * stay usable from a plain object in tests, and so a Zod internal type rename
 * cannot reach this file.
 */
export interface IssueSink {
  addIssue(issue: {
    readonly code: "custom";
    readonly message: string;
    readonly path?: PropertyKey[];
    readonly fatal?: boolean;
    readonly params?: SeverityParams;
  }): void;
}

/** A finding that fails the artifact. */
export function addError(
  ctx: IssueSink,
  message: string,
  path: readonly PropertyKey[] = [],
): void {
  ctx.addIssue({ code: "custom", message, path: [...path], params: { severity: "error" } });
}

/**
 * A finding that does not fail the artifact.
 *
 * `fatal: false` is the load-bearing half: without it a warning would be free to
 * stop the checks that come after it, and the report would silently lose findings.
 */
export function addWarning(
  ctx: IssueSink,
  message: string,
  path: readonly PropertyKey[] = [],
): void {
  ctx.addIssue({
    code: "custom",
    message,
    path: [...path],
    fatal: false,
    params: { severity: "warning" },
  });
}

/**
 * Read an issue's severity, defaulting to `error` for issues Zod raised itself.
 *
 * Takes `unknown` because Zod's issue union has members with no `params` at all,
 * and a structural parameter type would be rejected as a weak type.
 */
export function severityOf(issue: unknown): Severity {
  if (typeof issue !== "object" || issue === null) return "error";
  const params: unknown = (issue as Record<string, unknown>)["params"];
  if (typeof params !== "object" || params === null) return "error";
  const severity: unknown = (params as Record<string, unknown>)["severity"];
  return severity === "warning" ? "warning" : "error";
}

/** Split an issue list into the errors/warnings shape the report layer renders. */
export function partitionIssues(
  issues: readonly { readonly message: string }[],
): { readonly errors: readonly string[]; readonly warnings: readonly string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const issue of issues) {
    (severityOf(issue) === "warning" ? warnings : errors).push(issue.message);
  }
  return { errors, warnings };
}
