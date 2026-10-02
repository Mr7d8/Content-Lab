import { adminClient } from '@/lib/admin';
import { checkBoard } from '@/lib/market-check';
import { isWebhookToken, syncScan } from '@/lib/scans';

export const maxDuration = 300;

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
  // Then a Moroccan board checks the ads its text could not sort, so a
  // scheduled scan is sorted even when nobody opens the board.
  let check = null;
  if (result.done && result.boardId) check = await checkBoard(admin, result.boardId, 170_000).catch((e: Error) => ({ ok: false as const, message: e.message }));
  return Response.json({ ok: true, ...result, check });
}
