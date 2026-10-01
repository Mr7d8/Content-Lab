import { execFile } from 'node:child_process';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { keyframeSeconds } from '@content-lab/core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { aspectRatio, detectSceneCuts, downloadVideo, extractAudio, extractKeyframes, isSilent, probe } from '../src/media';

const exec = promisify(execFile);
let dir: string;
let clip: string;
let silentClip: string;
let mutedClip: string;

// Clips are generated at test time, so no binary fixtures live in git.
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cl-media-'));
  clip = join(dir, 'clip.mp4');
  // Three hard color cuts (red, blue, green) with a tone, 9:16, 7.5 s.
  await exec('ffmpeg', ['-v', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=red:s=360x640:d=2.5,format=yuv420p',
    '-f', 'lavfi', '-i', 'color=c=blue:s=360x640:d=2.5,format=yuv420p',
    '-f', 'lavfi', '-i', 'color=c=green:s=360x640:d=2.5,format=yuv420p',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=7.5',
    '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]',
    '-map', '[v]', '-map', '3:a', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', clip]);
  silentClip = join(dir, 'silent.mp4');
  await exec('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=s=360x640:d=2', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono',
    '-t', '2', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', silentClip]);
  mutedClip = join(dir, 'muted.mp4');
  await exec('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=s=640x640:d=2', '-c:v', 'libx264', mutedClip]);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('media', () => {
  it('probes duration, size and streams', async () => {
    const p = await probe(clip);
    expect(p.durationS).toBeCloseTo(7.5, 0);
    expect(p).toMatchObject({ width: 360, height: 640, hasVideo: true, hasAudio: true });
    expect(aspectRatio(p.width, p.height)).toBe('9:16');
    expect((await probe(mutedClip)).hasAudio).toBe(false);
    expect(aspectRatio(640, 640)).toBe('1:1');
  });

  it('extracts 540 px WebP keyframes on the plan schedule', async () => {
    const seconds = keyframeSeconds(7.5);
    expect(seconds).toEqual([0, 1, 2, 3, 6]);
    const frames = await extractKeyframes(clip, seconds, dir);
    expect(frames.map((f) => f.second)).toEqual(seconds);
    expect(frames.every((f) => f.contentType === 'image/webp')).toBe(true);
    const size = await stat(frames[0]!.path);
    expect(size.size).toBeGreaterThan(0);
    expect(size.size).toBeLessThan(512 * 1024);
    const dims = await probe(frames[0]!.path);
    expect(dims.width).toBe(540);
  });

  it('detects hard cuts', async () => {
    const cuts = await detectSceneCuts(clip);
    expect(cuts).toHaveLength(2);
    expect(cuts[0]).toBeCloseTo(2.5, 0);
    expect(cuts[1]).toBeCloseTo(5, 0);
  });

  it('extracts 16 kHz mono audio and tells sound from silence', async () => {
    const audio = join(dir, 'a.flac');
    await extractAudio(clip, audio);
    expect((await probe(audio)).hasAudio).toBe(true);
    expect(await isSilent(audio)).toBe(false);
    const quiet = join(dir, 'q.flac');
    await extractAudio(silentClip, quiet);
    expect(await isSilent(quiet)).toBe(true);
  });

  it('downloads with a hash and enforces content', async () => {
    const body = new Uint8Array([1, 2, 3, 4]);
    const fetchImpl = vi.fn(async () => new Response(body));
    const target = join(dir, 'dl.bin');
    const { hash, bytes } = await downloadVideo('https://cdn.test/v.mp4', target, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(bytes).toBe(4);
    expect(hash).toBe('9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a');
    const failing = vi.fn(async () => new Response('gone', { status: 403 }));
    await expect(downloadVideo('https://cdn.test/v.mp4', target, { fetchImpl: failing as unknown as typeof fetch })).rejects.toThrow('HTTP 403');
    await writeFile(target, '');
  });
});
