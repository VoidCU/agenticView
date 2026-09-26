import { create } from "zustand";

/**
 * Walk mode state.
 * Canvas adds the TopBar 'Walk' button and V key that call setWalking.
 * The scene reads this to swap between overview and first-person camera.
 */
export interface WalkState {
  walking: boolean;
  setWalking(b: boolean): void;
}

export const useWalk = create<WalkState>((set) => ({
  walking: false,
  setWalking: (walking) => set({ walking }),
}));
