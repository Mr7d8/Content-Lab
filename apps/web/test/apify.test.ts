import { describe, expect, it } from 'vitest';
import { runActorSync } from '../lib/apify';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const run = (status: string, statusMessage: string | null = null) => ({ data: { id: 'r1', status, statusMessage, defaultDatasetId: 'd1', usageTotalUsd: 0.006 } });

// A stand-in for the Apify API: the run starts, then reports `ended`, and its dataset holds `rows`.
function apify(ended: ReturnType<typeof run>, rows: unknown[]): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/runs?')) return json(run('RUNNING'), 201);
    if (url.includes('/actor-runs/r1')) return json(ended);
    if (url.includes('/datasets/d1/items')) return json(rows);
    return json({ error: { message: 'unexpected' } }, 404);
  }) as typeof fetch;
}

describe('runActorSync', () => {
  it("passes on DD's reason for a refused run, without the token", async () => {
    const refused = (async () =>
      json({ error: { type: 'actor-memory-limit-exceeded', message: 'By launching this job you will exceed the Apify memory limit (token tok_secret)' } }, 402)) as typeof fetch;
    const started = runActorSync('a~b', {}, { token: 'tok_secret', timeoutS: 10, what: 'refreshing the video link' }, refused);
    await expect(started).rejects.toThrow('DD: HTTP 402 while refreshing the video link. By launching this job you will exceed the DD memory limit (token [redacted])');
  });

  it('keeps what a run found even when it was stopped early', async () => {
    const done = await runActorSync('a~b', {}, { token: 't', timeoutS: 10, maxItems: 3 }, apify(run('ABORTED'), [{ adId: '1' }, { adId: '2' }]));
    expect(done.rows).toEqual([{ adId: '1' }, { adId: '2' }]);
    expect(done.run).toMatchObject({ status: 'ABORTED', usageTotalUsd: 0.006 });
  });

  it('says how a run ended when it found nothing', async () => {
    const empty = runActorSync('a~b', {}, { token: 't', timeoutS: 10, what: 'refreshing the video link' }, apify(run('ABORTED', 'Stopped by the platform'), []));
    await expect(empty).rejects.toThrow('DD: the scraper was stopped without results while refreshing the video link (run r1): Stopped by the platform');
  });
});
