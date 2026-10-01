import { request, type RequestOptions } from './http';
import type { ChoiceAnswer, ChoiceQuestion, Classifier } from './types';

// TypeSafe Jev: typed choices with calibrated confidence. Text only, no free text out.
// Request shape follows Creator Lab's working client (lib/schema.mjs, lib/providers.mjs).
export const DEFAULT_JEV_MODEL = 'jev-1.13.0';
const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';

type JevResponse = {
  model?: string;
  answers?: Record<string, { type?: string; choice?: string; confidence?: number; probabilities?: Record<string, number> }>;
  usage?: { input_tokens?: number };
};

export function parseJevAnswers(raw: JevResponse, questions: Record<string, ChoiceQuestion>) {
  if (!raw.answers || !raw.model) throw new Error('Jev returned an invalid response');
  const answers: Record<string, ChoiceAnswer> = {};
  for (const [key, question] of Object.entries(questions)) {
    const a = raw.answers[key];
    if (
      a?.type !== 'choice' || typeof a.choice !== 'string' || !Object.hasOwn(question.criteria, a.choice)
      || typeof a.confidence !== 'number' || a.confidence < 0 || a.confidence > 1
    ) {
      throw new Error(`Invalid or missing Jev answer: ${key}`);
    }
    answers[key] = { choice: a.choice, confidence: a.confidence, probabilities: a.probabilities ?? {} };
  }
  const tokens = raw.usage?.input_tokens;
  return { model: raw.model, answers, inputTokens: Number.isInteger(tokens) ? (tokens as number) : null };
}

export function jevClassifier(apiKey: string, { model = DEFAULT_JEV_MODEL, ...options }: { model?: string } & Partial<Omit<RequestOptions, 'service'>> = {}): Classifier {
  return {
    model,
    async answer(state, questions) {
      const body = {
        model,
        state,
        questions: Object.fromEntries(Object.entries(questions).map(([k, q]) => [k, { type: 'choice', ...q }])),
      };
      const res = await request(ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }, { ...options, service: 'Jev', secrets: [apiKey] });
      return parseJevAnswers((await res.json()) as JevResponse, questions);
    },
  };
}
