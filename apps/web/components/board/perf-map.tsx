'use client';

import { scaleLinear, scaleLog } from 'd3-scale';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { axesFor, formatMetric, formatTick, logTicks, median, METRIC_MEANS, METRIC_NAME, metricUnit, spreadPoints, type BoardAd, type MetricKey } from '@/lib/board-view';
import { covers } from '@/lib/cover-loader';
import { Cover } from './cover';
import { Glow, ProgressiveBlur } from './glass';

const fmt = (axis: MetricKey, v: number | undefined) => formatMetric(axis, v);
// The corner where the strongest ads sit, by the map's vertical number.
const BEST_CORNER: Partial<Record<MetricKey, string>> = { ctr: 'high CTR, many likes', likes: 'many views, many likes', days: 'long running, many versions' };

// The decoded mark, as on the Top ads tiles.
function DecodedBadge({ size }: { size: number }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-full bg-accent text-white shadow-[0_0_0_1.5px_rgba(255,255,255,.95)]" style={{ width: size, height: size }} aria-hidden>
      <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 14 14"><path d="M7 1.5 8.4 5.6 12.5 7 8.4 8.4 7 12.5 5.6 8.4 1.5 7 5.6 5.6Z" fill="currentColor" /></svg>
    </span>
  );
}

type Rect = { x0: number; y0: number; x1: number; y1: number };

// Covers fly in from their tiles in the Top ads list, each once its image
// has loaded (cover-loader: a few at a time, best ranked first, shared with
// the list), and one after another: departures at least ENTRY_S / ads apart
// (50 ms at most), each flight 0.8 s. The flight eases in and out, so it is
// seen leaving its tile, not only landing.
const ENTRY_S = 1.6;
const FLY_S = 0.8;
const EASE_FLY = [0.45, 0, 0.2, 1] as const;

// Where a cover takes off, relative to the map, and when (performance.now()).
type Takeoff = { x: number; y: number; scale: number; at: number };

// The center and width of an ad's tile in the Top ads list (top-ads.tsx marks
// them with data-tile), kept inside the list's visible box. A tile that is
// hidden (past "Show all") leaves from the bottom of the list, at about half
// a tile's size, so that stream stays light.
function tileSpot(id: string, list: DOMRect, tileW: number): { cx: number; cy: number; w: number } {
  const r = document.querySelector(`[data-tile="${CSS.escape(id)}"]`)?.getBoundingClientRect();
  if (!r || !r.width) return { cx: list.left + list.width / 2, cy: list.bottom, w: tileW / 2 };
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  return { cx: clamp(r.left + r.width / 2, list.left, list.right), cy: clamp(r.top + r.height / 2, list.top, list.bottom), w: r.width };
}

// Every ad as its cover, placed by its two numbers. Decoded ads carry the
// decode mark; a format filter dims the rest. Drag across the map to pick ads
// to decode. The key under the map says what each mark means.
export function PerfMap({
  ads,
  source,
  selectedId,
  picked,
  onSelect,
  onPick,
  dimmed,
}: {
  ads: BoardAd[];
  source: string;
  selectedId: string | null;
  picked: ReadonlySet<string>;
  onSelect: (id: string) => void;
  onPick: (ids: string[]) => void;
  dimmed: (ad: BoardAd) => boolean;
}) {
  const axes = axesFor(source);
  const wrap = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(760);
  const [hovered, setHovered] = useState<string | null>(null);
  const [lasso, setLasso] = useState<Rect | null>(null);
  const [touch, setTouch] = useState(false);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setW(Math.max(280, Math.round(entry?.contentRect.width ?? 760))));
    observer.observe(el);
    setTouch(window.matchMedia('(pointer: coarse)').matches);
    return () => observer.disconnect();
  }, []);

  const narrow = W < 560;
  const H = narrow ? 380 : 500;
  const T = narrow ? { w: 22, h: 39 } : { w: 28, h: 50 };
  const M = { top: 30, right: 18, bottom: 36, left: narrow ? 38 : 46 };

  const plotted = useMemo(
    () => ads.filter((a) => a.metrics[axes.x] !== undefined && a.metrics[axes.y] !== undefined),
    [ads, axes.x, axes.y],
  );
  const missing = ads.length - plotted.length;

  const geometry = useMemo(() => {
    const xs = plotted.map((a) => Math.max(1, a.metrics[axes.x] as number));
    const ys = plotted.map((a) => a.metrics[axes.y] as number);
    const xDomain: [number, number] = xs.length ? [Math.min(...xs) / 1.6, Math.max(...xs) * 1.6] : [1, 1000];
    const x = scaleLog().domain(xDomain).range([M.left + T.w / 2 + 4, W - M.right - T.w / 2 - 4]);
    const inner: [number, number] = [H - M.bottom - T.h / 2 - 2, M.top + T.h / 2 + 2];
    let y: (v: number) => number;
    let yTicks: number[];
    if (axes.yLog) {
      const lo = Math.max(1, Math.min(...ys, 10));
      const yDomain: [number, number] = [lo / 1.6, Math.max(...ys, lo * 10) * 1.6];
      const s = scaleLog().domain(yDomain).range(inner);
      y = (v: number) => s(Math.max(1, v));
      yTicks = logTicks(yDomain, narrow ? 5 : 7);
    } else {
      const s = scaleLinear().domain([0, Math.max(1, ...ys)]).range(inner).nice();
      y = s;
      yTicks = s.ticks(narrow ? 3 : 4);
    }
    const placed = spreadPoints(
      plotted.map((a) => ({ id: a.id, x: x(Math.max(1, a.metrics[axes.x] as number)), y: y(a.metrics[axes.y] as number) })),
      T.w * 0.78,
      T.h * 0.62,
      { x0: M.left + T.w / 2, x1: W - M.right - T.w / 2, y0: M.top + T.h / 2, y1: H - M.bottom - T.h / 2 },
      narrow ? 10 : 16,
    );
    const ticks = logTicks(xDomain, narrow ? 5 : 8);
    return {
      x,
      y,
      xTicks: ticks.length >= 2 ? ticks : x.ticks(4),
      yTicks,
      at: new Map(placed.map((p) => [p.id, p])),
      mx: median(xs),
      my: median(ys),
    };
  }, [plotted, axes.x, axes.y, axes.yLog, W, H, T.w, T.h, M.left, M.right, M.top, M.bottom, narrow]);

  // Which covers have their image in, asked for in rank order.
  const loaded = useRef(new Set<string>());
  const [loadTick, setLoadTick] = useState(0);
  useEffect(() => {
    let live = true;
    for (const a of plotted) {
      if (loaded.current.has(a.id)) continue;
      void (a.cover ? covers.load(a.cover) : Promise.resolve()).then(() => {
        if (!live) return;
        loaded.current.add(a.id);
        setLoadTick((n) => n + 1);
      });
    }
    return () => {
      live = false;
    };
  }, [plotted]);

  // Takeoffs for covers whose image is in, measured before they paint (a
  // cover shows only once it has one). Ads that leave the map forget theirs,
  // so they fly in again when they come back, as with the earlier-scans toggle.
  const takeoffs = useRef(new Map<string, Takeoff>());
  const lastTakeoff = useRef(0);
  const [, setMeasured] = useState(0);
  useLayoutEffect(() => {
    const ids = new Set(plotted.map((a) => a.id));
    for (const id of takeoffs.current.keys()) if (!ids.has(id)) takeoffs.current.delete(id);
    const fresh = plotted.filter((a) => loaded.current.has(a.id) && !takeoffs.current.has(a.id));
    const el = wrap.current;
    if (!fresh.length || !el) return;
    const box = el.getBoundingClientRect();
    const list = document.querySelector('[data-tiles]')?.getBoundingClientRect();
    const tileW = Array.from(document.querySelectorAll('[data-tile]'), (t) => t.getBoundingClientRect().width).find((w) => w > 0) ?? T.w * 2;
    // Spaced by the whole map's count, so covers that load together still go one by one.
    const step = Math.min(0.05, ENTRY_S / plotted.length) * 1000;
    let at = Math.max(performance.now(), lastTakeoff.current + step);
    fresh.forEach((a) => {
      const p = geometry.at.get(a.id);
      // No list on the page: in from the map's left edge, at the cover's height.
      const spot = list?.width ? tileSpot(a.id, list, tileW) : { cx: box.left - T.w, cy: box.top + (p?.y ?? H / 2), w: T.w };
      takeoffs.current.set(a.id, { x: spot.cx - box.left - T.w / 2, y: spot.cy - box.top - T.h / 2, scale: Math.min(4, Math.max(1, spot.w / T.w)), at });
      lastTakeoff.current = at;
      at += step;
    });
    setMeasured((n) => n + 1);
    // geometry and T follow plotted and the width; a new takeoff is only needed for a newly loaded ad.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plotted, loadTick]);

  const point = (e: React.PointerEvent) => {
    const r = (wrap.current as HTMLDivElement).getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const onDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch' || (e.target as HTMLElement).closest('button')) return;
    const p = point(e);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setLasso({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  };
  const onMove = (e: React.PointerEvent) => {
    if (!lasso) return;
    const p = point(e);
    setLasso({ ...lasso, x1: p.x, y1: p.y });
  };
  const onUp = () => {
    if (!lasso) return;
    const [x0, x1] = [Math.min(lasso.x0, lasso.x1), Math.max(lasso.x0, lasso.x1)];
    const [y0, y1] = [Math.min(lasso.y0, lasso.y1), Math.max(lasso.y0, lasso.y1)];
    setLasso(null);
    if (x1 - x0 < 6 && y1 - y0 < 6) {
      onPick([]);
      return;
    }
    onPick(plotted.filter((a) => {
      const p = geometry.at.get(a.id);
      return p && p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 && !dimmed(a);
    }).map((a) => a.id));
  };

  const hoveredAd = hovered ? plotted.find((a) => a.id === hovered) : undefined;
  const hp = hovered ? geometry.at.get(hovered) : undefined;
  const noun = source === 'tiktok_organic' ? 'post' : 'ad';

  // The typical ad's two numbers, marked on the axes where the dashed lines
  // meet them; tick labels too close to a mark give way.
  const mono = { fontSize: 10, fontFamily: 'var(--font-mono)' } as const;
  const pill = (text: string) => text.length * 6.1 + 12;
  const yMark = geometry.my !== null ? { at: geometry.y(geometry.my), text: fmt(axes.y, geometry.my) } : null;
  const xMark = geometry.mx !== null ? { at: geometry.x(geometry.mx), text: fmt(axes.x, geometry.mx) } : null;
  const corner = BEST_CORNER[axes.y];

  return (
    <div className="panel min-w-0 p-4">
      <div>
        <p className="mono text-faint">Performance map</p>
        <p className="mt-0.5 text-sm font-medium">{METRIC_NAME[axes.y]} against {METRIC_NAME[axes.x].toLowerCase()}, every {noun}</p>
      </div>

      <div
        ref={wrap}
        // A crosshair over the empty map: dragging there picks the ads in the box.
        className={`relative mt-3 select-none ${touch ? '' : 'cursor-crosshair'}`}
        style={{ height: H }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => setLasso(null)}
      >
        <svg width={W} height={H} className="absolute inset-0" aria-hidden>
          <rect x={M.left} y={M.top} width={Math.max(0, W - M.left - M.right)} height={Math.max(0, H - M.top - M.bottom)} rx={14} fill="rgba(255,255,255,.55)" stroke="rgba(255,255,255,.9)" />
          {geometry.yTicks.map((t) => (
            <g key={`y${t}`}>
              <line x1={M.left} x2={W - M.right} y1={geometry.y(t)} y2={geometry.y(t)} stroke="var(--line)" />
              {!(yMark && Math.abs(geometry.y(t) - yMark.at) < 14) && (
                <text x={M.left - 8} y={geometry.y(t)} dy="0.32em" textAnchor="end" {...mono} fill="var(--faint)">{formatTick(axes.y, t)}</text>
              )}
            </g>
          ))}
          {geometry.xTicks.map((t) => (
            <g key={`x${t}`}>
              <line x1={geometry.x(t)} x2={geometry.x(t)} y1={M.top} y2={H - M.bottom} stroke="var(--line)" />
              {!(xMark && Math.abs(geometry.x(t) - xMark.at) < pill(xMark.text) / 2 + 10) && (
                <text x={geometry.x(t)} y={H - M.bottom + 16} textAnchor="middle" {...mono} fill="var(--faint)">{formatTick(axes.x, t)}</text>
              )}
            </g>
          ))}
          {xMark && (
            <g>
              <line x1={xMark.at} x2={xMark.at} y1={M.top} y2={H - M.bottom} stroke="var(--faint)" strokeDasharray="3 4" />
              <rect x={xMark.at - pill(xMark.text) / 2} y={H - M.bottom + 6} width={pill(xMark.text)} height={16} rx={8} fill="#fff" stroke="var(--faint)" strokeDasharray="2 2" />
              <text x={xMark.at} y={H - M.bottom + 14} dy="0.34em" textAnchor="middle" {...mono} fontWeight={600} fill="var(--sub)">{xMark.text}</text>
            </g>
          )}
          {yMark && (
            <g>
              <line x1={M.left} x2={W - M.right} y1={yMark.at} y2={yMark.at} stroke="var(--faint)" strokeDasharray="3 4" />
              <rect x={M.left - 4 - pill(yMark.text)} y={yMark.at - 8} width={pill(yMark.text)} height={16} rx={8} fill="#fff" stroke="var(--faint)" strokeDasharray="2 2" />
              <text x={M.left - 10} y={yMark.at} dy="0.34em" textAnchor="end" {...mono} fontWeight={600} fill="var(--sub)">{yMark.text}</text>
            </g>
          )}
          <text x={M.left} y={M.top - 12} fontSize={9.5} fontFamily="var(--font-mono)" fill="var(--sub)" letterSpacing="0.06em">
            ↑ {METRIC_NAME[axes.y].toUpperCase()}
            {!narrow && <tspan dx={8} letterSpacing="0" fill="var(--faint)" fontSize={11} style={{ fontFamily: 'var(--font-sans)' }}>{METRIC_MEANS[axes.y]}</tspan>}
          </text>
          <text x={W - M.right} y={H - 3} textAnchor="end" fontSize={9.5} fontFamily="var(--font-mono)" fill="var(--sub)" letterSpacing="0.06em">
            {!narrow && <tspan letterSpacing="0" fill="var(--faint)" fontSize={11} style={{ fontFamily: 'var(--font-sans)' }}>{METRIC_MEANS[axes.x]}</tspan>}
            <tspan dx={narrow ? 0 : 8}>{METRIC_NAME[axes.x].toUpperCase()} →</tspan>
          </text>
          {corner && (
            <text x={W - M.right - 12} y={M.top + 18} textAnchor="end" fontSize={9.5} fontFamily="var(--font-mono)" fill="var(--sub)" letterSpacing="0.06em">
              STRONGEST ↗
              <tspan x={W - M.right - 12} dy={14} letterSpacing="0" fill="var(--faint)" fontSize={11} style={{ fontFamily: 'var(--font-sans)' }}>{corner}</tspan>
            </text>
          )}
        </svg>

        {plotted.map((ad) => {
          const p = geometry.at.get(ad.id);
          const from = takeoffs.current.get(ad.id);
          if (!p || !from) return null;
          // Left to wait before this cover takes off; 0 once it has landed, so
          // later moves (a resize, a filter) start at once.
          const wait = Math.max(0, (from.at - performance.now()) / 1000);
          const selected = ad.id === selectedId;
          const isPicked = picked.has(ad.id);
          const faded = dimmed(ad);
          const done = ad.decode.status === 'done';
          return (
            <motion.button
              key={ad.id}
              type="button"
              aria-label={`${ad.advertiser ?? ad.handle ?? 'Unknown advertiser'}: ${METRIC_NAME[axes.y]} ${fmt(axes.y, ad.metrics[axes.y])}, ${METRIC_NAME[axes.x].toLowerCase()} ${fmt(axes.x, ad.metrics[axes.x])}${done ? ', decoded' : ''}`}
              aria-pressed={selected}
              onClick={() => onSelect(ad.id)}
              onPointerEnter={() => setHovered(ad.id)}
              onPointerLeave={() => setHovered((h) => (h === ad.id ? null : h))}
              onFocus={() => setHovered(ad.id)}
              onBlur={() => setHovered((h) => (h === ad.id ? null : h))}
              // Placed with transforms, so the flight, later moves and the
              // selection scale stay on the GPU. Only the flight waits its
              // turn; the selection scale answers a click at once.
              initial={{ x: from.x, y: from.y, opacity: 0 }}
              animate={{ x: p.x - T.w / 2, y: p.y - T.h / 2, scale: selected ? 1.35 : 1, opacity: faded ? 0.14 : 1 }}
              transition={{
                x: { duration: FLY_S, ease: EASE_FLY, delay: wait },
                y: { duration: FLY_S, ease: EASE_FLY, delay: wait },
                // Shows up on its tile at takeoff, then fades only for a format filter.
                opacity: { duration: wait > 0 ? 0.1 : 0.25, delay: wait },
                scale: { type: 'spring', stiffness: 320, damping: 32 },
              }}
              style={{ width: T.w, height: T.h, zIndex: selected ? 30 : isPicked ? 20 : done ? 10 : 1 }}
              className="absolute left-0 top-0 cursor-pointer rounded-[6px] outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {/* Leaves at its tile's size and shrinks on the way; the target never changes, so it does not replay. */}
              <motion.span
                initial={{ scale: from.scale }}
                animate={{ scale: 1 }}
                transition={{ duration: FLY_S, ease: EASE_FLY, delay: wait }}
                className={`relative block h-full w-full overflow-hidden rounded-[6px] bg-fill ${
                  selected
                    ? 'shadow-[0_0_0_2px_#fff,0_0_0_4px_var(--accent),0_8px_20px_rgba(10,132,255,.45)]'
                    : isPicked
                      ? 'shadow-[0_0_0_2px_#fff,0_0_0_3.5px_var(--accent)]'
                      : 'shadow-[0_0_0_1.5px_#fff,0_3px_8px_rgba(0,0,0,.2)]'
                }`}
              >
                <Cover ad={ad} className="h-full w-full" />
                {done && (
                  <span className="absolute right-[2px] top-[2px]">
                    <DecodedBadge size={narrow ? 9 : 11} />
                  </span>
                )}
                {ad.decode.status === 'running' && <span className="shimmer absolute inset-0 rounded-none opacity-80" />}
              </motion.span>
            </motion.button>
          );
        })}

        <AnimatePresence>
          {hoveredAd && hp && (
            <motion.div
              key={hoveredAd.id}
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              className="pointer-events-none absolute isolate z-40 w-[140px]"
              style={{
                left: hp.x + T.w / 2 + 150 > W ? hp.x - T.w / 2 - 150 : hp.x + T.w / 2 + 10,
                top: Math.min(Math.max(4, hp.y - 120), H - 256),
              }}
            >
              <Glow src={hoveredAd.cover} className="inset-x-3 bottom-[-10px] top-6 h-full w-[calc(100%-24px)]" />
              <div className="relative aspect-[9/16] w-full overflow-hidden rounded-[18px] bg-fill shadow-[0_0_0_1px_rgba(255,255,255,.6)]">
                <Cover ad={hoveredAd} className="absolute inset-0 h-full w-full" />
                <ProgressiveBlur className="top-[55%]" steps={3} max={14} />
                <span className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/60 to-transparent" />
                <div className="absolute inset-x-2.5 bottom-2.5 text-white">
                  <p className="truncate text-[12.5px] font-semibold" dir="auto">{hoveredAd.advertiser ?? hoveredAd.handle ?? 'Unknown advertiser'}</p>
                  <p className="mono mt-0.5 text-[9.5px] text-white/80">
                    {METRIC_NAME[axes.y]} {fmt(axes.y, hoveredAd.metrics[axes.y])} · {fmt(axes.x, hoveredAd.metrics[axes.x])} {METRIC_NAME[axes.x].toLowerCase()}
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {lasso && (
          <div
            className="pointer-events-none absolute z-50 rounded-[6px] border border-accent bg-accent/10"
            style={{ left: Math.min(lasso.x0, lasso.x1), top: Math.min(lasso.y0, lasso.y1), width: Math.abs(lasso.x1 - lasso.x0), height: Math.abs(lasso.y1 - lasso.y0) }}
          />
        )}

        {!plotted.length && (
          <div className="absolute inset-0 grid place-items-center">
            <p className="max-w-xs text-center text-sm text-sub">No numbers to plot yet. Scan the board and the ads land here as they arrive.</p>
          </div>
        )}
      </div>
      {/* The key: what the marks on the map mean. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-sub">
        <span className="flex items-center gap-1.5">
          <DecodedBadge size={14} />
          Decoded
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-[18px] w-[10px] rounded-[3px] bg-[linear-gradient(160deg,#e3e6ea,#b7bec8)] shadow-[0_0_0_1.5px_#fff,0_1px_3px_rgba(0,0,0,.25)]" aria-hidden />
          Not decoded yet
        </span>
        {xMark && yMark && geometry.mx !== null && geometry.my !== null && (
          <span className="flex items-center gap-1.5">
            <svg width="18" height="4" aria-hidden><line x1="0" x2="18" y1="2" y2="2" stroke="var(--faint)" strokeWidth="1.5" strokeDasharray="3 3" /></svg>
            Typical {noun}: {yMark.text} {metricUnit(axes.y, geometry.my)}, {xMark.text} {metricUnit(axes.x, geometry.mx)}
          </span>
        )}
        {missing > 0 && (
          <span className="text-faint">
            {missing} {missing === 1 ? `${noun} has` : `${noun}s have`} no numbers, so {missing === 1 ? 'it is' : 'they are'} not on the map
          </span>
        )}
      </div>
    </div>
  );
}
