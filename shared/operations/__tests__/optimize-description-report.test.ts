/**
 * `optimize-description.ts` loads the HTML report generator at runtime, so a wrong
 * specifier is not a typecheck failure but a warning on stderr and no report -- which
 * is how every description loop ran reportless until 2026-08-30. This pins the
 * specifier to a file that exists and exports `generateHtml`.
 */
import { describe, expect, test } from "bun:test";

describe("optimize-description report generator", () => {
  test("the runtime specifier resolves to report/generate-report.ts and it exports generateHtml", async () => {
    const source = await Bun.file(new URL("../optimize-description.ts", import.meta.url)).text();
    const match = source.match(/new URL\("([^"]+generate-report\.ts)", import\.meta\.url\)/);
    const specifier = match?.[1];
    expect(specifier).toBeDefined();
    if (specifier === undefined) return;
    const resolved = new URL(specifier, new URL("../optimize-description.ts", import.meta.url));
    expect(await Bun.file(resolved).exists()).toBe(true);
    const module: Record<string, unknown> = await import(resolved.href);
    expect(typeof module["generateHtml"]).toBe("function");
  });
});
