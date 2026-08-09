/**
 * Tests for the pure-Bun checker.
 *
 * Two things are being defended here, and they pull against each other. The
 * rules have to catch every violation class, or the standard goes back to being
 * a convention. And they have to stay quiet on prose, on `node:` imports, and
 * on a package manager's name appearing in an English sentence -- a checker that
 * cries wolf gets suppressed wholesale rather than fixed, at which point it
 * catches nothing at all. Roughly half the cases below are the second kind.
 *
 * Fixture lines that contain a real violation carry their own suppression
 * marker, which is also how the marker gets exercised against the repository's
 * own run of the checker rather than only inside a temporary directory.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

import {
  checkDirectory,
  checkManifest,
  checkText,
  codeLines,
  formatReport,
  scanSuppressions,
  type Finding,
  type Language,
  matchCommand,
  mayContainCommand,
} from "../check-bun-purity.ts";

const scratches: string[] = [];

afterEach(async () => {
  await Promise.all(scratches.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function scratchDir(): Promise<string> {
  const dir = await mkdtemp(`${tmpdir()}/bun-purity-test-`);
  scratches.push(dir);
  return dir;
}

/** Findings for one snippet, defaulting to TypeScript because most rules are code rules. */
function check(text: string, language: Language = "typescript"): readonly Finding[] {
  return checkText("fixture", text, language);
}

function rules(findings: readonly Finding[]): readonly string[] {
  return findings.map((f) => f.rule);
}

// ---------------------------------------------------------------------------
// Errors: one test per violation class
// ---------------------------------------------------------------------------

describe("spawned runtimes are errors", () => {
  test.each([
    ['{ "command": "node", "args": ["server.js"] }', "node"], // bun-purity-ignore: the fixture is the violation under test
    ['{ "command": "npx -y @scope/server" }', "npx"], // bun-purity-ignore: fixture
    ['{ "command": "python3", "args": ["-m", "server"] }', "python3"], // bun-purity-ignore: fixture
    ['{ "command": "uvx some-server" }', "uvx"], // bun-purity-ignore: fixture
    ['{ "command": "deno run ./x.ts" }', "deno"], // bun-purity-ignore: fixture
  ])("flags %p", (line, token) => {
    const findings = check(line, "json");
    expect(rules(findings)).toContain("spawned-runtime");
    expect(findings[0]?.severity).toBe("error");
    expect(findings[0]?.message).toContain(token);
  });

  test("flags a runtime inside a shell pipeline", () => {
    // The original violation this checker was written for.
    const line = "jq -r '.tool_input.file_path' | xargs -r npx --no-install prettier --write"; // bun-purity-ignore: fixture
    const findings = check(line, "json");
    expect(rules(findings)).toContain("spawned-runtime");
    expect(rules(findings)).toContain("external-cli");
  });

  test("reports the line number, so the finding is navigable", () => {
    const text = ["const a = 1;", "const b = 2;", '// run: python -m thing'].join("\n"); // bun-purity-ignore: fixture
    expect(check(text)[0]?.line).toBe(3);
  });

  test("carries a fix that names the Bun route", () => {
    expect(check('{ "command": "node" }', "json")[0]?.fix).toContain("bun build --compile"); // bun-purity-ignore: fixture
  });
});

describe("assumed external commands are warnings", () => {
  test.each([
    ["jq -r .field payload.json", "jq"], // bun-purity-ignore: fixture
    ["curl -s https://example.test/x", "curl"], // bun-purity-ignore: fixture
    ["prettier --write src", "prettier"], // bun-purity-ignore: fixture
    ['"command": "bash \\"${CLAUDE_PLUGIN_ROOT}/x.sh\\""', "bash"], // bun-purity-ignore: fixture
  ])("warns on %p", (line, token) => {
    const findings = check(line, "json");
    const warning = findings.find((f) => f.rule === "external-cli");
    expect(warning?.severity).toBe("warning");
    expect(warning?.message).toContain(token);
  });

  test("a warning alone does not make the run fail", async () => {
    const dir = await scratchDir();
    await Bun.write(`${dir}/hooks.json`, '{ "command": "jq -r .x" }\n'); // bun-purity-ignore: fixture
    const { findings } = await checkDirectory(dir);
    expect(findings.every((f) => f.severity === "warning")).toBe(true);
    expect(findings.length).toBeGreaterThan(0);
  });
});

describe("shebangs", () => {
  test("a runtime other than Bun on line 1 is an error", () => {
    const text = "#!/usr/bin/env node\nconsole.log(1);\n";
    const findings = check(text);
    expect(rules(findings)).toContain("shebang");
    expect(findings.find((f) => f.rule === "shebang")?.line).toBe(1);
  });

  test("the Bun shebang is fine", () => {
    expect(check("#!/usr/bin/env bun\nconsole.log(1);\n")).toEqual([]);
  });

  test("a shebang further down the file is data, not a shebang", () => {
    // A packaging test that round-trips an arbitrary executable file holds one
    // of these in a string literal, and it is not this file's interpreter.
    expect(check('const fixture = "#!/bin/sh\\necho hi";\n')).toEqual([]);
  });
});

describe("runtime dependencies", () => {
  test.each(["dependencies", "peerDependencies", "optionalDependencies"])(
    "%s is an error",
    (field) => {
      const manifest = JSON.stringify({ name: "x", [field]: { chalk: "^5.0.0" } });
      const findings = checkManifest("package.json", manifest);
      expect(rules(findings)).toEqual(["runtime-dependency"]);
      expect(findings[0]?.evidence).toContain("chalk");
    },
  );

  test("devDependencies are fine, because they never ship", () => {
    const manifest = JSON.stringify({ name: "x", devDependencies: { typescript: "^5.6.0" } });
    expect(checkManifest("package.json", manifest)).toEqual([]);
  });

  test("an empty dependencies object is not a dependency", () => {
    expect(checkManifest("package.json", JSON.stringify({ dependencies: {} }))).toEqual([]);
  });

  test("an engines field pins a runtime this code does not run on", () => {
    const findings = checkManifest("package.json", JSON.stringify({ engines: { node: ">=20" } }));
    expect(rules(findings)).toEqual(["runtime-dependency"]);
  });

  test("unparseable JSON is left to the JSON parser, not reported twice", () => {
    expect(checkManifest("package.json", "{ not json")).toEqual([]);
  });
});

describe("foreign source files", () => {
  test("a .py file is an error and a .sh file is a warning", async () => {
    const dir = await scratchDir();
    await Bun.write(`${dir}/tool.py`, "print('hi')\n");
    await Bun.write(`${dir}/tool.sh`, "echo hi\n");
    const { findings } = await checkDirectory(dir);

    const byFile = new Map(findings.map((f) => [f.file, f]));
    expect(byFile.get("tool.py")?.severity).toBe("error");
    expect(byFile.get("tool.sh")?.severity).toBe("warning");
    expect(byFile.get("tool.py")?.rule).toBe("foreign-script");
  });
});

describe("module hygiene", () => {
  test("a bare builtin import is an error, because a package can shadow it", () => {
    const findings = check('import { join } from "path";\n'); // bun-purity-ignore: fixture
    expect(rules(findings)).toContain("bare-builtin-import");
    expect(findings[0]?.fix).toContain("node:path");
  });

  // bun-purity-ignore: the next two lines name and build the call being reported
  test("a CommonJS require is an error in an ESM codebase", () => {
    const findings = check('const fs = require("node:fs");\n'); // bun-purity-ignore: fixture
    expect(rules(findings)).toContain("commonjs-require");
  });

  test("neither rule applies to markdown or JSON", () => {
    expect(check('import { join } from "path";', "json")).toEqual([]); // bun-purity-ignore: fixture
  });
});

// ---------------------------------------------------------------------------
// The claim the whole standard rests on
// ---------------------------------------------------------------------------

describe("node: builtins are Bun and are never a finding", () => {
  test.each([
    'import { mkdir, rm } from "node:fs/promises";',
    'import { tmpdir } from "node:os";',
    'import { join, relative } from "node:path";',
    'const { readdir } = await import("node:fs/promises");',
  ])("accepts %p", (line) => {
    expect(check(line)).toEqual([]);
  });

  test("accepts a whole module that uses all three", () => {
    const text = [
      "#!/usr/bin/env bun",
      'import { mkdtemp } from "node:fs/promises";',
      'import { tmpdir } from "node:os";',
      'import { join } from "node:path";',
      "const dir = await mkdtemp(join(tmpdir(), 'x-'));",
      "await Bun.write(join(dir, 'out.json'), '{}');",
    ].join("\n");
    expect(check(text)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The prose/code boundary
// ---------------------------------------------------------------------------

describe("markdown scans fenced code, not prose", () => {
  test("a sentence describing the platform is not a finding", () => {
    const text = [
      "A stdio server's `command` is a process, so Claude Code will spawn",
      "`node`, `python3` or `uvx` if a config names one. This plugin ships `bun`.",
    ].join("\n");
    expect(check(text, "markdown")).toEqual([]);
  });

  test("the same command inside a fence is a finding", () => {
    const text = ["Copy this:", "", "```bash", "npx --no-install prettier --write x.ts", "```"].join("\n"); // bun-purity-ignore: fixture
    const findings = check(text, "markdown");
    expect(rules(findings)).toContain("spawned-runtime");
    expect(findings[0]?.line).toBe(4);
  });

  test("the fence's info string is not read as an invocation", () => {
    const text = ["```bash", "bun test", "```"].join("\n");
    expect(check(text, "markdown")).toEqual([]);
  });

  test("a tilde fence is a fence too", () => {
    const text = ["~~~json", '{ "command": "node" }', "~~~"].join("\n"); // bun-purity-ignore: fixture
    expect(rules(check(text, "markdown"))).toContain("spawned-runtime");
  });

  test("codeLines returns the interior of a fence and nothing else", () => {
    const text = ["prose", "```ts", "const a = 1;", "```", "more prose"].join("\n");
    expect([...codeLines(text, "markdown")]).toEqual([[3, "const a = 1;"]]);
  });

  test("codeLines returns every line of a TypeScript file", () => {
    expect(codeLines("a\nb", "typescript").size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Not crying wolf
// ---------------------------------------------------------------------------

describe("false positives the narrow patterns exist to avoid", () => {
  test.each([
    ["a directory listing that mentions node_modules", "  node_modules/    ignored by the packager"],
    ["English prose inside a text fence", "  scripts/   Bun and TypeScript, no npm dependencies."],
    ["a flag that happens to end in a tool name", "gh pr list --json number --jq '.[].number'"],
    ["a path containing a runtime name", 'const p = "/usr/local/bin/node-thing";'],
    ["an extension list", 'const exts = [".py", ".sh", ".rb"];'],
    ["a Bun invocation", "bun scripts/measure-triggering.ts --skill x"],
    ["a git invocation, the one external tool this plugin assumes", "git rev-parse --abbrev-ref HEAD"],
  ])("stays quiet on %s", (_label, line) => {
    expect(check(line, "json")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Suppression
// ---------------------------------------------------------------------------

describe("the suppression marker", () => {
  test("covers the line it sits on", () => {
    const line = '{ "command": "node" } // bun-purity-ignore: platform fact';
    expect(check(line)).toEqual([]);
  });

  test("covers the line after it", () => {
    const text = ["// bun-purity-ignore: platform fact", '{ "command": "node" }'].join("\n");
    expect(check(text)).toEqual([]);
  });

  test("covers a whole fenced block when the fence comes next", () => {
    const text = [
      "<!-- bun-purity-ignore: quoting the format's own field values -->",
      "```json",
      '{ "server": { "type": "node" } }', // bun-purity-ignore: fixture quoting the format's own values
      '{ "server": { "type": "python" } }',
      '{ "server": { "type": "binary" } }',
      "```",
    ].join("\n");
    expect(check(text, "markdown")).toEqual([]);
  });

  test("does not leak past the block it covers", () => {
    const text = [
      "<!-- bun-purity-ignore: the first block is the format's own values -->",
      "```json",
      '{ "server": { "type": "node" } }', // bun-purity-ignore: fixture
      "```",
      "",
      "```json",
      '{ "command": "node" }', // bun-purity-ignore: fixture
      "```",
    ].join("\n");
    const findings = check(text, "markdown");
    expect(rules(findings)).toEqual(["spawned-runtime"]);
    expect(findings[0]?.line).toBe(7);
  });

  test("does not leak past the next line when no fence follows", () => {
    const text = [
      "// bun-purity-ignore: only the import below is deliberate",
      'import { join } from "path";',
      'import { resolve } from "os";', // bun-purity-ignore: fixture
    ].join("\n");
    const findings = check(text);
    expect(rules(findings)).toEqual(["bare-builtin-import"]);
    expect(findings[0]?.line).toBe(3);
  });

  test("a marker with no reason is itself an error", () => {
    // Built rather than written out, so this file's own markers stay well-formed.
    const bare = `// ${"bun-purity"}-ignore`;
    const findings = check(`${bare}\nconst a = 1;\n`);
    expect(rules(findings)).toEqual(["unexplained-suppression"]);
    expect(findings[0]?.severity).toBe("error");
  });

  test("a marker with only whitespace after the colon is also unexplained", () => {
    const bare = `// ${"bun-purity"}-ignore:   `;
    expect(rules(check(bare))).toEqual(["unexplained-suppression"]);
  });

  test("scanSuppressions reports the covered lines and the bad markers separately", () => {
    const lines = ["// bun-purity-ignore: reason", "const a = 1;", `// ${"bun-purity"}-ignore`];
    const scan = scanSuppressions(lines);
    expect([...scan.suppressed].sort((a, b) => a - b)).toEqual([1, 2]);
    expect(scan.unexplained).toEqual([3]);
  });
});

// ---------------------------------------------------------------------------
// Walking a directory
// ---------------------------------------------------------------------------

describe("checkDirectory", () => {
  test("a clean tree reports nothing", async () => {
    const dir = await scratchDir();
    await Bun.write(`${dir}/script.ts`, '#!/usr/bin/env bun\nimport { join } from "node:path";\nconsole.log(join("a", "b"));\n');
    await Bun.write(`${dir}/config.json`, '{ "command": "bun", "args": ["./script.ts"] }\n');
    await Bun.write(`${dir}/README.md`, "Runs on Bun.\n\n```bash\nbun script.ts\n```\n");

    const { findings, filesScanned } = await checkDirectory(dir);
    expect(findings).toEqual([]);
    expect(filesScanned).toBe(3);
  });

  test("skips node_modules rather than auditing other people's code", async () => {
    const dir = await scratchDir();
    await mkdir(`${dir}/node_modules/pkg`, { recursive: true });
    await Bun.write(`${dir}/node_modules/pkg/index.js`, "#!/usr/bin/env node\n");
    await Bun.write(`${dir}/ours.ts`, "export const a = 1;\n");

    const { findings, filesScanned } = await checkDirectory(dir);
    expect(findings).toEqual([]);
    expect(filesScanned).toBe(1);
  });

  test("finds a manifest dependency nested under the tree", async () => {
    const dir = await scratchDir();
    await mkdir(`${dir}/servers/indexer`, { recursive: true });
    await Bun.write(
      `${dir}/servers/indexer/package.json`,
      JSON.stringify({ name: "indexer", dependencies: { express: "^4" } }),
    );
    const { findings } = await checkDirectory(dir);
    expect(rules(findings)).toEqual(["runtime-dependency"]);
    expect(findings[0]?.file).toBe("servers/indexer/package.json");
  });

  test("errors sort ahead of warnings, so the first line of output is the worst news", async () => {
    const dir = await scratchDir();
    await Bun.write(`${dir}/z-warn.json`, '{ "command": "jq -r .x" }\n'); // bun-purity-ignore: fixture
    await Bun.write(`${dir}/a-error.json`, '{ "command": "node" }\n'); // bun-purity-ignore: fixture
    const { findings } = await checkDirectory(dir);
    expect(findings[0]?.severity).toBe("error");
  });
});

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

describe("formatReport", () => {
  const finding = (severity: Finding["severity"]): Finding => ({
    file: "skills/x/hooks.json",
    line: 25,
    severity,
    rule: severity === "error" ? "spawned-runtime" : "external-cli",
    evidence: "…",
    message: "message",
    fix: "fix",
  });

  test("says so plainly when there is nothing to report", () => {
    expect(formatReport([], ".", 12)).toContain("**Pure Bun.**");
  });

  test("passes on warnings alone, and says what a warning means", () => {
    const text = formatReport([finding("warning")], ".", 1);
    expect(text).toContain("**Pure Bun.**");
    expect(text).toContain("1 warning(s)");
  });

  test("fails on an error", () => {
    const text = formatReport([finding("error")], ".", 1);
    expect(text).toContain("**Not pure Bun.**");
  });

  test("locates each finding as file:line with its fix", () => {
    const text = formatReport([finding("error")], ".", 1);
    expect(text).toContain("`skills/x/hooks.json:25`");
    expect(text).toContain("fix: fix");
  });

  test("a whole-file finding is reported without a line number", () => {
    const text = formatReport([{ ...finding("error"), line: 0 }], ".", 1);
    expect(text).toContain("`skills/x/hooks.json`");
    expect(text).not.toContain("hooks.json:0");
  });
});

// ---------------------------------------------------------------------------
// The repository itself
// ---------------------------------------------------------------------------

test(
  "this repository holds the standard it publishes",
  async () => {
    const repoRoot = `${import.meta.dir}/../../..`;
    const { findings } = await checkDirectory(repoRoot);
    const described = findings.map((f) => `${f.file}:${f.line} ${f.rule} — ${f.evidence}`);
    expect(described).toEqual([]);
  },
  // Reads every source file in the repository, which is comfortably under a
  // second alone and slower when the whole suite is running in parallel.
  30_000,
);

/** The module keeps its pattern maps private; rebuild them from the same token lists. */
const RUNTIME_PATTERNS_FOR_TEST = new Map(
  ["node", "npx", "npm", "pnpm", "yarn", "python3", "python", "pip3", "pip", "uvx", "uv", "deno"] // bun-purity-ignore: fixture
    .map((t) => [t, commandPatternsForTest(t)] as const),
);
const CLI_PATTERNS_FOR_TEST = new Map(
  ["jq", "yq", "curl", "wget", "prettier", "eslint", "xargs", "docker", "bash", "unzip", "chmod"] // bun-purity-ignore: fixture
    .map((t) => [t, commandPatternsForTest(t)] as const),
);

function commandPatternsForTest(token: string): readonly RegExp[] {
  const before = String.raw`(?<![\w./@$:-])`;
  const after = String.raw`(?![\w./@:-])`;
  const argument = String.raw`(?:[-"'$/~@]|[\w@.-]*[./][\w@.-]+)`;
  return [
    new RegExp(String.raw`^[ \t]*(?:[$>] )?${token}${after}`),
    new RegExp(String.raw`(?:[|&;]|\$\()[ \t]*${token}${after}`),
    new RegExp(String.raw`${before}${token}${after}[ \t]+${argument}`),
    new RegExp(String.raw`"(?:command|headersHelper)"\s*:\s*"${token}${after}`),
    new RegExp(String.raw`(["'])${token}\1`),
  ];
}

// ---------------------------------------------------------------------------
// The pre-filter must be a superset, or it silently hides findings
// ---------------------------------------------------------------------------

describe("mayContainCommand as a pre-filter", () => {
  // The whole safety argument is one-directional: the gate may say yes when the answer is
  // no (wasted work), but never no when the answer is yes (a missed finding). Asserting it
  // against the real pattern set is what keeps a future token from being added to
  // RUNTIME_TOKENS in a form the alternation does not cover.
  // bun-purity-ignore: fixture command lines — the strings the gate is tested against
  const commandLines = [
    "node script.js", // bun-purity-ignore: fixture
    "  npx prettier --write x.ts", // bun-purity-ignore: fixture
    'const p = Bun.spawn(["python3", "a.py"])', // bun-purity-ignore: fixture
    '"command": "node"', // bun-purity-ignore: fixture
    "cat a | jq -r .b", // bun-purity-ignore: fixture
    "$ npm install",
    "foo && uv run x", // bun-purity-ignore: fixture
    '"command": "bash"', // bun-purity-ignore: fixture
  ];

  for (const line of commandLines) {
    test(`gate opens for: ${line.trim()}`, () => {
      // If either real matcher fires, the gate must have let it through.
      const hit =
        matchCommand(line, RUNTIME_PATTERNS_FOR_TEST) ?? matchCommand(line, CLI_PATTERNS_FOR_TEST);
      if (hit !== undefined) expect(mayContainCommand(line)).toBe(true);
    });
  }

  test("closes on text with no token at all", () => {
    expect(mayContainCommand("const total = items.reduce((a, b) => a + b, 0);")).toBe(false);
  });

  test("a gated line and an ungated line agree with each other", () => {
    // Same assertion stated the other way round: anything the gate rejects must produce no
    // finding from the real patterns either.
    for (const line of ["plain prose with no commands", "await Bun.write(path, text);"]) {
      expect(mayContainCommand(line)).toBe(false);
      expect(matchCommand(line, RUNTIME_PATTERNS_FOR_TEST)).toBeUndefined();
    }
  });
});
