import { describe, expect, it } from 'vitest';
import { AMBIENT_PURPLE, ambientColor, rgbToHsl } from '../lib/ambient';

type Px = [number, number, number];
const many = (px: Px, n: number): Px[] => Array.from({ length: n }, () => px);
const GRAY: Px = [128, 128, 128];

describe('ambient color', () => {
  it('reads hue, saturation and lightness', () => {
    expect(rgbToHsl(255, 0, 0)).toEqual([0, 1, 0.5]);
    expect(rgbToHsl(0, 0, 255)[0]).toBe(240);
    expect(rgbToHsl(128, 128, 128)[1]).toBe(0);
  });

  it('turns a gray, black or white cover into the purple glow', () => {
    expect(ambientColor([[10, 10, 12], GRAY, [250, 250, 250], [90, 92, 95]])).toEqual(AMBIENT_PURPLE);
    expect(ambientColor([])).toEqual(AMBIENT_PURPLE);
  });

  it('keeps the purple when color is only a small logo on gray', () => {
    expect(ambientColor([[230, 30, 30], ...many(GRAY, 19)])).toEqual(AMBIENT_PURPLE);
  });

  it('picks the one color that covers the most of the cover', () => {
    // Blue (223) over most of it, a vivid orange patch, some gray.
    expect(ambientColor([...many([40, 90, 220], 6), ...many([240, 110, 20], 3), ...many(GRAY, 3)])).toBe('hsl(223 85% 72%)');
  });

  it('gives a gold cover a deeper tone so it shows on white', () => {
    expect(ambientColor([...many([217, 168, 58], 8), ...many([166, 120, 201], 3)])).toBe('hsl(42 85% 62%)');
  });

  it('averages a red that sits on both sides of 0 degrees', () => {
    expect(ambientColor([...many([255, 0, 20], 4), ...many([255, 20, 0], 4)])).toBe('hsl(0 85% 72%)');
  });
});
