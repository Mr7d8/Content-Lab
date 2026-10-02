'use client';

import { DISCOVERY_SOURCES, labelText, sourceLabel, WATCHLIST_TYPES, type DiscoverySource } from '@content-lab/core';
import { useActionState, useState } from 'react';
import { cadenceText, CADENCES, OBJECTIVES, REGION_OPTIONS, regionLabel, TYPE_LABELS } from '@/lib/watchlists';
import { addWatchlist, type FormState } from './research-actions';

const PLACEHOLDER: Record<string, string> = {
  advertiser: 'Noon',
  industry: 'ecommerce',
  keyword: 'تخفيضات',
  hashtag: 'tiktokmaroc',
  account: 'jumia_ma',
};

export function AddWatchlist() {
  const [state, action, pending] = useActionState(addWatchlist, { ok: false, message: '' } as FormState);
  const [source, setSource] = useState<DiscoverySource>('tiktok_creative_center');
  const types = WATCHLIST_TYPES[source];
  const [type, setType] = useState<string>(types[0] as string);
  const shownType = types.includes(type) ? type : (types[0] as string);

  return (
    <details className="card p-5">
      <summary className="cursor-pointer text-sm font-semibold">Add watchlist</summary>
      <form action={action} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs text-sub">
          Source
          <select name="source" className="field mt-1" value={source} onChange={(e) => setSource(e.target.value as DiscoverySource)}>
            {DISCOVERY_SOURCES.map((s) => <option key={s} value={s}>{sourceLabel(s)}</option>)}
          </select>
        </label>
        <label className="text-xs text-sub">
          Search by
          <select name="type" className="field mt-1" value={shownType} onChange={(e) => setType(e.target.value)}>
            {types.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
          </select>
        </label>
        <label className="text-xs text-sub sm:col-span-2">
          {TYPE_LABELS[shownType]}
          <input name="value" required maxLength={100} placeholder={PLACEHOLDER[shownType]} className="field mt-1" />
        </label>
        <label className="text-xs text-sub">
          Region
          <select name="region" className="field mt-1" defaultValue="">
            <option value="">Any region</option>
            {REGION_OPTIONS.map((r) => <option key={r} value={r}>{regionLabel(r)}</option>)}
          </select>
        </label>
        {source === 'tiktok_creative_center' && (
          <label className="text-xs text-sub">
            Objective
            <select name="objective" className="field mt-1" defaultValue="">
              <option value="">All objectives</option>
              {OBJECTIVES.map((o) => <option key={o} value={o}>{labelText(o)}</option>)}
            </select>
          </label>
        )}
        <label className="text-xs text-sub">
          Schedule
          <select name="refresh_cadence" className="field mt-1" defaultValue="weekly">
            {CADENCES.map((c) => <option key={c} value={c}>{cadenceText(c)}</option>)}
          </select>
        </label>
        <label className="text-xs text-sub">
          Ads per sweep
          <input name="max_items" type="number" min={1} max={50} defaultValue={10} className="field mt-1" />
        </label>
        <label className="text-xs text-sub sm:col-span-2">
          Name (optional)
          <input name="name" maxLength={80} placeholder="Filled in from the search and region" className="field mt-1" />
        </label>
        <div className="flex items-end gap-3 sm:col-span-2">
          <button type="submit" className="btn-primary" disabled={pending}>{pending ? 'Adding...' : 'Add watchlist'}</button>
          {state.message && <p className={`text-xs ${state.ok ? 'text-sub' : 'text-red'}`} role="status">{state.message}</p>}
        </div>
      </form>
    </details>
  );
}
