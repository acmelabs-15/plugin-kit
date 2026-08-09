/**
 * Minimal argv parsing shared by every CLI entrypoint in this skill.
 *
 * Written as shared infrastructure rather than inlined per-script so that flag
 * handling stays consistent: the ported Python scripts share an argparse
 * convention, and reproducing it three separate ways is how call sites drift.
 *
 * Pure Bun. No dependencies, by design -- this skill ships with no npm install
 * step, so anything it needs at runtime has to be first-party.
 *
 * Supported forms, matching what the Python argparse call sites accept:
 *   --flag value      --flag=value      --bool-flag
 *   -p value          -p=value          positionals
 *
 * Repeated flags collect into an array so `--tag a --tag b` works.
 */

/**
 * `integer` exists separately from `number` because the Python argparse call
 * sites this replaces declare `type=int`, which rejects `--port 3.7` outright.
 * A plain `number` would silently accept it and hand a fractional port to the
 * server, so the distinction is behavioural rather than cosmetic.
 */
export type FlagKind = "string" | "number" | "integer" | "boolean";

export interface FlagSpec {
  /** Value kind. `boolean` flags consume no following token. */
  kind: FlagKind;
  /** Short alias without the leading dash, e.g. "p" for --port. */
  short?: string;
  /** Default applied when the flag is absent. */
  default?: string | number | boolean;
  /** Allow repetition, collecting values into an array. */
  repeat?: boolean;
  /** Help text, rendered by formatHelp(). */
  help?: string;
}

export type Spec = Record<string, FlagSpec>;

export interface ParsedArgs {
  flags: Record<string, string | number | boolean | Array<string | number>>;
  positionals: string[];
}

/** Thrown for malformed input so callers can exit(2) with a clear message. */
export class CliError extends Error {}

function coerce(name: string, raw: string, kind: FlagKind): string | number | boolean {
  if (kind === "number" || kind === "integer") {
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new CliError(`--${name} expects a number, got: ${raw}`);
    if (kind === "integer" && !Number.isInteger(n)) {
      throw new CliError(`--${name} expects a whole number, got: ${raw}`);
    }
    return n;
  }
  if (kind === "boolean") {
    // Claude Code accepts these spellings for booleans; mirror that leniency.
    const v = raw.toLowerCase();
    if (["true", "yes", "on", "1"].includes(v)) return true;
    if (["false", "no", "off", "0"].includes(v)) return false;
    throw new CliError(`--${name} expects a boolean, got: ${raw}`);
  }
  return raw;
}

/**
 * Parse argv against a spec.
 *
 * `argv` should exclude the runtime and script path -- pass Bun.argv.slice(2).
 * Unknown flags throw rather than being silently ignored, because a silently
 * dropped flag reads as "the tool ignored me" and is hard to diagnose.
 *
 * `--help` and `-h` are always accepted, whether or not the spec declares them,
 * and surface as `flags.help === true`. Requiring every entrypoint to remember
 * to declare help would mean the one that forgot would reject `--help` as an
 * unknown flag -- the least helpful possible response to someone asking for
 * help. A spec may still declare `help` explicitly to document it in the usage
 * text; that declaration wins.
 */
export function parseArgs(argv: readonly string[], spec: Spec): ParsedArgs {
  const byShort = new Map<string, string>();
  for (const [name, s] of Object.entries(spec)) if (s.short) byShort.set(s.short, name);

  const flags: ParsedArgs["flags"] = {};
  const positionals: string[] = [];

  for (const [name, s] of Object.entries(spec)) {
    if (s.default !== undefined) flags[name] = s.default;
  }

  const push = (name: string, value: string | number | boolean) => {
    const s = spec[name]!;
    if (!s.repeat) {
      flags[name] = value;
      return;
    }
    const cur = flags[name];
    const arr = Array.isArray(cur) ? cur : [];
    arr.push(value as string | number);
    flags[name] = arr;
  };

  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i]!;

    if (tok === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }

    if (!tok.startsWith("-") || tok === "-") {
      positionals.push(tok);
      continue;
    }

    const isLong = tok.startsWith("--");
    const body = isLong ? tok.slice(2) : tok.slice(1);
    const eq = body.indexOf("=");
    const rawName = eq === -1 ? body : body.slice(0, eq);
    const inlineValue = eq === -1 ? undefined : body.slice(eq + 1);

    const name = isLong ? rawName : (byShort.get(rawName) ?? rawName);

    // Always-available help, unless the spec defines its own.
    if (!spec[name] && (name === "help" || (!isLong && rawName === "h"))) {
      flags.help = true;
      continue;
    }

    const s = spec[name];
    if (!s) throw new CliError(`unknown flag: ${tok}`);

    if (s.kind === "boolean") {
      push(name, inlineValue === undefined ? true : coerce(name, inlineValue, "boolean"));
      continue;
    }

    const raw = inlineValue ?? argv[++i];
    if (raw === undefined) throw new CliError(`--${name} expects a value`);
    push(name, coerce(name, raw, s.kind));
  }

  return { flags, positionals };
}

/** Render `--help` text from the same spec, so help can never drift from parsing. */
export function formatHelp(usage: string, spec: Spec): string {
  const rows = Object.entries(spec).map(([name, s]) => {
    const left = `  --${name}${s.short ? `, -${s.short}` : ""}${s.kind === "boolean" ? "" : " <value>"}`;
    const def = s.default !== undefined ? ` (default: ${String(s.default)})` : "";
    return `${left.padEnd(34)}${s.help ?? ""}${def}`;
  });
  return `${usage}\n\nOptions:\n${rows.join("\n")}\n`;
}
