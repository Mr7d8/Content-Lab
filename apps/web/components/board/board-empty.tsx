'use client';

import { MotionConfig } from 'motion/react';
import { useState } from 'react';
import { NewBoardDialog } from './new-board';
import { TopBar } from './top-bar';

// No boards yet: one call to action.
export function BoardEmpty({ access }: { access: { pending: number } | null }) {
  const [creating, setCreating] = useState(false);
  return (
    <MotionConfig reducedMotion="user">
      <TopBar boards={[]} currentId={null} spend={null} access={access} onNew={() => setCreating(true)} />
      <main className="mx-auto flex min-h-[70vh] max-w-2xl flex-col items-start justify-center px-4">
        <p className="mono text-faint">Content Lab</p>
        <h1 className="mt-3 text-[40px] font-semibold leading-[1.04] tracking-[-0.035em] sm:text-[56px]">
          <span className="text-faint">Decode </span>the ads that win<span className="text-accent">.</span>
        </h1>
        <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-sub">
          A board watches one search: top ads for a country, an advertiser or a keyword. A scan pulls the ads and their numbers in about a minute.
          Decode the ones you care about to see the hook, the script and why they work.
        </p>
        <button type="button" className="btn-primary mt-6 !px-5 !py-2.5" onClick={() => setCreating(true)}>Create your first board</button>
      </main>
      <NewBoardDialog open={creating} onClose={() => setCreating(false)} />
    </MotionConfig>
  );
}
