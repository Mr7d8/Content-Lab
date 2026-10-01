import { describe, expect, it, vi } from 'vitest';
import { startWorkerActor } from '../lib/apify';
import { MAX_LINKS_PER_RUN, prepareLinks } from '../lib/import';

describe('prepareLinks', () => {
  it('accepts supported links, de-duplicates, and explains rejections', async () => {
    const text = [
      'https://www.tiktok.com/@temu/video/7301234567890123456',
      'https://www.tiktok.com/@temu/video/7301234567890123456?lang=fr',
      'https://ads.tiktok.com/business/creativecenter/topads/7299999999999999999/',
      'https://www.instagram.com/reel/abc',
    ].join('\n');
    const { accepted, rejected } = await prepareLinks(text, async () => { throw new Error('no network'); });
    expect(accepted.map((a) => a.source)).toEqual(['tiktok_organic', 'tiktok_creative_center']);
    expect(rejected).toEqual([{ input: 'https://www.instagram.com/reel/abc', reason: 'Only TikTok and Creative Center links are supported' }]);
  });

  it('resolves short links through the resolver', async () => {
    const resolve = vi.fn(async () => ({
      ok: true as const, source: 'tiktok_organic' as const, externalId: '7301234567890123456',
      url: 'https://www.tiktok.com/@noon/video/7301234567890123456', handle: 'noon', region: null,
    }));
    const { accepted } = await prepareLinks('https://vm.tiktok.com/ZMabc/', resolve);
    expect(resolve).toHaveBeenCalledOnce();
    expect(accepted[0]?.handle).toBe('noon');
  });

  it('reports short links that fail to resolve', async () => {
    const { rejected } = await prepareLinks('https://vm.tiktok.com/ZMabc/', async () => { throw new Error('timeout'); });
    expect(rejected[0]?.reason).toBe('Short link could not be resolved');
  });

  it('caps the number of links per run', async () => {
    const links = Array.from({ length: MAX_LINKS_PER_RUN + 2 }, (_, i) => `https://www.tiktok.com/@a/video/${7300000000000000000n + BigInt(i)}`);
    const { accepted, rejected } = await prepareLinks(links.join('\n'));
    expect(accepted).toHaveLength(MAX_LINKS_PER_RUN);
    expect(rejected).toHaveLength(2);
  });
});

describe('startWorkerActor', () => {
  const env = { token: 'apify_api_test', workerActorId: 'me~content-lab-worker' };

  it('starts the actor with the run id as input', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ data: { id: 'run123' } }));
    const result = await startWorkerActor('abc', env, fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ ok: true, workerRunId: 'run123' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.apify.com/v2/acts/me~content-lab-worker/runs?memory=1024&timeout=3600');
    expect(JSON.parse(String(init.body))).toEqual({ runId: 'abc' });
  });

  it('explains auth and not-found failures', async () => {
    const unauthorized = vi.fn(async () => new Response('', { status: 401 }));
    expect(await startWorkerActor('abc', env, unauthorized as unknown as typeof fetch)).toEqual({ ok: false, message: 'Apify did not start the worker (check APIFY_TOKEN)' });
    const missing = vi.fn(async () => new Response('', { status: 404 }));
    expect(await startWorkerActor('abc', env, missing as unknown as typeof fetch)).toMatchObject({ message: expect.stringContaining('APIFY_WORKER_ACTOR_ID') });
  });
});
