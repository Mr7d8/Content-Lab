// TikTok only for now. Source ids carry the channel as a prefix, so another
// channel adds new ids without a schema change.
export const SOURCES = {
  tiktok_creative_center: { label: 'Creative Center', phase: 1, adEvidence: true },
  tiktok_organic: { label: 'TikTok organic', phase: 1, adEvidence: false },
  meta_ad_library: { label: 'Meta Ad Library', phase: 1, adEvidence: true },
  tiktok_commercial_library: { label: 'Commercial Content Library', phase: 2, adEvidence: true },
  tiktok_own_ads: { label: 'Our TikTok ads', phase: 3, adEvidence: true },
} as const;
export type SourceId = keyof typeof SOURCES;

export function sourceLabel(source: string): string {
  return (SOURCES as Record<string, { label: string }>)[source]?.label ?? source;
}

// Region groups used by watchlists. Countries are ISO 3166-1 alpha-2.
export const REGION_GROUPS: Readonly<Record<string, readonly string[]>> = {
  MENA: ['MA', 'DZ', 'TN', 'EG', 'SA', 'AE', 'KW', 'QA', 'BH', 'OM', 'JO', 'LB', 'IQ'],
};

export const REGION_NAMES: Readonly<Record<string, string>> = {
  MA: 'Morocco',
  FR: 'France',
  MENA: 'MENA',
  DZ: 'Algeria',
  TN: 'Tunisia',
  EG: 'Egypt',
  SA: 'Saudi Arabia',
  AE: 'United Arab Emirates',
  KW: 'Kuwait',
  QA: 'Qatar',
  BH: 'Bahrain',
  OM: 'Oman',
  JO: 'Jordan',
  LB: 'Lebanon',
  IQ: 'Iraq',
};

// "Any region" on Creative Center: given no country, the scraper searches the
// US alone (a Shein board found 16 ads, all American), so any region means the
// biggest Creative Center markets instead.
export const ANY_REGION_COUNTRIES: readonly string[] = [
  'US', 'GB', 'CA', 'AU', 'FR', 'DE', 'IT', 'ES', 'BR', 'MX', 'JP', 'KR',
  'ID', 'TH', 'VN', 'MY', 'PH', 'SA', 'AE', 'EG', 'TR', 'MA',
];

// Facebook pages of the Wasal competitors, as Meta's Ad Library names them
// in Morocco (looked up 2026-10-03). An advertiser board on Meta follows a
// known page by its id, so it gets only that page's ads; any other name is
// searched as words and kept only from pages of that name.
export const META_PAGES: Readonly<Record<string, string>> = {
  jumia: '420277734679018',
  'avito.ma': '228265657217797',
  avito: '228265657217797',
  'marjane market': '101407061355100',
  marjane: '101407061355100',
  electroplanet: '555879391226328',
  kitea: '232771703423452',
};

export const metaPageId = (name: string): string | null => META_PAGES[name.trim().toLowerCase()] ?? (/^\d{6,20}$/.test(name.trim()) ? name.trim() : null);

// Countries a watchlist region covers; null means any region.
export function expandRegion(region: string | null): string[] | null {
  if (region === null) return null;
  return [...(REGION_GROUPS[region] ?? [region])];
}

// The countries Creative Center lists top ads for (the Creative Center
// scraper's own list, 2026-10-07). Algeria, Tunisia, Lebanon and Iraq are not
// among them, so a MENA board scans the rest.
export const CREATIVE_CENTER_COUNTRIES: ReadonlySet<string> = new Set([
  'AR', 'AU', 'AT', 'BH', 'BD', 'BY', 'BE', 'BR', 'BG', 'KH', 'CA', 'CL', 'CO', 'HR', 'CZ', 'DK', 'EG', 'FI', 'FR', 'DE', 'GR',
  'HU', 'ID', 'IE', 'IL', 'IT', 'JP', 'JO', 'KZ', 'KW', 'MY', 'MX', 'MA', 'NL', 'NZ', 'NO', 'OM', 'PK', 'PE', 'PH', 'PL', 'PT',
  'QA', 'RO', 'RU', 'SA', 'SG', 'SK', 'ZA', 'KR', 'ES', 'SE', 'CH', 'TW', 'TH', 'TR', 'UA', 'AE', 'GB', 'US', 'VN',
]);

// Creative Center objectives that count as each of ours. Scans sweep every
// objective (the scraper takes TikTok's numeric objective ids, which TikTok
// does not publish), so each ad is checked against the board's objective.
const OBJECTIVE_MATCHES: Readonly<Record<string, RegExp>> = {
  purchase: /^campaign_objective_(conversion|product_sales|shop_purchases?)$/,
  app_install: /^campaign_objective_(app_installs?|app_promotion)$/,
};

// Whether an ad's Creative Center objective fits the board's. Ads with no
// objective, and boards without one, always fit.
export function fitsObjective(boardObjective: string | null, adObjective: string | null): boolean {
  const pattern = boardObjective ? OBJECTIVE_MATCHES[boardObjective] : undefined;
  if (!pattern || !adObjective) return true;
  return pattern.test(adObjective);
}
