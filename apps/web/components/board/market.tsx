'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { BoardAd, MarketFilter as Filter } from '@/lib/board-view';
import type { GateStatus } from '@/lib/gate';
import { useMarketCheck } from './use-market-check';

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

const VIA: Record<string, string> = { landing: 'landing page', cover: 'cover' };

// The team's call on an ad: Moroccan (its advertiser is followed) or not
// (its advertiser is blocked on Moroccan boards).
function MarketActions({ adId, market }: { adId: string; market: BoardAd['market'] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const mark = (verdict: 'moroccan' | 'elsewhere') =>
    start(async () => {
      setError(null);
      const res = await fetch(`/api/ads/${adId}/market`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ verdict }) }).catch(() => null);
      const body = (await res?.json().catch(() => null)) as { ok: boolean; message?: string } | null;
      if (!body?.ok) setError(body?.message ?? 'Could not save.');
      else router.refresh();
    });
  const isMoroccan = market.manual && market.verdict === 'moroccan';
  const isNot = market.manual && market.verdict === 'elsewhere';
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <button type="button" className={`chip !py-1 !text-[11.5px] ${isMoroccan ? 'active' : ''}`} disabled={pending || isMoroccan} onClick={() => mark('moroccan')} title="Show it on Moroccan boards and follow its advertiser">
        Moroccan
      </button>
      <button type="button" className={`chip !py-1 !text-[11.5px] ${isNot ? 'active' : ''}`} disabled={pending || isNot} onClick={() => mark('elsewhere')} title="Leave it out of Moroccan boards and block its advertiser there">
        Not Moroccan
      </button>
      {pending && <span className="mono text-faint">Saving</span>}
      {error && <span className="text-[11.5px] text-red" role="alert">{error}</span>}
    </div>
  );
}

// One line in the inspector: the verdict, why, and the team's call.
export function MarketNote({ market, decoded, adId }: { market: BoardAd['market']; decoded: boolean; adId?: string }) {
  const title = market.manual
    ? (market.verdict === 'moroccan' ? 'Moroccan' : 'Not Moroccan')
    : market.verdict === 'moroccan' ? 'Looks Moroccan' : market.verdict === 'elsewhere' ? `Looks made elsewhere${market.elsewhere ? ` · ${market.elsewhere}` : ''}` : 'Market unclear';
  const empty = decoded ? 'Nothing in the text or speech points to a country.' : 'Not enough text to tell. Decoding reads the on-screen text and speech.';
  const checked = (market.via ?? []).map((v) => VIA[v]).filter(Boolean);
  return (
    <div className="mb-4 flex gap-2.5 border-b border-[var(--line)] pb-3">
      <span className={`mt-[5px] h-2 w-2 shrink-0 rounded-full ${DOT[market.verdict]}`} aria-hidden />
      <div className="min-w-0">
        <p className="text-[13px] font-semibold tracking-tight">
          {title}
          {market.manual && <span className="mono ml-2 text-faint">Team call</span>}
          {!market.manual && checked.length > 0 && <span className="mono ml-2 text-faint">Checked {checked.join(' + ')}</span>}
        </p>
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
        {adId && <MarketActions adId={adId} market={market} />}
      </div>
    </div>
  );
}

// Moroccan boards: the check's progress, and the ads the gate left out.
export function GateBar({
  boardId,
  gate,
  ads,
  showLeftOut,
  onToggle,
}: {
  boardId: string;
  gate: { pending: number; rejected: number };
  ads: { gate?: GateStatus }[];
  showLeftOut: boolean;
  onToggle: () => void;
}) {
  const check = useMarketCheck(boardId, gate.pending, true);
  const shown = ads.filter((a) => (a.gate ?? 'shown') === 'shown').length;
  return (
    <div className="-mt-3 mb-5 flex flex-wrap items-center gap-x-3 gap-y-2 text-[12.5px] text-sub" role="status">
      <span className="flex items-center gap-1.5 font-medium text-ink">
        <span className="h-2 w-2 rounded-full bg-green" aria-hidden /> Moroccan ads only
      </span>
      <span className="tabular-nums">{shown} shown</span>
      {gate.pending > 0 && (
        <span className="flex items-center gap-1.5 tabular-nums text-accent">
          {check.running && <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-accent" />}
          {gate.pending} {check.running ? 'being checked' : 'waiting for the check'} (landing page, then cover)
        </span>
      )}
      {gate.rejected > 0 && (
        <button type="button" className={`chip !py-1 !text-[11.5px] ${showLeftOut ? 'active' : ''}`} aria-pressed={showLeftOut} onClick={onToggle}>
          {showLeftOut ? `Showing ${gate.rejected} left out` : `${gate.rejected} left out as not Moroccan`}
        </button>
      )}
      {check.error && <span className="text-red" role="alert">{check.error}</span>}
    </div>
  );
}
