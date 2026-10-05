// The dashboard runs the scrapers itself through the Apify API.
const API = 'https://api.apify.com/v2';

export type ActorRun = {
  id: string;
  status: string;
  statusMessage: string | null;
  datasetId: string | null;
  usageTotalUsd: number | null;
};

export const FINISHED_RUN_STATUSES = ['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'] as const;

function toRun(data: Record<string, unknown> | undefined): ActorRun {
  if (!data || typeof data.id !== 'string') throw new Error('Apify returned no run');
  return {
    id: data.id,
    status: String(data.status ?? ''),
    statusMessage: typeof data.statusMessage === 'string' ? data.statusMessage : null,
    datasetId: typeof data.defaultDatasetId === 'string' ? data.defaultDatasetId : null,
    usageTotalUsd: typeof data.usageTotalUsd === 'number' ? data.usageTotalUsd : null,
  };
}

// Apify's own reason for a refused call (memory limit, used credits, bad
// input), with the token kept out of it.
async function apifyError(res: Response, token: string, what?: string): Promise<Error> {
  let detail = '';
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    detail = body.error?.message ?? '';
  } catch {
    // Not JSON.
  }
  const hint = res.status === 401 || res.status === 403 ? 'check APIFY_TOKEN' : `HTTP ${res.status}`;
  return new Error(`Apify: ${hint}${what ? ` while ${what}` : ''}${detail ? `. ${detail.replaceAll(token, '[redacted]').slice(0, 300)}` : ''}`);
}

async function apifyRequest(path: string, token: string, init: RequestInit = {}, fetchImpl: typeof fetch = fetch) {
  const res = await fetchImpl(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw await apifyError(res, token);
  return res;
}

// Starts an actor without waiting. A webhook, when given, is called once the
// run ends, so results land even if nobody has the board open.
export async function startActorRun(
  actorId: string,
  input: unknown,
  options: { token: string; timeoutS: number; maxItems?: number; maxTotalChargeUsd?: number; webhookUrl?: string | null },
  fetchImpl: typeof fetch = fetch,
): Promise<ActorRun> {
  const params = new URLSearchParams({ timeout: String(options.timeoutS) });
  if (options.maxItems) params.set('maxItems', String(options.maxItems));
  if (options.maxTotalChargeUsd) params.set('maxTotalChargeUsd', options.maxTotalChargeUsd.toFixed(2));
  if (options.webhookUrl) {
    const webhooks = [{ eventTypes: ['ACTOR.RUN.SUCCEEDED', 'ACTOR.RUN.FAILED', 'ACTOR.RUN.ABORTED', 'ACTOR.RUN.TIMED_OUT'], requestUrl: options.webhookUrl }];
    params.set('webhooks', Buffer.from(JSON.stringify(webhooks)).toString('base64'));
  }
  const res = await apifyRequest(`/acts/${encodeURIComponent(actorId)}/runs?${params}`, options.token, { method: 'POST', body: JSON.stringify(input) }, fetchImpl);
  return toRun(((await res.json()) as { data?: Record<string, unknown> }).data);
}

export async function getActorRun(runId: string, token: string, fetchImpl: typeof fetch = fetch): Promise<ActorRun> {
  const res = await apifyRequest(`/actor-runs/${encodeURIComponent(runId)}`, token, {}, fetchImpl);
  return toRun(((await res.json()) as { data?: Record<string, unknown> }).data);
}

export async function getDatasetItems(datasetId: string, offset: number, limit: number, token: string, fetchImpl: typeof fetch = fetch): Promise<Record<string, unknown>[]> {
  const params = new URLSearchParams({ offset: String(offset), limit: String(limit), clean: 'true', format: 'json' });
  const res = await apifyRequest(`/datasets/${encodeURIComponent(datasetId)}/items?${params}`, token, {}, fetchImpl);
  const body = (await res.json()) as unknown;
  if (!Array.isArray(body)) throw new Error('Apify returned an unexpected dataset');
  return body.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object' && !Array.isArray(r));
}

// Runs an actor and waits for its dataset (short jobs only, like refreshing
// one ad's video link). `what` names the job in errors.
export async function runActorSync(
  actorId: string,
  input: unknown,
  options: { token: string; timeoutS: number; maxItems?: number; what?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, unknown>[]> {
  const params = new URLSearchParams({ timeout: String(options.timeoutS), clean: 'true', format: 'json' });
  if (options.maxItems) params.set('maxItems', String(options.maxItems));
  const res = await fetchImpl(`${API}/acts/${encodeURIComponent(actorId)}/run-sync-get-dataset-items?${params}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${options.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout((options.timeoutS + 20) * 1000),
  });
  if (!res.ok) throw await apifyError(res, options.token, options.what ?? 'fetching the video');
  const body = (await res.json()) as unknown;
  if (!Array.isArray(body)) throw new Error('Apify returned an unexpected dataset');
  return body.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object' && !Array.isArray(r));
}
