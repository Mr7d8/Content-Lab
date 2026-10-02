import { adminClient } from '@/lib/admin';
import { checkBoard } from '@/lib/market-check';
import { requireTeam } from '@/lib/team';

// The detail pages, landing pages and covers of a batch take a few minutes.
export const maxDuration = 300;

// Runs the Moroccan check on the board's waiting ads. The board calls it
// again while ads are still waiting.
export async function POST(_request: Request, ctx: RouteContext<'/api/boards/[id]/check'>) {
  const denied = await requireTeam();
  if (denied) return denied;
  const { id } = await ctx.params;
  try {
    const result = await checkBoard(adminClient(), id, 240_000);
    return Response.json(result, { status: result.ok ? 200 : 422 });
  } catch (e) {
    return Response.json({ ok: false, message: (e as Error).message }, { status: 502 });
  }
}
