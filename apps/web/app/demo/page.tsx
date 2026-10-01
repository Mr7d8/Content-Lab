import type { Metadata } from 'next';
import Link from 'next/link';
import { ReplayRun } from '@/components/run/replay-run';
import { demoRunView } from '@/lib/demo-data';

export const metadata: Metadata = { title: 'Content Lab · Synthetic rehearsal' };

// Public on purpose: synthetic data only, so the animated views can be
// rehearsed and recorded before any key or real run exists.
export default function DemoPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 pt-6">
      <div className="mb-4 flex items-center justify-between text-xs text-sub">
        <span className="font-semibold text-ink">Content Lab</span>
        <Link href="/login" className="text-accent">Sign in</Link>
      </div>
      <ReplayRun view={demoRunView()} title="Synthetic rehearsal" footnote="Synthetic data with fictional advertisers, not a real analysis. No API calls." />
    </div>
  );
}
