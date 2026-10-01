import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildQuestions, ClassificationRecord, PROMPT_VERSION, VISION_VERSION, type VisionFrame } from '@content-lab/core';
import type { ChoiceAnswer, Classifier, ClassifierState, VisionProvider } from '@content-lab/core/ai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaResolver } from '../src/resolve';
import { runPipeline } from '../src/runner';
import { classifyStage, visionStage } from '../src/stages';
import { MemoryStore } from './memory-store';

const resolver: MediaResolver = { costPerItemUsd: 0.005, prefetch: async () => undefined, resolve: async () => { throw new Error('not used'); } };

const visionFrame = (second: number, el: Partial<VisionFrame['elements']> = {}): VisionFrame => ({
  second, description: 'Products shown one after another on a pink background', on_screen_text: second === 0 ? ['-70%'] : ['Livraison gratuite'],
  cta_text: second === 6 ? 'Shop now' : null,
  elements: { app_ui: false, product: true, price: second >= 1, offer: true, logo: false, cta: second === 6, subtitles: false, faces: 0, people: 0, ...el },
});

function fakeVision(): VisionProvider & { calls: number } {
  const v = {
    name: 'gemini:test', calls: 0,
    async describeFrames(frames: { second: number }[]) {
      v.calls++;
      return { output: { frames: frames.map((f) => visionFrame(f.second)) }, inputTokens: 1000, outputTokens: 300 };
    },
  };
  return v;
}

function fakeJev(): Classifier & { states: ClassifierState[] } {
  const states: ClassifierState[] = [];
  return {
    model: 'jev-test', states,
    async answer(state, questions) {
      states.push(state);
      const answers: Record<string, ChoiceAnswer> = {};
      for (const [k, q] of Object.entries(questions)) {
        const pick = { objective: 'purchase', hook_type: 'price_shock', hook_channel: 'text_overlay', format: 'catalogue_carousel', structure: 'offer_first', language: 'french', cta_channel: 'text', lever_free_delivery: 'yes', lever_discount: 'yes' }[k];
        const choice = pick ?? (Object.hasOwn(q.criteria, 'no') ? 'no' : 'none' in q.criteria ? 'none' : 'unclear');
        answers[k] = { choice, confidence: 0.86, probabilities: { [choice]: 0.86 } };
      }
      return { model: 'jev-1.13.0', answers, inputTokens: 9000 };
    },
  };
}

let tmpRoot: string;
beforeEach(async () => { tmpRoot = await mkdtemp(join(tmpdir(), 'cl-classify-')); });
afterEach(async () => { await rm(tmpRoot, { recursive: true, force: true }); });

// An item whose media stages already ran: a music-only ad with keyframes in storage.
function seedMusicOnlyItem(store: MemoryStore, runId: string, hash: string) {
  const item = store.addItem(runId, { duration_s: 9, source: 'tiktok_creative_center', advertiser: 'Shein', raw_json: { music: { original: false } } }, { stage: 'vision' });
  const paths = [0, 1, 2, 3, 6].map((s) => `${item.id}/${s}.webp`);
  for (const p of paths) store.frames.set(p, { bytes: new Uint8Array([1]), contentType: 'image/webp' });
  void store.upsertMedia(item.id, {
    video_hash: hash, keyframe_paths: paths, width: 1080, height: 1920, scene_cuts: [1, 2, 3, 4, 5, 6],
    audio_type: 'music_only', transcript: '', transcript_segments: [],
  });
  return item;
}

describe('vision and classify stages', () => {
  it('classifies a music-only ad from vision text alone and stores a valid record', async () => {
    const store = new MemoryStore();
    const run = store.addRun();
    const item = seedMusicOnlyItem(store, run.id, 'a'.repeat(64));
    const vision = fakeVision();
    const jev = fakeJev();
    const outcome = await runPipeline(run.id, {
      store, resolver, ai: { vision, classifier: jev }, handlers: { vision: visionStage, classify: classifyStage }, tmpRoot, log: () => undefined,
    });
    expect(outcome).toBe('completed');

    const media = store.media.get(item.id)!;
    expect(media).toMatchObject({ vision_model: 'gemini:test', vision_version: VISION_VERSION, ocr_text: '-70%\nLivraison gratuite' });

    expect(jev.states[0]?.transcript).toBe('[No speech: music only]');
    expect(Object.keys(buildQuestions()).length).toBeGreaterThan(20);

    const cls = store.classifications[0]!;
    expect(cls).toMatchObject({ item_id: item.id, model: 'jev-test', prompt_version: PROMPT_VERSION, vision_version: VISION_VERSION, input_tokens: 9000, needs_review: false });
    const record = ClassificationRecord.parse(cls.labels_json);
    expect(record).toMatchObject({
      objective: 'purchase', hook_type: 'price_shock', format: 'catalogue_carousel',
      levers: ['price_visible', 'discount', 'free_delivery'],
      reveal: { product_s: 0, price_s: 1, offer_s: 0 },
      execution: { music: true, voiceover: false, trend_sound: true, aspect_ratio: '9:16', cut_count: 6 },
      cta: { wording: 'Shop now', first_s: 6 },
    });
    expect(cls.cost_usd).toBeCloseTo(9000 / 1e6 * 0.042, 6);
  });

  it('reuses vision and classification for the same video hash, paying once', async () => {
    const store = new MemoryStore();
    const run = store.addRun();
    const first = seedMusicOnlyItem(store, run.id, 'b'.repeat(64));
    const second = seedMusicOnlyItem(store, run.id, 'b'.repeat(64));
    const vision = fakeVision();
    const jev = fakeJev();
    const answer = vi.spyOn(jev, 'answer');
    await runPipeline(run.id, { store, resolver, ai: { vision, classifier: jev }, handlers: { vision: visionStage, classify: classifyStage }, tmpRoot, log: () => undefined });
    expect(vision.calls).toBe(1);
    expect(answer).toHaveBeenCalledOnce();
    expect(store.classifications.map((c) => c.item_id).sort()).toEqual([first.id, second.id].sort());
    expect(store.classifications.find((c) => c.item_id === second.id)?.cost_usd).toBe(0);
  });

  it('refuses to classify before the vision pass', async () => {
    const store = new MemoryStore();
    const run = store.addRun();
    const item = store.addItem(run.id, {}, { stage: 'classify' });
    await store.upsertMedia(item.id, { video_hash: 'c'.repeat(64) });
    await runPipeline(run.id, { store, resolver, ai: { classifier: fakeJev() }, handlers: { classify: classifyStage }, tmpRoot, log: () => undefined });
    expect(store.runItem(item.id)).toMatchObject({ status: 'needs_review', error: 'Run the vision pass before classifying' });
  });
});
