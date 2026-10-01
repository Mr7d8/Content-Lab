'use server';

import { FILTER_DIMENSIONS, type Json } from '@content-lab/core';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export type CorrectionState = { ok: boolean; message: string };

// Stores human corrections next to the model output (never over it), for
// review and later use as few-shot examples.
export async function saveCorrections(_prev: CorrectionState, formData: FormData): Promise<CorrectionState> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, message: 'Sign in first.' };
  const classificationId = String(formData.get('classification_id') ?? '');
  const itemId = String(formData.get('item_id') ?? '');

  const { data: current, error: readError } = await supabase.from('classifications').select('labels_json').eq('id', classificationId).single();
  if (readError) return { ok: false, message: readError.message };
  const model = current.labels_json as Record<string, unknown>;

  const corrections: Record<string, string | null> = {};
  for (const [field, dim] of Object.entries(FILTER_DIMENSIONS)) {
    const raw = formData.get(field);
    if (raw === null) continue;
    const value = raw === 'unknown' ? null : String(raw);
    if (value !== null && !Object.hasOwn(dim.options, value)) return { ok: false, message: `Invalid value for ${dim.title}` };
    if (value !== model[field]) corrections[field] = value;
  }

  const { error } = await supabase
    .from('classifications')
    .update({ corrections_json: corrections as Json, reviewed_by: auth.user.id, reviewed_at: new Date().toISOString(), needs_review: false })
    .eq('id', classificationId);
  if (error) return { ok: false, message: error.message };
  revalidatePath(`/library/${itemId}`);
  revalidatePath('/library');
  const n = Object.keys(corrections).length;
  return { ok: true, message: n ? `Saved ${n} correction${n === 1 ? '' : 's'}.` : 'Marked as reviewed, no corrections.' };
}
