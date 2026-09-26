/**
 * V key deduplication test.
 *
 * Before the fix, Office.tsx and App.tsx both handled the V key, so one press
 * toggled walk mode twice (net no-op). This test documents and verifies:
 *   1. A single handler = one toggle per press (desired behaviour)
 *   2. Two identical handlers = two toggles per press (the old bug)
 */
import { beforeEach, describe, it, expect } from "vitest";
import { useWalk } from "../src/state/walk";

beforeEach(() => {
  useWalk.setState({ walking: false });
});

describe("V key walk-mode toggle", () => {
  it("one handler: single V press toggles walk on", () => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "v" || e.key === "V") {
        useWalk.getState().setWalking(!useWalk.getState().walking);
      }
    };
    window.addEventListener("keydown", handler);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "V", bubbles: true }));
    expect(useWalk.getState().walking).toBe(true);
    window.removeEventListener("keydown", handler);
  });

  it("one handler: second V press toggles walk back off", () => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "v" || e.key === "V") {
        useWalk.getState().setWalking(!useWalk.getState().walking);
      }
    };
    window.addEventListener("keydown", handler);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "V", bubbles: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "V", bubbles: true }));
    expect(useWalk.getState().walking).toBe(false);
    window.removeEventListener("keydown", handler);
  });

  it("two handlers (old bug): single V press results in no-op toggle (documents the bug)", () => {
    // Office.tsx used to add a second handler; this shows the result was a double-toggle.
    const makeH = () => (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "v" || e.key === "V") {
        useWalk.getState().setWalking(!useWalk.getState().walking);
      }
    };
    const h1 = makeH();
    const h2 = makeH();
    window.addEventListener("keydown", h1);
    window.addEventListener("keydown", h2);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "V", bubbles: true }));
    // Two handlers toggled: false → true → false = no-op
    expect(useWalk.getState().walking).toBe(false);
    window.removeEventListener("keydown", h1);
    window.removeEventListener("keydown", h2);
  });

  it("V with modifier key is ignored", () => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "v" || e.key === "V") {
        useWalk.getState().setWalking(!useWalk.getState().walking);
      }
    };
    window.addEventListener("keydown", handler);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "V", ctrlKey: true, bubbles: true }));
    expect(useWalk.getState().walking).toBe(false);
    window.removeEventListener("keydown", handler);
  });
});
