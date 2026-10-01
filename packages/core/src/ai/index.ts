import { groqTranscriber } from './groq';
import { createPacer } from './pacer';
import type { Transcriber } from './types';

export * from './types';
export { ProviderError, request, delay } from './http';
export { createPacer, type Pacer } from './pacer';
export { groqTranscriber, isSpeech, parseGroqTranscript, GROQ_MODEL } from './groq';

// One interface for every AI call the pipeline makes. Each capability is an
// adapter picked by environment variables, so swapping a provider is config.
export interface AIProviders {
  transcriber: Transcriber;
}

export type AIEnv = Record<string, string | undefined>;

function required(env: AIEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

const rpm = (env: AIEnv, name: string, fallback: number) => {
  const n = Number(env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export function createAIProviders(env: AIEnv): AIProviders {
  const transcriber = groqTranscriber(required(env, 'GROQ_API_KEY'), {
    pacer: createPacer(rpm(env, 'GROQ_REQUESTS_PER_MINUTE', 20)),
  });
  return { transcriber };
}
