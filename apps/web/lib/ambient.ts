// The glow behind the hero: colors read from the selected ad's cover. Real
// colors keep their hue and get a soft, bright tone; gray, black and white
// become the default purple, so a dull cover never gives a gray glow.

export const AMBIENT_PURPLE = 'hsl(272 88% 74%)';

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

// Up to three glow colors, most colorful first, with hues at least 30
// degrees apart. Only the purple when the cover has no real color.
export function ambientPalette(pixels: [number, number, number][]): string[] {
  const colorful = pixels
    .map(([r, g, b]) => rgbToHsl(r, g, b))
    .filter(([, s, l]) => s >= 0.18 && l >= 0.1 && l <= 0.94)
    .sort((a, b) => b[1] - a[1]);
  const hues: number[] = [];
  for (const [h] of colorful) {
    if (hues.length < 3 && hues.every((x) => Math.min(Math.abs(x - h), 360 - Math.abs(x - h)) >= 30)) hues.push(h);
  }
  return hues.length ? hues.map((h) => `hsl(${h} 85% 72%)`) : [AMBIENT_PURPLE];
}
