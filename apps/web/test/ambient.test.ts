import { describe, expect, it } from 'vitest';
import { ambientColors, DEFAULT_AMBIENT, NEON_HUES, rgbToHsl } from '../lib/ambient';

describe('ambient colors', () => {
  it('reads hue, saturation and lightness', () => {
    expect(rgbToHsl(255, 0, 0)).toEqual([0, 1, 0.5]);
    expect(rgbToHsl(0, 0, 255)[0]).toBe(240);
    expect(rgbToHsl(128, 128, 128)[1]).toBe(0);
  });

  it('keeps a colorful pixel\'s hue but makes it bright and saturated', () => {
    expect(ambientColors([[120, 60, 20]])).toEqual(['hsl(24 92% 66%)']);
  });

  it('never goes to black or gray: hueless pixels get a neon hue', () => {
    const out = ambientColors([[10, 10, 12], [128, 128, 128], [250, 250, 250]]);
    expect(out).toEqual([`hsl(${NEON_HUES[0]} 92% 66%)`, `hsl(${NEON_HUES[1]} 92% 66%)`, `hsl(${NEON_HUES[2]} 92% 66%)`]);
    expect(DEFAULT_AMBIENT).toHaveLength(6);
  });
});
