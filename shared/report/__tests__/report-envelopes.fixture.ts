/**
 * Four envelopes, one per producer that writes one, typed against the producers' OWN row
 * declarations.
 *
 * The import of `TriggerRow`, `ValidationRow`, `DescriptionRow` and `DisclosureRow` is the
 * point of this file rather than an incidental convenience: it is what makes these real
 * shapes rather than four hand-drawn tables that happen to resemble them. If a producer
 * renames `pullRate` or drops `earlyStopped`, this file stops type-checking and the
 * renderer's tests fail against the change, which is exactly what a renderer built against
 * one operation's data could never do.
 *
 * The row VALUES are representative rather than captured from a live run -- three of the
 * four operations spawn a model -- but the KEYS, their types and the `run`/`provenance`
 * blocks are the producers' own, and every envelope here is round-tripped through
 * `writeEnvelope`/`readEnvelope` in the tests so the schema, not this file, decides whether
 * they are well-formed.
 */

import { buildEnvelope, type Envelope } from "../../envelope.ts";
import type { DisclosureRow } from "../../operations/optimize-disclosure.ts";
import type { DescriptionRow } from "../../operations/optimize-description.ts";
import type { TriggerRow } from "../../operations/measure-triggering.ts";
import type { ValidationRow } from "../../validate/validate.ts";

const STARTED = "2026-08-09T09:00:00.000Z";

/** `measure-triggering`: scored timeout policy, real recall/false-trigger headline. */
export function triggeringEnvelope(
  overrides: { readonly workers?: number; readonly installState?: "absent" | "shadowed" } = {},
): Envelope<TriggerRow> {
  return buildEnvelope<TriggerRow>({
    run: {
      id: "measure-triggering-ask-user-question-20260809T090000Z-aaaaaa",
      startedAt: STARTED,
      artifact: "skill",
      target: "ask-user-question",
      operation: "measure-triggering",
      model: "claude-opus-4",
      graderModel: null,
      workers: overrides.workers ?? 4,
      runsPer: 5,
      timeoutSeconds: 150,
      evalSetHash: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
      targetSha: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
      installState: overrides.installState ?? "shadowed",
    },
    provenance: {
      tokenizer: "none",
      unit: "query attempt",
      scored: 40,
      excluded: 0,
      failed: 3,
      timeoutPolicy: "scored",
      caps: [
        "2 installations answer to `ask-user-question`. Whichever the router picked is the " +
          "one that was measured, and it is not necessarily the source under test.",
        "3 attempt(s) hit the 150s budget and were SCORED as non-triggers.",
      ],
    },
    headline: [
      { label: "queries passed", value: 6, unit: "of 8" },
      { label: "pass rate", value: 0.75, unit: "fraction" },
      { label: "recall", value: 0.7, unit: "fraction" },
      { label: "false triggers", value: 0.1, unit: "fraction" },
    ],
    rows: [
      {
        query: "which of these two should I ship",
        shouldTrigger: true,
        triggers: 5,
        runs: 5,
        triggerRate: 1,
        pass: true,
        earlyStopped: false,
      },
      {
        query: "write a guide to asking good questions",
        shouldTrigger: false,
        triggers: 2,
        runs: 5,
        triggerRate: 0.4,
        pass: false,
        earlyStopped: true,
      },
    ],
    verdicts: [
      {
        subject: "which of these two should I ship",
        verdict: "pass",
        reason: "5/5 attempts triggered (1.00) against a 0.6 threshold; expected a trigger.",
      },
      {
        subject: "write a guide to asking good questions",
        verdict: "fail",
        reason:
          "2/5 attempts triggered (0.40) against a 0.6 threshold; expected no trigger, " +
          "stopped early once the verdict was settled.",
      },
    ],
  });
}

/** `validate`: no model, no timeout, `not-applicable` policy, severity/line rows. */
export function validationEnvelope(): Envelope<ValidationRow> {
  return buildEnvelope<ValidationRow>({
    run: {
      id: "validate-oncall-20260809T090000Z-bbbbbb",
      startedAt: STARTED,
      artifact: "plugin",
      target: "oncall",
      operation: "validate",
      model: null,
      graderModel: null,
      workers: 1,
      runsPer: 1,
      timeoutSeconds: null,
      evalSetHash: null,
      targetSha: "sha256:3333333333333333333333333333333333333333333333333333333333333333",
      installState: "unknown",
    },
    provenance: {
      tokenizer: "none",
      unit: "file examined",
      scored: 12,
      excluded: 1,
      failed: 1,
      timeoutPolicy: "not-applicable",
      caps: [
        "`--with-environment` was not passed, so nothing read the installed set. A clean " +
          "report is not a clean bill of health on collisions.",
      ],
    },
    headline: [
      { label: "errors", value: 2, unit: "findings" },
      { label: "warnings", value: 1, unit: "findings" },
    ],
    rows: [
      {
        file: "skills/oncall/SKILL.md",
        line: 14,
        severity: "error",
        rule: "frontmatter",
        message: "`description` is missing a deliverable clause.",
        section: "Frontmatter",
      },
      {
        file: "skills/oncall/scripts/triage.ts",
        line: null,
        severity: "warning",
        rule: "bun-purity",
        message: "`node:fs` import carries `readFileSync`.",
        section: "Purity",
      },
    ],
    verdicts: [
      {
        subject: "environment-dependent checks",
        verdict: "not-checked",
        reason: "`--with-environment` was not passed, so nothing read the installed set.",
      },
      { subject: "Frontmatter", verdict: "invalid", reason: "1 error(s), 0 warning(s)." },
    ],
  });
}

/** `optimize-disclosure`: the one producer with a grader and a real tokenizer. */
export function disclosureEnvelope(): Envelope<DisclosureRow> {
  return buildEnvelope<DisclosureRow>({
    run: {
      id: "optimize-disclosure-code-review-20260809T090000Z-cccccc",
      startedAt: STARTED,
      artifact: "skill",
      target: "code-review",
      operation: "optimize-disclosure",
      model: "claude-opus-4",
      graderModel: "claude-sonnet-4",
      workers: 4,
      runsPer: 3,
      timeoutSeconds: 300,
      evalSetHash: "sha256:4444444444444444444444444444444444444444444444444444444444444444",
      targetSha: "sha256:5555555555555555555555555555555555555555555555555555555555555555",
      installState: "installed",
    },
    provenance: {
      tokenizer: "estimated",
      unit: "scenario run",
      scored: 18,
      excluded: 2,
      failed: 2,
      timeoutPolicy: "excluded",
      caps: [
        "`optimize-disclosure` needs the target NOT to be installed, and it is (installed). " +
          "Pull rates measured under this condition are floored at zero.",
        "Token counts are estimated rather than tokenized, so a body measured at 4,800 " +
          "tokens against a 5,000-token budget has not been shown to be inside it.",
      ],
    },
    headline: [
      { label: "context tokens", value: 4820, unit: "tokens" },
      { label: "pass rate", value: 0.83, unit: "fraction" },
    ],
    rows: [
      {
        path: "references/rubric.md",
        loadMode: "read",
        tokens: 1840,
        pulls: 0,
        countedRuns: 16,
        pullRate: 0,
        signposted: true,
        verdict: "prune",
      },
      {
        path: "scripts/emit.ts",
        loadMode: "execute",
        tokens: 620,
        pulls: 16,
        countedRuns: 16,
        pullRate: 1,
        signposted: true,
        verdict: "keep",
      },
    ],
    verdicts: [
      {
        subject: "code-review",
        verdict: "unsound",
        reason: "`optimize-disclosure` needs the target NOT to be installed, and it is.",
      },
      { subject: "references/rubric.md", verdict: "prune", reason: "Never pulled in 16 runs." },
    ],
  });
}

/** `optimize-description`: nullable held-out columns, so the union-of-keys path is exercised. */
export function descriptionEnvelope(): Envelope<DescriptionRow> {
  return buildEnvelope<DescriptionRow>({
    run: {
      id: "optimize-description-oncall-20260809T090000Z-dddddd",
      startedAt: STARTED,
      artifact: "skill",
      target: "oncall",
      operation: "optimize-description",
      model: "claude-opus-4",
      graderModel: null,
      workers: 4,
      runsPer: 5,
      timeoutSeconds: 150,
      evalSetHash: "sha256:6666666666666666666666666666666666666666666666666666666666666666",
      targetSha: "sha256:7777777777777777777777777777777777777777777777777777777777777777",
      installState: "absent",
    },
    provenance: {
      tokenizer: "none",
      unit: "query attempt",
      scored: 60,
      excluded: 0,
      failed: 0,
      timeoutPolicy: "scored",
      // Deliberately empty: the empty-caps path is a claim the page has to state out loud,
      // and no other fixture here exercises it.
      caps: [],
    },
    headline: [{ label: "held-out passed", value: 7, unit: "of 10" }],
    rows: [
      {
        iteration: 1,
        description: "Triages oncall findings.",
        trainPassed: 4,
        trainTotal: 10,
        testPassed: null,
        testTotal: null,
        selected: false,
      },
      {
        iteration: 2,
        description: "Triages UX Platform oncall findings and produces the day's work.",
        trainPassed: 9,
        trainTotal: 10,
        testPassed: 7,
        testTotal: 10,
        selected: true,
      },
    ],
    verdicts: [
      { subject: "iteration 1", verdict: "scored", reason: "4/10 train queries passed." },
      {
        subject: "iteration 2",
        verdict: "selected",
        reason: "7/10 held-out queries passed — the best of the run.",
      },
    ],
  });
}
