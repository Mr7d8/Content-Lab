import type { ClassificationRecord, VisionFrame } from '@content-lab/core';
import { describe, expect, it } from 'vitest';
import { activeRow, clock, craftOf, frameRows, missingImages, secondFromPath } from '../lib/frame-view';

const frame = (second: number, extra: Partial<VisionFrame> = {}): VisionFrame => ({
  second,
  description: `At ${second}s`,
  on_screen_text: [],
  cta_text: null,
  elements: { app_ui: false, product: false, price: false, offer: false, logo: false, cta: false, subtitles: false, faces: 0, people: 0 },
  ...extra,
});

describe('frameRows', () => {
  const frames = [frame(3), frame(0, { on_screen_text: [' طلبو دابا ', ''], elements: { ...frame(0).elements, product: true, price: true, people: 1 } }), frame(1), frame(6, { cta_text: ' Commandez ' })];
  const segments = [
    { start: 0.2, end: 1.4, text: 'Salam' },
    { start: 1.5, end: 2.9, text: ' شوفو هاد الضو ' },
    { start: 4.0, end: 7.5, text: 'Livraison gratuite' },
  ];
  const beats = [
    { start: 0, end: 3, role: 'hook' as const, summary: 'Opens' },
    { start: 3, end: 6, role: 'demo' as const, summary: 'Shows' },
    { start: 6, end: 9, role: 'cta' as const, summary: 'Asks' },
  ];

  it('orders frames, gives each its span, speech, beat and image', () => {
    const rows = frameRows(frames, { segments, beats, durationS: 9.2, images: { '0': 'https://img/0.jpg', '6': 'https://img/6.jpg' } });
    expect(rows.map((r) => [r.second, r.end])).toEqual([[0, 1], [1, 3], [3, 6], [6, 9.2]]);
    expect(rows.map((r) => r.speech)).toEqual([['Salam'], ['شوفو هاد الضو'], ['Livraison gratuite'], []]);
    expect(rows.map((r) => r.role)).toEqual(['hook', 'hook', 'demo', 'cta']);
    expect(rows.map((r) => r.image)).toEqual(['https://img/0.jpg', null, null, 'https://img/6.jpg']);
    expect(rows[0]).toMatchObject({ onScreen: ['طلبو دابا'], elements: ['Product', 'Price', '1 person'] });
    expect(rows[3]?.cta).toBe('Commandez');
  });

  it('keeps speech that starts before the first frame and after the last one', () => {
    const rows = frameRows([frame(1), frame(4)], { segments: [{ start: 0, end: 1, text: 'early' }, { start: 9, end: 10, text: 'late' }] });
    expect(rows.map((r) => r.speech)).toEqual([['early'], ['late']]);
    expect(rows[1]?.end).toBe(10);
  });

  it('finds the frame on screen', () => {
    const rows = frameRows(frames);
    expect(activeRow(rows, 0)).toBe(0);
    expect(activeRow(rows, 2.4)).toBe(1);
    expect(activeRow(rows, 2.97)).toBe(2);
    expect(activeRow(rows, 30)).toBe(3);
    expect(activeRow(frameRows([frame(1)]), 0.2)).toBe(-1);
  });
});

describe('frame images', () => {
  it('reads the second from a stored keyframe path and lists the missing ones', () => {
    expect(secondFromPath('a1b2/12.webp')).toBe(12);
    expect(secondFromPath('a1b2/0.jpg')).toBe(0);
    expect(secondFromPath('a1b2/cover.jpg')).toBeNull();
    expect(missingImages([frame(6), frame(0), frame(3), frame(0)], { '3': 'x' })).toEqual([0, 6]);
  });

  it('formats seconds as a clock', () => {
    expect([clock(0), clock(7.9), clock(42), clock(72)]).toEqual(['0:00', '0:07', '0:42', '1:12']);
  });
});

describe('craftOf', () => {
  const record: ClassificationRecord = {
    objective: 'purchase', hook_type: 'price_shock', hook_channel: 'combined', format: 'product_demo', structure: 'offer_first',
    reveal: { app_ui_s: null, product_s: 0, price_s: 2, offer_s: 1, logo_s: null },
    levers: ['price_visible', 'free_delivery', 'cash_on_delivery'],
    social_proof: ['ratings'],
    execution: { duration_s: 20, cut_count: 12, cuts_per_10s: 6, subtitles: true, voiceover: false, music: null, trend_sound: null, aspect_ratio: '9:16' },
    language: 'darija',
    cta: { channel: 'both', wording: 'طلبو دابا', first_s: 14, repeated: true },
    talent: { gender: 'female', age_bracket: '25_34', people_count: 1, face_first_frame: null },
    script: [],
  };

  it('orders the first-shown moments and leaves unknowns out', () => {
    const craft = craftOf(record);
    expect(craft.timing).toEqual([
      { label: 'Product', second: 0 },
      { label: 'Offer', second: 1 },
      { label: 'Price', second: 2 },
      { label: 'Call to action', second: 14 },
    ]);
    expect(craft.cta).toEqual([
      { label: 'Channel', value: 'Both' },
      { label: 'Wording', value: 'طلبو دابا' },
      { label: 'Repeated', value: 'Yes' },
    ]);
    expect(craft.execution.map((f) => f.label)).toEqual(['Cuts', 'Subtitles', 'Voiceover', 'Aspect ratio']);
    expect(craft.execution[0]?.value).toBe('12 (6 per 10 s)');
    expect(craft.levers).toEqual(['Price visible', 'Free delivery', 'Cash on delivery']);
    expect(craft.proof).toEqual(['Ratings']);
    expect(craft.talent).toEqual([
      { label: 'On screen', value: 'Female' },
      { label: 'Age', value: '25 to 34' },
      { label: 'People', value: '1' },
    ]);
  });
});
