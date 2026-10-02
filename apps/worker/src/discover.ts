import {
  candidateCount,
  creativeCenterCandidate,
  creativeCenterInput,
  creativeCenterNotes,
  discoveryCost,
  expandRegion,
  fitsUnderCap,
  lookbackDays,
  organicCandidate,
  OPTIONAL_CREATIVE_CENTER_FIELDS,
  organicInput,
  pickTop,
  type Candidate,
  type Json,
  type TablesInsert,
} from '@content-lab/core';
import { ProviderError } from '@content-lab/core/ai';
import { runActorSync, type ApifyEnv } from './resolve';
import type { RunRow, Store, WatchlistRow } from './store';

// Finds a watchlist's top ads at its source. Notes say what the search could
// not filter on.
export interface Discoverer {
  discover(watchlist: WatchlistRow): Promise<{ candidates: Candidate[]; costUsd: number; notes?: string[] }>;
}

const notNull = <T>(v: T | null): v is T => v !== null;

// "Input is not valid: Field input.objective must be ..." names the field.
export function rejectedInputField(error: unknown): string | null {
  if (!(error instanceof ProviderError) || error.status !== 400) return null;
  return error.message.match(/Field input\.([A-Za-z]+)/)?.[1] ?? null;
}

export function apifyDiscoverer(env: ApifyEnv): Discoverer {
  return {
    async discover(w) {
      if (w.source === 'tiktok_creative_center') {
        const actorId = env.creativeCenterActorId;
        if (!actorId) throw new Error('Creative Center watchlists need APIFY_CREATIVE_CENTER_ACTOR_ID');
        // Search without an optional filter the actor rejects, rather than not at all.
        const input = creativeCenterInput(w);
        const dropped: string[] = [];
        for (;;) {
          try {
            const rows = await runActorSync(env, actorId, input);
            return {
              candidates: rows.map(creativeCenterCandidate).filter(notNull),
              costUsd: discoveryCost(rows.length),
              notes: creativeCenterNotes(w, dropped),
            };
          } catch (error) {
            const field = rejectedInputField(error);
            if (!field || !(OPTIONAL_CREATIVE_CENTER_FIELDS as readonly string[]).includes(field) || !(field in input)) throw error;
            delete input[field];
            dropped.push(field);
          }
        }
      }
      if (w.source === 'tiktok_organic') {
        const rows = await runActorSync(env, env.tiktokActorId, organicInput(w));
        return { candidates: rows.map(organicCandidate).filter(notNull), costUsd: discoveryCost(rows.length) };
      }
      throw new Error(`Watchlists of source ${w.source} cannot be swept yet`);
    },
  };
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

// The item row for an ad kept by discovery. The actor's row stays in
// raw_json.discovered, so the fetch stage can reuse its video URL.
export function itemFromCandidate(c: Candidate, w: WatchlistRow): TablesInsert<'items'> {
  const countries = expandRegion(w.region);
  const author = c.raw.authorMeta && typeof c.raw.authorMeta === 'object' ? (c.raw.authorMeta as Record<string, unknown>) : {};
  return {
    source: c.source,
    source_url: c.sourceUrl,
    external_id: c.externalId,
    advertiser: w.type === 'advertiser' ? w.value : null,
    account_handle: str(author.name),
    region: countries?.length === 1 ? (countries[0] as string) : null,
    posted_at: c.postedAt,
    raw_json: { discovered: c.raw as Json, watchlist_id: w.id },
  };
}

export type DiscoveryResult =
  | { ok: true; spent: number; kept: number; note: string | null }
  | { ok: false; spent: number; status: 'paused' | 'failed'; error: string };

// First step of a watchlist run: find candidates, skip what the Library
// already has, and attach the best new ones to the run.
export async function discoverForRun(
  run: RunRow,
  spentBefore: number,
  deps: { store: Store; discoverer?: Discoverer; log: (m: string) => void; now: () => string },
): Promise<DiscoveryResult> {
  const { store, log } = deps;
  let spent = spentBefore;
  if (!deps.discoverer) return { ok: false, spent, status: 'failed', error: 'This worker cannot run watchlist sweeps' };
  const w = await store.getWatchlist(run.watchlist_id as string);
  const estimate = discoveryCost(candidateCount(w.max_items));
  if (!fitsUnderCap(spent, estimate, Number(run.spend_cap_usd))) {
    return { ok: false, spent, status: 'paused', error: `Spend cap too low to search this watchlist (needs about $${estimate.toFixed(2)})` };
  }

  let found: Awaited<ReturnType<Discoverer['discover']>>;
  try {
    found = await deps.discoverer.discover(w);
  } catch (error) {
    const message = (error as Error).message;
    const prefix = error instanceof ProviderError && error.stopsRun ? '' : 'Search failed: ';
    return { ok: false, spent, status: 'failed', error: `${prefix}${message}` };
  }
  spent += found.costUsd;

  const bySource = new Map<string, string[]>();
  for (const c of found.candidates) bySource.set(c.source, [...(bySource.get(c.source) ?? []), c.externalId]);
  const existing = new Set<string>();
  for (const [source, ids] of bySource) for (const key of await store.existingItemKeys(source, ids)) existing.add(key);

  const notBefore = new Date(Date.parse(deps.now()) - lookbackDays(w.refresh_cadence) * 86_400_000);
  const kept = pickTop(found.candidates, existing, w.max_items, notBefore);
  const added = await store.addRunItems(run.id, kept.map((c) => itemFromCandidate(c, w)));
  await store.updateRun(run.id, { items_requested: added, cost_actual_usd: Number(spent.toFixed(4)) });
  await store.updateWatchlist(w.id, { last_swept_at: deps.now() });
  log(`Watchlist "${w.name}": ${found.candidates.length} found, ${existing.size} already collected, ${added} new kept`);
  const note = found.notes?.length ? found.notes.join('. ') : null;
  if (note) log(note);
  return { ok: true, spent, kept: added, note };
}
