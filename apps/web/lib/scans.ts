import 'server-only';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { boardSearches, creativeCenterTerms, estimateScan, scanAsk, scanInput, type BoardSearch, type Json, type TablesInsert } from '@content-lab/core';
import type { AdminClient } from './admin';
import { FINISHED_RUN_STATUSES, getActorRun, getDatasetItems, startActorRun } from './apify';
import { cacheCover } from './covers';
import { bookFrom, gateStatus, readStoredMarket, type GateStatus } from './gate';
import { planIngest, scanOutcome } from './scan-ingest';

const SCAN_TIMEOUT_S = 600;
const PAGE = 50;
// A scan with no progress for this long was left behind; a new one may start.
const STALE_SCAN_MS = 15 * 60_000;

// Creative Center's scraper is fixed: its input and rows are read by
// creativeCenterScanInput and creativeCenterAd.
const ACTORS = {
  tiktok_creative_center: () => 'automation_craft~tiktok-creative-center-scraper',
  tiktok_organic: () => process.env.APIFY_TIKTOK_ACTOR_ID || 'clockworks~tiktok-scraper',
  meta_ad_library: () => process.env.APIFY_META_ACTOR_ID || 'curious_coder~facebook-ads-library-scraper',
} as const;

function apifyToken(): string {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error('Set APIFY_TOKEN in Vercel');
  return token;
}

// The Apify webhook proves it is ours with a token derived from CRON_SECRET.
export function webhookToken(runId: string): string | null {
  const secret = process.env.CRON_SECRET;
  return secret ? createHmac('sha256', secret).update(`apify-webhook:${runId}`).digest('hex') : null;
}

export function isWebhookToken(runId: string, token: string | null): boolean {
  const expected = webhookToken(runId);
  if (!expected || !token || token.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

function siteUrl(): string | null {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return production ? `https://${production}` : null;
}

export type StartScanResult = { ok: true; runIds: string[]; already?: boolean } | { ok: false; message: string };

// Names of the advertisers marked Moroccan, newest first: what a snowball
// board searches for. Only brand names, since Creative Center searches ad
// text and brand names, not landing pages.
async function followedAdvertisers(admin: AdminClient): Promise<string[]> {
  const { data } = await admin.from('advertisers').select('name').eq('status', 'moroccan').like('key', 'brand:%')
    .order('updated_at', { ascending: false }).limit(10);
  return (data ?? []).map((a) => a.name);
}

// Starts a scan of a board, under the monthly budget: one scraper run per
// search (a combined board has several), started together under one batch.
// One scan per board at a time.
export async function startScan(admin: AdminClient, boardId: string, trigger: 'manual' | 'schedule'): Promise<StartScanResult> {
  const { data: board, error: boardError } = await admin.from('watchlists').select('*').eq('id', boardId).maybeSingle();
  if (boardError) return { ok: false, message: boardError.message };
  if (!board) return { ok: false, message: 'Board not found.' };
  const searches = boardSearches(board);
  const missing = searches.find((s) => !ACTORS[s.source as keyof typeof ACTORS]);
  if (missing) return { ok: false, message: `Boards of source ${missing.source} cannot be scanned yet.` };

  const recent = new Date(Date.now() - STALE_SCAN_MS).toISOString();
  const { data: open } = await admin.from('runs').select('id').eq('watchlist_id', board.id).eq('kind', 'scan')
    .eq('status', 'running').gt('updated_at', recent);
  if (open?.length) return { ok: true, runIds: open.map((r) => r.id), already: true };

  const [{ data: settings }, { data: spend }] = await Promise.all([
    admin.from('app_settings').select('*').maybeSingle(),
    admin.rpc('month_spend_usd'),
  ]);
  if (!settings) return { ok: false, message: 'Settings are missing: run the database migrations.' };
  let inputs: Record<string, unknown>[];
  try {
    const followed = searches.some((s) => s.type === 'snowball') ? await followedAdvertisers(admin) : [];
    inputs = searches.map((s) => scanInput({ ...s, max_items: board.max_items }, s.type === 'snowball' ? { followed } : {}));
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }

  // The whole scan must fit what is left of the month; each run may charge
  // up to half again its share, never past the month.
  const asks = searches.map((s) => scanAsk({ ...s, max_items: board.max_items }));
  const estimates = searches.map((s, i) => estimateScan(asks[i] as number, s.source));
  const estimate = estimates.reduce((a, b) => a + b, 0);
  const left = Math.max(0, Number(settings.monthly_spend_cap_usd) - Number(spend ?? 0));
  if (estimate > left) {
    const what = searches.length > 1 ? `This scan of ${searches.length} searches, ${board.max_items} ads each,` : `This scan of ${board.max_items} ads`;
    return {
      ok: false,
      message: `${what} needs about $${estimate.toFixed(2)}, and $${left.toFixed(2)} is left of this month's $${Number(settings.monthly_spend_cap_usd).toFixed(2)} cap. Raise the cap or scan fewer ads.`,
    };
  }

  const now = new Date().toISOString();
  const batch = searches.length > 1 ? randomUUID() : null;
  const token = apifyToken();
  const site = siteUrl();
  const runIds: string[] = [];
  const errors: string[] = [];
  for (const [i, s] of searches.entries()) {
    const own = estimates[i] as number;
    const cap = Math.floor(Math.min(left * (own / estimate), own * 1.5) * 10000) / 10000;
    const row: TablesInsert<'runs'> = {
      source: s.source, watchlist_id: board.id, kind: 'scan', trigger, status: 'running', started_at: now,
      items_requested: asks[i] as number, spend_cap_usd: cap, cost_estimate_usd: Number(own.toFixed(4)),
      batch_id: batch, search_json: batch ? (s as unknown as Json) : null,
    };
    const { data: run, error } = await admin.from('runs').insert(row).select('id').single();
    if (error) {
      errors.push(`Could not create the scan: ${error.message}`);
      continue;
    }
    try {
      const hook = webhookToken(run.id);
      const started = await startActorRun(ACTORS[s.source as keyof typeof ACTORS](), inputs[i], {
        token,
        timeoutS: SCAN_TIMEOUT_S,
        maxItems: asks[i] as number,
        maxTotalChargeUsd: cap,
        webhookUrl: hook && site ? `${site}/api/apify/webhook?run=${run.id}&token=${hook}` : null,
      });
      await admin.from('runs').update({ worker_run_id: started.id, apify_dataset_id: started.datasetId }).eq('id', run.id);
      runIds.push(run.id);
    } catch (e) {
      const message = (e as Error).message;
      errors.push(message);
      await admin.from('runs').update({ status: 'failed', error: message, finished_at: new Date().toISOString() }).eq('id', run.id);
    }
  }
  if (!runIds.length) return { ok: false, message: errors[0] ?? 'The scan did not start.' };
  await admin.from('watchlists').update({ last_swept_at: now }).eq('id', board.id);
  return { ok: true, runIds };
}

// synced counts the scraper's rows read so far, out of the requested ads.
export type SyncResult = { status: string; synced: number; requested: number; added: number; done: boolean; error: string | null; boardId?: string | null };

// Pulls the scan's new rows into the board, saving covers as it goes. Safe to
// call repeatedly and from several places (the open board, the webhook).
export async function syncScan(admin: AdminClient, runId: string, budgetMs = 8000): Promise<SyncResult> {
  const started = Date.now();
  const { data: run } = await admin.from('runs').select('*').eq('id', runId).maybeSingle();
  if (!run) return { status: 'missing', synced: 0, requested: 0, added: 0, done: true, error: 'Scan not found' };
  const idle = { status: run.status, synced: run.synced_count, requested: run.items_requested, added: 0, done: run.status !== 'running', error: run.error, boardId: run.watchlist_id };
  if (run.kind !== 'scan' || run.status !== 'running' || !run.worker_run_id || !run.apify_dataset_id || !run.watchlist_id) return idle;
  const { data: row } = await admin.from('watchlists').select('id, type, value, source, objective, moroccan_only').eq('id', run.watchlist_id).maybeSingle();
  if (!row) return idle;
  // On a board with several searches, the run's own search decides how its
  // rows come in; the board's Moroccan switch still turns the gate off for all.
  const search = run.search_json ? (run.search_json as unknown as BoardSearch) : null;
  const board: IngestBoard = search
    ? { id: row.id, type: search.type, value: search.value, source: search.source, objective: search.objective, moroccan_only: row.moroccan_only && search.moroccan_only }
    : row;

  const terms = await termsFor(admin, board);
  const token = apifyToken();
  const actorRun = await getActorRun(run.worker_run_id, token);
  const finished = (FINISHED_RUN_STATUSES as readonly string[]).includes(actorRun.status);
  let offset = run.synced_count;
  let added = 0;
  let drained = false;
  while (Date.now() - started < budgetMs) {
    const rows = await getDatasetItems(run.apify_dataset_id, offset, PAGE, token);
    if (rows.length) added += await ingest(admin, board, rows, offset, terms);
    offset += rows.length;
    if (rows.length < PAGE) {
      drained = true;
      break;
    }
  }

  const done = finished && drained;
  const outcome = done ? scanOutcome(actorRun.status, actorRun.statusMessage) : null;
  // Apify's own figure once it has one; until then the estimate for the rows so far.
  const cost = actorRun.usageTotalUsd ?? (offset ? estimateScan(offset, board.source) : 0);
  // Only advance from the offset we read, so two syncs never double count.
  await admin.from('runs').update({
    synced_count: offset,
    cost_actual_usd: Number(Math.min(cost, 999).toFixed(4)),
    ...(outcome ? { status: outcome.status, error: outcome.error, finished_at: new Date().toISOString() } : {}),
  }).eq('id', run.id).eq('synced_count', run.synced_count);
  return { status: outcome?.status ?? 'running', synced: offset, requested: run.items_requested, added, done, error: outcome?.error ?? null, boardId: board.id };
}

type IngestBoard = { id: string; type: string; value: string; source: string; objective: string | null; moroccan_only: boolean };

// The words a Creative Center board keeps ads for (its scraper cannot
// search), or null to keep every ad.
async function termsFor(admin: AdminClient, board: IngestBoard): Promise<string[] | null> {
  if (board.source !== 'tiktok_creative_center') return null;
  try {
    return creativeCenterTerms(board, board.type === 'snowball' ? { followed: await followedAdvertisers(admin) } : {});
  } catch {
    // A snowball board whose advertisers were all unmarked since the scan
    // started: no words, so no ad is kept.
    return [];
  }
}

// Where each ad of a page goes on the board: everything shows on an ordinary
// board; a Moroccan board shows Moroccan ads, leaves out the others and
// queues the unclear ones for the check.
async function gateFor(admin: AdminClient, board: IngestBoard, ads: ReturnType<typeof planIngest>['ads']): Promise<Map<string, GateStatus>> {
  const out = new Map<string, GateStatus>();
  if (!board.moroccan_only) {
    for (const ad of ads) out.set(ad.externalId, 'shown');
    return out;
  }
  const [{ data: advertisers }, { data: existing }] = await Promise.all([
    admin.from('advertisers').select('key, name, status'),
    admin.from('items').select('external_id, market_json').eq('source', board.source).in('external_id', ads.map((a) => a.externalId)),
  ]);
  const book = bookFrom(advertisers ?? []);
  const stored = new Map((existing ?? []).map((e) => [e.external_id, readStoredMarket(e.market_json)]));
  for (const ad of ads) out.set(ad.externalId, gateStatus(ad, { moroccanOnly: true, book, stored: stored.get(ad.externalId) ?? null }));
  return out;
}

// One page of rows: items (latest scan row, metrics), board membership in
// rank order, metric snapshots, covers. Ads run for another objective than
// the board's are left out, and a Moroccan board gates the rest. Returns how
// many ads are new to the board.
async function ingest(admin: AdminClient, board: IngestBoard, rows: Record<string, unknown>[], offset: number, terms: string[] | null): Promise<number> {
  const now = new Date().toISOString();
  const plan = planIngest(board, rows, offset, now, terms);
  if (!plan.items.length) return 0;
  const gate = await gateFor(admin, board, plan.ads);

  const { data: saved, error } = await admin.from('items')
    .upsert(plan.items, { onConflict: 'source,external_id' })
    .select('id, external_id, thumbnail_url');
  if (error) throw new Error(`Save ads: ${error.message}`);

  const ids = saved.map((s) => s.id);
  const { data: known } = await admin.from('board_items').select('item_id').eq('watchlist_id', board.id).in('item_id', ids);
  const knownIds = new Set((known ?? []).map((k) => k.item_id));
  const { error: boardError } = await admin.from('board_items').upsert(
    saved.map((s) => ({ watchlist_id: board.id, item_id: s.id, rank: plan.ranks.get(s.external_id) ?? null, last_seen_at: now, status: gate.get(s.external_id) ?? 'shown' })),
    { onConflict: 'watchlist_id,item_id' },
  );
  if (boardError) throw new Error(`Add ads to the board: ${boardError.message}`);

  const idByExternal = new Map(saved.map((s) => [s.external_id, s.id]));
  const metrics = plan.ads.flatMap((ad) => ad.metrics.map((m) => ({
    item_id: idByExternal.get(ad.externalId) as string,
    metric_name: m.name,
    value: m.value,
    value_text: m.valueText ?? null,
    unit: m.unit,
    captured_at: now,
  }))).filter((m) => m.item_id && (m.value !== null || m.value_text !== null));
  if (metrics.length) await admin.from('metrics').insert(metrics);

  // Covers expire with the source's links: copy the ones we do not have yet.
  const needCover = plan.ads
    .map((ad) => ({ ad, row: saved.find((s) => s.external_id === ad.externalId) }))
    .filter((x): x is { ad: typeof x.ad; row: NonNullable<typeof x.row> } => !!x.row && !x.row.thumbnail_url && !!x.ad.coverUrl);
  await mapLimit(needCover, 6, async ({ ad, row }) => {
    const url = await cacheCover(admin, row.id, ad.coverUrl as string);
    if (url) await admin.from('items').update({ thumbnail_url: url }).eq('id', row.id);
  });
  return saved.filter((s) => !knownIds.has(s.id)).length;
}

async function mapLimit<T>(list: T[], limit: number, fn: (x: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (next < list.length) {
      const item = list[next++] as T;
      try {
        await fn(item);
      } catch {
        // A missing cover is not worth failing the scan for.
      }
    }
  });
  await Promise.all(workers);
}
