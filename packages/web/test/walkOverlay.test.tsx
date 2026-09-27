/**
 * Any overlay opened while walking frees the mouse: the shared Modal (boards, inbox, RPS, settings, ...)
 * releases pointer lock and pauses walk mode, and hands it back on close.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { Modal } from "../src/hud/ui";
import { useWalk } from "../src/state/walk";
import { openOverlayFromWalk } from "../src/state/pointerLock";

describe("overlays opened from walk mode release pointer lock", () => {
  let lockEl: Element | null = null;
  const canvas = document.createElement("canvas");
  beforeEach(() => {
    document.body.appendChild(canvas);
    lockEl = canvas;
    Object.defineProperty(document, "pointerLockElement", { configurable: true, get: () => lockEl });
    document.exitPointerLock = vi.fn(() => { lockEl = null; });
    (canvas as unknown as { requestPointerLock: () => void }).requestPointerLock = vi.fn(() => { lockEl = canvas; });
    useWalk.setState({ walking: true, paused: false, locked: true });
  });
  afterEach(() => {
    useWalk.setState({ walking: false, paused: false, locked: false });
    canvas.remove();
  });

  it("a board (Modal) exits pointer lock and pauses walking while open, and resumes on close", () => {
    const { unmount } = render(<Modal title="Pod board" onClose={() => {}}><button type="button">card</button></Modal>);
    expect(document.exitPointerLock).toHaveBeenCalledTimes(1);
    expect(document.pointerLockElement).toBeNull();
    expect(useWalk.getState().paused).toBe(true);
    expect(useWalk.getState().walking).toBe(true);
    unmount();
    expect(useWalk.getState().paused).toBe(false);
    expect(useWalk.getState().walking).toBe(true);
    // Tried to hand the mouse back to the walk view.
    expect((canvas as unknown as { requestPointerLock: () => void }).requestPointerLock).toHaveBeenCalled();
  });

  it("does nothing outside walk mode (no lock held)", () => {
    lockEl = null;
    const { unmount } = render(<Modal title="Inbox" onClose={() => {}}>x</Modal>);
    expect(document.exitPointerLock).not.toHaveBeenCalled();
    expect(useWalk.getState().paused).toBe(false);
    unmount();
  });

  it("the restore function is idempotent and leaves the mouse free while another dialog is open", () => {
    const restore = openOverlayFromWalk();
    const other = document.createElement("div");
    other.setAttribute("role", "dialog");
    document.body.appendChild(other);
    restore();
    restore();
    expect(useWalk.getState().paused).toBe(false);
    expect((canvas as unknown as { requestPointerLock: () => void }).requestPointerLock).not.toHaveBeenCalled();
    other.remove();
  });
});
