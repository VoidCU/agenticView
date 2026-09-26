import { create } from "zustand";

/**
 * Walk mode state.
 * Canvas adds the TopBar 'Walk' button and V key that call setWalking.
 * The scene reads this to swap between overview and first-person camera.
 */
export interface WalkState {
  walking: boolean;
  /** Where the player stood when walk mode last ended (the 'You' robot walks home from here). */
  exitAt?: { x: number; z: number; at: number };
  setWalking(b: boolean): void;
  setExitAt(p: { x: number; z: number }): void;
}

export const useWalk = create<WalkState>((set) => ({
  walking: false,
  exitAt: undefined,
  setWalking: (walking) => set({ walking }),
  setExitAt: (p) => set({ exitAt: { ...p, at: Date.now() } }),
}));
