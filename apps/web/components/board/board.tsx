'use client';

import { boardSources, DECODE_ESTIMATE_USD } from '@content-lab/core';
import { SOURCE_NAMES } from '@/lib/watchlists';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { glowInk } from '@/lib/ambient';
import type { BoardData } from '@/lib/board';
import { boardHeadline, boardStats, byMarket, groupAds, marketCounts, parseSavedView, rankAds, scanSummary, splitByScan, type BoardAd, type MarketFilter as Market, type SavedView } from '@/lib/board-view';
import { DeepDive } from './deep-dive';
import { Ambient, useCoverColor } from './glass';
import { BoardActions, Hero } from './hero';
import { Inspector } from './inspector';
import { Kpis } from './kpis';
import { GateBar, MarketFilter } from './market';
import { NewBoardDialog } from './new-board';
import { PerfMap } from './perf-map';
import { TopAds } from './top-ads';
import { TopBar } from './top-bar';
import { useDecodeQueue } from './use-decode';
import { useScan } from './use-scan';
import { WhichWins } from './which-wins';

type Queue = Pick<ReturnType<typeof useDecodeQueue>, 'active' | 'errors' | 'finished'>;

// The board's data with this tab's decodes laid over it, until a refresh
// brings the saved state.
function withQueue(ad: BoardAd, q: Queue): BoardAd {
  if (q.active.has(ad.id)) return { ...ad, decode: { ...ad.decode, status: 'running', error: null } };
  const error = q.errors.get(ad.id);
  if (error) return { ...ad, decode: { ...ad.decode, status: 'failed', error } };
  if (q.finished.has(ad.id) && (ad.decode.status === 'none' || ad.decode.status === 'running')) {
    return { ...ad, decode: { ...ad.decode, status: 'running', error: null } };
  }
  return ad;
}

const undecoded = (ad: BoardAd) => ad.decode.status === 'none' || ad.decode.status === 'failed';

const MARKET_KEY = 'content-lab:market';
const MARKETS: readonly Market[] = ['all', 'moroccan', 'unclear', 'elsewhere'];

// The market filter, remembered in this browser across boards and visits.
function useMarketFilter(): [Market, (m: Market) => void] {
  const [market, setMarket] = useState<Market>('all');
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(MARKET_KEY) as Market | null;
      if (saved && MARKETS.includes(saved)) setMarket(saved);
    } catch {
      // Storage can be blocked; the filter then starts at All.
    }
  }, []);
  const choose = useCallback((m: Market) => {
    setMarket(m);
    try {
      window.localStorage.setItem(MARKET_KEY, m);
    } catch {
      // Not remembered, still applied.
    }
  }, []);
  return [market, choose];
}

const viewKey = (boardId: string) => `content-lab:board:${boardId}`;

function readView(boardId: string): SavedView | null {
  try {
    return parseSavedView(window.localStorage.getItem(viewKey(boardId)));
  } catch {
    // Storage can be blocked; the board then opens as new.
    return null;
  }
}

function writeView(boardId: string, view: SavedView) {
  try {
    window.localStorage.setItem(viewKey(boardId), JSON.stringify(view));
  } catch {
    // Not remembered, still applied.
  }
}

export function Board({ data }: { data: BoardData }) {
  const { board } = data;
  // A board pooling Meta and TikTok searches shows one source at a time:
  // their numbers differ (days running against CTR), so they never share a chart.
  const sources = useMemo(() => boardSources(board), [board]);
  const [sourceChoice, setSource] = useState<string | null>(null);
  const source = sourceChoice && sources.includes(sourceChoice) ? sourceChoice : (sources[0] as string);
  const boardAds = useMemo(() => (sources.length > 1 ? data.ads.filter((a) => a.source === source) : data.ads), [data.ads, source, sources.length]);
  const gate = useMemo(
    () => (sources.length > 1 ? { pending: boardAds.filter((a) => a.gate === 'pending').length, rejected: boardAds.filter((a) => a.gate === 'rejected').length } : data.gate),
    [sources.length, boardAds, data.gate],
  );
  const [creating, setCreating] = useState(false);
  const { view: scan, start: startScan } = useScan(board.id, data.scan);
  const queue = useDecodeQueue();
  const { active, errors, finished } = queue;
  // The latest scan by default; ads from earlier scans on request.
  const [withOlder, setWithOlder] = useState(false);
  const { current, older } = useMemo(() => splitByScan(boardAds, data.cutoff), [boardAds, data.cutoff]);
  // A Moroccan board shows the ads its gate let in, unless asked for the rest.
  const [showLeftOut, setShowLeftOut] = useState(false);
  const inScan = withOlder ? boardAds : current;
  const scoped = useMemo(() => (showLeftOut ? inScan : inScan.filter((a) => (a.gate ?? 'shown') === 'shown')), [inScan, showLeftOut]);
  const [marketChoice, setMarket] = useMarketFilter();
  const counts = useMemo(() => marketCounts(scoped), [scoped]);
  // A filter with no ads in this board shows them all instead of nothing.
  const market = counts[marketChoice] ? marketChoice : 'all';
  const shown = useMemo(() => byMarket(scoped, market), [scoped, market]);
  const ads = useMemo(() => rankAds(shown.map((a) => withQueue(a, { active, errors, finished })), source), [shown, active, errors, finished, source]);
  const stats = boardStats(ads, source);
  const formats = useMemo(() => groupAds(ads, source, 'format'), [ads, source]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIndex = Math.max(0, ads.findIndex((a) => a.id === selectedId));
  const selected = ads[selectedIndex] ?? null;
  // The glow's color, from the selected ad's cover, and the hero text over it.
  const glow = useCoverColor(selected?.cover ?? null);
  const ink = useMemo(() => glowInk(glow), [glow]);
  const [formatChoice, setFormat] = useState<string | null>(null);
  // A remembered format that no ad has any more filters nothing.
  const format = formatChoice !== null && formats.some((f) => f.key === formatChoice) ? formatChoice : null;
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());

  // The board as it was left in this browser: restored once per board after
  // the first render (storage is browser only), then saved on every change.
  const [restored, setRestored] = useState<string | null>(null);
  useEffect(() => {
    const v = readView(board.id);
    const known = new Set(data.ads.map((a) => a.id));
    setSelectedId(v?.selected ?? null);
    setWithOlder(v?.withOlder ?? false);
    setShowLeftOut(v?.showLeftOut ?? false);
    setFormat(v?.format ?? null);
    setPicked(new Set((v?.picked ?? []).filter((id) => known.has(id))));
    setSource(v?.source ?? null);
    setRestored(board.id);
    // Only when the board changes, not on every refresh of its ads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board.id]);
  useEffect(() => {
    if (restored !== board.id) return;
    writeView(board.id, { selected: selectedId, withOlder, showLeftOut, format: formatChoice, picked: [...picked], source: sourceChoice });
  }, [restored, board.id, selectedId, withOlder, showLeftOut, formatChoice, picked, sourceChoice]);
  const inspector = useRef<HTMLDivElement>(null);
  // The inspector's video: the frame strip under the map follows and seeks it.
  const video = useRef<HTMLVideoElement | null>(null);
  const seek = useCallback((s: number) => {
    const v = video.current;
    if (!v) return;
    v.currentTime = s;
    void v.play().catch(() => undefined);
  }, []);

  const dimmed = useCallback((ad: BoardAd) => format !== null && ad.labels?.format !== format, [format]);
  const select = useCallback((id: string) => {
    setSelectedId(id);
    const el = inspector.current;
    if (el && window.matchMedia('(max-width: 1023px)').matches) {
      const r = el.getBoundingClientRect();
      if (r.top > window.innerHeight * 0.6 || r.bottom < 80) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  const topIds = ads.slice(0, 10).filter(undecoded).map((a) => a.id);
  const decodeTop = () => queue.decode(topIds);
  const pickedToDecode = ads.filter((a) => picked.has(a.id) && undecoded(a)).map((a) => a.id);

  return (
    <MotionConfig reducedMotion="user">
      <Ambient color={glow} />
      <TopBar boards={data.boards} currentId={board.id} spend={data.spend} onNew={() => setCreating(true)} />
      <main className="relative z-[1] mx-auto max-w-[1440px] px-4 pb-32 sm:px-6">
        {/* The text over the glow takes a dark shade of its color, to stay readable. */}
        <div className="glow-ink" style={{ '--sub': ink.sub, '--faint': ink.faint } as React.CSSProperties}>
          <Hero
            board={board}
            headline={boardHeadline(ads, source)}
            count={counts.all}
            scan={scan}
            summary={scanSummary(data.scan)}
            top={ads.slice(0, 3)}
            onSelect={select}
            market={<MarketFilter value={market} counts={counts} onChange={setMarket} />}
            source={source}
            sources={sources.length > 1 ? (
              <div className="flex min-w-0 max-w-full items-center gap-2.5">
                <p className="mono shrink-0 text-faint">Source</p>
                <div className="segmented no-scrollbar max-w-full overflow-x-auto" role="group" aria-label="Show ads from">
                  {sources.map((s) => (
                    <button key={s} type="button" aria-pressed={s === source} onClick={() => setSource(s)}>
                      {SOURCE_NAMES[s] ?? s} <span className="tabular-nums opacity-55">{data.ads.filter((a) => a.source === s && (a.gate ?? 'shown') === 'shown').length}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : undefined}
          />
          {board.moroccan_only && <GateBar boardId={board.id} gate={gate} ads={inScan} showLeftOut={showLeftOut} onToggle={() => setShowLeftOut((v) => !v)} />}
        </div>
        <Kpis stats={stats} source={source} decoding={queue.active.size} cover={ads[0]?.cover ?? null} />

        <section className="mt-10" aria-labelledby="overview-title">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="mono text-faint">Overview</p>
              <h2 id="overview-title" className="mt-1 text-2xl font-semibold tracking-tight">Every ad, in one picture</h2>
              {older.length > 0 && (
                <button type="button" className={`chip mt-2 ${withOlder ? 'active' : ''}`} onClick={() => setWithOlder((w) => !w)} aria-pressed={withOlder}>
                  {withOlder ? `Showing ${older.length} from earlier scans` : `+ ${older.length} from earlier scans`}
                </button>
              )}
            </div>
            <div className="flex min-w-0 max-w-full flex-col items-start gap-3 sm:items-end">
            <BoardActions board={board} scan={scan} onScan={startScan} toDecode={topIds.length} onDecodeTop={decodeTop} />
            <div className="no-scrollbar -mx-4 flex max-w-[calc(100%+32px)] gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:max-w-full sm:flex-wrap sm:justify-end sm:px-0" role="group" aria-label="Filter by format">
              {formats.length ? (
                <>
                  <button type="button" className={`chip ${format === null ? 'active' : ''}`} onClick={() => setFormat(null)}>All formats</button>
                  {formats.map((f) => (
                    <button key={f.key} type="button" className={`chip ${format === f.key ? 'active' : ''}`} onClick={() => setFormat(format === f.key ? null : f.key)} aria-pressed={format === f.key}>
                      {f.label}
                      <span className="tabular-nums opacity-55">{f.count}</span>
                    </button>
                  ))}
                </>
              ) : (
                <p className="mono text-faint">Formats appear here as ads are decoded</p>
              )}
            </div>
            </div>
          </div>

          <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[236px_minmax(0,1fr)_360px]">
            <TopAds ads={ads} source={source} selectedId={selected?.id ?? null} onSelect={select} dimmed={dimmed} />
            <PerfMap ads={ads} source={source} selectedId={selected?.id ?? null} picked={picked} onSelect={select} onPick={(ids) => setPicked(new Set(ids))} dimmed={dimmed} />
            <div ref={inspector} className="scroll-mt-20 lg:sticky lg:top-20 lg:row-span-2">
              <Inspector ad={selected} rank={selectedIndex + 1} total={ads.length} source={source} video={video} scan={scan} onRescan={startScan} onSeek={seek} onDecode={(id) => queue.decode([id])} />
            </div>
            {/* Frame by frame and craft: wide rows under the map, beside the inspector. */}
            <div className="min-w-0 space-y-4 empty:hidden xl:col-span-2">
              <DeepDive ad={selected} video={video} onSeek={seek} />
            </div>
          </div>
        </section>

        <div className="mt-12">
          <WhichWins ads={ads} source={source} onSelect={select} onFilter={setFormat} filter={format} onDecodeTop={decodeTop} canDecode={topIds.length > 0} />
        </div>
      </main>

      <AnimatePresence>
        {(picked.size > 0 || queue.batch.total > 0) && (
          <motion.div
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 34 }}
            className="liquid fixed bottom-4 left-1/2 z-50 flex max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-3 rounded-full py-2 pl-4 pr-2 text-sm"
            role="status"
          >
            {picked.size > 0 ? (
              <>
                <span className="whitespace-nowrap font-medium tabular-nums">{picked.size} selected</span>
                <button
                  type="button"
                  className="btn-primary !py-1.5"
                  disabled={!pickedToDecode.length}
                  onClick={() => {
                    queue.decode(pickedToDecode);
                    setPicked(new Set());
                  }}
                >
                  {pickedToDecode.length ? `Decode ${pickedToDecode.length} · about $${(pickedToDecode.length * DECODE_ESTIMATE_USD).toFixed(2)}` : 'All decoded'}
                </button>
                <button type="button" className="chip" onClick={() => setPicked(new Set())}>Clear</button>
              </>
            ) : (
              <>
                <span className="pulse-dot h-2 w-2 rounded-full bg-accent" />
                <span className="whitespace-nowrap tabular-nums">Decoding {Math.min(queue.batch.done + 1, queue.batch.total)} of {queue.batch.total}</span>
                <span className="h-1.5 w-24 overflow-hidden rounded-full bg-[var(--fill)]">
                  <motion.span className="block h-full rounded-full bg-accent" animate={{ width: `${(queue.batch.done / queue.batch.total) * 100}%` }} />
                </span>
                <span className="pr-2 text-xs text-faint">4 at a time</span>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <NewBoardDialog open={creating} onClose={() => setCreating(false)} />
    </MotionConfig>
  );
}
