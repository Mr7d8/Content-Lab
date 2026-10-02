import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProviderError } from '@content-lab/core/ai';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MediaResolver } from '../src/resolve';
import { remainingItemCost, runPipeline, type RunnerDeps } from '../src/runner';
import { LocalFilesMissing, type Stage, type StageHandler } from '../src/stages';
import { MemoryStore } from './memory-store';

const RATES = { apifyPerItemUsd: 0.01, workerPerItemUsd: 0.002, jevPerMillionInputTokensUsd: 0.04, jevTokensPerItem: 10000, groqPerItemUsd: 0, visionPerItemUsd: 0 };
const resolver: MediaResolver = { costPerItemUsd: 0.01, prefetch: async () => undefined, resolve: async () => { throw new Error('not used'); } };

let tmpRoot: string;
beforeEach(async () => { tmpRoot = await mkdtemp(join(tmpdir(), 'cl-runner-')); });
afterEach(async () => { await rm(tmpRoot, { recursive: true, force: true }); });

function deps(store: MemoryStore, handlers: Partial<Record<Stage, StageHandler>>): RunnerDeps {
  return { store, resolver, ai: {}, handlers, tmpRoot, rates: RATES, log: () => undefined, now: () => '2026-10-01T10:00:00Z' };
}

// Each handler records its stage and charges like the real one.
function recorder(calls: string[], fail: Partial<Record<Stage, (itemId: string, attempt: number) => Error | null>> = {}) {
  const attempts = new Map<string, number>();
  const make = (stage: Stage, cost: number): StageHandler => async (ctx) => {
    const key = `${ctx.item.id}:${stage}`;
    const attempt = (attempts.get(key) ?? 0) + 1;
    attempts.set(key, attempt);
    const error = fail[stage]?.(ctx.item.id, attempt);
    calls.push(`${ctx.item.id}:${stage}`);
    if (error) throw error;
    ctx.addCost(cost);
  };
  return {
    fetch: make('fetch', 0.01), extract: make('extract', 0.002), transcribe: make('transcribe', 0),
    vision: make('vision', 0), classify: make('classify', 0.0004),
  };
}

describe('runPipeline', () => {
  it('runs every stage for every item and records progress', async () => {
    const store = new MemoryStore();
    const run = store.addRun({ spend_cap_usd: 1 });
    const a = store.addItem(run.id);
    const b = store.addItem(run.id);
    const calls: string[] = [];
    expect(await runPipeline(run.id, deps(store, recorder(calls)))).toBe('completed');
    expect(calls).toEqual([
      `${a.id}:fetch`, `${a.id}:extract`, `${a.id}:transcribe`, `${a.id}:vision`, `${a.id}:classify`,
      `${b.id}:fetch`, `${b.id}:extract`, `${b.id}:transcribe`, `${b.id}:vision`, `${b.id}:classify`,
    ]);
    const finalRun = await store.getRun(run.id);
    expect(finalRun).toMatchObject({ status: 'completed', items_done: 2, items_failed: 0, finished_at: '2026-10-01T10:00:00Z' });
    expect(finalRun.cost_actual_usd).toBeCloseTo(2 * 0.0124, 4);
    expect(store.runItem(a.id)).toMatchObject({ stage: 'done', status: 'done' });
    expect((store.runItem(a.id).stage_log as { stage: string }[]).map((e) => e.stage)).toEqual(['fetch', 'extract', 'transcribe', 'vision', 'classify']);
  });

  it('retries a stage once, then flags the item for review and moves on', async () => {
    const store = new MemoryStore();
    const run = store.addRun();
    const a = store.addItem(run.id);
    const b = store.addItem(run.id);
    const c = store.addItem(run.id);
    const calls: string[] = [];
    const handlers = recorder(calls, {
      extract: (id) => (id === a.id ? new Error('corrupt video') : null),
      transcribe: (id, attempt) => (id === b.id && attempt === 1 ? new Error('blip') : null),
    });
    expect(await runPipeline(run.id, deps(store, handlers))).toBe('partial');
    expect(calls.filter((x) => x === `${a.id}:extract`)).toHaveLength(2);
    expect(store.runItem(a.id)).toMatchObject({ status: 'needs_review', stage: 'extract', error: 'corrupt video', attempts: 1 });
    expect(store.runItem(b.id)).toMatchObject({ status: 'done', attempts: 1 });
    expect(store.runItem(c.id).status).toBe('done');
    expect(await store.getRun(run.id)).toMatchObject({ items_done: 2, items_failed: 1 });
  });

  it('stops before the next item when a pause is requested', async () => {
    const store = new MemoryStore();
    const run = store.addRun();
    const a = store.addItem(run.id);
    const b = store.addItem(run.id);
    const calls: string[] = [];
    const handlers = recorder(calls);
    const classify = handlers.classify;
    handlers.classify = async (ctx) => {
      await classify(ctx);
      await store.updateRun(run.id, { pause_requested: true });
    };
    expect(await runPipeline(run.id, deps(store, handlers))).toBe('paused');
    expect(store.runItem(a.id).status).toBe('done');
    expect(store.runItem(b.id).status).toBe('pending');
    expect(await store.getRun(run.id)).toMatchObject({ status: 'paused', pause_requested: false, finished_at: null });
  });

  it('pauses with a reason when the next item would pass the spend cap', async () => {
    const store = new MemoryStore();
    const run = store.addRun({ spend_cap_usd: 0.02 });
    const a = store.addItem(run.id);
    const b = store.addItem(run.id);
    expect(await runPipeline(run.id, deps(store, recorder([])))).toBe('paused');
    expect(store.runItem(a.id).status).toBe('done');
    expect(store.runItem(b.id).status).toBe('pending');
    const final = await store.getRun(run.id);
    expect(final.error).toContain('Spend cap reached');
    expect(final.cost_actual_usd).toBeLessThanOrEqual(0.02);
  });

  it('fails the run on an auth error instead of burning through items', async () => {
    const store = new MemoryStore();
    const run = store.addRun();
    const a = store.addItem(run.id);
    const b = store.addItem(run.id);
    const handlers = recorder([], { transcribe: () => new ProviderError('Groq', 401) });
    expect(await runPipeline(run.id, deps(store, handlers))).toBe('failed');
    expect(store.runItem(a.id).status).toBe('pending');
    expect(store.runItem(b.id).status).toBe('pending');
    expect((await store.getRun(run.id)).error).toContain('Groq: HTTP 401');
  });

  it('resumes at the recorded stage, and restarts at fetch when local files are gone', async () => {
    const store = new MemoryStore();
    const run = store.addRun({ status: 'paused' });
    const a = store.addItem(run.id, {}, { stage: 'classify' });
    const b = store.addItem(run.id, {}, { stage: 'transcribe' });
    const calls: string[] = [];
    expect(await runPipeline(run.id, deps(store, recorder(calls)))).toBe('completed');
    expect(calls.filter((x) => x.startsWith(a.id))).toEqual([`${a.id}:classify`]);
    expect(calls.filter((x) => x.startsWith(b.id))).toEqual([`${b.id}:fetch`, `${b.id}:extract`, `${b.id}:transcribe`, `${b.id}:vision`, `${b.id}:classify`]);
  });

  it('goes back to fetch once if a stage reports missing local files', async () => {
    const store = new MemoryStore();
    const run = store.addRun();
    const a = store.addItem(run.id);
    const calls: string[] = [];
    const handlers = recorder(calls, { extract: (_id, attempt) => (attempt === 1 ? new LocalFilesMissing() : null) });
    expect(await runPipeline(run.id, deps(store, handlers))).toBe('completed');
    expect(calls.slice(0, 4)).toEqual([`${a.id}:fetch`, `${a.id}:extract`, `${a.id}:fetch`, `${a.id}:extract`]);
  });

  it('skips done items and refuses runs that are running or finished', async () => {
    const store = new MemoryStore();
    const running = store.addRun({ status: 'running', updated_at: '2026-10-01T09:30:00Z' });
    expect(await runPipeline(running.id, deps(store, {}))).toBe('not_claimable');
    const done = store.addRun({ status: 'completed' });
    expect(await runPipeline(done.id, deps(store, {}))).toBe('not_claimable');
  });

  it('picks up a run left running by an actor that timed out', async () => {
    const store = new MemoryStore();
    const run = store.addRun({ status: 'running', updated_at: '2026-10-01T08:30:00Z' });
    const item = store.addItem(run.id, {}, { stage: 'classify', status: 'running' });
    const calls: string[] = [];
    expect(await runPipeline(run.id, deps(store, recorder(calls)))).toBe('completed');
    expect(calls).toEqual([`${item.id}:classify`]);
  });

  it('estimates the paid cost left for an item by stage', () => {
    expect(remainingItemCost('fetch', RATES, 0.01)).toBeCloseTo(0.0124, 6);
    expect(remainingItemCost('classify', RATES, 0.01)).toBeCloseTo(0.0004, 6);
    expect(remainingItemCost('done', RATES, 0.01)).toBe(0);
  });
});
