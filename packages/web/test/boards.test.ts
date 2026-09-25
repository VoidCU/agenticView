import { describe, expect, it } from "vitest";
import { delegatedTree, latestProgress, managerBoard, podBoard, relativeTime } from "../src/state/boards";
import { agent, manager, task, worker, worker2 } from "./fixtures";
import type { FeedItem } from "../src/state/store";

describe("office boards", () => {
  it("uses resolved seats, including moves and contested placements", () => {
    const moved = { ...worker, placement: { space: "pod-b", seat: 0 } };
    const collision = { ...worker2, placement: { space: "pod-b", seat: 0 } };
    expect(podBoard("pod-b", [manager, moved, collision], []).workers.map(a => a.id)).toEqual([worker.id]);
    expect(podBoard("pod-a", [manager, moved, collision], []).workers.map(a => a.id)).toEqual([worker2.id]);
    expect(podBoard("pod-d", [worker], []).workers).toEqual([]);
  });
  it("groups assigned with queued, excludes cancelled and other pods, caps recent done", () => {
    const other = agent({ ...worker2, placement: { space: "pod-b", seat: 0 } });
    const tasks = [task({ id: "assigned", status: "assigned" }), task({ id: "cancelled", status: "cancelled" }), task({ id: "other", assigneeId: other.id }), ...Array.from({ length: 25 }, (_, i) => task({ id: `done-${i}`, status: "done", finishedAt: new Date(i * 1000).toISOString() }))];
    const { columns } = podBoard("pod-a", [worker, other], tasks);
    expect(columns.queued.map(t => t.id)).toEqual(["assigned"]);
    expect(columns.done).toHaveLength(20);
    expect(columns.done[0]?.id).toBe("done-24");
    expect(tasks).toHaveLength(28);
  });
  it("keeps running, waiting and failed separate", () => {
    const { columns } = podBoard("pod-a", [worker], [task({ id: "r", status: "running" }), task({ id: "w", status: "waiting" }), task({ id: "f", status: "failed" })]);
    expect([columns.running[0]?.id, columns.waiting[0]?.id, columns.failed[0]?.id]).toEqual(["r", "w", "f"]);
  });
  it("selects latest progress only for the task, independent of feed order", () => {
    expect(latestProgress("a", [{ ts: 5, taskId: "a", event: { type: "status", text: "Latest" } }, { ts: 9, taskId: "b", event: { type: "text", text: "Other" } }, { ts: 1, taskId: "a", event: { type: "text", text: "Old" } }])).toBe("Latest");
    expect(latestProgress("missing", [])).toBeUndefined();
  });
  it("prefers the later inserted progress event when timestamps tie without mutating the feed", () => {
    const feed: FeedItem[] = [
      { ts: 5, taskId: "a", event: { type: "status", text: "Older" } },
      { ts: 5, taskId: "a", event: { type: "text", text: "Newer" } },
      { ts: 5, taskId: "b", event: { type: "text", text: "Other task" } },
      { ts: 4, taskId: "a", event: { type: "text", text: "Earlier timestamp" } },
    ];
    const original = [...feed];
    expect(latestProgress("a", feed)).toBe("Newer");
    expect(feed).toEqual(original);
  });
  it("builds recursive delegation and safely stops malformed cycles", () => {
    const tasks = [task({ id: "a", parentId: "request" }), task({ id: "b", parentId: "a" }), task({ id: "request", parentId: "b" })];
    const tree = delegatedTree("request", tasks);
    expect(tree[0]?.children[0]?.task.id).toBe("b");
    expect(tree[0]?.children[0]?.children).toEqual([]);
  });
  it("orders manager requests newest first and associates only their replies", () => {
    const tasks = [task({ id: "old", kind: "request", assigneeId: manager.id }), task({ id: "new", kind: "request", assigneeId: manager.id, createdAt: "2026-09-26T00:00:00Z" }), task({ id: "child", parentId: "new" }), task({ id: "chat", kind: "chat", assigneeId: manager.id })];
    const board = managerBoard(manager.id, tasks, [{ ts: 1, taskId: "new", event: { type: "text", text: "Working" } }, { ts: 2, taskId: "old", user: "Request" }]);
    expect(board.map(r => r.task.id)).toEqual(["new", "old"]);
    expect(board[0]?.replies[0]?.event.text).toBe("Working");
    expect(board[0]?.children[0]?.task.id).toBe("child");
    expect(managerBoard(undefined, tasks, [])).toEqual([]);
  });
  it("formats relative times with an explicit clock", () => {
    expect(relativeTime("2026-09-25T00:00:00Z", Date.parse("2026-09-25T00:03:00Z"))).toBe("3m ago");
  });
});
