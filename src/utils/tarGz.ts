/**
 * Zero-dependency POSIX ustar tar writer/reader + gzip codec.
 *
 * Archive creation happens in the browser (Package 3 §3.1): the VPS stays
 * light, and the plaintext tree must be readable by plain `tar` on any machine.
 *
 * 512-byte headers: name(100) mode(8) uid(8) gid(8) size(12) mtime(12)
 * chksum(8) typeflag(1) linkname(100) magic(6) version(2) uname(32) gname(32)
 * devmajor(8) devminor(8) prefix(155) pad(12). File content padded to 512-byte
 * blocks; the archive ends with two zero blocks.
 *
 * gzip via native CompressionStream('gzip')/DecompressionStream('gzip') —
 * with a Node zlib fallback for vitest environments without browser globals.
 */

export interface TarEntry {
  path: string;
  data: Uint8Array;
  mtime?: number;
}

// ---------------------------------------------------------------------------
// path sanitization
// ---------------------------------------------------------------------------

/**
 * Tar paths must be relative and safe to write anywhere: no `..`, no absolute
 * paths, no backslashes (Windows-style separators are rejected on import —
 * the plaintext tree is POSIX). Returns the sanitized path unchanged.
 */
export function sanitizeTarPath(path: string): string {
  if (typeof path !== 'string' || path.length === 0) {
    throw new Error(`Invalid tar entry path: ${JSON.stringify(path)}`);
  }
  if (path.includes('\\')) {
    throw new Error(`Backslashes not allowed in tar entry path: ${path}`);
  }
  if (path.startsWith('/')) {
    throw new Error(`Absolute paths not allowed in tar entry path: ${path}`);
  }
  const parts = path.split('/');
  if (parts.some((p) => p === '..')) {
    throw new Error(`Path traversal not allowed in tar entry path: ${path}`);
  }
  return parts.join('/');
}

// ---------------------------------------------------------------------------
// low-level helpers
// ---------------------------------------------------------------------------

const enc = new TextEncoder();
const dec = new TextDecoder();

function encodeUtf8(str: string): Uint8Array {
  return enc.encode(str);
}

function decodeUtf8(bytes: Uint8Array): string {
  return dec.decode(bytes);
}

/** Zero-padded octal string of exactly `digits` digits. Throws on overflow. */
function octal(value: number, digits: number): string {
  if (value < 0) throw new Error(`Negative octal value: ${value}`);
  const str = value.toString(8);
  if (str.length > digits) throw new Error(`Value ${value} does not fit in ${digits} octal digits`);
  return str.padStart(digits, '0');
}

/** Write a string into a fixed-size header field; the rest stays zero-filled. */
function writeField(header: Uint8Array, offset: number, length: number, str: string): void {
  const bytes = encodeUtf8(str);
  if (bytes.length > length) {
    throw new Error(`Header field too long (${bytes.length} > ${length}): ${str}`);
  }
  header.set(bytes, offset);
}

/** Read a null-terminated (or space-padded) string from a header field. */
function readField(header: Uint8Array, offset: number, length: number): string {
  const raw = header.subarray(offset, offset + length);
  const nul = raw.indexOf(0);
  const end = nul === -1 ? raw.length : nul;
  return decodeUtf8(raw.subarray(0, end));
}

function padTo512(data: Uint8Array): Uint8Array {
  const remainder = data.length % 512;
  if (remainder === 0) return data;
  const padded = new Uint8Array(data.length + 512 - remainder);
  padded.set(data);
  return padded;
}

function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function isZeroBlock(block: Uint8Array): boolean {
  for (let i = 0; i < block.length; i++) {
    if (block[i] !== 0) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// tar writer
// ---------------------------------------------------------------------------

export function createTar(entries: TarEntry[]): Uint8Array {
  const blocks: Uint8Array[] = [];
  for (const entry of entries) {
    const path = sanitizeTarPath(entry.path);
    const data = entry.data ?? new Uint8Array(0);
    const mtime = entry.mtime ?? 0;

    const header = new Uint8Array(512);
    writeField(header, 0, 100, path); // name
    writeField(header, 100, 8, '0000644\0'); // mode
    writeField(header, 108, 8, '0000000\0'); // uid
    writeField(header, 116, 8, '0000000\0'); // gid
    writeField(header, 124, 12, octal(data.length, 11) + '\0'); // size
    writeField(header, 136, 12, octal(mtime, 11) + '\0'); // mtime
    writeField(header, 148, 8, '        '); // chksum: 8 spaces while computing
    header[156] = '0'.charCodeAt(0); // typeflag: regular file
    writeField(header, 257, 6, 'ustar\0'); // magic
    writeField(header, 263, 2, '00'); // version
    // uname/gname/devmajor/devminor/prefix/linkname: zero-filled

    let sum = 0;
    for (let i = 0; i < 512; i++) sum += header[i];
    // 6 octal digits + NUL + space (8 bytes total)
    writeField(header, 148, 8, octal(sum, 6) + '\0 ');

    blocks.push(header);
    blocks.push(padTo512(data));
  }
  // two zero blocks end the archive
  blocks.push(new Uint8Array(512));
  blocks.push(new Uint8Array(512));
  return concat(blocks);
}

// ---------------------------------------------------------------------------
// tar reader
// ---------------------------------------------------------------------------

export function parseTar(bytes: Uint8Array): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;
  while (offset + 512 <= bytes.length) {
    const block = bytes.subarray(offset, offset + 512);
    if (isZeroBlock(block)) break; // zero block = end of archive

    const name = readField(block, 0, 100);
    const prefix = readField(block, 345, 155);
    const sizeStr = readField(block, 124, 12).trim();
    const mtimeStr = readField(block, 136, 12).trim();
    const size = parseInt(sizeStr, 8);
    const mtime = parseInt(mtimeStr, 8);
    const typeflag = String.fromCharCode(block[156]);

    const fullPath = prefix ? `${prefix}/${name}` : name;
    const path = sanitizeTarPath(fullPath);

    offset += 512;
    if (typeflag === '0' || typeflag === '\0') {
      const data = bytes.slice(offset, offset + size);
      entries.push({ path, data, mtime: Number.isFinite(mtime) ? mtime : undefined });
    }
    // skip content (padded to 512) for regular files; other types carry no content
    offset += Math.ceil(size / 512) * 512;
  }
  return entries;
}

// ---------------------------------------------------------------------------
// gzip codec (browser native, Node zlib fallback)
// ---------------------------------------------------------------------------

async function compressGzip(data: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream !== 'undefined') {
    const stream = new Blob([data as unknown as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  }
  // Node fallback (vitest environments without browser globals)
  const zlib = await import(/* @vite-ignore */ 'node:zlib');
  return zlib.gzipSync(data);
}

async function decompressGzip(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'undefined') {
    const stream = new Blob([data as unknown as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  }
  const zlib = await import(/* @vite-ignore */ 'node:zlib');
  return zlib.gunzipSync(data);
}

export async function createTarGz(entries: TarEntry[]): Promise<Uint8Array> {
  return compressGzip(createTar(entries));
}

export async function parseTarGz(bytes: Uint8Array): Promise<TarEntry[]> {
  return parseTar(await decompressGzip(bytes));
}
