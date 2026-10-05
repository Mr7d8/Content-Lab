import { scanVideoUrl } from '@content-lab/core';
import { adminClient } from '@/lib/admin';
import { requireTeam } from '@/lib/team';
import { refreshCreativeCenterMedia } from '@/lib/video-refresh';

// The scraper takes up to 2 minutes for one detail page.
export const maxDuration = 180;

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

// A playable video link for the inspector: the scan's while it lasts, else a
// fresh one. Only Creative Center ads can be refreshed one by one; the others
// get theirs back from a new scan of the board.
export async function POST(_request: Request, ctx: RouteContext<'/api/ads/[id]/video/refresh'>) {
  const denied = await requireTeam();
  if (denied) return denied;
  const { id } = await ctx.params;
  const admin = adminClient();
  const { data: item } = await admin.from('items').select('*').eq('id', id).maybeSingle();
  if (!item) return Response.json({ ok: false, message: 'Ad not found.' }, { status: 404 });
  // A saved copy, or a link another tab refreshed already.
  const current = item.video_url ?? scanVideoUrl(obj(item.scan_json));
  if (current) return Response.json({ ok: true, video: current });
  if (item.source !== 'tiktok_creative_center') return Response.json({ ok: false, message: 'The video link expired: scan the board again.' }, { status: 410 });
  const result = await refreshCreativeCenterMedia(admin, item, { exclusive: true });
  if (!result.ok) return Response.json({ ok: false, message: result.message }, { status: result.busy ? 409 : 502 });
  return Response.json({ ok: true, video: result.video });
}
