import type { ChoiceAnswer } from '../src/ai/types';
import { buildQuestions } from '../src/classify';
import type { VisionFrame } from '../src/vision';

export const frame = (second: number, patch: Partial<VisionFrame['elements']> = {}, extra: Partial<VisionFrame> = {}): VisionFrame => ({
  second,
  description: 'A woman holds a pair of sneakers in a bright room',
  on_screen_text: [],
  cta_text: null,
  elements: { app_ui: false, product: false, price: false, offer: false, logo: false, cta: false, subtitles: false, faces: 0, people: 0, ...patch },
  ...extra,
});

// Jev answers for every question: "no" for yes/no questions unless overridden.
export function answersFor(overrides: Record<string, string>, confidence = 0.9): Record<string, ChoiceAnswer> {
  const out: Record<string, ChoiceAnswer> = {};
  for (const [key, q] of Object.entries(buildQuestions())) {
    const choice = overrides[key] ?? (Object.hasOwn(q.criteria, 'no') ? 'no' : 'unclear');
    out[key] = { choice, confidence, probabilities: { [choice]: confidence } };
  }
  return out;
}
