import { loadAdDetail } from '@/lib/ad-detail';
import { createClient } from '@/lib/supabase/server';
import { requireTeam } from '@/lib/team';

// The inspector's frame by frame data for one ad.
export async function GET(_request: Request, ctx: RouteContext<'/api/ads/[id]/detail'>) {
  const denied = await requireTeam();
  if (denied) return denied;
  const { id } = await ctx.params;
  const detail = await loadAdDetail(await createClient(), id);
  if (!detail) return Response.json({ ok: false, message: 'Ad not found.' }, { status: 404 });
  return Response.json({ ok: true, detail }, { headers: { 'Cache-Control': 'private, no-store' } });
}
