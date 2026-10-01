const COLORS: Record<string, string> = {
  queued: 'var(--faint)',
  pending: 'var(--faint)',
  running: 'var(--accent)',
  paused: 'var(--orange)',
  partial: 'var(--orange)',
  needs_review: 'var(--orange)',
  completed: 'var(--green)',
  done: 'var(--green)',
  failed: 'var(--red)',
  cancelled: 'var(--faint)',
  skipped: 'var(--faint)',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className="badge" style={{ background: COLORS[status] ?? 'var(--faint)' }}>
      {status.replaceAll('_', ' ')}
    </span>
  );
}
