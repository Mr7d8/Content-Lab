// What an ad's landing page says about where the advertiser sells: the store's
// currency, its locale, WhatsApp and phone links, the store platform and its
// text. Read from the HTML with patterns, no browser. Pure, so it is tested
// without the network.

export type LandingSignals = {
  // The page's address after redirects, and its host without "www.".
  url: string;
  host: string;
  // ISO 4217 code from the store's metadata (Shopify, schema.org, Open Graph).
  currency: string | null;
  // Like "ar_MA", from <html lang> or og:locale.
  locale: string | null;
  // WhatsApp and phone links, which carry the country calling code.
  links: string[];
  platform: 'shopify' | 'youcan' | 'woocommerce' | 'lightfunnels' | null;
  // Title, description and the start of the visible text.
  text: string;
};

const MAX_TEXT = 6000;

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (whole, name: string) => {
    const lower = name.toLowerCase();
    if (lower.startsWith('#x')) return String.fromCodePoint(parseInt(lower.slice(2), 16) || 32);
    if (lower.startsWith('#')) return String.fromCodePoint(Number(lower.slice(1)) || 32);
    return ENTITIES[lower] ?? whole;
  });
}

// A <meta> tag's content by its property or name, in either attribute order.
function meta(html: string, key: string): string | null {
  const k = key.replace(/[.:]/g, '\\$&');
  const a = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${k}["'][^>]*content=["']([^"']*)["']`, 'i').exec(html);
  const b = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name|itemprop)=["']${k}["']`, 'i').exec(html);
  const value = (a ?? b)?.[1]?.trim();
  return value ? decodeEntities(value) : null;
}

const CURRENCY_PATTERNS = [
  /Shopify\.currency\s*=\s*\{[^}]*?"active"\s*:\s*"([A-Z]{3})"/,
  /"currencyCode"\s*:\s*"([A-Z]{3})"/,
  /"priceCurrency"\s*:\s*"([A-Z]{3})"/,
  /"currency"\s*:\s*"([A-Z]{3})"/,
];

function currencyOf(html: string): string | null {
  const fromMeta = meta(html, 'og:price:currency') ?? meta(html, 'product:price:currency') ?? meta(html, 'priceCurrency');
  if (fromMeta && /^[A-Z]{3}$/.test(fromMeta)) return fromMeta;
  for (const pattern of CURRENCY_PATTERNS) {
    const m = pattern.exec(html);
    if (m?.[1]) return m[1];
  }
  return null;
}

function localeOf(html: string): string | null {
  const og = meta(html, 'og:locale');
  const lang = /<html[^>]*\blang=["']([a-z]{2}(?:[-_][a-z]{2})?)["']/i.exec(html)?.[1];
  const value = (og && /^[a-z]{2}[-_][a-z]{2}$/i.test(og) ? og : lang) ?? og;
  if (!value) return null;
  const [l, r] = value.replace('-', '_').split('_');
  return r ? `${l?.toLowerCase()}_${r.toUpperCase()}` : (l?.toLowerCase() ?? null);
}

function linksOf(html: string): string[] {
  const out = new Set<string>();
  const pattern = /href=["']((?:https?:\/\/(?:wa\.me|api\.whatsapp\.com|web\.whatsapp\.com)\/[^"']*)|(?:tel:[^"']+))["']/gi;
  for (const m of html.matchAll(pattern)) {
    out.add(decodeEntities(m[1] as string).toLowerCase());
    if (out.size >= 10) break;
  }
  return [...out];
}

function platformOf(html: string, host: string): LandingSignals['platform'] {
  if (/(^|\.)youcan\.(shop|store)$/.test(host) || /cdn\.youcan\.shop|youcan-storefront|youcan\.shop\/assets/i.test(html)) return 'youcan';
  if (/cdn\.shopify\.com|Shopify\.theme|myshopify\.com/i.test(html)) return 'shopify';
  if (/lightfunnels/i.test(html)) return 'lightfunnels';
  if (/woocommerce/i.test(html)) return 'woocommerce';
  return null;
}

function visibleText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' '),
  ).replace(/\s+/g, ' ').trim();
}

export function landingSignals(html: string, url: string): LandingSignals {
  const host = hostOf(url) ?? '';
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const head = [title, meta(html, 'description'), meta(html, 'og:title'), meta(html, 'og:description'), meta(html, 'og:site_name')]
    .filter((t): t is string => !!t && !!t.trim())
    .map((t) => decodeEntities(t).replace(/\s+/g, ' ').trim());
  return {
    url,
    host,
    currency: currencyOf(html),
    locale: localeOf(html),
    links: linksOf(html),
    platform: platformOf(html, host),
    text: [...new Set(head), visibleText(html)].join('\n').slice(0, MAX_TEXT),
  };
}

const PLACEHOLDER_BRAND = /^(not mention(ed)?|unknown|n\/a|none|-)$/i;

// Hosts many advertisers share (social apps, link pages, app stores, store
// platforms' own sites): they say nothing about who the advertiser is. A
// store's own subdomain (mystore.youcan.shop) is still its own.
const SHARED_HOSTS = /(^|\.)(tiktok\.com|facebook\.com|fb\.me|instagram\.com|wa\.me|whatsapp\.com|linktr\.ee|bit\.ly|t\.co|google\.com|youtube\.com|apple\.com)$|^(youcan\.shop|myshopify\.com|shopify\.com)$/;

// The keys an advertiser is remembered by (advertisers.key): its brand name
// and its landing page host, lowercased. Placeholders are left out.
export function advertiserKeys(ad: { brand?: string | null; landingHost?: string | null }): string[] {
  const keys: string[] = [];
  const brand = ad.brand?.trim().replace(/\s+/g, ' ');
  if (brand && brand.length >= 2 && !PLACEHOLDER_BRAND.test(brand)) keys.push(`brand:${brand.toLowerCase()}`);
  const host = ad.landingHost?.trim().toLowerCase().replace(/^www\./, '');
  if (host && !SHARED_HOSTS.test(host)) keys.push(`domain:${host}`);
  return keys;
}
