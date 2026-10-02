'use client';

import { DECODE_ESTIMATE_USD, estimateScan, type Tables } from '@content-lab/core';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { deleteBoard, updateBoard } from '@/app/(app)/b/actions';
import { motion } from 'motion/react';
import { agoText, axesFor, boardEyebrow, formatCount, type BoardAd } from '@/lib/board-view';
import { Cover } from './cover';
import { Glow } from './glass';
import { ADS_PER_SCAN, CADENCES, PERIODS, scheduleText } from '@/lib/watchlists';
import { Popover } from './popover';
import type { ScanView } from './use-scan';

function BoardMenu({ board }: { board: Tables<'watchlists'> }) {
  const router = useRouter();
  const [name, setName] = useState(board.name);
  const [confirm, setConfirm] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const save = (patch: Parameters<typeof updateBoard>[1]) =>
    start(async () => {
      const r = await updateBoard(board.id, patch);
      setMessage(r.ok ? null : r.message);
      if (r.ok) router.refresh();
    });
  const opts = <T extends string | number>(label: string, value: T, options: { value: T; label: string }[], onPick: (v: T) => void) => (
    <div className="space-y-1.5">
      <p className="mono text-faint">{label}</p>
      <div className="segmented flex w-full" role="group" aria-label={label}>
        {options.map((o) => (
          <button key={String(o.value)} type="button" className="flex-1 !px-1.5" aria-pressed={o.value === value} disabled={pending} onClick={() => onPick(o.value)}>{o.label}</button>
        ))}
      </div>
    </div>
  );

  return (
    <Popover
      label="Board settings"
      align="right"
      width={300}
      className="btn-secondary !px-3"
      button={<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><circle cx="3.5" cy="8" r="1.4" fill="currentColor" /><circle cx="8" cy="8" r="1.4" fill="currentColor" /><circle cx="12.5" cy="8" r="1.4" fill="currentColor" /></svg>}
    >
      {() => (
        <div className="space-y-4 p-2">
          <form
            className="space-y-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim() && name !== board.name) save({ name });
            }}
          >
            <p className="mono text-faint">Name</p>
            <div className="flex gap-1.5">
              <input className="field" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} dir="auto" />
              <button type="submit" className="btn-secondary !px-3" disabled={pending || !name.trim() || name === board.name}>Save</button>
            </div>
          </form>
          {opts('Schedule', board.refresh_cadence, CADENCES.map((c) => ({ value: c as string, label: c === 'manual' ? 'Manual' : c === 'weekly' ? 'Weekly' : 'Monthly' })), (v) => save({ refresh_cadence: v }))}
          {board.source === 'tiktok_creative_center' && opts('Period', board.period_days, PERIODS.map((p) => ({ value: p as number, label: `${p} days` })), (v) => save({ period_days: v }))}
          {opts('Ads per scan', board.max_items, ADS_PER_SCAN.map((n) => ({ value: n as number, label: String(n) })), (v) => save({ max_items: v }))}
          <p className="-mt-2.5 text-[11px] text-faint">About ${estimateScan(board.max_items).toFixed(2)} per scan, paid per ad found.</p>
          {message && <p className="text-xs text-red" role="alert">{message}</p>}
          <div className="border-t border-[var(--line)] pt-3">
            <button
              type="button"
              className={`btn-secondary w-full ${confirm ? '!bg-red !text-white' : '!text-red'}`}
              disabled={pending}
              onClick={() => {
                if (!confirm) {
                  setConfirm(true);
                  return;
                }
                start(async () => {
                  const r = await deleteBoard(board.id);
                  if (r.ok) router.push('/b');
                  else setMessage(r.message);
                });
              }}
            >
              {confirm ? 'Click again to delete this board' : 'Delete board'}
            </button>
            <p className="mt-1.5 text-[11px] text-faint">The ads and their decodes stay in the library.</p>
          </div>
        </div>
      )}
    </Popover>
  );
}

function ScanLine({ board, scan, count }: { board: Tables<'watchlists'>; scan: ScanView; count: number }) {
  const now = new Date();
  if (scan.phase === 'starting' || scan.phase === 'running') {
    return (
      <p className="mono flex items-center gap-2 text-accent" role="status">
        <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-accent" />
        {scan.phase === 'starting' ? 'Starting the scan' : `Scanning · ${scan.synced} ads in`}
      </p>
    );
  }
  if (scan.phase === 'failed' && scan.error) {
    return <p className="text-sm text-red" role="alert">Scan failed: {scan.error}</p>;
  }
  const last = agoText(board.last_swept_at, now);
  return (
    // "3 min ago" depends on the clock, so server and browser may differ by a minute.
    <p className="mono text-faint" suppressHydrationWarning>
      {last ? `Scanned ${last}` : 'Never scanned'} · {count} ads · {scheduleText(board, now)}
    </p>
  );
}

// The three best ads, fanned like cards, next to the title.
function CoverStack({ ads, source, onSelect }: { ads: BoardAd[]; source: string; onSelect: (id: string) => void }) {
  const { rank } = axesFor(source);
  const place = [
    { x: 0, y: 0, r: 0, z: 30 },
    { x: -64, y: 12, r: -10, z: 20 },
    { x: 64, y: 12, r: 10, z: 10 },
  ];
  if (!ads.length) return null;
  return (
    <div className="relative isolate mx-auto hidden h-[178px] w-[250px] lg:block" aria-label="Top 3 ads">
      <Glow src={ads[0]?.cover ?? null} className="left-[70px] top-8 h-[150px] w-[110px]" />
      {ads.slice(0, 3).map((ad, i) => {
        const p = place[i] as (typeof place)[number];
        return (
          <motion.button
            key={ad.id}
            type="button"
            onClick={() => onSelect(ad.id)}
            aria-label={`#${i + 1} ${ad.advertiser ?? ad.handle ?? 'ad'}`}
            initial={{ opacity: 0, x: 0, y: 20, rotate: 0 }}
            animate={{ opacity: 1, x: p.x, y: p.y, rotate: p.r }}
            whileHover={{ y: p.y - 8, scale: 1.04 }}
            transition={{ type: 'spring', stiffness: 220, damping: 22, delay: 0.08 * i }}
            style={{ zIndex: p.z }}
            className="absolute left-[79px] top-0 h-[164px] w-[92px] overflow-hidden rounded-[18px] bg-fill shadow-[0_0_0_2px_#fff,0_14px_30px_-10px_rgba(0,0,0,.4)]"
          >
            <Cover ad={ad} className="absolute inset-0 h-full w-full" />
            <span className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/60 to-transparent" />
            <span className="liquid-dark mono absolute left-1.5 top-1.5 rounded-full px-1.5 py-0.5 text-[9.5px]">#{i + 1}</span>
            <span className="absolute inset-x-2 bottom-1.5 text-left text-[12px] font-semibold tabular-nums text-white">
              {rank === 'ctr' ? `${ad.metrics.ctr?.toFixed(2) ?? '–'} CTR` : `${formatCount(ad.metrics.views)} views`}
            </span>
          </motion.button>
        );
      })}
    </div>
  );
}

export function Hero({
  board,
  headline,
  count,
  scan,
  onScan,
  toDecode,
  onDecodeTop,
  top,
  onSelect,
}: {
  top: BoardAd[];
  onSelect: (id: string) => void;
  board: Tables<'watchlists'>;
  headline: string;
  count: number;
  scan: ScanView;
  onScan: () => void;
  toDecode: number;
  onDecodeTop: () => void;
}) {
  const scanning = scan.phase === 'starting' || scan.phase === 'running';
  return (
    <section className="grid gap-6 pb-8 pt-10 sm:pt-14 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
      <div className="min-w-0">
        <p className="mono flex flex-wrap gap-x-2 gap-y-1 text-faint">
          {boardEyebrow(board).map((part, i) => (
            <span key={part} className="flex items-center gap-2">
              {i > 0 && <span aria-hidden className="opacity-50">·</span>}
              {part}
            </span>
          ))}
        </p>
        <h1 className="mt-3 text-[38px] font-semibold leading-[1.04] tracking-[-0.035em] sm:text-[56px]" dir="auto">
          <span className="text-faint">Decode </span>
          {board.name}
          <span className="text-accent">.</span>
        </h1>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-sub">{headline}</p>
        <div className="mt-3">
          <ScanLine board={board} scan={scan} count={count} />
        </div>
      </div>
      <div className="flex flex-col items-start gap-6 lg:items-center">
      <CoverStack ads={top} source={board.source} onSelect={onSelect} />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-primary !px-5 !py-2.5" onClick={onScan} disabled={scanning}>
          {scanning ? (
            <>
              <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-white" />
              Scanning
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><path d="M12 7a5 5 0 1 1-1.5-3.6M12 2v2.6H9.4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
              Scan now
            </>
          )}
        </button>
        <button
          type="button"
          className="btn-secondary !px-5 !py-2.5"
          onClick={onDecodeTop}
          disabled={!toDecode}
          title={toDecode ? `The rest of the top 10, about $${(toDecode * DECODE_ESTIMATE_USD).toFixed(2)}` : 'The top 10 are decoded'}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><path d="M7 1.5 8.4 5.6 12.5 7 8.4 8.4 7 12.5 5.6 8.4 1.5 7 5.6 5.6Z" fill="currentColor" /></svg>
          {toDecode === 10 ? 'Decode top 10' : toDecode ? `Decode ${toDecode} more` : 'Top 10 decoded'}
        </button>
        <BoardMenu board={board} />
      </div>
      </div>
    </section>
  );
}
