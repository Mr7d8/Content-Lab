import { adminClient } from '@/lib/admin';
import { isWebhookToken, syncScan } from '@/lib/scans';

export const maxDuration = 120;

// Apify calls this when a scan's scraper run ends, so the board fills in even
// when nobody has it open. The body is ignored: the run is read from Apify.
export async function POST(request: Request) {
  const url = new URL(request.url);
  const runId = url.searchParams.get('run');
  if (!runId || !isWebhookToken(runId, url.searchParams.get('token'))) return Response.json({ ok: false }, { status: 401 });
  const admin = adminClient();
  let result = await syncScan(admin, runId, 50_000);
  // A large dataset may need a second pass within the same call.
  if (!result.done && result.status === 'running') result = await syncScan(admin, runId, 50_000);
  return Response.json({ ok: true, ...result });
}
