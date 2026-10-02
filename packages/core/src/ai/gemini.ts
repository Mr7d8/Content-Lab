import { COVER_SYSTEM, coverJsonSchema, CoverOutput, coverUserText } from '../cover';
import { alignDecodedFrames, DecodeOutput } from '../decode';
import { DECODE_SYSTEM, decodeJsonSchema, decodeUserText } from '../prompts/decode';
import { request, type RequestOptions } from './http';
import type { Pacer } from './pacer';
import type { CoverReader, TextWriter, VideoDecoder } from './types';

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

// Inline requests are capped at 20 MB, and base64 adds a third.
export const MAX_INLINE_VIDEO_BYTES = 14 * 1024 * 1024;

export function geminiDecoder(apiKey: string, options: Options = {}): VideoDecoder {
  const model = options.model || DEFAULT_GEMINI_MODEL;
  return {
    name: `gemini:${model}`,
    async decode(video, seconds, context) {
      if (video.data.length > MAX_INLINE_VIDEO_BYTES) {
        throw new Error(`The video is ${(video.data.length / 1048576).toFixed(1)} MB; decoding takes up to 14 MB`);
      }
      const body = {
        systemInstruction: { parts: [{ text: DECODE_SYSTEM }] },
        contents: [{
          role: 'user',
          parts: [
            { inlineData: { mimeType: video.mimeType, data: toBase64(video.data) } },
            { text: decodeUserText(seconds, context) },
          ],
        }],
        generationConfig: { responseMimeType: 'application/json', responseJsonSchema: decodeJsonSchema(), temperature: 0 },
      };
      const result = await generate(apiKey, model, body, { retries: 2, timeoutMs: 180000, ...options });
      let parsed: unknown;
      try {
        parsed = JSON.parse(result.text);
      } catch {
        throw new Error('Gemini returned invalid JSON for the decode');
      }
      const output = alignDecodedFrames(DecodeOutput.parse(parsed), seconds);
      return { output, inputTokens: result.inputTokens, outputTokens: result.outputTokens };
    },
  };
}

// Covers are small (TikTok sends them under 1 MB), so they go inline.
const MAX_COVER_BYTES = 4 * 1024 * 1024;

export function geminiCoverReader(apiKey: string, options: Options = {}): CoverReader {
  const model = options.model || DEFAULT_GEMINI_MODEL;
  return {
    name: `gemini:${model}`,
    async read(image, context) {
      if (image.data.length > MAX_COVER_BYTES) throw new Error('The cover is too large to read');
      const body = {
        systemInstruction: { parts: [{ text: COVER_SYSTEM }] },
        contents: [{
          role: 'user',
          parts: [
            { inlineData: { mimeType: image.mimeType, data: toBase64(image.data) } },
            { text: coverUserText(context) },
          ],
        }],
        generationConfig: { responseMimeType: 'application/json', responseJsonSchema: coverJsonSchema(), temperature: 0, maxOutputTokens: 1024 },
      };
      const result = await generate(apiKey, model, body, { retries: 1, timeoutMs: 30000, ...options });
      let parsed: unknown;
      try {
        parsed = JSON.parse(result.text);
      } catch {
        throw new Error('Gemini returned invalid JSON for the cover');
      }
      return { output: CoverOutput.parse(parsed), inputTokens: result.inputTokens, outputTokens: result.outputTokens };
    },
  };
}
