import 'server-only';
import { estimateScan, scanVideoUrl, withFreshMedia, type Json, type Tables } from '@content-lab/core';
import type { AdminClient } from './admin';
import { runActorSync } from './apify';

type Item = Tables<'items'>;
type Raw = Record<string, unknown>;

export type RefreshResult = { ok: true; scan: Raw; video: string } | { ok: false; message: string };

const obj = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

// Rows the scraper may return for one detail page (the ad, maybe a neighbor).
const MAX_ROWS = 3;

// Creative Center video links last about 6 hours after a scan. This asks the
// scraper for the ad's detail page again and swaps in the fresh media links,
// keeping the rest of the scan row. The run counts toward the month's spend
// like a one-ad scan, at the scraper's pay-per-result price (about a cent).
export async function refreshCreativeCenterMedia(admin: AdminClient, item: Item): Promise<RefreshResult> {
  const token = process.env.APIFY_TOKEN;
  if (!token) return { ok: false, message: 'Set APIFY_TOKEN in Vercel' };
  const [{ data: settings }, { data: spend }] = await Promise.all([
    admin.from('app_settings').select('monthly_spend_cap_usd').maybeSingle(),
    admin.rpc('month_spend_usd'),
  ]);
  const estimate = estimateScan(MAX_ROWS, item.source);
  if (settings && Number(spend ?? 0) + estimate > Number(settings.monthly_spend_cap_usd)) {
    return { ok: false, message: `This month's budget is used ($${Number(spend ?? 0).toFixed(2)} of $${Number(settings.monthly_spend_cap_usd).toFixed(2)}).` };
  }

  const startedAt = new Date().toISOString();
  const actor = process.env.APIFY_CREATIVE_CENTER_ACTOR_ID || 'fetch_cat~tiktok-ads-library-scraper';
  let rows: Raw[] = [];
  let message: string | null = null;
  try {
    rows = await runActorSync(actor, { startUrls: [{ url: item.source_url }], maxItems: MAX_ROWS }, { token, timeoutS: 120, maxItems: MAX_ROWS, what: 'refreshing the video link' });
  } catch (e) {
    message = (e as Error).message;
  }
  const fresh = rows.find((r) => str(r.adId) === item.external_id);
  const scan = fresh ? withFreshMedia(obj(item.scan_json), fresh) : null;
  const video = scan ? scanVideoUrl(scan) : null;
  if (!message && !video) message = fresh ? 'The refreshed ad has no video link' : 'The video link expired and could not be refreshed: scan the board again';

  // A failed run is still recorded: the scraper charges for its start.
  const { error: runError } = await admin.from('runs').insert({
    source: item.source, kind: 'scan', trigger: 'manual', status: video ? 'completed' : 'failed',
    items_requested: 1, items_done: video ? 1 : 0, items_failed: video ? 0 : 1,
    spend_cap_usd: Number(estimate.toFixed(4)), cost_estimate_usd: Number(estimate.toFixed(4)),
    cost_actual_usd: Number(estimateScan(rows.length, item.source).toFixed(4)),
    error: message, started_at: startedAt, finished_at: new Date().toISOString(),
  });
  if (runError) console.error(`Record video refresh for ${item.id}: ${runError.message}`);

  if (!scan || !video) return { ok: false, message: message as string };
  const { error } = await admin.from('items').update({ scan_json: scan as Json }).eq('id', item.id);
  if (error) return { ok: false, message: `Save the fresh video link: ${error.message}` };
  return { ok: true, scan, video };
}
