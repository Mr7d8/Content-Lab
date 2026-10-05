import { describe, expect, it } from 'vitest';
import { runActorSync } from '../lib/apify';

describe('runActorSync', () => {
  it("passes on Apify's reason for a refused run, without the token", async () => {
    const refused = (async () =>
      new Response(JSON.stringify({ error: { type: 'actor-memory-limit-exceeded', message: 'By launching this job you will exceed the memory limit of 8192MB (token tok_secret)' } }), { status: 402 })) as typeof fetch;
    const run = runActorSync('a~b', {}, { token: 'tok_secret', timeoutS: 10, what: 'refreshing the video link' }, refused);
    await expect(run).rejects.toThrow('Apify: HTTP 402 while refreshing the video link. By launching this job you will exceed the memory limit of 8192MB (token [redacted])');
  });

  it('still says what failed when Apify sends no reason', async () => {
    const bare = (async () => new Response('Bad gateway', { status: 502 })) as typeof fetch;
    await expect(runActorSync('a~b', {}, { token: 't', timeoutS: 10 }, bare)).rejects.toThrow(/^Apify: HTTP 502 while fetching the video$/);
  });
});
