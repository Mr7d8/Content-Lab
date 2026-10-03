'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScanState } from '@/lib/board';

export type ScanView = {
  phase: 'idle' | 'starting' | 'running' | 'completed' | 'failed';
  // The scraper's rows read so far, out of requested (0 until the run says).
  synced: number;
  requested: number;
  error: string | null;
};

const POLL_MS = 2500;

function initialView(scan: ScanState | null): ScanView {
  if (!scan) return { phase: 'idle', synced: 0, requested: 0, error: null };
  const counts = { synced: scan.synced, requested: scan.requested };
  if (scan.status === 'running') return { phase: 'running', ...counts, error: null };
  if (scan.status === 'failed') return { phase: 'failed', ...counts, error: scan.error };
  return { phase: 'completed', ...counts, error: null };
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

type RunState = { synced: number; requested: number; done: boolean; status: string; error: string | null };
type SyncBody = { ok: boolean; message?: string; status?: string; synced?: number; requested?: number; added?: number; done?: boolean; error?: string | null };

// Starts a scan and streams its ads in: the server pulls each new page of the
// Apify datasets on every call, and the board refreshes when ads arrive. A
// board with several searches runs one scraper each; their progress adds up.
export function useScan(boardId: string, scan: ScanState | null) {
  const router = useRouter();
  const [view, setView] = useState<ScanView>(() => initialView(scan));
  // One polling loop at a time; a loop stops when this no longer points at it.
  const loop = useRef<{ key: string } | null>(null);

  const follow = useCallback(async (runIds: string[]) => {
    const key = runIds.join(',');
    if (!runIds.length || loop.current?.key === key) return;
    const me = { key };
    loop.current = me;
    const runs = new Map<string, RunState>();
    let misses = 0;
    while (loop.current === me) {
      try {
        const pending = runIds.filter((id) => !runs.get(id)?.done);
        const bodies = await Promise.all(pending.map((id) => fetch(`/api/scans/${id}/sync`, { method: 'POST' }).then((res) => res.json() as Promise<SyncBody>)));
        if (loop.current !== me) return;
        let added = false;
        bodies.forEach((body, i) => {
          if (!body.ok) throw new Error(body.message ?? 'Sync failed');
          if (body.added) added = true;
          runs.set(pending[i] as string, { synced: body.synced ?? 0, requested: body.requested ?? 0, done: !!body.done, status: body.status ?? 'running', error: body.error ?? null });
        });
        misses = 0;
        const all = runIds.map((id) => runs.get(id) as RunState);
        const synced = all.reduce((n, r) => n + r.synced, 0);
        const requested = all.reduce((n, r) => n + r.requested, 0);
        if (all.every((r) => r.done)) {
          const failed = all.every((r) => r.status === 'failed');
          setView({ phase: failed ? 'failed' : 'completed', synced, requested, error: failed ? (all.find((r) => r.error)?.error ?? null) : null });
          router.refresh();
          loop.current = null;
          return;
        }
        if (added) router.refresh();
        setView({ phase: 'running', synced, requested, error: null });
      } catch (e) {
        if (++misses >= 4) {
          setView((v) => ({ ...v, phase: 'failed', error: `Lost track of the scan: ${(e as Error).message}. Reload to try again.` }));
          loop.current = null;
          return;
        }
      }
      await pause(POLL_MS * (misses + 1));
    }
  }, [router]);

  // Pick up a scan that was already running when the board opened.
  useEffect(() => {
    setView(initialView(scan));
    if (scan?.status === 'running') void follow(scan.runIds);
    return () => {
      loop.current = null;
    };
    // Only when the board or its latest scan changes, not on every refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId, scan?.id]);

  const start = useCallback(async () => {
    setView((v) => ({ ...v, phase: 'starting', synced: 0, requested: 0, error: null }));
    try {
      const res = await fetch(`/api/boards/${boardId}/scan`, { method: 'POST' });
      const body = (await res.json()) as { ok: true; runIds: string[] } | { ok: false; message: string };
      if (!body.ok) {
        setView((v) => ({ ...v, phase: 'failed', error: body.message }));
        return;
      }
      setView({ phase: 'running', synced: 0, requested: 0, error: null });
      router.refresh();
      void follow(body.runIds);
    } catch (e) {
      setView((v) => ({ ...v, phase: 'failed', error: (e as Error).message }));
    }
  }, [boardId, follow, router]);

  return { view, start };
}
