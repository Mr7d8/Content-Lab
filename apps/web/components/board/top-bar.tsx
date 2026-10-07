'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { saveBudget } from '@/app/(app)/b/actions';
import type { BoardSummary } from '@/lib/board';
import { meterState } from '@/lib/watchlists';
import { Popover } from './popover';

export function Mark() {
  return (
    <span aria-hidden className="grid h-7 w-7 grid-cols-2 gap-[2px] rounded-[8px] bg-ink p-[5px]">
      <span className="rounded-[2px] bg-white" />
      <span className="rounded-[2px] bg-white/45" />
      <span className="rounded-[2px] bg-white/45" />
      <span className="rounded-[2px] bg-accent" />
    </span>
  );
}

function BoardSwitcher({ boards, currentId, onNew }: { boards: BoardSummary[]; currentId: string | null; onNew: () => void }) {
  const current = boards.find((b) => b.id === currentId);
  return (
    <Popover
      label="Switch board"
      width={320}
      className="chip max-w-[46vw] !bg-transparent !px-2 hover:!bg-[var(--fill)] sm:max-w-[360px]"
      button={
        <>
          <span className="truncate font-semibold">{current?.name ?? 'Boards'}</span>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className="shrink-0 text-faint"><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        </>
      }
    >
      {(close) => (
        <div className="space-y-1">
          <p className="mono px-2 pb-1 pt-1.5 text-faint">Boards</p>
          <div className="max-h-[50vh] space-y-0.5 overflow-y-auto">
            {boards.map((b) => (
              <Link
                key={b.id}
                href={`/b/${b.id}`}
                onClick={close}
                className={`flex items-center gap-3 rounded-[10px] px-2 py-2 text-sm transition-colors hover:bg-[var(--fill)] ${b.id === currentId ? 'bg-[var(--fill)]' : ''}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{b.name}</span>
                  <span className="block text-xs text-faint">{b.sources}</span>
                </span>
                <span className="mono tabular-nums text-sub">{b.ads}</span>
              </Link>
            ))}
          </div>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-[10px] px-2 py-2 text-left text-sm font-medium text-accent hover:bg-[var(--fill)]"
            onClick={() => {
              close();
              onNew();
            }}
          >
            <span aria-hidden className="grid h-5 w-5 place-items-center rounded-full bg-accent text-xs text-white">+</span>
            New board
          </button>
        </div>
      )}
    </Popover>
  );
}

function SpendChip({ spend }: { spend: { month: number; cap: number; sweepsEnabled: boolean } }) {
  const router = useRouter();
  const meter = meterState(spend.month, spend.cap);
  const [cap, setCap] = useState(String(spend.cap));
  const [sweeps, setSweeps] = useState(spend.sweepsEnabled);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const color = meter.level === 'over' ? 'var(--red)' : meter.level === 'warn' ? 'var(--orange)' : 'var(--accent)';
  return (
    <Popover
      label={`Spend this month: $${spend.month.toFixed(2)} of $${spend.cap.toFixed(2)}`}
      align="right"
      width={300}
      button={
        <>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
            <circle cx="7" cy="7" r="5.5" fill="none" stroke="var(--fill-strong)" strokeWidth="2.5" />
            <circle cx="7" cy="7" r="5.5" fill="none" stroke={color} strokeWidth="2.5" strokeDasharray={`${meter.ratio * 34.6} 34.6`} transform="rotate(-90 7 7)" strokeLinecap="round" />
          </svg>
          <span className="tabular-nums">${spend.month.toFixed(2)}</span>
          <span className="hidden text-faint sm:inline">of ${spend.cap.toFixed(0)}</span>
        </>
      }
    >
      {() => (
        <form
          className="space-y-3 p-2"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await saveBudget(Number(cap), sweeps);
              setMessage(r.ok ? 'Saved' : r.message);
              if (r.ok) router.refresh();
            });
          }}
        >
          <div>
            <p className="mono text-faint">This month</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">${spend.month.toFixed(2)} <span className="text-base font-normal text-faint">of ${spend.cap.toFixed(2)}</span></p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--fill)]">
              <div className="h-full rounded-full" style={{ width: `${meter.ratio * 100}%`, background: color }} />
            </div>
            <p className="mt-1.5 text-xs text-sub">{meter.label}. Scans and decodes both count.</p>
          </div>
          <label className="block space-y-1">
            <span className="mono text-faint">Monthly cap (USD)</span>
            <input className="field" type="number" min={0} max={1000} step={1} value={cap} onChange={(e) => setCap(e.target.value)} />
          </label>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>Daily scheduled scans</span>
            <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={sweeps} onChange={(e) => setSweeps(e.target.checked)} />
          </label>
          <div className="flex items-center gap-2">
            <button type="submit" className="btn-primary !py-1.5" disabled={pending}>{pending ? 'Saving…' : 'Save'}</button>
            {message && <span className="text-xs text-sub" role="status">{message}</span>}
          </div>
        </form>
      )}
    </Popover>
  );
}

// Admins only: the team access page, with the requests waiting.
function AccessChip({ pending }: { pending: number }) {
  return (
    <Link href="/admin" className="chip hover:bg-white/85" title="Team access" aria-label={pending ? `Team access: ${pending} waiting` : 'Team access'}>
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
        <circle cx="5.5" cy="4.5" r="2.3" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path d="M1.5 12c.4-2.3 2-3.6 4-3.6s3.6 1.3 4 3.6M11 4.5v3M9.5 6h3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
      <span className="hidden sm:inline">Access</span>
      {pending > 0 && <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-red px-1 text-[10.5px] font-semibold tabular-nums text-white">{pending}</span>}
    </Link>
  );
}

export function TopBar({ boards, currentId, spend, access, onNew }: { boards: BoardSummary[]; currentId: string | null; spend: { month: number; cap: number; sweepsEnabled: boolean } | null; access: { pending: number } | null; onNew: () => void }) {
  return (
    <header className="sticky top-0 z-40 px-3 pt-3 sm:px-5">
      <div className="liquid-bar mx-auto flex max-w-[1440px] items-center gap-1.5 rounded-full py-1.5 pl-2 pr-1.5">
        <Link href="/b" className="flex items-center gap-2 rounded-full pr-1 text-[15px] font-semibold tracking-tight" aria-label="Content Lab">
          <Mark />
          <span className="hidden md:inline">Content Lab</span>
        </Link>
        <span aria-hidden className="mx-1 hidden h-4 w-px bg-[var(--line)] md:block" />
        <BoardSwitcher boards={boards} currentId={currentId} onNew={onNew} />
        <div className="ml-auto flex items-center gap-1.5">
          <button type="button" className="chip hidden sm:inline-flex" onClick={onNew}>+ New board</button>
          {access && <AccessChip pending={access.pending} />}
          {spend && <SpendChip spend={spend} />}
          <form action="/auth/signout" method="post">
            <button type="submit" className="chip" aria-label="Sign out" title="Sign out">
              <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden><path d="M5.5 2H3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h2.5M9 4.5 11.5 7 9 9.5M11.5 7H5.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
