/**
 * Phase 4 tests:
 * (Timeline workflows are covered in timelineWorkflow.test.tsx)
 * - Changes button appears in task drawer
 * - Settings: preferCheapModels and notifications toggles
 * - Keyboard shortcuts: I, T, L keys
 * - useNotifications: getNotificationPref / setNotificationPref
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useStore } from "../src/state/store";
import { SettingsModal } from "../src/hud/SettingsModal";
import { getNotificationPref, setNotificationPref } from "../src/hud/useNotifications";
import type { FeedItem } from "../src/state/store";
import { manager, worker, task, snapshot } from "./fixtures";

beforeEach(() => {
  useStore.getState().reset();
  window.location.hash = "#token=test-token";
  // Clean localStorage
  try { localStorage.removeItem("agenticview:notifications"); } catch { /* ignore */ }
});

// ---------------------------------------------------------------------------
// Settings: preferCheapModels and notifications
// ---------------------------------------------------------------------------

describe("SettingsModal: preferCheapModels and notifications", () => {
  it("shows preferCheapModels checkbox", () => {
    useStore.getState().apply(snapshot([manager], []));
    render(<SettingsModal onClose={vi.fn()} />);
    const cb = screen.getByRole("checkbox", { name: /prefer cheap models/i });
    expect(cb).toBeInTheDocument();
  });

  it("sends preferCheapModels=false when unchecked and saved", async () => {
    const send = vi.fn();
    useStore.getState().apply(snapshot([manager], []));
    // snapshot sets preferCheapModels: true
    useStore.setState({ send, settings: { defaultProvider: null, defaultModel: null, maxConcurrentRuns: 3, limitPolicy: "ask", failoverOrder: [], loungeBreaks: true, preferCheapModels: true, idleLoungeMinutes: 3 } });
    render(<SettingsModal onClose={vi.fn()} />);
    const cb = screen.getByRole("checkbox", { name: /prefer cheap models/i });
    await userEvent.click(cb);
    await userEvent.click(screen.getByRole("button", { name: /save settings/i }));
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ type: "settings.update", settings: expect.objectContaining({ preferCheapModels: false }) })
    );
  });

  it("shows desktop notifications checkbox", () => {
    useStore.getState().apply(snapshot([manager], []));
    render(<SettingsModal onClose={vi.fn()} />);
    expect(screen.getByRole("checkbox", { name: /desktop notifications/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// useNotifications: pref helpers
// ---------------------------------------------------------------------------

describe("notification pref helpers", () => {
  it("getNotificationPref returns false by default", () => {
    expect(getNotificationPref()).toBe(false);
  });

  it("setNotificationPref(true) stores the pref", () => {
    setNotificationPref(true);
    expect(getNotificationPref()).toBe(true);
  });

  it("setNotificationPref(false) removes the pref", () => {
    setNotificationPref(true);
    setNotificationPref(false);
    expect(getNotificationPref()).toBe(false);
  });
});
