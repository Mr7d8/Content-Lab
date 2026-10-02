import { describe, expect, it, vi } from 'vitest';
import { fetchLandingHtml, publicHttpUrl } from '../lib/safe-fetch';

describe('publicHttpUrl', () => {
  it('accepts public http(s) pages', () => {
    expect(publicHttpUrl('https://sooknow.com/pages/parfum?utm_source=tiktok')?.hostname).toBe('sooknow.com');
    expect(publicHttpUrl('http://mystore.youcan.shop/')).not.toBeNull();
  });

  it('refuses other schemes, credentials, odd ports, local and private hosts', () => {
    for (const bad of [
      'javascript:alert(1)', 'file:///etc/passwd', 'ftp://x.com/', 'https://user:pw@x.com/', 'https://x.com:8443/',
      'http://localhost/', 'http://intranet/', 'http://db.internal/', 'http://127.0.0.1/', 'http://10.0.0.5/', 'http://172.20.1.1/',
      'http://192.168.1.1/', 'http://169.254.169.254/latest/meta-data', 'http://[::1]/', 'http://[fd00::1]/', 'http://[::ffff:127.0.0.1]/', 'not a url',
    ]) expect(publicHttpUrl(bad), bad).toBeNull();
  });
});

describe('fetchLandingHtml', () => {
  const html = (body: string, status = 200, headers: Record<string, string> = { 'content-type': 'text/html; charset=utf-8' }) => new Response(body, { status, headers });

  it('follows public redirects and returns the final page', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: '/fr/parfum' } }))
      .mockResolvedValueOnce(html('<title>Parfum 299 DH</title>'));
    const page = await fetchLandingHtml('https://sooknow.com/parfum', fetchImpl as unknown as typeof fetch);
    expect(page).toEqual({ html: '<title>Parfum 299 DH</title>', url: 'https://sooknow.com/fr/parfum' });
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual' });
  });

  it('stops at a redirect to a private address, at non-HTML answers and at errors', async () => {
    const toPrivate = vi.fn().mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } }));
    expect(await fetchLandingHtml('https://x.com/', toPrivate as unknown as typeof fetch)).toBeNull();
    expect(toPrivate).toHaveBeenCalledTimes(1);
    expect(await fetchLandingHtml('https://x.com/', vi.fn().mockResolvedValue(html('{}', 200, { 'content-type': 'application/json' })) as unknown as typeof fetch)).toBeNull();
    expect(await fetchLandingHtml('https://x.com/', vi.fn().mockResolvedValue(html('gone', 404)) as unknown as typeof fetch)).toBeNull();
    expect(await fetchLandingHtml('https://x.com/', vi.fn().mockRejectedValue(new Error('timeout')) as unknown as typeof fetch)).toBeNull();
    expect(await fetchLandingHtml('http://127.0.0.1/', vi.fn() as unknown as typeof fetch)).toBeNull();
  });

  it('reads at most 1.5 MB', async () => {
    const big = 'a'.repeat(2_000_000);
    const page = await fetchLandingHtml('https://x.com/', vi.fn().mockResolvedValue(html(big)) as unknown as typeof fetch);
    expect(page?.html.length).toBe(1_500_000);
  });
});
