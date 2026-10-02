import { claudeWriter } from './claude';
import { geminiDecoder, geminiWriter } from './gemini';
import { jevClassifier } from './jev';
import { createPacer } from './pacer';
import type { Classifier, TextWriter, VideoDecoder } from './types';

export * from './types';
export { ProviderError, request, delay } from './http';
export { createPacer, type Pacer } from './pacer';
export { geminiDecoder, geminiWriter, DEFAULT_GEMINI_MODEL, MAX_INLINE_VIDEO_BYTES } from './gemini';
export { claudeWriter, DEFAULT_CLAUDE_MODEL } from './claude';
export { jevClassifier, parseJevAnswers, DEFAULT_JEV_MODEL } from './jev';

// One interface for every AI call: the video decode, Jev classification and
// brief writing. Each capability is an adapter picked by environment
// variables, so moving brief writing from Gemini to Claude is a config change.
export interface AIProviders {
  decoder: VideoDecoder;
  classifier: Classifier;
  briefWriter: TextWriter;
}

export type AIEnv = Record<string, string | undefined>;
type Capability = keyof AIProviders;

function required(env: AIEnv, name: string, purpose: string): string {
  const value = env[name];
  if (!value) throw new Error(`Missing ${name} (needed for ${purpose}). Run pnpm run doctor to check every key.`);
  return value;
}

const rpm = (env: AIEnv, name: string, fallback: number) => {
  const n = Number(env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export function providerChoice(env: AIEnv, name: 'BRIEF_PROVIDER'): 'gemini' | 'claude' {
  const value = (env[name] ?? 'gemini').toLowerCase();
  if (value !== 'gemini' && value !== 'claude') throw new Error(`${name} must be gemini or claude`);
  return value;
}

// Builds only the capabilities asked for, so a missing key fails early and
// clearly, and nothing else needs keys it never uses.
export function createAIProviders<K extends Capability>(env: AIEnv, capabilities: readonly K[]): Pick<AIProviders, K> {
  const out: Partial<AIProviders> = {};
  // Brief writing may run on Gemini's free tier, so it is paced.
  const geminiPacer = createPacer(rpm(env, 'GEMINI_REQUESTS_PER_MINUTE', 10));
  for (const capability of capabilities) {
    switch (capability) {
      case 'decoder':
        // Paid tier expected (billing on), so no free-tier pacer.
        out.decoder = geminiDecoder(required(env, 'GEMINI_API_KEY', 'decoding videos'), { model: env.GEMINI_MODEL || undefined });
        break;
      case 'classifier':
        out.classifier = jevClassifier(required(env, 'TYPESAFE_API_KEY', 'Jev classification'), { model: env.JEV_MODEL || undefined });
        break;
      case 'briefWriter':
        out.briefWriter = providerChoice(env, 'BRIEF_PROVIDER') === 'claude'
          ? claudeWriter(required(env, 'ANTHROPIC_API_KEY', 'brief writing on Claude'), { model: env.CLAUDE_MODEL || undefined })
          : geminiWriter(required(env, 'GEMINI_API_KEY', 'brief writing'), { model: env.GEMINI_MODEL || undefined, pacer: geminiPacer });
        break;
    }
  }
  return out as Pick<AIProviders, K>;
}
