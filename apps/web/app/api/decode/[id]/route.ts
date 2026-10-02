import { adminClient } from '@/lib/admin';
import { decodeAd } from '@/lib/decode';
import { requireTeam } from '@/lib/team';

// One ad per call (about 15 to 40 s), so the board can run several at once.
export const maxDuration = 300;

export async function POST(_request: Request, ctx: RouteContext<'/api/decode/[id]'>) {
  const denied = await requireTeam();
  if (denied) return denied;
  const { id } = await ctx.params;
  const result = await decodeAd(adminClient(), id);
  return Response.json(result, { status: result.ok ? 200 : 422 });
}
