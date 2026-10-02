import { describe, expect, it } from 'vitest';
import { AMBIENT_PURPLE, ambientPalette, rgbToHsl } from '../lib/ambient';

describe('ambient palette', () => {
  it('reads hue, saturation and lightness', () => {
    expect(rgbToHsl(255, 0, 0)).toEqual([0, 1, 0.5]);
    expect(rgbToHsl(0, 0, 255)[0]).toBe(240);
    expect(rgbToHsl(128, 128, 128)[1]).toBe(0);
  });

  it('turns a gray, black or white cover into the purple glow', () => {
    expect(ambientPalette([[10, 10, 12], [128, 128, 128], [250, 250, 250], [90, 92, 95]])).toEqual([AMBIENT_PURPLE]);
  });

  it('keeps a colorful cover\'s hues, most colorful first, without near repeats', () => {
    // orange (24), a second orange (20, dropped as a near repeat), blue (223), gray.
    expect(ambientPalette([[120, 60, 20], [200, 90, 40], [40, 90, 220], [128, 128, 128]])).toEqual(['hsl(223 85% 72%)', 'hsl(24 85% 72%)']);
  });
});
