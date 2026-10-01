import { type ClassificationRecord, FILTER_DIMENSIONS, labelText } from '@content-lab/core';

// What the live wall, the performance map and Replay need for one item.
export type RunViewItem = {
  id: string;
  position: number;
  source: string;
  advertiser: string | null;
  status: string;
  stage: string;
  thumb: string | null;
  labels: ClassificationRecord | null;
  metric: { name: string; value: number } | null;
  // 0 to 100 inside the item's own source; null when it cannot be ranked.
  percentile: number | null;
  times: { collected: number; framed: number | null; classified: number | null };
};

export type RunView = {
  run: { id: string; status: string; itemsRequested: number; itemsDone: number; itemsFailed: number; costActual: number; spendCap: number; createdAt: string };
  items: RunViewItem[];
};

// Primary performance signal per source. Sources are never blended.
const PRIMARY_METRIC: Record<string, string[]> = {
  tiktok_organic: ['views', 'likes'],
  tiktok_creative_center: ['ctr', 'likes'],
};

export function primaryMetric(source: string, metrics: { name: string; value: number | null }[]): { name: string; value: number } | null {
  for (const name of PRIMARY_METRIC[source] ?? ['views', 'likes']) {
    const m = metrics.find((x) => x.name === name && x.value !== null);
    if (m && m.value !== null) return { name, value: m.value };
  }
  return null;
}

// Percentile of each item's primary metric within its source (average rank for
// ties). Needs at least 3 ranked items per source; scores from the scoring
// step take precedence when they exist.
export function withPercentiles<T extends Pick<RunViewItem, 'id' | 'source' | 'metric' | 'percentile'>>(items: T[], minimum = 3): T[] {
  const bySource = new Map<string, T[]>();
  for (const item of items) {
    if (!item.metric || item.percentile !== null) continue;
    const key = `${item.source}:${item.metric.name}`;
    bySource.set(key, [...(bySource.get(key) ?? []), item]);
  }
  const result = new Map<string, number>();
  for (const group of bySource.values()) {
    if (group.length < minimum) continue;
    const sorted = [...group].sort((a, b) => (a.metric as { value: number }).value - (b.metric as { value: number }).value);
    let i = 0;
    while (i < sorted.length) {
      let j = i;
      while (j + 1 < sorted.length && sorted[j + 1]!.metric!.value === sorted[i]!.metric!.value) j++;
      const rank = (i + j) / 2;
      for (let k = i; k <= j; k++) result.set(sorted[k]!.id, Math.round((rank / (sorted.length - 1)) * 1000) / 10);
      i = j + 1;
    }
  }
  return items.map((item) => (result.has(item.id) ? { ...item, percentile: result.get(item.id) as number } : item));
}

// Replay: saved timestamps scaled onto a fixed-length timeline, so playback
// speed is about watching, not the pipeline's real speed.
export type ReplayEvent = { at: number; itemId: string; kind: 'thumb' | 'labels' };

export function buildTimeline(items: RunViewItem[], lengthMs = 30000): ReplayEvent[] {
  const raw: { t: number; itemId: string; kind: 'thumb' | 'labels'; order: number }[] = [];
  for (const item of items) {
    if (item.thumb || item.times.framed !== null) raw.push({ t: item.times.framed ?? item.times.collected, itemId: item.id, kind: 'thumb', order: item.position * 2 });
    if (item.labels) raw.push({ t: item.times.classified ?? item.times.framed ?? item.times.collected, itemId: item.id, kind: 'labels', order: item.position * 2 + 1 });
  }
  if (!raw.length) return [];
  const min = Math.min(...raw.map((r) => r.t));
  const max = Math.max(...raw.map((r) => r.t));
  const ordered = raw.sort((a, b) => a.t - b.t || a.order - b.order);
  // Identical timestamps (or a single instant): spread events evenly instead.
  if (max - min < 1000) return ordered.map((r, i) => ({ at: Math.round(((i + 1) / ordered.length) * lengthMs), itemId: r.itemId, kind: r.kind }));
  const lead = lengthMs * 0.04;
  return ordered.map((r) => ({ at: Math.round(lead + ((r.t - min) / (max - min)) * (lengthMs - lead)), itemId: r.itemId, kind: r.kind }));
}

export function replayState(events: ReplayEvent[], clockMs: number): { thumbs: Set<string>; labels: Set<string> } {
  const thumbs = new Set<string>();
  const labels = new Set<string>();
  for (const e of events) {
    if (e.at > clockMs) break;
    (e.kind === 'thumb' ? thumbs : labels).add(e.itemId);
  }
  return { thumbs, labels };
}

// Performance map x axis: a label (band) or a reveal timing (seconds).
export const MAP_X = {
  hook_type: { title: 'Hook type', kind: 'band' },
  format: { title: 'Format', kind: 'band' },
  objective: { title: 'Objective', kind: 'band' },
  hook_channel: { title: 'Hook channel', kind: 'band' },
  structure: { title: 'Structure', kind: 'band' },
  'reveal.price_s': { title: 'Seconds to price', kind: 'linear' },
  'reveal.product_s': { title: 'Seconds to product', kind: 'linear' },
  'reveal.app_ui_s': { title: 'Seconds to app UI', kind: 'linear' },
  'reveal.offer_s': { title: 'Seconds to offer', kind: 'linear' },
  'cta.first_s': { title: 'Seconds to CTA', kind: 'linear' },
} as const;
export type MapX = keyof typeof MAP_X;

export function xValue(labels: ClassificationRecord, x: MapX): string | number | null {
  switch (x) {
    case 'reveal.price_s':
      return labels.reveal.price_s;
    case 'reveal.product_s':
      return labels.reveal.product_s;
    case 'reveal.app_ui_s':
      return labels.reveal.app_ui_s;
    case 'reveal.offer_s':
      return labels.reveal.offer_s;
    case 'cta.first_s':
      return labels.cta.first_s;
    default:
      return labels[x];
  }
}

// Band domain in taxonomy order, only for values present, with Unknown last.
export function bandDomain(values: (string | null)[], x: MapX): string[] {
  const present = new Set(values.map((v) => v ?? 'unknown'));
  const options = x in FILTER_DIMENSIONS ? Object.keys(FILTER_DIMENSIONS[x as keyof typeof FILTER_DIMENSIONS].options) : [];
  const ordered = options.filter((o) => present.has(o));
  return present.has('unknown') ? [...ordered, 'unknown'] : ordered;
}

// Three colour slots at most on a scatter (reference palette, validated all-pairs):
// app install, purchase, and every other objective (slot 3).
export const OBJECTIVE_COLORS = { app_install: '#2a78d6', purchase: '#eb6834', other: '#1baf7a' } as const;
export function objectiveColor(objective: string | null | undefined): string {
  return objective === 'app_install' || objective === 'purchase' ? OBJECTIVE_COLORS[objective] : OBJECTIVE_COLORS.other;
}

// Stable 0..1 jitter per item so dots in a band do not stack.
export function jitter(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

export const STAGE_TEXT: Record<string, string> = {
  fetch: 'Fetching',
  extract: 'Extracting frames',
  transcribe: 'Transcribing',
  vision: 'Reading frames',
  classify: 'Classifying',
  done: 'Done',
};

export const tickText = (v: string) => (v === 'unknown' ? 'Unknown' : labelText(v));
