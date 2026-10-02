import { candidateCount, DEFAULT_RATES, discoveryCost, dueWatchlists, estimateRun, sweepRunCap } from '@content-lab/core';
import { runPipeline, type RunnerDeps, type RunOutcome } from './runner';

// Stop starting new watchlists after this long, so the day's actor run ends
// well inside its one-hour timeout. Whatever is still due waits for tomorrow.
export const SWEEP_TIME_BUDGET_MS = 40 * 60_000;

export type SweepResult = { watchlist: string; runId: string; outcome: RunOutcome };

// Daily sweep (actor input { "mode": "sweep" }): finish scheduled runs that a
// timed-out actor left behind, then run every due watchlist, most overdue
// first, while the monthly budget and the time budget allow.
export async function runSweep(deps: RunnerDeps & { clock?: () => number }): Promise<SweepResult[]> {
  const { store } = deps;
  const log = deps.log ?? ((m: string) => console.log(m));
  const now = deps.now ?? (() => new Date().toISOString());
  const clock = deps.clock ?? Date.now;
  const started = clock();
  const results: SweepResult[] = [];

  const settings = await store.getSettings();
  if (!settings.sweeps_enabled) {
    log('Sweeps are turned off in Collect settings; nothing to do.');
    return results;
  }

  for (const run of await store.listStaleScheduledRuns(now())) {
    log(`Resuming run ${run.id}, left unfinished by an earlier sweep`);
    results.push({ watchlist: run.watchlist_id ?? '', runId: run.id, outcome: await runPipeline(run.id, deps) });
  }

  const due = dueWatchlists(await store.listActiveWatchlists(), new Date(now()));
  log(`${due.length} watchlist(s) due`);
  for (const w of due) {
    if (clock() - started > SWEEP_TIME_BUDGET_MS) {
      log('Time budget used; the remaining watchlists wait for the next sweep.');
      break;
    }
    const spend = await store.monthSpendUsd();
    const cap = sweepRunCap(settings, spend);
    const rates = deps.rates ?? DEFAULT_RATES;
    const search = discoveryCost(candidateCount(w.max_items));
    const estimate = search + estimateRun(w.max_items, rates).total;
    // Room for the search and at least one ad, or stop for the month.
    if (cap < search + estimateRun(1, rates).total) {
      log(`Monthly cap reached ($${spend.toFixed(2)} of $${Number(settings.monthly_spend_cap_usd).toFixed(2)}); no more sweeps this month.`);
      break;
    }
    const run = await store.createRun({
      source: w.source,
      watchlist_id: w.id,
      trigger: 'schedule',
      spend_cap_usd: cap,
      cost_estimate_usd: Number(estimate.toFixed(4)),
    });
    log(`Sweeping "${w.name}" (run ${run.id}, cap $${cap.toFixed(2)})`);
    results.push({ watchlist: w.name, runId: run.id, outcome: await runPipeline(run.id, deps) });
  }
  log(`Sweep done: ${results.map((r) => `${r.watchlist} ${r.outcome}`).join(', ') || 'nothing ran'}`);
  return results;
}
