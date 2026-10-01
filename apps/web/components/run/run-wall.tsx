'use client';

import { labelText, sourceLabel } from '@content-lab/core';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { RunViewItem } from '@/lib/run-view';
import { STAGE_TEXT, xValue } from '@/lib/run-view';
import { useSelection } from '@/lib/selection-store';

function matchesFilter(item: RunViewItem, filter: { field: string; value: string } | null): boolean {
  if (!filter) return true;
  if (!item.labels) return false;
  const v = xValue(item.labels, filter.field as never);
  return (v ?? 'unknown') === filter.value;
}

// Thumbnails pop into the grid as frames arrive; label chips fade in as each
// classification lands. `visible` lets Replay drive what has "happened" yet.
export function RunWall({ items, visible }: { items: RunViewItem[]; visible?: { thumbs: Set<string>; labels: Set<string> } }) {
  const reduce = useReducedMotion();
  const { hovered, filter, setHovered, toggleFilter } = useSelection();
  const shown = visible ? items.filter((i) => visible.thumbs.has(i.id) || visible.labels.has(i.id)) : items;

  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-8">
      <AnimatePresence initial={!reduce}>
        {shown.map((item) => {
          const showThumb = item.thumb && (!visible || visible.thumbs.has(item.id));
          const showLabels = item.labels && (!visible || visible.labels.has(item.id));
          const dim = (filter && !matchesFilter(item, filter)) || (hovered !== null && hovered !== item.id && !filter);
          return (
            <motion.div
              key={item.id}
              layout={!reduce}
              initial={reduce ? false : { opacity: 0, scale: 0.85, y: 8 }}
              animate={{ opacity: dim ? 0.28 : 1, scale: 1, y: 0 }}
              transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 320, damping: 26 }}
              onMouseEnter={() => setHovered(item.id)}
              onMouseLeave={() => setHovered(null)}
              className={`card relative overflow-hidden ${hovered === item.id ? 'ring-2 ring-[var(--accent)]' : ''}`}
            >
              <div className="relative aspect-[9/16] bg-fill">
                {showThumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.thumb as string} alt={item.advertiser ?? 'Keyframe'} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-1 p-2 text-center">
                    <span className={`h-2 w-2 rounded-full ${item.status === 'needs_review' ? 'bg-[var(--orange)]' : 'bg-accent'} motion-safe:animate-pulse`} />
                    <span className="text-[10px] text-faint">{item.status === 'needs_review' ? 'Needs review' : (STAGE_TEXT[item.stage] ?? 'Queued')}</span>
                  </div>
                )}
                <span className="absolute left-1.5 top-1.5 rounded-full bg-black/50 px-1.5 text-[9px] font-semibold text-white">{sourceLabel(item.source)}</span>
                {item.percentile !== null && showLabels && (
                  <span className="absolute bottom-1.5 right-1.5 rounded-full bg-black/55 px-1.5 text-[9px] font-semibold text-white">P{Math.round(item.percentile)}</span>
                )}
              </div>
              <div className="min-h-[52px] space-y-1 p-1.5">
                <p className="truncate text-[10px] font-semibold">{item.advertiser ?? ' '}</p>
                <div className="flex flex-wrap gap-1">
                  <AnimatePresence initial={!reduce}>
                    {showLabels && item.labels && (['hook_type', 'format', 'objective'] as const).map((field, i) => (
                      <motion.button
                        type="button"
                        key={field}
                        initial={reduce ? false : { opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={reduce ? { duration: 0 } : { delay: 0.12 * i, duration: 0.35 }}
                        onClick={() => toggleFilter({ field, value: item.labels?.[field] ?? 'unknown' })}
                        className={`chip !px-1.5 !py-0 !text-[9px] ${filter?.field === field && filter.value === (item.labels?.[field] ?? 'unknown') ? 'active' : ''}`}
                        title={`Filter by ${labelText(item.labels?.[field])}`}
                      >
                        {labelText(item.labels?.[field])}
                      </motion.button>
                    ))}
                  </AnimatePresence>
                </div>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
