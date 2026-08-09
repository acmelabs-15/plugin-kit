/**
 * Exact CPython float semantics for TypeScript.
 *
 * CPython formats/rounds floats via David Gay's dtoa (mode 3), which is
 * correctly rounded with ties-to-EVEN. JS `toFixed` is correctly rounded with
 * ties-AWAY-from-zero. These disagree whenever the double's exact decimal
 * expansion terminates in a 5 at digit n+1 -- i.e. for dyadic rationals such as
 * every odd multiple of 1/32 at 4 decimal places.
 *
 * This module reproduces CPython exactly using BigInt rational arithmetic on
 * the exact IEEE754 value.
 */

const scratch = new DataView(new ArrayBuffer(8));

/** Decompose a finite double so that |x| === m * 2**e exactly. */
function decompose(x: number): { neg: boolean; m: bigint; e: number } {
  scratch.setFloat64(0, x, false);
  const hi = scratch.getUint32(0);
  const lo = scratch.getUint32(4);
  const neg = hi >>> 31 === 1;
  const expField = (hi >>> 20) & 0x7ff;
  const frac = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (expField === 0) return { neg, m: frac, e: -1074 };
  return { neg, m: frac | (1n << 52n), e: expField - 1075 };
}

/** Equivalent of CPython `format(x, f".{n}f")`. Ties-to-even, exact. */
export function formatFixed(x: number, n: number): string {
  if (Number.isNaN(x)) return "nan";
  if (!Number.isFinite(x)) return x > 0 ? "inf" : "-inf";

  const { neg, m, e } = decompose(x);
  const pow10 = 10n ** BigInt(n);

  let num: bigint;
  let den: bigint;
  if (e >= 0) {
    num = m * (1n << BigInt(e)) * pow10;
    den = 1n;
  } else {
    num = m * pow10;
    den = 1n << BigInt(-e);
  }

  let q = num / den;
  const rem = num - q * den;
  const twice = rem * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) q += 1n;

  const digits = q.toString().padStart(n + 1, "0");
  const body =
    n === 0 ? digits : `${digits.slice(0, digits.length - n)}.${digits.slice(digits.length - n)}`;
  return neg ? `-${body}` : body;
}

/** Equivalent of CPython `round(x, n)` for finite x. */
export function pyRound(x: number, n: number): number {
  if (!Number.isFinite(x)) return x;
  return Number(formatFixed(x, n));
}

/** Equivalent of CPython `format(x, f"+.{n}f")`. */
export function formatSigned(x: number, n: number): string {
  const s = formatFixed(x, n);
  return s.startsWith("-") ? s : `+${s}`;
}

/** Equivalent of CPython `format(x, f".{n}%")`. Multiplies by 100 first, as CPython does. */
export function formatPercent(x: number, n: number): string {
  return `${formatFixed(x * 100, n)}%`;
}

/** Equivalent of CPython `format(x, f"+.{n}%")`. */
export function formatSignedPercent(x: number, n: number): string {
  return `${formatSigned(x * 100, n)}%`;
}

/** Equivalent of CPython `str.title()`, including the "don't" -> "Don'T" behaviour. */
const CASED = /\p{Lu}|\p{Ll}|\p{Lt}/u;
export function pyTitle(s: string): string {
  let previousIsCased = false;
  let out = "";
  for (const ch of s) {
    out += previousIsCased ? ch.toLowerCase() : ch.toUpperCase();
    previousIsCased = CASED.test(ch);
  }
  return out;
}

/** Equivalent of CPython `html.escape(s, quote=True)`. Order of replacement matters. */
export function htmlEscape(s: string, quote = true): string {
  let out = s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  if (quote) out = out.replaceAll('"', "&quot;").replaceAll("'", "&#x27;");
  return out;
}
