/**
 * The two Zod behaviours the whole schema decision rests on.
 *
 * If either of these ever fails, the split-layer design is unbuildable and the
 * report it produces is a lie -- so they are asserted here rather than assumed,
 * against the exact pinned version the schemas import.
 */

import { describe, expect, test } from "bun:test";
import { z } from "zod@4.1.0";

import { partitionIssues, severityOf } from "../severity.ts";

describe("zod does not short-circuit", () => {
  test("three bad fields produce three issues, not one", () => {
    const schema = z.object({ a: z.string().min(3), b: z.number(), c: z.string() });
    const result = schema.safeParse({ a: "x", b: "no", c: 1 });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toHaveLength(3);
    expect(result.error.issues.map((issue) => issue.path.join("."))).toEqual(["a", "b", "c"]);
  });

  test("a refinement's issues do not stop the refinement chained after it", async () => {
    const base = z.object({ a: z.string() }).superRefine((_value, ctx) => {
      ctx.addIssue({ code: "custom", message: "pure-error" });
    });
    const full = base.superRefine(async (_value, ctx) => {
      await Promise.resolve();
      ctx.addIssue({ code: "custom", message: "disk-error" });
    });

    const result = await full.safeParseAsync({ a: "x" });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => issue.message)).toEqual([
      "pure-error",
      "disk-error",
    ]);
  });
});

describe("a warning tier is expressible", () => {
  test("params.severity survives the round trip and fatal:false does not abort", async () => {
    const schema = z.object({ a: z.string() }).superRefine(async (_value, ctx) => {
      ctx.addIssue({ code: "custom", message: "hard", params: { severity: "error" } });
      ctx.addIssue({
        code: "custom",
        message: "soft",
        fatal: false,
        params: { severity: "warning" },
      });
      await Promise.resolve();
      ctx.addIssue({ code: "custom", message: "after await", fatal: false });
    });

    const result = await schema.safeParseAsync({ a: "x" });
    expect(result.success).toBe(false);
    if (result.success) return;

    const issues = result.error.issues;
    expect(issues.map((issue) => issue.message)).toEqual(["hard", "soft", "after await"]);
    expect(issues.map(severityOf)).toEqual(["error", "warning", "error"]);

    const { errors, warnings } = partitionIssues(issues);
    expect(errors).toEqual(["hard", "after await"]);
    expect(warnings).toEqual(["soft"]);
  });

  test("an issue Zod raised itself partitions as an error", () => {
    const result = z.object({ a: z.string() }).safeParse({ a: 1 });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(partitionIssues(result.error.issues).warnings).toEqual([]);
    expect(partitionIssues(result.error.issues).errors).toHaveLength(1);
  });
});
