import { describe, expect, it } from 'vitest';
import { joinOnScreenText, keyframeSeconds, VisionOutput } from '../src/vision';

const frame = (second: number, text: string[]) => ({
  second,
  description: 'A hand holds sneakers',
  on_screen_text: text,
  cta_text: null,
  elements: { app_ui: false, product: true, price: false, offer: false, logo: false, cta: false, subtitles: false, faces: 0, people: 0 },
});

describe('keyframeSeconds', () => {
  it('takes 0 to 3 s every second, then every 3 s', () => {
    expect(keyframeSeconds(15)).toEqual([0, 1, 2, 3, 6, 9, 12]);
    expect(keyframeSeconds(15.5)).toEqual([0, 1, 2, 3, 6, 9, 12, 15]);
  });

  it('handles very short and invalid durations', () => {
    expect(keyframeSeconds(2.2)).toEqual([0, 1, 2]);
    expect(keyframeSeconds(0)).toEqual([0]);
    expect(keyframeSeconds(Number.NaN)).toEqual([0]);
  });
});

describe('vision output', () => {
  it('validates frames', () => {
    expect(VisionOutput.safeParse({ frames: [frame(0, ['-50%'])] }).success).toBe(true);
    expect(VisionOutput.safeParse({ frames: [] }).success).toBe(false);
  });

  it('joins on-screen text in frame order without repeats', () => {
    const text = joinOnScreenText([frame(3, ['Livraison gratuite']), frame(0, ['-50%', ' ']), frame(1, ['-50%'])]);
    expect(text).toBe('-50%\nLivraison gratuite');
  });
});
