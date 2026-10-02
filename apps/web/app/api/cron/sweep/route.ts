import { dueWatchlists } from '@content-lab/core';
import { adminClient } from '@/lib/admin';
import { isCronRequest } from '@/lib/cron';
import { startScan } from '@/lib/scans';

export const maxDuration = 60;

// Called once a day by Vercel Cron (vercel.json): rescans every board that is
// due, under the monthly cap. Scans only; nothing is decoded automatically.
export async function GET(request: Request) {
  if (!isCronRequest(request.headers.get('authorization'), process.env.CRON_SECRET)) return Response.json({ ok: false }, { status: 401 });
  const admin = adminClient();
  const { data: settings } = await admin.from('app_settings').select('sweeps_enabled').maybeSingle();
  if (!settings?.sweeps_enabled) return Response.json({ ok: true, started: [], note: 'Daily sweep is off' });
  const { data: boards } = await admin.from('watchlists').select('*').eq('active', true);
  const started: { board: string; ok: boolean; message?: string }[] = [];
  for (const board of dueWatchlists(boards ?? [], new Date())) {
    const result = await startScan(admin, board.id, 'schedule');
    started.push({ board: board.name, ok: result.ok, ...(result.ok ? {} : { message: result.message }) });
    // Stop at the first budget refusal: the month is spent.
    if (!result.ok && /budget/.test(result.message)) break;
  }
  return Response.json({ ok: true, started });
}
