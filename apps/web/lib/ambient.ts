// The glow behind the hero: one color read from the selected ad's cover. A
// real color keeps its hue and gets a soft, bright tone; gray, black and white
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

const gap = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
};

// The one glow color for a cover: the hue that covers the most of it, with
// vivid pixels counting a little more than dull ones. Purple when real color
// covers under a tenth of the cover (gray, black, white, or a small logo).
export function ambientColor(pixels: [number, number, number][]): string {
  const colorful = pixels
    .map(([r, g, b]) => rgbToHsl(r, g, b))
    .filter(([, s, l]) => s >= 0.18 && l >= 0.1 && l <= 0.94);
  if (!colorful.length || colorful.length < pixels.length * 0.1) return AMBIENT_PURPLE;
  // Chroma: how vivid the pixel looks, 0 to 1.
  const weight = ([, s, l]: [number, number, number]) => 0.5 + s * (1 - Math.abs(2 * l - 1));
  let peak = 0;
  let most = -1;
  for (let h = 0; h < 360; h += 10) {
    const w = colorful.reduce((sum, p) => sum + (gap(p[0], h) <= 20 ? weight(p) : 0), 0);
    if (w > most) [peak, most] = [h, w];
  }
  // The weighted mean hue around that peak.
  let x = 0;
  let y = 0;
  for (const p of colorful) {
    if (gap(p[0], peak) > 20) continue;
    const rad = (p[0] * Math.PI) / 180;
    x += weight(p) * Math.cos(rad);
    y += weight(p) * Math.sin(rad);
  }
  const hue = Math.round((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  // Yellow, green and cyan look lighter than other hues at the same tone, so
  // they go a little deeper to show as much on the white page.
  return `hsl(${hue} 85% ${hue >= 35 && hue <= 190 ? 62 : 72}%)`;
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

const luminance = ([r, g, b]: [number, number, number]) => {
  const lin = (c: number) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

export function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

// The page under the title: white with the glow at its strongest (half
// strength, a little more for safety).
const GLOW_PEAK = 0.55;
const INK_DEFAULT = { sub: '#6e6e73', faint: '#86868b' };

// The hero's secondary text over the glow: a dark shade of the glow's own hue,
// the lightest that still reads where the glow is strongest. Sub at 6:1,
// faint at 4.5:1 (both are under 4:1 in plain gray on a bright glow).
export function glowInk(glow: string): { sub: string; faint: string } {
  const m = /^hsl\((\d+(?:\.\d+)?) (\d+(?:\.\d+)?)% (\d+(?:\.\d+)?)%\)$/.exec(glow);
  if (!m) return INK_DEFAULT;
  const hue = Number(m[1]);
  const rgb = hslToRgb(hue, Number(m[2]) / 100, Number(m[3]) / 100);
  const bg = rgb.map((c) => Math.round(255 * (1 - GLOW_PEAK) + c * GLOW_PEAK)) as [number, number, number];
  const shade = (target: number) => {
    for (let l = 60; l >= 10; l--) {
      if (contrast(hslToRgb(hue, 0.2, l / 100), bg) >= target) return `hsl(${hue} 20% ${l}%)`;
    }
    return `hsl(${hue} 20% 10%)`;
  };
  return { sub: shade(6), faint: shade(4.5) };
}
