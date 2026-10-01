import { notFound } from 'next/navigation';
import { loadRunView } from '@/lib/run-data';
import { createClient } from '@/lib/supabase/server';
import { LiveRun } from './live-run';

export default async function LivePage({ params }: PageProps<'/runs/[id]/live'>) {
  const { id } = await params;
  const supabase = await createClient();
  const view = await loadRunView(supabase, id);
  if (!view) notFound();
  return <LiveRun initial={view} />;
}
