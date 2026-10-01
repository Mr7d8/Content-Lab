export function SetupNotice() {
  return (
    <main className="mx-auto max-w-lg px-4 py-24">
      <div className="card p-6">
        <p className="eyebrow">Setup</p>
        <h1 className="mt-1 text-xl font-semibold">Connect Supabase</h1>
        <p className="mt-2 text-sm text-sub">
          Add <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to{' '}
          <code>apps/web/.env.local</code> (or the Vercel project settings), then reload. Run{' '}
          <code>pnpm run doctor</code> to check every key.
        </p>
      </div>
    </main>
  );
}
