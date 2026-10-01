// Starts the worker actor for a run. The actor reads the run from Supabase,
// so its only input is the run id.
export async function startWorkerActor(
  runId: string,
  env: { token: string; workerActorId: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; workerRunId: string } | { ok: false; message: string }> {
  const actor = encodeURIComponent(env.workerActorId);
  try {
    const res = await fetchImpl(`https://api.apify.com/v2/acts/${actor}/runs?memory=1024`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      const hint = res.status === 401 || res.status === 403 ? 'check APIFY_TOKEN' : res.status === 404 ? 'check APIFY_WORKER_ACTOR_ID' : `HTTP ${res.status}`;
      return { ok: false, message: `Apify did not start the worker (${hint})` };
    }
    const body = (await res.json()) as { data?: { id?: string } };
    if (!body.data?.id) return { ok: false, message: 'Apify response had no run id' };
    return { ok: true, workerRunId: body.data.id };
  } catch {
    return { ok: false, message: 'Could not reach Apify to start the worker' };
  }
}
