import type { SCRIPT_ROLE } from '@content-lab/core';

// Categorical colors for script roles, kept apart from the state colors.
export const ROLE_COLORS: Record<keyof typeof SCRIPT_ROLE, string> = {
  hook: '#0a84ff',
  setup: '#8e8e93',
  demo: '#30b0c7',
  offer: '#ff9f0a',
  cta: '#bf5af2',
  other: '#c7c7cc',
};
