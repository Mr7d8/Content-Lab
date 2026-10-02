import 'server-only';
import { advertiserKeys, scannedAd, type Json } from '@content-lab/core';
import type { AdminClient } from './admin';
import { markedMarket, readStoredMarket } from './gate';

// The team's call on an ad. "Moroccan" shows it on every Moroccan board and
// marks its advertiser Moroccan, so snowball boards follow it and its other
// ads get in. "Not Moroccan" leaves it out and blocks its advertiser on
// Moroccan boards. The call wins over the checks.

export type MarkResult = { ok: true; advertisers: string[]; moved: number } | { ok: false; message: string };

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});


export async function markMarket(admin: AdminClient, itemId: string, verdict: 'moroccan' | 'elsewhere'): Promise<MarkResult> {
  const { data: item } = await admin.from('items').select('id, source, advertiser, scan_json, market_json').eq('id', itemId).maybeSingle();
  if (!item) return { ok: false, message: 'Ad not found.' };
  const stored = readStoredMarket(item.market_json);
  const brand = scannedAd(item.source, obj(item.scan_json))?.advertiser ?? item.advertiser;
  const keys = advertiserKeys({ brand, landingHost: stored?.landing_host });
  const now = new Date().toISOString();

  const { error } = await admin.from('items').update({ market_json: markedMarket(stored, verdict, now) as unknown as Json }).eq('id', item.id);
  if (error) return { ok: false, message: `Save: ${error.message}` };

  if (keys.length) {
    const status = verdict === 'moroccan' ? 'moroccan' : 'blocked';
    const rows = keys.map((key) => ({ key, name: key.startsWith('brand:') ? (brand as string).trim() : key.slice('domain:'.length), status, origin: 'manual', item_id: item.id }));
    const { error: advError } = await admin.from('advertisers').upsert(rows, { onConflict: 'key' });
    if (advError) return { ok: false, message: `Save the advertiser: ${advError.message}` };
  }

  const { data: gated } = await admin.from('watchlists').select('id').eq('moroccan_only', true);
  const boards = (gated ?? []).map((b) => b.id);
  if (!boards.length) return { ok: true, advertisers: keys, moved: 0 };
  const target = verdict === 'moroccan' ? 'shown' : 'rejected';
  await admin.from('board_items').update({ status: target }).eq('item_id', item.id).in('watchlist_id', boards);

  // The advertiser's other ads on Moroccan boards follow, unless the team
  // made its own call on them.
  const others = new Set<string>();
  const host = stored?.landing_host;
  if (brand && keys.some((k) => k.startsWith('brand:'))) {
    // Exact name, any case: % and _ would be wildcards in a pattern.
    const exact = brand.trim().replace(/[\\%_]/g, '\\$&');
    const { data } = await admin.from('items').select('id, market_json').ilike('advertiser', exact).neq('id', item.id).limit(200);
    for (const r of data ?? []) if (!readStoredMarket(r.market_json)?.manual) others.add(r.id);
  }
  if (host) {
    const { data } = await admin.from('items').select('id, market_json').eq('market_json->>landing_host', host).neq('id', item.id).limit(200);
    for (const r of data ?? []) if (!readStoredMarket(r.market_json)?.manual) others.add(r.id);
  }
  let moved = 0;
  if (others.size) {
    const { data: changed } = await admin.from('board_items').update({ status: target })
      .in('item_id', [...others]).in('watchlist_id', boards).neq('status', target).select('item_id');
    moved = changed?.length ?? 0;
  }
  return { ok: true, advertisers: keys, moved };
}
