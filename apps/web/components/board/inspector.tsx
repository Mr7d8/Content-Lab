'use client';

import { DECODE_ESTIMATE_USD, labelText, sourceLabel, type BeatRole } from '@content-lab/core';
import { AnimatePresence, motion } from 'motion/react';
import { useRef, useState } from 'react';
import { formatCount, type BoardAd } from '@/lib/board-view';
import { BEAT_COLORS } from '@/lib/colors';
import { Cover } from './cover';

const secs = (s: number) => (s < 10 ? `0:0${Math.floor(s)}` : s < 60 ? `0:${Math.floor(s)}` : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`);

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[10px] bg-[rgba(120,120,128,.07)] px-2.5 py-2">
      <p className="mono text-[9.5px] text-faint">{label}</p>
      <p className="mt-0.5 text-[15px] font-semibold tabular-nums tracking-tight">{value}</p>
    </div>
  );
}

function Media({ ad, video }: { ad: BoardAd; video: React.RefObject<HTMLVideoElement | null> }) {
  const [failed, setFailed] = useState<string | null>(null);
  const playable = ad.video && failed !== ad.video;
  return (
    <div className="relative aspect-[9/16] w-full overflow-hidden rounded-[14px] bg-[#111]">
      {playable ? (
        <video
          ref={video}
          key={ad.id}
          src={ad.video as string}
          poster={ad.cover ?? undefined}
          controls
          playsInline
          loop
          preload="metadata"
          onError={() => setFailed(ad.video)}
          className="h-full w-full object-cover"
        />
      ) : (
        <>
          <Cover ad={ad} className="h-full w-full" />
          <p className="absolute inset-x-2 bottom-2 rounded-[8px] bg-black/55 px-2 py-1.5 text-[11px] leading-snug text-white backdrop-blur-sm">
            The video link expired. Scan again to refresh it; decoding fetches its own copy.
          </p>
        </>
      )}
    </div>
  );
}

function Beats({ ad, onSeek }: { ad: BoardAd; onSeek: (s: number) => void }) {
  const beats = ad.breakdown?.beats ?? [];
  const total = Math.max(ad.durationS ?? 0, ...beats.map((b) => b.end), 1);
  const roles = [...new Set(beats.map((b) => b.role))];
  return (
    <div className="space-y-2.5">
      <div className="flex items-baseline justify-between">
        <p className="mono text-faint">Script beats</p>
        <p className="mono text-faint">{secs(total)}</p>
      </div>
      <div className="flex h-2.5 gap-[2px] overflow-hidden rounded-full" role="img" aria-label={`Beats: ${beats.map((b) => b.role).join(', ')}`}>
        {beats.map((b, i) => (
          <span key={i} style={{ flexGrow: Math.max(0.3, b.end - b.start), background: BEAT_COLORS[b.role as BeatRole] ?? BEAT_COLORS.other }} />
        ))}
      </div>
      <div className="mono flex flex-wrap gap-x-3 gap-y-1 text-faint">
        {roles.map((r) => (
          <span key={r} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: BEAT_COLORS[r as BeatRole] }} />
            {labelText(r)}
          </span>
        ))}
      </div>
      <ol className="space-y-0.5">
        {beats.map((b, i) => (
          <li key={i}>
            <button type="button" onClick={() => onSeek(b.start)} className="group flex w-full gap-3 rounded-[10px] px-2 py-1.5 text-left transition-colors hover:bg-[var(--fill)]">
              <span className="mono w-9 shrink-0 pt-0.5 tabular-nums text-faint group-hover:text-accent">{secs(b.start)}</span>
              <span className="min-w-0 text-[13px] leading-snug">
                <span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: BEAT_COLORS[b.role as BeatRole] ?? BEAT_COLORS.other }} />
                <span className="font-medium">{labelText(b.role)}.</span> <span className="text-sub" dir="auto">{b.summary}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Decoded({ ad, onSeek, onDecode }: { ad: BoardAd; onSeek: (s: number) => void; onDecode: () => void }) {
  const b = ad.breakdown;
  const chips = [ad.labels?.format, ad.labels?.hookType, ad.labels?.structure].filter((v): v is string => !!v);
  return (
    <div className="space-y-5">
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((c, i) => (
            <span key={c} className={`chip !py-1 !text-[11.5px] ${i === 0 ? '!bg-ink !text-white' : ''}`}>{labelText(c)}</span>
          ))}
          {ad.labels?.language && <span className="chip !py-1 !text-[11.5px] uppercase">{ad.labels.language}</span>}
        </div>
      )}
      {b ? (
        <>
          <p className="text-[14px] leading-relaxed" dir="auto">{b.summary}</p>
          <div className="space-y-1.5 rounded-[12px] bg-[rgba(120,120,128,.07)] p-3">
            <p className="mono text-faint">Hook</p>
            <p className="text-[15px] font-semibold leading-snug" dir="auto">“{b.hook.text}”</p>
            <p className="text-[13px] text-sub" dir="auto">{b.hook.visual}</p>
          </div>
          <Beats ad={ad} onSeek={onSeek} />
          {(b.offer || b.cta) && (
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-[12px] bg-[rgba(120,120,128,.07)] p-3">
                <p className="mono text-faint">Offer</p>
                <p className="mt-1 text-[13px] leading-snug" dir="auto">{b.offer ?? 'None stated'}</p>
              </div>
              <div className="rounded-[12px] bg-[rgba(120,120,128,.07)] p-3">
                <p className="mono text-faint">Call to action</p>
                <p className="mt-1 text-[13px] leading-snug" dir="auto">{b.cta ?? 'None stated'}</p>
              </div>
            </div>
          )}
          <div className="rounded-[12px] bg-accent/[.08] p-3">
            <p className="mono text-accent">Why it works</p>
            <p className="mt-1 text-[13.5px] leading-relaxed" dir="auto">{b.why_it_works}</p>
          </div>
        </>
      ) : (
        <p className="text-sm text-sub">This ad was tagged before full decodes existed. Decode it again for the hook, beats and why it works.</p>
      )}
      {ad.transcript && (
        <details className="group">
          <summary className="mono cursor-pointer list-none text-faint hover:text-ink">
            <span className="inline-block transition-transform group-open:rotate-90">›</span> Transcript
          </summary>
          <p className="mt-2 text-[13px] leading-relaxed text-sub" dir="auto">{ad.transcript}</p>
        </details>
      )}
      <button type="button" className="mono text-faint hover:text-accent" onClick={onDecode}>Decode again</button>
    </div>
  );
}

export function Inspector({ ad, rank, total, source, onDecode }: { ad: BoardAd | null; rank: number; total: number; source: string; onDecode: (id: string) => void }) {
  const video = useRef<HTMLVideoElement | null>(null);
  if (!ad) {
    return (
      <aside className="card grid min-h-[300px] place-items-center p-6 text-center">
        <p className="text-sm text-sub">Pick an ad on the map or in the list to see it here.</p>
      </aside>
    );
  }
  const seek = (s: number) => {
    const v = video.current;
    if (!v) return;
    v.currentTime = s;
    void v.play().catch(() => undefined);
  };
  const organic = source === 'tiktok_organic';
  const m = ad.metrics;
  const stats: { label: string; value: string }[] = organic
    ? [
        { label: 'Views', value: formatCount(m.views) },
        { label: 'Likes', value: formatCount(m.likes) },
        { label: 'Shares', value: formatCount(m.shares) },
        { label: 'Length', value: ad.durationS ? `${Math.round(ad.durationS)} s` : '–' },
      ]
    : [
        { label: 'CTR', value: m.ctr === undefined ? '–' : m.ctr.toFixed(2) },
        { label: 'Likes', value: formatCount(m.likes) },
        { label: 'Budget', value: m.costIndex === undefined ? '–' : ['Low', 'Medium', 'High'][m.costIndex] ?? String(m.costIndex) },
        { label: 'Length', value: ad.durationS ? `${Math.round(ad.durationS)} s` : '–' },
      ];

  return (
    <aside aria-label="Inspector" className="card min-w-0 p-4 lg:max-h-[calc(100vh-96px)] lg:overflow-y-auto">
      <div className="mb-3 flex items-center justify-between">
        <p className="mono text-faint">Inspector</p>
        <p className="mono tabular-nums text-faint">#{rank} of {total}</p>
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={ad.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.16 }} className="space-y-5">
          <div className="grid grid-cols-[minmax(0,42%)_minmax(0,1fr)] gap-3">
            <Media ad={ad} video={video} />
            <div className="flex min-w-0 flex-col gap-2.5">
              <div className="min-w-0">
                <p className="truncate text-[15px] font-semibold tracking-tight" dir="auto">{ad.advertiser ?? (ad.handle ? `@${ad.handle}` : 'Unknown advertiser')}</p>
                {ad.caption && <p className="mt-0.5 line-clamp-4 text-[12.5px] leading-snug text-sub" dir="auto">{ad.caption}</p>}
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {stats.map((s) => <Stat key={s.label} {...s} />)}
              </div>
              <a href={ad.sourceUrl} target="_blank" rel="noreferrer" className="mono mt-auto text-accent hover:underline">
                Open in {sourceLabel(ad.source)} ↗
              </a>
            </div>
          </div>

          <div className="border-t border-[var(--line)] pt-4">
            {ad.decode.status === 'none' && (
              <div className="space-y-3 rounded-[14px] bg-[rgba(120,120,128,.06)] p-4">
                <p className="text-[14px] font-semibold tracking-tight">Not decoded yet</p>
                <p className="text-[13px] leading-snug text-sub">
                  One pass over the video: the hook, each script beat, the offer and why it works. About ${DECODE_ESTIMATE_USD.toFixed(2)} and half a minute.
                </p>
                <button type="button" className="btn-primary" onClick={() => onDecode(ad.id)}>
                  <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden><path d="M7 1.5 8.4 5.6 12.5 7 8.4 8.4 7 12.5 5.6 8.4 1.5 7 5.6 5.6Z" fill="currentColor" /></svg>
                  Decode this ad
                </button>
              </div>
            )}
            {ad.decode.status === 'running' && (
              <div className="space-y-2.5" role="status">
                <p className="mono flex items-center gap-2 text-accent">
                  <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-accent" /> Watching the video
                </p>
                <div className="shimmer h-4 w-11/12" />
                <div className="shimmer h-4 w-3/4" />
                <div className="shimmer h-16 w-full" />
                <div className="shimmer h-2.5 w-full rounded-full" />
                <div className="shimmer h-4 w-2/3" />
              </div>
            )}
            {ad.decode.status === 'failed' && (
              <div className="space-y-3 rounded-[14px] bg-red/[.07] p-4">
                <p className="text-[14px] font-semibold text-red">The decode did not finish</p>
                <p className="text-[13px] leading-snug text-sub">{ad.decode.error}</p>
                <button type="button" className="btn-secondary" onClick={() => onDecode(ad.id)}>Try again</button>
              </div>
            )}
            {ad.decode.status === 'done' && <Decoded ad={ad} onSeek={seek} onDecode={() => onDecode(ad.id)} />}
          </div>
        </motion.div>
      </AnimatePresence>
    </aside>
  );
}
