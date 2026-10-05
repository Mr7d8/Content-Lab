import { adminClient } from '@/lib/admin';
import { adVideo } from '@/lib/decode';
import { requireTeam } from '@/lib/team';
import { saveVideo } from '@/lib/videos';

// An organic post's video comes through the TikTok scraper (up to 3 minutes).
export const maxDuration = 300;

// Saves a decoded ad's video, so it stays after its links expire or a rescan
// replaces them. Decodes save theirs on their own; this is for ads decoded
// before that, or whose save did not go through.
export async function POST(_request: Request, ctx: RouteContext<'/api/ads/[id]/video/save'>) {
  const denied = await requireTeam();
  if (denied) return denied;
  const { id } = await ctx.params;
  const admin = adminClient();
  const { data: item } = await admin.from('items').select('*').eq('id', id).maybeSingle();
  if (!item) return Response.json({ ok: false, message: 'Ad not found.' }, { status: 404 });
  if (item.video_url) return Response.json({ ok: true, video: item.video_url });
  if (item.decode_status !== 'done') return Response.json({ ok: false, message: 'Decode the ad first: its video is saved with the decode.' }, { status: 409 });
  try {
    const saved = await saveVideo(admin, item.id, await adVideo(admin, item));
    if (!saved.ok) return Response.json({ ok: false, message: saved.message }, { status: 502 });
    return Response.json({ ok: true, video: saved.url });
  } catch (e) {
    return Response.json({ ok: false, message: (e as Error).message }, { status: 502 });
  }
}
