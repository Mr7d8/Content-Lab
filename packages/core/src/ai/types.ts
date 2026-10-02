import type { DecodeOutput } from '../decode';
import type { DecodeContext } from '../prompts/decode';

// Capability interfaces. Every AI provider sits behind one of these, and
// AIProviders (index.ts) bundles them so callers never import a provider directly.

export type Usage = { inputTokens: number | null; outputTokens: number | null };

// Call 1: the whole video in, speech, frame descriptions and the script
// breakdown out.
export type VideoInput = { data: Uint8Array; mimeType: string };
export interface VideoDecoder {
  // provider:model, stored in media.vision_model.
  readonly name: string;
  decode(video: VideoInput, seconds: number[], context: DecodeContext): Promise<{ output: DecodeOutput } & Usage>;
}

// Call 2: text in (speech plus frame descriptions), typed answers out.
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
