import type { Database, Json, Tables, TablesInsert, TablesUpdate } from '@content-lab/core';
import { createClient } from '@supabase/supabase-js';

export type RunRow = Tables<'runs'>;
export type RunItemRow = Tables<'run_items'>;
export type ItemRow = Tables<'items'>;
export type MediaRow = Tables<'media'>;
export type RunItemWithItem = RunItemRow & { item: ItemRow };

export const CLAIMABLE = ['queued', 'paused', 'partial', 'failed'] as const;
export const FRAMES_BUCKET = 'frames';

// Everything the pipeline reads or writes. Supabase in production, in memory in tests.
export interface Store {
  claimRun(runId: string, now: string): Promise<RunRow | null>;
  getRun(runId: string): Promise<RunRow>;
  updateRun(runId: string, patch: TablesUpdate<'runs'>): Promise<void>;
  listRunItems(runId: string): Promise<RunItemWithItem[]>;
  updateRunItem(runId: string, itemId: string, patch: TablesUpdate<'run_items'>): Promise<void>;
  updateItem(itemId: string, patch: TablesUpdate<'items'>): Promise<void>;
  getMedia(itemId: string): Promise<MediaRow | null>;
  upsertMedia(itemId: string, patch: Omit<TablesInsert<'media'>, 'item_id'>): Promise<void>;
  addMetrics(rows: TablesInsert<'metrics'>[]): Promise<void>;
  uploadFrame(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  downloadFrame(path: string): Promise<Uint8Array>;
  // Vision and classification caches across items that share a video.
  findMediaWithVision(videoHash: string, visionVersion: string, visionModel: string): Promise<MediaRow | null>;
  findClassification(videoHash: string, promptVersion: string, visionVersion: string, model: string): Promise<Tables<'classifications'> | null>;
  saveClassification(row: TablesInsert<'classifications'>): Promise<void>;
}

function check<T>(result: { data: T; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data;
}

function checkRow<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  const row = check(result, what);
  if (row === null) throw new Error(`${what}: not found`);
  return row;
}

export function supabaseStore(url: string, serviceRoleKey: string): Store {
  const db = createClient<Database>(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return {
    async claimRun(runId, now) {
      const current = check(await db.from('runs').select('*').eq('id', runId).maybeSingle(), 'Read run');
      if (!current || !(CLAIMABLE as readonly string[]).includes(current.status)) return null;
      const claimed = check(
        await db.from('runs')
          .update({ status: 'running', started_at: current.started_at ?? now, finished_at: null, error: null })
          .eq('id', runId).in('status', [...CLAIMABLE]).select('*').maybeSingle(),
        'Claim run',
      );
      return claimed;
    },
    async getRun(runId) {
      return checkRow(await db.from('runs').select('*').eq('id', runId).single(), 'Read run');
    },
    async updateRun(runId, patch) {
      check(await db.from('runs').update(patch).eq('id', runId), 'Update run');
    },
    async listRunItems(runId) {
      const rows = check(await db.from('run_items').select('*, item:items(*)').eq('run_id', runId).order('position'), 'Read run items');
      return (rows ?? []) as RunItemWithItem[];
    },
    async updateRunItem(runId, itemId, patch) {
      check(await db.from('run_items').update(patch).eq('run_id', runId).eq('item_id', itemId), 'Update run item');
    },
    async updateItem(itemId, patch) {
      check(await db.from('items').update(patch).eq('id', itemId), 'Update item');
    },
    async getMedia(itemId) {
      return check(await db.from('media').select('*').eq('item_id', itemId).maybeSingle(), 'Read media');
    },
    async upsertMedia(itemId, patch) {
      check(await db.from('media').upsert({ item_id: itemId, ...patch }, { onConflict: 'item_id' }), 'Save media');
    },
    async addMetrics(rows) {
      if (rows.length) check(await db.from('metrics').insert(rows), 'Save metrics');
    },
    async uploadFrame(path, bytes, contentType) {
      const { error } = await db.storage.from(FRAMES_BUCKET).upload(path, bytes, { contentType, upsert: true });
      if (error) throw new Error(`Upload frame ${path}: ${error.message}`);
    },
    async downloadFrame(path) {
      const { data, error } = await db.storage.from(FRAMES_BUCKET).download(path);
      if (error || !data) throw new Error(`Download frame ${path}: ${error?.message ?? 'empty'}`);
      return new Uint8Array(await data.arrayBuffer());
    },
    async findMediaWithVision(videoHash, visionVersion, visionModel) {
      const rows = check(
        await db.from('media').select('*').eq('video_hash', videoHash).eq('vision_version', visionVersion)
          .eq('vision_model', visionModel).not('frames_json', 'is', null).limit(1),
        'Read vision cache',
      );
      return rows?.[0] ?? null;
    },
    async findClassification(videoHash, promptVersion, visionVersion, model) {
      const rows = check(
        await db.from('classifications').select('*').eq('video_hash', videoHash).eq('prompt_version', promptVersion)
          .eq('vision_version', visionVersion).eq('model', model).order('created_at', { ascending: false }).limit(1),
        'Read classification cache',
      );
      return rows?.[0] ?? null;
    },
    async saveClassification(row) {
      check(
        await db.from('classifications').upsert(row, { onConflict: 'item_id,prompt_version,vision_version,model' }),
        'Save classification',
      );
    },
  };
}

export type { Json };
