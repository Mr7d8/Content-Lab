import { describe, expect, it } from 'vitest';
import {
  ClassificationRecord,
  Evidence,
  FILTER_DIMENSIONS,
  HOOK_TYPE,
  labelText,
  lowestConfidence,
  PROMPT_VERSION,
} from '../src/taxonomy';

export const emptyRecord = (): ClassificationRecord => ({
  objective: null,
  hook_type: null,
  hook_channel: null,
  format: null,
  structure: null,
  reveal: { app_ui_s: null, product_s: null, price_s: null, offer_s: null, logo_s: null },
  levers: [],
  social_proof: [],
  execution: {
    duration_s: null, cut_count: null, cuts_per_10s: null, subtitles: null,
    voiceover: null, music: null, trend_sound: null, aspect_ratio: null,
  },
  language: null,
  cta: { channel: null, wording: null, first_s: null, repeated: null },
  talent: { gender: null, age_bracket: null, people_count: null, face_first_frame: null },
});

describe('taxonomy', () => {
  it('has a prompt version', () => {
    expect(PROMPT_VERSION).toMatch(/^taxonomy-v\d+$/);
  });

  it('keeps the twelve plan hook types', () => {
    expect(Object.keys(HOOK_TYPE)).toHaveLength(12);
  });

  it('accepts an all-unknown record, so unknown stays null', () => {
    expect(ClassificationRecord.parse(emptyRecord())).toEqual(emptyRecord());
  });

  it('accepts a full record', () => {
    const record: ClassificationRecord = {
      ...emptyRecord(),
      objective: 'purchase',
      hook_type: 'price_shock',
      hook_channel: 'text_overlay',
      format: 'product_demo',
      structure: 'offer_first',
      reveal: { app_ui_s: null, product_s: 0, price_s: 1, offer_s: 1, logo_s: 9 },
      levers: ['price_visible', 'discount', 'cash_on_delivery'],
      social_proof: ['ratings'],
      execution: {
        duration_s: 21.5, cut_count: 9, cuts_per_10s: 4.2, subtitles: true,
        voiceover: false, music: true, trend_sound: null, aspect_ratio: '9:16',
      },
      language: 'darija',
      cta: { channel: 'text', wording: 'Commandez maintenant', first_s: 15, repeated: false },
      talent: { gender: 'female', age_bracket: '25_34', people_count: 1, face_first_frame: true },
    };
    expect(ClassificationRecord.parse(record)).toEqual(record);
  });

  it('rejects labels outside the taxonomy', () => {
    const bad = { ...emptyRecord(), hook_type: 'jump_scare' };
    expect(ClassificationRecord.safeParse(bad).success).toBe(false);
    const badLever = { ...emptyRecord(), levers: ['free_gift'] };
    expect(ClassificationRecord.safeParse(badLever).success).toBe(false);
  });

  it('rejects negative timings', () => {
    const bad = { ...emptyRecord(), reveal: { ...emptyRecord().reveal, price_s: -1 } };
    expect(ClassificationRecord.safeParse(bad).success).toBe(false);
  });

  it('takes the lowest confidence across fields', () => {
    const evidence = Evidence.parse({
      hook_type: { origin: 'jev', confidence: 0.91 },
      format: { origin: 'jev', confidence: 0.58 },
      'reveal.price_s': { origin: 'vision', confidence: null, frames: [1] },
    });
    expect(lowestConfidence(evidence)).toBe(0.58);
    expect(lowestConfidence({})).toBeNull();
  });

  it('allows an optional written note per field', () => {
    expect(Evidence.safeParse({ hook_type: { origin: 'jev', confidence: 0.8, note: 'Price in first frame' } }).success).toBe(true);
  });

  it('formats labels for display', () => {
    expect(labelText('price_shock')).toBe('Price shock');
    expect(labelText(null)).toBe('Unknown');
    expect(Object.keys(FILTER_DIMENSIONS)).toContain('format');
  });
});
