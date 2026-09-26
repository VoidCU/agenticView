import { useWalk } from "./walk";

/**
 * Hand the mouse to a modal while walking. If the walk camera holds pointer lock, release it and mark
 * walk mode paused so the lock loss does not end the walk. Returns a restore function for when the
 * modal closes: it unpauses and, if still walking, tries to re-capture the mouse (browsers may refuse
 * without a fresh gesture; a click on the canvas then resumes, as usual).
 */
export function borrowPointerFromWalk(doc: Document = document): () => void {
  const locked = doc.pointerLockElement as HTMLElement | null;
  if (!locked) return () => {};
  useWalk.getState().setPaused(true);
  doc.exitPointerLock();
  return () => {
    const walk = useWalk.getState();
    walk.setPaused(false);
    if (!walk.walking || !locked.isConnected || doc.pointerLockElement) return;
    try {
      const p = locked.requestPointerLock() as unknown as Promise<void> | undefined;
      p?.catch?.(() => {});
    } catch {
      // No user activation: the next canvas click re-locks.
    }
  };
}
