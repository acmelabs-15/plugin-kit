#!/usr/bin/env bun
/**
 * Skill Packager - creates a distributable .skill file from a skill folder.
 *
 * Usage:
 *     bun shared/scripts/package-skill.ts <path/to/skill-folder> [output-directory]
 *                                  [--standard|--extended]
 *
 * Example:
 *     bun shared/scripts/package-skill.ts skills/public/my-skill
 *     bun shared/scripts/package-skill.ts skills/public/my-skill ./dist
 *     bun shared/scripts/package-skill.ts skills/my-skill --extended
 *
 * (DELIBERATE FIX, not a port bug: the usage strings in the Python original
 * bun-purity-ignore: quoting the original's own usage line, which is what the fix is about
 * this file replaces said `python utils/package_skill.py`, but the script had
 * not lived in `utils/` for some time -- it sat in `scripts/`. Anyone
 * copy-pasting the usage line got "No such file or directory". Corrected here
 * to the real location.)
 *
 * Archive member paths are relative to the skill folder's PARENT, so the
 * archive always contains a single top-level skill directory.
 */

import { CliError, formatHelp, parseArgs, type Spec } from "./lib/cli.ts";
import { fnmatch } from "../util/fnmatch.ts";
import { buildZip, type ZipEntry } from "../util/zipwriter.ts";
import {
  baseName,
  formatResult,
  resolvePath,
  resolveTier,
  validateSkill,
  type Tier,
} from "./validate-skill.ts";

// ---------------------------------------------------------------------------
// Exclusions
// ---------------------------------------------------------------------------

/** Build-artifact directories, excluded at any depth. */
const EXCLUDE_DIRS: ReadonlySet<string> = new Set(["__pycache__", "node_modules"]);

/** Compiled-file globs, matched against the basename. */
const EXCLUDE_GLOBS: readonly string[] = ["*.pyc"];

/** OS metadata files. */
const EXCLUDE_FILES: ReadonlySet<string> = new Set([".DS_Store"]);

/** Directories excluded only at the skill root (not when nested deeper). */
const ROOT_EXCLUDE_DIRS: ReadonlySet<string> = new Set(["evals"]);

/**
 * Globs matched against the whole archive path rather than the basename.
 *
 * `fnmatch`'s `*` crosses `/` (it is a string matcher, not a path matcher), so
 * a star-slash-`__tests__`-slash-star pattern catches a test directory at the
 * skill root and at any depth below it. Tests must never ship inside a .skill:
 * they are dead weight for consumers and they reference fixtures and dev-only
 * tooling that will not be present on the other side.
 */
const EXCLUDE_PATH_GLOBS: readonly string[] = ["*/__tests__/*"];

/**
 * Working directories this toolchain creates beside or inside a skill.
 *
 * `measure-triggering` and the viewer write iteration output into `<name>-workspace/`.
 * That is generated data, often large, and it contains model transcripts.
 */
const EXCLUDE_DIR_GLOBS: readonly string[] = ["*-workspace", "coverage", "dist", "build", ".*"];

/**
 * Check if an archive path should be excluded from packaging.
 *
 * Matching is case-SENSITIVE, deliberately. CPython's `fnmatch.fnmatch` folds
 * case only where `os.path.normcase` does, and on posix that is the identity
 * function -- so the upstream behaviour on macOS and Linux is case-sensitive
 * too. Adding case-insensitivity here would silently drop files the Python
 * packager shipped.
 *
 * SECURITY FIX, and a deliberate divergence from the original rather than a
 * ported behaviour. The upstream exclusion set is a five-item denylist naming
 * only build artifacts and OS metadata, while the collector walks dotfiles. A
 * skill folder that is also a git working tree therefore packaged `.git/config`
 * -- which carries credentials in a token-bearing remote URL -- along with
 * `.env` and `.claude/settings.local.json`. Reproduced before this change: an
 * archive built from a folder containing those three shipped all three.
 *
 * A denylist is the wrong shape for this. It fails open, so every secret nobody
 * thought to name travels to whoever installs the skill, and the author has no
 * signal it happened. Dot-prefixed entries are excluded wholesale at any depth
 * instead: nothing a skill legitimately ships is dot-prefixed, since the
 * standard's payload is SKILL.md plus its scripts, references and assets.
 */
export function shouldExclude(archivePath: string): boolean {
  const parts = archivePath.split("/");
  if (parts.some((part) => EXCLUDE_DIRS.has(part))) return true;

  // Skip parts[0]: it is the skill folder itself, whose own name must not
  // disqualify the archive it names.
  const inner = parts.slice(1);
  if (inner.some((part) => EXCLUDE_DIR_GLOBS.some((pattern) => fnmatch(part, pattern)))) {
    return true;
  }

  // parts[0] is the skill folder name, so parts[1] is the first subdirectory.
  if (parts.length > 1 && ROOT_EXCLUDE_DIRS.has(parts[1] as string)) return true;

  const name = parts[parts.length - 1] as string;
  if (EXCLUDE_FILES.has(name)) return true;
  if (EXCLUDE_GLOBS.some((pattern) => fnmatch(name, pattern))) return true;
  return EXCLUDE_PATH_GLOBS.some((pattern) => fnmatch(archivePath, pattern));
}

// ---------------------------------------------------------------------------
// Filesystem
// ---------------------------------------------------------------------------

async function statOf(path: string): Promise<{ mode: number; mtime: Date } | null> {
  try {
    const stat = await Bun.file(path).stat();
    return { mode: stat.mode, mtime: stat.mtime };
  } catch {
    return null;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await Bun.file(path).stat()).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Every regular file under `skillDir`, relative to it, sorted.
 *
 * Sorted for determinism. CPython's `rglob` yields in `os.scandir` order, which
 * is filesystem-dependent, so the upstream archive's member order was already
 * unspecified -- sorting cannot diverge from a defined behaviour, and it makes
 * repeat packages of an unchanged skill byte-identical.
 */
async function collectFiles(skillDir: string): Promise<string[]> {
  const files: string[] = [];
  for await (const relative of new Bun.Glob("**/*").scan({
    cwd: skillDir,
    onlyFiles: true,
    dot: true,
  })) {
    files.push(relative);
  }
  return files.sort();
}

/**
 * ZIP stores DOS timestamps, which start at 1980. CPython's `ZipInfo` raises
 * on earlier dates rather than writing a corrupt field; do the same.
 */
function toDateTime(mtime: Date): readonly [number, number, number, number, number, number] {
  const year = mtime.getFullYear();
  if (year < 1980) {
    throw new Error(`ZIP does not support timestamps before 1980: ${mtime.toISOString()}`);
  }
  return [
    year,
    mtime.getMonth() + 1,
    mtime.getDate(),
    mtime.getHours(),
    mtime.getMinutes(),
    mtime.getSeconds(),
  ];
}

// ---------------------------------------------------------------------------
// Packaging
// ---------------------------------------------------------------------------

export interface PackageResult {
  readonly path: string;
  readonly added: readonly string[];
  readonly skipped: readonly string[];
  readonly bytes: number;
}

/**
 * Collect the archive members for a skill folder.
 *
 * Only regular files are archived; the UNIX permission bits (and so the
 * executable bit) travel in each entry's external attributes.
 */
export async function collectEntries(
  skillDir: string,
): Promise<{ entries: ZipEntry[]; skipped: string[] }> {
  const skillName = baseName(skillDir);
  const entries: ZipEntry[] = [];
  const skipped: string[] = [];

  for (const relative of await collectFiles(skillDir)) {
    const archivePath = `${skillName}/${relative}`;
    if (shouldExclude(archivePath)) {
      skipped.push(archivePath);
      continue;
    }

    const absolute = `${skillDir}/${relative}`;
    const stat = await statOf(absolute);
    if (stat === null) {
      // Raced with a delete between the walk and the read.
      skipped.push(archivePath);
      continue;
    }

    entries.push({
      name: archivePath,
      data: await Bun.file(absolute).bytes(),
      mode: stat.mode,
      dateTime: toDateTime(stat.mtime),
    });
  }

  return { entries, skipped };
}

/**
 * The conformance tier a `.skill` is gated on unless the caller says otherwise.
 *
 * "standard" is the default because a `.skill` file is a portability artifact:
 * it is the shape a skill travels in to claude.ai and the Skills API, and both
 * accept only the six standard fields. The upstream packager had no tier at all
 * because its validator had one mode; this is that same gate, named and now
 * escapable.
 *
 * The escape matters because the default alone refuses to package most real
 * Claude Code skills. A skill carrying `model:` or `argument-hint:` is entirely
 * valid where it runs and fails this gate, which is why `--extended` exists --
 * with the tradeoff stated at the point of failure rather than buried here.
 */
const PACKAGING_TIER: Tier = "standard";

/**
 * Said when the standard tier is what refused, and the extended tier would not.
 *
 * Named at the moment of refusal rather than left in `--help`, because the
 * author reading this message is holding a skill that is correct for where it
 * runs and has just been told it is invalid.
 */
const EXTENDED_TIER_ADVICE = `
Every error above is a Claude Code extension field, so this skill is valid where it runs —
it is just not portable. Re-run with --extended to package it as it stands.

What that trades: the bundle installs and works in Claude Code, and is rejected by
claude.ai upload and by the Skills API, both of which accept only the six standard fields.
Keep the default tier when the .skill has to travel; move bookkeeping under \`metadata:\`
if you need one bundle that does both.`;

/**
 * Package a skill folder into a .skill file.
 *
 * Validation is a GATE: a skill that does not validate is never written, so a
 * broken skill cannot be handed to a consumer in a form that looks shippable.
 * The gate is on `valid` alone -- warnings are non-blocking by design, and a
 * valid skill with warnings must still package.
 */
export async function packageSkill(
  skillPath: string,
  outputDir?: string,
  tier: Tier = PACKAGING_TIER,
): Promise<PackageResult | null> {
  const skillDir = resolvePath(skillPath);

  if (!(await isDirectory(skillDir))) {
    const exists = (await statOf(skillDir)) !== null;
    console.log(
      exists ? `Error: path is not a directory: ${skillDir}` : `Error: skill folder not found: ${skillDir}`,
    );
    return null;
  }

  if ((await statOf(`${skillDir}/SKILL.md`)) === null) {
    console.log(`Error: SKILL.md not found in ${skillDir}`);
    return null;
  }

  console.log("Validating skill...");
  const validation = await validateSkill(skillDir, tier);
  if (!validation.valid) {
    console.log(formatResult(validation, skillDir, tier));
    // Re-validated rather than pattern-matched against the error text: whether
    // the extended tier would accept this skill is a question only the
    // validator can answer, and asking it costs one extra parse on a path that
    // is already failing.
    const extendedWouldPass =
      tier === "standard" && (await validateSkill(skillDir, "extended")).valid;
    console.log(extendedWouldPass ? EXTENDED_TIER_ADVICE : "\nFix the validation errors before packaging.");
    return null;
  }
  for (const warning of validation.warnings) {
    console.log(`  Warning: ${warning}`);
  }
  console.log("Skill is valid.\n");

  const { entries, skipped } = await collectEntries(skillDir);
  for (const path of skipped) console.log(`  Skipped: ${path}`);
  for (const entry of entries) console.log(`  Added: ${entry.name}`);

  const outputPath = outputDir === undefined ? process.cwd() : resolvePath(outputDir);
  const skillFile = `${outputPath}/${baseName(skillDir)}.skill`;
  const archive = buildZip(entries);
  await Bun.write(skillFile, archive);

  return { path: skillFile, added: entries.map((e) => e.name), skipped, bytes: archive.length };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE =
  "Usage: bun shared/scripts/package-skill.ts <path/to/skill-folder> [output-directory] [--standard|--extended]";

/** The same two tier flags validate-skill.ts takes, resolved by the same function. */
export const CLI_SPEC: Spec = {
  standard: {
    kind: "boolean",
    default: false,
    help: "gate on the Agent Skills open standard only (default)",
  },
  extended: {
    kind: "boolean",
    default: false,
    help: "allow Claude Code extension fields; the bundle is then Claude Code only",
  },
  help: { kind: "boolean", default: false, help: "show this message" },
};

/** Exit codes: 0 ok, 1 packaging refused, 2 usage error -- matching validate-skill.ts. */
if (import.meta.main) {
  try {
    const { flags, positionals } = parseArgs(Bun.argv.slice(2), CLI_SPEC);

    if (flags["help"] === true) {
      console.log(formatHelp(USAGE, CLI_SPEC));
      process.exit(0);
    }

    const skillPath = positionals[0];
    if (skillPath === undefined) throw new CliError(`missing <path/to/skill-folder>\n${USAGE}`);
    if (positionals.length > 2) {
      throw new CliError(`unexpected extra argument: ${positionals[2]}\n${USAGE}`);
    }
    const outputDir = positionals[1];
    const tier = resolveTier(flags);

    console.log(`Packaging skill: ${skillPath}`);
    if (outputDir !== undefined) console.log(`   Output directory: ${outputDir}`);
    if (tier === "extended") console.log("   Tier: extended — the bundle will be Claude Code only");
    console.log();

    const result = await packageSkill(skillPath, outputDir, tier);
    if (result === null) process.exit(1);

    console.log(
      `\nSuccessfully packaged skill to: ${result.path}\n   ${result.added.length} files, ${result.bytes} bytes`,
    );
    process.exit(0);
  } catch (error) {
    if (!(error instanceof CliError)) throw error;
    console.log(`Error: ${error.message}`);
    process.exit(2);
  }
}
