import Link from 'next/link';
import { ItemCard } from '@/components/item-card';
import { loadLibrary, PAGE_SIZE, parseFilters } from '@/lib/library';
import { createClient } from '@/lib/supabase/server';
import { LibraryFilters } from './filters';

export default async function LibraryPage({ searchParams }: PageProps<'/library'>) {
  const params = await searchParams;
  const filters = parseFilters(params);
  const supabase = await createClient();
  const { items, total, totalAll, regions } = await loadLibrary(supabase, filters);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageHref = (page: number) => {
    const next = new URLSearchParams(Object.entries(params).flatMap(([k, v]) => (typeof v === 'string' ? [[k, v]] : [])));
    next.set('page', String(page));
    return `/library?${next.toString()}`;
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Library</h1>
          <p className="text-sm text-sub">
            {total === totalAll ? `${totalAll} classified items` : `${total} of ${totalAll} classified items match`}
          </p>
        </div>
        <Link href="/collect" className="btn-secondary">Import links</Link>
      </header>

      <LibraryFilters regions={regions} />

      {items.length === 0 ? (
        <div className="card p-8 text-center text-sm text-sub">
          {totalAll === 0 ? 'Nothing classified yet. Start a run from Collect.' : 'No items match these filters.'}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {items.map((item) => <ItemCard key={item.id} item={item} />)}
        </div>
      )}

      {pages > 1 && (
        <nav className="flex items-center justify-center gap-2 text-sm">
          {filters.page > 1 && <Link className="btn-secondary" href={pageHref(filters.page - 1)}>Previous</Link>}
          <span className="text-sub">Page {filters.page} of {pages}</span>
          {filters.page < pages && <Link className="btn-secondary" href={pageHref(filters.page + 1)}>Next</Link>}
        </nav>
      )}
    </div>
  );
}
