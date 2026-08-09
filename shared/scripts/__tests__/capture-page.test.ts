/**
 * Tests for the screenshot helper's page rewriting.
 *
 * The browser invocation itself is not tested -- it needs a real Chrome and produces a PNG
 * whose correctness only a human eye judges, which is the whole reason the script exists.
 * What IS testable is the rewriting, and that is where the trap lives: the shim has to run
 * BEFORE the page's theme pre-paint, or the screenshot silently shows the OS preference and
 * a light-mode regression ships behind a picture that looked fine.
 */

import { describe, expect, test } from "bun:test";

import { clickShim, patchHead, themeShim } from "../capture-page.ts";
import { injectThemePrepaint } from "../../eval-viewer/theme.ts";

const PAGE = '<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body>x</body></html>';

describe("themeShim", () => {
  test.each([
    ["dark", "true"],
    ["light", "false"],
  ] as const)("reports %s to matchMedia", (theme, expected) => {
    expect(themeShim(theme)).toContain(`matches:${expected}`);
  });

  test("clears any stored choice, so a reused profile cannot decide the theme", () => {
    // The pre-paint prefers localStorage over the OS preference, so leaving a stored value
    // in place would make the requested theme a suggestion rather than an instruction.
    expect(themeShim("light")).toContain('localStorage.removeItem("skill-creator-theme")');
  });

  test("survives a localStorage that throws, as some file:// origins do", () => {
    expect(themeShim("light")).toContain("try{");
    expect(themeShim("light")).toContain("catch(e){}");
  });

  test("carries the listener methods the page may call on the result", () => {
    // A stub missing addEventListener throws when the toggle wires up its OS-preference
    // listener, and a thrown error there kills the whole inline script.
    const shim = themeShim("dark");
    expect(shim).toContain("addEventListener:function(){}");
    expect(shim).toContain("removeEventListener:function(){}");
  });
});

describe("patchHead", () => {
  test("injects immediately after the opening head tag", () => {
    const out = patchHead(PAGE, "http://x/y", "<!--MARK-->");
    expect(out.indexOf("<!--MARK-->")).toBeGreaterThan(out.indexOf("<head>"));
    expect(out.indexOf("<!--MARK-->")).toBeLessThan(out.indexOf("<meta"));
  });

  test("runs BEFORE the theme pre-paint, which is the point of the helper", () => {
    // This is the assertion that matters. The pre-paint unconditionally overwrites
    // data-theme, so a shim landing after it has no effect at all and the screenshot
    // quietly shows the OS preference instead of the requested theme.
    const served = injectThemePrepaint(PAGE);
    const patched = patchHead(served, "http://x/y", themeShim("light"));
    expect(patched.indexOf("matches:false")).toBeLessThan(patched.indexOf("prefers-color-scheme"));
  });

  test("adds a base href, so relative urls still resolve off the filesystem", () => {
    // The patched page is written to a temp file, so every relative url in it would
    // otherwise resolve against /tmp.
    expect(patchHead(PAGE, "http://127.0.0.1:3118/report/x", "")).toContain(
      '<base href="http://127.0.0.1:3118/report/x">',
    );
  });

  test("still injects into a document with no head at all", () => {
    // A generated fragment is not guaranteed to have one, and silently producing an
    // un-shimmed page would show the wrong theme rather than fail.
    expect(patchHead("<body>x</body>", "http://x", "<!--MARK-->")).toContain("<!--MARK-->");
  });

  test("handles a head tag carrying attributes", () => {
    const out = patchHead('<html><head profile="x"><title>t</title></head>', "http://x", "<!--MARK-->");
    expect(out.indexOf("<!--MARK-->")).toBeLessThan(out.indexOf("<title>"));
  });
});

describe("clickShim", () => {
  test("waits before clicking, so the feed has landed", () => {
    // Clicking immediately on load reaches the overlay before its first poll returns,
    // which screenshots an empty list rather than the state under test.
    expect(clickShim("#sc-seg-list")).toContain("setTimeout");
  });

  test("quotes the selector, so one containing a quote cannot break the script", () => {
    expect(clickShim('[data-x="y"]')).toContain(String.raw`"[data-x=\"y\"]"`);
  });

  test("tolerates a selector that matches nothing", () => {
    // A missing element is a bad --click argument, not a reason to abort the screenshot.
    expect(clickShim("#nope")).toContain("if(t)t.click()");
  });
});
