/**
 * Packaging tests: deflate byte-fidelity, the exclusion set, permission bits,
 * the validation gate, and the Zip64 write path.
 *
 * The `deflate9` fixtures are literal output from CPython's `zlib` at level 9
 * (raw deflate, windowBits -15 -- what ZIP method 8 stores). They are committed
 * as data rather than regenerated, so this repository needs only Bun to run its
 * tests.
 *
 * Why level 9 specifically: it is the only level at which Bun's deflate is
 * byte-identical to zlib's. Levels 1 and 6 diverge on every input above a few
 * bytes, and Python's `zipfile` compresses at zlib's default (6) -- so archives
 * written here are deliberately NOT byte-identical to `zipfile`'s. Pinning 9 is
 * what makes the compressed stream reproducible against a known reference at
 * all. Each fixture also carries the input length and CRC32, so a mistake
 * building the corpus in TypeScript fails before the deflate comparison and
 * cannot be mistaken for a compression bug.
 */

import { afterAll, expect, test } from "bun:test";
import { chmod, mkdir, rm } from "node:fs/promises";

import { buildZip, type Bytes, type ZipEntry } from "../../util/zipwriter.ts";
import { collectEntries, packageSkill, shouldExclude } from "../package-skill.ts";

// ---------------------------------------------------------------------------
// Corpus
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();

function repeatBytes(pattern: Bytes, times: number): Bytes {
  const out = new Uint8Array(pattern.length * times);
  for (let i = 0; i < times; i += 1) out.set(pattern, i * pattern.length);
  return out;
}

const CORPUS: ReadonlyMap<string, Bytes> = new Map([
  ["empty", new Uint8Array(0)],
  ["tiny", encoder.encode("x")],
  ["repetitive", encoder.encode("AAAA".repeat(500))],
  ["prose", encoder.encode("The quick brown fox jumps over the lazy dog. ".repeat(40))],
  [
    "markdown",
    encoder.encode(
      `---\nname: demo\ndescription: A demo skill\n---\n\n# Demo\n\n${"- item\n".repeat(200)}`,
    ),
  ],
  [
    "jsonish",
    encoder.encode(
      `{"runs":[${Array.from(
        { length: 60 },
        (_, i) => `{"eval_id":${i},"pass_rate":0.${String(i).padStart(2, "0")}}`,
      ).join(",")}]}`,
    ),
  ],
  ["binary", repeatBytes(Uint8Array.from({ length: 256 }, (_, i) => i), 8)],
  ["pseudorandom", Uint8Array.from({ length: 4096 }, (_, i) => (i * 2654435761) % 256)],
  ["utf8", repeatBytes(encoder.encode("héllo wörld — ünicode ✓ 🎉\n"), 30)],
]);

interface DeflateFixture {
  readonly name: string;
  readonly inputLength: number;
  readonly crc32: number;
  readonly deflate9: string;
}

const DEFLATE_FIXTURES: readonly DeflateFixture[] = [
  { name: "empty", inputLength: 0, crc32: 0, deflate9: "AwA=" },
  { name: "tiny", inputLength: 1, crc32: 2363233923, deflate9: "qwAA" },
  {
    name: "repetitive",
    inputLength: 2000,
    crc32: 4291559511,
    deflate9: "c3QcBaNgFIyCUTAKRsFQBwA=",
  },
  {
    name: "prose",
    inputLength: 1800,
    crc32: 1687536614,
    deflate9: "C8lIVSgszUzOVkgqyi/PU0jLr1DIKs0tKFbIL0stUigBSuckVlUqpOSn6ymEjCoeVTyqeFTxqOJRxcNLMQA=",
  },
  {
    name: "markdown",
    inputLength: 1454,
    crc32: 3836349550,
    deflate9:
      "09XV5cpLzE21UkhJzc3nSkktTi7KLCjJzM+zUnAEiykUZ2fm5HDpAhVyKSu4gFRx6SpklqTmjlKj1Cg1So1S9KIA",
  },
  {
    name: "jsonish",
    inputLength: 1920,
    crc32: 3996148176,
    deflate9:
      "XdVLSkNREADRvbxxkPQvv62IhIAZCCKSp05C9q5Dq4aXmh26+96X2/fHupye78v15/J+fntdTtvN8nlZ1/Pt8nX9ez1tt4/NvxzOgZzOiVzOhdzOjTzOg7xz3iHvnffIB+cD8tH5SBazhdjsFnQLwwXhwnJBuTBdkC5sF7QL4wXxwnpBvTBfkC/sF/RL+yX90n6pubNf0i/tl/RL+yX90n5Jv7Rf0i/tl/RL+yX90n5Jv7Jf0a/sV/Qr+5UW135Fv7Jf0a/sV/Qr+xX9yn5Fv7Jf0a/sV/Rr+zX92n5Nv7Zf06/t17p89mv6tf2afm2/pl/br+nX9mv6tf2afmO/od/Yb+g39hv6jf2GfmO/0ddhv6Hf2G/oN/Yb+o39hn5jvzk+Xh6/",
  },
  {
    name: "binary",
    inputLength: 2048,
    crc32: 2673794392,
    deflate9:
      "Y2BkYmZhZWPn4OTi5uHl4xcQFBIWERUTl5CUkpaRlZNXUFRSVlFVU9fQ1NLW0dXTNzA0MjYxNTO3sLSytrG1s3dwdHJ2cXVz9/D08vbx9fMPCAwKDgkNC4+IjIqOiY2LT0hMSk5JTUvPyMzKzsnNyy8oLCouKS0rr6isqq6pratvaGxqbmlta+/o7Oru6e3rnzBx0uQpU6dNnzFz1uw5c+fNX7Bw0eIlS5ctX7Fy1eo1a9et37Bx0+YtW7dt37Fz1+49e/ftP3Dw0OEjR48dP3Hy1OkzZ8+dv3Dx0uUrV69dv3Hz1u07d+/df/Dw0eMnT589f/Hy1es3b9+9//Dx0+cvX799//Hz1+8/f//9Zxj1/6j/R/0/6v9R/4/6fwT6HwA=",
  },
  {
    name: "pseudorandom",
    inputLength: 4096,
    crc32: 748070280,
    deflate9:
      "Y9iYJHykVO16h+Wr2T5/18ULHCxSvtJq9nyG56/VMbz78hUuNhk/mer2fUUk1+4c2XP1Bg8nOX9ZGsa+I1PqdI3uvX6Hj4uCWbamiZ+o1LrdY/tufgDjpmSRo2XqNzqtXs/x/bc+QfBQscrVNvMXM71+r4nl21+geKnZ5Ok09x8ro7j35MqdbzB8NNnl67Jwjp1Z0mdq9e5PcPy0OIR1W7rEySrtO7127xcEMm1OET1WrnGzy/rNXL//GxKFDpeoXmu3eDnL+8/aOP4DhUqXW0yfTff4uSqaZ2+e/IVGo8dTXL8tj+DclS1ztk7/wUSnz0tC2bZnSJ6q1rnbZ/9hYRDzllSx4xWat7pt3s7zZxj1/6j/R/0/6v9R/4/6f9T/o/4f9f+o/0f9P+r/Uf+P+n8E+B8A",
  },
  {
    name: "utf8",
    inputLength: 1080,
    crc32: 1793344698,
    deflate9: "yzi8MicnX6H88LainBSFRw1TFA7vyctMzk9JVXg0Z7LCh/l9nVwZo2pG1YyqGVWDpAYA",
  },
];

function decodeBase64(value: string): Bytes {
  return Uint8Array.fromBase64 !== undefined
    ? Uint8Array.fromBase64(value)
    : Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

// ---------------------------------------------------------------------------
// Temp workspace
// ---------------------------------------------------------------------------

const TMP_ROOT = `${(process.env["TMPDIR"] ?? "/tmp").replace(/\/$/, "")}/skill-creator-package-test-${process.pid}`;
const PACKAGER = `${import.meta.dir}/../package-skill.ts`;
let counter = 0;

function tempDir(): string {
  counter += 1;
  return `${TMP_ROOT}/case-${counter}`;
}

const VALID_SKILL_MD = `---
name: my-skill
description: A demo skill used by the packaging tests, triggered when a test needs a valid skill folder.
---

# My Skill

Body.
`;

async function writeSkill(root: string, files: Readonly<Record<string, string>>): Promise<string> {
  const skillDir = `${root}/my-skill`;
  for (const [relative, content] of Object.entries(files)) {
    await Bun.write(`${skillDir}/${relative}`, content);
  }
  return skillDir;
}

afterAll(async () => {
  await rm(TMP_ROOT, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Deflate fidelity
// ---------------------------------------------------------------------------

test("the TypeScript corpus reproduces the bytes the fixtures were generated from", () => {
  for (const fixture of DEFLATE_FIXTURES) {
    const data = CORPUS.get(fixture.name);
    expect(data, fixture.name).toBeDefined();
    expect(data?.length, fixture.name).toBe(fixture.inputLength);
    expect(Bun.hash.crc32(data as Bytes), fixture.name).toBe(fixture.crc32);
  }
});

test("Bun.deflateSync at level 9 is byte-identical to Python zlib level 9", () => {
  for (const fixture of DEFLATE_FIXTURES) {
    const data = CORPUS.get(fixture.name) as Bytes;
    const actual = Bun.deflateSync(data, { level: 9 });
    expect(Array.from(actual), fixture.name).toEqual(Array.from(decodeBase64(fixture.deflate9)));
  }
});

test("level 9 is not the default, so pinning it in the writer matters", () => {
  // If this ever stops holding, the level pin is a no-op and the comment
  // explaining it should be revisited rather than silently kept.
  const data = CORPUS.get("prose") as Bytes;
  expect(Array.from(Bun.deflateSync(data))).not.toEqual(
    Array.from(Bun.deflateSync(data, { level: 9 })),
  );
});

// ---------------------------------------------------------------------------
// Exclusions
// ---------------------------------------------------------------------------

test("excludes build-artifact directories at any depth", () => {
  expect(shouldExclude("my-skill/node_modules/pkg/index.js")).toBe(true);
  expect(shouldExclude("my-skill/scripts/__pycache__/x.txt")).toBe(true);
  expect(shouldExclude("my-skill/a/b/c/node_modules/d.js")).toBe(true);
});

test("excludes compiled files and OS metadata", () => {
  expect(shouldExclude("my-skill/scripts/tool.pyc")).toBe(true);
  expect(shouldExclude("my-skill/.DS_Store")).toBe(true);
  expect(shouldExclude("my-skill/nested/.DS_Store")).toBe(true);
});

test("excludes evals only at the skill root", () => {
  expect(shouldExclude("my-skill/evals/evals.json")).toBe(true);
  expect(shouldExclude("my-skill/evals/files/sample.pdf")).toBe(true);
  expect(shouldExclude("my-skill/deep/evals/keep.json")).toBe(false);
});

test("excludes __tests__ at the skill root and at any depth", () => {
  expect(shouldExclude("my-skill/__tests__/a.test.ts")).toBe(true);
  expect(shouldExclude("my-skill/scripts/__tests__/a.test.ts")).toBe(true);
  expect(shouldExclude("my-skill/a/b/__tests__/fixtures/data.json")).toBe(true);
  expect(shouldExclude("my-skill/scripts/tests/a.test.ts")).toBe(false);
});

test("matching is case-sensitive, as CPython fnmatch is on posix", () => {
  // `.ds_store` is no longer a probe for case-sensitivity. It is excluded now,
  // but by the dot-prefix rule rather than by a case-folded match against
  // `.DS_Store` -- see package-security.test.ts for why every dot-prefixed
  // entry is dropped. Asserted here so the two rules cannot be confused: if
  // case-folding were ever reintroduced, the two probes below would catch it.
  expect(shouldExclude("my-skill/.ds_store")).toBe(true);
  expect(shouldExclude("my-skill/scripts/tool.PYC")).toBe(false);
  expect(shouldExclude("my-skill/NODE_MODULES/x.js")).toBe(false);
});

test("keeps ordinary skill content", () => {
  expect(shouldExclude("my-skill/SKILL.md")).toBe(false);
  expect(shouldExclude("my-skill/scripts/tool.ts")).toBe(false);
  expect(shouldExclude("my-skill/references/schemas.md")).toBe(false);
});

// ---------------------------------------------------------------------------
// Archive contents
// ---------------------------------------------------------------------------

test("archive members are rooted at a single top-level skill directory", async () => {
  const skillDir = await writeSkill(tempDir(), {
    "SKILL.md": VALID_SKILL_MD,
    "scripts/tool.ts": "export const a = 1;\n",
    "scripts/__tests__/tool.test.ts": "// excluded\n",
    "evals/evals.json": "{}\n",
    "deep/evals/keep.json": "{}\n",
  });

  const { entries, skipped } = await collectEntries(skillDir);
  expect(entries.map((entry) => entry.name)).toEqual([
    "my-skill/SKILL.md",
    "my-skill/deep/evals/keep.json",
    "my-skill/scripts/tool.ts",
  ]);
  expect(skipped).toEqual(["my-skill/evals/evals.json", "my-skill/scripts/__tests__/tool.test.ts"]);
});

test("packaging refuses to write a .skill when validation fails", async () => {
  const root = tempDir();
  const skillDir = await writeSkill(root, { "SKILL.md": "no frontmatter here\n" });
  const outputDir = `${root}/dist`;

  expect(await packageSkill(skillDir, outputDir)).toBeNull();
  expect(await Bun.file(`${outputDir}/my-skill.skill`).exists()).toBe(false);
});

// ---------------------------------------------------------------------------
// Conformance tier
// ---------------------------------------------------------------------------

/** Valid in Claude Code, and rejected by the standard's closed field set. */
const CLAUDE_CODE_SKILL_MD = `${VALID_SKILL_MD.replace("---\n\n# My Skill", "model: opus\nargument-hint: \"[what to build]\"\n---\n\n# My Skill")}`;

test("the default tier refuses a skill carrying Claude Code frontmatter", async () => {
  const root = tempDir();
  const skillDir = await writeSkill(root, { "SKILL.md": CLAUDE_CODE_SKILL_MD });

  expect(await packageSkill(skillDir, `${root}/dist`)).toBeNull();
  expect(await Bun.file(`${root}/dist/my-skill.skill`).exists()).toBe(false);
});

test("--extended packages the same skill, since it is valid where it runs", async () => {
  const root = tempDir();
  const skillDir = await writeSkill(root, { "SKILL.md": CLAUDE_CODE_SKILL_MD });

  const result = await packageSkill(skillDir, `${root}/dist`, "extended");
  expect(result).not.toBeNull();
  expect(await Bun.file(`${root}/dist/my-skill.skill`).exists()).toBe(true);
});

test("the refusal names --extended and what it trades away", async () => {
  const root = tempDir();
  const skillDir = await writeSkill(root, { "SKILL.md": CLAUDE_CODE_SKILL_MD });

  const proc = Bun.spawnSync(["bun", PACKAGER, skillDir, `${root}/dist`]);
  expect(proc.exitCode).toBe(1);

  const stdout = proc.stdout.toString();
  expect(stdout).toContain("--extended");
  expect(stdout).toContain("claude.ai");
  expect(stdout).toContain("Skills API");
});

test("--extended is refused alongside --standard, as it is in validate-skill", async () => {
  const root = tempDir();
  const skillDir = await writeSkill(root, { "SKILL.md": CLAUDE_CODE_SKILL_MD });

  const proc = Bun.spawnSync(["bun", PACKAGER, skillDir, "--standard", "--extended"]);
  expect(proc.exitCode).toBe(2);
});

test("a skill broken beyond its tier is told to fix it, not to change tier", async () => {
  const root = tempDir();
  const skillDir = await writeSkill(root, { "SKILL.md": "no frontmatter here\n" });

  const proc = Bun.spawnSync(["bun", PACKAGER, skillDir, `${root}/dist`]);
  expect(proc.exitCode).toBe(1);
  expect(proc.stdout.toString()).toContain("Fix the validation errors before packaging.");
});

test("packaging preserves the executable bit through a real extraction", async () => {
  const root = tempDir();
  const skillDir = await writeSkill(root, {
    "SKILL.md": VALID_SKILL_MD,
    "run.ts": "#!/usr/bin/env bun\nconsole.log('hi');\n",
    "notes.md": "plain\n",
  });
  await chmod(`${skillDir}/run.ts`, 0o755);
  await chmod(`${skillDir}/notes.md`, 0o644);

  const result = await packageSkill(skillDir, `${root}/dist`);
  expect(result).not.toBeNull();

  // Same reasoning as the Zip64 case below: an independent extractor is the
  // only thing that can confirm the mode bits survived the archive.
  // bun-purity-ignore: the independent extractor is the point of this interop check
  const extractor = Bun.which("unzip");
  if (extractor === null) return;

  const extractDir = `${root}/extract`;
  await mkdir(extractDir, { recursive: true });
  expect(Bun.spawnSync([extractor, "-q", result!.path, "-d", extractDir]).exitCode).toBe(0);

  const script = await Bun.file(`${extractDir}/my-skill/run.ts`).stat();
  const notes = await Bun.file(`${extractDir}/my-skill/notes.md`).stat();
  expect((script.mode & 0o777).toString(8)).toBe("755");
  expect((notes.mode & 0o777).toString(8)).toBe("644");

  const roundTripped = await Bun.file(`${extractDir}/my-skill/run.ts`).text();
  expect(roundTripped).toBe("#!/usr/bin/env bun\nconsole.log('hi');\n");
});

// ---------------------------------------------------------------------------
// Zip64
// ---------------------------------------------------------------------------

const ZIP64_EOCD_SIGNATURE = [0x50, 0x4b, 0x06, 0x06];
const ZIP64_LOCATOR_SIGNATURE = [0x50, 0x4b, 0x06, 0x07];
/** Classic EOCD is 22 bytes; the total-entry count sits 12 back from the end. */
const EOCD_TOTAL_ENTRIES_OFFSET = 12;

function containsBytes(haystack: Bytes, needle: readonly number[]): boolean {
  for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    if (needle.every((byte, j) => haystack[i + j] === byte)) return true;
  }
  return false;
}

function makeStoredEntries(count: number): ZipEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `s/f${i}.txt`,
    data: encoder.encode(`payload ${i}`),
    mode: 0o100644,
    dateTime: [2026, 7, 28, 12, 0, 0] as const,
    // Stored rather than deflated: this exercises the end-of-archive records,
    // and 65536 deflate calls would dominate the test's runtime for nothing.
    compress: false,
  }));
}

test("a small archive carries no Zip64 records", () => {
  const zip = buildZip(makeStoredEntries(10));
  expect(containsBytes(zip, ZIP64_EOCD_SIGNATURE)).toBe(false);
  expect(containsBytes(zip, ZIP64_LOCATOR_SIGNATURE)).toBe(false);
});

test("past 65535 entries it writes Zip64 records that unzip can read", async () => {
  const zip = buildZip(makeStoredEntries(65536));
  expect(containsBytes(zip, ZIP64_EOCD_SIGNATURE)).toBe(true);
  expect(containsBytes(zip, ZIP64_LOCATOR_SIGNATURE)).toBe(true);

  // The classic EOCD keeps the 0xffff sentinel, sending readers to the Zip64
  // record for the real count.
  const totalEntries = new DataView(
    zip.buffer,
    zip.byteOffset + zip.byteLength - EOCD_TOTAL_ENTRIES_OFFSET,
    2,
  ).getUint16(0, true);
  expect(totalEntries).toBe(0xffff);

  const archive = `${tempDir()}/big.zip`;
  await Bun.write(archive, zip);

  // The one place this repository reaches for a tool outside Bun and git, and
  // deliberately: the claim under test is that an INDEPENDENT implementation
  // reads what we wrote, so reading it back with our own code would prove
  // nothing. Skipped rather than failed where the tool is absent, so the suite
  // still does not depend on it.
  // bun-purity-ignore: the independent extractor is the point of this interop check
  const extractor = Bun.which("unzip");
  if (extractor === null) return;

  // spawnSync rather than a piped spawn: draining a pipe of this size through a
  // web stream takes tens of seconds under `bun test`, which is what made this
  // test look like a Zip64 defect rather than a plumbing one.
  const listing = Bun.spawnSync([extractor, "-Z1", archive]);
  const names = listing.stdout.toString().trim().split("\n");

  expect(listing.exitCode).toBe(0);
  expect(names.length).toBe(65536);
  expect(names[65535]).toBe("s/f65535.txt");
}, 60_000);
