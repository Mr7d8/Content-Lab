import type { DecodeOutput } from '../decode';
import type { DecodeContext } from '../prompts/decode';
import type { VisionOutput } from '../vision';

// Capability interfaces. Every AI provider sits behind one of these, and
// AIProviders (index.ts) bundles them so callers never import a provider directly.

export type TranscriptSegment = { start: number | null; end: number | null; text: string; noSpeechProb: number | null };
export type Transcript = { text: string; language: string | null; segments: TranscriptSegment[] };

export interface Transcriber {
  readonly name: string;
  transcribe(audio: Uint8Array, options?: { mimeType?: string; filename?: string }): Promise<Transcript>;
}

export type FrameImage = { second: number; mimeType: string; data: Uint8Array };
export type VisionContext = { source: string; advertiser: string | null; caption: string | null; durationS: number | null };
export type Usage = { inputTokens: number | null; outputTokens: number | null };

// Call 1: keyframes in, a scene description and all on-screen text per frame out.
export interface VisionProvider {
  // provider:model, stored in media.vision_model and used as the cache key.
  readonly name: string;
  describeFrames(frames: FrameImage[], context: VisionContext): Promise<{ output: VisionOutput } & Usage>;
}

// v2 decode: the whole video in, speech, frame descriptions and the script
// breakdown out, in one call.
export type VideoInput = { data: Uint8Array; mimeType: string };
export interface VideoDecoder {
  // provider:model, stored in media.vision_model.
  readonly name: string;
  decode(video: VideoInput, seconds: number[], context: DecodeContext): Promise<{ output: DecodeOutput } & Usage>;
}

// Call 2: text in (transcript plus vision text), typed answers out.
export type ChoiceQuestion = { instructions: string; criteria: Record<string, string> };
export type ChoiceAnswer = { choice: string; confidence: number; probabilities: Record<string, number> };
export type ClassifierState = Record<string, string | { id: string; second: number; text: string }[]>;

export interface Classifier {
  readonly model: string;
  answer(state: ClassifierState, questions: Record<string, ChoiceQuestion>): Promise<{ model: string; answers: Record<string, ChoiceAnswer>; inputTokens: number | null }>;
}

// Brief writing: structured pattern data in, Markdown out.
export interface TextWriter {
  readonly name: string;
  write(prompt: { system: string; user: string; maxTokens?: number }): Promise<{ text: string } & Usage>;
}
