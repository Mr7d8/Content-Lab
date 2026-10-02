'use client';

import { estimateScan, labelText } from '@content-lab/core';
import { AnimatePresence, motion } from 'motion/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { createBoard } from '@/app/(app)/b/actions';
import { CADENCES, cadenceText, OBJECTIVES, PERIODS, REGION_OPTIONS, regionLabel } from '@/lib/watchlists';

type Source = 'tiktok_creative_center' | 'tiktok_organic';

const SEARCHES: Record<Source, { type: string; label: string; placeholder: string }[]> = {
  tiktok_creative_center: [
    { type: 'industry', label: 'Top ads', placeholder: '' },
    { type: 'advertiser', label: 'Advertiser', placeholder: 'Noon' },
    { type: 'keyword', label: 'Keyword', placeholder: 'تخفيضات' },
  ],
  tiktok_organic: [
    { type: 'keyword', label: 'Keyword', placeholder: 'skincare routine' },
    { type: 'hashtag', label: 'Hashtag', placeholder: 'tiktokmaroc' },
    { type: 'account', label: 'Account', placeholder: 'jumia_ma' },
  ],
};

function Segmented<T extends string | number>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="mono text-faint">{label}</p>
      {children}
    </div>
  );
}

// The New board dialog: what to watch, then the first scan starts right away.
export function NewBoardDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [source, setSource] = useState<Source>('tiktok_creative_center');
  const [type, setType] = useState('industry');
  const [value, setValue] = useState('');
  const [region, setRegion] = useState('MA');
  const [objective, setObjective] = useState<string>('purchase');
  const [period, setPeriod] = useState<number>(30);
  const [ads, setAds] = useState(30);
  const [cadence, setCadence] = useState<string>('weekly');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const searches = SEARCHES[source];
  const search = searches.find((s) => s.type === type) ?? (searches[0] as (typeof searches)[number]);
  const needsValue = !(source === 'tiktok_creative_center' && search.type === 'industry');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const form = new FormData();
    form.set('source', source);
    form.set('type', search.type);
    form.set('value', needsValue ? value : 'all');
    form.set('region', region);
    if (source === 'tiktok_creative_center' && objective) form.set('objective', objective);
    form.set('period_days', String(period));
    form.set('max_items', String(ads));
    form.set('refresh_cadence', cadence);
    form.set('name', name);
    start(async () => {
      const result = await createBoard(form);
      if (!result.ok || !result.id) {
        setError(result.ok ? 'The board was not created.' : result.message);
        return;
      }
      // The first scan starts now; the board picks it up when it opens.
      await fetch(`/api/boards/${result.id}/scan`, { method: 'POST' }).catch(() => null);
      onClose();
      router.push(`/b/${result.id}`);
    });
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/20 p-3 backdrop-blur-md sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onPointerDown={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.form
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-board-title"
            onSubmit={submit}
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            className="liquid max-h-[calc(100dvh-24px)] w-full max-w-[560px] space-y-5 overflow-y-auto rounded-[28px] !bg-white/[.93] p-5 sm:p-6"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="mono text-faint">New board</p>
                <h2 id="new-board-title" className="mt-1 text-2xl font-semibold tracking-tight">What should we watch?</h2>
              </div>
              <button type="button" className="chip" onClick={onClose} aria-label="Close">✕</button>
            </div>

            <Field label="Source">
              <Segmented
                label="Source"
                value={source}
                onChange={(s) => {
                  setSource(s);
                  setType(SEARCHES[s][0]?.type ?? 'keyword');
                }}
                options={[{ value: 'tiktok_creative_center', label: 'Top ads (Creative Center)' }, { value: 'tiktok_organic', label: 'Organic TikTok' }]}
              />
            </Field>

            <Field label="Search">
              <div className="flex flex-wrap items-center gap-2">
                <Segmented label="Search by" value={search.type} onChange={setType} options={searches.map((s) => ({ value: s.type, label: s.label }))} />
              </div>
              {needsValue ? (
                <input
                  className="field mt-2"
                  required
                  maxLength={100}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={search.placeholder}
                  aria-label={search.label}
                  dir="auto"
                />
              ) : (
                <p className="mt-1 text-xs text-sub">The best performing ads across every industry, for the country and objective below.</p>
              )}
            </Field>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Country">
                <select className="field" value={region} onChange={(e) => setRegion(e.target.value)} aria-label="Country">
                  <option value="">Any region</option>
                  {REGION_OPTIONS.map((r) => <option key={r} value={r}>{regionLabel(r)}</option>)}
                </select>
              </Field>
              {source === 'tiktok_creative_center' && (
                <Field label="Objective">
                  <Segmented label="Objective" value={objective} onChange={setObjective} options={[{ value: '', label: 'All' }, ...OBJECTIVES.map((o) => ({ value: o, label: labelText(o) }))]} />
                </Field>
              )}
              {source === 'tiktok_creative_center' && (
                <Field label="Period">
                  <Segmented label="Period" value={period} onChange={setPeriod} options={PERIODS.map((p) => ({ value: p, label: `${p} days` }))} />
                </Field>
              )}
              <Field label="Schedule">
                <Segmented label="Schedule" value={cadence} onChange={setCadence} options={CADENCES.map((c) => ({ value: c, label: c === 'manual' ? 'Manual' : cadenceText(c).replace('Every ', 'Each ') }))} />
              </Field>
            </div>

            <Field label={`Ads per scan · ${ads}`}>
              <input type="range" min={10} max={50} step={5} value={ads} onChange={(e) => setAds(Number(e.target.value))} className="w-full accent-[var(--accent)]" aria-label="Ads per scan" />
              <p className="text-xs text-faint">About ${estimateScan(ads).toFixed(2)} per scan. Decoding is separate and only when you ask.</p>
            </Field>

            <Field label="Name (optional)">
              <input className="field" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Filled in from the search and country" dir="auto" />
            </Field>

            {error && <p className="text-sm text-red" role="alert">{error}</p>}
            <div className="flex items-center justify-end gap-2 pt-1">
              <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={pending || (needsValue && !value.trim())}>
                {pending ? 'Creating…' : 'Create and scan'}
              </button>
            </div>
          </motion.form>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
