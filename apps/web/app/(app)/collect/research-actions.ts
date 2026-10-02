'use server';

import { candidateCount, discoveryCost, estimateRun, formatUsd, sweepRunCap } from '@content-lab/core';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { CADENCES, parseWatchlistForm } from '@/lib/watchlists';
import { startWorker } from '@/lib/worker';

export type FormState = { ok: boolean; message: string };

async function signedIn() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return data.user ? supabase : null;
}

// Runs one watchlist now, under the same caps as the daily sweep.
export async function researchNow(watchlistId: string): Promise<string> {
  const supabase = await signedIn();
  if (!supabase) return 'Sign in first.';
  const [{ data: w }, { data: settings }, { data: spend }] = await Promise.all([
    supabase.from('watchlists').select('*').eq('id', watchlistId).maybeSingle(),
    supabase.from('app_settings').select('*').maybeSingle(),
    supabase.rpc('month_spend_usd'),
  ]);
  if (!w) return 'Watchlist not found.';
  if (!settings) return 'Research settings are missing: run the research mode migration first.';

  // A run that has not reported for 75 minutes was left behind by a timed-out worker.
  const recent = new Date(Date.now() - 75 * 60_000).toISOString();
  const { data: open } = await supabase.from('runs').select('id, status, started_at, created_at').eq('watchlist_id', w.id)
    .in('status', ['queued', 'running']).gt('updated_at', recent).limit(1);
  const current = open?.[0];
  if (current) {
    // Queued for over two minutes and never picked up: the worker failed on
    // Apify before starting, so start it again for the same run.
    const stuck = current.status === 'queued' && !current.started_at && Date.now() - Date.parse(current.created_at) > 2 * 60_000;
    if (!stuck) return `"${w.name}" is already being searched.`;
    const message = await startWorker(supabase, current.id);
    revalidatePath('/collect');
    return `Restarted the search for "${w.name}". ${message}`;
  }

  const monthSpend = Number(spend ?? 0);
  const cap = sweepRunCap(settings, monthSpend);
  const search = discoveryCost(candidateCount(w.max_items));
  if (cap < search + estimateRun(1).total) {
    return `This month's budget is used (${formatUsd(monthSpend)} of ${formatUsd(Number(settings.monthly_spend_cap_usd))}). Raise the monthly cap to research more.`;
  }
  const { data: run, error } = await supabase.from('runs').insert({
    source: w.source,
    watchlist_id: w.id,
    trigger: 'manual',
    spend_cap_usd: cap,
    cost_estimate_usd: Number((search + estimateRun(w.max_items).total).toFixed(4)),
  }).select('id').single();
  if (error) return `Could not create the run: ${error.message}`;
  const message = await startWorker(supabase, run.id);
  revalidatePath('/collect');
  return `Searching "${w.name}". ${message}`;
}

export async function updateWatchlist(
  id: string,
  patch: { active?: boolean; refresh_cadence?: string; max_items?: number },
): Promise<string | null> {
  const supabase = await signedIn();
  if (!supabase) return 'Sign in first.';
  if (patch.refresh_cadence !== undefined && !(CADENCES as readonly string[]).includes(patch.refresh_cadence)) return 'Unknown schedule.';
  if (patch.max_items !== undefined && !(Number.isInteger(patch.max_items) && patch.max_items >= 1 && patch.max_items <= 50)) {
    return 'Ads per sweep must be between 1 and 50.';
  }
  // Only these fields, whatever the client sent.
  const { active, refresh_cadence, max_items } = patch;
  const { error } = await supabase.from('watchlists').update({ active, refresh_cadence, max_items }).eq('id', id);
  revalidatePath('/collect');
  return error ? error.message : null;
}

export async function deleteWatchlist(id: string): Promise<string | null> {
  const supabase = await signedIn();
  if (!supabase) return 'Sign in first.';
  // Past runs and the ads they collected stay; they just lose the link.
  const { error } = await supabase.from('watchlists').delete().eq('id', id);
  revalidatePath('/collect');
  return error ? error.message : null;
}

export async function addWatchlist(_prev: FormState, formData: FormData): Promise<FormState> {
  const supabase = await signedIn();
  if (!supabase) return { ok: false, message: 'Sign in first.' };
  const parsed = parseWatchlistForm((name) => {
    const v = formData.get(name);
    return typeof v === 'string' ? v : null;
  });
  if (!parsed.ok) return parsed;
  const { error } = await supabase.from('watchlists').insert(parsed.row);
  if (error) return { ok: false, message: error.code === '23505' ? 'That watchlist already exists.' : error.message };
  revalidatePath('/collect');
  return { ok: true, message: `Added "${parsed.row.name}". It runs at the next daily sweep, or now with Research now.` };
}

export async function saveResearchSettings(_prev: FormState, formData: FormData): Promise<FormState> {
  const supabase = await signedIn();
  if (!supabase) return { ok: false, message: 'Sign in first.' };
  const monthly = Number(formData.get('monthly_spend_cap_usd'));
  const sweep = Number(formData.get('sweep_spend_cap_usd'));
  if (!Number.isFinite(monthly) || monthly < 0 || monthly > 1000) return { ok: false, message: 'Monthly cap must be between $0 and $1,000.' };
  if (!Number.isFinite(sweep) || sweep <= 0 || sweep > 100) return { ok: false, message: 'Per-sweep cap must be above $0 and at most $100.' };
  const { error } = await supabase.from('app_settings').update({
    monthly_spend_cap_usd: monthly,
    sweep_spend_cap_usd: sweep,
    sweeps_enabled: formData.get('sweeps_enabled') === 'on',
  }).eq('id', true);
  if (error) return { ok: false, message: error.message };
  revalidatePath('/collect');
  return { ok: true, message: 'Saved.' };
}
