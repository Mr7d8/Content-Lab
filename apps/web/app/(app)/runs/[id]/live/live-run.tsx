'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { PerformanceMap } from '@/components/run/performance-map';
import { RunHeader } from '@/components/run/run-header';
import { RunWall } from '@/components/run/run-wall';
import type { RunView } from '@/lib/run-view';
import { useSelection } from '@/lib/selection-store';
import { browserClient } from '@/lib/supabase/browser';
import { refreshRunView } from '../actions';

// Keeps the first signed URL per item so images do not reload on every refresh.
function merge(previous: RunView, next: RunView): RunView {
  const thumbs = new Map(previous.items.map((i) => [i.id, i.thumb]));
  return { ...next, items: next.items.map((i) => ({ ...i, thumb: thumbs.get(i.id) ?? i.thumb })) };
}

export function LiveRun({ initial }: { initial: RunView }) {
  const [view, setView] = useState(initial);
  const ids = useRef(new Set(initial.items.map((i) => i.id)));
  const clear = useSelection((s) => s.clear);

  useEffect(() => clear, [clear]);

  useEffect(() => {
    const runId = initial.run.id;
    const client = browserClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const next = await refreshRunView(runId);
        if (next) {
          ids.current = new Set(next.items.map((i) => i.id));
          setView((prev) => merge(prev, next));
        }
      }, 700);
    };
    const channel = client
      .channel(`run-${runId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'run_items', filter: `run_id=eq.${runId}` }, refresh)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'runs', filter: `id=eq.${runId}` }, refresh)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'classifications' }, (payload) => {
        if (ids.current.has((payload.new as { item_id?: string }).item_id ?? '')) refresh();
      })
      .subscribe();
    return () => {
      clearTimeout(timer);
      void client.removeChannel(channel);
    };
  }, [initial.run.id]);

  const finished = ['completed', 'partial'].includes(view.run.status);
  return (
    <div className="space-y-5">
      <RunHeader
        view={view}
        title="Live run"
        right={
          <div className="flex gap-2">
            <Link href="/collect" className="btn-secondary">Collect</Link>
            {finished && <Link href={`/runs/${view.run.id}/replay`} className="btn-primary">Replay</Link>}
          </div>
        }
      />
      <RunWall items={view.items} />
      <PerformanceMap items={view.items} />
    </div>
  );
}
