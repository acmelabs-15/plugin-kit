/**
 * Port of CPython Lib/fnmatch.py `translate()` + `fnmatch()`.
 *
 * Why not Bun.Glob: fnmatch's `*` matches `/` (it is a *string* matcher, not a
 * path matcher), `**` is just a compressed `*`, and brace expansion is not
 * supported. Bun.Glob differs on all three.
 *
 * Note: CPython emits an atomic group `(?>.*?fixed)` for interior STAR-fixed
 * pairings. JS RegExp has no atomic groups, so this uses `(?:.*?fixed)`.
 * That relaxes backtracking; see fnmatch_fuzz for the equivalence check.
 */

const STAR = Symbol("STAR");
type Part = string | typeof STAR;

const RE_META = new Set([
  ".", "^", "$", "*", "+", "?", "(", ")", "[", "]", "{", "}", "|", "\\", "/", "-",
]);

function escapeRe(c: string): string {
  return RE_META.has(c) ? `\\${c}` : c;
}

function translateParts(pat: string): Part[] {
  const res: Part[] = [];
  let i = 0;
  const n = pat.length;
  while (i < n) {
    const c = pat[i] as string;
    i += 1;
    if (c === "*") {
      if (res.length === 0 || res[res.length - 1] !== STAR) res.push(STAR);
    } else if (c === "?") {
      res.push(".");
    } else if (c === "[") {
      let j = i;
      if (j < n && pat[j] === "!") j += 1;
      if (j < n && pat[j] === "]") j += 1;
      while (j < n && pat[j] !== "]") j += 1;
      if (j >= n) {
        res.push("\\[");
      } else {
        let stuff: string;
        const raw = pat.slice(i, j);
        if (!raw.includes("-")) {
          stuff = raw.replaceAll("\\", "\\\\");
        } else {
          const chunks: string[] = [];
          let k = pat[i] === "!" ? i + 2 : i + 1;
          let start = i;
          for (;;) {
            const idx = pat.indexOf("-", k);
            if (idx < 0 || idx >= j) break;
            chunks.push(pat.slice(start, idx));
            start = idx + 1;
            k = idx + 3;
          }
          const chunk = pat.slice(start, j);
          if (chunk) chunks.push(chunk);
          else chunks[chunks.length - 1] = `${chunks[chunks.length - 1] as string}-`;
          for (let m = chunks.length - 1; m > 0; m--) {
            const prev = chunks[m - 1] as string;
            const cur = chunks[m] as string;
            if (prev.slice(-1) > (cur[0] as string)) {
              chunks[m - 1] = prev.slice(0, -1) + cur.slice(1);
              chunks.splice(m, 1);
            }
          }
          stuff = chunks.map((s) => s.replaceAll("\\", "\\\\").replaceAll("-", "\\-")).join("-");
        }
        i = j + 1;
        if (stuff.length === 0) {
          res.push("(?!)");
        } else if (stuff === "!") {
          res.push(".");
        } else {
          if (stuff[0] === "!") stuff = `^${stuff.slice(1)}`;
          else if (stuff[0] === "^" || stuff[0] === "[") stuff = `\\${stuff}`;
          // JS-only divergence: Python `re` reads a leading `]` inside a class as
          // a literal; JS RegExp reads `[]` as an empty (never-matching) class.
          stuff = stuff.replace(/^(\^?)\]/, "$1\\]");
          res.push(`[${stuff}]`);
        }
      }
    } else {
      res.push(escapeRe(c));
    }
  }
  return res;
}

function joinParts(parts: readonly Part[]): string {
  const res: string[] = [];
  let i = 0;
  const n = parts.length;
  while (i < n && parts[i] !== STAR) {
    res.push(parts[i] as string);
    i += 1;
  }
  while (i < n) {
    i += 1;
    if (i === n) {
      res.push(".*");
      break;
    }
    const fixed: string[] = [];
    while (i < n && parts[i] !== STAR) {
      fixed.push(parts[i] as string);
      i += 1;
    }
    const f = fixed.join("");
    if (i === n) {
      res.push(".*");
      res.push(f);
    } else {
      res.push(`(?:.*?${f})`);
    }
  }
  return res.join("");
}

/** Equivalent of CPython `fnmatch.translate(pat)`, compiled for JS. */
export function fnmatchCompile(pat: string): RegExp {
  return new RegExp(`^(?:${joinParts(translateParts(pat))})$`, "s");
}

const cache = new Map<string, RegExp>();

/**
 * Equivalent of CPython `fnmatch.fnmatchcase(name, pat)`, and of
 * `fnmatch.fnmatch` on POSIX (where os.path.normcase is the identity).
 */
export function fnmatch(name: string, pat: string): boolean {
  let re = cache.get(pat);
  if (re === undefined) {
    re = fnmatchCompile(pat);
    cache.set(pat, re);
  }
  return re.test(name);
}
