'use client';

import { labelText } from '@content-lab/core';
import { scaleBand, scaleLinear } from 'd3-scale';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  bandDomain,
  jitter,
  MAP_X,
  type MapX,
  OBJECTIVE_COLORS,
  objectiveColor,
  type RunViewItem,
  tickText,
  xValue,
} from '@/lib/run-view';
import { useSelection } from '@/lib/selection-store';

const H = 400;

// Scatter of every classified item: x is a chosen label or seconds to reveal,
// y is the percentile inside its own source. Dots fly in as scores arrive.
export function PerformanceMap({ items, visible }: { items: RunViewItem[]; visible?: Set<string> }) {
  const reduce = useReducedMotion();
  const [x, setX] = useState<MapX>('hook_type');
  const [table, setTable] = useState(false);
  const { hovered, filter, setHovered, toggleFilter } = useSelection();
  const kind = MAP_X[x].kind;
  // Drawn at the real container width so text stays legible on a phone.
  const wrap = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(820);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setW(Math.max(300, Math.round(entry?.contentRect.width ?? 820))));
    observer.observe(el);
    return () => observer.disconnect();
  }, [table]);
  const narrow = W < 560;
  const M = { top: 16, right: 12, bottom: narrow ? 92 : 64, left: 40 };

  const plotted = useMemo(
    () => items.filter((i) => i.labels && i.percentile !== null && (!visible || visible.has(i.id))).map((i) => ({ item: i, value: xValue(i.labels!, x) })),
    [items, visible, x],
  );
  const classified = items.filter((i) => i.labels && (!visible || visible.has(i.id))).length;
  const unranked = classified - plotted.length;

  const y = scaleLinear().domain([0, 100]).range([H - M.bottom, M.top]);
  const domain = kind === 'band' ? bandDomain(plotted.map((p) => p.value as string | null), x) : [];
  const band = scaleBand<string>().domain(domain).range([M.left, W - M.right]).padding(0.18);
  const maxSeconds = Math.max(5, ...plotted.map((p) => (typeof p.value === 'number' ? p.value : 0)));
  const linear = scaleLinear().domain([0, Math.ceil(maxSeconds)]).range([M.left + 8, W - M.right - 8]).nice();
  const position = (p: { item: RunViewItem; value: string | number | null }): number | null => {
    if (kind === 'band') {
      const start = band((p.value as string | null) ?? 'unknown');
      return start === undefined ? null : start + band.bandwidth() * (0.15 + 0.7 * jitter(p.item.id));
    }
    return typeof p.value === 'number' ? linear(p.value) : null;
  };
  const inFilter = (p: { item: RunViewItem }) => !filter || (p.item.labels ? String(xValue(p.item.labels, filter.field as MapX) ?? 'unknown') === filter.value : false);
  const hoveredPoint = plotted.find((p) => p.item.id === hovered);

  return (
    <div className="card space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="eyebrow mr-1">Performance map</p>
        <select className="field !w-auto !py-1 text-xs" value={x} onChange={(e) => setX(e.target.value as MapX)} aria-label="X axis">
          {Object.entries(MAP_X).map(([key, v]) => <option key={key} value={key}>{v.title}</option>)}
        </select>
        <div className="flex w-full flex-wrap items-center gap-3 text-[11px] text-sub sm:ml-auto sm:w-auto" aria-label="Legend: objective">
          {(['app_install', 'purchase', 'other'] as const).map((k) => (
            <span key={k} className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: OBJECTIVE_COLORS[k] }} />
              {k === 'other' ? 'Other objective' : labelText(k)}
            </span>
          ))}
          <button type="button" className="chip !py-0.5 !text-[11px]" onClick={() => setTable((t) => !t)}>{table ? 'Show chart' : 'Show table'}</button>
        </div>
      </div>

      {table ? (
        <div className="max-h-[400px] overflow-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-faint"><tr><th className="py-1">Advertiser</th><th>{MAP_X[x].title}</th><th>Objective</th><th className="text-right">Percentile</th></tr></thead>
            <tbody>
              {plotted.map((p) => (
                <tr key={p.item.id} className="border-t border-[var(--line)]">
                  <td className="py-1">{p.item.advertiser ?? 'Unknown'}</td>
                  <td>{typeof p.value === 'number' ? `${p.value} s` : tickText(p.value ?? 'unknown')}</td>
                  <td>{labelText(p.item.labels?.objective)}</td>
                  <td className="text-right">{p.item.percentile}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative" ref={wrap}>
          <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block max-w-full" role="img" aria-label={`Percentile by ${MAP_X[x].title}`}>
            {[0, 25, 50, 75, 100].map((t) => (
              <g key={t}>
                <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} stroke="var(--line)" />
                <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--faint)">{t}</text>
              </g>
            ))}
            <line x1={M.left} x2={W - M.right} y1={y(75)} y2={y(75)} stroke="var(--faint)" strokeDasharray="3 4" />
            <text x={W - M.right} y={y(75) - 6} textAnchor="end" fontSize={10} fill="var(--faint)">Top quartile</text>
            <text transform={`translate(12 ${(H - M.bottom + M.top) / 2}) rotate(-90)`} textAnchor="middle" fontSize={11} fill="var(--sub)">Percentile within source</text>

            {kind === 'band'
              ? domain.map((d) => {
                  const active = filter?.field === x && filter.value === d;
                  return (
                    <g key={d} transform={`translate(${(band(d) ?? 0) + band.bandwidth() / 2} ${H - M.bottom + 14})`}>
                      <text
                        textAnchor="end" transform={`rotate(${narrow ? -55 : -28})`} fontSize={11} cursor="pointer"
                        fill={active ? 'var(--accent)' : 'var(--sub)'} fontWeight={active ? 600 : 400}
                        onClick={() => toggleFilter({ field: x, value: d })}
                      >
                        {tickText(d)}
                      </text>
                    </g>
                  );
                })
              : linear.ticks(6).map((t) => (
                  <text key={t} x={linear(t)} y={H - M.bottom + 18} textAnchor="middle" fontSize={11} fill="var(--sub)">{t}s</text>
                ))}

            {plotted.map((p) => {
              const cx = position(p);
              if (cx === null) return null;
              const cy = y(p.item.percentile as number);
              const dimmed = !inFilter(p) || (hovered !== null && hovered !== p.item.id && !filter);
              return (
                <g key={p.item.id} onMouseEnter={() => setHovered(p.item.id)} onMouseLeave={() => setHovered(null)}>
                  <motion.circle
                    initial={reduce ? false : { cx, cy: H - M.bottom, opacity: 0 }}
                    animate={{ cx, cy, opacity: dimmed ? 0.2 : 1 }}
                    transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 120, damping: 16 }}
                    r={hovered === p.item.id ? 7 : 5}
                    fill={objectiveColor(p.item.labels?.objective)}
                    stroke="#fff"
                    strokeWidth={2}
                  />
                  <circle cx={cx} cy={cy} r={11} fill="transparent" />
                </g>
              );
            })}
          </svg>
          {hoveredPoint && position(hoveredPoint) !== null && (
            <div
              className="glass pointer-events-none absolute z-10 whitespace-nowrap rounded-[12px] px-3 py-2 text-xs"
              style={{
                left: position(hoveredPoint) as number,
                top: y(hoveredPoint.item.percentile as number),
                // Keep the tooltip inside the card near either edge.
                transform: `translate(${(position(hoveredPoint) as number) > W * 0.75 ? '-100%' : (position(hoveredPoint) as number) < W * 0.25 ? '0%' : '-50%'}, calc(-100% - 12px))`,
              }}
            >
              <p className="font-semibold">{hoveredPoint.item.advertiser ?? 'Unknown advertiser'}</p>
              <p className="text-sub">
                {typeof hoveredPoint.value === 'number' ? `${hoveredPoint.value} s` : tickText((hoveredPoint.value as string | null) ?? 'unknown')}
                {' · '}P{Math.round(hoveredPoint.item.percentile as number)}
                {hoveredPoint.item.metric && ` · ${Intl.NumberFormat('en', { notation: 'compact' }).format(hoveredPoint.item.metric.value)} ${hoveredPoint.item.metric.name}`}
              </p>
            </div>
          )}
        </div>
      )}
      <p className="text-[11px] text-faint">
        {plotted.length} plotted
        {unranked > 0 && ` · ${unranked} classified without a rankable metric (need 3 or more per source)`}
        {filter && <> · filtered on {labelText(filter.field)}: {tickText(filter.value)}</>}
        {kind === 'linear' && ' · items where it never appears are left out'}
      </p>
    </div>
  );
}
