'use client';

import { DECODE_ESTIMATE_USD, labelText, sourceLabel, type BeatRole } from '@content-lab/core';
import { AnimatePresence, motion } from 'motion/react';
import { useRef, useState } from 'react';
import { formatCount, type BoardAd } from '@/lib/board-view';
import { BEAT_COLORS } from '@/lib/colors';
import { clock, craftOf, frameRows } from '@/lib/frame-view';
import { Cover } from './cover';
import { CraftPanel, FrameByFrame } from './frames';
import { Glow, ProgressiveBlur } from './glass';
import { useAdDetail } from './use-ad-detail';

const Sparkle = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden><path d="M7 1.5 8.4 5.6 12.5 7 8.4 8.4 7 12.5 5.6 8.4 1.5 7 5.6 5.6Z" fill="currentColor" /></svg>
);

function statsFor(ad: BoardAd, source: string): { label: string; value: string }[] {
  const m = ad.metrics;
  const length = { label: 'Length', value: ad.durationS ? `${Math.round(ad.durationS)} s` : '–' };
  return source === 'tiktok_organic'
    ? [{ label: 'Views', value: formatCount(m.views) }, { label: 'Likes', value: formatCount(m.likes) }, length]
    : [{ label: 'CTR', value: m.ctr === undefined ? '–' : m.ctr.toFixed(2) }, { label: 'Likes', value: formatCount(m.likes) }, length];
}

// The ad as a full-bleed card: video or cover, with name, caption, numbers and
// the main action on a frosted band at the bottom.
function MediaCard({
  ad,
  rank,
  total,
  source,
  video,
  onDecode,
}: {
  ad: BoardAd;
  rank: number;
  total: number;
  source: string;
  video: React.RefObject<HTMLVideoElement | null>;
  onDecode: () => void;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const playable = !!ad.video && failed !== ad.video;
  const toggle = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => undefined);
    else v.pause();
  };
  const status = ad.decode.status;
  const name = ad.advertiser ?? (ad.handle ? `@${ad.handle}` : 'Unknown advertiser');

  return (
    <div className="relative isolate px-1 pb-3">
      <Glow src={ad.cover} className="left-8 top-12 h-[calc(100%-40px)] w-[calc(100%-64px)]" />
      <div className="relative aspect-[9/14] max-h-[74vh] w-full overflow-hidden rounded-[30px] bg-[#111] shadow-[0_0_0_1px_rgba(255,255,255,.25),0_28px_50px_-24px_rgba(0,0,0,.55)]">
        {playable ? (
          <video
            ref={video}
            key={ad.id}
            src={ad.video as string}
            poster={ad.cover ?? undefined}
            autoPlay
            muted={muted}
            loop
            playsInline
            preload="metadata"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onError={() => setFailed(ad.video)}
            onClick={toggle}
            className="absolute inset-0 h-full w-full cursor-pointer object-cover"
          />
        ) : (
          <Cover ad={ad} className="absolute inset-0 h-full w-full" />
        )}
        {/* Only the band under the name, numbers and buttons is frosted. */}
        <ProgressiveBlur className="top-[56%]" steps={4} max={24} />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[50%] bg-gradient-to-t from-black/75 via-black/35 to-transparent" />

        <div className="absolute inset-x-3 top-3 flex items-start justify-between gap-2">
          <span className="liquid-dark mono rounded-full px-2.5 py-1 text-[10px] tabular-nums">#{rank} of {total}</span>
          <div className="flex items-center gap-1.5">
            {status === 'running' && (
              <span className="liquid-dark mono flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px]">
                <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-white" /> Decoding
              </span>
            )}
            {playable && (
              <button type="button" onClick={() => setMuted((m) => !m)} aria-label={muted ? 'Sound on' : 'Sound off'} className="liquid-dark grid h-8 w-8 place-items-center rounded-full">
                {muted ? (
                  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden><path d="M2 6h2.5L8 3v10L4.5 10H2Z" fill="currentColor" /><path d="m11 6 4 4m0-4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden><path d="M2 6h2.5L8 3v10L4.5 10H2Z" fill="currentColor" /><path d="M10.5 5.5a3.5 3.5 0 0 1 0 5M12.5 3.5a6.3 6.3 0 0 1 0 9" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" /></svg>
                )}
              </button>
            )}
          </div>
        </div>
        {!playable && (
          <p className="liquid-dark absolute inset-x-3 top-14 rounded-[14px] px-3 py-2 text-[11.5px] leading-snug">
            The video link expired. Scan again to play it here; decoding fetches its own copy.
          </p>
        )}
        <AnimatePresence>
          {playable && !playing && (
            <motion.button
              type="button"
              aria-label="Play"
              onClick={toggle}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className="liquid-dark absolute left-1/2 top-[34%] grid h-14 w-14 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full"
            >
              <svg width="18" height="18" viewBox="0 0 12 12" aria-hidden><path d="M3.5 1.8v8.4L10.5 6Z" fill="currentColor" /></svg>
            </motion.button>
          )}
        </AnimatePresence>

        <div className="absolute inset-x-0 bottom-0 space-y-3.5 p-5 text-white">
          <div>
            <p className="flex items-center gap-2 text-[21px] font-semibold leading-tight tracking-tight" dir="auto">
              <span className="truncate">{name}</span>
              {status === 'done' && (
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent shadow-[0_0_0_2px_rgba(255,255,255,.25)]" aria-label="Decoded">
                  <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden><path d="m2.5 6.2 2.3 2.3 4.7-5" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </span>
              )}
            </p>
            {ad.caption && <p className="mt-1.5 line-clamp-2 text-[13.5px] leading-snug text-white/80" dir="auto">{ad.caption}</p>}
          </div>
          <div className="grid grid-cols-3 divide-x divide-white/20 text-center">
            {statsFor(ad, source).map((st) => (
              <div key={st.label} className="px-1">
                <p className="text-[17px] font-semibold tabular-nums tracking-tight">{st.value}</p>
                <p className="mt-0.5 text-[11.5px] text-white/65">{st.label}</p>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2.5">
            {status === 'done' ? (
              <a href={ad.sourceUrl} target="_blank" rel="noreferrer" className="btn-light flex-1">
                Open in {sourceLabel(ad.source)}
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><path d="M4 2h6v6M10 2 3 9" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </a>
            ) : (
              <button type="button" className="btn-light flex-1" onClick={onDecode} disabled={status === 'running'}>
                {status === 'running' ? (
                  <>
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-ink/20 border-t-ink" /> Decoding
                  </>
                ) : (
                  <>
                    <Sparkle /> {status === 'failed' ? 'Try again' : 'Decode this ad'}
                  </>
                )}
              </button>
            )}
            {status === 'done' ? (
              <button type="button" onClick={onDecode} className="liquid-dark grid h-[46px] w-[46px] shrink-0 place-items-center rounded-full" aria-label="Decode again" title="Decode again">
                <svg width="16" height="16" viewBox="0 0 14 14" aria-hidden><path d="M12 7a5 5 0 1 1-1.5-3.6M12 2v2.6H9.4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            ) : (
              <a href={ad.sourceUrl} target="_blank" rel="noreferrer" className="liquid-dark grid h-[46px] w-[46px] shrink-0 place-items-center rounded-full" aria-label={`Open in ${sourceLabel(ad.source)}`} title={`Open in ${sourceLabel(ad.source)}`}>
                <svg width="14" height="14" viewBox="0 0 12 12" aria-hidden><path d="M4 2h6v6M10 2 3 9" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </a>
            )}
          </div>
        </div>
      </div>
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
        <p className="mono text-faint">{clock(total)}</p>
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
            <button type="button" onClick={() => onSeek(b.start)} className="group flex w-full gap-3 rounded-[12px] px-2 py-1.5 text-left transition-colors hover:bg-white/70">
              <span className="mono w-9 shrink-0 pt-0.5 tabular-nums text-faint group-hover:text-accent">{clock(b.start)}</span>
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

function Decoded({ ad, onSeek }: { ad: BoardAd; onSeek: (s: number) => void }) {
  const b = ad.breakdown;
  const chips = [ad.labels?.format, ad.labels?.hookType, ad.labels?.structure].filter((v): v is string => !!v);
  return (
    <div className="space-y-5">
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((c, i) => (
            <span key={c} className={`chip !py-1 !text-[11.5px] ${i === 0 ? '!bg-accent !text-white' : ''}`}>{labelText(c)}</span>
          ))}
          {ad.labels?.language && <span className="chip !py-1 !text-[11.5px] uppercase">{ad.labels.language}</span>}
        </div>
      )}
      {b ? (
        <>
          <p className="text-[14px] leading-relaxed" dir="auto">{b.summary}</p>
          <div className="space-y-1.5 rounded-[16px] bg-white/60 p-3 shadow-[var(--glass-rim)]">
            <p className="mono text-faint">Hook</p>
            <p className="text-[15px] font-semibold leading-snug" dir="auto">“{b.hook.text}”</p>
            <p className="text-[13px] text-sub" dir="auto">{b.hook.visual}</p>
          </div>
          <Beats ad={ad} onSeek={onSeek} />
          {(b.offer || b.cta) && (
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-[16px] bg-white/60 p-3 shadow-[var(--glass-rim)]">
                <p className="mono text-faint">Offer</p>
                <p className="mt-1 text-[13px] leading-snug" dir="auto">{b.offer ?? 'None stated'}</p>
              </div>
              <div className="rounded-[16px] bg-white/60 p-3 shadow-[var(--glass-rim)]">
                <p className="mono text-faint">Call to action</p>
                <p className="mt-1 text-[13px] leading-snug" dir="auto">{b.cta ?? 'None stated'}</p>
              </div>
            </div>
          )}
          <div className="rounded-[16px] bg-[linear-gradient(135deg,rgba(10,132,255,.12),rgba(94,92,230,.12))] p-3 shadow-[var(--glass-rim)]">
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
    </div>
  );
}

export function Inspector({ ad, rank, total, source, onDecode }: { ad: BoardAd | null; rank: number; total: number; source: string; onDecode: (id: string) => void }) {
  const video = useRef<HTMLVideoElement | null>(null);
  const { detail, loading, capture } = useAdDetail(ad);
  if (!ad) {
    return (
      <aside className="panel grid min-h-[300px] place-items-center p-6 text-center">
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
  const rows = detail
    ? frameRows(detail.frames, { segments: detail.segments, beats: ad.breakdown?.beats, durationS: ad.durationS, images: detail.images })
    : [];
  const craft = detail?.record ? craftOf(detail.record) : null;

  return (
    <aside aria-label="Inspector" className="no-scrollbar min-w-0 lg:max-h-[calc(100vh-96px)] lg:overflow-y-auto">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={ad.id} initial={{ opacity: 0, y: 8, scale: 0.99 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }} className="space-y-3">
          <MediaCard ad={ad} rank={rank} total={total} source={source} video={video} onDecode={() => onDecode(ad.id)} />

          <div className="panel p-4">
            {ad.decode.status === 'none' && (
              <div className="space-y-1.5">
                <p className="mono text-faint">Not decoded yet</p>
                <p className="text-[13px] leading-snug text-sub">
                  One pass over the video: the hook, each script beat, the offer, why it works and a frame by frame breakdown. About ${DECODE_ESTIMATE_USD.toFixed(2)} and half a minute.
                </p>
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
              <div className="space-y-1.5" role="alert">
                <p className="text-[14px] font-semibold text-red">The decode did not finish</p>
                <p className="text-[13px] leading-snug text-sub">{ad.decode.error}</p>
              </div>
            )}
            {ad.decode.status === 'done' && <Decoded ad={ad} onSeek={seek} />}
          </div>

          {rows.length > 0 && (
            <div className="panel p-4">
              <FrameByFrame adId={ad.id} rows={rows} video={video} capture={capture} capturable={detail?.capturable ?? false} onSeek={seek} />
            </div>
          )}
          {loading && ad.decode.status === 'done' && (
            <div className="panel space-y-2.5 p-4" role="status" aria-label="Loading the frames">
              <div className="shimmer h-3 w-1/3" />
              {[0, 1, 2].map((i) => (
                <div key={i} className="grid grid-cols-[72px_minmax(0,1fr)] gap-3">
                  <div className="shimmer aspect-[9/16]" />
                  <div className="space-y-2 pt-1">
                    <div className="shimmer h-3.5 w-11/12" />
                    <div className="shimmer h-3.5 w-2/3" />
                  </div>
                </div>
              ))}
            </div>
          )}
          {craft && (
            <div className="panel p-4">
              <CraftPanel craft={craft} onSeek={seek} />
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </aside>
  );
}
