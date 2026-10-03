'use client';

import { useState } from 'react';
import type { BoardAd } from '@/lib/board-view';
import { covers } from '@/lib/cover-loader';

// A stable hue per ad, so a missing cover still has its own color.
function hue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}

// An ad's cover at 9:16. Source links expire, so a broken image falls back to
// a soft gradient with the advertiser's initial.
export function Cover({ ad, className = '' }: { ad: BoardAd; className?: string }) {
  const [broken, setBroken] = useState<string | null>(null);
  const name = ad.advertiser ?? ad.handle ?? '';
  if (!ad.cover || broken === ad.cover) {
    const h = hue(ad.id);
    return (
      <div
        aria-hidden
        className={`flex items-center justify-center text-[13px] font-semibold text-white/90 ${className}`}
        style={{ background: `linear-gradient(160deg, hsl(${h} 75% 72%), hsl(${(h + 50) % 360} 65% 52%))` }}
      >
        {name.charAt(0).toUpperCase() || (
          <svg width="12" height="12" viewBox="0 0 12 12"><path d="M3 1.8v8.4L10 6Z" fill="currentColor" /></svg>
        )}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={ad.cover}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      referrerPolicy="no-referrer"
      // Shown here, so the map can fly it in without fetching it again.
      onLoad={() => covers.loaded(ad.cover as string)}
      onError={() => {
        setBroken(ad.cover);
        covers.loaded(ad.cover as string);
      }}
      className={`object-cover ${className}`}
    />
  );
}
