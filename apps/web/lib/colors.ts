import type { BeatRole, SCRIPT_ROLE } from '@content-lab/core';

// Categorical colors for script roles, kept apart from the state colors.
export const ROLE_COLORS: Record<keyof typeof SCRIPT_ROLE, string> = {
  hook: '#0a84ff',
  setup: '#8e8e93',
  demo: '#30b0c7',
  offer: '#ff9f0a',
  cta: '#bf5af2',
  other: '#c7c7cc',
};

// The same roles for decoded beats, plus proof (reviews, results, numbers).
export const BEAT_COLORS: Record<BeatRole, string> = { ...ROLE_COLORS, proof: '#5e5ce6' };
