'use client';

import { useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { PerformanceMap } from '@/components/run/performance-map';
import { RunHeader } from '@/components/run/run-header';
import { RunWall } from '@/components/run/run-wall';
import { buildTimeline, replayState, type RunView } from '@/lib/run-view';
import { useSelection } from '@/lib/selection-store';

const LENGTH_MS = 30000;
const SPEEDS = [0.5, 1, 2, 4];

// Animates a finished run from saved data only: no API calls, no pipeline.
// Playback speed is for recording, not the pipeline's real speed.
export function ReplayRun({ view, title = 'Replay', footnote }: { view: RunView; title?: string; footnote?: string }) {
  const reduce = useReducedMotion();
  const events = useMemo(() => buildTimeline(view.items, LENGTH_MS), [view]);
  const [clock, setClock] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [clean, setClean] = useState(false);
  // Known only after mount, so server and client render the same first frame.
  const [staticMode, setStaticMode] = useState(false);
  const clear = useSelection((s) => s.clear);

  useEffect(() => clear, [clear]);

  // Reduced motion: show the final state, static, and let the scrubber step through.
  useEffect(() => {
    setStaticMode(Boolean(reduce));
    if (reduce) {
      setClock(LENGTH_MS);
      setPlaying(false);
    } else {
      setPlaying(true);
    }
  }, [reduce]);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      setClock((c) => {
        const next = Math.min(LENGTH_MS, c + (now - last) * speed);
        if (next >= LENGTH_MS) setPlaying(false);
        return next;
      });
      last = now;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed]);

  // Clean mode hides the app chrome for screen recording.
  useEffect(() => {
    document.body.dataset.clean = clean ? 'true' : 'false';
    return () => {
      delete document.body.dataset.clean;
    };
  }, [clean]);

  const state = useMemo(() => replayState(events, clock), [events, clock]);
  const restart = () => {
    setClock(0);
    setPlaying(!staticMode);
  };

  return (
    <div className="space-y-5">
      {!clean && (
        <RunHeader
          view={view}
          title={title}
          right={
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="btn-primary" onClick={() => (clock >= LENGTH_MS ? restart() : setPlaying((p) => !p))}>
                {playing ? 'Pause' : clock >= LENGTH_MS ? 'Replay' : 'Play'}
              </button>
              <button type="button" className="btn-secondary" onClick={restart}>Restart</button>
              <div className="flex gap-1">
                {SPEEDS.map((s) => (
                  <button key={s} type="button" className={`chip ${speed === s ? 'active' : ''}`} onClick={() => setSpeed(s)}>{s}x</button>
                ))}
              </div>
              <button type="button" className="chip" onClick={() => setClean(true)}>Clean view</button>
            </div>
          }
        />
      )}
      {!clean && (
        <input
          type="range"
          min={0}
          max={LENGTH_MS}
          step={100}
          value={clock}
          onChange={(e) => { setPlaying(false); setClock(Number(e.target.value)); }}
          className="w-full accent-[var(--ink)]"
          aria-label="Replay position"
        />
      )}
      <RunWall items={view.items} visible={state} />
      <PerformanceMap items={view.items} visible={state.labels} />
      {clean ? (
        <button type="button" className="chip fixed bottom-4 right-4 opacity-30 hover:opacity-100" onClick={() => setClean(false)}>Exit clean view</button>
      ) : (
        <p className="text-[11px] text-faint">{footnote ?? 'Replays saved results. It makes no API calls, and its speed is not the pipeline speed.'}{staticMode ? ' Reduced motion is on: showing the final state.' : ''}</p>
      )}
    </div>
  );
}
