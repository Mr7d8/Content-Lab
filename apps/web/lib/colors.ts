import type { BeatRole } from '@content-lab/core';

// Categorical colors for script beats, kept apart from the state colors.
export const BEAT_COLORS: Record<BeatRole, string> = {
  hook: '#0a84ff',
  setup: '#8e8e93',
  demo: '#30b0c7',
  proof: '#5e5ce6',
  offer: '#ff9f0a',
  cta: '#bf5af2',
  other: '#c7c7cc',
};
