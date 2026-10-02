import { adminClient } from '@/lib/admin';
import { syncScan } from '@/lib/scans';
import { requireTeam } from '@/lib/team';

export const maxDuration = 60;

// Called every few seconds by an open board while its scan runs.
export async function POST(_request: Request, ctx: RouteContext<'/api/scans/[id]/sync'>) {
  const denied = await requireTeam();
  if (denied) return denied;
  const { id } = await ctx.params;
  try {
    return Response.json({ ok: true, ...(await syncScan(adminClient(), id)) });
  } catch (e) {
    return Response.json({ ok: false, message: (e as Error).message }, { status: 502 });
  }
}
