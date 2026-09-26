import { useEffect } from "react";
import { useWalk } from "./walk";

/**
 * Hand the mouse to an overlay (board, inbox, RPS, chat, any modal) opened while walking.
 *
 * If the walk camera holds pointer lock, release it and mark walk mode paused so the lock loss does
 * not end the walk (walk keys and mouse-look stop while unlocked). Returns a restore function for when
 * the overlay closes: it unpauses and, if still walking, tries to re-capture the mouse (browsers may
 * refuse without a fresh gesture; the walk hint then says to click the view, which re-locks as usual).
 * The restore function is idempotent.
 *
 * Every overlay that can open during walk mode must go through here (the shared Modal does, via
 * useWalkOverlay), so a new overlay cannot bring back the "invisible cursor, camera spins behind the
 * board" bug.
 */
export function openOverlayFromWalk(doc: Document = document): () => void {
  const locked = doc.pointerLockElement as HTMLElement | null;
  if (!locked) return () => {};
  useWalk.getState().setPaused(true);
  doc.exitPointerLock();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const walk = useWalk.getState();
    walk.setPaused(false);
    if (!walk.walking || !locked.isConnected || doc.pointerLockElement) return;
    // Another overlay is still open: leave the mouse free.
    if (doc.querySelector?.('[role="dialog"]')) return;
    try {
      const p = locked.requestPointerLock() as unknown as Promise<void> | undefined;
      p?.catch?.(() => {});
    } catch {
      // No user activation: the next canvas click re-locks.
    }
  };
}

/** Former name, kept for existing callers. */
export const borrowPointerFromWalk = openOverlayFromWalk;

/** Hook form: frees the mouse from walk mode while the calling component is mounted. */
export function useWalkOverlay(): void {
  useEffect(() => openOverlayFromWalk(), []);
}
