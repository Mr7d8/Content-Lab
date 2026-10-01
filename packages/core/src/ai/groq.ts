import { request, type RequestOptions } from './http';
import type { Pacer } from './pacer';
import type { Transcript, Transcriber } from './types';

const ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';
export const GROQ_MODEL = 'whisper-large-v3-turbo';

type VerboseJson = {
  text?: string;
  language?: string;
  duration?: number;
  segments?: { start?: number; end?: number; text?: string; no_speech_prob?: number }[];
};

// Whisper output on music or silence is often one of these, not speech.
const NON_SPEECH = /^\s*[[(]?(music|musique|applause|silence|thank you|thanks for watching|merci|شكرا)[\])]?[.!]*\s*$/i;

export function parseGroqTranscript(raw: VerboseJson): Transcript {
  const segments = (raw.segments ?? [])
    .filter((s) => typeof s.text === 'string' && s.text.trim())
    .map((s) => ({
      start: Number.isFinite(s.start) ? (s.start as number) : null,
      end: Number.isFinite(s.end) ? (s.end as number) : null,
      text: (s.text as string).trim(),
      noSpeechProb: Number.isFinite(s.no_speech_prob) ? (s.no_speech_prob as number) : null,
    }));
  const text = (raw.text ?? '').trim();
  return { text, language: raw.language ?? null, segments };
}

// Speech or music only: few words, a non-speech phrase, or segments Whisper
// itself marks as probably not speech.
export function isSpeech(t: Transcript): boolean {
  const words = t.text.split(/\s+/).filter(Boolean).length;
  if (words < 4 || NON_SPEECH.test(t.text)) return false;
  const probs = t.segments.map((s) => s.noSpeechProb).filter((p): p is number => p !== null);
  if (probs.length && probs.reduce((a, b) => a + b, 0) / probs.length > 0.6) return false;
  return true;
}

export function groqTranscriber(
  apiKey: string,
  { pacer, ...options }: { pacer?: Pacer } & Partial<Omit<RequestOptions, 'service'>> = {},
): Transcriber {
  return {
    name: `groq:${GROQ_MODEL}`,
    async transcribe(audio, { mimeType = 'audio/flac', filename = 'audio.flac' } = {}) {
      const send = async () => {
        const form = new FormData();
        form.append('model', GROQ_MODEL);
        form.append('response_format', 'verbose_json');
        form.append('timestamp_granularities[]', 'segment');
        form.append('temperature', '0');
        form.append('file', new Blob([audio as Uint8Array<ArrayBuffer>], { type: mimeType }), filename);
        return request(ENDPOINT, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form }, {
          ...options,
          service: 'Groq',
          secrets: [apiKey],
          beforeAttempt: pacer ? () => pacer.wait() : undefined,
          onRateLimit: pacer ? (ms) => pacer.cooldown(ms) : undefined,
        });
      };
      const res = await send();
      return parseGroqTranscript((await res.json()) as VerboseJson);
    },
  };
}
