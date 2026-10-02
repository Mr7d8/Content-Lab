import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULT_RATES, fitsUnderCap, type Json, type Rates } from '@content-lab/core';
import { ProviderError, type AIProviders } from '@content-lab/core/ai';
import { discoverForRun, type Discoverer } from './discover';
import type { MediaResolver } from './resolve';
import { audioPath, exists, ITEM_STAGES, LocalFilesMissing, type Stage, type StageContext, type StageHandler, videoPath } from './stages';
import type { RunItemWithItem, RunRow, Store } from './store';

export type RunnerDeps = {
  store: Store;
  resolver: MediaResolver;
  // Finds a watchlist's top ads; needed for watchlist runs only.
  discoverer?: Discoverer;
  ai: Partial<AIProviders>;
  handlers: Partial<Record<Stage, StageHandler>>;
  tmpRoot: string;
  rates?: Rates;
  log?: (message: string) => void;
  now?: () => string;
};

export type RunOutcome = 'not_claimable' | 'completed' | 'partial' | 'paused' | 'failed';

class StopRun extends Error {}

type LogEntry = { stage: string; status: string; at: string; error?: string };

// Paid cost still ahead for an item, from the stage it is at.
export function remainingItemCost(stage: string, rates: Rates, resolverCost: number): number {
  const jev = (rates.jevTokensPerItem / 1_000_000) * rates.jevPerMillionInputTokensUsd;
  switch (stage) {
    case 'fetch':
      return resolverCost + rates.workerPerItemUsd + jev;
    case 'extract':
      return rates.workerPerItemUsd + jev;
    case 'done':
      return 0;
    default:
      return jev;
  }
}

export async function runPipeline(runId: string, deps: RunnerDeps): Promise<RunOutcome> {
  const { store, resolver, handlers, tmpRoot } = deps;
  const rates = deps.rates ?? DEFAULT_RATES;
  const log = deps.log ?? ((m: string) => console.log(m));
  const now = deps.now ?? (() => new Date().toISOString());

  const claimed = await store.claimRun(runId, now());
  if (!claimed) {
    log(`Run ${runId} is already running or finished; nothing to do.`);
    return 'not_claimable';
  }
  let run: RunRow = claimed;
  let spent = Number(run.cost_actual_usd);
  let done = 0;
  let failed = 0;
  let stopReason: { status: 'paused' | 'failed'; error: string | null } | null = null;
  let items = await store.listRunItems(runId);
  // A watchlist run starts empty: find its ads first.
  if (run.watchlist_id && items.length === 0) {
    const found = await discoverForRun(run, spent, { store, discoverer: deps.discoverer, log, now });
    spent = found.spent;
    if (found.ok) items = await store.listRunItems(runId);
    else stopReason = { status: found.status, error: found.error };
  }
  log(`Run ${runId}: ${items.length} items, cap $${run.spend_cap_usd}, spent so far $${spent.toFixed(4)}`);

  for (const ri of items) {
    if (ri.status === 'done' || ri.status === 'skipped') done++;
    else if (ri.status === 'needs_review' || ri.status === 'failed') failed++;
  }

  for (const [index, runItem] of items.entries()) {
    if (runItem.status === 'done' || runItem.status === 'skipped') continue;

    run = await store.getRun(runId);
    if (run.pause_requested) {
      stopReason = { status: 'paused', error: null };
      break;
    }
    const nextCost = remainingItemCost(runItem.stage, rates, resolver.costPerItemUsd);
    if (!fitsUnderCap(spent, nextCost, Number(run.spend_cap_usd))) {
      stopReason = { status: 'paused', error: `Spend cap reached ($${Number(run.spend_cap_usd).toFixed(2)}). Raise the cap to continue.` };
      break;
    }

    // Resolve the next few links in one Apify call, as far as the cap allows.
    if (runItem.stage === 'fetch') {
      const budget = Number(run.spend_cap_usd) - spent;
      const perItem = remainingItemCost('fetch', rates, resolver.costPerItemUsd);
      const room = Math.max(1, Math.floor(budget / perItem));
      const batch = items.slice(index).filter((ri) => ri.stage === 'fetch' && ri.status !== 'done').slice(0, Math.min(10, room));
      try {
        await resolver.prefetch(batch.map((ri) => ri.item));
      } catch (error) {
        log(`Prefetch failed, items will resolve one by one: ${(error as Error).message}`);
      }
    }

    try {
      const wasFailed = runItem.status === 'needs_review' || runItem.status === 'failed';
      const result = await processItem(runItem, run, spent, { ...deps, rates, log, now });
      spent = result.spent;
      if (wasFailed) failed--;
      if (result.status === 'done') done++;
      else failed++;
      await store.updateRun(runId, { items_done: done, items_failed: failed, cost_actual_usd: Number(spent.toFixed(4)) });
    } catch (error) {
      if (error instanceof StopRun) {
        stopReason = { status: 'failed', error: error.message };
        break;
      }
      throw error;
    }
  }

  const outcome: RunOutcome = stopReason?.status ?? (failed ? 'partial' : 'completed');
  await store.updateRun(runId, {
    status: outcome,
    items_done: done,
    items_failed: failed,
    cost_actual_usd: Number(spent.toFixed(4)),
    finished_at: outcome === 'paused' ? null : now(),
    pause_requested: false,
    error: stopReason?.error ?? null,
  });
  log(`Run ${runId} ${outcome}: ${done} done, ${failed} need review, $${spent.toFixed(4)} spent`);
  return outcome;
}

async function processItem(
  runItem: RunItemWithItem,
  run: RunRow,
  spentBefore: number,
  deps: Required<Omit<RunnerDeps, 'rates' | 'log' | 'now' | 'discoverer'>> & { rates: Rates; log: (m: string) => void; now: () => string },
): Promise<{ spent: number; status: 'done' | 'needs_review' }> {
  const { store, handlers } = deps;
  const item = runItem.item;
  const workDir = join(deps.tmpRoot, item.id);
  const stageLog = (Array.isArray(runItem.stage_log) ? runItem.stage_log : []) as LogEntry[];
  let itemCost = Number(runItem.cost_usd);
  let spent = spentBefore;
  let attempts = runItem.attempts;
  let restartedAtFetch = false;

  let start = ITEM_STAGES.indexOf(runItem.stage as Stage);
  if (start < 0) start = 0;
  // A fresh container has no local video or audio: restart at fetch.
  if ((runItem.stage === 'extract' && !(await exists(videoPath(workDir)))) || (runItem.stage === 'transcribe' && !(await exists(audioPath(workDir))))) {
    start = 0;
  }

  await store.updateRunItem(run.id, item.id, { status: 'running', stage: ITEM_STAGES[start], error: null });

  const ctx: StageContext = {
    run,
    item,
    workDir,
    store,
    resolver: deps.resolver,
    ai: deps.ai,
    rates: deps.rates,
    addCost: (usd) => {
      itemCost += usd;
      spent += usd;
    },
    log: (message) => deps.log(`[${item.external_id}] ${message}`),
    now: deps.now,
  };

  const persistProgress = () => store.updateRun(run.id, { cost_actual_usd: Number(spent.toFixed(4)) });

  for (let i = start; i < ITEM_STAGES.length; i++) {
    const stage = ITEM_STAGES[i] as Stage;
    const handler = handlers[stage];
    if (!handler) continue;
    let tries = 0;
    for (;;) {
      try {
        await handler(ctx);
        stageLog.push({ stage, status: 'done', at: deps.now() });
        await store.updateRunItem(run.id, item.id, {
          stage: (ITEM_STAGES[i + 1] ?? 'done') as Stage | 'done',
          stage_log: stageLog as unknown as Json,
          cost_usd: Number(itemCost.toFixed(4)),
          attempts,
        });
        await persistProgress();
        break;
      } catch (error) {
        if (error instanceof ProviderError && error.stopsRun) {
          await store.updateRunItem(run.id, item.id, { status: 'pending', error: error.message });
          throw new StopRun(error.message);
        }
        if (error instanceof LocalFilesMissing && !restartedAtFetch) {
          restartedAtFetch = true;
          ctx.log(error.message);
          i = -1; // the outer loop increments back to fetch
          break;
        }
        if (tries === 0) {
          tries++;
          attempts++;
          ctx.log(`${stage} failed, retrying once: ${(error as Error).message}`);
          continue;
        }
        const message = (error as Error).message;
        stageLog.push({ stage, status: 'failed', at: deps.now(), error: message });
        await store.updateRunItem(run.id, item.id, {
          stage,
          status: 'needs_review',
          error: message,
          attempts,
          stage_log: stageLog as unknown as Json,
          cost_usd: Number(itemCost.toFixed(4)),
        });
        await persistProgress();
        await rm(workDir, { recursive: true, force: true });
        ctx.log(`needs review: ${message}`);
        return { spent, status: 'needs_review' };
      }
    }
  }

  await store.updateRunItem(run.id, item.id, { stage: 'done', status: 'done', error: null });
  await rm(workDir, { recursive: true, force: true });
  return { spent, status: 'done' };
}
