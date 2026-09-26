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
  /** A modal (e.g. RPS) took the mouse: pointer lock was released on purpose, so stay in walk mode. */
  paused: boolean;
  /** The walk camera currently holds pointer lock (mouse-look on). False before the first click and after an overlay freed the mouse. */
  locked: boolean;
  setLocked(b: boolean): void;
  setPaused(b: boolean): void;
  setWalking(b: boolean): void;
  setExitAt(p: { x: number; z: number }): void;
}

export const useWalk = create<WalkState>((set) => ({
  walking: false,
  exitAt: undefined,
  paused: false,
  locked: false,
  setLocked: (locked) => set({ locked }),
  setPaused: (paused) => set({ paused }),
  setWalking: (walking) => set(walking ? { walking } : { walking, paused: false, locked: false }),
  setExitAt: (p) => set({ exitAt: { ...p, at: Date.now() } }),
}));
