import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Transcriber } from '@content-lab/core/ai';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MediaResolver, ResolvedMedia } from '../src/resolve';
import { runPipeline } from '../src/runner';
import { exists, MEDIA_HANDLERS, videoPath } from '../src/stages';
import { MemoryStore } from './memory-store';

const exec = promisify(execFile);
let dir: string;
let server: Server;
let base: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cl-stages-'));
  await exec('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=s=360x640:d=7', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=7',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', join(dir, 'speech.mp4')]);
  await exec('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=s=720x720:d=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(dir, 'muted.mp4')]);
  server = createServer(async (req, res) => {
    try {
      const body = await readFile(join(dir, (req.url ?? '/').slice(1)));
      res.writeHead(200, { 'content-type': 'video/mp4' }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

afterAll(async () => {
  server.close();
  await rm(dir, { recursive: true, force: true });
});

function fakeResolver(files: Record<string, string>): MediaResolver {
  return {
    costPerItemUsd: 0.005,
    prefetch: async () => undefined,
    resolve: async (item): Promise<ResolvedMedia> => ({
      videoUrl: `${base}/${files[item.external_id]}`, downloadHeaders: {}, coverUrl: 'https://cdn.test/cover.jpg',
      durationS: null, postedAt: '2026-09-20T12:00:00.000Z', handle: 'temu', advertiser: null, region: null,
      industry: null, objectiveSource: null, caption: 'Huge sale', music: { name: 'original sound', author: 'temu', original: true },
      metrics: [{ name: 'views', value: 120000, unit: 'count' }, { name: 'likes', value: 5400, unit: 'count' }],
      raw: { id: item.external_id },
    }),
  };
}

const speechTranscriber: Transcriber = {
  name: 'fake',
  transcribe: async () => ({
    text: 'Salam, had l3rd ghir lyoum, livraison gratuite',
    language: 'arabic',
    segments: [{ start: 0, end: 3, text: 'Salam, had l3rd ghir lyoum, livraison gratuite', noSpeechProb: 0.01 }],
  }),
};

describe('media stages end to end', () => {
  it('fetches, extracts and transcribes, then deletes the raw video', async () => {
    const store = new MemoryStore();
    const run = store.addRun();
    const speech = store.addItem(run.id);
    const muted = store.addItem(run.id);
    const tmpRoot = join(dir, 'work');
    const outcome = await runPipeline(run.id, {
      store,
      resolver: fakeResolver({ [speech.external_id]: 'speech.mp4', [muted.external_id]: 'muted.mp4' }),
      ai: { transcriber: speechTranscriber },
      handlers: MEDIA_HANDLERS,
      tmpRoot,
      log: () => undefined,
    });
    expect(outcome).toBe('completed');

    const m = store.media.get(speech.id)!;
    expect(m.video_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(m).toMatchObject({ width: 360, height: 640, audio_type: 'speech', transcript_lang: 'arabic' });
    expect(m.keyframe_paths).toEqual([0, 1, 2, 3, 6].map((s) => `${speech.id}/${s}.webp`));
    expect(store.frames.get(`${speech.id}/0.webp`)?.contentType).toBe('image/webp');
    expect(m.transcript_segments).toEqual([{ start: 0, end: 3, text: 'Salam, had l3rd ghir lyoum, livraison gratuite' }]);

    expect(store.items.get(speech.id)).toMatchObject({ account_handle: 'temu', thumbnail_url: 'https://cdn.test/cover.jpg', posted_at: '2026-09-20T12:00:00.000Z' });
    expect(store.items.get(speech.id)!.duration_s).toBeCloseTo(7, 0);
    expect(store.metrics.filter((r) => r.item_id === speech.id).map((r) => r.metric_name)).toEqual(['views', 'likes']);

    // An ad with no audio track is not an error: empty transcript, marked no_track.
    expect(store.media.get(muted.id)).toMatchObject({ audio_type: 'no_track', transcript: '', transcript_segments: [] });

    // Raw videos never survive the run.
    expect(await exists(videoPath(join(tmpRoot, speech.id)))).toBe(false);
    expect(await exists(join(tmpRoot, speech.id))).toBe(false);
    expect((await store.getRun(run.id)).cost_actual_usd).toBeGreaterThan(0);
  });

  it('marks music-only audio with an empty transcript', async () => {
    const store = new MemoryStore();
    const run = store.addRun();
    const item = store.addItem(run.id);
    const musicTranscriber: Transcriber = { name: 'fake', transcribe: async () => ({ text: 'Thank you.', language: 'english', segments: [] }) };
    await runPipeline(run.id, {
      store, resolver: fakeResolver({ [item.external_id]: 'speech.mp4' }), ai: { transcriber: musicTranscriber },
      handlers: MEDIA_HANDLERS, tmpRoot: join(dir, 'work2'), log: () => undefined,
    });
    expect(store.media.get(item.id)).toMatchObject({ audio_type: 'music_only', transcript: '', transcript_segments: [] });
  });
});
