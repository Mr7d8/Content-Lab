import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const MAX_VIDEO_BYTES = 150 * 1024 * 1024;

export class NoMediaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoMediaError';
  }
}

// Streams a video to disk with a size limit and returns its sha256.
export async function downloadVideo(
  url: string,
  target: string,
  { headers = {}, fetchImpl = fetch }: { headers?: Record<string, string>; fetchImpl?: typeof fetch } = {},
): Promise<{ hash: string; bytes: number }> {
  const res = await fetchImpl(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(120000) });
  if (!res.ok || !res.body) throw new Error(`Video download failed (HTTP ${res.status}); the media URL may have expired`);
  const hash = createHash('sha256');
  let bytes = 0;
  const limited = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream).map((chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > MAX_VIDEO_BYTES) throw new Error('Video exceeds the 150 MB download limit');
    hash.update(chunk);
    return chunk;
  });
  await pipeline(limited, createWriteStream(target, { mode: 0o600 }));
  if (bytes === 0) throw new Error('Video download was empty');
  return { hash: hash.digest('hex'), bytes };
}

export type Probe = { durationS: number | null; width: number | null; height: number | null; hasVideo: boolean; hasAudio: boolean };

export async function probe(file: string): Promise<Probe> {
  const { stdout } = await exec('ffprobe', [
    '-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', file,
  ], { timeout: 30000 });
  const json = JSON.parse(stdout) as { streams?: { codec_type?: string; width?: number; height?: number }[]; format?: { duration?: string } };
  const streams = json.streams ?? [];
  const video = streams.find((s) => s.codec_type === 'video');
  const duration = Number(json.format?.duration);
  return {
    durationS: Number.isFinite(duration) && duration > 0 ? Math.round(duration * 100) / 100 : null,
    width: video?.width ?? null,
    height: video?.height ?? null,
    hasVideo: Boolean(video),
    hasAudio: streams.some((s) => s.codec_type === 'audio'),
  };
}

// One 540 px wide frame per requested second. WebP keeps Supabase Free storage
// small; JPEG is the fallback if the FFmpeg build lacks libwebp.
export async function extractKeyframes(
  file: string,
  seconds: number[],
  outDir: string,
): Promise<{ second: number; path: string; contentType: string }[]> {
  const frames: { second: number; path: string; contentType: string }[] = [];
  for (const second of seconds) {
    const webp = join(outDir, `${second}.webp`);
    try {
      await exec('ffmpeg', ['-v', 'error', '-y', '-ss', String(second), '-i', file, '-frames:v', '1', '-vf', 'scale=540:-2', '-c:v', 'libwebp', '-quality', '70', webp], { timeout: 30000 });
      if ((await stat(webp)).size > 0) {
        frames.push({ second, path: webp, contentType: 'image/webp' });
        continue;
      }
    } catch {
      // Fall through to JPEG.
    }
    const jpg = join(outDir, `${second}.jpg`);
    try {
      await exec('ffmpeg', ['-v', 'error', '-y', '-ss', String(second), '-i', file, '-frames:v', '1', '-vf', 'scale=540:-2', '-q:v', '5', jpg], { timeout: 30000 });
      if ((await stat(jpg)).size > 0) frames.push({ second, path: jpg, contentType: 'image/jpeg' });
    } catch {
      // A seek past the last frame yields nothing; skip that second.
    }
  }
  if (!frames.length) throw new NoMediaError('No keyframes could be extracted from the video');
  return frames;
}

// Seconds where FFmpeg's scene score jumps above the threshold (hard cuts).
export async function detectSceneCuts(file: string, threshold = 0.3): Promise<number[]> {
  const { stderr } = await exec('ffmpeg', [
    '-hide_banner', '-i', file, '-an', '-vf', `select='gt(scene,${threshold})',showinfo`, '-f', 'null', '-',
  ], { timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
  const cuts = [...stderr.matchAll(/pts_time:\s*([\d.]+)/g)].map((m) => Math.round(Number(m[1]) * 100) / 100);
  return [...new Set(cuts)].filter((s) => Number.isFinite(s) && s > 0.2).sort((a, b) => a - b);
}

// 16 kHz mono FLAC, the input Whisper expects.
export async function extractAudio(file: string, target: string): Promise<void> {
  await exec('ffmpeg', ['-v', 'error', '-y', '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'flac', target], { timeout: 120000 });
}

// True when the loudest point of the audio is near silence.
export async function isSilent(audioFile: string, maxDb = -50): Promise<boolean> {
  const { stderr } = await exec('ffmpeg', ['-hide_banner', '-i', audioFile, '-af', 'volumedetect', '-f', 'null', '-'], { timeout: 60000 });
  const max = Number(stderr.match(/max_volume:\s*(-?[\d.]+|-inf) dB/)?.[1]);
  return !Number.isFinite(max) || max <= maxDb;
}

export async function readBytes(path: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(path));
}

export function aspectRatio(width: number | null, height: number | null): '9:16' | '4:5' | '1:1' | '16:9' | 'other' | null {
  if (!width || !height) return null;
  const r = width / height;
  const near = (target: number) => Math.abs(r - target) / target < 0.04;
  if (near(9 / 16)) return '9:16';
  if (near(4 / 5)) return '4:5';
  if (near(1)) return '1:1';
  if (near(16 / 9)) return '16:9';
  return 'other';
}
