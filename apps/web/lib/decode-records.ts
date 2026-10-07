import {
  assembleRecord,
  buildState,
  DECODE_VERSION,
  joinOnScreenText,
  PROMPT_VERSION,
  type ClassifyInput,
  type DecodeOutput,
  type Json,
  type Tables,
  type TablesInsert,
} from '@content-lab/core';
import type { ChoiceAnswer } from '@content-lab/core/ai';

type Item = Pick<Tables<'items'>, 'id' | 'source' | 'advertiser' | 'region' | 'duration_s' | 'scan_json'>;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

function scanRow(item: Item): Record<string, unknown> {
  return item.scan_json && typeof item.scan_json === 'object' && !Array.isArray(item.scan_json) ? (item.scan_json as Record<string, unknown>) : {};
}

export function adDuration(item: Item): number | null {
  return num(item.duration_s) ?? num(scanRow(item).videoDuration) ?? num(scanRow(item).durationSeconds) ?? num((scanRow(item).videoMeta as Record<string, unknown> | undefined)?.duration);
}

// What Jev reads: the decode's speech and frames plus the ad's metadata.
export function classifyInput(item: Item, output: DecodeOutput): ClassifyInput {
  const scan = scanRow(item);
  return {
    source: item.source,
    advertiser: item.advertiser,
    region: item.region,
    caption: text(scan.adTitle) ?? text(scan.adText) ?? text(scan.text),
    durationS: adDuration(item),
    audioType: output.audio_type,
    transcript: output.segments.map((s) => s.text.trim()).filter(Boolean).join(' ') || null,
    transcriptLang: output.language,
    segments: output.segments,
    frames: output.frames,
  };
}

export const jevState = (item: Item, output: DecodeOutput) => buildState(classifyInput(item, output));

// The rows a finished decode writes: media (speech, frames, breakdown) and
// the taxonomy classification.
export function decodeRows(
  item: Item,
  output: DecodeOutput,
  decoderName: string,
  jev: { model: string; answers: Record<string, ChoiceAnswer>; inputTokens: number | null },
  costUsd: number,
): { media: TablesInsert<'media'>; classification: TablesInsert<'classifications'> } {
  const scan = scanRow(item);
  const width = num(scan.width);
  const height = num(scan.height);
  const assembled = assembleRecord({
    answers: jev.answers,
    frames: output.frames,
    durationS: adDuration(item),
    sceneCuts: null,
    width,
    height,
    audioType: output.audio_type,
    segments: output.segments,
    music: null,
  });
  return {
    media: {
      item_id: item.id,
      width,
      height,
      audio_type: output.audio_type,
      transcript: output.segments.map((s) => s.text.trim()).filter(Boolean).join(' ') || null,
      transcript_lang: output.language,
      transcript_segments: output.segments as unknown as Json,
      frames_json: output.frames as unknown as Json,
      ocr_text: joinOnScreenText(output.frames) || null,
      vision_model: decoderName,
      vision_version: DECODE_VERSION,
      breakdown_json: output.breakdown as unknown as Json,
    },
    classification: {
      item_id: item.id,
      model: jev.model,
      prompt_version: PROMPT_VERSION,
      vision_version: DECODE_VERSION,
      labels_json: assembled.record as unknown as Json,
      evidence_json: assembled.evidence as unknown as Json,
      confidence: assembled.confidence,
      needs_review: assembled.needsReview,
      input_tokens: jev.inputTokens,
      cost_usd: Number(costUsd.toFixed(4)),
    },
  };
}
