import 'server-only';
import {
  applyCorrections,
  ClassificationRecord,
  Evidence,
  PROMPT_VERSION,
  VISION_VERSION,
  VisionOutput,
  type VisionFrame,
} from '@content-lab/core';
import { type LibraryFilters, type LibraryItem, matches } from './filters';
import type { ServerClient } from './supabase/server';

export { parseFilters, type LibraryFilters, type LibraryItem } from './filters';

export const PAGE_SIZE = 48;
// Phase 1 volumes are small, so filtering happens in memory on the effective
// labels (model output plus human corrections). Move to SQL filters past this.
const MAX_ROWS = 2000;

function pickThumb(paths: string[]): string | null {
  return paths.find((p) => /\/1\.(webp|jpg)$/.test(p)) ?? paths[0] ?? null;
}

async function signed(supabase: ServerClient, paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!paths.length) return out;
  const { data } = await supabase.storage.from('frames').createSignedUrls(paths, 3600);
  for (const row of data ?? []) if (row.path && row.signedUrl) out.set(row.path, row.signedUrl);
  return out;
}

function formatMetric(name: string, value: number | null, text: string | null): string {
  if (text) return text;
  if (value === null) return '';
  if (name === 'ctr') return `${(value * 100).toFixed(1)}%`;
  return Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

// Classified items for the current taxonomy and vision versions, newest first.
export async function loadLibrary(supabase: ServerClient, filters: LibraryFilters) {
  const { data, error } = await supabase
    .from('classifications')
    .select('item_id, labels_json, corrections_json, confidence, needs_review, created_at, item:items!inner(id, source, source_url, advertiser, account_handle, region, collected_at, duration_s)')
    .eq('prompt_version', PROMPT_VERSION)
    .eq('vision_version', VISION_VERSION)
    .order('created_at', { ascending: false })
    .limit(MAX_ROWS);
  if (error) throw new Error(error.message);

  const seen = new Set<string>();
  const all: Omit<LibraryItem, 'thumb' | 'metric'>[] = [];
  for (const row of data ?? []) {
    if (seen.has(row.item_id)) continue;
    const parsed = ClassificationRecord.safeParse(row.labels_json);
    if (!parsed.success) continue;
    seen.add(row.item_id);
    const corrections = row.corrections_json as Record<string, unknown>;
    all.push({
      id: row.item.id,
      source: row.item.source,
      sourceUrl: row.item.source_url,
      advertiser: row.item.advertiser ?? row.item.account_handle,
      region: row.item.region,
      collectedAt: row.item.collected_at,
      durationS: row.item.duration_s,
      labels: applyCorrections(parsed.data, corrections),
      corrected: Object.keys(corrections ?? {}).length > 0,
      needsReview: row.needs_review,
      confidence: row.confidence,
    });
  }

  const filtered = all.filter((item) => matches(item, filters));
  const page = filtered.slice((filters.page - 1) * PAGE_SIZE, filters.page * PAGE_SIZE);
  const ids = page.map((i) => i.id);

  const [{ data: media }, { data: metrics }] = ids.length
    ? await Promise.all([
        supabase.from('media').select('item_id, keyframe_paths').in('item_id', ids),
        supabase.from('metrics').select('item_id, metric_name, value, value_text, captured_at').in('item_id', ids).in('metric_name', ['views', 'ctr', 'likes']).order('captured_at', { ascending: false }),
      ])
    : [{ data: [] }, { data: [] }];

  const thumbPath = new Map((media ?? []).map((m) => [m.item_id, pickThumb(m.keyframe_paths)]));
  const urls = await signed(supabase, [...thumbPath.values()].filter((p): p is string => Boolean(p)));
  const metricFor = new Map<string, { name: string; value: string }>();
  for (const name of ['views', 'ctr', 'likes']) {
    for (const m of metrics ?? []) {
      if (m.metric_name === name && !metricFor.has(m.item_id)) metricFor.set(m.item_id, { name, value: formatMetric(name, m.value, m.value_text) });
    }
  }

  const items: LibraryItem[] = page.map((i) => {
    const path = thumbPath.get(i.id);
    return { ...i, thumb: path ? (urls.get(path) ?? null) : null, metric: metricFor.get(i.id) ?? null };
  });
  const regions = [...new Set(all.map((i) => i.region).filter((r): r is string => Boolean(r)))].sort();
  return { items, total: filtered.length, totalAll: all.length, regions };
}

export type ItemDetail = Awaited<ReturnType<typeof loadItem>>;

export async function loadItem(supabase: ServerClient, id: string) {
  const [{ data: item }, { data: media }, { data: classifications }, { data: metrics }] = await Promise.all([
    supabase.from('items').select('*').eq('id', id).maybeSingle(),
    supabase.from('media').select('*').eq('item_id', id).maybeSingle(),
    supabase.from('classifications').select('*').eq('item_id', id).order('created_at', { ascending: false }),
    supabase.from('metrics').select('*').eq('item_id', id).order('captured_at', { ascending: false }),
  ]);
  if (!item) return null;

  const current = (classifications ?? []).find((c) => c.prompt_version === PROMPT_VERSION && c.vision_version === VISION_VERSION) ?? null;
  const parsed = current ? ClassificationRecord.safeParse(current.labels_json) : null;
  const evidence = current ? Evidence.safeParse(current.evidence_json) : null;
  const frames: VisionFrame[] = media?.frames_json ? (VisionOutput.shape.frames.safeParse(media.frames_json).data ?? []) : [];
  const paths = media?.keyframe_paths ?? [];
  const urls = await signed(supabase, paths);
  const keyframes = paths.map((path) => {
    const second = Number(path.split('/').at(-1)?.split('.')[0]);
    return { second, url: urls.get(path) ?? null, vision: frames.find((f) => f.second === second) ?? null };
  });
  const latestMetrics = new Map<string, (typeof metrics extends (infer T)[] | null ? T : never)>();
  for (const m of metrics ?? []) if (!latestMetrics.has(m.metric_name)) latestMetrics.set(m.metric_name, m);

  return {
    item,
    media,
    classification: current,
    labels: parsed?.success ? applyCorrections(parsed.data, current?.corrections_json) : null,
    modelLabels: parsed?.success ? parsed.data : null,
    evidence: evidence?.success ? evidence.data : {},
    keyframes,
    metrics: [...latestMetrics.values()],
    olderVersions: (classifications ?? []).filter((c) => c !== current).length,
  };
}
