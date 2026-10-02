'use client';

import type { MarketCheck } from '@content-lab/core';
import type { MarketFilter as Filter } from '@/lib/board-view';

const OPTIONS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'moroccan', label: 'Looks Moroccan' },
  { value: 'unclear', label: 'Unclear' },
  { value: 'elsewhere', label: 'Elsewhere' },
];

// Shows only the ads that look made for Moroccan shoppers, or the others.
export function MarketFilter({ value, counts, onChange }: { value: Filter; counts: Record<Filter, number>; onChange: (f: Filter) => void }) {
  return (
    <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2">
      <p className="mono text-faint">Market</p>
      <div className="segmented max-w-full overflow-x-auto no-scrollbar" role="group" aria-label="Filter by market">
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={value === o.value}
            disabled={o.value !== 'all' && counts[o.value] === 0}
            onClick={() => onChange(o.value)}
            className="disabled:cursor-default disabled:opacity-40"
          >
            {o.label} <span className="tabular-nums opacity-55">{counts[o.value]}</span>
          </button>
        ))}
      </div>
      <p className="text-[12px] text-faint">From the ad text: dirhams, Darija, Moroccan places; decoding adds the speech and on-screen text.</p>
    </div>
  );
}

const DOT = { moroccan: 'bg-green', elsewhere: 'bg-orange', unclear: 'bg-[var(--fill-strong)]' } as const;

// One line in the inspector: the verdict and why.
export function MarketNote({ market, decoded }: { market: MarketCheck; decoded: boolean }) {
  const title = market.verdict === 'moroccan' ? 'Looks Moroccan' : market.verdict === 'elsewhere' ? `Looks made elsewhere${market.elsewhere ? ` · ${market.elsewhere}` : ''}` : 'Market unclear';
  const empty = decoded ? 'Nothing in the text or speech points to a country.' : 'Not enough text to tell. Decoding reads the on-screen text and speech.';
  return (
    <div className="mb-4 flex gap-2.5 border-b border-[var(--line)] pb-3">
      <span className={`mt-[5px] h-2 w-2 shrink-0 rounded-full ${DOT[market.verdict]}`} aria-hidden />
      <div className="min-w-0">
        <p className="text-[13px] font-semibold tracking-tight">{title}</p>
        <p className="mt-0.5 text-[12px] leading-snug text-sub">
          {market.reasons.length
            ? market.reasons.map((r, i) => (
              <span key={r.label}>
                {i > 0 && ' · '}
                {r.label}
                {r.examples.length > 0 && ': '}
                {r.examples.map((w, j) => (
                  <span key={w}>
                    {j > 0 && ', '}
                    <bdi>{w}</bdi>
                  </span>
                ))}
              </span>
            ))
            : empty}
        </p>
      </div>
    </div>
  );
}
