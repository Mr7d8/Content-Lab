import { alignToFrames, VISION_SYSTEM, visionJsonSchema, visionUserText } from '../prompts/vision';
import { VisionOutput } from '../vision';
import { request, type RequestOptions } from './http';
import type { Pacer } from './pacer';
import type { TextWriter, VisionProvider } from './types';

// Tracks Google's current Flash model; pin GEMINI_MODEL to a version for reproducible caching.
export const DEFAULT_GEMINI_MODEL = 'gemini-flash-latest';
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
};

type Options = { model?: string; pacer?: Pacer } & Partial<Omit<RequestOptions, 'service'>>;

const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

async function generate(apiKey: string, model: string, body: unknown, { pacer, ...options }: Options): Promise<{ text: string; inputTokens: number | null; outputTokens: number | null }> {
  const res = await request(`${BASE}/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, {
    ...options,
    service: 'Gemini',
    secrets: [apiKey],
    beforeAttempt: pacer ? () => pacer.wait() : undefined,
    onRateLimit: pacer ? (ms) => pacer.cooldown(ms) : undefined,
  });
  const json = (await res.json()) as GeminiResponse;
  if (json.promptFeedback?.blockReason) throw new Error(`Gemini blocked the request (${json.promptFeedback.blockReason})`);
  const candidate = json.candidates?.[0];
  const text = candidate?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  if (!text) throw new Error(`Gemini returned no content (${candidate?.finishReason ?? 'no candidate'})`);
  return { text, inputTokens: json.usageMetadata?.promptTokenCount ?? null, outputTokens: json.usageMetadata?.candidatesTokenCount ?? null };
}

export function geminiVision(apiKey: string, options: Options = {}): VisionProvider {
  const model = options.model || DEFAULT_GEMINI_MODEL;
  return {
    name: `gemini:${model}`,
    async describeFrames(frames, context) {
      const body = {
        systemInstruction: { parts: [{ text: VISION_SYSTEM }] },
        contents: [{
          role: 'user',
          parts: [
            ...frames.flatMap((f) => [{ text: `Keyframe at ${f.second}s:` }, { inlineData: { mimeType: f.mimeType, data: toBase64(f.data) } }]),
            { text: visionUserText(frames, context) },
          ],
        }],
        generationConfig: { responseMimeType: 'application/json', responseJsonSchema: visionJsonSchema(), temperature: 0 },
      };
      const result = await generate(apiKey, model, body, options);
      let parsed: unknown;
      try {
        parsed = JSON.parse(result.text);
      } catch {
        throw new Error('Gemini returned invalid JSON for the vision pass');
      }
      const output = alignToFrames(VisionOutput.parse(parsed), frames);
      return { output, inputTokens: result.inputTokens, outputTokens: result.outputTokens };
    },
  };
}

export function geminiWriter(apiKey: string, options: Options = {}): TextWriter {
  const model = options.model || DEFAULT_GEMINI_MODEL;
  return {
    name: `gemini:${model}`,
    async write({ system, user, maxTokens = 16000 }) {
      const result = await generate(apiKey, model, {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { maxOutputTokens: maxTokens },
      }, options);
      return result;
    },
  };
}
