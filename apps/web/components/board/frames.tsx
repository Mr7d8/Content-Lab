'use client';

import { labelText, type BeatRole } from '@content-lab/core';
import { useEffect, useRef, useState } from 'react';
import { activeRow, clock, type Craft, type Fact, type FrameRow } from '@/lib/frame-view';
import { BEAT_COLORS } from '@/lib/colors';
import type { CaptureState } from './use-ad-detail';

// Follows the inspector's video so the frame on screen is highlighted. The
// video lives in the inspector and remounts per ad, so the ref is read on a
// short timer instead of subscribing to one element.
function useVideoTime(video: React.RefObject<HTMLVideoElement | null>): { time: number; playing: boolean } {
  const [state, setState] = useState({ time: 0, playing: false });
  useEffect(() => {
    const id = setInterval(() => {
      const v = video.current;
      const next = { time: v?.currentTime ?? 0, playing: !!v && !v.paused };
      setState((s) => (Math.abs(s.time - next.time) < 0.05 && s.playing === next.playing ? s : next));
    }, 250);
    return () => clearInterval(id);
  }, [video]);
  return state;
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
  rows,
  video,
  capture,
  capturable,
  onSeek,
}: {
  rows: FrameRow[];
  video: React.RefObject<HTMLVideoElement | null>;
  capture: CaptureState;
  capturable: boolean;
  onSeek: (s: number) => void;
}) {
  const { time, playing } = useVideoTime(video);
  const active = activeRow(rows, time);
  const missing = rows.some((r) => !r.image);
  const strip = useRef<HTMLOListElement>(null);

  // While the video plays, keep the moment on screen in view (sideways only).
  useEffect(() => {
    const ol = strip.current;
    const li = ol?.children[active] as HTMLElement | undefined;
    if (!ol || !li || !playing) return;
    const left = li.offsetLeft - ol.offsetLeft;
    if (left < ol.scrollLeft || left + li.offsetWidth > ol.scrollLeft + ol.clientWidth) {
      ol.scrollTo({ left: Math.max(0, left - 16), behavior: 'smooth' });
    }
  }, [active, playing]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="mono text-faint">Frame by frame</p>
        <p className="mono tabular-nums text-faint">{rows.length} moments · click one to play from there</p>
      </div>
      <CaptureNote capture={capture} capturable={capturable} missing={missing} />
      <ol ref={strip} className="no-scrollbar -m-1 flex snap-x gap-3 overflow-x-auto p-1 pb-2">
        {rows.map((r, i) => {
          const on = i === active;
          const color = r.role ? (BEAT_COLORS[r.role as BeatRole] ?? BEAT_COLORS.other) : null;
          return (
            <li key={r.second} className="w-[148px] shrink-0 snap-start">
              <button
                type="button"
                onClick={() => onSeek(r.second)}
                aria-current={on ? 'true' : undefined}
                className={`group flex h-full w-full flex-col gap-2 rounded-[18px] p-1.5 text-left transition-[background,box-shadow] hover:bg-white/70 ${on ? 'bg-white/85 shadow-[var(--glass-rim),0_0_0_2px_var(--accent),0_10px_24px_-12px_rgba(10,132,255,.5)]' : ''}`}
              >
                <span className="relative block aspect-[9/16] w-full overflow-hidden rounded-[13px] bg-[linear-gradient(160deg,#2c2c2e,#1d1d1f)]">
                  {r.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.image} alt={`Frame at ${clock(r.second)}`} loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
                  ) : capture.status === 'running' ? (
                    <span className="shimmer absolute inset-0 block !rounded-none" />
                  ) : null}
                  <span className={`mono absolute left-1.5 top-1.5 rounded-full px-1.5 py-px text-[9.5px] tabular-nums text-white ${on ? 'bg-accent' : 'liquid-dark'}`}>{clock(r.second)}</span>
                  {r.role && color && (
                    <span className="liquid-dark mono absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded-full px-1.5 py-px text-[9.5px]">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
                      {labelText(r.role)}
                    </span>
                  )}
                </span>
                <span className="block min-w-0 space-y-1.5 px-0.5 pb-0.5">
                  <span className="line-clamp-3 block text-[12.5px] leading-snug" dir="auto">{r.description}</span>
                  {r.onScreen.length > 0 && (
                    <span className="line-clamp-3 block text-[12px] font-semibold leading-snug">
                      <span className="mono mr-1 font-medium text-faint">Text</span>
                      <Isolated parts={r.onScreen} />
                    </span>
                  )}
                  {r.speech.length > 0 && (
                    <span className="line-clamp-3 block text-[12px] leading-snug text-sub">
                      <span className="mono mr-1 text-faint">Says</span>
                      <Isolated parts={r.speech} />
                    </span>
                  )}
                  {r.cta && (
                    <span className="line-clamp-2 block text-[12px] leading-snug">
                      <span className="mono mr-1 text-accent">CTA</span>
                      <bdi>{r.cta}</bdi>
                    </span>
                  )}
                  {r.elements.length > 0 && (
                    <span className="flex flex-wrap gap-1">
                      {r.elements.map((e) => (
                        <span key={e} className="rounded-full bg-[var(--fill)] px-1.5 py-0.5 text-[10px] font-medium text-sub">{e}</span>
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
    <div className="space-y-3">
      <p className="mono text-faint">Timing and craft</p>
      <div className="grid gap-x-8 gap-y-5 md:grid-cols-2 xl:grid-cols-4">
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
        <Facts title="Call to action" facts={craft.cta} />
        <Facts title="Edit" facts={craft.execution} />
        <Facts title="Talent" facts={craft.talent} />
      </div>
      {tags.length > 0 && (
        <div className="space-y-1.5 border-t border-[var(--line)] pt-3">
          <p className="mono text-faint">Levers and social proof</p>
          <div className="flex flex-wrap gap-1.5">
            {tags.map((t) => <span key={t} className="chip !py-1 !text-[11.5px]">{t}</span>)}
          </div>
        </div>
      )}
    </div>
  );
}
