import { buildQuestions, DECODE_VERSION, PROMPT_VERSION, type DecodeOutput } from '@content-lab/core';
import { describe, expect, it } from 'vitest';
import { adDuration, classifyInput, decodeRows } from '../lib/decode-records';

const frame = (second: number, price = false) => ({
  second, description: 'A hand holds sneakers', on_screen_text: price ? ['199 DH'] : [], cta_text: price ? 'Commandez' : null,
  elements: { app_ui: false, product: true, price, offer: false, logo: false, cta: price, subtitles: false, faces: 0, people: 1 },
});
const output: DecodeOutput = {
  audio_type: 'speech',
  language: 'Darija (Moroccan Arabic)',
  segments: [{ start: 0, end: 2, text: 'شوفو هاد الصباط' }, { start: 2, end: 7, text: 'غير ب 199 درهم' }],
  frames: [frame(0), frame(1), frame(2), frame(3, true)],
  breakdown: {
    summary: 'Sneakers with the price on screen.', product: 'Sneakers',
    hook: { text: 'Look at these shoes', visual: 'Close-up of sneakers' },
    beats: [{ start: 0, end: 2, role: 'hook', summary: 'Reveal' }, { start: 2, end: 7, role: 'offer', summary: 'Price' }],
    cta: 'Commandez', offer: '199 DH', why_it_works: 'Product and price in the first seconds.',
  },
};
const item = {
  id: 'i1', source: 'tiktok_creative_center', advertiser: 'Shoe MA', region: 'MA', duration_s: null,
  scan_json: { adText: 'Promo sneakers', durationSeconds: 7.2, width: 720, height: 1280 },
};
const answers = Object.fromEntries(Object.entries(buildQuestions()).map(([k, q]) => {
  const choice = k === 'format' ? 'creator_ugc' in q.criteria ? 'creator_ugc' : Object.keys(q.criteria)[0] as string : 'unclear';
  return [k, { choice, confidence: 0.9, probabilities: {} }];
}));

describe('decode records', () => {
  it('reads the duration and ad text from the scan row', () => {
    expect(adDuration(item)).toBe(7.2);
    expect(classifyInput(item, output)).toMatchObject({ caption: 'Promo sneakers', durationS: 7.2, transcriptLang: 'Darija (Moroccan Arabic)', audioType: 'speech' });
  });

  it('writes media with the breakdown and a versioned classification', () => {
    const rows = decodeRows(item, output, 'gemini:gemini-test', { model: 'jev-1.13.0', answers, inputTokens: 8000 }, 0.0123);
    expect(rows.media).toMatchObject({
      item_id: 'i1', width: 720, height: 1280, audio_type: 'speech', transcript: 'شوفو هاد الصباط غير ب 199 درهم',
      ocr_text: '199 DH', vision_model: 'gemini:gemini-test', vision_version: DECODE_VERSION,
    });
    expect(rows.media.breakdown_json).toMatchObject({ offer: '199 DH' });
    expect(rows.classification).toMatchObject({ item_id: 'i1', model: 'jev-1.13.0', prompt_version: PROMPT_VERSION, vision_version: DECODE_VERSION, cost_usd: 0.0123, input_tokens: 8000 });
    const labels = rows.classification.labels_json as Record<string, unknown>;
    expect(labels.execution).toMatchObject({ duration_s: 7.2, aspect_ratio: '9:16' });
    expect(labels.cta).toMatchObject({ wording: 'Commandez', first_s: 3 });
    expect(labels.levers).toContain('price_visible');
  });
});
