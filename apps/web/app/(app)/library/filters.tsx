'use client';

import { FILTER_DIMENSIONS, labelText, LIST_DIMENSIONS, REGION_NAMES, SOURCES } from '@content-lab/core';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

const ALL_SELECTS = { ...FILTER_DIMENSIONS, ...LIST_DIMENSIONS };

export function LibraryFilters({ regions }: { regions: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('page');
    startTransition(() => router.push(`${pathname}?${next.toString()}`));
  };
  const active = [...params.keys()].filter((k) => k !== 'page');

  return (
    <div className={`card space-y-3 p-4 transition-opacity ${pending ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={`chip ${!params.get('source') ? 'active' : ''}`} onClick={() => set('source', '')}>All sources</button>
        {Object.entries(SOURCES).filter(([, s]) => s.phase === 1).map(([id, s]) => (
          <button key={id} type="button" className={`chip ${params.get('source') === id ? 'active' : ''}`} onClick={() => set('source', params.get('source') === id ? '' : id)}>
            {s.label}
          </button>
        ))}
        <button type="button" className={`chip ${params.get('review') === '1' ? 'active' : ''}`} onClick={() => set('review', params.get('review') === '1' ? '' : '1')}>
          Needs review
        </button>
        {active.length > 0 && (
          <button type="button" className="chip ml-auto" onClick={() => startTransition(() => router.push(pathname))}>Clear filters</button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5">
        {Object.entries(ALL_SELECTS).map(([key, dim]) => (
          <label key={key} className="text-[11px] font-medium text-faint">
            {dim.title}
            <select className="field mt-1 !py-1.5 text-xs" value={params.get(key) ?? ''} onChange={(e) => set(key, e.target.value)}>
              <option value="">Any</option>
              {Object.entries(dim.options).map(([value, description]) => (
                <option key={value} value={value} title={description}>{labelText(value)}</option>
              ))}
              {key in FILTER_DIMENSIONS && <option value="unknown">Unknown</option>}
            </select>
          </label>
        ))}
        <label className="text-[11px] font-medium text-faint">
          Region
          <select className="field mt-1 !py-1.5 text-xs" value={params.get('region') ?? ''} onChange={(e) => set('region', e.target.value)}>
            <option value="">Any</option>
            {regions.map((r) => <option key={r} value={r}>{REGION_NAMES[r] ?? r}</option>)}
          </select>
        </label>
        <label className="text-[11px] font-medium text-faint">
          Advertiser
          <input
            className="field mt-1 !py-1.5 text-xs"
            defaultValue={params.get('q') ?? ''}
            placeholder="Search"
            onKeyDown={(e) => { if (e.key === 'Enter') set('q', e.currentTarget.value.trim()); }}
            onBlur={(e) => { if (e.target.value.trim() !== (params.get('q') ?? '')) set('q', e.target.value.trim()); }}
          />
        </label>
      </div>
    </div>
  );
}
