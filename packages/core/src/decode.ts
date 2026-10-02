import { z } from 'zod';
import { keyframeSeconds, VisionFrame } from './vision';

// Bump when the decode prompt or this schema changes. Stored in
// media.vision_version and classifications.vision_version.
export const DECODE_VERSION = 'video-v1';

const Seconds = z.number().nonnegative();

export const BeatRole = z.enum(['hook', 'setup', 'demo', 'proof', 'offer', 'cta', 'other']);
export type BeatRole = z.infer<typeof BeatRole>;

// The script breakdown shown on the board.
export const Breakdown = z.object({
  summary: z.string(),
  product: z.string().nullable(),
  hook: z.object({ text: z.string(), visual: z.string() }),
  beats: z.array(z.object({ start: Seconds, end: Seconds, role: BeatRole, summary: z.string() })).min(1),
  cta: z.string().nullable(),
  offer: z.string().nullable(),
  why_it_works: z.string(),
});
export type Breakdown = z.infer<typeof Breakdown>;

// One Gemini call per video: speech, frame descriptions at fixed seconds
// (the same shape as the v1 vision pass, so Jev classification is unchanged)
// and the breakdown.
export const DecodeOutput = z.object({
  audio_type: z.enum(['speech', 'music_only', 'silent']),
  language: z.string().nullable(),
  segments: z.array(z.object({ start: Seconds, end: Seconds, text: z.string() })),
  frames: z.array(VisionFrame).min(1),
  breakdown: Breakdown,
});
export type DecodeOutput = z.infer<typeof DecodeOutput>;

const MAX_FRAMES = 20;

// Seconds to describe: every second for 0 to 3 s, then every 3 s, thinned to
// at most 20 so long ads stay one bounded answer.
export function decodeSeconds(durationS: number | null): number[] {
  const all = keyframeSeconds(durationS ?? 0);
  if (all.length <= MAX_FRAMES) return all;
  const opening = all.filter((s) => s <= 3);
  const rest = all.filter((s) => s > 3);
  const step = rest.length / (MAX_FRAMES - opening.length);
  return [...opening, ...Array.from({ length: MAX_FRAMES - opening.length }, (_, i) => rest[Math.floor(i * step)] as number)];
}

// Pin each described frame to the second it was asked for.
export function alignDecodedFrames(output: DecodeOutput, seconds: number[]): DecodeOutput {
  if (output.frames.length !== seconds.length) {
    throw new Error(`Decode described ${output.frames.length} frames for ${seconds.length} timestamps`);
  }
  return { ...output, frames: output.frames.map((f, i) => ({ ...f, second: seconds[i] as number })) };
}

// Estimated paid cost of one decode. Defaults follow Gemini Flash list prices
// and DEFAULT_RATES for Jev; check them against the bills.
export type DecodeRates = { geminiInputPerMillionUsd: number; geminiOutputPerMillionUsd: number; jevPerMillionInputTokensUsd: number };
export const DEFAULT_DECODE_RATES: DecodeRates = { geminiInputPerMillionUsd: 0.3, geminiOutputPerMillionUsd: 2.5, jevPerMillionInputTokensUsd: 0.042 };

export function decodeCost(usage: { geminiInput: number | null; geminiOutput: number | null; jevInput: number | null }, rates: DecodeRates = DEFAULT_DECODE_RATES): number {
  return ((usage.geminiInput ?? 0) * rates.geminiInputPerMillionUsd
    + (usage.geminiOutput ?? 0) * rates.geminiOutputPerMillionUsd
    + (usage.jevInput ?? 0) * rates.jevPerMillionInputTokensUsd) / 1_000_000;
}

// A rough figure before decoding, for the budget check: a 30 s video at
// Gemini's video token rate plus the answer and the Jev request.
export const DECODE_ESTIMATE_USD = decodeCost({ geminiInput: 12_000, geminiOutput: 4_000, jevInput: 10_000 });
