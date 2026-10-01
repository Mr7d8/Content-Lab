import { notFound } from 'next/navigation';
import { ReplayRun } from '@/components/run/replay-run';
import { loadRunView } from '@/lib/run-data';
import { createClient } from '@/lib/supabase/server';

export default async function ReplayPage({ params }: PageProps<'/runs/[id]/replay'>) {
  const { id } = await params;
  const supabase = await createClient();
  // Signed for 3 hours so a long recording session never loses its frames.
  const view = await loadRunView(supabase, id, 3 * 3600);
  if (!view) notFound();
  return <ReplayRun view={view} />;
}
