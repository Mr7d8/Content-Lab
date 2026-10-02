'use client';

import { scaleLinear, scaleLog } from 'd3-scale';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { axesFor, formatCount, median, spreadPoints, type BoardAd } from '@/lib/board-view';
import { Cover } from './cover';

const AXIS_NAME = { likes: 'Likes', views: 'Views', ctr: 'CTR' } as const;

function logTicks(domain: [number, number]): number[] {
  const out: number[] = [];
  for (let t = 10 ** Math.ceil(Math.log10(domain[0])); t <= domain[1]; t *= 10) out.push(t);
  return out;
}

const fmt = (axis: 'likes' | 'views' | 'ctr', v: number | undefined) => (v === undefined ? '–' : axis === 'ctr' ? v.toFixed(2) : formatCount(v));

type Rect = { x0: number; y0: number; x1: number; y1: number };

// Every ad as its cover, placed by its two numbers. Undecoded ads are gray;
// a format filter dims the rest. Drag across the map to pick ads to decode.
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
  const M = { top: 28, right: 18, bottom: 34, left: narrow ? 36 : 44 };

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
      yTicks = logTicks(yDomain);
    } else {
      const s = scaleLinear().domain([0, Math.max(1, ...ys)]).range(inner).nice();
      y = s;
      yTicks = s.ticks(4);
    }
    const placed = spreadPoints(
      plotted.map((a) => ({ id: a.id, x: x(Math.max(1, a.metrics[axes.x] as number)), y: y(a.metrics[axes.y] as number) })),
      T.w * 0.78,
      T.h * 0.62,
      { x0: M.left + T.w / 2, x1: W - M.right - T.w / 2, y0: M.top + T.h / 2, y1: H - M.bottom - T.h / 2 },
      narrow ? 10 : 16,
    );
    const ticks = logTicks(xDomain);
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
  const decoded = ads.some((a) => a.decode.status === 'done');

  return (
    <div className="card min-w-0 p-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="mr-auto">
          <p className="mono text-faint">Performance map</p>
          <p className="mt-0.5 text-sm font-medium">{AXIS_NAME[axes.y]} against {AXIS_NAME[axes.x].toLowerCase()}, every {source === 'tiktok_organic' ? 'post' : 'ad'}</p>
        </div>
        <div className="mono flex items-center gap-3 text-faint">
          <span className="flex items-center gap-1.5"><span className="h-3 w-2 rounded-[2px] bg-accent" />Decoded</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-2 rounded-[2px] bg-[#c7c7cc]" />Not yet</span>
          {!touch && <span className="hidden sm:inline">Drag to select</span>}
        </div>
      </div>

      <div
        ref={wrap}
        className={`relative mt-3 select-none ${lasso ? 'cursor-crosshair' : ''}`}
        style={{ height: H }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => setLasso(null)}
      >
        <svg width={W} height={H} className="absolute inset-0" aria-hidden>
          <rect x={M.left} y={M.top} width={Math.max(0, W - M.left - M.right)} height={Math.max(0, H - M.top - M.bottom)} rx={12} fill="rgba(120,120,128,.045)" />
          {geometry.yTicks.map((t) => (
            <g key={`y${t}`}>
              <line x1={M.left} x2={W - M.right} y1={geometry.y(t)} y2={geometry.y(t)} stroke="var(--line)" />
              <text x={M.left - 8} y={geometry.y(t)} dy="0.32em" textAnchor="end" fontSize={10} fontFamily="var(--font-mono)" fill="var(--faint)">
                {axes.y === 'ctr' ? t.toFixed(2).replace(/\.?0+$/, '') || '0' : formatCount(t)}
              </text>
            </g>
          ))}
          {geometry.xTicks.map((t) => (
            <g key={`x${t}`}>
              <line x1={geometry.x(t)} x2={geometry.x(t)} y1={M.top} y2={H - M.bottom} stroke="var(--line)" />
              <text x={geometry.x(t)} y={H - M.bottom + 16} textAnchor="middle" fontSize={10} fontFamily="var(--font-mono)" fill="var(--faint)">{formatCount(t)}</text>
            </g>
          ))}
          {geometry.mx !== null && (
            <>
              <line x1={geometry.x(geometry.mx)} x2={geometry.x(geometry.mx)} y1={M.top} y2={H - M.bottom} stroke="var(--faint)" strokeDasharray="3 4" />
              <text x={geometry.x(geometry.mx) + 5} y={H - M.bottom - 6} fontSize={9.5} fontFamily="var(--font-mono)" fill="var(--faint)">
                MEDIAN {fmt(axes.x, geometry.mx)}
              </text>
            </>
          )}
          {geometry.my !== null && (
            <>
              <line x1={M.left} x2={W - M.right} y1={geometry.y(geometry.my)} y2={geometry.y(geometry.my)} stroke="var(--faint)" strokeDasharray="3 4" />
              <text x={W - M.right - 6} y={geometry.y(geometry.my) - 6} textAnchor="end" fontSize={9.5} fontFamily="var(--font-mono)" fill="var(--faint)">
                MEDIAN {fmt(axes.y, geometry.my)}
              </text>
            </>
          )}
          <text x={M.left} y={M.top - 12} fontSize={9.5} fontFamily="var(--font-mono)" fill="var(--sub)" letterSpacing="0.06em">↑ {AXIS_NAME[axes.y].toUpperCase()}</text>
          <text x={W - M.right} y={H - 4} textAnchor="end" fontSize={9.5} fontFamily="var(--font-mono)" fill="var(--sub)" letterSpacing="0.06em">
            {AXIS_NAME[axes.x].toUpperCase()}, LOG SCALE →
          </text>
          <text x={W - M.right - 10} y={M.top + 16} textAnchor="end" fontSize={9.5} fontFamily="var(--font-mono)" fill="var(--faint)" letterSpacing="0.06em">
            {axes.y === 'ctr' ? 'HIGH CTR, MANY LIKES' : 'MANY VIEWS, MANY LIKES'}
          </text>
        </svg>

        {plotted.map((ad, i) => {
          const p = geometry.at.get(ad.id);
          if (!p) return null;
          const selected = ad.id === selectedId;
          const isPicked = picked.has(ad.id);
          const faded = dimmed(ad);
          const color = ad.decode.status === 'done';
          return (
            <motion.button
              key={ad.id}
              type="button"
              aria-label={`${ad.advertiser ?? ad.handle ?? 'Unknown advertiser'}: ${AXIS_NAME[axes.y]} ${fmt(axes.y, ad.metrics[axes.y])}, ${AXIS_NAME[axes.x].toLowerCase()} ${fmt(axes.x, ad.metrics[axes.x])}${color ? ', decoded' : ''}`}
              aria-pressed={selected}
              onClick={() => onSelect(ad.id)}
              onPointerEnter={() => setHovered(ad.id)}
              onPointerLeave={() => setHovered((h) => (h === ad.id ? null : h))}
              onFocus={() => setHovered(ad.id)}
              onBlur={() => setHovered((h) => (h === ad.id ? null : h))}
              initial={{ opacity: 0, scale: 0.4 }}
              animate={{ opacity: faded ? 0.14 : 1, scale: selected ? 1.35 : 1, left: p.x - T.w / 2, top: p.y - T.h / 2 }}
              transition={{ type: 'spring', stiffness: 260, damping: 24, delay: Math.min(i * 0.012, 0.4) }}
              style={{ width: T.w, height: T.h, zIndex: selected ? 30 : isPicked ? 20 : color ? 10 : 1 }}
              className={`absolute overflow-hidden rounded-[5px] bg-fill outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                selected
                  ? 'shadow-[0_0_0_2px_#fff,0_0_0_3.5px_var(--accent),0_6px_16px_rgba(0,0,0,.25)]'
                  : isPicked
                    ? 'shadow-[0_0_0_2px_var(--accent)]'
                    : 'shadow-[0_0_0_1.5px_#fff,0_2px_6px_rgba(0,0,0,.18)]'
              }`}
            >
              <Cover ad={ad} className={`h-full w-full ${color ? '' : 'opacity-80'}`} gray={!color} />
              {ad.decode.status === 'running' && <span className="shimmer absolute inset-0 rounded-none opacity-80" />}
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
              className="pointer-events-none absolute z-40 w-[132px] rounded-[12px] bg-card p-1.5 shadow-[var(--shadow)]"
              style={{
                left: hp.x + T.w / 2 + 140 > W ? hp.x - T.w / 2 - 140 : hp.x + T.w / 2 + 8,
                top: Math.min(Math.max(4, hp.y - 110), H - 230),
              }}
            >
              <Cover ad={hoveredAd} className="aspect-[9/16] w-full rounded-[8px]" />
              <p className="mt-1.5 truncate px-0.5 text-xs font-semibold" dir="auto">{hoveredAd.advertiser ?? hoveredAd.handle ?? 'Unknown advertiser'}</p>
              <p className="mono px-0.5 pb-0.5 text-sub">
                {AXIS_NAME[axes.y]} {fmt(axes.y, hoveredAd.metrics[axes.y])} · {fmt(axes.x, hoveredAd.metrics[axes.x])} {AXIS_NAME[axes.x].toLowerCase()}
              </p>
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
      <p className="mt-2 text-xs text-faint">
        {decoded ? 'Color covers are decoded. ' : 'Covers turn to color once decoded. '}
        {missing > 0 ? `${missing} ${missing === 1 ? 'ad has' : 'ads have'} no numbers and stay off the map.` : ''}
      </p>
    </div>
  );
}
