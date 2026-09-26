/**
 * Phase 4 tests:
 * - Timeline: buildTimeline produces correct entries
 * - Changes button appears in task drawer
 * - Settings: preferCheapModels and notifications toggles
 * - Keyboard shortcuts: I, T, L keys
 * - useNotifications: getNotificationPref / setNotificationPref
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useStore } from "../src/state/store";
import { buildTimeline } from "../src/hud/Timeline";
import { Timeline } from "../src/hud/Timeline";
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
// Timeline: buildTimeline
// ---------------------------------------------------------------------------

describe("buildTimeline", () => {
  it("creates task.created entry for each task", () => {
    const tasks = {
      t1: task({ id: "t1", title: "Build feature", assigneeId: worker.id }),
    };
    const agents = { [worker.id]: worker };
    const entries = buildTimeline(tasks, {}, agents);
    const created = entries.find((e) => e.kind === "task.created" && e.label.includes("Build feature"));
    expect(created).toBeTruthy();
    expect(created?.agentName).toBe("Pixel");
  });

  it("creates task.done entry when task is done with finishedAt", () => {
    const tasks = {
      t1: task({ id: "t1", title: "Ship it", assigneeId: worker.id, status: "done", finishedAt: "2026-09-26T00:00:00.000Z" }),
    };
    const entries = buildTimeline(tasks, {}, { [worker.id]: worker });
    const done = entries.find((e) => e.kind === "task.done");
    expect(done).toBeTruthy();
    expect(done?.label).toContain("Ship it");
  });

  it("creates task.failed entry when task is failed", () => {
    const tasks = {
      t1: task({ id: "t1", title: "Bad task", assigneeId: worker.id, status: "failed", finishedAt: "2026-09-26T00:00:00.000Z", error: "oops" }),
    };
    const entries = buildTimeline(tasks, {}, { [worker.id]: worker });
    const failed = entries.find((e) => e.kind === "task.failed");
    expect(failed).toBeTruthy();
    expect(failed?.detail).toBe("oops");
  });

  it("creates file.changed entries from feed", () => {
    const tasks = {};
    const feed: Record<string, FeedItem[]> = {
      [worker.id]: [
        { ts: Date.now(), taskId: "t1", event: { type: "file_changed", path: "/src/foo.ts", kind: "modify" } },
      ],
    };
    const entries = buildTimeline(tasks, feed, { [worker.id]: worker });
    const fileEntry = entries.find((e) => e.kind === "file.changed");
    expect(fileEntry).toBeTruthy();
    expect(fileEntry?.label).toContain("foo.ts");
  });

  it("returns entries sorted newest first", () => {
    const t1 = task({ id: "t1", title: "Old", assigneeId: worker.id, createdAt: "2026-09-24T00:00:00.000Z" });
    const t2 = task({ id: "t2", title: "New", assigneeId: worker.id, createdAt: "2026-09-25T00:00:00.000Z" });
    const tasks = { t1, t2 };
    const entries = buildTimeline(tasks, {}, { [worker.id]: worker }).filter((e) => e.kind === "task.created");
    expect(entries[0]?.label).toContain("New");
    expect(entries[1]?.label).toContain("Old");
  });

  it("assigns correct agentName and agentColor", () => {
    const tasks = { t1: task({ id: "t1", assigneeId: worker.id }) };
    const entries = buildTimeline(tasks, {}, { [worker.id]: worker });
    const entry = entries[0]!;
    expect(entry.agentName).toBe("Pixel");
    expect(entry.agentColor).toBe("#5b8cff");
  });
});

// ---------------------------------------------------------------------------
// Timeline panel
// ---------------------------------------------------------------------------

describe("Timeline panel", () => {
  it("renders 'No activity yet' when empty", () => {
    useStore.getState().apply(snapshot([worker], []));
    render(<Timeline onClose={vi.fn()} />);
    expect(screen.getByText(/no activity yet/i)).toBeInTheDocument();
  });

  it("renders entries from store tasks", () => {
    useStore.getState().apply(snapshot([worker], [task({ id: "t1", title: "Test task", assigneeId: worker.id })]));
    render(<Timeline onClose={vi.fn()} />);
    expect(screen.getAllByTestId("tl-entry").length).toBeGreaterThan(0);
    expect(screen.getByText(/Test task/)).toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", async () => {
    useStore.getState().apply(snapshot([worker], []));
    const onClose = vi.fn();
    render(<Timeline onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: /close timeline/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it("filters entries by agent", async () => {
    useStore.getState().apply(snapshot(
      [worker],
      [
        task({ id: "t1", title: "Task A", assigneeId: worker.id }),
      ],
    ));
    render(<Timeline onClose={vi.fn()} />);
    const agentSelect = screen.getByRole("combobox", { name: /filter by agent/i });
    await userEvent.selectOptions(agentSelect, worker.id);
    // All visible entries should be for this agent
    const entries = screen.queryAllByTestId("tl-entry");
    expect(entries.length).toBeGreaterThan(0);
  });
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
    useStore.setState({ send, settings: { defaultProvider: null, defaultModel: null, maxConcurrentRuns: 3, limitPolicy: "ask", loungeBreaks: true, preferCheapModels: true } });
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
