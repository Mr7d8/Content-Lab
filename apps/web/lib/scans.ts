import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { estimateScan, scanInput, sweepRunCap, type TablesInsert } from '@content-lab/core';
import type { AdminClient } from './admin';
import { FINISHED_RUN_STATUSES, getActorRun, getDatasetItems, startActorRun } from './apify';
import { cacheCover } from './covers';
import { planIngest, scanOutcome } from './scan-ingest';

const SCAN_TIMEOUT_S = 600;
const PAGE = 50;
// A scan with no progress for this long was left behind; a new one may start.
const STALE_SCAN_MS = 15 * 60_000;

const ACTORS = {
  tiktok_creative_center: () => process.env.APIFY_CREATIVE_CENTER_ACTOR_ID || 'fetch_cat~tiktok-ads-library-scraper',
  tiktok_organic: () => process.env.APIFY_TIKTOK_ACTOR_ID || 'clockworks~tiktok-scraper',
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

export type StartScanResult = { ok: true; runId: string; already?: boolean } | { ok: false; message: string };

// Starts a scan of a board, under the monthly budget. One scan per board at a time.
export async function startScan(admin: AdminClient, boardId: string, trigger: 'manual' | 'schedule'): Promise<StartScanResult> {
  const { data: board, error: boardError } = await admin.from('watchlists').select('*').eq('id', boardId).maybeSingle();
  if (boardError) return { ok: false, message: boardError.message };
  if (!board) return { ok: false, message: 'Board not found.' };
  const actor = ACTORS[board.source as keyof typeof ACTORS];
  if (!actor) return { ok: false, message: `Boards of source ${board.source} cannot be scanned yet.` };

  const recent = new Date(Date.now() - STALE_SCAN_MS).toISOString();
  const { data: open } = await admin.from('runs').select('id').eq('watchlist_id', board.id).eq('kind', 'scan')
    .eq('status', 'running').gt('updated_at', recent).limit(1);
  if (open?.[0]) return { ok: true, runId: open[0].id, already: true };

  const [{ data: settings }, { data: spend }] = await Promise.all([
    admin.from('app_settings').select('*').maybeSingle(),
    admin.rpc('month_spend_usd'),
  ]);
  if (!settings) return { ok: false, message: 'Settings are missing: run the database migrations.' };
  const estimate = estimateScan(board.max_items);
  const cap = sweepRunCap(settings, Number(spend ?? 0));
  if (cap < estimate) return { ok: false, message: `This month's budget is used ($${Number(spend ?? 0).toFixed(2)} of $${Number(settings.monthly_spend_cap_usd).toFixed(2)}).` };

  const now = new Date().toISOString();
  const row: TablesInsert<'runs'> = {
    source: board.source, watchlist_id: board.id, kind: 'scan', trigger, status: 'running', started_at: now,
    spend_cap_usd: cap, cost_estimate_usd: Number(estimate.toFixed(4)),
  };
  const { data: run, error } = await admin.from('runs').insert(row).select('id').single();
  if (error) return { ok: false, message: `Could not create the scan: ${error.message}` };

  try {
    const token = webhookToken(run.id);
    const site = siteUrl();
    const started = await startActorRun(actor(), scanInput(board), {
      token: apifyToken(),
      timeoutS: SCAN_TIMEOUT_S,
      maxItems: board.max_items,
      maxTotalChargeUsd: cap,
      webhookUrl: token && site ? `${site}/api/apify/webhook?run=${run.id}&token=${token}` : null,
    });
    await admin.from('runs').update({ worker_run_id: started.id, apify_dataset_id: started.datasetId }).eq('id', run.id);
    await admin.from('watchlists').update({ last_swept_at: now }).eq('id', board.id);
    return { ok: true, runId: run.id };
  } catch (e) {
    const message = (e as Error).message;
    await admin.from('runs').update({ status: 'failed', error: message, finished_at: new Date().toISOString() }).eq('id', run.id);
    return { ok: false, message };
  }
}

export type SyncResult = { status: string; synced: number; added: number; done: boolean; error: string | null };

// Pulls the scan's new rows into the board, saving covers as it goes. Safe to
// call repeatedly and from several places (the open board, the webhook).
export async function syncScan(admin: AdminClient, runId: string, budgetMs = 8000): Promise<SyncResult> {
  const started = Date.now();
  const { data: run } = await admin.from('runs').select('*').eq('id', runId).maybeSingle();
  if (!run) return { status: 'missing', synced: 0, added: 0, done: true, error: 'Scan not found' };
  const idle = { status: run.status, synced: run.synced_count, added: 0, done: run.status !== 'running', error: run.error };
  if (run.kind !== 'scan' || run.status !== 'running' || !run.worker_run_id || !run.apify_dataset_id || !run.watchlist_id) return idle;
  const { data: board } = await admin.from('watchlists').select('id, type, value, source, objective').eq('id', run.watchlist_id).maybeSingle();
  if (!board) return idle;

  const token = apifyToken();
  const actorRun = await getActorRun(run.worker_run_id, token);
  const finished = (FINISHED_RUN_STATUSES as readonly string[]).includes(actorRun.status);
  let offset = run.synced_count;
  let added = 0;
  let drained = false;
  while (Date.now() - started < budgetMs) {
    const rows = await getDatasetItems(run.apify_dataset_id, offset, PAGE, token);
    if (rows.length) added += await ingest(admin, board, rows, offset);
    offset += rows.length;
    if (rows.length < PAGE) {
      drained = true;
      break;
    }
  }

  const done = finished && drained;
  const outcome = done ? scanOutcome(actorRun.status, actorRun.statusMessage) : null;
  // Apify's own figure once it has one; until then the estimate for the rows so far.
  const cost = actorRun.usageTotalUsd ?? (offset ? estimateScan(offset) : 0);
  // Only advance from the offset we read, so two syncs never double count.
  await admin.from('runs').update({
    synced_count: offset,
    items_requested: offset,
    cost_actual_usd: Number(Math.min(cost, 999).toFixed(4)),
    ...(outcome ? { status: outcome.status, error: outcome.error, finished_at: new Date().toISOString() } : {}),
  }).eq('id', run.id).eq('synced_count', run.synced_count);
  return { status: outcome?.status ?? 'running', synced: offset, added, done, error: outcome?.error ?? null };
}

// One page of rows: items (latest scan row, metrics), board membership in
// rank order, metric snapshots, covers. Ads run for another objective than
// the board's are left out. Returns how many ads are new to the board.
async function ingest(admin: AdminClient, board: { id: string; type: string; value: string; source: string; objective: string | null }, rows: Record<string, unknown>[], offset: number): Promise<number> {
  const now = new Date().toISOString();
  const plan = planIngest(board, rows, offset, now);
  if (!plan.items.length) return 0;

  const { data: saved, error } = await admin.from('items')
    .upsert(plan.items, { onConflict: 'source,external_id' })
    .select('id, external_id, thumbnail_url');
  if (error) throw new Error(`Save ads: ${error.message}`);

  const ids = saved.map((s) => s.id);
  const { data: known } = await admin.from('board_items').select('item_id').eq('watchlist_id', board.id).in('item_id', ids);
  const knownIds = new Set((known ?? []).map((k) => k.item_id));
  const { error: boardError } = await admin.from('board_items').upsert(
    saved.map((s) => ({ watchlist_id: board.id, item_id: s.id, rank: plan.ranks.get(s.external_id) ?? null, last_seen_at: now })),
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
