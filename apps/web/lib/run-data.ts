import 'server-only';
import { ClassificationRecord, PROMPT_VERSION, VISION_VERSION } from '@content-lab/core';
import { primaryMetric, type RunView, type RunViewItem, withPercentiles } from './run-view';
import type { ServerClient } from './supabase/server';

type LogEntry = { stage?: string; status?: string; at?: string };

const stageTime = (log: unknown, stage: string): number | null => {
  if (!Array.isArray(log)) return null;
  const hit = (log as LogEntry[]).find((e) => e.stage === stage && e.status === 'done' && e.at);
  return hit?.at ? Date.parse(hit.at) : null;
};

// Everything one run's wall, map and replay need, with signed keyframe URLs.
export async function loadRunView(supabase: ServerClient, runId: string, signedSeconds = 3600): Promise<RunView | null> {
  const { data: run } = await supabase.from('runs').select('*').eq('id', runId).maybeSingle();
  if (!run) return null;
  const { data: runItems } = await supabase
    .from('run_items')
    .select('item_id, position, status, stage, stage_log, created_at, item:items!inner(id, source, advertiser, account_handle)')
    .eq('run_id', runId)
    .order('position');
  const ids = (runItems ?? []).map((r) => r.item_id);

  const [{ data: media }, { data: classifications }, { data: metrics }, { data: scores }] = ids.length
    ? await Promise.all([
        supabase.from('media').select('item_id, keyframe_paths').in('item_id', ids),
        supabase.from('classifications').select('item_id, labels_json, created_at').in('item_id', ids)
          .eq('prompt_version', PROMPT_VERSION).eq('vision_version', VISION_VERSION).order('created_at', { ascending: false }),
        supabase.from('metrics').select('item_id, metric_name, value, captured_at').in('item_id', ids).order('captured_at', { ascending: false }),
        supabase.from('scores').select('item_id, percentile').in('item_id', ids),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }];

  const thumbPath = new Map<string, string>();
  for (const m of media ?? []) {
    const path = m.keyframe_paths.find((p) => /\/1\.(webp|jpg)$/.test(p)) ?? m.keyframe_paths[0];
    if (path) thumbPath.set(m.item_id, path);
  }
  const urls = new Map<string, string>();
  if (thumbPath.size) {
    const { data } = await supabase.storage.from('frames').createSignedUrls([...thumbPath.values()], signedSeconds);
    for (const row of data ?? []) if (row.path && row.signedUrl) urls.set(row.path, row.signedUrl);
  }
  const labels = new Map<string, { record: ClassificationRecord; at: number }>();
  for (const c of classifications ?? []) {
    if (labels.has(c.item_id)) continue;
    const parsed = ClassificationRecord.safeParse(c.labels_json);
    if (parsed.success) labels.set(c.item_id, { record: parsed.data, at: Date.parse(c.created_at) });
  }
  const metricRows = new Map<string, { name: string; value: number | null }[]>();
  for (const m of metrics ?? []) metricRows.set(m.item_id, [...(metricRows.get(m.item_id) ?? []), { name: m.metric_name, value: m.value }]);
  const scoreFor = new Map((scores ?? []).map((s) => [s.item_id, Number(s.percentile)]));

  const items: RunViewItem[] = (runItems ?? []).map((r) => {
    const path = thumbPath.get(r.item_id);
    const label = labels.get(r.item_id);
    return {
      id: r.item_id,
      position: r.position,
      source: r.item.source,
      advertiser: r.item.advertiser ?? r.item.account_handle,
      status: r.status,
      stage: r.stage,
      thumb: path ? (urls.get(path) ?? null) : null,
      labels: label?.record ?? null,
      metric: primaryMetric(r.item.source, metricRows.get(r.item_id) ?? []),
      percentile: scoreFor.get(r.item_id) ?? null,
      times: {
        collected: Date.parse(r.created_at),
        framed: stageTime(r.stage_log, 'extract'),
        classified: stageTime(r.stage_log, 'classify') ?? label?.at ?? null,
      },
    };
  });

  return {
    run: {
      id: run.id,
      status: run.status,
      itemsRequested: run.items_requested,
      itemsDone: run.items_done,
      itemsFailed: run.items_failed,
      costActual: Number(run.cost_actual_usd),
      spendCap: Number(run.spend_cap_usd),
      createdAt: run.created_at,
    },
    items: withPercentiles(items),
  };
}
