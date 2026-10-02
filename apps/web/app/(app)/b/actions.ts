'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { MAX_SCAN_ADS } from '@content-lab/core';
import { CADENCES, parseWatchlistForm, PERIODS } from '@/lib/watchlists';

export type ActionResult = { ok: true; id?: string } | { ok: false; message: string };

async function signedIn() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return data.user ? supabase : null;
}

// New board from the New board dialog. The client starts its first scan.
export async function createBoard(formData: FormData): Promise<ActionResult> {
  const supabase = await signedIn();
  if (!supabase) return { ok: false, message: 'Sign in first.' };
  const parsed = parseWatchlistForm((name) => {
    const v = formData.get(name);
    return typeof v === 'string' ? v : null;
  });
  if (!parsed.ok) return parsed;
  const { data, error } = await supabase.from('watchlists').insert(parsed.row).select('id').single();
  if (error) return { ok: false, message: error.code === '23505' ? 'A board with this search already exists.' : error.message };
  revalidatePath('/b', 'layout');
  return { ok: true, id: data.id };
}

export async function updateBoard(id: string, patch: { refresh_cadence?: string; max_items?: number; period_days?: number; name?: string }): Promise<ActionResult> {
  const supabase = await signedIn();
  if (!supabase) return { ok: false, message: 'Sign in first.' };
  const { refresh_cadence, max_items, period_days } = patch;
  const name = patch.name?.trim().slice(0, 80);
  if (refresh_cadence !== undefined && !(CADENCES as readonly string[]).includes(refresh_cadence)) return { ok: false, message: 'Unknown schedule.' };
  if (max_items !== undefined && !(Number.isInteger(max_items) && max_items >= 1 && max_items <= MAX_SCAN_ADS)) return { ok: false, message: `Ads per scan must be between 1 and ${MAX_SCAN_ADS}.` };
  if (period_days !== undefined && !(PERIODS as readonly number[]).includes(period_days)) return { ok: false, message: 'Pick 7, 30 or 180 days.' };
  if (patch.name !== undefined && !name) return { ok: false, message: 'Give the board a name.' };
  const { error } = await supabase.from('watchlists').update({ refresh_cadence, max_items, period_days, name }).eq('id', id);
  revalidatePath('/b', 'layout');
  return error ? { ok: false, message: error.message } : { ok: true };
}

// Ads stay in the database (and on other boards); only the board goes.
export async function deleteBoard(id: string): Promise<ActionResult> {
  const supabase = await signedIn();
  if (!supabase) return { ok: false, message: 'Sign in first.' };
  const { error } = await supabase.from('watchlists').delete().eq('id', id);
  revalidatePath('/b', 'layout');
  return error ? { ok: false, message: error.message } : { ok: true };
}

export async function saveBudget(monthlyCapUsd: number, sweepsEnabled: boolean): Promise<ActionResult> {
  const supabase = await signedIn();
  if (!supabase) return { ok: false, message: 'Sign in first.' };
  if (!Number.isFinite(monthlyCapUsd) || monthlyCapUsd < 0 || monthlyCapUsd > 1000) return { ok: false, message: 'Monthly cap must be between $0 and $1,000.' };
  const { error } = await supabase.from('app_settings').update({ monthly_spend_cap_usd: monthlyCapUsd, sweeps_enabled: sweepsEnabled }).eq('id', true);
  revalidatePath('/b', 'layout');
  return error ? { ok: false, message: error.message } : { ok: true };
}
