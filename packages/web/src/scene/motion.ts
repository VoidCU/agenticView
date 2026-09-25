import { create } from "zustand";

/** Live robot positions, written every frame by each robot; read by beams, confetti and the drag logic. */
export const livePositions = new Map<string, { x: number; z: number }>();

export function livePos(id: string, fallback?: { x: number; z: number }): { x: number; z: number } | undefined {
  return livePositions.get(id) ?? fallback;
}

/** Drag-to-reassign. The point is mutable (updated per pointer move); the rest is reactive. */
export const dragPoint = { x: 0, z: 0 };

interface DragState {
  /** Agent being held (pointer is down on it). */
  heldId?: string;
  /** True once the pointer moved far enough to be a drag rather than a click. */
  active: boolean;
  /** Space under the pointer while dragging. */
  overSpace?: string;
  /** Seat that would be taken on drop. */
  overSeat?: number;
  /** Time of the last drop, so the click that ends a drag does not also select. */
  droppedAt: number;
  set(p: Partial<Omit<DragState, "set">>): void;
}

export const useDrag = create<DragState>((set) => ({
  active: false,
  droppedAt: 0,
  set: (p) => set(p),
}));

/** Pending focus request from the HUD or a space click. */
interface FocusState {
  focus?: string;
  hoverSpace?: string;
  setFocus(id?: string): void;
  setHover(id?: string): void;
}

export const useFocus = create<FocusState>((set) => ({
  setFocus: (focus) => set({ focus }),
  setHover: (hoverSpace) => set({ hoverSpace }),
}));
