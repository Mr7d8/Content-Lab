import { createClient } from '@/lib/supabase/server';
import { AddWatchlist } from './add-watchlist';
import { ImportForm } from './import-form';
import { SpendCard, WatchlistTable } from './research';
import { RunList } from './run-list';

export default async function CollectPage() {
  const supabase = await createClient();
  const [{ data: runs }, { data: watchlists }, { data: settings }, { data: spend }] = await Promise.all([
    supabase.from('runs').select('*').order('created_at', { ascending: false }).limit(25),
    supabase.from('watchlists').select('*').order('refresh_cadence').order('name'),
    supabase.from('app_settings').select('*').maybeSingle(),
    supabase.rpc('month_spend_usd'),
  ]);
  const watchlistNames = Object.fromEntries((watchlists ?? []).map((w) => [w.id, w.name]));

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Collect</h1>
        <p className="text-sm text-sub">Research watchlists automatically, import ads by link, and keep spend under a cap.</p>
      </header>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Research mode</h2>
          <p className="text-sm text-sub">
            A daily sweep refreshes each watchlist on its schedule and keeps its best new ads, tagged. Research now runs one immediately.
          </p>
        </div>
        {settings ? (
          <>
            <SpendCard settings={settings} monthSpend={Number(spend ?? 0)} />
            <WatchlistTable watchlists={watchlists ?? []} now={new Date().toISOString()} />
            <AddWatchlist />
          </>
        ) : (
          <p className="card p-5 text-sm text-sub">
            Research mode needs one more database step: run <code>supabase/migrations/20261002000000_research_mode.sql</code> in
            the Supabase SQL editor, then reload this page.
          </p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Runs</h2>
        <RunList initial={runs ?? []} watchlistNames={watchlistNames} />
      </section>

      <ImportForm />
    </div>
  );
}
