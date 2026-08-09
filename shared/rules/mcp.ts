/**
 * MCP rules: the server wiring, and where each transport can actually be loaded.
 *
 * The check that earns its place is the transport-versus-surface one. A `stdio`
 * server is silently absent on web and mobile -- no error, its tools are simply
 * not in the model's tool list -- so the symptom a user reports is that Claude
 * got it wrong on their phone. `../references/distribution-targets.md` has the
 * matrix; this module names the trap where the file declaring it lives.
 */

import { expandAnchors, isDirectory, isRecord, pathExists, PLUGIN_ROOT_TOKEN, readText, resolvePath } from "./lib.ts";
import { RuleAbort, section, type RuleContext, type RuleModule, type Section } from "./types.ts";

const TRANSPORTS = new Set(["stdio", "sse", "http"]);

/** Runtimes a plugin must not assume are installed on the user's machine. */
// bun-purity-ignore: the names this rule rejects have to be written down somewhere
const FOREIGN_RUNTIMES = ["node", "npx", "npm", "pnpm", "yarn", "python", "python3", "uv", "uvx", "deno"];

interface Collector {
  readonly errors: string[];
  readonly warnings: string[];
}

async function checkServer(
  name: string,
  server: unknown,
  pluginRoot: string,
  out: Collector,
): Promise<void> {
  const where = `\`${name}\``;
  if (!isRecord(server)) {
    out.errors.push(`${where}: expected an object describing the server.`);
    return;
  }

  const declared = server["type"];
  const hasUrl = typeof server["url"] === "string";
  const hasCommand = typeof server["command"] === "string";
  // `type` is optional in practice; the shape implies it when it is absent.
  const transport = typeof declared === "string" ? declared : hasUrl ? "http" : "stdio";

  if (typeof declared === "string" && !TRANSPORTS.has(declared)) {
    out.errors.push(`${where}: \`type\` is \`${declared}\`. Expected one of ${[...TRANSPORTS].sort().join(", ")}.`);
    return;
  }

  if (transport === "stdio") {
    if (!hasCommand) {
      out.errors.push(`${where}: a stdio server needs a \`command\` to spawn.`);
      return;
    }
    const command = server["command"] as string;
    if (FOREIGN_RUNTIMES.includes(command)) {
      out.errors.push(
        `${where}: \`command\` spawns \`${command}\`, a runtime outside Bun, so the server ` +
          `fails on a machine that does not have it — at connection time, which reads as ` +
          `"the plugin is broken". Spawn \`bun\` on a TypeScript entry point, or ship a ` +
          `\`bun build --compile\` binary so the user needs no runtime at all.`,
      );
    }
    out.warnings.push(
      `${where}: stdio servers load in Claude Code, Claude Desktop and the Desktop Code tab ` +
        `only. On web and mobile the tools are silently absent — no error, they are just not ` +
        `in the tool list. Ship a remote server if those surfaces have to work.`,
    );

    const args = server["args"];
    if (Array.isArray(args)) {
      for (const arg of args) {
        if (typeof arg !== "string" || !arg.includes("/")) continue;
        if (arg.startsWith("/") && !arg.includes(PLUGIN_ROOT_TOKEN)) {
          out.errors.push(
            `${where}: \`${arg}\` is an absolute path, so it breaks for everyone but you. ` +
              `Anchor it with the plugin-root token.`,
          );
          continue;
        }
        const expanded = expandAnchors(arg, pluginRoot);
        if (expanded.startsWith("/") && !(await pathExists(expanded))) {
          out.errors.push(`${where}: entry point \`${arg}\` does not exist (looked at \`${expanded}\`).`);
        }
      }
    }
  } else {
    if (!hasUrl) {
      out.errors.push(`${where}: a \`${transport}\` server needs a \`url\`.`);
      return;
    }
    const url = server["url"] as string;
    if (url.startsWith("http://") && !url.startsWith("http://127.0.0.1") && !url.startsWith("http://localhost")) {
      out.warnings.push(`${where}: \`url\` is plain HTTP to a remote host, so credentials cross the network in clear.`);
    }
  }
}

export const mcpRules: RuleModule = {
  targetType: "mcp",
  summary: ".mcp.json server wiring: transport, entry points, surface reach",
  honoursTier: false,
  honoursEnvironment: false,
  expects: "an .mcp.json, or the plugin directory holding one",

  async run(context: RuleContext): Promise<readonly Section[]> {
    let file = resolvePath(context.path);
    if (!(await pathExists(file))) throw new RuleAbort(`No such path: ${context.path}`);
    if (await isDirectory(file)) {
      const nested = `${file}/.mcp.json`;
      if (!(await pathExists(nested))) throw new RuleAbort(`No .mcp.json in ${context.path}`);
      file = nested;
    }

    const text = await readText(file);
    if (text === undefined) throw new RuleAbort(`Cannot read ${file}`);

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      return [section("Servers", [`\`${file}\` is not valid JSON: ${(error as Error).message}`], [])];
    }
    if (!isRecord(parsed)) return [section("Servers", [`\`${file}\` must hold a JSON object.`], [])];

    // Both shapes are live: `.mcp.json` wraps the map in `mcpServers`, while a
    // plugin manifest's inline block is the map itself.
    const servers = isRecord(parsed["mcpServers"]) ? parsed["mcpServers"] : parsed;
    const names = Object.keys(servers);
    const out: Collector = { errors: [], warnings: [] };
    if (names.length === 0) out.warnings.push("No servers declared, so this file wires nothing up.");

    const pluginRoot = resolvePath(`${file}/..`);
    for (const name of names.sort()) await checkServer(name, servers[name], pluginRoot, out);

    return [
      section("Servers", out.errors, out.warnings, `Checked ${names.length} server(s) in \`${file}\`.`),
    ];
  },
};
