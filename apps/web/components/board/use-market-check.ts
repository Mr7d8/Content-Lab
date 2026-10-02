'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

export type MarketCheckView = { running: boolean; checked: number; error: string | null };

type Body = { ok: true; checked: number; pending: number; done: boolean } | { ok: false; message: string };

const MAX_ROUNDS = 8;

// Runs the Moroccan check while a gated board has ads waiting: one batch per
// call, the board refreshing after each, until none wait. The scan webhook
// runs it too; ads are claimed, so the two never check the same ad twice.
export function useMarketCheck(boardId: string, waiting: number, enabled: boolean): MarketCheckView {
  const router = useRouter();
  const [view, setView] = useState<MarketCheckView>({ running: false, checked: 0, error: null });
  const busy = useRef(false);

  useEffect(() => {
    if (!enabled || waiting === 0 || busy.current) return;
    busy.current = true;
    let stopped = false;
    void (async () => {
      setView({ running: true, checked: 0, error: null });
      let checked = 0;
      for (let round = 0; round < MAX_ROUNDS && !stopped; round++) {
        let body: Body | null = null;
        try {
          const res = await fetch(`/api/boards/${boardId}/check`, { method: 'POST' });
          body = (await res.json().catch(() => null)) as Body | null;
          if (!body) body = { ok: false, message: `The check stopped (HTTP ${res.status}).` };
        } catch (e) {
          body = { ok: false, message: (e as Error).message };
        }
        if (stopped) return;
        if (!body.ok) {
          setView({ running: false, checked, error: body.message });
          break;
        }
        checked += body.checked;
        router.refresh();
        // Nothing claimable this round: another check holds the rest.
        if (body.done || body.checked === 0) {
          setView({ running: false, checked, error: null });
          break;
        }
        setView({ running: true, checked, error: null });
      }
      busy.current = false;
    })();
    return () => {
      stopped = true;
      busy.current = false;
    };
  }, [boardId, waiting, enabled, router]);

  return view;
}
