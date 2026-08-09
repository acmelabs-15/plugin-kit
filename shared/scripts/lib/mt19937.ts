/**
 * MT19937 + CPython `random` semantics, ported to TypeScript.
 *
 * Mirrors CPython Modules/_randommodule.c (init_genrand, init_by_array,
 * genrand_uint32, random_seed, getrandbits) and Lib/random.py
 * (_randbelow_with_getrandbits, shuffle).
 *
 * All 32-bit arithmetic uses Math.imul + `>>> 0` so results are exact.
 */

const N = 624;
const M = 397;
const MATRIX_A = 0x9908b0df;
const UPPER_MASK = 0x80000000;
const LOWER_MASK = 0x7fffffff;

/** CPython random_seed(): abs(n) split into 32-bit little-endian words. */
export function seedKeyFromInt(seed: bigint): Uint32Array {
  let v = seed < 0n ? -seed : seed;
  if (v === 0n) return new Uint32Array([0]);
  const words: number[] = [];
  while (v > 0n) {
    words.push(Number(v & 0xffffffffn));
    v >>= 32n;
  }
  return new Uint32Array(words);
}

export class PythonRandom {
  private readonly mt = new Uint32Array(N);
  private index = N + 1;

  constructor(seed: number | bigint = 0n) {
    this.seed(seed);
  }

  /** CPython random.seed(int) */
  seed(value: number | bigint): void {
    this.initByArray(seedKeyFromInt(typeof value === "bigint" ? value : BigInt(value)));
  }

  /** CPython init_genrand */
  private initGenrand(s: number): void {
    const mt = this.mt;
    mt[0] = s >>> 0;
    for (let i = 1; i < N; i++) {
      const prev = mt[i - 1] as number;
      mt[i] = (Math.imul(1812433253, prev ^ (prev >>> 30)) + i) >>> 0;
    }
    this.index = N;
  }

  /** CPython init_by_array */
  private initByArray(key: Uint32Array): void {
    const mt = this.mt;
    const keyLength = key.length;
    this.initGenrand(19650218);

    let i = 1;
    let j = 0;
    let k = N > keyLength ? N : keyLength;
    for (; k > 0; k--) {
      const prev = mt[i - 1] as number;
      mt[i] =
        (((mt[i] as number) ^ Math.imul(prev ^ (prev >>> 30), 1664525)) +
          (key[j] as number) +
          j) >>>
        0;
      i++;
      j++;
      if (i >= N) {
        mt[0] = mt[N - 1] as number;
        i = 1;
      }
      if (j >= keyLength) j = 0;
    }
    for (k = N - 1; k > 0; k--) {
      const prev = mt[i - 1] as number;
      mt[i] =
        (((mt[i] as number) ^ Math.imul(prev ^ (prev >>> 30), 1566083941)) - i) >>> 0;
      i++;
      if (i >= N) {
        mt[0] = mt[N - 1] as number;
        i = 1;
      }
    }
    mt[0] = 0x80000000;
  }

  /** CPython genrand_uint32 */
  genrandUint32(): number {
    const mt = this.mt;
    if (this.index >= N) {
      let kk = 0;
      let y = 0;
      for (; kk < N - M; kk++) {
        y = (((mt[kk] as number) & UPPER_MASK) | ((mt[kk + 1] as number) & LOWER_MASK)) >>> 0;
        mt[kk] = ((mt[kk + M] as number) ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0)) >>> 0;
      }
      for (; kk < N - 1; kk++) {
        y = (((mt[kk] as number) & UPPER_MASK) | ((mt[kk + 1] as number) & LOWER_MASK)) >>> 0;
        mt[kk] = ((mt[kk + (M - N)] as number) ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0)) >>> 0;
      }
      y = (((mt[N - 1] as number) & UPPER_MASK) | ((mt[0] as number) & LOWER_MASK)) >>> 0;
      mt[N - 1] = ((mt[M - 1] as number) ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0)) >>> 0;
      this.index = 0;
    }

    let y = mt[this.index++] as number;
    y = (y ^ (y >>> 11)) >>> 0;
    y = (y ^ ((y << 7) & 0x9d2c5680)) >>> 0;
    y = (y ^ ((y << 15) & 0xefc60000)) >>> 0;
    y = (y ^ (y >>> 18)) >>> 0;
    return y;
  }

  /** getrandbits fast path for k <= 32, returns a JS number. */
  getrandbits32(k: number): number {
    if (k === 0) return 0;
    return this.genrandUint32() >>> (32 - k);
  }

  /** CPython _random_Random_getrandbits_impl, full arbitrary-precision form. */
  getrandbits(k: number): bigint {
    if (k < 0) throw new RangeError("number of bits must be non-negative");
    if (k === 0) return 0n;
    if (k <= 32) return BigInt(this.getrandbits32(k));

    const words = Math.floor((k - 1) / 32) + 1;
    let rem = k;
    let result = 0n;
    for (let i = 0; i < words; i++, rem -= 32) {
      let r = this.genrandUint32();
      if (rem < 32) r = r >>> (32 - rem);
      result |= BigInt(r >>> 0) << BigInt(32 * i);
    }
    return result;
  }

  /** CPython Lib/random.py _randbelow_with_getrandbits. n must satisfy 0 < n < 2**32. */
  randbelow(n: number): number {
    if (n <= 0) throw new RangeError("n must be positive");
    const k = 32 - Math.clz32(n); // n.bit_length()
    let r = this.getrandbits32(k);
    while (r >= n) r = this.getrandbits32(k);
    return r;
  }

  /** CPython Lib/random.py shuffle: for i in reversed(range(1, len(x))). */
  shuffle<T>(x: T[]): void {
    for (let i = x.length - 1; i >= 1; i--) {
      const j = this.randbelow(i + 1);
      const tmp = x[i] as T;
      x[i] = x[j] as T;
      x[j] = tmp;
    }
  }
}
