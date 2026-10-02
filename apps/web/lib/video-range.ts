// The video proxy answers a browser's Range requests a chunk at a time, so no
// response goes over the size limit of a Vercel function (4.5 MB). Media
// elements ask for the next range on their own.

export const CHUNK_BYTES = 3 * 1024 * 1024;

export type ByteRange = { start: number; end: number };

// The bytes to fetch for a Range header: from its start, at most `chunk`
// bytes. No header means the start of the file. null for ranges we do not
// serve (suffix or multiple ranges).
export function chunkRange(header: string | null, chunk = CHUNK_BYTES): ByteRange | null {
  if (!header) return { start: 0, end: chunk - 1 };
  const m = /^bytes=(\d+)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const start = Number(m[1]);
  const asked = m[2] ? Number(m[2]) : Number.POSITIVE_INFINITY;
  if (asked < start) return null;
  return { start, end: Math.min(asked, start + chunk - 1) };
}

// For a source that ignored the Range header and sent the whole file: reads
// the stream up to range.end and returns that slice.
export async function readRange(body: ReadableStream<Uint8Array>, range: ByteRange): Promise<Uint8Array<ArrayBuffer>> {
  const reader = body.getReader();
  const parts: Uint8Array[] = [];
  let seen = 0;
  try {
    while (seen <= range.end) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      seen += value.length;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const all = new Uint8Array(seen);
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.length;
  }
  return all.slice(range.start, Math.min(range.end + 1, seen));
}
