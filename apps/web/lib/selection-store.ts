'use client';

import { create } from 'zustand';

export type LabelFilter = { field: string; value: string } | null;

// One selection shared by the wall and the map: hovering or filtering on one
// highlights the same items in the other.
type SelectionState = {
  hovered: string | null;
  filter: LabelFilter;
  setHovered: (id: string | null) => void;
  toggleFilter: (filter: Exclude<LabelFilter, null>) => void;
  clear: () => void;
};

export const useSelection = create<SelectionState>((set) => ({
  hovered: null,
  filter: null,
  setHovered: (hovered) => set({ hovered }),
  toggleFilter: (filter) =>
    set((s) => ({ filter: s.filter && s.filter.field === filter.field && s.filter.value === filter.value ? null : filter })),
  clear: () => set({ hovered: null, filter: null }),
}));
