'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

const CONCURRENCY = 4;

// Decodes ads on request, four at a time. Each call is one ad (15 to 40 s);
// the board refreshes as each one lands.
export function useDecodeQueue() {
  const router = useRouter();
  const [active, setActive] = useState<ReadonlySet<string>>(new Set());
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(new Map());
  // Finished here but maybe not yet in the refreshed board data.
  const [finished, setFinished] = useState<ReadonlySet<string>>(new Set());
  const [batch, setBatch] = useState({ total: 0, done: 0 });
  const queue = useRef<string[]>([]);
  const busy = useRef(new Set<string>());
  const running = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshSoon = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => router.refresh(), 500);
  }, [router]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const pump = useCallback(() => {
    while (running.current < CONCURRENCY && queue.current.length) {
      const id = queue.current.shift() as string;
      running.current++;
      void (async () => {
        let error: string | null = null;
        try {
          const res = await fetch(`/api/decode/${id}`, { method: 'POST' });
          const body = (await res.json().catch(() => null)) as { ok: boolean; message?: string } | null;
          if (!body) error = `The decode stopped (HTTP ${res.status}). Try again.`;
          else if (!body.ok) error = body.message ?? 'The decode failed.';
        } catch (e) {
          error = (e as Error).message;
        }
        running.current--;
        busy.current.delete(id);
        setActive(new Set(busy.current));
        setErrors((m) => {
          const next = new Map(m);
          if (error) next.set(id, error);
          else next.delete(id);
          return next;
        });
        if (!error) setFinished((f) => new Set(f).add(id));
        setBatch((b) => (busy.current.size ? { ...b, done: b.done + 1 } : { total: 0, done: 0 }));
        refreshSoon();
        pump();
      })();
    }
  }, [refreshSoon]);

  const decode = useCallback((ids: string[]) => {
    const fresh = ids.filter((id) => !busy.current.has(id));
    if (!fresh.length) return;
    for (const id of fresh) busy.current.add(id);
    queue.current.push(...fresh);
    setActive(new Set(busy.current));
    setErrors((m) => {
      const next = new Map(m);
      for (const id of fresh) next.delete(id);
      return next;
    });
    setBatch((b) => ({ total: b.total + fresh.length, done: b.done }));
    pump();
  }, [pump]);

  return { active, errors, finished, batch, decode };
}
