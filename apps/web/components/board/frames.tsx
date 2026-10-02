'use client';

import { labelText, type BeatRole } from '@content-lab/core';
import { useEffect, useState } from 'react';
import { activeRow, clock, type Craft, type Fact, type FrameRow } from '@/lib/frame-view';
import { BEAT_COLORS } from '@/lib/colors';
import type { CaptureState } from './use-ad-detail';

// Follows the inspector's video so the frame on screen is highlighted.
function useVideoTime(video: React.RefObject<HTMLVideoElement | null>, adId: string): number {
  const [time, setTime] = useState(0);
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const on = () => setTime(v.currentTime);
    v.addEventListener('timeupdate', on);
    v.addEventListener('seeked', on);
    return () => {
      v.removeEventListener('timeupdate', on);
      v.removeEventListener('seeked', on);
    };
  }, [video, adId]);
  return time;
}

function CaptureNote({ capture, capturable, missing }: { capture: CaptureState; capturable: boolean; missing: boolean }) {
  if (capture.status === 'running') {
    return (
      <p className="mono flex items-center gap-2 text-accent" role="status">
        <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-accent" /> Saving the frame images
      </p>
    );
  }
  if (capture.status === 'failed') {
    return <p className="text-[12px] leading-snug text-sub">The frame images could not be saved: {capture.error}</p>;
  }
  if (missing && !capturable) {
    return <p className="text-[12px] leading-snug text-sub">The video link expired, so there are no images for these frames. Scan the board again and reopen the ad to add them.</p>;
  }
  return null;
}

// Each piece keeps its own direction, so Arabic, French and numbers do not
// get reordered across pieces.
function Isolated({ parts }: { parts: string[] }) {
  return parts.map((p, i) => (
    <span key={i}>
      {i > 0 && <span className="text-faint"> | </span>}
      <bdi>{p}</bdi>
    </span>
  ));
}

export function FrameByFrame({
  adId,
  rows,
  video,
  capture,
  capturable,
  onSeek,
}: {
  adId: string;
  rows: FrameRow[];
  video: React.RefObject<HTMLVideoElement | null>;
  capture: CaptureState;
  capturable: boolean;
  onSeek: (s: number) => void;
}) {
  const time = useVideoTime(video, adId);
  const active = activeRow(rows, time);
  const missing = rows.some((r) => !r.image);
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <p className="mono text-faint">Frame by frame</p>
        <p className="mono tabular-nums text-faint">{rows.length} moments</p>
      </div>
      <CaptureNote capture={capture} capturable={capturable} missing={missing} />
      <ol className="space-y-1">
        {rows.map((r, i) => {
          const on = i === active;
          const color = r.role ? (BEAT_COLORS[r.role as BeatRole] ?? BEAT_COLORS.other) : null;
          return (
            <li key={r.second}>
              <button
                type="button"
                onClick={() => onSeek(r.second)}
                aria-current={on ? 'true' : undefined}
                className={`group grid w-full grid-cols-[72px_minmax(0,1fr)] gap-3 rounded-[16px] p-1.5 text-left transition-colors hover:bg-white/70 ${on ? 'bg-white/80 shadow-[var(--glass-rim),0_6px_18px_-10px_rgba(16,24,40,.35)]' : ''}`}
              >
                <span className="relative block aspect-[9/16] overflow-hidden rounded-[11px] bg-[linear-gradient(160deg,#2c2c2e,#1d1d1f)]">
                  {r.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.image} alt={`Frame at ${clock(r.second)}`} loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
                  ) : capture.status === 'running' ? (
                    <span className="shimmer absolute inset-0 block !rounded-none" />
                  ) : null}
                  <span className={`mono absolute left-1 top-1 rounded-full px-1.5 py-px text-[9.5px] tabular-nums text-white ${on ? 'bg-accent' : 'bg-black/55'}`}>{clock(r.second)}</span>
                </span>
                <span className="block min-w-0 space-y-1.5 py-0.5">
                  {r.role && color && (
                    <span className="mono flex items-center gap-1.5 text-faint">
                      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
                      {labelText(r.role)}
                    </span>
                  )}
                  <span className="block text-[13px] leading-snug" dir="auto">{r.description}</span>
                  {r.onScreen.length > 0 && (
                    <span className="block text-[12.5px] font-semibold leading-snug">
                      <span className="mono mr-1.5 font-medium text-faint">Text</span>
                      <Isolated parts={r.onScreen} />
                    </span>
                  )}
                  {r.speech.length > 0 && (
                    <span className="block text-[12.5px] leading-snug text-sub">
                      <span className="mono mr-1.5 text-faint">Says</span>
                      <Isolated parts={r.speech} />
                    </span>
                  )}
                  {r.cta && (
                    <span className="block text-[12.5px] leading-snug">
                      <span className="mono mr-1.5 text-accent">CTA</span>
                      <bdi>{r.cta}</bdi>
                    </span>
                  )}
                  {r.elements.length > 0 && (
                    <span className="flex flex-wrap gap-1">
                      {r.elements.map((e) => (
                        <span key={e} className="rounded-full bg-[var(--fill)] px-1.5 py-0.5 text-[10.5px] font-medium text-sub">{e}</span>
                      ))}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Facts({ title, facts }: { title: string; facts: Fact[] }) {
  if (!facts.length) return null;
  return (
    <div>
      <p className="mono mb-0.5 text-faint">{title}</p>
      <dl className="divide-y divide-[var(--line)]">
        {facts.map((f) => (
          <div key={f.label} className="flex items-baseline justify-between gap-3 py-1.5">
            <dt className="shrink-0 text-[12.5px] text-sub">{f.label}</dt>
            <dd className="min-w-0 text-right text-[13px] font-medium" dir="auto">{f.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// When each element first shows, how the CTA is made, the edit and the
// talent: the taxonomy record, without the unknowns.
export function CraftPanel({ craft, onSeek }: { craft: Craft; onSeek: (s: number) => void }) {
  const tags = [...craft.levers, ...craft.proof];
  return (
    <div className="space-y-4">
      <p className="mono text-faint">Timing and craft</p>
      {craft.timing.length > 0 && (
        <div className="space-y-1.5">
          <p className="mono text-faint">First shown</p>
          <div className="flex flex-wrap gap-1.5">
            {craft.timing.map((m) => (
              <button key={m.label} type="button" className="chip !py-1 !text-[11.5px]" onClick={() => onSeek(m.second)} title={`Play from ${clock(m.second)}`}>
                <span className="tabular-nums text-faint">{clock(m.second)}</span> {m.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        <Facts title="Call to action" facts={craft.cta} />
        <Facts title="Edit" facts={craft.execution} />
        <Facts title="Talent" facts={craft.talent} />
      </div>
      {tags.length > 0 && (
        <div className="space-y-1.5">
          <p className="mono text-faint">Levers and social proof</p>
          <div className="flex flex-wrap gap-1.5">
            {tags.map((t) => <span key={t} className="chip !py-1 !text-[11.5px]">{t}</span>)}
          </div>
        </div>
      )}
    </div>
  );
}
