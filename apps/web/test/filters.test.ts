import { describe, expect, it } from 'vitest';
import type { ClassificationRecord } from '@content-lab/core';
import { matches, parseFilters } from '../lib/filters';

const labels = {
  objective: 'purchase', hook_type: 'price_shock', hook_channel: 'text_overlay', format: 'haul', structure: 'offer_first',
  reveal: { app_ui_s: null, product_s: 0, price_s: 1, offer_s: 1, logo_s: null },
  levers: ['discount', 'cash_on_delivery'], social_proof: [],
  execution: { duration_s: 12, cut_count: 5, cuts_per_10s: 4.2, subtitles: true, voiceover: false, music: true, trend_sound: null, aspect_ratio: '9:16' },
  language: null, cta: { channel: 'text', wording: 'Shop now', first_s: 9, repeated: false },
  talent: { gender: 'female', age_bracket: '25_34', people_count: 1, face_first_frame: true }, script: [],
} as ClassificationRecord;
const item = { labels, source: 'tiktok_organic', region: 'MA', advertiser: 'Shein', needsReview: true };

describe('library filters', () => {
  it('parses known keys only and defaults the page', () => {
    expect(parseFilters({ hook_type: 'price_shock', page: '2', evil: 'x', levers: ['discount', 'bundle'] })).toEqual({ page: 2, hook_type: 'price_shock', levers: 'discount' });
    expect(parseFilters({ page: '-3' }).page).toBe(1);
  });

  it('matches on labels, list labels, unknown, item fields and search', () => {
    expect(matches(item, { page: 1, hook_type: 'price_shock', levers: 'discount', source: 'tiktok_organic', region: 'MA' })).toBe(true);
    expect(matches(item, { page: 1, format: 'skit' })).toBe(false);
    expect(matches(item, { page: 1, levers: 'bundle' })).toBe(false);
    expect(matches(item, { page: 1, language: 'unknown' })).toBe(true);
    expect(matches(item, { page: 1, objective: 'unknown' })).toBe(false);
    expect(matches(item, { page: 1, q: 'she', review: '1' })).toBe(true);
    expect(matches({ ...item, needsReview: false }, { page: 1, review: '1' })).toBe(false);
  });
});
