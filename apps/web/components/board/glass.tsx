'use client';

import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';

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

const palettes = new Map<string, string[] | null>();

// Six colors from a 3 by 2 grid of the image, read once from a tiny canvas.
// Null when the image cannot be read (no CORS), so the page stays neutral.
function usePalette(src: string | null): string[] | null {
  const [colors, setColors] = useState<string[] | null>(() => (src ? palettes.get(src) ?? null : null));
  useEffect(() => {
    if (!src) return setColors(null);
    if (palettes.has(src)) return setColors(palettes.get(src) ?? null);
    let live = true;
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
        const out: string[] = [];
        for (let i = 0; i < 6; i++) out.push(`rgb(${d[i * 4]} ${d[i * 4 + 1]} ${d[i * 4 + 2]})`);
        palettes.set(src, out);
        if (live) setColors(out);
      } catch {
        palettes.set(src, null);
        if (live) setColors(null);
      }
    };
    img.onerror = () => {
      palettes.set(src, null);
      if (live) setColors(null);
    };
    img.src = src;
    return () => {
      live = false;
    };
  }, [src]);
  return colors;
}

const SPOTS = ['12% 8%', '50% 0%', '88% 10%', '8% 70%', '55% 60%', '95% 75%'];

// The page's ambient color: soft light in the selected ad's colors behind the
// glass. Painted gradients, no live blur, so scrolling stays smooth.
export function Ambient({ src }: { src: string | null }) {
  const colors = usePalette(src);
  const key = colors?.join() ?? 'none';
  return (
    <div aria-hidden className="ambient pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <AnimatePresence initial={false}>
        {colors && (
          <motion.div
            key={key}
            className="absolute inset-0 opacity-50 saturate-[1.6]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.5 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.9 }}
            style={{ background: colors.map((c, i) => `radial-gradient(60% 55% at ${SPOTS[i]}, ${c}, transparent 70%)`).join(', ') }}
          />
        )}
      </AnimatePresence>
      <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_0%,rgba(245,245,247,.1),rgba(245,245,247,.7)_75%)]" />
    </div>
  );
}
