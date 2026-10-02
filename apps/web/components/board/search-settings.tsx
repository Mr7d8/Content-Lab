'use client';

import type { Tables } from '@content-lab/core';
import { useState } from 'react';
import type { BoardPatch } from '@/app/(app)/b/actions';

const TERM_TYPES = ['keyword', 'advertiser', 'hashtag', 'account'];

// Board settings for what a board searches: its terms, and the Moroccan gate.
export function SearchSettings({ board, pending, save }: { board: Tables<'watchlists'>; pending: boolean; save: (patch: BoardPatch) => void }) {
  const [terms, setTerms] = useState(board.value);
  const editable = TERM_TYPES.includes(board.type);
  return (
    <>
      {editable && (
        <form
          className="space-y-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (terms.trim() && terms !== board.value) save({ value: terms });
          }}
        >
          <p className="mono text-faint">Search terms</p>
          <textarea className="field min-h-[72px] resize-y text-[13px]" value={terms} maxLength={700} rows={3} onChange={(e) => setTerms(e.target.value)} dir="auto" aria-label="Search terms" />
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-faint">Up to 10, separated by commas. Used from the next scan.</p>
            <button type="submit" className="btn-secondary !px-3" disabled={pending || !terms.trim() || terms === board.value}>Save</button>
          </div>
        </form>
      )}
      <label className="flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
          checked={board.moroccan_only}
          disabled={pending}
          onChange={(e) => save({ moroccan_only: e.target.checked })}
        />
        <span className="min-w-0">
          <span className="block text-[13px] font-semibold tracking-tight">Moroccan ads only</span>
          <span className="block text-[11.5px] leading-snug text-sub">Leaves out ads made for other countries and checks the unclear ones. Applies from the next scan.</span>
        </span>
      </label>
    </>
  );
}
