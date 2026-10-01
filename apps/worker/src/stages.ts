import { access, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  assembleRecord,
  buildQuestions,
  buildState,
  passageQuestions,
  joinOnScreenText,
  keyframeSeconds,
  PROMPT_VERSION,
  VISION_VERSION,
  VisionOutput,
  type Json,
  type Rates,
} from '@content-lab/core';
import { isSpeech, type AIProviders } from '@content-lab/core/ai';
import {
  detectSceneCuts,
  downloadVideo,
  extractAudio,
  extractKeyframes,
  isSilent,
  NoMediaError,
  probe,
  readBytes,
} from './media';
import type { MediaResolver } from './resolve';
import type { ItemRow, RunRow, Store } from './store';

export const ITEM_STAGES = ['fetch', 'extract', 'transcribe', 'vision', 'classify'] as const;
export type Stage = (typeof ITEM_STAGES)[number];

export type StageContext = {
  run: RunRow;
  item: ItemRow;
  workDir: string;
  store: Store;
  resolver: MediaResolver;
  ai: Partial<AIProviders>;
  rates: Rates;
  addCost(usd: number): void;
  log(message: string): void;
  now(): string;
};
export type StageHandler = (ctx: StageContext) => Promise<void>;

// The raw video and audio only live in the worker's temp folder. If a run
// resumes on a fresh container, the item restarts at fetch.
export class LocalFilesMissing extends Error {
  constructor() {
    super('Local media files are gone (new container); restarting at fetch');
    this.name = 'LocalFilesMissing';
  }
}

export const videoPath = (workDir: string) => join(workDir, 'video.mp4');
export const audioPath = (workDir: string) => join(workDir, 'audio.flac');

export async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export const fetchStage: StageHandler = async (ctx) => {
  const { item, store } = ctx;
  const media = await ctx.resolver.resolve(item);
  ctx.addCost(ctx.resolver.costPerItemUsd);
  await mkdir(ctx.workDir, { recursive: true });
  const { hash } = await downloadVideo(media.videoUrl, videoPath(ctx.workDir), { headers: media.downloadHeaders });

  const raw = (item.raw_json && typeof item.raw_json === 'object' && !Array.isArray(item.raw_json) ? item.raw_json : {}) as Record<string, Json>;
  await store.updateItem(item.id, {
    thumbnail_url: media.coverUrl ?? item.thumbnail_url,
    posted_at: media.postedAt ?? item.posted_at,
    account_handle: media.handle ?? item.account_handle,
    advertiser: media.advertiser ?? item.advertiser,
    region: item.region ?? media.region,
    industry: media.industry ?? item.industry,
    objective_source: media.objectiveSource ?? item.objective_source,
    duration_s: media.durationS ?? item.duration_s,
    raw_json: { ...raw, caption: media.caption, music: media.music, source_item: media.raw as Json },
  });
  const capturedAt = ctx.now();
  await store.addMetrics(media.metrics.map((m) => ({
    item_id: item.id,
    metric_name: m.name,
    value: m.value ?? null,
    value_text: m.valueText ?? null,
    unit: m.unit ?? null,
    captured_at: capturedAt,
  })));
  await store.upsertMedia(item.id, { video_hash: hash });
  ctx.log(`fetched ${item.source_url}`);
};

export const extractStage: StageHandler = async (ctx) => {
  const { item, store, workDir } = ctx;
  const video = videoPath(workDir);
  if (!(await exists(video))) throw new LocalFilesMissing();

  const info = await probe(video);
  if (!info.hasVideo) throw new NoMediaError('The file has no video stream');
  const framesDir = join(workDir, 'frames');
  await mkdir(framesDir, { recursive: true });
  const frames = await extractKeyframes(video, keyframeSeconds(info.durationS ?? item.duration_s ?? 0), framesDir);
  const paths: string[] = [];
  for (const frame of frames) {
    const ext = frame.contentType === 'image/webp' ? 'webp' : 'jpg';
    const path = `${item.id}/${frame.second}.${ext}`;
    await store.uploadFrame(path, await readBytes(frame.path), frame.contentType);
    paths.push(path);
  }
  const cuts = await detectSceneCuts(video);

  let audioType: 'no_track' | 'silent' | null = null;
  if (!info.hasAudio) {
    audioType = 'no_track';
  } else {
    await extractAudio(video, audioPath(workDir));
    if (await isSilent(audioPath(workDir))) audioType = 'silent';
  }

  await store.upsertMedia(item.id, {
    width: info.width,
    height: info.height,
    scene_cuts: cuts,
    keyframe_paths: paths,
    audio_type: audioType,
  });
  if (info.durationS && !item.duration_s) await store.updateItem(item.id, { duration_s: info.durationS });

  // The raw video is never kept: only keyframes, measurements and audio for transcription.
  await rm(video, { force: true });
  await rm(framesDir, { recursive: true, force: true });
  ctx.addCost(ctx.rates.workerPerItemUsd);
  ctx.log(`extracted ${paths.length} keyframes, ${cuts.length} cuts`);
};

export const transcribeStage: StageHandler = async (ctx) => {
  const { item, store, workDir } = ctx;
  const media = await store.getMedia(item.id);
  if (media?.audio_type === 'no_track' || media?.audio_type === 'silent') {
    await store.upsertMedia(item.id, { transcript: '', transcript_lang: null, transcript_segments: [] });
    ctx.log(`no speech (${media.audio_type})`);
    return;
  }
  const audio = audioPath(workDir);
  if (!(await exists(audio))) throw new LocalFilesMissing();
  if (!ctx.ai.transcriber) throw new Error('No transcriber configured');

  const transcript = await ctx.ai.transcriber.transcribe(await readBytes(audio));
  const speech = isSpeech(transcript);
  await store.upsertMedia(item.id, speech
    ? {
        audio_type: 'speech',
        transcript: transcript.text,
        transcript_lang: transcript.language,
        transcript_segments: transcript.segments.map(({ start, end, text }) => ({ start, end, text })),
      }
    : { audio_type: 'music_only', transcript: '', transcript_lang: null, transcript_segments: [] });
  await rm(audio, { force: true });
  ctx.log(speech ? `transcribed (${transcript.language ?? 'unknown language'})` : 'music only, empty transcript');
};

type RawJson = { caption?: string | null; music?: { original?: boolean | null } | null };
const rawJson = (item: ItemRow): RawJson =>
  (item.raw_json && typeof item.raw_json === 'object' && !Array.isArray(item.raw_json) ? item.raw_json : {}) as RawJson;

const secondOf = (path: string) => Number(path.split('/').at(-1)?.split('.')[0]);

// AI call 1: keyframes to a scene description and all on-screen text per frame.
export const visionStage: StageHandler = async (ctx) => {
  const { item, store } = ctx;
  const vision = ctx.ai.vision;
  if (!vision) throw new Error('No vision provider configured');
  const media = await store.getMedia(item.id);
  if (!media?.keyframe_paths.length) throw new Error('No keyframes to describe');
  if (media.frames_json && media.vision_version === VISION_VERSION && media.vision_model === vision.name) {
    ctx.log('vision pass already done');
    return;
  }
  if (media.video_hash) {
    const cached = await store.findMediaWithVision(media.video_hash, VISION_VERSION, vision.name);
    if (cached && cached.item_id !== item.id) {
      await store.upsertMedia(item.id, { frames_json: cached.frames_json, ocr_text: cached.ocr_text, vision_model: vision.name, vision_version: VISION_VERSION });
      ctx.log('vision pass reused from the same video');
      return;
    }
  }
  const frames = await Promise.all(media.keyframe_paths.map(async (path) => ({
    second: secondOf(path),
    mimeType: path.endsWith('.webp') ? 'image/webp' : 'image/jpeg',
    data: await store.downloadFrame(path),
  })));
  const { output } = await vision.describeFrames(frames, {
    source: item.source,
    advertiser: item.advertiser ?? item.account_handle,
    caption: rawJson(item).caption ?? null,
    durationS: item.duration_s,
  });
  await store.upsertMedia(item.id, {
    frames_json: output.frames as unknown as Json,
    ocr_text: joinOnScreenText(output.frames),
    vision_model: vision.name,
    vision_version: VISION_VERSION,
  });
  ctx.addCost(ctx.rates.visionPerItemUsd);
  ctx.log(`vision pass on ${frames.length} keyframes`);
};

// AI call 2: Jev classifies transcript plus vision text into the taxonomy.
// Labels are assigned here, before any metric is joined.
export const classifyStage: StageHandler = async (ctx) => {
  const { item, store } = ctx;
  const classifier = ctx.ai.classifier;
  if (!classifier) throw new Error('No classifier configured');
  const media = await store.getMedia(item.id);
  if (!media?.frames_json || !media.vision_version) throw new Error('Run the vision pass before classifying');
  const frames = VisionOutput.shape.frames.parse(media.frames_json);

  if (media.video_hash) {
    const cached = await store.findClassification(media.video_hash, PROMPT_VERSION, media.vision_version, classifier.model);
    if (cached) {
      if (cached.item_id !== item.id) {
        await store.saveClassification({
          item_id: item.id, video_hash: media.video_hash, model: cached.model, prompt_version: PROMPT_VERSION,
          vision_version: media.vision_version, labels_json: cached.labels_json, evidence_json: cached.evidence_json,
          confidence: cached.confidence, needs_review: cached.needs_review, input_tokens: 0, cost_usd: 0,
        });
      }
      ctx.log('classification reused from the same video');
      return;
    }
  }

  const segments = Array.isArray(media.transcript_segments)
    ? (media.transcript_segments as { start: number | null; end: number | null; text: string }[])
    : [];
  const raw = rawJson(item);
  const state = buildState({
    source: item.source,
    advertiser: item.advertiser ?? item.account_handle,
    region: item.region,
    caption: raw.caption ?? null,
    durationS: item.duration_s,
    audioType: media.audio_type,
    transcript: media.transcript,
    transcriptLang: media.transcript_lang,
    segments,
    frames,
  });
  const { answers, inputTokens } = await classifier.answer(state, { ...buildQuestions(), ...passageQuestions(segments) });
  const { record, evidence, confidence, needsReview } = assembleRecord({
    answers,
    frames,
    durationS: item.duration_s,
    sceneCuts: media.scene_cuts,
    width: media.width,
    height: media.height,
    audioType: media.audio_type,
    segments,
    music: raw.music ? { original: raw.music.original ?? null } : null,
  });
  const tokens = inputTokens ?? ctx.rates.jevTokensPerItem;
  const cost = (tokens / 1_000_000) * ctx.rates.jevPerMillionInputTokensUsd;
  await store.saveClassification({
    item_id: item.id,
    video_hash: media.video_hash,
    model: classifier.model,
    prompt_version: PROMPT_VERSION,
    vision_version: media.vision_version,
    labels_json: record as unknown as Json,
    evidence_json: evidence as unknown as Json,
    confidence,
    needs_review: needsReview,
    input_tokens: inputTokens,
    cost_usd: Number(cost.toFixed(6)),
  });
  ctx.addCost(cost);
  ctx.log(`classified: ${record.format ?? 'unknown format'}, hook ${record.hook_type ?? 'unknown'}${needsReview ? ' (needs review)' : ''}`);
};

export const MEDIA_HANDLERS: Partial<Record<Stage, StageHandler>> = {
  fetch: fetchStage,
  extract: extractStage,
  transcribe: transcribeStage,
};

export const ALL_HANDLERS: Partial<Record<Stage, StageHandler>> = {
  ...MEDIA_HANDLERS,
  vision: visionStage,
  classify: classifyStage,
};
