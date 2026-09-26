import { describe, it, expect } from "vitest";
import { getFeedLines, MAX_DIST, REFRESH_MS, MAX_UPDATES_PER_FRAME, NEAR_DIST, STATUS_LABELS, monitorPoseForSeat } from "../src/scene/DeskMonitor";
import type { FeedItem } from "../src/state/store";

// ---- helpers ----

function textItem(text: string, ts = Date.now()): FeedItem {
  return { event: { type: "text", text }, ts, taskId: "t1" };
}

function toolItem(name: string, ts = Date.now()): FeedItem {
  return { event: { type: "tool_start", name, input: null }, ts, taskId: "t1" };
}

function fileItem(path: string, kind: "create" | "modify", ts = Date.now()): FeedItem {
  return { event: { type: "file_changed", path, kind }, ts, taskId: "t1" };
}

function statusItem(text: string, ts = Date.now()): FeedItem {
  return { event: { type: "status", text }, ts, taskId: "t1" };
}

function userItem(user: string, ts = Date.now()): FeedItem {
  return { user, ts, taskId: "t1" };
}

// ---- getFeedLines ----

describe("getFeedLines", () => {
  it("returns empty array for undefined feed", () => {
    expect(getFeedLines(undefined)).toEqual([]);
  });

  it("returns empty array for empty feed", () => {
    expect(getFeedLines([])).toEqual([]);
  });

  it("formats text events", () => {
    const lines = getFeedLines([textItem("hello world")]);
    expect(lines).toContain("hello world");
  });

  it("formats tool_start events with brackets", () => {
    const lines = getFeedLines([toolItem("Read")]);
    expect(lines).toContain("[Read]");
  });

  it("formats file_changed create events with +", () => {
    const lines = getFeedLines([fileItem("src/foo/bar.ts", "create")]);
    expect(lines.some((l) => l.startsWith("+ bar.ts"))).toBe(true);
  });

  it("formats file_changed modify events with ~", () => {
    const lines = getFeedLines([fileItem("src/foo/bar.ts", "modify")]);
    expect(lines.some((l) => l.startsWith("~ bar.ts"))).toBe(true);
  });

  it("formats status events", () => {
    const lines = getFeedLines([statusItem("Building...")]);
    expect(lines).toContain("Building...");
  });

  it("formats user messages with >", () => {
    const lines = getFeedLines([userItem("Fix the bug")]);
    expect(lines.some((l) => l.startsWith("> Fix the bug"))).toBe(true);
  });

  it("respects limit parameter", () => {
    const feed = Array.from({ length: 10 }, (_, i) => textItem(`line ${i}`));
    const lines = getFeedLines(feed, 4);
    expect(lines.length).toBeLessThanOrEqual(4);
  });

  it("returns the last N lines (most recent)", () => {
    const feed = Array.from({ length: 8 }, (_, i) => textItem(`line ${i}`));
    const lines = getFeedLines(feed, 3);
    expect(lines).toContain("line 7");
    expect(lines).toContain("line 6");
    expect(lines).toContain("line 5");
    expect(lines).not.toContain("line 4");
  });

  it("truncates very long text lines at 60 chars", () => {
    const longText = "a".repeat(80);
    const lines = getFeedLines([textItem(longText)]);
    expect(lines[0]!.length).toBeLessThanOrEqual(60);
  });

  it("filters out empty lines", () => {
    // Unknown event type should produce empty string → filtered
    const weirdItem = { event: { type: "unknown_type" as never }, ts: Date.now(), agentId: "a1" } as unknown as FeedItem;
    const lines = getFeedLines([weirdItem]);
    expect(lines).toEqual([]);
  });
});

// ---- STATUS_LABELS ----

describe("STATUS_LABELS", () => {
  it("has labels for all statuses", () => {
    const statuses = ["idle", "thinking", "editing", "waiting", "error"] as const;
    for (const s of statuses) {
      expect(STATUS_LABELS[s]).toBeTruthy();
      expect(typeof STATUS_LABELS[s]).toBe("string");
    }
  });

  it("idle label is IDLE", () => {
    expect(STATUS_LABELS.idle).toBe("IDLE");
  });

  it("thinking label is THINKING", () => {
    expect(STATUS_LABELS.thinking).toBe("THINKING");
  });
});

// ---- throttle constants ----

describe("throttle / distance constants", () => {
  it("MAX_DIST is positive and reasonable", () => {
    expect(MAX_DIST).toBeGreaterThan(0);
    expect(MAX_DIST).toBeLessThan(200);
  });

  it("REFRESH_MS is at least 500ms", () => {
    expect(REFRESH_MS).toBeGreaterThanOrEqual(500);
  });

  it("NEAR_DIST < MAX_DIST", () => {
    expect(NEAR_DIST).toBeLessThan(MAX_DIST);
  });

  it("MAX_UPDATES_PER_FRAME is at least 1", () => {
    expect(MAX_UPDATES_PER_FRAME).toBeGreaterThanOrEqual(1);
  });
});

// ---- monitorPoseForSeat ----

describe("monitorPoseForSeat", () => {

  it("sits exactly on the kit desk screen face (frame ±0.36, screen local z -0.163)", () => {
    // Front row (seat 0): desk frame at z -0.36 with yaw π -> face at -0.36 + 0.163.
    const front = monitorPoseForSeat(0, 0, 0)!;
    expect(front.position[2]).toBeCloseTo(-0.197, 3);
    expect(front.yaw).toBeCloseTo(Math.PI, 6);
    // Back row (seat 3): frame at z +0.36 with yaw 0 -> face at 0.36 - 0.163.
    const back = monitorPoseForSeat(0, 0, 3)!;
    expect(back.position[2]).toBeCloseTo(0.197, 3);
    expect(back.yaw).toBeCloseTo(0, 6);
  });
  it("returns null for out-of-range seat", () => {
    expect(monitorPoseForSeat(0, 0, -1)).toBeNull();
    expect(monitorPoseForSeat(0, 0, 6)).toBeNull();
  });

  it("returns a pose for every seat 0-5", () => {
    for (let seat = 0; seat < 6; seat++) {
      const pose = monitorPoseForSeat(0, 0, seat);
      expect(pose).not.toBeNull();
      expect(pose!.position).toHaveLength(3);
      expect(pose!.position[1]).toBeCloseTo(1.06, 2);
      expect(Number.isFinite(pose!.yaw)).toBe(true);
    }
  });

  it("translates monitor position by spaceX/spaceZ", () => {
    const base = monitorPoseForSeat(0, 0, 0)!;
    const shifted = monitorPoseForSeat(10, 5, 0)!;
    expect(shifted.position[0]).toBeCloseTo(base.position[0] + 10, 4);
    expect(shifted.position[2]).toBeCloseTo(base.position[2] + 5, 4);
  });

  it("all 6 monitors have distinct positions", () => {
    const poses = Array.from({ length: 6 }, (_, i) => monitorPoseForSeat(0, 0, i)!);
    const keys = new Set(poses.map((p) => `${p.position[0].toFixed(3)},${p.position[2].toFixed(3)}`));
    expect(keys.size).toBe(6);
  });
});
