import { adminClient } from '@/lib/admin';
import { startScan } from '@/lib/scans';
import { requireTeam } from '@/lib/team';

// Starts a scan of the board (or returns the one already running).
export async function POST(_request: Request, ctx: RouteContext<'/api/boards/[id]/scan'>) {
  const denied = await requireTeam();
  if (denied) return denied;
  const { id } = await ctx.params;
  const result = await startScan(adminClient(), id, 'manual');
  return Response.json(result, { status: result.ok ? 200 : 400 });
}
