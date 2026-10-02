import 'server-only';
import type { AdminClient } from './admin';

const TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/png': 'png', 'image/avif': 'avif' };
const MAX_BYTES = 1024 * 1024;

// Copies an ad's cover into the public covers bucket and returns its URL.
// TikTok's cover links are signed and expire within hours.
export async function cacheCover(admin: AdminClient, itemId: string, coverUrl: string): Promise<string | null> {
  const res = await fetch(coverUrl, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) return null;
  const type = (res.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? '';
  const ext = TYPES[type];
  if (!ext) return null;
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_BYTES) return null;
  const path = `${itemId}.${ext}`;
  const { error } = await admin.storage.from('covers').upload(path, bytes, { contentType: type, upsert: true, cacheControl: '31536000' });
  if (error) return null;
  return admin.storage.from('covers').getPublicUrl(path).data.publicUrl;
}
