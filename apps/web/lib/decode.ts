import 'server-only';
import { buildQuestions, decodeCost, DECODE_ESTIMATE_USD, decodeSeconds, passageQuestions, scannedAd, scanVideoUrl, type Tables } from '@content-lab/core';
import { createAIProviders, MAX_INLINE_VIDEO_BYTES } from '@content-lab/core/ai';
import type { AdminClient } from './admin';
import { runActorSync } from './apify';
import { adDuration, decodeRows, jevState } from './decode-records';
import { saveVideo, type Video } from './videos';

type Item = Tables<'items'>;

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

function apifyToken(): string {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error('Set APIFY_TOKEN in Vercel');
  return token;
}

async function download(url: string, headers: Record<string, string> = {}): Promise<Video> {
  const res = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`Could not download the video (HTTP ${res.status})`);
  const size = Number(res.headers.get('content-length') ?? 0);
  if (size > MAX_INLINE_VIDEO_BYTES) throw new Error(`The video is ${(size / 1048576).toFixed(1)} MB; decoding takes up to 14 MB`);
  const data = new Uint8Array(await res.arrayBuffer());
  if (!data.length) throw new Error('The video download was empty');
  return { data, mimeType: 'video/mp4' };
}

// Creative Center: the scan's link while it is valid (about 6 hours). After
// that a rescan of the board brings a fresh one, with new ads.
async function creativeCenterVideo(item: Item): Promise<Video> {
  const scan = obj(item.scan_json);
  const url = scanVideoUrl(scan);
  if (!url) throw new Error('The video link expired: rescan the board, then try again');
  try {
    return await download(url);
  } catch (e) {
    // A long ad may be too large at 540p: fall back to the smallest rendition.
    const small = str(obj(scan.videoUrls)['360p']);
    if (small && small !== url && /MB/.test((e as Error).message)) return download(small);
    throw e;
  }
}

// Meta: the scan's link while Facebook's expiry allows (about a day); after
// that a new scan of the board brings a fresh one.
async function metaVideo(item: Item): Promise<Video> {
  const url = scanVideoUrl(obj(item.scan_json));
  if (!url) throw new Error('The video link expired: rescan the board, then try again');
  return download(url);
}

// Organic: the TikTok scraper downloads the video into Apify storage.
async function organicVideo(item: Item): Promise<Video> {
  const actor = process.env.APIFY_TIKTOK_ACTOR_ID || 'clockworks~tiktok-scraper';
  const token = apifyToken();
  const { rows } = await runActorSync(actor, {
    postURLs: [item.source_url], shouldDownloadVideos: true, shouldDownloadCovers: false,
    shouldDownloadSubtitles: false, shouldDownloadSlideshowImages: false, resultsPerPage: 1,
  }, { token, timeoutS: 180, maxItems: 1 });
  const row = rows.find((r) => str(r.id) === item.external_id) ?? rows[0];
  const media = Array.isArray(row?.mediaUrls) ? row.mediaUrls.find((u): u is string => typeof u === 'string') : undefined;
  if (!media) throw new Error('The TikTok scraper returned no video for this post');
  return download(media, new URL(media).hostname === 'api.apify.com' ? { Authorization: `Bearer ${token}` } : {});
}

// An ad's video, for decoding or saving: the saved copy when there is one,
// else from the source.
export async function adVideo(admin: AdminClient, item: Item): Promise<Video> {
  if (item.video_url) {
    const saved = await download(item.video_url).catch(() => null);
    if (saved) return saved;
  }
  if (item.source === 'tiktok_creative_center') return creativeCenterVideo(item);
  return item.source === 'meta_ad_library' ? metaVideo(item) : organicVideo(item);
}

export type DecodeResult = { ok: true; costUsd: number } | { ok: false; message: string };

// Decodes one ad: its video in one Gemini call, then Jev sorts it into the
// taxonomy. Writes media, the classification and the decode status.
export async function decodeAd(admin: AdminClient, itemId: string): Promise<DecodeResult> {
  const { data: item } = await admin.from('items').select('*').eq('id', itemId).maybeSingle();
  if (!item) return { ok: false, message: 'Ad not found.' };

  const [{ data: settings }, { data: spend }] = await Promise.all([
    admin.from('app_settings').select('monthly_spend_cap_usd').maybeSingle(),
    admin.rpc('month_spend_usd'),
  ]);
  if (settings && Number(spend ?? 0) + DECODE_ESTIMATE_USD > Number(settings.monthly_spend_cap_usd)) {
    return { ok: false, message: `This month's budget is used ($${Number(spend ?? 0).toFixed(2)} of $${Number(settings.monthly_spend_cap_usd).toFixed(2)}).` };
  }

  // decoded_at marks the start too, so a cut-off decode shows as stale later.
  await admin.from('items').update({ decode_status: 'running', decode_error: null, decoded_at: new Date().toISOString() }).eq('id', item.id);
  let saving: Promise<void> | null = null;
  try {
    const ai = createAIProviders(process.env, ['decoder', 'classifier'] as const);
    const video = await adVideo(admin, item);
    // Kept while the decode runs, so the ad plays and decodes again after its
    // links expire or a rescan replaces them. A failed save never fails the decode.
    if (!item.video_url) {
      saving = saveVideo(admin, item.id, video).then(
        (r) => {
          if (!r.ok) console.error(`Save the video of ${item.id}: ${r.message}`);
        },
        (e: unknown) => console.error(`Save the video of ${item.id}: ${(e as Error).message}`),
      );
    }
    const seconds = decodeSeconds(adDuration(item));
    const scan = obj(item.scan_json);
    const decoded = await ai.decoder.decode(video, seconds, {
      source: item.source,
      advertiser: item.advertiser,
      caption: scannedAd(item.source, scan)?.caption ?? str(scan.text) ?? null,
      durationS: adDuration(item),
    });
    const jev = await ai.classifier.answer(jevState(item, decoded.output), { ...buildQuestions(), ...passageQuestions(decoded.output.segments) });
    const cost = decodeCost({ geminiInput: decoded.inputTokens, geminiOutput: decoded.outputTokens, jevInput: jev.inputTokens });
    const rows = decodeRows(item, decoded.output, ai.decoder.name, jev, cost);

    const { error: mediaError } = await admin.from('media').upsert(rows.media, { onConflict: 'item_id' });
    if (mediaError) throw new Error(`Save decode: ${mediaError.message}`);
    const { error: classError } = await admin.from('classifications').upsert(rows.classification, { onConflict: 'item_id,prompt_version,vision_version,model' });
    if (classError) throw new Error(`Save labels: ${classError.message}`);
    await admin.from('items').update({
      decode_status: 'done',
      decode_error: null,
      decoded_at: new Date().toISOString(),
      decode_cost_usd: Number((Number(item.decode_cost_usd) + cost).toFixed(4)),
      duration_s: item.duration_s ?? adDuration(item),
    }).eq('id', item.id);
    await saving;
    return { ok: true, costUsd: cost };
  } catch (e) {
    await saving;
    const message = (e as Error).message.slice(0, 500);
    await admin.from('items').update({ decode_status: 'failed', decode_error: message }).eq('id', item.id);
    return { ok: false, message };
  }
}
