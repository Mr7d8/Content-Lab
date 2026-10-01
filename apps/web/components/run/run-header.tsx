'use client';

import { formatUsd, labelText } from '@content-lab/core';
import { StatusBadge } from '@/components/status-badge';
import type { RunView } from '@/lib/run-view';
import { useSelection } from '@/lib/selection-store';

export function RunHeader({ view, title, right }: { view: RunView; title: string; right?: React.ReactNode }) {
  const { filter, clear } = useSelection();
  const classified = view.items.filter((i) => i.labels).length;
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="eyebrow">{title}</p>
        <h1 className="text-2xl font-semibold tracking-tight">
          {classified} of {view.items.length} classified
        </h1>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-sub">
          <StatusBadge status={view.run.status} />
          <span>Spent {formatUsd(view.run.costActual)} of {formatUsd(view.run.spendCap)}</span>
          {filter && (
            <button type="button" className="chip active !py-0.5" onClick={clear}>
              {labelText(filter.field)}: {labelText(filter.value)} ×
            </button>
          )}
        </div>
      </div>
      {right}
    </header>
  );
}
