import { describe, expect, it, vi } from 'vitest';
import { parseLink, resolveShortLink, splitLinks } from '../src/urls';

describe('parseLink', () => {
  it('parses TikTok video links', () => {
    const r = parseLink('https://www.tiktok.com/@temu/video/7301234567890123456?is_from_webapp=1');
    expect(r).toEqual({
      ok: true, source: 'tiktok_organic', externalId: '7301234567890123456',
      url: 'https://www.tiktok.com/@temu/video/7301234567890123456', handle: 'temu', region: null,
    });
  });

  it('accepts links without a scheme', () => {
    const r = parseLink('tiktok.com/@shein_official/video/7301234567890123456');
    expect(r.ok && r.handle).toBe('shein_official');
  });

  it('parses Creative Center Top Ads links with a region', () => {
    const r = parseLink('https://ads.tiktok.com/business/creativecenter/topads/7299999999999999999/pc/en?countryCode=ma&from=001010');
    expect(r).toMatchObject({ ok: true, source: 'tiktok_creative_center', externalId: '7299999999999999999', region: 'MA' });
  });

  it('flags short links for resolving', () => {
    expect(parseLink('https://vm.tiktok.com/ZMabc123/')).toMatchObject({ ok: false, shortLink: true });
    expect(parseLink('https://www.tiktok.com/t/ZT8abc/')).toMatchObject({ ok: false, shortLink: true });
  });

  it('rejects other links with a reason', () => {
    expect(parseLink('https://www.instagram.com/reel/abc')).toMatchObject({ ok: false });
    expect(parseLink('https://www.tiktok.com/@temu')).toMatchObject({ ok: false, reason: 'Not a TikTok video link' });
    expect(parseLink('https://www.tiktok.com/@a/photo/7301234567890123456')).toMatchObject({ ok: false, reason: 'Photo posts are not supported yet' });
    expect(parseLink('not a url at all')).toMatchObject({ ok: false });
  });
});

describe('splitLinks', () => {
  it('splits on lines, spaces and commas and removes duplicates', () => {
    expect(splitLinks('a\nb, c  a\n\n')).toEqual(['a', 'b', 'c']);
  });
});

describe('resolveShortLink', () => {
  it('follows redirects to the full video URL', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, {
      status: 301,
      headers: { location: 'https://www.tiktok.com/@noon/video/7301234567890123456?_r=1' },
    }));
    const r = await resolveShortLink('https://vm.tiktok.com/ZMabc123/', fetchImpl as unknown as typeof fetch);
    expect(r).toMatchObject({ ok: true, externalId: '7301234567890123456', handle: 'noon' });
  });

  it('fails cleanly when there is no redirect', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    const r = await resolveShortLink('https://vm.tiktok.com/ZMabc123/', fetchImpl as unknown as typeof fetch);
    expect(r.ok).toBe(false);
  });
});
