import { startDailySweep } from '@/lib/cron';
import { apifyEnv, workerInput } from '@/lib/env';

// Called once a day by Vercel Cron (see vercel.json); starts the research sweep.
export async function GET(request: Request) {
  const result = await startDailySweep(request.headers.get('authorization'), {
    cronSecret: process.env.CRON_SECRET,
    apify: apifyEnv(),
    workerInput: workerInput(),
  });
  return Response.json(result.body, { status: result.status });
}
