import { describe, expect, it, vi } from 'vitest';
import { isCronRequest, startDailySweep } from '../lib/cron';

const apify = { token: 'apify_api_test', workerActorId: 'actor1' };

describe('daily sweep cron', () => {
  it('accepts only the exact bearer secret', () => {
    expect(isCronRequest('Bearer s3cret', 's3cret')).toBe(true);
    expect(isCronRequest('Bearer wrong', 's3cret')).toBe(false);
    expect(isCronRequest(null, 's3cret')).toBe(false);
    expect(isCronRequest('Bearer ', undefined)).toBe(false);
  });

  it('starts the worker in sweep mode with the dashboard settings', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ data: { id: 'apifyrun1' } }));
    const result = await startDailySweep('Bearer s3cret', { cronSecret: 's3cret', apify, workerInput: { groqApiKey: 'gsk_x' } }, fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ status: 200, body: { ok: true, workerRunId: 'apifyrun1' } });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/acts/actor1/runs?memory=1024&timeout=3600');
    expect(JSON.parse(String(init.body))).toEqual({ mode: 'sweep', groqApiKey: 'gsk_x' });
  });

  it('refuses callers without the secret, without touching Apify', async () => {
    const fetchImpl = vi.fn();
    expect(await startDailySweep('Bearer nope', { cronSecret: 's3cret', apify, workerInput: {} }, fetchImpl as unknown as typeof fetch)).toEqual({ status: 401, body: { ok: false } });
    expect(await startDailySweep(null, { cronSecret: undefined, apify, workerInput: {} }, fetchImpl as unknown as typeof fetch)).toMatchObject({ status: 401 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
