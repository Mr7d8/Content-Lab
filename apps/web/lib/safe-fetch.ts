// Fetches an ad's landing page for the Moroccan check. The address comes from
// TikTok's data, so it is treated as untrusted: http(s) only, public hosts
// only (no localhost, private or link-local addresses), every redirect is
// checked the same way, and the download is capped in time and size.

const MAX_BYTES = 1_500_000;
const MAX_REDIRECTS = 4;
const TIMEOUT_MS = 8000;
// The page a phone user sees: stores show their prices and order form to it.
const USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

function privateIPv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

function privateIPv6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (!h.includes(':')) return false;
  return h === '::' || h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80') || h.startsWith('::ffff:') || h.startsWith('64:ff9b');
}

// The URL when it is a public http(s) address we may fetch, else null.
export function publicHttpUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password) return null;
  if (url.port && url.port !== '80' && url.port !== '443') return null;
  const host = url.hostname.toLowerCase();
  if (!host.includes('.') || host === 'localhost' || /\.(localhost|local|internal|lan|home|corp)$/.test(host)) return null;
  if (privateIPv4(host) || privateIPv6(host)) return null;
  return url;
}

async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      size += value.length;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const all = new Uint8Array(Math.min(size, MAX_BYTES));
  let at = 0;
  for (const p of parts) {
    const take = Math.min(p.length, all.length - at);
    all.set(p.subarray(0, take), at);
    at += take;
    if (at >= all.length) break;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(all);
}

function resolve(location: string, base: URL): string {
  try {
    return new URL(location, base).toString();
  } catch {
    return '';
  }
}

// The page's HTML and final address, or null when it cannot be read.
export async function fetchLandingHtml(raw: string, fetchImpl: typeof fetch = fetch): Promise<{ html: string; url: string } | null> {
  let url = publicHttpUrl(raw);
  for (let hop = 0; url && hop <= MAX_REDIRECTS; hop++) {
    const res = await fetchImpl(url.toString(), {
      redirect: 'manual',
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'fr-MA,ar-MA;q=0.9,fr;q=0.8,ar;q=0.7' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch(() => null);
    if (!res) return null;
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get('location');
      await res.body?.cancel().catch(() => undefined);
      url = next ? publicHttpUrl(resolve(next, url)) : null;
      continue;
    }
    if (!res.ok || !/html/i.test(res.headers.get('content-type') ?? '')) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    return { html: await readCapped(res), url: url.toString() };
  }
  return null;
}
