// TikTok only for now. Source ids carry the channel as a prefix, so another
// channel adds new ids without a schema change.
export const SOURCES = {
  tiktok_creative_center: { label: 'Creative Center', phase: 1, adEvidence: true },
  tiktok_organic: { label: 'TikTok organic', phase: 1, adEvidence: false },
  tiktok_commercial_library: { label: 'Commercial Content Library', phase: 2, adEvidence: true },
  tiktok_own_ads: { label: 'Our TikTok ads', phase: 3, adEvidence: true },
} as const;
export type SourceId = keyof typeof SOURCES;

export function sourceLabel(source: string): string {
  return (SOURCES as Record<string, { label: string }>)[source]?.label ?? source;
}

// How items entered a run.
export const RUN_SOURCES = ['manual_import', 'tiktok_creative_center', 'tiktok_organic'] as const;
export type RunSource = (typeof RUN_SOURCES)[number];

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

// Countries a watchlist region covers; null means any region.
export function expandRegion(region: string | null): string[] | null {
  if (region === null) return null;
  return [...(REGION_GROUPS[region] ?? [region])];
}

// Our objectives mapped to Creative Center's objective keys. If the actor
// rejects them, the search runs without the filter and the run says so.
export const CREATIVE_CENTER_OBJECTIVE = {
  app_install: 'campaign_objective_app_installs',
  purchase: 'campaign_objective_conversion',
} as const;
