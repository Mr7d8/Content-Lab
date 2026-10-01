import { describe, expect, it } from 'vitest';
import { assembleRecord, buildQuestions, buildState, passageQuestions, scriptPassages } from '../src/classify';
import { COMMERCIAL_LEVER, SOCIAL_PROOF } from '../src/taxonomy';
import { answersFor, frame } from './fixtures';

const frames = [
  frame(0, { product: true, faces: 1, people: 1 }, { on_screen_text: ['-50% aujourd\'hui'] }),
  frame(1, { product: true, price: true, offer: true, faces: 1, people: 1, subtitles: true }, { on_screen_text: ['99 DH'] }),
  frame(2, { product: true, price: true, people: 2, faces: 2 }),
  frame(3, { logo: true }),
  frame(6, { cta: true, logo: true }, { cta_text: 'Commandez maintenant', on_screen_text: ['Commandez maintenant'] }),
];

describe('buildQuestions', () => {
  it('asks one choice question per Jev field, each with an unclear option', () => {
    const q = buildQuestions();
    expect(Object.keys(q)).toHaveLength(11 + (Object.keys(COMMERCIAL_LEVER).length - 1) + Object.keys(SOCIAL_PROOF).length);
    expect(q.lever_price_visible).toBeUndefined();
    for (const question of Object.values(q)) {
      expect(question.criteria.unclear).toBeDefined();
      expect(question.instructions).toContain('untrusted');
    }
  });
});

describe('buildState', () => {
  it('works with an empty transcript (music-only ads)', () => {
    const state = buildState({
      source: 'tiktok_creative_center', advertiser: 'Shein', region: 'MA', caption: null, durationS: 15,
      audioType: 'music_only', transcript: '', transcriptLang: null, segments: [], frames,
    });
    expect(state.transcript).toBe('[No speech: music only]');
    expect(state.opening).toContain('[0s]');
    expect(state.opening).not.toContain('[6s]');
    expect(state.opening).toContain('Speech before 3s: [none]');
    expect(state.frames).toHaveLength(5);
    expect(state.context).toContain('Audio: music_only');
    expect(JSON.stringify(state)).not.toMatch(/views|likes|ctr/i);
  });

  it('includes opening speech by timestamp', () => {
    const state = buildState({
      source: 'tiktok_organic', advertiser: null, region: null, caption: 'Huge sale', durationS: 9, audioType: 'speech',
      transcript: 'Salam! Had l3rd ghir lyoum. Commandez daba.', transcriptLang: 'arabic',
      segments: [{ start: 0, end: 1.5, text: 'Salam!' }, { start: 4, end: 6, text: 'Commandez daba.' }], frames,
    });
    expect(state.opening).toContain('Speech before 3s: Salam!');
    expect(state.opening).not.toContain('Commandez daba');
  });
});

describe('assembleRecord', () => {
  const base = {
    frames, durationS: 15, sceneCuts: [1.2, 2.4, 5.1, 9.9], width: 1080, height: 1920,
    audioType: 'speech', segments: [{ start: 0, end: 1.5, text: 'Salam!' }], music: { original: false },
  };

  it('merges Jev answers, vision elements, FFmpeg measurements and metadata', () => {
    const { record, evidence, needsReview, confidence } = assembleRecord({
      ...base,
      answers: answersFor({
        objective: 'purchase', hook_type: 'price_shock', hook_channel: 'text_overlay', format: 'creator_ugc',
        structure: 'offer_first', language: 'darija', cta_channel: 'both', cta_repeated: 'yes', voiceover: 'no',
        talent_gender: 'female', talent_age: '25_34', lever_discount: 'yes', lever_cash_on_delivery: 'yes', proof_ratings: 'yes',
      }),
    });
    expect(record).toMatchObject({
      objective: 'purchase', hook_type: 'price_shock', format: 'creator_ugc', language: 'darija',
      reveal: { app_ui_s: null, product_s: 0, price_s: 1, offer_s: 1, logo_s: 3 },
      levers: ['price_visible', 'discount', 'cash_on_delivery'],
      social_proof: ['ratings'],
      execution: { duration_s: 15, cut_count: 4, cuts_per_10s: 2.7, subtitles: true, voiceover: false, music: null, trend_sound: true, aspect_ratio: '9:16' },
      cta: { channel: 'both', wording: 'Commandez maintenant', first_s: 6, repeated: true },
      talent: { gender: 'female', age_bracket: '25_34', people_count: 2, face_first_frame: true },
    });
    expect(evidence.hook_type).toMatchObject({ origin: 'jev', confidence: 0.9, frames: [0, 1, 2, 3] });
    expect(evidence['reveal.price_s']).toEqual({ origin: 'vision', confidence: null, frames: [1] });
    expect(evidence['execution.trend_sound']?.origin).toBe('metadata');
    expect(confidence).toBe(0.9);
    expect(needsReview).toBe(false);
  });

  it('keeps unknown as null and flags weak or unclear core labels for review', () => {
    const { record, needsReview } = assembleRecord({
      ...base, music: null, width: null, height: null, sceneCuts: null,
      answers: answersFor({ objective: 'app_install', hook_type: 'unclear', format: 'app_walkthrough' }),
    });
    expect(record.hook_type).toBeNull();
    expect(record.execution).toMatchObject({ trend_sound: null, aspect_ratio: null, cut_count: null, cuts_per_10s: null });
    expect(needsReview).toBe(true);

    const weak = assembleRecord({ ...base, answers: answersFor({ objective: 'purchase', hook_type: 'question', format: 'haul' }, 0.5) });
    expect(weak.needsReview).toBe(true);
    expect(weak.confidence).toBe(0.5);
  });

  it('marks music-only ads: music on, no voiceover', () => {
    const { record, evidence } = assembleRecord({
      ...base, audioType: 'music_only', segments: [],
      answers: answersFor({ objective: 'purchase', hook_type: 'price_shock', format: 'catalogue_carousel', voiceover: 'yes' }),
    });
    expect(record.execution.music).toBe(true);
    expect(record.execution.voiceover).toBe(false);
    expect(evidence['execution.voiceover']?.origin).toBe('audio');
  });
});

describe('script passages', () => {
  const segments = Array.from({ length: 45 }, (_, i) => ({ start: i, end: i + 1, text: `part ${i}` }));

  it('merges segments into at most 20 passages without dropping speech', () => {
    const passages = scriptPassages(segments);
    expect(passages.length).toBeLessThanOrEqual(20);
    expect(passages.map((p) => p.text).join(' ')).toBe(segments.map((s) => s.text).join(' '));
    expect(passages[0]).toMatchObject({ start: 0 });
  });

  it('asks one role question per passage and maps answers back', () => {
    const short = [{ start: 0, end: 2, text: 'Wach baghi tchri?' }, { start: 2, end: 5, text: '-50% ghir lyoum' }, { start: 5, end: 7, text: 'Commandez daba' }];
    const questions = passageQuestions(short);
    expect(Object.keys(questions)).toEqual(['role_p0', 'role_p1', 'role_p2']);
    const answers = { ...answersFor({ objective: 'purchase', hook_type: 'question', format: 'talking_head' }), role_p0: { choice: 'hook', confidence: 0.9, probabilities: {} }, role_p1: { choice: 'offer', confidence: 0.9, probabilities: {} }, role_p2: { choice: 'unclear', confidence: 0.4, probabilities: {} } };
    const { record } = assembleRecord({ frames, durationS: 7, sceneCuts: [], width: 720, height: 1280, audioType: 'speech', segments: short, music: null, answers });
    expect(record.script.map((p) => p.role)).toEqual(['hook', 'offer', null]);
    expect(passageQuestions([])).toEqual({});
  });
});
