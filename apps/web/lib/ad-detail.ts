import 'server-only';
import { applyCorrections, ClassificationRecord, scanVideoUrl, VisionFrame } from '@content-lab/core';
import { secondFromPath, type AdDetail, type Segment } from './frame-view';
import type { ServerClient } from './supabase/server';

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

function segmentsOf(value: unknown): Segment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((s) => {
    const o = obj(s);
    return o && typeof o.start === 'number' && typeof o.end === 'number' && typeof o.text === 'string' ? [{ start: o.start, end: o.end, text: o.text }] : [];
  });
}

// Signed URLs for keyframe paths, keyed by second. The frames bucket is
// private; team members may read it.
export async function signFrames(supabase: Pick<ServerClient, 'storage'>, paths: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!paths.length) return out;
  const { data } = await supabase.storage.from('frames').createSignedUrls(paths, 3600);
  for (const row of data ?? []) {
    const second = row.path ? secondFromPath(row.path) : null;
    if (second !== null && row.signedUrl) out[String(second)] = row.signedUrl;
  }
  return out;
}

// What the inspector loads when an ad is opened.
export async function loadAdDetail(supabase: ServerClient, id: string): Promise<AdDetail | null> {
  const [{ data: item }, { data: media }, { data: classes }] = await Promise.all([
    supabase.from('items').select('id, scan_json').eq('id', id).maybeSingle(),
    supabase.from('media').select('frames_json, transcript_segments, keyframe_paths').eq('item_id', id).maybeSingle(),
    supabase.from('classifications').select('labels_json, corrections_json').eq('item_id', id).order('created_at', { ascending: false }).limit(1),
  ]);
  if (!item) return null;
  const frames = VisionFrame.array().safeParse(media?.frames_json ?? []).data ?? [];
  const latest = classes?.[0];
  const parsed = latest ? ClassificationRecord.safeParse(latest.labels_json) : null;
  return {
    frames,
    segments: segmentsOf(media?.transcript_segments),
    images: await signFrames(supabase, media?.keyframe_paths ?? []),
    record: parsed?.success ? applyCorrections(parsed.data, latest?.corrections_json) : null,
    capturable: frames.length > 0 && scanVideoUrl(obj(item.scan_json)) !== null,
  };
}
