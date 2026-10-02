'use client';

import { useState } from 'react';
import { axesFor, formatCount, type BoardAd } from '@/lib/board-view';
import { Cover } from './cover';

const SHOWN = 15;

// The ranked ads as covers. A row that scrolls on narrow screens, a column
// next to the map on wide ones.
export function TopAds({
  ads,
  source,
  selectedId,
  onSelect,
  dimmed,
}: {
  ads: BoardAd[];
  source: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  dimmed: (ad: BoardAd) => boolean;
}) {
  const [all, setAll] = useState(false);
  const { rank } = axesFor(source);
  return (
    <div className="card min-w-0 p-3 lg:col-span-2 xl:col-span-1">
      <div className="mb-2.5 flex items-baseline justify-between px-0.5">
        <p className="mono text-faint">Top {source === 'tiktok_organic' ? 'posts' : 'ads'}</p>
        <p className="mono text-faint">by {rank === 'ctr' ? 'CTR' : 'views'}</p>
      </div>
      <ol className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1 xl:mx-0 xl:grid xl:max-h-[560px] xl:grid-cols-3 xl:overflow-y-auto xl:overflow-x-visible xl:px-0">
        {ads.map((ad, i) => {
          const selected = ad.id === selectedId;
          const value = ad.metrics[rank];
          return (
            <li key={ad.id} className={`w-[76px] shrink-0 xl:w-auto ${!all && i >= SHOWN ? 'xl:hidden' : ''}`}>
              <button
                type="button"
                onClick={() => onSelect(ad.id)}
                aria-pressed={selected}
                aria-label={`#${i + 1} ${ad.advertiser ?? ad.handle ?? 'Unknown advertiser'}, ${rank === 'ctr' ? 'CTR' : 'views'} ${formatCount(value)}`}
                className={`group relative block aspect-[9/16] w-full overflow-hidden rounded-[10px] bg-fill transition-[opacity,box-shadow,transform] duration-200 hover:-translate-y-0.5 ${
                  selected ? 'shadow-[0_0_0_2px_var(--paper),0_0_0_4px_var(--accent)]' : ''
                } ${dimmed(ad) ? 'opacity-25' : ''}`}
              >
                <Cover ad={ad} className="absolute inset-0 h-full w-full" gray={ad.decode.status !== 'done'} />
                <span className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/70 to-transparent" />
                <span className="mono absolute left-1.5 top-1.5 rounded-full bg-black/45 px-1.5 py-0.5 text-[9.5px] text-white backdrop-blur-sm">#{i + 1}</span>
                {ad.decode.status === 'done' && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-accent shadow-[0_0_0_2px_rgba(255,255,255,.8)]" aria-hidden />}
                {ad.decode.status === 'running' && <span className="pulse-dot absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-white" aria-hidden />}
                <span className="mono absolute inset-x-1.5 bottom-1.5 text-left text-[10px] tabular-nums text-white">{formatCount(value)}</span>
              </button>
            </li>
          );
        })}
      </ol>
      {ads.length > SHOWN && (
        <button type="button" className="chip mt-2 hidden w-full justify-center xl:flex" onClick={() => setAll((a) => !a)}>
          {all ? 'Show fewer' : `Show all ${ads.length}`}
        </button>
      )}
    </div>
  );
}
