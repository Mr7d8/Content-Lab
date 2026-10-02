'use client';

import { useState } from 'react';
import type { BoardAd } from '@/lib/board-view';

// An ad's cover at 9:16. Source links expire, so a broken image falls back to
// a quiet placeholder with the advertiser's initial.
export function Cover({ ad, className = '', gray = false }: { ad: BoardAd; className?: string; gray?: boolean }) {
  const [broken, setBroken] = useState<string | null>(null);
  const name = ad.advertiser ?? ad.handle ?? '';
  if (!ad.cover || broken === ad.cover) {
    return (
      <div
        aria-hidden
        className={`flex items-center justify-center bg-[linear-gradient(160deg,#ececf0,#d6d6db)] text-[11px] font-semibold text-faint ${className}`}
      >
        {name.charAt(0).toUpperCase() || '▶'}
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
      onError={() => setBroken(ad.cover)}
      className={`object-cover transition-[filter,opacity] duration-300 ${gray ? 'grayscale' : ''} ${className}`}
    />
  );
}
