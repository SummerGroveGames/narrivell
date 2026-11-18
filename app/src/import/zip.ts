/**
 * A small, defensive reader for .zip containers (a .docx is a zip).
 * Imported files are untrusted: sizes and counts are limited, encrypted
 * and ZIP64 archives are refused, and decompression stops as soon as an
 * entry grows past its limit (so a "zip bomb" can't exhaust memory).
 * Uses the platform's own DecompressionStream – no extra dependency.
 */

export const ZIP_LIMITS = {
  fileBytes: 60 * 1024 * 1024,
  entries: 5000,
  entryBytes: 80 * 1024 * 1024,
};

export class ImportError extends Error {}

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

interface Entry {
  name: string;
  method: number;
  compressed: number;
  size: number;
  offset: number;
  flags: number;
}

function centralDirectory(bytes: Uint8Array): Entry[] {
  if (bytes.length > ZIP_LIMITS.fileBytes) throw new ImportError('That file is too large to import.');
  // End-of-central-directory record: within the last 64 KB + 22 bytes.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (u32(bytes, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ImportError('This isn’t a Word (.docx) file, or it is damaged.');
  const count = u16(bytes, eocd + 10);
  const cdOffset = u32(bytes, eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) throw new ImportError('This file uses a format Narrivell can’t read (ZIP64).');
  if (count > ZIP_LIMITS.entries) throw new ImportError('This file has too many parts to import.');

  const entries: Entry[] = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length || u32(bytes, p) !== 0x02014b50) throw new ImportError('This file is damaged.');
    const flags = u16(bytes, p + 8);
    const method = u16(bytes, p + 10);
    const compressed = u32(bytes, p + 20);
    const size = u32(bytes, p + 24);
    const nameLen = u16(bytes, p + 28);
    const extraLen = u16(bytes, p + 30);
    const commentLen = u16(bytes, p + 32);
    const offset = u32(bytes, p + 42);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    entries.push({ name, method, compressed, size, offset, flags });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function inflateRaw(data: Uint8Array, limit: number): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      throw new ImportError('A part of this file is far too large – it may be damaged.');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** Reads the named entries (missing ones are left out of the result). */
export async function readZipEntries(bytes: Uint8Array, names: string[]): Promise<Map<string, Uint8Array>> {
  const entries = centralDirectory(bytes);
  const out = new Map<string, Uint8Array>();
  for (const e of entries) {
    if (!names.includes(e.name)) continue;
    if (e.flags & 1) throw new ImportError('This file is password-protected. Remove the password in Word and try again.');
    if (e.size > ZIP_LIMITS.entryBytes) throw new ImportError('This document is too large to import.');
    const h = e.offset;
    if (h + 30 > bytes.length || u32(bytes, h) !== 0x04034b50) throw new ImportError('This file is damaged.');
    const start = h + 30 + u16(bytes, h + 26) + u16(bytes, h + 28);
    const data = bytes.subarray(start, start + e.compressed);
    if (data.length !== e.compressed) throw new ImportError('This file is cut short or damaged.');
    if (e.method === 0) out.set(e.name, data.slice());
    else if (e.method === 8) out.set(e.name, await inflateRaw(data, ZIP_LIMITS.entryBytes));
    else throw new ImportError('This file uses a compression method Narrivell can’t read.');
  }
  return out;
}
