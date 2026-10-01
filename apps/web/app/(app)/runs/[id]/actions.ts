'use server';

import { loadRunView } from '@/lib/run-data';
import type { RunView } from '@/lib/run-view';
import { createClient } from '@/lib/supabase/server';

// Called by the live wall when Realtime reports progress on this run.
export async function refreshRunView(runId: string): Promise<RunView | null> {
  const supabase = await createClient();
  return loadRunView(supabase, runId);
}
