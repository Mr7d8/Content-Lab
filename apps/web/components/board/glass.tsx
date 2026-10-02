'use client';

import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { AMBIENT_PURPLE, ambientPalette } from '@/lib/ambient';

// A photo that melts into frosted glass toward the bottom: blur layers of
// growing strength, each masked to a lower band.
export function ProgressiveBlur({ className = '', steps = 4, max = 24 }: { className?: string; steps?: number; max?: number }) {
  const band = 100 / steps;
  return (
    <div aria-hidden className={`pblur ${className}`}>
      {Array.from({ length: steps }, (_, i) => {
        const blur = max / 2 ** (steps - 1 - i);
        const from = i * band;
        const mask = i === steps - 1
          ? `linear-gradient(to bottom, transparent ${from}%, #000 ${from + band}%)`
          : `linear-gradient(to bottom, transparent ${from}%, #000 ${from + band}%, #000 ${from + 2 * band}%, transparent ${Math.min(100, from + 3 * band)}%)`;
        return (
          <i
            key={i}
            style={{ backdropFilter: `blur(${blur}px)`, WebkitBackdropFilter: `blur(${blur}px)`, maskImage: mask, WebkitMaskImage: mask }}
          />
        );
      })}
    </div>
  );
}

// The colored halo under a card: the card's own image, blurred and offset.
// The parent needs `relative isolate`.
export function Glow({ src, className = '' }: { src: string | null; className?: string }) {
  if (!src) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      aria-hidden
      alt=""
      src={src}
      referrerPolicy="no-referrer"
      className={`pointer-events-none absolute -z-10 object-cover opacity-70 blur-2xl saturate-[1.6] ${className}`}
    />
  );
}

const palettes = new Map<string, string[]>();

// The glow colors for a cover: a 3 by 2 grid of it, read once from a tiny
// canvas (see lib/ambient). The purple when there is no cover or it cannot
// be read (no CORS).
function usePalette(src: string | null): string[] {
  const [colors, setColors] = useState<string[]>(() => (src && palettes.get(src)) || [AMBIENT_PURPLE]);
  useEffect(() => {
    if (!src) return setColors([AMBIENT_PURPLE]);
    const known = palettes.get(src);
    if (known) return setColors(known);
    let live = true;
    const done = (out: string[]) => {
      palettes.set(src, out);
      if (live) setColors(out);
    };
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = 3;
        c.height = 2;
        const ctx = c.getContext('2d');
        if (!ctx) throw new Error('no canvas');
        ctx.drawImage(img, 0, 0, 3, 2);
        const d = ctx.getImageData(0, 0, 3, 2).data;
        done(ambientPalette(Array.from({ length: 6 }, (_, i) => [d[i * 4] ?? 0, d[i * 4 + 1] ?? 0, d[i * 4 + 2] ?? 0] as [number, number, number])));
      } catch {
        done([AMBIENT_PURPLE]);
      }
    };
    img.onerror = () => done([AMBIENT_PURPLE]);
    img.src = src;
    return () => {
      live = false;
    };
  }, [src]);
  return colors;
}

const alpha = (hsl: string, a: number) => hsl.replace(')', ` / ${a})`);

// Where each glow color sits: the first behind the title, the others to the
// sides. Wide, slow falloffs keep it soft.
const BLOBS = [
  { at: '40% 34%', size: '52% 78%', a: 0.5 },
  { at: '72% 14%', size: '40% 62%', a: 0.38 },
  { at: '12% 6%', size: '36% 56%', a: 0.32 },
];

// A soft glow at the top of the page, in the selected ad's colors (purple
// when the cover is gray). It fades out before the content below and
// scrolls away with the page.
export function Ambient({ src }: { src: string | null }) {
  const colors = usePalette(src);
  // One color still fills the hero: its echo takes the side spots, fainter.
  const layers = BLOBS.map((b, i) => {
    const c = colors[i] ?? colors[0] ?? AMBIENT_PURPLE;
    const a = colors[i] ? b.a : b.a * 0.6;
    return `radial-gradient(${b.size} at ${b.at}, ${alpha(c, a)} 0%, ${alpha(c, a * 0.45)} 38%, transparent 76%)`;
  });
  return (
    <div
      aria-hidden
      className="ambient pointer-events-none absolute inset-x-0 top-0 z-0 h-[600px] overflow-hidden"
      style={{ maskImage: 'linear-gradient(to bottom, #000 40%, transparent 100%)', WebkitMaskImage: 'linear-gradient(to bottom, #000 40%, transparent 100%)' }}
    >
      <AnimatePresence initial={false}>
        <motion.div
          key={colors.join()}
          className="absolute inset-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.9 }}
          style={{ background: layers.join(', ') }}
        />
      </AnimatePresence>
    </div>
  );
}
