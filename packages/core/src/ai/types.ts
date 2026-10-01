// Capability interfaces. Every AI provider sits behind one of these, and
// AIProviders (index.ts) bundles them so callers never import a provider directly.

export type TranscriptSegment = { start: number | null; end: number | null; text: string; noSpeechProb: number | null };
export type Transcript = { text: string; language: string | null; segments: TranscriptSegment[] };

export interface Transcriber {
  readonly name: string;
  transcribe(audio: Uint8Array, options?: { mimeType?: string; filename?: string }): Promise<Transcript>;
}
