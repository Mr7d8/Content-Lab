'use client';

import { motion } from 'motion/react';
import { axesFor, formatMetric, metricWord } from '@/lib/board-view';

type Stats = { ads: number; decoded: number; formats: number; advertisers: number; medianRank: number | null; medianOther: number | null };

function Kpi({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="panel flex min-w-0 flex-col justify-between gap-3 p-4">
      <p className="mono text-faint">{label}</p>
      <div>
        <p className="text-[30px] font-semibold leading-none tracking-[-0.03em] tabular-nums">{value}</p>
        <p className="mt-1.5 truncate text-xs text-sub">{note}</p>
      </div>
    </div>
  );
}

export function Kpis({ stats, source, decoding, cover }: { stats: Stats; source: string; decoding: number; cover: string | null }) {
  const organic = source === 'tiktok_organic';
  const meta = source === 'meta_ad_library';
  const { rank, other } = axesFor(source);
  const share = stats.ads ? stats.decoded / stats.ads : 0;
  return (
    <section aria-label="Board numbers" className="grid grid-cols-2 gap-3 md:grid-cols-5">
      <div className="tile-dark relative isolate col-span-2 flex flex-col justify-between gap-4 overflow-hidden p-4 md:col-span-1">
        {cover && (
          <div aria-hidden className="absolute inset-[-30%] -z-10 opacity-60" style={{ backgroundImage: `url("${cover}")`, backgroundSize: 'cover', backgroundPosition: 'center', filter: 'blur(36px) saturate(1.8)' }} />
        )}
        <div aria-hidden className="absolute inset-0 -z-10 bg-[linear-gradient(160deg,rgba(29,29,31,.55),rgba(29,29,31,.85))]" />
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
      <Kpi label={organic ? 'Creators' : 'Advertisers'} value={String(stats.advertisers)} note={organic ? 'distinct accounts' : meta ? 'Facebook pages' : 'named by Creative Center'} />
      <Kpi
        label={`Median ${metricWord(rank)}`}
        value={formatMetric(rank, stats.medianRank)}
        note={organic ? 'per post' : meta ? 'since the ad started' : 'score from 0 to 1'}
      />
      <Kpi label={`Median ${metricWord(other)}`} value={formatMetric(other, stats.medianOther)} note={organic ? 'per post' : meta ? 'of the same ad running' : 'per ad'} />
    </section>
  );
}
