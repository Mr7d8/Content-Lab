import { scanVideoUrl } from '@content-lab/core';
import { createClient } from '@/lib/supabase/server';
import { requireTeam } from '@/lib/team';
import { chunkRange, readRange } from '@/lib/video-range';

export const maxDuration = 30;

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

// The ad's video (its saved copy, else its scan link), served from our own
// origin so the inspector can draw its frames onto a canvas and save them.
// Only ever fetches a link stored on the ad.
export async function GET(request: Request, ctx: RouteContext<'/api/ads/[id]/video'>) {
  const denied = await requireTeam();
  if (denied) return denied;
  const { id } = await ctx.params;
  const supabase = await createClient();
  // Every column, so this works before the saved-videos migration too.
  const { data: item } = await supabase.from('items').select('*').eq('id', id).maybeSingle();
  const url = item?.video_url ?? scanVideoUrl(obj(item?.scan_json));
  if (!url) return Response.json({ ok: false, message: 'The video link expired: scan the board again.' }, { status: 410 });

  const range = chunkRange(request.headers.get('range'));
  if (!range) return new Response(null, { status: 416 });
  const upstream = await fetch(url, {
    headers: { Range: `bytes=${range.start}-${range.end}` },
    redirect: 'follow',
    signal: AbortSignal.timeout(20000),
  }).catch(() => null);
  if (!upstream || !upstream.body || (upstream.status !== 206 && upstream.status !== 200)) {
    if (upstream?.status === 416) return new Response(null, { status: 416 });
    return Response.json({ ok: false, message: `Could not fetch the video (HTTP ${upstream?.status ?? 'none'})` }, { status: 502 });
  }

  const type = upstream.headers.get('content-type')?.startsWith('video/') ? (upstream.headers.get('content-type') as string) : 'video/mp4';
  const headers: Record<string, string> = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=600' };
  if (upstream.status === 206) {
    for (const h of ['content-range', 'content-length']) {
      const v = upstream.headers.get(h);
      if (v) headers[h] = v;
    }
    return new Response(upstream.body, { status: 206, headers });
  }
  // The source sent the whole file: pass on only the chunk that was asked for.
  const total = Number(upstream.headers.get('content-length') ?? 0) || null;
  const bytes = await readRange(upstream.body, range);
  if (!bytes.length) return new Response(null, { status: 416 });
  const end = range.start + bytes.length - 1;
  headers['Content-Range'] = `bytes ${range.start}-${end}/${total ?? '*'}`;
  headers['Content-Length'] = String(bytes.length);
  return new Response(bytes, { status: 206, headers });
}
