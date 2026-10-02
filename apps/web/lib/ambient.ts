// The page's ambient light: colors read from the selected ad's cover, made
// bright and saturated so a dark or gray cover never turns the page muddy.

// Neon hues used when a sampled color has no real hue (gray, black, white):
// cyan, violet, pink, blue, purple, teal.
export const NEON_HUES = [190, 265, 320, 215, 285, 172] as const;

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === rn ? (gn - bn) / d + (gn < bn ? 6 : 0) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
  return [Math.round(h * 60), s, l];
}

// One vivid color per sampled pixel: the pixel's own hue when it has one,
// else a neon hue; always the same bright lightness, never near black.
export function ambientColors(pixels: [number, number, number][]): string[] {
  return pixels.map(([r, g, b], i) => {
    const [h, s, l] = rgbToHsl(r, g, b);
    const hueless = s < 0.18 || l < 0.1 || l > 0.94;
    const hue = hueless ? NEON_HUES[i % NEON_HUES.length] : h;
    return `hsl(${hue} 92% 66%)`;
  });
}

// When there is no cover to read (no ad, or the image is not readable).
export const DEFAULT_AMBIENT = NEON_HUES.map((h) => `hsl(${h} 92% 66%)`);
