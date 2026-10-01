import { access, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { keyframeSeconds, type Json, type Rates } from '@content-lab/core';
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

export const MEDIA_HANDLERS: Partial<Record<Stage, StageHandler>> = {
  fetch: fetchStage,
  extract: extractStage,
  transcribe: transcribeStage,
};
