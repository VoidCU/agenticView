/**
 * Any overlay opened while walking frees the mouse: the shared Modal (boards, inbox, RPS, settings, ...)
 * releases pointer lock and pauses walk mode, and hands it back on close.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Space } from "@agenticview/shared";
import { Modal } from "../src/hud/ui";
import { PodBoard } from "../src/hud/PodBoard";
import { useStore } from "../src/state/store";
import { manager, snapshot, task } from "./fixtures";
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

  it("the Manager board's timeline keeps the mouse free from walk mode until the board closes", async () => {
    const office: Space = { id: "office", name: "Manager's Office", kind: "office", q: 0, r: 0, ring: 0, x: 0, z: 0, seats: 1 };
    useStore.getState().reset();
    useStore.getState().apply(snapshot([manager], [task({ id: "req1", kind: "request", title: "Build login", assigneeId: manager.id, createdBy: "user" })]));
    const { unmount } = render(<PodBoard space={office} onClose={() => {}} />);
    expect(document.exitPointerLock).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByTestId("manager-view-timeline"));
    expect(screen.getByTestId("workflow-board")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.getByTestId("manager-board")).toBeInTheDocument();
    // Still one overlay holding the mouse: walk stays paused, nothing tried to re-lock.
    expect(useWalk.getState().paused).toBe(true);
    const requestLock = (canvas as unknown as { requestPointerLock: () => void }).requestPointerLock;
    expect(requestLock).not.toHaveBeenCalled();
    unmount();
    expect(useWalk.getState().paused).toBe(false);
    expect(requestLock).toHaveBeenCalled();
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
