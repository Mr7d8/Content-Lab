import type { Tables, TablesInsert } from '@content-lab/core';
import { CLAIMABLE, type ItemRow, type MediaRow, type RunItemRow, type RunRow, type Store } from '../src/store';

// In-memory Store for tests: same contract as the Supabase store.
export class MemoryStore implements Store {
  runs = new Map<string, RunRow>();
  items = new Map<string, ItemRow>();
  runItems: RunItemRow[] = [];
  media = new Map<string, MediaRow>();
  metrics: TablesInsert<'metrics'>[] = [];
  frames = new Map<string, { bytes: Uint8Array; contentType: string }>();
  classifications: Tables<'classifications'>[] = [];
  runUpdates: Partial<RunRow>[] = [];

  addRun(patch: Partial<RunRow> = {}): RunRow {
    const run: RunRow = {
      id: `run-${this.runs.size + 1}`, source: 'manual_import', watchlist_id: null, status: 'queued',
      items_requested: 0, items_done: 0, items_failed: 0, cost_estimate_usd: null, spend_cap_usd: 1,
      cost_actual_usd: 0, pause_requested: false, worker_run_id: null, error: null, created_by: null, trigger: 'manual',
      created_at: '2026-10-01T00:00:00Z', started_at: null, finished_at: null, updated_at: '2026-10-01T00:00:00Z',
      ...patch,
    };
    this.runs.set(run.id, run);
    return run;
  }

  addItem(runId: string, patch: Partial<ItemRow> = {}, runItem: Partial<RunItemRow> = {}): ItemRow {
    const n = this.items.size + 1;
    const item: ItemRow = {
      id: `item-${n}`, source: 'tiktok_organic', source_url: `https://www.tiktok.com/@brand/video/73000000000000000${n}`,
      external_id: `73000000000000000${n}`, advertiser: null, account_handle: 'brand', region: null, industry: null,
      objective_source: null, posted_at: null, collected_at: '2026-10-01T00:00:00Z', duration_s: null,
      thumbnail_url: null, raw_json: {}, ...patch,
    };
    this.items.set(item.id, item);
    this.runItems.push({
      run_id: runId, item_id: item.id, position: this.runItems.filter((r) => r.run_id === runId).length,
      stage: 'fetch', status: 'pending', attempts: 0, error: null, stage_log: [], cost_usd: 0,
      created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', ...runItem,
    });
    return item;
  }

  runItem(itemId: string) {
    return this.runItems.find((r) => r.item_id === itemId)!;
  }

  async claimRun(runId: string, now: string) {
    const run = this.runs.get(runId);
    if (!run || !(CLAIMABLE as readonly string[]).includes(run.status)) return null;
    Object.assign(run, { status: 'running', started_at: run.started_at ?? now, finished_at: null, error: null });
    return { ...run };
  }
  async getRun(runId: string) {
    return { ...this.runs.get(runId)! };
  }
  async updateRun(runId: string, patch: Partial<RunRow>) {
    this.runUpdates.push(patch);
    Object.assign(this.runs.get(runId)!, patch);
  }
  async listRunItems(runId: string) {
    return this.runItems
      .filter((r) => r.run_id === runId)
      .sort((a, b) => a.position - b.position)
      .map((r) => ({ ...r, item: { ...this.items.get(r.item_id)! } }));
  }
  async updateRunItem(runId: string, itemId: string, patch: Partial<RunItemRow>) {
    Object.assign(this.runItems.find((r) => r.run_id === runId && r.item_id === itemId)!, patch);
  }
  async updateItem(itemId: string, patch: Partial<ItemRow>) {
    Object.assign(this.items.get(itemId)!, patch);
  }
  async getMedia(itemId: string) {
    return this.media.get(itemId) ?? null;
  }
  async upsertMedia(itemId: string, patch: Partial<MediaRow>) {
    const current: MediaRow = this.media.get(itemId) ?? {
      item_id: itemId, video_hash: null, width: null, height: null, scene_cuts: null, audio_type: null,
      transcript: null, transcript_lang: null, transcript_segments: null, frames_json: null, ocr_text: null,
      vision_model: null, vision_version: null, keyframe_paths: [], created_at: '', updated_at: '',
    };
    this.media.set(itemId, { ...current, ...patch } as MediaRow);
  }
  async addMetrics(rows: TablesInsert<'metrics'>[]) {
    this.metrics.push(...rows);
  }
  async uploadFrame(path: string, bytes: Uint8Array, contentType: string) {
    this.frames.set(path, { bytes, contentType });
  }
  async downloadFrame(path: string) {
    const f = this.frames.get(path);
    if (!f) throw new Error(`missing frame ${path}`);
    return f.bytes;
  }
  async findMediaWithVision(videoHash: string, visionVersion: string, visionModel: string) {
    return [...this.media.values()].find((m) => m.video_hash === videoHash && m.vision_version === visionVersion && m.vision_model === visionModel && m.frames_json !== null) ?? null;
  }
  async findClassification(videoHash: string, promptVersion: string, visionVersion: string, model: string) {
    return this.classifications.find((c) => c.video_hash === videoHash && c.prompt_version === promptVersion && c.vision_version === visionVersion && c.model === model) ?? null;
  }
  async saveClassification(row: TablesInsert<'classifications'>) {
    this.classifications = this.classifications.filter((c) => !(c.item_id === row.item_id && c.prompt_version === row.prompt_version && c.vision_version === row.vision_version && c.model === row.model));
    this.classifications.push({
      id: `cls-${this.classifications.length + 1}`, video_hash: null, evidence_json: {}, confidence: null, needs_review: false,
      corrections_json: {}, reviewed_by: null, reviewed_at: null, input_tokens: null, output_tokens: null, cost_usd: null,
      created_at: '', updated_at: '', ...row,
    } as Tables<'classifications'>);
  }
}
