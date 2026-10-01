import type { SourceId } from './sources';

export type ParsedLink =
  | { ok: true; source: SourceId; externalId: string; url: string; handle: string | null; region: string | null }
  | { ok: false; input: string; reason: string; shortLink?: boolean };

const TIKTOK_HOSTS = new Set(['tiktok.com', 'www.tiktok.com', 'm.tiktok.com']);
const SHORT_HOSTS = new Set(['vm.tiktok.com', 'vt.tiktok.com']);

// Parse one pasted link into a source and external id.
// Short links (vm.tiktok.com, tiktok.com/t/...) must be resolved first with resolveShortLink.
export function parseLink(input: string): ParsedLink {
  const raw = input.trim();
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { ok: false, input: raw, reason: 'Not a URL' };
  }
  const host = url.hostname.toLowerCase();
  const path = url.pathname;

  if (SHORT_HOSTS.has(host) || (TIKTOK_HOSTS.has(host) && /^\/t\/[\w-]+\/?$/.test(path))) {
    return { ok: false, input: raw, reason: 'Short link, needs resolving', shortLink: true };
  }

  if (TIKTOK_HOSTS.has(host)) {
    const video = path.match(/^\/@([\w.-]+)\/video\/(\d{8,25})\/?$/);
    if (video) {
      const [, handle, id] = video as unknown as [string, string, string];
      return { ok: true, source: 'tiktok_organic', externalId: id, url: `https://www.tiktok.com/@${handle}/video/${id}`, handle, region: null };
    }
    const legacy = path.match(/^\/v\/(\d{8,25})(?:\.html)?\/?$/);
    if (legacy) {
      const id = legacy[1] as string;
      // No handle in legacy links, so keep the link as given.
      return { ok: true, source: 'tiktok_organic', externalId: id, url: url.href, handle: null, region: null };
    }
    if (/^\/@[\w.-]+\/photo\/\d+/.test(path)) {
      return { ok: false, input: raw, reason: 'Photo posts are not supported yet' };
    }
    return { ok: false, input: raw, reason: 'Not a TikTok video link' };
  }

  if (host === 'ads.tiktok.com' && path.includes('/creativecenter/')) {
    const ad = path.match(/\/topads\/(\d{8,25})(?:\/|$)/);
    if (ad) {
      const id = ad[1] as string;
      const region = (url.searchParams.get('countryCode') ?? url.searchParams.get('region'))?.toUpperCase() ?? null;
      return {
        ok: true,
        source: 'tiktok_creative_center',
        externalId: id,
        url: `https://ads.tiktok.com/business/creativecenter/topads/${id}/`,
        handle: null,
        region: region && /^[A-Z]{2}$/.test(region) ? region : null,
      };
    }
    return { ok: false, input: raw, reason: 'Creative Center link is not a Top Ads detail page' };
  }

  return { ok: false, input: raw, reason: 'Only TikTok and Creative Center links are supported' };
}

// Split pasted text into links (one per line, or separated by spaces or commas).
export function splitLinks(text: string): string[] {
  return [...new Set(text.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean))];
}

// Follow redirects of a TikTok short link to its full video URL.
export async function resolveShortLink(input: string, fetchImpl: typeof fetch = fetch): Promise<ParsedLink> {
  let current = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  for (let hop = 0; hop < 5; hop++) {
    const res = await fetchImpl(current, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(10000) });
    const location = res.headers.get('location');
    if (res.status < 300 || res.status >= 400 || !location) break;
    current = new URL(location, current).href;
    const parsed = parseLink(current);
    if (parsed.ok) return parsed;
  }
  return { ok: false, input, reason: 'Short link did not resolve to a TikTok video' };
}
