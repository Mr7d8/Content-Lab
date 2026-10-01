import {
  type ClassificationRecord,
  FILTER_DIMENSIONS,
  type FilterDimension,
  LIST_DIMENSIONS,
  type ListDimension,
} from '@content-lab/core';

export type LibraryFilters = Partial<Record<FilterDimension | ListDimension | 'source' | 'region' | 'q' | 'review', string>> & { page: number };

export type LibraryItem = {
  id: string;
  source: string;
  sourceUrl: string;
  advertiser: string | null;
  region: string | null;
  collectedAt: string;
  durationS: number | null;
  labels: ClassificationRecord;
  corrected: boolean;
  needsReview: boolean;
  confidence: number | null;
  thumb: string | null;
  metric: { name: string; value: string } | null;
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function parseFilters(params: Record<string, string | string[] | undefined>): LibraryFilters {
  const filters: LibraryFilters = { page: Math.max(1, Number(one(params.page)) || 1) };
  const keys = [...Object.keys(FILTER_DIMENSIONS), ...Object.keys(LIST_DIMENSIONS), 'source', 'region', 'q', 'review'] as (keyof Omit<LibraryFilters, 'page'>)[];
  for (const key of keys) {
    const value = one(params[key]);
    if (value) filters[key] = value;
  }
  return filters;
}

export function matches(item: Pick<LibraryItem, 'labels' | 'source' | 'region' | 'advertiser' | 'needsReview'>, f: LibraryFilters): boolean {
  if (f.source && item.source !== f.source) return false;
  if (f.region && item.region !== f.region) return false;
  if (f.review === '1' && !item.needsReview) return false;
  if (f.q && !(item.advertiser ?? '').toLowerCase().includes(f.q.toLowerCase())) return false;
  for (const dim of Object.keys(FILTER_DIMENSIONS) as FilterDimension[]) {
    const wanted = f[dim];
    if (wanted && (wanted === 'unknown' ? item.labels[dim] !== null : item.labels[dim] !== wanted)) return false;
  }
  for (const dim of Object.keys(LIST_DIMENSIONS) as ListDimension[]) {
    const wanted = f[dim];
    if (wanted && !(item.labels[dim] as string[]).includes(wanted)) return false;
  }
  return true;
}

