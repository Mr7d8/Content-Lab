import { describe, expect, it, vi } from 'vitest';
import { geminiDecoder, MAX_INLINE_VIDEO_BYTES } from '../src/ai';
import { alignDecodedFrames, DECODE_ESTIMATE_USD, decodeCost, decodeSeconds, type DecodeOutput } from '../src/decode';
import { frame } from './fixtures';

export const decoded = (seconds: number[]): DecodeOutput => ({
  audio_type: 'speech',
  language: 'Darija (Moroccan Arabic)',
  segments: [{ start: 0, end: 2.5, text: 'شوفو هاد الصباط' }, { start: 2.5, end: 8, text: 'غير ب 199 درهم' }],
  frames: seconds.map((s) => frame(s + 0.4, s === 0 ? { faces: 1, people: 1 } : { price: true }, { on_screen_text: s === 0 ? [] : ['199 DH'] })),
  breakdown: {
    summary: 'A creator shows sneakers and the price.',
    product: 'Sneakers',
    hook: { text: 'Look at these shoes', visual: 'Close-up of sneakers held to the camera' },
    beats: [{ start: 0, end: 2.5, role: 'hook', summary: 'Close-up reveal' }, { start: 2.5, end: 8, role: 'offer', summary: 'Price on screen' }],
    cta: null,
    offer: '199 DH',
    why_it_works: 'Product first, price early.',
  },
});

describe('decode timestamps', () => {
  it('covers the opening second by second, then thins long ads to 20 frames', () => {
    expect(decodeSeconds(10)).toEqual([0, 1, 2, 3, 6, 9]);
    const long = decodeSeconds(120);
    expect(long).toHaveLength(20);
    expect(long.slice(0, 4)).toEqual([0, 1, 2, 3]);
    expect(new Set(long).size).toBe(20);
    expect(decodeSeconds(null)).toEqual([0]);
  });

  it('pins frames to the asked seconds and rejects a count mismatch', () => {
    expect(alignDecodedFrames(decoded([0, 3]), [0, 3]).frames.map((f) => f.second)).toEqual([0, 3]);
    expect(() => alignDecodedFrames(decoded([0]), [0, 3])).toThrow('1 frames for 2 timestamps');
  });
});

describe('decode cost', () => {
  it('prices Gemini and Jev tokens', () => {
    expect(decodeCost({ geminiInput: 1_000_000, geminiOutput: 100_000, jevInput: 1_000_000 })).toBeCloseTo(0.3 + 0.25 + 0.042);
    expect(DECODE_ESTIMATE_USD).toBeLessThan(0.02);
  });
});

describe('gemini decoder', () => {
  it('sends the video inline with the timestamps and parses the answer', async () => {
    const fetchImpl = vi.fn(async () => Response.json({
      candidates: [{ content: { parts: [{ text: JSON.stringify(decoded([0, 3])) }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 9000, candidatesTokenCount: 2500 },
    }));
    const decoder = geminiDecoder('AIzaTEST', { model: 'gemini-test', fetchImpl: fetchImpl as unknown as typeof fetch });
    const result = await decoder.decode({ data: new Uint8Array([1, 2, 3]), mimeType: 'video/mp4' }, [0, 3], { source: 'tiktok_creative_center', advertiser: null, caption: 'Promo', durationS: 8 });
    expect(decoder.name).toBe('gemini:gemini-test');
    expect(result.output.frames.map((f) => f.second)).toEqual([0, 3]);
    expect(result.output.breakdown.offer).toBe('199 DH');
    expect([result.inputTokens, result.outputTokens]).toEqual([9000, 2500]);
    const body = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.contents[0].parts[0]).toEqual({ inlineData: { mimeType: 'video/mp4', data: 'AQID' } });
    expect(body.contents[0].parts[1].text).toContain('Timestamps to describe in frames, in order: 0s, 3s.');
    expect(body.generationConfig.responseJsonSchema.properties.breakdown).toBeDefined();
  });

  it('refuses videos too large to send inline, without calling Gemini', async () => {
    const fetchImpl = vi.fn();
    const decoder = geminiDecoder('k', { fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(decoder.decode({ data: new Uint8Array(MAX_INLINE_VIDEO_BYTES + 1), mimeType: 'video/mp4' }, [0], { source: 's', advertiser: null, caption: null, durationS: 1 }))
      .rejects.toThrow(/up to 14 MB/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
