import { describe, expect, it } from 'vitest';
import { chunkRange, readRange } from '../lib/video-range';

describe('chunkRange', () => {
  it('serves at most one chunk from the asked start', () => {
    expect(chunkRange('bytes=0-', 100)).toEqual({ start: 0, end: 99 });
    expect(chunkRange('bytes=250-', 100)).toEqual({ start: 250, end: 349 });
    expect(chunkRange('bytes=0-1', 100)).toEqual({ start: 0, end: 1 });
    expect(chunkRange('bytes=10-500', 100)).toEqual({ start: 10, end: 109 });
    expect(chunkRange(null, 100)).toEqual({ start: 0, end: 99 });
  });

  it('refuses suffix, multiple and backwards ranges', () => {
    expect(chunkRange('bytes=-500', 100)).toBeNull();
    expect(chunkRange('bytes=0-10, 20-30', 100)).toBeNull();
    expect(chunkRange('bytes=50-10', 100)).toBeNull();
  });
});

describe('readRange', () => {
  const stream = (parts: number[][]) => new ReadableStream<Uint8Array>({
    start(c) {
      for (const p of parts) c.enqueue(new Uint8Array(p));
      c.close();
    },
  });

  it('slices the asked bytes out of a whole-file stream', async () => {
    expect([...(await readRange(stream([[0, 1, 2], [3, 4], [5, 6, 7, 8]]), { start: 2, end: 5 }))]).toEqual([2, 3, 4, 5]);
    expect([...(await readRange(stream([[0, 1, 2]]), { start: 1, end: 10 }))]).toEqual([1, 2]);
    expect(await readRange(stream([[0, 1]]), { start: 5, end: 9 })).toHaveLength(0);
  });
});
