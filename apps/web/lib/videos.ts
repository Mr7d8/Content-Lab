import 'server-only';
import type { AdminClient } from './admin';

export type Video = { data: Uint8Array; mimeType: string };

const EXT: Record<string, string> = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };
const NEEDS_MIGRATION = 'Saving videos needs the latest database migration (saved_videos)';

// Saves an ad's video in the public videos bucket and records its address on
// the ad, so it keeps playing after the scan's links expire or a rescan
// replaces them.
export async function saveVideo(admin: AdminClient, itemId: string, video: Video): Promise<{ ok: true; url: string } | { ok: false; message: string }> {
  const type = EXT[video.mimeType] ? video.mimeType : 'video/mp4';
  const path = `${itemId}.${EXT[type]}`;
  const { error } = await admin.storage.from('videos').upload(path, video.data, { contentType: type, upsert: true, cacheControl: '31536000' });
  if (error) return { ok: false, message: /bucket not found/i.test(error.message) ? NEEDS_MIGRATION : `Could not save the video: ${error.message}` };
  const url = admin.storage.from('videos').getPublicUrl(path).data.publicUrl;
  const { error: rowError } = await admin.from('items').update({ video_url: url }).eq('id', itemId);
  if (rowError) return { ok: false, message: /video_url/.test(rowError.message) ? NEEDS_MIGRATION : `Could not save the video: ${rowError.message}` };
  return { ok: true, url };
}
