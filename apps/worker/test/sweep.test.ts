import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Candidate } from '@content-lab/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Discoverer } from '../src/discover';
import type { MediaResolver } from '../src/resolve';
import type { RunnerDeps } from '../src/runner';
import type { StageHandler } from '../src/stages';
import { runSweep, SWEEP_TIME_BUDGET_MS } from '../src/sweep';
import { MemoryStore } from './memory-store';

const NOW = '2026-10-02T06:00:00Z';
const daysAgo = (d: number) => new Date(Date.parse(NOW) - d * 86_400_000).toISOString();
const RATES = { apifyPerItemUsd: 0.005, workerPerItemUsd: 0.002, jevPerMillionInputTokensUsd: 0.042, jevTokensPerItem: 9000, groqPerItemUsd: 0, visionPerItemUsd: 0 };
const resolver: MediaResolver = { costPerItemUsd: 0.005, prefetch: async () => undefined, resolve: async () => { throw new Error('not used'); } };

let tmpRoot: string;
beforeEach(async () => { tmpRoot = await mkdtemp(join(tmpdir(), 'cl-sweep-')); });
afterEach(async () => { await rm(tmpRoot, { recursive: true, force: true }); });

let next = 20000000;
// Every search returns two new ads.
const discoverer: Discoverer = {
  discover: async () => ({
    candidates: [0, 1].map((): Candidate => {
      const id = String(next++);
      return { source: 'tiktok_creative_center', externalId: id, sourceUrl: `https://ads.tiktok.com/business/creativecenter/topads/${id}/`, rank: 1, tiebreak: 0, postedAt: null, raw: {} };
    }),
    costUsd: 0.02,
  }),
};

function deps(store: MemoryStore, extra: Partial<RunnerDeps & { clock: () => number }> = {}) {
  const fetch: StageHandler = async (ctx) => { ctx.addCost(0.01); };
  return { store, resolver, discoverer, ai: {}, handlers: { fetch }, tmpRoot, rates: RATES, log: () => undefined, now: () => NOW, ...extra };
}

describe('runSweep', () => {
  it('runs due watchlists, most overdue first, as scheduled runs under the sweep cap', async () => {
    const store = new MemoryStore();
    const weekly = store.addWatchlist({ name: 'Temu', last_swept_at: daysAgo(8) });
    const monthly = store.addWatchlist({ name: 'Morocco', type: 'industry', value: 'ecommerce', refresh_cadence: 'monthly', last_swept_at: daysAgo(40) });
    store.addWatchlist({ name: 'Fresh', last_swept_at: daysAgo(1) });
    store.addWatchlist({ name: 'Off', active: false });
    store.addWatchlist({ name: 'Manual', refresh_cadence: 'manual' });

    const results = await runSweep(deps(store));
    expect(results.map((r) => [r.watchlist, r.outcome])).toEqual([['Morocco', 'completed'], ['Temu', 'completed']]);
    const runs = [...store.runs.values()];
    expect(runs.map((r) => [r.watchlist_id, r.trigger, r.spend_cap_usd, r.items_done])).toEqual([
      [monthly.id, 'schedule', 0.5, 2],
      [weekly.id, 'schedule', 0.5, 2],
    ]);
    expect(store.watchlists.get(weekly.id)?.last_swept_at).toBe(NOW);
  });

  it('stops for the month once the monthly cap is used', async () => {
    const store = new MemoryStore();
    store.earlierSpend = 4.95;
    store.addWatchlist({ name: 'A' });
    store.addWatchlist({ name: 'B' });
    const results = await runSweep(deps(store));
    // $0.05 left: one sweep fits (search and two ads, $0.04), then the cap is reached.
    expect(results).toHaveLength(1);
    expect(store.runs.size).toBe(1);
    expect(Number([...store.runs.values()][0]?.spend_cap_usd)).toBeCloseTo(0.05);
  });

  it('stops starting watchlists after the time budget', async () => {
    const store = new MemoryStore();
    store.addWatchlist({ name: 'A' });
    store.addWatchlist({ name: 'B' });
    let t = 0;
    const clock = () => { const now = t; t += SWEEP_TIME_BUDGET_MS; return now; };
    const results = await runSweep(deps(store, { clock }));
    expect(results.map((r) => r.watchlist)).toEqual(['A']);
  });

  it('does nothing when sweeps are turned off', async () => {
    const store = new MemoryStore();
    store.settings.sweeps_enabled = false;
    store.addWatchlist();
    expect(await runSweep(deps(store))).toEqual([]);
    expect(store.runs.size).toBe(0);
  });

  it('finishes a scheduled run that a timed-out actor left behind', async () => {
    const store = new MemoryStore();
    const w = store.addWatchlist({ last_swept_at: daysAgo(1) });
    const left = store.addRun({ source: 'tiktok_creative_center', watchlist_id: w.id, trigger: 'schedule', status: 'running', updated_at: daysAgo(1) });
    store.addItem(left.id, { source: 'tiktok_creative_center', external_id: '30000001' }, { stage: 'fetch', status: 'running' });
    const results = await runSweep(deps(store));
    expect(results).toEqual([{ watchlist: w.id, runId: left.id, outcome: 'completed' }]);
    expect(store.runs.size).toBe(1);
  });
});
