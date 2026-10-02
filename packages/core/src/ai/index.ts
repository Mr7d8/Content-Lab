import { claudeVision, claudeWriter } from './claude';
import { geminiDecoder, geminiVision, geminiWriter } from './gemini';
import { groqTranscriber } from './groq';
import { jevClassifier } from './jev';
import { createPacer } from './pacer';
import type { Classifier, TextWriter, Transcriber, VideoDecoder, VisionProvider } from './types';

export * from './types';
export { ProviderError, request, delay } from './http';
export { createPacer, type Pacer } from './pacer';
export { groqTranscriber, isSpeech, parseGroqTranscript, GROQ_MODEL } from './groq';
export { geminiDecoder, geminiVision, geminiWriter, DEFAULT_GEMINI_MODEL, MAX_INLINE_VIDEO_BYTES } from './gemini';
export { claudeVision, claudeWriter, DEFAULT_CLAUDE_MODEL } from './claude';
export { jevClassifier, parseJevAnswers, DEFAULT_JEV_MODEL } from './jev';

// One interface for every AI call: transcription, the vision pass, Jev
// classification and brief writing. Each capability is an adapter picked by
// environment variables, so moving from Gemini to Claude is a config change.
export interface AIProviders {
  transcriber: Transcriber;
  vision: VisionProvider;
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

export function providerChoice(env: AIEnv, name: 'VISION_PROVIDER' | 'BRIEF_PROVIDER'): 'gemini' | 'claude' {
  const value = (env[name] ?? 'gemini').toLowerCase();
  if (value !== 'gemini' && value !== 'claude') throw new Error(`${name} must be gemini or claude`);
  return value;
}

// Builds only the capabilities asked for, so a missing key fails early and
// clearly, and nothing else needs keys it never uses.
export function createAIProviders<K extends Capability>(env: AIEnv, capabilities: readonly K[]): Pick<AIProviders, K> {
  const out: Partial<AIProviders> = {};
  // One pacer per free-tier provider, shared by vision and brief writing.
  const geminiPacer = createPacer(rpm(env, 'GEMINI_REQUESTS_PER_MINUTE', 10));
  for (const capability of capabilities) {
    switch (capability) {
      case 'transcriber':
        out.transcriber = groqTranscriber(required(env, 'GROQ_API_KEY', 'transcription'), {
          pacer: createPacer(rpm(env, 'GROQ_REQUESTS_PER_MINUTE', 20)),
        });
        break;
      case 'vision':
        out.vision = providerChoice(env, 'VISION_PROVIDER') === 'claude'
          ? claudeVision(required(env, 'ANTHROPIC_API_KEY', 'the vision pass on Claude'), { model: env.CLAUDE_MODEL || undefined })
          : geminiVision(required(env, 'GEMINI_API_KEY', 'the vision pass'), { model: env.GEMINI_MODEL || undefined, pacer: geminiPacer });
        break;
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
