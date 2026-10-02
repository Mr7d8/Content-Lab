import type { Database, Json, Tables, TablesInsert, TablesUpdate } from '@content-lab/core';
import { createClient } from '@supabase/supabase-js';

export type RunRow = Tables<'runs'>;
export type RunItemRow = Tables<'run_items'>;
export type ItemRow = Tables<'items'>;
export type MediaRow = Tables<'media'>;
export type WatchlistRow = Tables<'watchlists'>;
export type RunItemWithItem = RunItemRow & { item: ItemRow };

export const CLAIMABLE = ['queued', 'paused', 'partial', 'failed'] as const;
// A run still marked running with no update for this long was left behind by
// an actor that timed out or crashed, and may be picked up again.
export const STALE_RUN_MS = 75 * 60_000;

export function isStaleRun(run: Pick<RunRow, 'status' | 'updated_at'>, now: string): boolean {
  return run.status === 'running' && Date.parse(run.updated_at) < Date.parse(now) - STALE_RUN_MS;
}
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
  // Research mode.
  getWatchlist(id: string): Promise<WatchlistRow>;
  updateWatchlist(id: string, patch: TablesUpdate<'watchlists'>): Promise<void>;
  // "source:external_id" keys of these ads that are already collected.
  existingItemKeys(source: string, externalIds: string[]): Promise<Set<string>>;
  // Saves new items (keeping any collected meanwhile) and appends them to the run in order.
  addRunItems(runId: string, items: TablesInsert<'items'>[]): Promise<number>;
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
      if (!current) return null;
      const stale = isStaleRun(current, now);
      if (!stale && !(CLAIMABLE as readonly string[]).includes(current.status)) return null;
      const update = db.from('runs')
        .update({ status: 'running', started_at: current.started_at ?? now, finished_at: null, error: null })
        .eq('id', runId);
      // Only one worker wins: the row must still be in the state we read.
      const guarded = stale ? update.eq('status', 'running').eq('updated_at', current.updated_at) : update.in('status', [...CLAIMABLE]);
      return check(await guarded.select('*').maybeSingle(), 'Claim run');
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
    async getWatchlist(id) {
      return checkRow(await db.from('watchlists').select('*').eq('id', id).single(), 'Read watchlist');
    },
    async updateWatchlist(id, patch) {
      check(await db.from('watchlists').update(patch).eq('id', id), 'Update watchlist');
    },
    async existingItemKeys(source, externalIds) {
      if (!externalIds.length) return new Set();
      const rows = check(
        await db.from('items').select('external_id').eq('source', source).in('external_id', externalIds),
        'Read existing items',
      );
      return new Set((rows ?? []).map((r) => `${source}:${r.external_id}`));
    },
    async addRunItems(runId, items) {
      if (!items.length) return 0;
      check(await db.from('items').upsert(items, { onConflict: 'source,external_id', ignoreDuplicates: true }), 'Save items');
      const ids = new Map<string, string>();
      for (const source of new Set(items.map((i) => i.source))) {
        const rows = check(
          await db.from('items').select('id, external_id').eq('source', source)
            .in('external_id', items.filter((i) => i.source === source).map((i) => i.external_id)),
          'Read saved items',
        );
        for (const r of rows ?? []) ids.set(`${source}:${r.external_id}`, r.id);
      }
      const attached = check(await db.from('run_items').select('item_id, position').eq('run_id', runId), 'Read run items');
      const inRun = new Set((attached ?? []).map((r) => r.item_id));
      let position = Math.max(-1, ...(attached ?? []).map((r) => r.position)) + 1;
      const rows = items
        .map((i) => ids.get(`${i.source}:${i.external_id}`))
        .filter((id): id is string => !!id && !inRun.has(id))
        .map((itemId) => ({ run_id: runId, item_id: itemId, position: position++ }));
      if (rows.length) check(await db.from('run_items').insert(rows), 'Attach items to run');
      return rows.length;
    },
  };
}

export type { Json };
