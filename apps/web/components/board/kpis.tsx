'use client';

import { motion } from 'motion/react';
import { formatCount } from '@/lib/board-view';

type Stats = { ads: number; decoded: number; formats: number; advertisers: number; medianRank: number | null; medianLikes: number | null };

function Kpi({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="card flex min-w-0 flex-col justify-between gap-3 p-4">
      <p className="mono text-faint">{label}</p>
      <div>
        <p className="text-[30px] font-semibold leading-none tracking-[-0.03em] tabular-nums">{value}</p>
        <p className="mt-1.5 truncate text-xs text-sub">{note}</p>
      </div>
    </div>
  );
}

export function Kpis({ stats, source, decoding }: { stats: Stats; source: string; decoding: number }) {
  const organic = source === 'tiktok_organic';
  const share = stats.ads ? stats.decoded / stats.ads : 0;
  return (
    <section aria-label="Board numbers" className="grid grid-cols-2 gap-3 md:grid-cols-5">
      <div className="tile-dark col-span-2 flex flex-col justify-between gap-4 p-4 md:col-span-1">
        <div className="flex items-center justify-between">
          <p className="mono text-white/55">Decoded</p>
          {decoding > 0 && (
            <span className="mono flex items-center gap-1.5 text-[#64b5ff]">
              <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-[#64b5ff]" />
              {decoding} running
            </span>
          )}
        </div>
        <div>
          <p className="text-[30px] font-semibold leading-none tracking-[-0.03em] tabular-nums">
            {stats.decoded}
            <span className="text-white/40"> / {stats.ads}</span>
          </p>
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/12">
            <motion.div className="h-full rounded-full bg-accent" initial={false} animate={{ width: `${share * 100}%` }} transition={{ type: 'spring', stiffness: 120, damping: 20 }} />
          </div>
          <p className="mt-2 text-xs text-white/55">{stats.formats ? `${stats.formats} formats found` : 'Pick ads to decode'}</p>
        </div>
      </div>
      <Kpi label={organic ? 'Posts' : 'Ads'} value={String(stats.ads)} note="on this board" />
      <Kpi label={organic ? 'Creators' : 'Advertisers'} value={String(stats.advertisers)} note={organic ? 'distinct accounts' : 'named by Creative Center'} />
      <Kpi
        label={organic ? 'Median views' : 'Median CTR'}
        value={organic ? formatCount(stats.medianRank) : stats.medianRank === null ? '–' : stats.medianRank.toFixed(2)}
        note={organic ? 'per post' : 'score from 0 to 1'}
      />
      <Kpi label="Median likes" value={formatCount(stats.medianLikes)} note={organic ? 'per post' : 'per ad'} />
    </section>
  );
}
