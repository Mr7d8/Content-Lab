'use server';

import { estimateRun, type SourceId } from '@content-lab/core';
import { revalidatePath } from 'next/cache';
import { prepareLinks, type RejectedLink } from '@/lib/import';
import { createClient } from '@/lib/supabase/server';
import { startWorker } from '@/lib/worker';

export type ImportState = {
  ok: boolean;
  message: string;
  runId?: string;
  rejected?: RejectedLink[];
};

export async function createImportRun(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, message: 'Sign in first.' };

  const cap = Number(formData.get('spend_cap_usd'));
  if (!Number.isFinite(cap) || cap <= 0) return { ok: false, message: 'Set a spend cap above $0.' };

  const { accepted, rejected } = await prepareLinks(String(formData.get('links') ?? ''));
  if (!accepted.length) return { ok: false, message: 'No supported links to import.', rejected };

  const now = new Date().toISOString();
  const { error: upsertError } = await supabase.from('items').upsert(
    accepted.map((link) => ({
      source: link.source,
      source_url: link.url,
      external_id: link.externalId,
      account_handle: link.handle,
      region: link.region,
      collected_at: now,
      raw_json: { imported_from: link.input },
    })),
    { onConflict: 'source,external_id', ignoreDuplicates: true },
  );
  if (upsertError) return { ok: false, message: `Could not save items: ${upsertError.message}`, rejected };

  // Look up ids for every accepted link, including ones collected before.
  const bySource = new Map<SourceId, string[]>();
  for (const link of accepted) bySource.set(link.source, [...(bySource.get(link.source) ?? []), link.externalId]);
  const idByKey = new Map<string, string>();
  for (const [source, externalIds] of bySource) {
    const { data, error } = await supabase.from('items').select('id, external_id').eq('source', source).in('external_id', externalIds);
    if (error) return { ok: false, message: `Could not read items: ${error.message}`, rejected };
    for (const row of data) idByKey.set(`${source}:${row.external_id}`, row.id);
  }

  const estimate = estimateRun(accepted.length);
  const { data: run, error: runError } = await supabase
    .from('runs')
    .insert({
      source: 'manual_import',
      status: 'queued',
      items_requested: accepted.length,
      cost_estimate_usd: Number(estimate.total.toFixed(4)),
      spend_cap_usd: cap,
    })
    .select('id')
    .single();
  if (runError) return { ok: false, message: `Could not create the run: ${runError.message}`, rejected };

  const { error: linkError } = await supabase.from('run_items').insert(
    accepted.flatMap((link, position) => {
      const itemId = idByKey.get(`${link.source}:${link.externalId}`);
      return itemId ? [{ run_id: run.id, item_id: itemId, position }] : [];
    }),
  );
  if (linkError) return { ok: false, message: `Could not queue items: ${linkError.message}`, rejected };

  const workerMessage = await startWorker(supabase, run.id);
  revalidatePath('/collect');
  return {
    ok: true,
    runId: run.id,
    message: `Run created with ${accepted.length} item${accepted.length === 1 ? '' : 's'}. ${workerMessage}`,
    rejected,
  };
}

export async function pauseRun(runId: string): Promise<void> {
  const supabase = await createClient();
  await supabase.from('runs').update({ pause_requested: true }).eq('id', runId);
  revalidatePath('/collect');
}

export async function resumeRun(runId: string): Promise<string> {
  const supabase = await createClient();
  const { data: run, error: readError } = await supabase.from('runs').select('status').eq('id', runId).single();
  if (readError) return readError.message;
  if (run.status === 'running') {
    // The worker has not reached its pause point yet: cancel the pause instead of starting a second worker.
    await supabase.from('runs').update({ pause_requested: false }).eq('id', runId);
    revalidatePath('/collect');
    return 'Pause cancelled; the worker keeps going.';
  }
  if (!['queued', 'paused', 'partial', 'failed'].includes(run.status)) return 'This run has nothing left to resume.';
  const { error } = await supabase.from('runs').update({ pause_requested: false, status: 'queued', error: null }).eq('id', runId);
  if (error) return error.message;
  const message = await startWorker(supabase, runId);
  revalidatePath('/collect');
  return message;
}
