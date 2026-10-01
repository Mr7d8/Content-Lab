import { labelText, REGION_NAMES, sourceLabel } from '@content-lab/core';
import { createClient } from '@/lib/supabase/server';
import { ImportForm } from './import-form';
import { RunList } from './run-list';

export default async function CollectPage() {
  const supabase = await createClient();
  const [{ data: runs }, { data: watchlists }] = await Promise.all([
    supabase.from('runs').select('*').order('created_at', { ascending: false }).limit(25),
    supabase.from('watchlists').select('*').order('refresh_cadence').order('name'),
  ]);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Collect</h1>
        <p className="text-sm text-sub">Import ads by link, follow runs live, and keep spend under a cap.</p>
      </header>

      <ImportForm />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Runs</h2>
        <RunList initial={runs ?? []} />
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Watchlists</h2>
          <p className="text-sm text-sub">First sweep targets. Scheduled collection from watchlists comes in Phase 2.</p>
        </div>
        <div className="card divide-y divide-[var(--line)]">
          {(watchlists ?? []).map((w) => (
            <div key={w.id} className="flex flex-wrap items-center gap-2 px-5 py-3 text-sm">
              <span className="font-medium">{w.name}</span>
              <span className="chip">{sourceLabel(w.source)}</span>
              <span className="chip">{w.region ? (REGION_NAMES[w.region] ?? w.region) : 'Any region'}</span>
              <span className="chip">{w.objective ? labelText(w.objective) : 'All objectives'}</span>
              <span className="ml-auto text-xs text-faint">{labelText(w.refresh_cadence)}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
