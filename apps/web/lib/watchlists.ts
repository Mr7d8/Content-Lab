import {
  CADENCE_DAYS,
  DISCOVERY_SOURCES,
  MAX_SCAN_ADS,
  nextSweepAt,
  REGION_GROUPS,
  REGION_NAMES,
  sourceLabel,
  WATCHLIST_TYPES,
  type DiscoverySource,
  type Tables,
  type TablesInsert,
} from '@content-lab/core';

type Watchlist = Tables<'watchlists'>;

// Regions offered in the Add watchlist form: groups, then countries.
export const REGION_OPTIONS = [...Object.keys(REGION_GROUPS), ...Object.keys(REGION_NAMES).filter((r) => !(r in REGION_GROUPS))];

export const TYPE_LABELS: Record<string, string> = {
  industry: 'Industry',
  advertiser: 'Advertiser',
  keyword: 'Keyword',
  hashtag: 'Hashtag',
  account: 'Account',
};

export const OBJECTIVES = ['app_install', 'purchase'] as const;
export const CADENCES = ['weekly', 'monthly', 'manual'] as const;
export const PERIODS = [7, 30, 180] as const;
// Choices offered in the board menu.
export const ADS_PER_SCAN = [10, 20, 30, 50, 100, 200] as const;

export function regionLabel(region: string | null): string {
  return region ? (REGION_NAMES[region] ?? region) : 'Any region';
}

export type ParsedWatchlist = { ok: true; row: TablesInsert<'watchlists'> } | { ok: false; message: string };

// Validates the Add watchlist form. `get` reads one field.
export function parseWatchlistForm(get: (name: string) => string | null): ParsedWatchlist {
  const source = get('source') ?? '';
  if (!(DISCOVERY_SOURCES as readonly string[]).includes(source)) return { ok: false, message: 'Pick a source.' };
  const type = get('type') ?? '';
  if (!WATCHLIST_TYPES[source as DiscoverySource].includes(type)) {
    return { ok: false, message: `${sourceLabel(source)} cannot search by ${TYPE_LABELS[type]?.toLowerCase() ?? 'that'}.` };
  }
  let value = (get('value') ?? '').trim().replace(/\s+/g, ' ');
  if (type === 'hashtag') value = value.replace(/^#/, '');
  if (type === 'account') value = value.replace(/^@/, '');
  if (!value) return { ok: false, message: `Enter the ${TYPE_LABELS[type]?.toLowerCase()} to search for.` };
  if (value.length > 100) return { ok: false, message: 'Keep the search value under 100 characters.' };

  const region = get('region') || null;
  if (region !== null && !REGION_OPTIONS.includes(region)) return { ok: false, message: 'Pick a region from the list.' };
  const objective = source === 'tiktok_creative_center' ? get('objective') || null : null;
  if (objective !== null && !(OBJECTIVES as readonly string[]).includes(objective)) return { ok: false, message: 'Pick an objective from the list.' };
  const cadence = get('refresh_cadence') ?? 'weekly';
  if (!(CADENCES as readonly string[]).includes(cadence)) return { ok: false, message: 'Pick how often to refresh.' };
  const maxItems = Number(get('max_items') ?? 30);
  if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > MAX_SCAN_ADS) return { ok: false, message: `Ads per scan must be between 1 and ${MAX_SCAN_ADS}.` };
  const period = Number(get('period_days') ?? 30);
  if (!(PERIODS as readonly number[]).includes(period)) return { ok: false, message: 'Pick a period: 7, 30 or 180 days.' };

  // An industry board without a Creative Center industry key scans every industry.
  const shown = type === 'hashtag' ? `#${value}` : type === 'account' ? `@${value}` : type === 'industry' && !/^label_\d+$/.test(value) ? 'Top ads' : value;
  const name = (get('name') ?? '').trim().slice(0, 80) || `${shown}, ${regionLabel(region)}`;
  return { ok: true, row: { name, source, type, value, region, objective, refresh_cadence: cadence, max_items: maxItems, period_days: period } };
}

const DAY_MS = 86_400_000;

function days(n: number): string {
  return n === 1 ? '1 day' : `${n} days`;
}

// "Last swept" text, by calendar distance.
export function sweptText(lastSweptAt: string | null, now: Date): string {
  if (!lastSweptAt) return 'Never swept';
  const ago = Math.floor((now.getTime() - Date.parse(lastSweptAt)) / DAY_MS);
  return ago <= 0 ? 'Swept today' : `Swept ${days(ago)} ago`;
}

// "Next" text for the schedule column.
export function scheduleText(w: Pick<Watchlist, 'active' | 'refresh_cadence' | 'last_swept_at'>, now: Date): string {
  if (!w.active) return 'Off';
  if (w.refresh_cadence === 'manual') return 'Manual scans only';
  const next = nextSweepAt(w, now);
  if (!next || next.getTime() <= now.getTime()) return 'Due at the next daily scan';
  return `Next scan in ${days(Math.ceil((next.getTime() - now.getTime()) / DAY_MS))}`;
}

export function cadenceText(cadence: string): string {
  return cadence in CADENCE_DAYS ? `Every ${cadence === 'weekly' ? 'week' : 'month'}` : 'Manual';
}

export type MeterState = { ratio: number; level: 'ok' | 'warn' | 'over'; label: string };

// Month spend against the cap. The level picks the fill color; the label
// says the same in words.
export function meterState(spendUsd: number, capUsd: number): MeterState {
  if (capUsd <= 0) return { ratio: 1, level: 'over', label: 'Paused: the monthly cap is $0' };
  const ratio = Math.min(1, spendUsd / capUsd);
  if (spendUsd >= capUsd) return { ratio, level: 'over', label: 'Cap reached: no scans or decodes until the 1st' };
  if (ratio >= 0.75) return { ratio, level: 'warn', label: "Most of this month's budget is used" };
  return { ratio, level: 'ok', label: 'Within budget' };
}
