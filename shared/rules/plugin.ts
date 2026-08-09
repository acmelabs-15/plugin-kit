/**
 * Plugin rules: the manifest, and the layout invariants that fail silently.
 *
 * `claude plugin validate` already checks the manifest's own shape, so this
 * module deliberately covers what that one does not: a component sitting in a
 * directory nothing scans, and a path override that stops the default scan
 * without saying so. Both pass the first-party validator and both mean a
 * component the user installed is simply not there.
 */

import { isDirectory, isRecord, listDirectory, pathExists, readText, resolvePath } from "./lib.ts";
import { RuleAbort, section, type RuleContext, type RuleModule, type Section } from "./types.ts";

/**
 * Component-path overrides, and what each one does to the default scan.
 *
 * `skills` adds to the default directory; `commands` and `agents` replace it. An
 * override on either of those silently stops `commands/` or `agents/` loading,
 * which is a permanent liability bought for a one-time convenience.
 */
const OVERRIDE_KEYS: Readonly<Record<string, "adds" | "replaces">> = {
  skills: "adds",
  commands: "replaces",
  agents: "replaces",
  hooks: "replaces",
};

/** Where each component type has to sit to be found at all. */
const EXPECTED_LAYOUT: Readonly<Record<string, string>> = {
  "skills": "skills/<name>/SKILL.md",
  "agents": "agents/<name>.md",
  "hooks": "hooks/hooks.json",
  "commands": "commands/<name>.md",
};

export const pluginRules: RuleModule = {
  targetType: "plugin",
  summary: "plugin.json manifest, component layout, and path overrides that break the scan",
  honoursTier: false,
  honoursEnvironment: false,
  expects: "the plugin root directory",

  async run(context: RuleContext): Promise<readonly Section[]> {
    const root = resolvePath(context.path);
    if (!(await pathExists(root))) throw new RuleAbort(`No such path: ${context.path}`);
    if (!(await isDirectory(root))) throw new RuleAbort(`${context.path} is not a directory.`);

    const manifestPath = `${root}/.claude-plugin/plugin.json`;
    const errors: string[] = [];
    const warnings: string[] = [];

    const text = await readText(manifestPath);
    if (text === undefined) {
      return [
        section(
          "Manifest",
          [`No \`.claude-plugin/plugin.json\` under ${context.path}. Without it nothing loads as a plugin.`],
          [],
        ),
      ];
    }

    let manifest: unknown;
    try {
      manifest = JSON.parse(text);
    } catch (error) {
      return [section("Manifest", [`\`${manifestPath}\` is not valid JSON: ${(error as Error).message}`], [])];
    }
    if (!isRecord(manifest)) {
      return [section("Manifest", [`\`${manifestPath}\` must hold a JSON object.`], [])];
    }

    if (typeof manifest["name"] !== "string" || manifest["name"] === "") {
      errors.push("Missing `name`. It is the identifier every component is namespaced under.");
    }
    if (typeof manifest["description"] !== "string" || manifest["description"] === "") {
      warnings.push("No `description`. It is what a user reads in the marketplace listing.");
    }
    if (manifest["version"] === undefined) {
      warnings.push("No `version`, so `claude plugin validate --strict` warns and the git SHA becomes it.");
    }

    for (const [key, effect] of Object.entries(OVERRIDE_KEYS)) {
      const value = manifest[key];
      if (value === undefined) continue;
      const paths = Array.isArray(value) ? value : [value];
      for (const p of paths) {
        if (typeof p !== "string") {
          errors.push(`\`${key}\` override must be a string or an array of strings.`);
          continue;
        }
        if (p.startsWith("/")) {
          errors.push(`\`${key}\`: \`${p}\` is absolute, and an absolute component path does not resolve.`);
        } else if (!p.startsWith("./")) {
          errors.push(`\`${key}\`: \`${p}\` needs the \`./\` prefix — a bare relative path does not resolve.`);
        }
      }
      if (effect === "replaces") {
        warnings.push(
          `\`${key}\` is a component-path override, and it *replaces* the default scan rather ` +
            `than adding to it — \`${key}/\` stops loading the moment this is set. Remove it ` +
            `unless something genuinely requires the move.`,
        );
      }
    }

    // The layout half. A component in the wrong directory passes the manifest
    // check and is never registered, which is the failure with no message.
    const findings: string[] = [];
    for (const [dir, shape] of Object.entries(EXPECTED_LAYOUT)) {
      const path = `${root}/${dir}`;
      if (!(await isDirectory(path))) continue;
      const entries = await listDirectory(path);
      if (entries.length === 0) {
        warnings.push(`\`${dir}/\` exists but is empty.`);
        continue;
      }
      if (dir === "skills") {
        for (const entry of entries) {
          if (!(await isDirectory(`${path}/${entry}`))) {
            warnings.push(`\`skills/${entry}\` is a file. A skill is a directory holding SKILL.md, so this is not loaded.`);
          } else if (!(await pathExists(`${path}/${entry}/SKILL.md`))) {
            errors.push(`\`skills/${entry}/\` has no SKILL.md, so it registers nothing. Expected ${shape}.`);
          }
        }
      }
      if (dir === "agents") {
        for (const entry of entries) {
          if (await isDirectory(`${path}/${entry}`)) {
            warnings.push(`\`agents/${entry}/\` is a directory. Agents are flat files — expected ${shape}.`);
          }
        }
      }
      findings.push(dir);
    }

    if (findings.length === 0) {
      warnings.push("No component directories found, so this plugin ships nothing.");
    }

    return [
      section(
        "Manifest and layout",
        errors,
        warnings,
        `Read \`${manifestPath}\`; component directories present: ${findings.length > 0 ? findings.join(", ") : "none"}.`,
      ),
    ];
  },
};
