'use client';

import { type ClassificationRecord, FILTER_DIMENSIONS, labelText } from '@content-lab/core';
import { useActionState } from 'react';
import { type CorrectionState, saveCorrections } from './actions';

const initial: CorrectionState = { ok: false, message: '' };

export function CorrectionForm({ classificationId, itemId, labels, modelLabels }: {
  classificationId: string;
  itemId: string;
  labels: ClassificationRecord;
  modelLabels: ClassificationRecord;
}) {
  const [state, action, pending] = useActionState(saveCorrections, initial);
  return (
    <form action={action} className="card space-y-3 p-4">
      <input type="hidden" name="classification_id" value={classificationId} />
      <input type="hidden" name="item_id" value={itemId} />
      <div>
        <p className="eyebrow">Review</p>
        <p className="text-xs text-sub">Correct a label if the model got it wrong. The model output is kept alongside.</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {Object.entries(FILTER_DIMENSIONS).map(([field, dim]) => {
          const key = field as keyof typeof FILTER_DIMENSIONS;
          const changed = labels[key] !== modelLabels[key];
          return (
            <label key={field} className="text-[11px] font-medium text-faint">
              {dim.title}{changed && <span className="text-accent"> (corrected)</span>}
              <select name={field} defaultValue={labels[key] ?? 'unknown'} className="field mt-1 !py-1.5 text-xs">
                {Object.keys(dim.options).map((value) => <option key={value} value={value}>{labelText(value)}</option>)}
                <option value="unknown">Unknown</option>
              </select>
            </label>
          );
        })}
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" className="btn-primary" disabled={pending}>{pending ? 'Saving...' : 'Save review'}</button>
        {state.message && <p className={`text-xs ${state.ok ? 'text-sub' : 'text-red'}`}>{state.message}</p>}
      </div>
    </form>
  );
}
