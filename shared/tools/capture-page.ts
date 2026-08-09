#!/usr/bin/env bun
/**
 * capture-page -- screenshot a served viewer page in a chosen theme.
 *
 * WHY THIS EXISTS
 * ---------------
 * Five defects in the viewer pages were findable ONLY by rendering them. Each read
 * correctly in the source, type-checked clean, and passed the suite:
 *
 *   - a mechanical hex-to-token map inverted a table header, correct in light and a
 *     bright white band in dark;
 *   - a feedback textarea with no `background`, falling back to UA grey on a dark page;
 *   - `.sc-pill` emitted against `.sc-chip` CSS, so status colours silently did not apply;
 *   - a failed run showing a healthy blue progress bar beside its own red FAILED note;
 *   - a projection shown on the run page and absent from the overlay row for the same run.
 *
 * The last of those is the general case: two surfaces reading one field and disagreeing.
 * No amount of reading either file finds it, because each is right on its own.
 *
 * THE DARK-PREFERENCE TRAP
 * ------------------------
 * The theme pre-paint falls back to the OS preference when nothing is stored, so a
 * headless run on a machine set to dark exercises ONLY the dark token block -- and a
 * light-mode regression ships invisibly behind a screenshot that looked fine. Chrome's
 * `--blink-settings=preferredColorScheme` did not take effect in a headless run here, so
 * this script overrides `window.matchMedia` ahead of the pre-paint instead, which reaches
 * the real code path rather than bypassing it.
 *
 * `--theme both` is the default for exactly that reason: verifying one theme is the
 * mistake this script exists to make hard.
 *
 * USAGE
 *   bun shared/tools/capture-page.ts <url> [--out <dir>] [--theme light|dark|both]
 *                                   [--width <px>] [--height <px>] [--click <selector>]
 *
 * `--click` clicks a selector once the feed has landed, which is how you reach a state
 * that only exists after interaction (the In-progress overlay, for one).
 *
 * EXIT
 *   0  every requested screenshot was written
 *   1  bad arguments, an unreachable url, or no usable browser
 */

import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";

import { CliError, formatHelp, parseArgs, type Spec } from "../cli.ts";

const USAGE = "bun shared/tools/capture-page.ts <url> [--out <dir>] [--theme light|dark|both]";

const SPEC: Spec = {
  out: { kind: "string", default: ".", help: "Directory to write PNGs into" },
  theme: { kind: "string", default: "both", help: "light, dark, or both" },
  width: { kind: "integer", default: 1000, help: "Viewport width in CSS px" },
  height: { kind: "integer", default: 1400, help: "Viewport height in CSS px" },
  click: { kind: "string", help: "Selector to click before shooting" },
  help: { kind: "boolean", help: "Show this help" },
};

/**
 * Candidate browser binaries, most-preferred first.
 *
 * Chrome ships on far more machines than Chromium does, and the headless flags used here
 * are identical across both.
 */
const BROWSERS: readonly string[] = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

export type Theme = "light" | "dark";

async function findBrowser(): Promise<string | null> {
  for (const candidate of BROWSERS) {
    if (await Bun.file(candidate).exists()) return candidate;
  }
  return null;
}

/**
 * Script forcing `theme` through the page's real pre-paint logic.
 *
 * Overrides `matchMedia` rather than setting `data-theme` directly: the pre-paint always
 * overwrites that attribute, so pinning it in markup does nothing, and pinning it AFTER
 * would skip the code being verified. `localStorage` is cleared so a previous choice in a
 * reused profile cannot decide the answer.
 */
export function themeShim(theme: Theme): string {
  const matches = theme === "dark" ? "true" : "false";
  return (
    "<script>window.matchMedia=function(){return{matches:" +
    matches +
    ",media:\"\",onchange:null,addListener:function(){},removeListener:function(){}," +
    "addEventListener:function(){},removeEventListener:function(){},dispatchEvent:function(){return false;}};};" +
    'try{localStorage.removeItem("skill-creator-theme");}catch(e){}</script>'
  );
}

/** Script clicking `selector` once the feed has had time to land. */
export function clickShim(selector: string): string {
  return (
    "<script>window.addEventListener(\"load\",function(){setTimeout(function(){" +
    "var t=document.querySelector(" +
    JSON.stringify(selector) +
    ");if(t)t.click();},1200);});</script>"
  );
}

/**
 * Insert `injected` immediately after the opening `<head>`, plus a `<base>` so relative
 * urls still resolve once the page is being served off the filesystem.
 *
 * The shim has to precede the pre-paint script, and the pre-paint is itself injected at
 * the top of `<head>`, so "straight after `<head>`" is the only placement that works.
 */
export function patchHead(html: string, baseUrl: string, injected: string): string {
  const headOpen = /<head[^>]*>/i.exec(html);
  const at = headOpen === null ? 0 : headOpen.index + headOpen[0].length;
  return `${html.slice(0, at)}\n<base href="${baseUrl}">\n${injected}${html.slice(at)}`;
}

interface ShootOptions {
  readonly url: string;
  readonly theme: Theme;
  readonly outPath: string;
  readonly width: number;
  readonly height: number;
  readonly click?: string;
}

/**
 * Fetch, patch and shoot one page.
 *
 * The page is fetched and rewritten to a temp file rather than driven in place, because
 * the shim must run before the served page's own inline scripts and there is no flag that
 * injects a script ahead of a document's head.
 */
async function shoot(browser: string, options: ShootOptions): Promise<void> {
  const response = await fetch(options.url);
  if (!response.ok) throw new CliError(`${options.url} returned ${response.status}`);

  const injected = options.click === undefined
    ? themeShim(options.theme)
    : themeShim(options.theme) + clickShim(options.click);
  const patched = patchHead(await response.text(), options.url, injected);

  const scratch = `${tmpdir()}/capture-page-${Bun.nanoseconds()}.html`;
  await Bun.write(scratch, patched);
  try {
    const proc = Bun.spawn(
      [
        browser,
        "--headless",
        "--disable-gpu",
        "--no-first-run",
        "--disable-sync",
        // A background-networking fetch has been observed to outlive the virtual-time
        // budget and stall the run past any useful timeout.
        "--disable-background-networking",
        "--hide-scrollbars",
        "--allow-file-access-from-files",
        "--force-device-scale-factor=2",
        `--window-size=${options.width},${options.height}`,
        "--virtual-time-budget=4000",
        `--screenshot=${options.outPath}`,
        `file://${scratch}`,
      ],
      { stdin: "ignore", stdout: "ignore", stderr: "ignore" },
    );
    await proc.exited;
  } finally {
    await rm(scratch, { force: true });
  }

  if (!(await Bun.file(options.outPath).exists())) {
    throw new CliError(`${browser} wrote no file for ${options.theme}`);
  }
}

function parseTheme(value: string | undefined): readonly Theme[] {
  if (value === undefined || value === "both") return ["light", "dark"];
  if (value === "light" || value === "dark") return [value];
  throw new CliError(`--theme must be light, dark or both, not ${value}`);
}

async function main(argv: readonly string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs(argv, SPEC);
  } catch (error) {
    console.error(error instanceof CliError ? error.message : String(error));
    return 1;
  }

  if (parsed.flags["help"] === true) {
    console.log(formatHelp(USAGE, SPEC));
    return 0;
  }

  const url = parsed.positionals[0];
  if (url === undefined) {
    console.error(formatHelp(USAGE, SPEC));
    return 1;
  }

  const browser = await findBrowser();
  if (browser === null) {
    console.error("No Chrome or Chromium found. Looked in:");
    for (const candidate of BROWSERS) console.error(`  ${candidate}`);
    return 1;
  }

  const out = typeof parsed.flags["out"] === "string" ? parsed.flags["out"] : ".";
  const width = typeof parsed.flags["width"] === "number" ? parsed.flags["width"] : 1000;
  const height = typeof parsed.flags["height"] === "number" ? parsed.flags["height"] : 1400;
  const click = typeof parsed.flags["click"] === "string" ? parsed.flags["click"] : undefined;

  let themes: readonly Theme[];
  try {
    themes = parseTheme(typeof parsed.flags["theme"] === "string" ? parsed.flags["theme"] : undefined);
  } catch (error) {
    console.error(error instanceof CliError ? error.message : String(error));
    return 1;
  }

  const stem = (new URL(url).pathname.replaceAll(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "")) || "page";
  for (const theme of themes) {
    const outPath = `${out}/${stem}-${theme}.png`;
    try {
      await shoot(browser, { url, theme, outPath, width, height, ...(click === undefined ? {} : { click }) });
    } catch (error) {
      console.error(error instanceof CliError ? error.message : String(error));
      return 1;
    }
    console.log(outPath);
  }

  return 0;
}

if (import.meta.main) process.exit(await main(Bun.argv.slice(2)));
