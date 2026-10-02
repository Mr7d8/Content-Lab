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

// Starts a scan and streams its ads in: the server pulls each new page of the
// Apify dataset on every call, and the board refreshes when ads arrive.
export function useScan(boardId: string, scan: ScanState | null) {
  const router = useRouter();
  const [view, setView] = useState<ScanView>(() => initialView(scan));
  // One polling loop at a time; a loop stops when this no longer points at it.
  const loop = useRef<{ runId: string } | null>(null);

  const follow = useCallback(async (runId: string) => {
    if (loop.current?.runId === runId) return;
    const me = { runId };
    loop.current = me;
    let misses = 0;
    while (loop.current === me) {
      try {
        const res = await fetch(`/api/scans/${runId}/sync`, { method: 'POST' });
        const body = (await res.json()) as { ok: boolean; message?: string; status?: string; synced?: number; requested?: number; added?: number; done?: boolean; error?: string | null };
        if (loop.current !== me) return;
        if (!body.ok) throw new Error(body.message ?? 'Sync failed');
        misses = 0;
        if (body.added) router.refresh();
        if (body.done) {
          setView({ phase: body.status === 'failed' ? 'failed' : 'completed', synced: body.synced ?? 0, requested: body.requested ?? 0, error: body.error ?? null });
          router.refresh();
          loop.current = null;
          return;
        }
        setView({ phase: 'running', synced: body.synced ?? 0, requested: body.requested ?? 0, error: null });
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
    if (scan?.status === 'running') void follow(scan.id);
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
      const body = (await res.json()) as { ok: true; runId: string } | { ok: false; message: string };
      if (!body.ok) {
        setView((v) => ({ ...v, phase: 'failed', error: body.message }));
        return;
      }
      setView({ phase: 'running', synced: 0, requested: 0, error: null });
      router.refresh();
      void follow(body.runId);
    } catch (e) {
      setView((v) => ({ ...v, phase: 'failed', error: (e as Error).message }));
    }
  }, [boardId, follow, router]);

  return { view, start };
}
