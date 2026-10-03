'use client';

import { motion } from 'motion/react';
import { useState } from 'react';
import { axesFor, formatMetric, groupAds, metricWord, type BoardAd, type GroupKey } from '@/lib/board-view';
import { Cover } from './cover';

const TABS: { key: GroupKey; label: string }[] = [
  { key: 'format', label: 'Format' },
  { key: 'hook', label: 'Hook' },
  { key: 'advertiser', label: 'Advertiser' },
  { key: 'length', label: 'Length' },
];

// "Which formats win?": the median ranking number per group, one accent bar
// each, with the group's strongest ads beside it.
export function WhichWins({
  ads,
  source,
  onSelect,
  onFilter,
  filter,
  onDecodeTop,
  canDecode,
}: {
  ads: BoardAd[];
  source: string;
  onSelect: (id: string) => void;
  onFilter: (format: string | null) => void;
  filter: string | null;
  onDecodeTop: () => void;
  canDecode: boolean;
}) {
  const [by, setBy] = useState<GroupKey>('format');
  const { rank } = axesFor(source);
  const groups = groupAds(ads, source, by).slice(0, 10);
  const top = Math.max(...groups.map((g) => g.median ?? 0), 0) || 1;
  const metric = metricWord(rank);
  const needsDecode = (by === 'format' || by === 'hook') && !groups.length;

  return (
    <section className="panel p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="mono text-faint">Patterns</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight">Which {by === 'format' ? 'formats' : by === 'hook' ? 'hooks' : by === 'advertiser' ? 'advertisers' : 'lengths'} win?</h2>
          <p className="mt-1 text-sm text-sub">
            Median {metric} per group{by === 'format' || by === 'hook' ? ', decoded ads only' : ''}. Best first.
          </p>
        </div>
        <div className="segmented" role="tablist" aria-label="Group by">
          {TABS.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={by === t.key} onClick={() => setBy(t.key)}>{t.label}</button>
          ))}
        </div>
      </div>

      {needsDecode ? (
        <div className="mt-5 flex flex-col items-start gap-3 rounded-[18px] bg-white/55 p-5 shadow-[var(--glass-rim)] sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-sub">Formats and hooks come from decoding. Decode a few ads and the winners show up here.</p>
          <button type="button" className="btn-primary" onClick={onDecodeTop} disabled={!canDecode}>Decode the top 10</button>
        </div>
      ) : (
        <ol className="mt-5 space-y-1">
          {groups.map((g, i) => {
            const active = by === 'format' && filter === g.key;
            return (
              <li key={g.key}>
                <div
                  className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 rounded-[12px] px-2 py-2 transition-colors sm:grid-cols-[180px_minmax(0,1fr)_auto] ${
                    active ? 'bg-accent/[.1]' : 'hover:bg-white/60'
                  }`}
                >
                  <button
                    type="button"
                    className="col-start-1 row-start-1 min-w-0 text-left"
                    onClick={() => (by === 'format' ? onFilter(active ? null : g.key) : g.top[0] && onSelect(g.top[0].id))}
                    aria-pressed={by === 'format' ? active : undefined}
                  >
                    <span className="block truncate text-[14px] font-medium" dir="auto">{g.label}</span>
                    <span className="mono text-faint">{g.count} {g.count === 1 ? 'ad' : 'ads'}</span>
                  </button>
                  <div className="col-span-2 col-start-1 row-start-2 flex items-center gap-3 sm:col-span-1 sm:col-start-2 sm:row-start-1">
                    <div className="h-7 flex-1 overflow-hidden rounded-full bg-[rgba(120,120,128,.08)] shadow-[inset_0_1px_2px_rgba(0,0,0,.05)]">
                      <motion.div
                        className="h-full rounded-full bg-[linear-gradient(90deg,#0a84ff,#5e5ce6)] shadow-[inset_0_1px_0_rgba(255,255,255,.35)]"
                        style={{ opacity: i === 0 ? 1 : 0.45 }}
                        initial={{ width: 0 }}
                        animate={{ width: `${((g.median ?? 0) / top) * 100}%` }}
                        transition={{ type: 'spring', stiffness: 140, damping: 22, delay: i * 0.03 }}
                      />
                    </div>
                    <span className="mono w-12 text-right text-[11px] tabular-nums text-ink">
                      {formatMetric(rank, g.median)}
                    </span>
                  </div>
                  <div className="col-start-2 row-start-1 flex w-[83px] justify-end gap-1 sm:col-start-3">
                    {g.top.map((ad) => (
                      <button
                        key={ad.id}
                        type="button"
                        onClick={() => onSelect(ad.id)}
                        aria-label={`Open ${ad.advertiser ?? ad.handle ?? 'ad'}`}
                        className="h-[44px] w-[25px] overflow-hidden rounded-[6px] bg-fill shadow-[0_0_0_1.5px_#fff,0_3px_8px_rgba(0,0,0,.18)] transition-transform hover:-translate-y-0.5"
                      >
                        <Cover ad={ad} className="h-full w-full" />
                      </button>
                    ))}
                  </div>
                </div>
              </li>
            );
          })}
          {!groups.length && <li className="py-6 text-center text-sm text-sub">Nothing to group yet.</li>}
        </ol>
      )}
    </section>
  );
}
