import { create } from "zustand";

/**
 * Mini-map open/closed state.
 * Canvas manages the M key shortcut in App.tsx and the MiniMap component.
 * Persistence to localStorage is handled inside the MiniMap component on mount.
 */
export interface MapState {
  open: boolean;
  toggle(): void;
  setOpen(v: boolean): void;
}

export const useMapOpen = create<MapState>((set) => ({
  open: true,
  toggle: () => set((s) => ({ open: !s.open })),
  setOpen: (open) => set({ open }),
}));
