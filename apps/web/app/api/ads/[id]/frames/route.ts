import { VisionFrame } from '@content-lab/core';
import { signFrames } from '@/lib/ad-detail';
import { adminClient } from '@/lib/admin';
import { secondFromPath } from '@/lib/frame-view';
import { createClient } from '@/lib/supabase/server';
import { requireTeam } from '@/lib/team';

const MAX_FILES = 24;
// The frames bucket takes files up to 512 KB.
const MAX_BYTES = 500 * 1024;
const TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/webp': 'webp' };

// Saves frame images the inspector captured from the ad's video, one file per
// described second (form field name = the second). Replaces older images of
// the same seconds.
export async function POST(request: Request, ctx: RouteContext<'/api/ads/[id]/frames'>) {
  const denied = await requireTeam();
  if (denied) return denied;
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: media } = await supabase.from('media').select('frames_json, keyframe_paths').eq('item_id', id).maybeSingle();
  if (!media) return Response.json({ ok: false, message: 'Decode the ad first.' }, { status: 404 });
  const described = new Set((VisionFrame.array().safeParse(media.frames_json ?? []).data ?? []).map((f) => f.second));

  const form = await request.formData().catch(() => null);
  if (!form) return Response.json({ ok: false, message: 'Send the frames as form data.' }, { status: 400 });
  const files = [...form.entries()].flatMap(([key, value]) => {
    const second = Number(key);
    return value instanceof File && described.has(second) && TYPES[value.type] && value.size > 0 && value.size <= MAX_BYTES ? [{ second, file: value }] : [];
  });
  if (!files.length || files.length > MAX_FILES) return Response.json({ ok: false, message: 'No usable frames in the request.' }, { status: 400 });

  const admin = adminClient();
  const saved: string[] = [];
  await Promise.all(files.map(async ({ second, file }) => {
    const path = `${id}/${second}.${TYPES[file.type]}`;
    const { error } = await admin.storage.from('frames').upload(path, new Uint8Array(await file.arrayBuffer()), {
      contentType: file.type,
      upsert: true,
      cacheControl: '31536000',
    });
    if (!error) saved.push(path);
  }));
  if (!saved.length) return Response.json({ ok: false, message: 'Could not save the frames.' }, { status: 502 });

  // One image per second: the new one replaces an older file of another type.
  const bySecond = new Map<number, string>();
  for (const p of media.keyframe_paths) {
    const s = secondFromPath(p);
    if (s !== null) bySecond.set(s, p);
  }
  const replaced: string[] = [];
  for (const p of saved) {
    const s = secondFromPath(p) as number;
    const old = bySecond.get(s);
    if (old && old !== p) replaced.push(old);
    bySecond.set(s, p);
  }
  const paths = [...bySecond.entries()].sort((a, b) => a[0] - b[0]).map(([, p]) => p);
  const { error } = await admin.from('media').update({ keyframe_paths: paths }).eq('item_id', id);
  if (error) return Response.json({ ok: false, message: `Save frames: ${error.message}` }, { status: 502 });
  if (replaced.length) await admin.storage.from('frames').remove(replaced);
  return Response.json({ ok: true, images: await signFrames(admin, saved) });
}
