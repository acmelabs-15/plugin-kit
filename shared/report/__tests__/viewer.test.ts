/**
 * The review page's "Submit All Reviews" POSTs every run with `status: complete`,
 * including runs whose feedback is empty -- that is how "everything looks good" is
 * recorded. Closing the confirmation dialog used to re-save through the auto-save
 * path, which drops empty feedback and stamps `in_progress`, so an all-empty
 * submission vanished the moment the dialog closed (measured twice, 2026-08-30).
 * The page is static HTML with inline script, so the invariant is pinned on the
 * source: dismissing the dialog must not save.
 */
import { describe, expect, test } from "bun:test";

const html = await Bun.file(new URL("../viewer.html", import.meta.url)).text();

function functionBody(name: string): string {
  const start = html.indexOf(`function ${name}(`);
  expect(start).toBeGreaterThan(-1);
  const open = html.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < html.length; i++) {
    if (html[i] === "{") depth += 1;
    if (html[i] === "}") depth -= 1;
    if (depth === 0) return html.slice(open, i + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

describe("viewer.html feedback submission", () => {
  test("closing the done dialog does not re-save (which would erase an all-empty submission)", () => {
    const body = functionBody("closeDoneDialog");
    expect(body).not.toContain("saveCurrentFeedback");
    expect(body).not.toContain("fetch(");
  });

  test("submit posts every run with status complete; auto-save posts in_progress", () => {
    expect(functionBody("showDoneDialog")).toContain('status: "complete"');
    expect(functionBody("showDoneDialog")).toContain("for (const r of EMBEDDED_DATA.runs)");
    expect(functionBody("saveCurrentFeedback")).toContain('status: "in_progress"');
  });
});
