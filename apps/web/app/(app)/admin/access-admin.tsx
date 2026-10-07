'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Mark } from '@/components/board/top-bar';
import { acceptRequest, declineRequest, type DecideResult } from './actions';

type Row = { email: string; when: string };

function Initial({ email }: { email: string }) {
  return (
    <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--fill)] text-[13px] font-semibold uppercase text-sub">
      {email[0]}
    </span>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mono flex items-center gap-2 px-1 text-faint">
        {title}
        <span className="tabular-nums">{count}</span>
      </h2>
      <div className="card mt-2 divide-y divide-[var(--line)] overflow-hidden">{children}</div>
    </section>
  );
}

function Person({ email, when, children }: Row & { children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Initial email={email} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{email}</p>
        <p className="text-xs text-faint">{when}</p>
      </div>
      {children && <div className="flex shrink-0 items-center gap-1.5">{children}</div>}
    </div>
  );
}

export function AccessAdmin({ pending, declined, team }: { pending: Row[]; declined: Row[]; team: (Row & { admin: boolean })[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  // Kept here, above the rows: the row goes once the page refreshes.
  const [notice, setNotice] = useState<DecideResult | null>(null);
  const [, start] = useTransition();

  const decide = (email: string, action: (email: string) => Promise<DecideResult>) => {
    setBusy(email);
    setNotice(null);
    start(async () => {
      const result = await action(email);
      setNotice(result);
      setBusy(null);
      if (result.ok) router.refresh();
    });
  };
  const accept = (email: string) => (
    <button type="button" className="btn-primary !px-3.5 !py-1.5" disabled={!!busy} onClick={() => decide(email, acceptRequest)}>
      {busy === email ? 'Accepting...' : 'Accept'}
    </button>
  );

  return (
    <>
      <header className="sticky top-0 z-40 px-3 pt-3 sm:px-5">
        <div className="liquid-bar mx-auto flex max-w-3xl items-center gap-1.5 rounded-full py-1.5 pl-2 pr-1.5">
          <Link href="/b" className="flex items-center gap-2 rounded-full pr-1 text-[15px] font-semibold tracking-tight" aria-label="Content Lab">
            <Mark />
            <span className="hidden sm:inline">Content Lab</span>
          </Link>
          <span aria-hidden className="mx-1 h-4 w-px bg-[var(--line)]" />
          <span className="text-sm font-semibold">Team access</span>
          <Link href="/b" className="chip ml-auto">Back to boards</Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 pb-24 pt-10 sm:px-6">
        <p className="mono text-faint">Admin</p>
        <h1 className="mt-2 text-[32px] font-semibold leading-tight tracking-[-0.03em]">Team access</h1>
        <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-sub">
          People who tried to sign in with an email that is not on the team. Accept puts them on the team and emails them a sign-in link.
        </p>
        {notice && (
          <p role="status" className={`mt-5 rounded-[12px] px-4 py-3 text-sm ${notice.ok ? 'bg-[var(--fill)]' : 'bg-red/10 text-red'}`}>
            {notice.message}
          </p>
        )}

        <Section title="Requests" count={pending.length}>
          {pending.length ? pending.map((r) => (
            <Person key={r.email} {...r}>
              <button type="button" className="btn-secondary !px-3.5 !py-1.5" disabled={!!busy} onClick={() => decide(r.email, declineRequest)}>
                Decline
              </button>
              {accept(r.email)}
            </Person>
          )) : <p className="px-4 py-6 text-sm text-sub">No one is waiting.</p>}
        </Section>

        {declined.length > 0 && (
          <Section title="Declined" count={declined.length}>
            {declined.map((r) => <Person key={r.email} {...r}>{accept(r.email)}</Person>)}
          </Section>
        )}

        <Section title="Team" count={team.length}>
          {team.map((m) => (
            <Person key={m.email} email={m.email} when={m.when}>
              {m.admin && <span className="badge bg-ink">Admin</span>}
            </Person>
          ))}
        </Section>
      </main>
    </>
  );
}
