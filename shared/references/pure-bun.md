# Pure Bun

Every script this plugin ships, and every script it teaches anyone to write, runs on Bun. One runtime, installed once, and nothing else assumed to be on the machine except git.

One assumption beyond the runtime: a script that imports a pinned package needs a network on its **first** run. Bun auto-installs imported packages into a global cache during execution, so the first run on a cold cache fetches and a fully offline machine fails there. Every run after that is local. This is narrow enough not to justify a build step, but it is an assumption, so it is stated rather than left for a user to discover offline.

This is a house rule rather than an ecosystem norm — Anthropic's own official plugins ship `python3` and shell hooks — so it is worth stating why rather than inheriting it:

- **A plugin that mixes runtimes fails on whichever one the user is missing**, and it fails at invocation rather than at install. The user sees "the plugin is broken", not "install this first".
- **Bun runs TypeScript directly.** No build step for a script, no transpile config, nothing in the path that has to be installed before the script will start.
- **The test runner, bundler, shell and package manager come with it.** `bun test`, `Bun.build`, `Bun.$` — there is nothing to add and nothing to keep in sync.
- **It compiles.** `bun build --compile` turns any entry point into an executable that needs no runtime at all, which is the only way to ship something that works on a machine with nothing installed. The last section covers it.

A script that genuinely cannot be Bun is a design signal worth examining before it is an exception worth granting.

`../scripts/check-bun-purity.ts` enforces everything below, and `../scripts/validate.ts --target-type skill` runs it as part of a skill's checks. Run it before claiming the standard holds.

---

## A `node:` import is Bun, not Node

This is the part that gets re-litigated, so it is stated plainly.

**`import { mkdir } from "node:fs/promises"` under Bun does not involve Node.** Those builtins are reimplemented natively inside the Bun binary. Nothing resolves to a Node installation, no Node needs to exist on the machine, and removing Node from a machine changes nothing about whether the import works. The prohibition is on **spawning a runtime** — a `node` process, a `python3` process, a package runner that fetches and executes something. It has never been a prohibition on a standard library.

Bun's own documentation instructs the usage:

> "The `Bun.file` and `Bun.write` APIs documented on this page are heavily optimized and are the recommended way to work with files in Bun. **For operations they don't cover, such as `mkdir` or `readdir`, use Bun's nearly complete implementation of the `node:fs` module.**"

and, without hedging:

> "Bun's implementation of `node:fs` is fast. **Use `node:fs` for working with directories in Bun.**"

Bun's own tooling follows its own advice: across its `scripts/` directory, `node:*` imports outnumber `Bun.*` calls by roughly ten to one in filesystem and path code. Compatibility for the modules that matter here is complete or near it — `node:path` and `node:os` pass 100% of Node's test suite, `node:fs` 92%.

Rewriting one of these into a `Bun.$` shell-out is not purity. It is a worse program: it adds a process, it adds a shell, it adds quoting bugs, and it adds a dependency on the external command it now calls. It also makes the code fail on Windows, where the shell is not the one the string was written for.

### The three this repository uses, and why each has no better answer

| Import | Used for | Why there is no Bun-native equivalent |
|---|---|---|
| `node:fs/promises` | `mkdtemp`, `rm`, `cp`, `rename`, `unlink`, `readdir` | The Bun file API reads and writes a file's *contents*. It has no directory creation, no recursive delete, no rename, no directory listing. Bun's docs point at `node:fs` for exactly this set |
| `node:os` | `tmpdir()` | There is no `Bun.tmpdir()`. The location is platform-specific and honours `TMPDIR`, so hardcoding `/tmp` is wrong on Windows and wrong under a sandbox that redirects it |
| `node:path` | `join`, `resolve`, `relative`, `extname` | Bun exposes no path manipulation at all. `Bun.pathToFileURL` and `Bun.fileURLToPath` convert between forms; they do not join or normalise |

Nothing else in this repository imports a `node:` builtin, and a fourth one appearing is worth a moment's thought rather than a reflex — not because it would be wrong, but because the reflex is where `node:child_process` sneaks in next to a perfectly good `Bun.spawn`.

**Always write the `node:` prefix.** A bare `from "path"` can be shadowed by an npm package named `path`; `from "node:path"` cannot, and it says plainly that the import is a builtin rather than a dependency. The prefix is the rule; the module is not the problem.

```ts
import { join } from "node:path";        // correct
import { join } from "path";             // resolves today, shadowable tomorrow
```

---

## The prefer-order

**A Bun-native API, then a `node:` builtin that Bun implements, then — only if neither exists — an external process.**

The order is about how much of the work happens inside the one binary you already require. Every step down adds something that can be absent, be the wrong version, or behave differently on someone else's operating system.

| Job | Reach for | Rather than |
|---|---|---|
| Read or write a whole file | `Bun.file(path).text()`, `Bun.write(path, data)` | `readFile`, `writeFile` |
| Find files by pattern | `new Bun.Glob(pattern).scan()` | Hand-rolled recursion, or shelling out to `find` |
| Directory work — create, list, remove, rename | `node:fs/promises` | A shell invocation |
| Path manipulation | `node:path` | String concatenation, or a shell |
| Run a subprocess | `Bun.spawn`, `Bun.spawnSync` | `node:child_process` |
| A pipeline, a redirect, a glob expansion | `Bun.$` | `sh -c` with a hand-built string |
| Serve HTTP or WebSocket | `Bun.serve` | An HTTP framework dependency |
| Parse YAML | `Bun.YAML.parse` | A YAML package |
| Parse TOML | `Bun.TOML.parse` | A TOML package |
| Hash a password | `Bun.password.hash` / `.verify` | An argon2 or bcrypt package |
| Hash bytes | `Bun.CryptoHasher`, `Bun.hash` | `node:crypto`, unless it is an algorithm Bun lacks |
| Test | `bun:test` | A test-runner dependency and its config |
| A local database | `bun:sqlite` | A SQLite driver package |
| Compress | `Bun.gzipSync`, `Bun.gunzipSync` | `node:zlib`, or piping through `gzip` |
| Find an executable | `Bun.which` | Parsing `PATH` by hand |

Two notes on that table. `Bun.YAML` and `Bun.TOML` arrived relatively recently — check they exist in the Bun you are targeting before depending on them, because the fallback is a dependency and that is a decision, not a detail. And one honest wrinkle: Bun's docs call `Bun.file` "recommended" for reads while Bun's own scripts reach for `node:fs` far more often. Either is defensible for a plain read; consistency inside one codebase matters more than the choice, and this codebase uses `Bun.file`.

`Bun.$` deserves its own caution. It is the right tool for a pipeline, and it is still a shell — every command it names is a dependency. `await $\`git rev-parse HEAD\`` is fine here because git is the one external tool this plugin assumes. `await $\`jq -r .x < payload.json\`` is not, because `jq` is not.

---

## What the rule forbids, and what each one costs

Each of these is an error rather than a matter of taste, because each one moves a cost off your machine and onto a user's.

**Spawning `node`, `npx`, `npm`, `python`, `pip`, `uv`, `uvx` or `deno`.** The plugin stops working on any machine without that runtime, and the failure surfaces as a hook that silently did nothing or a server stuck in "failed" — never as "install this". A package runner is worse again: it puts a network round trip and a registry on the startup path, so the plugin also stops working offline, and the version that runs is whatever resolved today.

**A shebang other than `#!/usr/bin/env bun`.** Same cost, hidden in a place nobody reads. A file with a `node` shebang works fine when invoked as `bun file.ts` and breaks the moment someone marks it executable and runs it directly.

**A runtime npm dependency.** Anything in `dependencies`, `peerDependencies` or `optionalDependencies` means the installed plugin needs an install step before it works, and plugin installation does not run one. `devDependencies` are fine — this repository has three, for typechecking and token counting, and none of them ship. Where a third-party package genuinely earns its place at runtime, `Bun.build` inlines it into the shipped output so there is nothing to install.

**An `engines` field.** It pins a runtime this code does not run on, and tooling that honours it will refuse or warn on a machine that is perfectly capable of running the plugin.

**A `.py`, `.rb` or `.sh` file.** A shell script is the one that looks harmless. It is a second language in the repository with no types, no tests, and a different set of assumptions about what is installed — and on Windows it does not run at all.

**Assuming any command beyond Bun and git.** `jq`, `curl`, `biome`, `prettier`, `xargs`, `docker`: each is a thing that has to already be there. This is a warning rather than an error, because sometimes an external tool is genuinely the only answer — but the acceptable versions of that are documenting it in the README and failing with a message that names the missing command, never depending on it silently.

Where the external tool is a formatter or linter, reach for **biome before prettier**. Biome ships as a single native binary that formats and lints JavaScript, TypeScript and JSON in one tool, so it adds no Node runtime and no plugin chain — which is the same reason this repository runs on Bun. Prettier is a Node package, so depending on it reintroduces exactly the runtime the standard above exists to avoid. Prefer prettier only when the project you are writing into has already standardized on it, and say so where you depend on it. Detect rather than assume: check for a `biome.json` or `biome.jsonc` first, fall back to a prettier config, and if neither is present do the job with Bun and leave formatting alone. Neither tool is guaranteed to be installed, so both stay warnings and both still need the README line.

**`require()`, and a bare builtin import.** ESM is the module system here, and a bare `from "fs"` is shadowable by a package of that name. Neither costs a user anything today; both are how a file drifts toward being a Node file.

---

## Shipping a single-file executable

`bun build --compile` bundles an entry point together with the Bun runtime and emits one executable. Nothing needs to be installed on the machine that runs it — not Bun, not a package manager, not the plugin's dependencies.

```bash
bun build --compile --outfile=repo-index ./servers/repo-index/index.ts
```

This matters more than it looks, because it is the route to a Claude Desktop extension with no prerequisites at all. An MCPB bundle declares how its server starts through `server.type`, and the format accepts `node`, `python`, `uv` and `binary`. Those first three are a true statement about what the format permits, and each hands a prerequisite back to the user; `binary` is a server the host launches directly with no interpreter to find, and it is the value this plugin recommends. Compiling a Bun server is how you produce something to put there. Read `distribution-targets.md`, section "MCPB, concretely", once you have a binary and are writing the manifest around it — a set of per-platform binaries needs `mcp_config.platform_overrides` alongside `compatibility.platforms`, and a bundle that omits them installs and then fails on the platform it was not built for.

The same applies to a plugin's `.mcp.json`: pointing a `stdio` entry's `command` at a compiled artifact under the plugin root removes the "the user must have Bun on their `PATH`" bet entirely.

### Cross-compiling

`--target` takes `bun-<platform>-<arch>`, with two modifiers:

| Target | For |
|---|---|
| `bun-linux-x64`, `bun-linux-arm64` | glibc Linux |
| `bun-linux-x64-musl`, `bun-linux-arm64-musl` | Alpine and other musl distributions |
| `bun-darwin-arm64`, `bun-darwin-x64` | Apple silicon, Intel Macs |
| `bun-windows-x64`, `bun-windows-arm64` | Windows — the `.exe` suffix is added for you |
| any `-baseline` variant | x64 CPUs without AVX2, which is most pre-2013 hardware and some virtualised guests |

Cross-compiling downloads the target platform's Bun binary on first use, so the first build for a new target needs a network. `--compile-executable-path` points at one you already have, which is what a build in an air-gapped CI does.

### What the artifact actually needs

Worth knowing before you promise "no dependencies":

- **Size.** The runtime is embedded, so expect roughly 60–120 MB per target, before compression. This is per platform, so shipping all six is most of a gigabyte and a release-asset decision rather than a repository one.
- **A dynamic loader.** The Linux glibc builds are dynamically linked against the system C library; that is what the `-musl` targets exist for. Nothing else is linked in.
- **Assets are not automatic.** Files the code reads at runtime are only inside the binary if they were `import`ed — `Bun.file("./template.html")` at runtime resolves against the working directory and will not be there. Import the asset, or embed it as a string.
- **`import.meta.dir` is not a real directory** in a compiled binary. Anything computing a path from the module's own location needs a different anchor; in a plugin that anchor is `CLAUDE_PLUGIN_ROOT`.
- **`--bytecode`** trades a larger artifact for faster startup, which is worth measuring for something spawned per session rather than assumed either way.

---

## Verifying it

Cheap to check, so check rather than assume. The script is the real answer:

```bash
bun shared/scripts/check-bun-purity.ts .
```

It reports every violation with a file, a line and a fix, distinguishes errors from warnings, and exits non-zero on an error. Where a mention is a fact about what the platform permits rather than a recommendation this plugin is making, mark it and say why:

```markdown
<!-- bun-purity-ignore: MCPB's manifest also accepts language runtimes; this is the format, not our advice -->
```

The marker covers the line it sits on, the line after it, and — when the next line opens a fenced code block — that whole block. A marker with no reason is itself an error, because an unexplained suppression is how a rule stops meaning anything.

The underlying greps, for when you want to see the mechanism rather than trust it. All five return nothing against this repository:

<!-- bun-purity-ignore: these are the search patterns, so they have to name the things being searched for -->
```bash
# Every shebang names Bun
grep -rn --exclude-dir=node_modules --include="*.ts" "^#!" . | grep -v "#!/usr/bin/env bun"

# No bare builtin import, which an npm package of the same name could shadow
grep -rn --exclude-dir=node_modules --include="*.ts" \
  'from "\(assert\|buffer\|child_process\|crypto\|events\|fs\|http\|https\|os\|path\|process\|stream\|url\|util\|zlib\)"' .

# No config spawning another runtime
grep -rn --exclude-dir=node_modules --include="*.json" \
  '"command": *"\(node\|npx\|npm\|python3\?\|uvx\?\|deno\)"' .

# No second language in the repository
find . -path ./node_modules -prune -o \( -name "*.py" -o -name "*.sh" -o -name "*.rb" \) -print

# Nothing the user would have to install
grep -n '"\(dependencies\|peerDependencies\|engines\)"' package.json
```

The bare-import check is the one most likely to find something, because a bare builtin import is easy to write by habit and nothing else complains about it.
