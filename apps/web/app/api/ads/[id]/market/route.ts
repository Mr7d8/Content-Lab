import { adminClient } from '@/lib/admin';
import { markMarket } from '@/lib/market-marks';
import { requireTeam } from '@/lib/team';

// The team's call on an ad: { verdict: "moroccan" } or { verdict: "elsewhere" }.
export async function POST(request: Request, ctx: RouteContext<'/api/ads/[id]/market'>) {
  const denied = await requireTeam();
  if (denied) return denied;
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as { verdict?: unknown } | null;
  const verdict = body?.verdict;
  if (verdict !== 'moroccan' && verdict !== 'elsewhere') return Response.json({ ok: false, message: 'Say moroccan or elsewhere.' }, { status: 400 });
  const result = await markMarket(adminClient(), id, verdict);
  return Response.json(result, { status: result.ok ? 200 : 422 });
}
