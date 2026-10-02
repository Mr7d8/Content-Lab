'use client';

import { formatUsd, labelText, sourceLabel, type Tables } from '@content-lab/core';
import { useActionState, useState, useTransition } from 'react';
import { cadenceText, CADENCES, meterState, regionLabel, scheduleText, sweptText, TYPE_LABELS } from '@/lib/watchlists';
import { deleteWatchlist, researchNow, saveResearchSettings, updateWatchlist, type FormState } from './research-actions';

type Watchlist = Tables<'watchlists'>;
type Settings = Tables<'app_settings'>;

const FILL = { ok: 'var(--accent)', warn: 'var(--orange)', over: 'var(--red)' } as const;

// This month's paid spend against the monthly cap, plus the budget settings.
export function SpendCard({ settings, monthSpend }: { settings: Settings; monthSpend: number }) {
  const cap = Number(settings.monthly_spend_cap_usd);
  const state = meterState(monthSpend, cap);
  const fill = FILL[state.level];
  const [saved, save, saving] = useActionState(saveResearchSettings, { ok: false, message: '' } as FormState);

  return (
    <div className="card space-y-3 p-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="eyebrow">Spent this month</p>
          <p className="text-2xl font-semibold">
            {formatUsd(monthSpend)} <span className="text-sm font-normal text-sub">of {formatUsd(cap)} cap</span>
          </p>
        </div>
        <p className="text-xs text-sub">
          {state.label}
          {!settings.sweeps_enabled && ' · Daily sweep is off'}
        </p>
      </div>
      <div
        role="meter"
        aria-label="Paid spend this month"
        aria-valuemin={0}
        aria-valuemax={cap}
        aria-valuenow={Number(monthSpend.toFixed(2))}
        aria-valuetext={`${formatUsd(monthSpend)} of ${formatUsd(cap)}. ${state.label}`}
        className="h-2 overflow-hidden rounded-full"
        style={{ background: `color-mix(in srgb, ${fill} 18%, transparent)` }}
      >
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: monthSpend > 0 ? `max(4px, ${state.ratio * 100}%)` : 0, background: fill }}
        />
      </div>
      <p className="text-xs text-faint">Counts every run this month (Apify and Jev), since they share the free credit. Groq and Gemini are free.</p>

      <details className="text-sm">
        <summary className="cursor-pointer text-xs font-medium text-sub">Budget settings</summary>
        <form action={save} className="mt-3 flex flex-wrap items-end gap-3">
          <label className="flex flex-col text-xs text-sub">
            Monthly cap (USD)
            <input name="monthly_spend_cap_usd" type="number" min="0" step="0.5" defaultValue={cap} className="field mt-1 w-28" />
          </label>
          <label className="flex flex-col text-xs text-sub">
            Per-sweep cap (USD)
            <input name="sweep_spend_cap_usd" type="number" min="0.05" step="0.05" defaultValue={Number(settings.sweep_spend_cap_usd)} className="field mt-1 w-28" />
          </label>
          <label className="flex items-center gap-2 pb-2 text-xs text-sub">
            <input name="sweeps_enabled" type="checkbox" defaultChecked={settings.sweeps_enabled} />
            Daily sweep on
          </label>
          <button type="submit" className="btn-secondary" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
          {saved.message && <p className={`pb-2 text-xs ${saved.ok ? 'text-sub' : 'text-red'}`} role="status">{saved.message}</p>}
        </form>
      </details>
    </div>
  );
}

// Watchlists with their schedule, and Research now.
export function WatchlistTable({ watchlists, now }: { watchlists: Watchlist[]; now: string }) {
  const [notice, setNotice] = useState('');
  const [busy, startTransition] = useTransition();
  const at = new Date(now);
  const run = (fn: () => Promise<string | null>) => startTransition(async () => setNotice((await fn()) ?? ''));

  if (!watchlists.length) return <p className="card p-5 text-sm text-sub">No watchlists yet. Add one below.</p>;

  return (
    <div className="card divide-y divide-[var(--line)]">
      {notice && <p className="px-5 py-3 text-xs text-sub" role="status">{notice}</p>}
      {watchlists.map((w) => (
        <div key={w.id} className={`grid gap-3 px-5 py-4 lg:grid-cols-[1fr_auto] lg:items-center ${w.active ? '' : 'opacity-60'}`}>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{w.name}</span>
              <span className="chip">{sourceLabel(w.source)}</span>
              <span className="chip">{TYPE_LABELS[w.type] ?? w.type}: {w.value}</span>
              <span className="chip">{regionLabel(w.region)}</span>
              {w.source === 'tiktok_creative_center' && <span className="chip">{w.objective ? labelText(w.objective) : 'All objectives'}</span>}
            </div>
            <p className="mt-1 text-xs text-sub">
              {sweptText(w.last_swept_at, at)} · {scheduleText(w, at)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label={`Schedule for ${w.name}`}
              className="field w-auto py-1.5 text-xs"
              value={w.refresh_cadence}
              disabled={busy}
              onChange={(e) => run(() => updateWatchlist(w.id, { refresh_cadence: e.target.value }))}
            >
              {CADENCES.map((c) => <option key={c} value={c}>{cadenceText(c)}</option>)}
            </select>
            <label className="flex items-center gap-1.5 text-xs text-sub">
              Ads
              <input
                type="number"
                min={1}
                max={50}
                defaultValue={w.max_items}
                aria-label={`Ads per sweep for ${w.name}`}
                className="field w-16 py-1.5 text-xs"
                onBlur={(e) => {
                  const n = Number(e.target.value);
                  if (n !== w.max_items) run(() => updateWatchlist(w.id, { max_items: n }));
                }}
              />
            </label>
            <button
              type="button"
              className={`chip ${w.active ? 'active' : ''}`}
              aria-pressed={w.active}
              disabled={busy}
              onClick={() => run(() => updateWatchlist(w.id, { active: !w.active }))}
            >
              {w.active ? 'On' : 'Off'}
            </button>
            <button type="button" className="btn-primary" disabled={busy || !w.active} onClick={() => run(() => researchNow(w.id))}>
              Research now
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Remove "${w.name}"? Ads it collected stay in the Library.`)) run(() => deleteWatchlist(w.id));
              }}
            >
              Remove
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
