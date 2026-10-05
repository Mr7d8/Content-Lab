// The dashboard runs the scrapers itself through the Apify API. The team
// calls Apify "DD", so that is the name its errors carry.
const API = 'https://api.apify.com/v2';
const NAME = 'DD';

export type ActorRun = {
  id: string;
  status: string;
  statusMessage: string | null;
  datasetId: string | null;
  usageTotalUsd: number | null;
};

export const FINISHED_RUN_STATUSES = ['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'] as const;

function toRun(data: Record<string, unknown> | undefined): ActorRun {
  if (!data || typeof data.id !== 'string') throw new Error(`${NAME} returned no run`);
  return {
    id: data.id,
    status: String(data.status ?? ''),
    statusMessage: typeof data.statusMessage === 'string' ? data.statusMessage : null,
    datasetId: typeof data.defaultDatasetId === 'string' ? data.defaultDatasetId : null,
    usageTotalUsd: typeof data.usageTotalUsd === 'number' ? data.usageTotalUsd : null,
  };
}

// Apify's own wording, under the team's name for it and without the token.
const own = (text: string, token: string) => (token.length >= 8 ? text.replaceAll(token, '[redacted]') : text).replace(/\bApify\b/g, NAME).slice(0, 300);

// Apify's own reason for a refused call (memory limit, used credits, bad
// input).
async function apifyError(res: Response, token: string, what?: string): Promise<Error> {
  let detail = '';
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    detail = body.error?.message ?? '';
  } catch {
    // Not JSON.
  }
  const hint = res.status === 401 || res.status === 403 ? 'check APIFY_TOKEN' : `HTTP ${res.status}`;
  return new Error(`${NAME}: ${hint}${what ? ` while ${what}` : ''}${detail ? `. ${own(detail, token)}` : ''}`);
}

async function apifyRequest(path: string, token: string, init: RequestInit = {}, fetchImpl: typeof fetch = fetch, timeoutMs = 20000, what?: string) {
  const res = await fetchImpl(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw await apifyError(res, token, what);
  return res;
}

// Starts an actor without waiting. A webhook, when given, is called once the
// run ends, so results land even if nobody has the board open.
export async function startActorRun(
  actorId: string,
  input: unknown,
  options: { token: string; timeoutS: number; maxItems?: number; maxTotalChargeUsd?: number; webhookUrl?: string | null; what?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<ActorRun> {
  const params = new URLSearchParams({ timeout: String(options.timeoutS) });
  if (options.maxItems) params.set('maxItems', String(options.maxItems));
  if (options.maxTotalChargeUsd) params.set('maxTotalChargeUsd', options.maxTotalChargeUsd.toFixed(2));
  if (options.webhookUrl) {
    const webhooks = [{ eventTypes: ['ACTOR.RUN.SUCCEEDED', 'ACTOR.RUN.FAILED', 'ACTOR.RUN.ABORTED', 'ACTOR.RUN.TIMED_OUT'], requestUrl: options.webhookUrl }];
    params.set('webhooks', Buffer.from(JSON.stringify(webhooks)).toString('base64'));
  }
  const res = await apifyRequest(`/acts/${encodeURIComponent(actorId)}/runs?${params}`, options.token, { method: 'POST', body: JSON.stringify(input) }, fetchImpl, 20000, options.what);
  return toRun(((await res.json()) as { data?: Record<string, unknown> }).data);
}

// waitS: Apify holds the answer up to that long (60 at most) for the run to finish.
export async function getActorRun(runId: string, token: string, fetchImpl: typeof fetch = fetch, waitS = 0): Promise<ActorRun> {
  const wait = waitS > 0 ? `?waitForFinish=${Math.min(60, Math.round(waitS))}` : '';
  const res = await apifyRequest(`/actor-runs/${encodeURIComponent(runId)}${wait}`, token, {}, fetchImpl, 20000 + waitS * 1000);
  return toRun(((await res.json()) as { data?: Record<string, unknown> }).data);
}

export async function getDatasetItems(datasetId: string, offset: number, limit: number, token: string, fetchImpl: typeof fetch = fetch): Promise<Record<string, unknown>[]> {
  const params = new URLSearchParams({ offset: String(offset), limit: String(limit), clean: 'true', format: 'json' });
  const res = await apifyRequest(`/datasets/${encodeURIComponent(datasetId)}/items?${params}`, token, {}, fetchImpl);
  const body = (await res.json()) as unknown;
  if (!Array.isArray(body)) throw new Error(`${NAME} returned an unexpected dataset`);
  return body.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object' && !Array.isArray(r));
}

export type FinishedRun = { run: ActorRun; rows: Record<string, unknown>[] };

const ENDED: Record<string, string> = { ABORTED: 'was stopped', FAILED: 'failed', 'TIMED-OUT': 'timed out' };

// Runs an actor, waits for it to end and reads its dataset (short jobs only,
// like refreshing one ad's video link). A run that ended early (stopped at
// its item cap, aborted, timed out) still gives back what it found; only one
// that found nothing is an error. `what` names the job in errors.
export async function runActorSync(
  actorId: string,
  input: unknown,
  options: { token: string; timeoutS: number; maxItems?: number; what?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<FinishedRun> {
  const what = options.what ?? 'fetching the video';
  let run = await startActorRun(actorId, input, { token: options.token, timeoutS: options.timeoutS, maxItems: options.maxItems, what }, fetchImpl);
  const deadline = Date.now() + (options.timeoutS + 15) * 1000;
  while (!(FINISHED_RUN_STATUSES as readonly string[]).includes(run.status) && Date.now() < deadline) {
    run = await getActorRun(run.id, options.token, fetchImpl, Math.max(1, Math.min(50, (deadline - Date.now()) / 1000)));
  }
  const rows = run.datasetId ? await getDatasetItems(run.datasetId, 0, options.maxItems ?? 100, options.token, fetchImpl) : [];
  if (!rows.length && run.status !== 'SUCCEEDED') {
    const ended = ENDED[run.status] ?? 'did not finish';
    const why = run.statusMessage ? `: ${own(run.statusMessage, options.token)}` : '';
    throw new Error(`${NAME}: the scraper ${ended} without results while ${what} (run ${run.id})${why}`);
  }
  return { run, rows };
}
