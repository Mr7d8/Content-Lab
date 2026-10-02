import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Candidate } from '@content-lab/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apifyDiscoverer, type Discoverer } from '../src/discover';
import { apifyResolver, type MediaResolver } from '../src/resolve';
import { runPipeline, type RunnerDeps } from '../src/runner';
import type { StageHandler } from '../src/stages';
import { MemoryStore } from './memory-store';

const NOW = '2026-10-02T06:00:00Z';
const RATES = { apifyPerItemUsd: 0.01, workerPerItemUsd: 0.002, jevPerMillionInputTokensUsd: 0.04, jevTokensPerItem: 10000, groqPerItemUsd: 0, visionPerItemUsd: 0 };
const resolver: MediaResolver = { costPerItemUsd: 0.01, prefetch: async () => undefined, resolve: async () => { throw new Error('not used'); } };

let tmpRoot: string;
beforeEach(async () => { tmpRoot = await mkdtemp(join(tmpdir(), 'cl-discover-')); });
afterEach(async () => { await rm(tmpRoot, { recursive: true, force: true }); });

const cc = (id: string, ctr: number, likes = 0): Candidate => ({
  source: 'tiktok_creative_center', externalId: id, sourceUrl: `https://ads.tiktok.com/business/creativecenter/topads/${id}/`,
  rank: ctr, tiebreak: likes, postedAt: null, raw: { material_id: id, ctr, like: likes, videoUrl: `https://cdn.test/${id}.mp4` },
});

function deps(store: MemoryStore, discoverer: Discoverer | undefined, calls: string[] = []): RunnerDeps {
  const record: StageHandler = async (ctx) => { calls.push(ctx.item.external_id); };
  return { store, resolver, discoverer, ai: {}, handlers: { fetch: record }, tmpRoot, rates: RATES, log: () => undefined, now: () => NOW };
}

describe('watchlist runs', () => {
  it('finds ads, skips the Library, keeps the best new ones and processes them', async () => {
    const store = new MemoryStore();
    const w = store.addWatchlist({ max_items: 2 });
    const run = store.addRun({ source: 'tiktok_creative_center', watchlist_id: w.id, spend_cap_usd: 0.5 });
    const old = store.addRun();
    store.addItem(old.id, { source: 'tiktok_creative_center', external_id: '10000003' });
    const discoverer: Discoverer = {
      discover: async () => ({ candidates: [cc('10000001', 0.01), cc('10000002', 0.03), cc('10000003', 0.09), cc('10000004', 0.02)], costUsd: 0.017 }),
    };
    const calls: string[] = [];

    expect(await runPipeline(run.id, deps(store, discoverer, calls))).toBe('completed');
    expect(calls).toEqual(['10000002', '10000004']);
    const saved = (await store.listRunItems(run.id)).map((ri) => ri.item);
    expect(saved[0]).toMatchObject({ advertiser: 'Temu', raw_json: { watchlist_id: w.id, discovered: { material_id: '10000002' } } });
    expect(store.runs.get(run.id)).toMatchObject({ items_requested: 2, items_done: 2, cost_actual_usd: 0.017 });
    expect(store.watchlists.get(w.id)?.last_swept_at).toBe(NOW);
  });

  it('completes with nothing to do when every top ad is already collected', async () => {
    const store = new MemoryStore();
    const w = store.addWatchlist();
    const run = store.addRun({ source: 'tiktok_creative_center', watchlist_id: w.id });
    store.addItem(store.addRun().id, { source: 'tiktok_creative_center', external_id: '10000001' });
    const discoverer: Discoverer = { discover: async () => ({ candidates: [cc('10000001', 0.05)], costUsd: 0.008 }) };
    expect(await runPipeline(run.id, deps(store, discoverer))).toBe('completed');
    expect(store.runs.get(run.id)).toMatchObject({ items_requested: 0, cost_actual_usd: 0.008 });
    expect(store.watchlists.get(w.id)?.last_swept_at).toBe(NOW);
  });

  it('fails the run with the reason when the search fails, and keeps the schedule', async () => {
    const store = new MemoryStore();
    const w = store.addWatchlist();
    const run = store.addRun({ source: 'tiktok_creative_center', watchlist_id: w.id });
    const discoverer: Discoverer = { discover: async () => { throw new Error('Apify: HTTP 404. Request failed.'); } };
    expect(await runPipeline(run.id, deps(store, discoverer))).toBe('failed');
    expect(store.runs.get(run.id)?.error).toBe('Search failed: Apify: HTTP 404. Request failed.');
    expect(store.watchlists.get(w.id)?.last_swept_at).toBeNull();
  });

  it('pauses before searching when the cap cannot cover it', async () => {
    const store = new MemoryStore();
    const w = store.addWatchlist({ max_items: 10 });
    const run = store.addRun({ source: 'tiktok_creative_center', watchlist_id: w.id, spend_cap_usd: 0.05 });
    const discover = vi.fn();
    expect(await runPipeline(run.id, deps(store, { discover }))).toBe('paused');
    expect(discover).not.toHaveBeenCalled();
    expect(store.runs.get(run.id)?.error).toMatch(/Spend cap too low/);
  });

  it('does not search again when a paused watchlist run resumes', async () => {
    const store = new MemoryStore();
    const w = store.addWatchlist();
    const run = store.addRun({ source: 'tiktok_creative_center', watchlist_id: w.id, status: 'paused' });
    store.addItem(run.id, { source: 'tiktok_creative_center', external_id: '10000009' });
    const discover = vi.fn();
    expect(await runPipeline(run.id, deps(store, { discover }))).toBe('completed');
    expect(discover).not.toHaveBeenCalled();
  });
});

describe('apifyDiscoverer', () => {
  it('calls the Creative Center actor with the watchlist filters', async () => {
    const fetchImpl = vi.fn(async () => Response.json([{ material_id: '7301234567890123456', ctr: 0.02 }, { brand_name: 'no id' }]));
    const store = new MemoryStore();
    const w = store.addWatchlist({ type: 'industry', value: 'ecommerce', region: 'MA', objective: 'purchase', refresh_cadence: 'monthly', max_items: 10 });
    const d = apifyDiscoverer({ token: 'apify_api_x', tiktokActorId: 'clockworks~tiktok-scraper', creativeCenterActorId: 'fetch_cat~tiktok-ads-library-scraper', fetchImpl: fetchImpl as unknown as typeof fetch });
    const { candidates, costUsd } = await d.discover(w);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/acts/fetch_cat~tiktok-ads-library-scraper/run-sync-get-dataset-items');
    expect(JSON.parse(String(init.body))).toEqual({ period: 30, maxItems: 30, regions: ['MA'], industry: 'ecommerce', objective: 'Conversions' });
    expect(candidates.map((c) => c.externalId)).toEqual(['7301234567890123456']);
    expect(costUsd).toBeCloseTo(0.011);
  });

  it('searches organic hashtags with the TikTok scraper', async () => {
    const fetchImpl = vi.fn(async () => Response.json([{ id: '7301234567890123456', webVideoUrl: 'https://www.tiktok.com/@noon/video/7301234567890123456', playCount: 5 }]));
    const store = new MemoryStore();
    const w = store.addWatchlist({ source: 'tiktok_organic', type: 'hashtag', value: 'noon', max_items: 5 });
    const d = apifyDiscoverer({ token: 't', tiktokActorId: 'clockworks~tiktok-scraper', creativeCenterActorId: null, fetchImpl: fetchImpl as unknown as typeof fetch });
    const { candidates } = await d.discover(w);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/acts/clockworks~tiktok-scraper/');
    expect(JSON.parse(String(init.body))).toMatchObject({ hashtags: ['noon'], resultsPerPage: 15, shouldDownloadVideos: false });
    expect(candidates[0]?.sourceUrl).toBe('https://www.tiktok.com/@noon/video/7301234567890123456');
  });
});

describe('resolver reuse of discovered ads', () => {
  it('uses the discovered video once at no cost, then asks the actor again', async () => {
    const fetchImpl = vi.fn(async () => Response.json([]));
    const r = apifyResolver({ token: 't', tiktokActorId: 'clockworks~tiktok-scraper', creativeCenterActorId: 'cc', fetchImpl: fetchImpl as unknown as typeof fetch }, 0.005);
    const store = new MemoryStore();
    const item = store.addItem(store.addRun().id, {
      source: 'tiktok_creative_center', external_id: '7301234567890123456',
      raw_json: { discovered: { material_id: '7301234567890123456', videoUrl: 'https://cdn.test/v.mp4', brand_name: 'Shein', ctr: 0.02 } },
    });
    const media = await r.resolve(item);
    expect(media).toMatchObject({ videoUrl: 'https://cdn.test/v.mp4', advertiser: 'Shein', costUsd: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(r.resolve(item)).rejects.toThrow(/no video/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
