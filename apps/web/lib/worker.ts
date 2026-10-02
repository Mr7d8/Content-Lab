import 'server-only';
import { startWorkerActor } from './apify';
import { apifyEnv } from './env';
import type { ServerClient } from './supabase/server';

// Starts the Apify worker for a run and records the outcome on the run.
export async function startWorker(supabase: ServerClient, runId: string): Promise<string> {
  const env = apifyEnv();
  if (!env) return `Worker not started: set APIFY_TOKEN and APIFY_WORKER_ACTOR_ID, or run it locally with: pnpm worker:dev --run ${runId}`;
  const started = await startWorkerActor(runId, env);
  if (!started.ok) {
    await supabase.from('runs').update({ error: started.message }).eq('id', runId);
    return started.message;
  }
  await supabase.from('runs').update({ worker_run_id: started.workerRunId, error: null }).eq('id', runId);
  return 'Worker started on Apify.';
}
