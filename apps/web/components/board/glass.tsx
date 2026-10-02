'use client';

import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { AMBIENT_PURPLE, ambientColor } from '@/lib/ambient';

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

const colors = new Map<string, string>();
const GRID = 16;

// The glow color for a cover, read once from a 16 by 16 copy of it on a
// canvas (see lib/ambient). The purple when there is no cover or it cannot
// be read (no CORS).
export function useCoverColor(src: string | null): string {
  const [color, setColor] = useState<string>(() => (src && colors.get(src)) || AMBIENT_PURPLE);
  useEffect(() => {
    if (!src) return setColor(AMBIENT_PURPLE);
    const known = colors.get(src);
    if (known) return setColor(known);
    let live = true;
    const done = (out: string) => {
      colors.set(src, out);
      if (live) setColor(out);
    };
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = GRID;
        c.height = GRID;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error('no canvas');
        ctx.drawImage(img, 0, 0, GRID, GRID);
        const d = ctx.getImageData(0, 0, GRID, GRID).data;
        done(ambientColor(Array.from({ length: GRID * GRID }, (_, i) => [d[i * 4] ?? 0, d[i * 4 + 1] ?? 0, d[i * 4 + 2] ?? 0] as [number, number, number])));
      } catch {
        done(AMBIENT_PURPLE);
      }
    };
    img.onerror = () => done(AMBIENT_PURPLE);
    img.src = src;
    return () => {
      live = false;
    };
  }, [src]);
  return color;
}

const alpha = (hsl: string, a: number) => hsl.replace(')', ` / ${a})`);

// One color: a strong pool that drifts along the hero text (see .ambient-drift)
// and two faint, still echoes toward the corners. Wide, slow falloffs keep it
// blurry.
const ECHOES = [
  { at: '72% 14%', size: '40% 62%', a: 0.23 },
  { at: '12% 6%', size: '36% 56%', a: 0.19 },
];
// The pool's shape, as a share of the content width and the glow's height,
// and where its center starts: under the start of the scan line. Short
// enough to fade out above the bottom of the glow on its own: a mask would
// make the browser redraw the glow on every frame of the drift.
const POOL = { w: 52, h: 60, x: 15, y: 32, a: 0.5 };

const pool = (color: string, a: number) => `${alpha(color, a)} 0%, ${alpha(color, a * 0.45)} 38%, transparent 76%`;

// A soft glow at the top of the page in the selected ad's main color (purple
// when the cover is gray; see useCoverColor). It fades out before the content
// below and scrolls away with the page. A new color fades in over the old
// one while the pool keeps moving.
export function Ambient({ color }: { color: string }) {
  const echoes = ECHOES.map((b) => `radial-gradient(${b.size} at ${b.at}, ${pool(color, b.a)})`).join(', ');
  const fade = { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.9 } };
  return (
    <div aria-hidden className="ambient pointer-events-none absolute inset-x-0 top-0 z-0 h-[600px] overflow-hidden">
      <AnimatePresence initial={false}>
        <motion.div key={color} className="absolute inset-0" {...fade} style={{ background: echoes }} />
      </AnimatePresence>
      {/* Placed against the page's content column, so it lines up with the text at any width. */}
      <div className="relative mx-auto h-full max-w-[1440px]">
        <div
          className="ambient-drift absolute"
          style={{ left: `${POOL.x - POOL.w}%`, top: `${POOL.y - POOL.h}%`, width: `${2 * POOL.w}%`, height: `${2 * POOL.h}%` }}
        >
          <AnimatePresence initial={false}>
            <motion.div key={color} className="absolute inset-0" {...fade} style={{ background: `radial-gradient(closest-side, ${pool(color, POOL.a)})` }} />
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
