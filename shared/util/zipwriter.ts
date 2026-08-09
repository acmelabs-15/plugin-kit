/**
 * Minimal ZIP writer using only Bun built-ins.
 * Bun.deflateSync emits RAW deflate (verified: no 0x78 0x9c zlib header),
 * which is exactly what ZIP method 8 requires.
 *
 * Compression level defaults to 9. That is deliberate and verified: at level 9
 * Bun.deflateSync is BYTE-IDENTICAL to Python's zlib across a diverse corpus
 * (empty, tiny, repetitive, prose, markdown, JSON, binary, pseudo-random,
 * UTF-8 -- 9 of 9). Levels 1 and 6 diverge on every input larger than a few
 * bytes. Python's zipfile module compresses at zlib's default (level 6), so
 * archives written here are not byte-identical to zipfile's -- level 9 is the
 * only level at which the deflate streams can be pinned to a known-matching
 * implementation, and it produces a smaller, equally valid archive.
 *
 * Zip64 is emitted automatically when a field overflows its 32-bit slot, which
 * is what Python's zipfile does; without it, archives with more than 65535
 * entries or a member over 4 GiB could not be written at all.
 */

/**
 * A `Uint8Array` over a plain `ArrayBuffer`.
 *
 * Bun's byte APIs (`Bun.hash.crc32`, `Bun.deflateSync`, `Bun.write`) reject
 * SharedArrayBuffer-backed views, so the constraint is stated once here at the
 * boundary rather than re-asserted at every call site.
 */
export type Bytes = Uint8Array<ArrayBuffer>;

/** Deflate level accepted by `Bun.deflateSync`, derived so it cannot drift. */
export type DeflateLevel = NonNullable<NonNullable<Parameters<typeof Bun.deflateSync>[1]>["level"]>;

export interface ZipEntry {
  readonly name: string;
  readonly data: Bytes;
  /** Full POSIX st_mode, e.g. 0o100644 or 0o100755. */
  readonly mode: number;
  /** [year, month, day, hour, minute, second] */
  readonly dateTime: readonly [number, number, number, number, number, number];
  readonly compress?: boolean;
  /** Deflate level. Defaults to 9; see the module comment before changing it. */
  readonly level?: DeflateLevel;
}

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const ZIP64_EOCD_SIG = 0x06064b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;

const ZIP64_LIMIT = 0xffffffff;
const ZIP_FILECOUNT_LIMIT = 0xffff;
const ZIP64_EXTRA_ID = 0x0001;

const DEFAULT_VERSION = 20;
const ZIP64_VERSION = 45;
const UNIX_CREATE_SYSTEM = 3;
const DEFAULT_LEVEL: DeflateLevel = 9;

function dosDateTime(
  dt: readonly [number, number, number, number, number, number],
): { time: number; date: number } {
  const [y, mo, d, h, mi, s] = dt;
  return {
    time: (h << 11) | (mi << 5) | (s >> 1),
    date: ((y - 1980) << 9) | (mo << 5) | d,
  };
}

class ByteWriter {
  private chunks: Bytes[] = [];
  private len = 0;
  get length(): number {
    return this.len;
  }
  push(u: Bytes): void {
    this.chunks.push(u);
    this.len += u.length;
  }
  u16(v: number): void {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, v, true);
    this.push(b);
  }
  u32(v: number): void {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, v >>> 0, true);
    this.push(b);
  }
  u64(v: number): void {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigUint64(0, BigInt(v), true);
    this.push(b);
  }
  concat(): Bytes {
    const out = new Uint8Array(this.len);
    let o = 0;
    for (const c of this.chunks) {
      out.set(c, o);
      o += c.length;
    }
    return out;
  }
}

interface CentralEntry {
  readonly name: Bytes;
  readonly crc: number;
  readonly csize: number;
  readonly usize: number;
  readonly method: number;
  readonly time: number;
  readonly date: number;
  readonly mode: number;
  readonly offset: number;
  readonly zip64: boolean;
}

/** Zip64 extended information extra field (header id 0x0001). */
function zip64Extra(values: readonly number[]): Bytes {
  const w = new ByteWriter();
  w.u16(ZIP64_EXTRA_ID);
  w.u16(8 * values.length);
  for (const v of values) w.u64(v);
  return w.concat();
}

function writeLocalHeader(out: ByteWriter, entry: CentralEntry, payload: Bytes): void {
  const extra = entry.zip64 ? zip64Extra([entry.usize, entry.csize]) : new Uint8Array(0);

  out.u32(LOCAL_SIG);
  out.u16(entry.zip64 ? ZIP64_VERSION : DEFAULT_VERSION);
  out.u16(0x800); // flag: UTF-8 filename
  out.u16(entry.method);
  out.u16(entry.time);
  out.u16(entry.date);
  out.u32(entry.crc);
  out.u32(entry.zip64 ? ZIP64_LIMIT : entry.csize);
  out.u32(entry.zip64 ? ZIP64_LIMIT : entry.usize);
  out.u16(entry.name.length);
  out.u16(extra.length);
  out.push(entry.name);
  if (extra.length > 0) out.push(extra);
  out.push(payload);
}

function writeCentralHeader(out: ByteWriter, entry: CentralEntry): void {
  // Field order inside the extra is fixed by the spec: original size,
  // compressed size, then relative header offset -- and only the fields whose
  // 32-bit slot carries the sentinel are present.
  const extraValues: number[] = [];
  if (entry.zip64) extraValues.push(entry.usize, entry.csize);
  const offsetOverflows = entry.offset > ZIP64_LIMIT;
  if (offsetOverflows) extraValues.push(entry.offset);

  const extra = extraValues.length > 0 ? zip64Extra(extraValues) : new Uint8Array(0);
  const version = extraValues.length > 0 ? ZIP64_VERSION : DEFAULT_VERSION;

  out.u32(CENTRAL_SIG);
  out.u16((UNIX_CREATE_SYSTEM << 8) | version); // version made by: UNIX
  out.u16(version); // version needed
  out.u16(0x800);
  out.u16(entry.method);
  out.u16(entry.time);
  out.u16(entry.date);
  out.u32(entry.crc);
  out.u32(entry.zip64 ? ZIP64_LIMIT : entry.csize);
  out.u32(entry.zip64 ? ZIP64_LIMIT : entry.usize);
  out.u16(entry.name.length);
  out.u16(extra.length);
  out.u16(0); // comment
  out.u16(0); // disk start
  out.u16(0); // internal attrs
  out.u32((entry.mode & 0xffff) << 16); // external attrs: POSIX mode in high 16 bits
  out.u32(offsetOverflows ? ZIP64_LIMIT : entry.offset);
  out.push(entry.name);
  if (extra.length > 0) out.push(extra);
}

function writeEndRecords(out: ByteWriter, count: number, size: number, start: number): void {
  if (count > ZIP_FILECOUNT_LIMIT || size > ZIP64_LIMIT || start > ZIP64_LIMIT) {
    const zip64EocdOffset = out.length;
    out.u32(ZIP64_EOCD_SIG);
    out.u64(44); // size of the remainder of this record
    out.u16(ZIP64_VERSION); // version made by
    out.u16(ZIP64_VERSION); // version needed
    out.u32(0); // this disk number
    out.u32(0); // disk with central directory
    out.u64(count); // entries on this disk
    out.u64(count); // entries total
    out.u64(size);
    out.u64(start);

    out.u32(ZIP64_LOCATOR_SIG);
    out.u32(0); // disk holding the zip64 end-of-central-directory
    out.u64(zip64EocdOffset);
    out.u32(1); // total number of disks
  }

  out.u32(EOCD_SIG);
  out.u16(0);
  out.u16(0);
  out.u16(Math.min(count, ZIP_FILECOUNT_LIMIT));
  out.u16(Math.min(count, ZIP_FILECOUNT_LIMIT));
  out.u32(Math.min(size, ZIP64_LIMIT));
  out.u32(Math.min(start, ZIP64_LIMIT));
  out.u16(0); // comment length
}

export function buildZip(entries: readonly ZipEntry[]): Bytes {
  const out = new ByteWriter();
  const central: CentralEntry[] = [];

  for (const e of entries) {
    const nameBytes = new TextEncoder().encode(e.name);
    const crc = Bun.hash.crc32(e.data);
    const compress = e.compress ?? true;
    const body = compress ? Bun.deflateSync(e.data, { level: e.level ?? DEFAULT_LEVEL }) : e.data;
    // ZIP requires the stored form never exceed the raw form for method 8 to pay off
    const useDeflate = compress && body.length < e.data.length;
    const payload = useDeflate ? body : e.data;
    const { time, date } = dosDateTime(e.dateTime);

    const entry: CentralEntry = {
      name: nameBytes,
      crc,
      csize: payload.length,
      usize: e.data.length,
      method: useDeflate ? 8 : 0,
      time,
      date,
      mode: e.mode,
      offset: out.length,
      zip64: payload.length > ZIP64_LIMIT || e.data.length > ZIP64_LIMIT,
    };

    writeLocalHeader(out, entry, payload);
    central.push(entry);
  }

  const centralStart = out.length;
  for (const c of central) writeCentralHeader(out, c);
  writeEndRecords(out, central.length, out.length - centralStart, centralStart);

  return out.concat();
}
