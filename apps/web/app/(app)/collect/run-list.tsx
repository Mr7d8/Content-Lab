'use client';

import type { Tables } from '@content-lab/core';
import { formatUsd } from '@content-lab/core';
import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';
import { StatusBadge } from '@/components/status-badge';
import { browserClient } from '@/lib/supabase/browser';
import { pauseRun, resumeRun } from './actions';

type Run = Tables<'runs'>;

// Run history with live progress through Supabase Realtime.
export function RunList({ initial, watchlistNames = {} }: { initial: Run[]; watchlistNames?: Record<string, string> }) {
  const [runs, setRuns] = useState(initial);
  const [notice, setNotice] = useState('');
  const [busy, startTransition] = useTransition();

  useEffect(() => setRuns(initial), [initial]);

  useEffect(() => {
    const channel = browserClient()
      .channel('runs-progress')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'runs' }, (payload) => {
        const row = payload.new as Run;
        if (!row?.id) return;
        setRuns((current) => {
          const rest = current.filter((r) => r.id !== row.id);
          return [row, ...rest].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 25);
        });
      })
      .subscribe();
    return () => {
      void browserClient().removeChannel(channel);
    };
  }, []);

  if (!runs.length) return <p className="card p-5 text-sm text-sub">No runs yet. Use Research now on a watchlist, or paste links below.</p>;

  return (
    <div className="card divide-y divide-[var(--line)]">
      {notice && <p className="px-5 py-3 text-xs text-sub">{notice}</p>}
      {runs.map((run) => {
        const progress = run.items_requested ? Math.min(1, (run.items_done + run.items_failed) / run.items_requested) : 0;
        const canPause = (run.status === 'running' || run.status === 'queued') && !run.pause_requested;
        const canResume = ['paused', 'partial', 'failed'].includes(run.status) || (run.status === 'running' && run.pause_requested);
        // Watchlist runs start empty while the source is searched.
        const searching = !!run.watchlist_id && run.items_requested === 0 && (run.status === 'running' || run.status === 'queued');
        const nothingNew = !!run.watchlist_id && run.items_requested === 0 && run.status === 'completed';
        return (
          <div key={run.id} className="grid gap-2 px-5 py-4 sm:grid-cols-[1fr_auto] sm:items-center">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <StatusBadge status={run.pause_requested && run.status === 'running' ? 'pausing' : run.status} />
                <span className="text-sm font-medium">
                  {searching ? 'Searching for top ads...' : nothingNew ? 'No new ads' : `${run.items_done}/${run.items_requested} items`}
                  {run.items_failed > 0 && <span className="text-orange"> · {run.items_failed} need review</span>}
                </span>
                {run.trigger === 'schedule' && <span className="chip">Scheduled</span>}
                <span className="text-xs text-faint">{new Date(run.created_at).toLocaleString()}</span>
              </div>
              {run.watchlist_id && (
                <p className="mt-1 truncate text-xs text-sub">
                  Research: {watchlistNames[run.watchlist_id] ?? 'removed watchlist'}
                  {nothingNew && ' · its top ads are already in the Library'}
                </p>
              )}
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-fill">
                <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${progress * 100}%` }} />
              </div>
              <p className="mt-1.5 text-xs text-sub">
                Spent {formatUsd(Number(run.cost_actual_usd))} of {formatUsd(Number(run.spend_cap_usd))} cap
                {run.cost_estimate_usd !== null && <> · estimate {formatUsd(Number(run.cost_estimate_usd))}</>}
                {run.error && <span className="text-red"> · {run.error}</span>}
              </p>
            </div>
            <div className="flex gap-2">
              <Link href={`/runs/${run.id}/live`} className="btn-secondary">Live</Link>
              {['completed', 'partial'].includes(run.status) && (
                <Link href={`/runs/${run.id}/replay`} className="btn-secondary">Replay</Link>
              )}
              {canPause && (
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busy}
                  onClick={() => startTransition(async () => { await pauseRun(run.id); setNotice('Pause requested. The current item finishes first.'); })}
                >
                  Pause
                </button>
              )}
              {canResume && (
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busy}
                  onClick={() => startTransition(async () => setNotice(await resumeRun(run.id)))}
                >
                  Resume
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
