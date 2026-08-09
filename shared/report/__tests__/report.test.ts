/**
 * Every assertion here runs against FOUR envelope shapes, not one.
 *
 * The hazard this file is written to catch is named in `envelope.ts`: a shared renderer
 * built against a single producer is a fifth renderer with a better name. So the shape-
 * dependent tests loop over all four producers' envelopes and assert the same properties of
 * each, and a separate test asserts that no operation gets a section the others do not.
 */

import { describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";

import { readEnvelope, writeEnvelope, type Envelope } from "../../envelope.ts";
import {
  buildComparison,
  buildReportPayload,
  defaultOutPath,
  deriveColumns,
  EMBEDDED_DATA_TOKEN,
  FINDINGS_SLOT,
  humanizeKey,
  loadTemplate,
  renderReport,
  renderReportFrom,
  ReportTemplateError,
  serializeForScriptTag,
  writeReport,
} from "../report.ts";
import {
  descriptionEnvelope,
  disclosureEnvelope,
  triggeringEnvelope,
  validationEnvelope,
} from "./report-envelopes.fixture.ts";

const AT = "2026-08-09T12:00:00.000Z";

const SHAPES: readonly (readonly [string, Envelope])[] = [
  ["measure-triggering", triggeringEnvelope()],
  ["validate", validationEnvelope()],
  ["optimize-disclosure", disclosureEnvelope()],
  ["optimize-description", descriptionEnvelope()],
];

/** The data assignment the page executes, recovered from the rendered HTML. */
function embeddedJson(html: string): unknown {
  const match = /const EMBEDDED_DATA = (\{[\s\S]*?\});\n/.exec(html);
  expect(match).not.toBeNull();
  return JSON.parse(match![1]!) as unknown;
}

describe("the fixtures are real envelopes, not hand-drawn tables", () => {
  test.each(SHAPES.map(([name, envelope]) => [name, envelope] as const))(
    "%s round-trips through the envelope schema",
    async (name, envelope) => {
      const path = `${import.meta.dir}/../../../.tmp-report-test-${name}.json`;
      await writeEnvelope(path, envelope);
      const read = await readEnvelope(path);
      expect(read.run.operation).toBe(envelope.run.operation);
      expect(read.rows.length).toBe(envelope.rows.length);
      await rm(path, { force: true });
    },
  );
});

describe("column derivation is generic", () => {
  test("humanizes keys without knowing what they mean", () => {
    expect(humanizeKey("pullRate")).toBe("Pull rate");
    expect(humanizeKey("targetSha")).toBe("Target sha");
    expect(humanizeKey("should_trigger")).toBe("Should trigger");
  });

  test("takes the union of keys, in first-seen order", () => {
    const columns = deriveColumns([{ b: 1, a: "x" }, { c: true, a: "y" }]);
    expect(columns.map((column) => column.key)).toEqual(["b", "a", "c"]);
  });

  test("marks a column numeric when any row carries a number under it", () => {
    // `testPassed` is `number | null` on DescriptionRow: the first row's null must not
    // decide the column is text.
    const columns = deriveColumns(descriptionEnvelope().rows);
    const testPassed = columns.find((column) => column.key === "testPassed");
    expect(testPassed?.numeric).toBe(true);
  });

  test.each(SHAPES.map(([name, envelope]) => [name, envelope] as const))(
    "%s gets one column per key its rows declare",
    (_name, envelope) => {
      const declared = new Set(
        envelope.rows.flatMap((row) => Object.keys(row as Record<string, unknown>)),
      );
      const derived = new Set(deriveColumns(envelope.rows).map((column) => column.key));
      expect(derived).toEqual(declared);
    },
  );

  test("drops a non-record row rather than coercing it", () => {
    const payload = buildReportPayload(
      { ...validationEnvelope(), rows: ["not a row", 7, null] } as Envelope,
      { generatedAt: AT },
    );
    expect(payload.rows).toEqual([]);
    expect(payload.columns).toEqual([]);
  });
});

describe("the page carries run and provenance, not just the headline", () => {
  test.each(SHAPES.map(([name, envelope]) => [name, envelope] as const))(
    "%s embeds every run field, including the nulls",
    (_name, envelope) => {
      const payload = buildReportPayload(envelope, { generatedAt: AT });
      const labels = payload.runFields.map(([label]) => label);
      expect(labels).toContain("Install state");
      expect(labels).toContain("Target sha");
      expect(labels).toContain("Model");
      expect(labels).toContain("Grader model");
      // A field is present even when its value is null: an absent key and a null value
      // read identically to a reader while meaning opposite things.
      expect(payload.runFields.length).toBe(13);
      expect(payload.run.installState).toBe(envelope.run.installState);
    },
  );

  test.each(SHAPES.map(([name, envelope]) => [name, envelope] as const))(
    "%s embeds the coverage counts and the timeout policy",
    (_name, envelope) => {
      const fields = buildReportPayload(envelope, { generatedAt: AT }).provenanceFields;
      const byLabel = new Map(fields);
      expect(byLabel.get("Scored")).toBe(envelope.provenance.scored);
      expect(byLabel.get("Excluded")).toBe(envelope.provenance.excluded);
      expect(byLabel.get("Failed")).toBe(envelope.provenance.failed);
      expect(byLabel.get("Timeout policy")).toBe(envelope.provenance.timeoutPolicy);
      expect(byLabel.get("Unit")).toBe(envelope.provenance.unit);
    },
  );

  test.each(SHAPES.map(([name, envelope]) => [name, envelope] as const))(
    "%s carries every caps sentence verbatim into the page",
    async (_name, envelope) => {
      const html = await renderReport(envelope, { generatedAt: AT });
      const data = embeddedJson(html) as { provenance: { caps: string[] } };
      expect(data.provenance.caps).toEqual([...envelope.provenance.caps]);
    },
  );

  test("an empty caps list is stated in words rather than left blank", async () => {
    const envelope = descriptionEnvelope();
    expect(envelope.provenance.caps).toEqual([]);
    const html = await renderReport(envelope, { generatedAt: AT });
    // The sentence lives in the template's renderer, so an empty list cannot render as
    // absence -- which is how partial coverage gets read as complete.
    expect(html).toContain("No coverage caps were recorded");
  });

  test("a shadowed install reaches the page, which is the failure it exists to catch", async () => {
    const html = await renderReport(triggeringEnvelope(), { generatedAt: AT });
    const data = embeddedJson(html) as { run: { installState: string; targetSha: string } };
    expect(data.run.installState).toBe("shadowed");
    expect(data.run.targetSha).toContain("sha256:");
    expect(html).toContain("installations answer to");
  });
});

describe("comparison routes through the envelope's own check", () => {
  test("draws deltas only when compareRuns says the pair is comparable", () => {
    const comparison = buildComparison(triggeringEnvelope(), triggeringEnvelope());
    expect(comparison.comparable).toBe(true);
    expect(comparison.explanation).toBeNull();
    expect(comparison.deltas.length).toBeGreaterThan(0);
  });

  test("refuses a delta and names the fields that moved", () => {
    const comparison = buildComparison(
      triggeringEnvelope(),
      triggeringEnvelope({ workers: 1, installState: "absent" }),
    );
    expect(comparison.comparable).toBe(false);
    expect(comparison.deltas).toEqual([]);
    expect(comparison.differing).toEqual(["workers", "installState"]);
    expect(comparison.explanation).toContain("`workers`");
    expect(comparison.explanation).toContain("`installState`");
  });

  test("an incomparable pair puts no delta on any headline metric", () => {
    const payload = buildReportPayload(triggeringEnvelope(), {
      baseline: triggeringEnvelope({ workers: 1 }),
      generatedAt: AT,
    });
    expect(payload.headline.every((metric) => metric.delta === undefined)).toBe(true);
  });

  test("a metric absent from the baseline gets no delta rather than a zero baseline", () => {
    const current = triggeringEnvelope();
    const baseline: Envelope = {
      ...triggeringEnvelope(),
      headline: [{ label: "pass rate", value: 0.5, unit: "fraction" }],
    };
    const comparison = buildComparison(current, baseline);
    expect(comparison.deltas.map((delta) => delta.label)).toEqual(["pass rate"]);
    expect(comparison.deltas[0]?.delta).toBeCloseTo(0.25, 10);
  });

  test("no comparison block at all when no baseline is supplied", () => {
    expect(buildReportPayload(validationEnvelope(), { generatedAt: AT }).comparison).toBeNull();
  });
});

describe("the findings slot", () => {
  test("survives injection, empty, in every shape", async () => {
    for (const [, envelope] of SHAPES) {
      const html = await renderReport(envelope, { generatedAt: AT });
      expect(html).toContain(FINDINGS_SLOT);
      // Nothing in the render path writes an <li> into it. An unedited page is empty here
      // and says so at view time.
      expect(html).toContain("No findings written");
    }
  });

  test("a template that lost the slot is refused rather than shipped", async () => {
    const template = (await loadTemplate()).replace(FINDINGS_SLOT, "");
    expect(() => renderReportFrom(template, validationEnvelope())).toThrow(ReportTemplateError);
  });

  test("a template that lost the data token is refused", async () => {
    const template = (await loadTemplate()).replace(EMBEDDED_DATA_TOKEN, "");
    expect(() => renderReportFrom(template, validationEnvelope())).toThrow(ReportTemplateError);
  });
});

describe("the page is self-contained and operation-agnostic", () => {
  test.each(SHAPES.map(([name, envelope]) => [name, envelope] as const))(
    "%s renders the same sections as every other operation",
    async (_name, envelope) => {
      const html = await renderReport(envelope, { generatedAt: AT });
      for (const id of [
        "sec-headline",
        "sec-findings",
        "sec-run",
        "sec-provenance",
        "sec-rows",
        "sec-verdicts",
      ]) {
        expect(html).toContain(`id="${id}"`);
      }
    },
  );

  test.each(SHAPES.map(([name, envelope]) => [name, envelope] as const))(
    "%s fetches nothing at view time",
    async (_name, envelope) => {
      const html = await renderReport(envelope, { generatedAt: AT });
      expect(html).not.toContain("<link rel=\"stylesheet\"");
      expect(html).not.toContain("src=\"http");
      expect(html).not.toContain("fonts.googleapis");
      // The one remote-looking string in the design system is an inline data: URI whose
      // SVG namespace is a w3.org URL; nothing is requested from it.
      const remote = [...html.matchAll(/https?:\/\/[^"' )]+/g)].map((m) => m[0]);
      expect(remote.every((url) => url.startsWith("http://www.w3.org/"))).toBe(true);
    },
  );

  test("a `</script>` in producer text cannot terminate the data block", () => {
    const envelope: Envelope = {
      ...validationEnvelope(),
      verdicts: [{ subject: "x", verdict: "invalid", reason: "</script><b>oops</b>" }],
    };
    const json = serializeForScriptTag(buildReportPayload(envelope, { generatedAt: AT }));
    expect(json).not.toContain("</script>");
    expect(json).toContain("\\u003c");
    expect(JSON.parse(json)).toBeDefined();
  });

  test("row values with regex substitution patterns survive injection intact", async () => {
    const envelope: Envelope = {
      ...validationEnvelope(),
      rows: [{ file: "a.ts", line: 1, severity: "error", rule: "r", message: "$& $1 $'", section: "s" }],
    };
    const html = await renderReport(envelope, { generatedAt: AT });
    const data = embeddedJson(html) as { rows: { message: string }[] };
    expect(data.rows[0]?.message).toBe("$& $1 $'");
  });
});

describe("writing", () => {
  test("embeds the data on disk, for a real envelope", async () => {
    const out = `${import.meta.dir}/../../../.tmp-report-test-out.html`;
    const envelope = triggeringEnvelope();
    const html = await writeReport(out, envelope, { generatedAt: AT });
    const onDisk = await Bun.file(out).text();
    expect(onDisk).toBe(html);
    expect(onDisk).toContain("which of these two should I ship");
    expect(onDisk).toContain(envelope.run.targetSha);
    await rm(out, { force: true });
  });

  test("defaults the output beside the envelope", () => {
    expect(defaultOutPath("/runs/abc/envelope.json")).toBe("/runs/abc/report.html");
    expect(defaultOutPath("envelope.json")).toBe("report.html");
  });
});
