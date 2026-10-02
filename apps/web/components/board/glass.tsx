'use client';

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

// One soft purple glow at the top of the page, behind the hero and the top
// cards, fading out before the content below. It scrolls away with the page.
export function Ambient() {
  return (
    <div aria-hidden className="ambient pointer-events-none absolute inset-x-0 top-0 z-0 h-[560px] overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(42%_75%_at_82%_8%,hsl(272_88%_74%/.42),transparent_72%),radial-gradient(60%_60%_at_45%_-10%,hsl(272_88%_80%/.22),transparent_75%)]" />
    </div>
  );
}
