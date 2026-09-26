import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerMessage } from "@agenticview/shared";
import { FEED_CAP, useStore } from "../src/state/store";
import { RUN_EVENT_BATCH_MS, createIngest } from "../src/net/ws";
import { manager, snapshot, task, worker, worker2 } from "./fixtures";

const ev = (agentId: string, text: string): ServerMessage => ({ type: "run.event", taskId: "t_1", agentId, event: { type: "text", text } });

beforeEach(() => {
  useStore.getState().reset();
  useStore.getState().apply(snapshot([manager, worker, worker2]));
});
afterEach(() => vi.useRealTimers());

describe("store.applyMany", () => {
  it("applies a burst of run.events as ONE store notification with the same result as one-by-one", () => {
    const listener = vi.fn();
    const unsub = useStore.subscribe(listener);
    useStore.getState().applyMany([ev(worker.id, "a"), ev(worker.id, "b"), ev(worker2.id, "c")]);
    unsub();
    expect(listener).toHaveBeenCalledTimes(1);
    const s = useStore.getState();
    expect(s.feed[worker.id]!.map((f) => ("event" in f && f.event.type === "text" ? f.event.text : ""))).toEqual(["a", "b"]);
    expect(s.feed[worker2.id]).toHaveLength(1);
    expect(s.bubbles[worker.id]!.text).toBe("b");
    expect(s.bubbles[worker2.id]!.text).toBe("c");
  });

  it("keeps untouched agents' feed arrays (per-agent subscribers do not re-render)", () => {
    useStore.getState().apply(ev(worker2.id, "old"));
    const before = useStore.getState().feed[worker2.id];
    useStore.getState().applyMany([ev(worker.id, "a"), ev(worker.id, "b")]);
    expect(useStore.getState().feed[worker2.id]).toBe(before);
  });

  it("trims each touched feed to FEED_CAP", () => {
    const burst = Array.from({ length: FEED_CAP + 25 }, (_, i) => ev(worker.id, String(i)));
    useStore.getState().applyMany(burst);
    const feed = useStore.getState().feed[worker.id]!;
    expect(feed).toHaveLength(FEED_CAP);
    const last = feed[feed.length - 1]!;
    expect("event" in last && last.event.type === "text" && last.event.text).toBe(String(FEED_CAP + 24));
  });

  it("applies other messages in order between runs of events", () => {
    const t = task({ id: "t_1", status: "running" });
    useStore.getState().applyMany([ev(worker.id, "a"), { type: "task.updated", task: t }, ev(worker.id, "b")]);
    expect(useStore.getState().tasks.t_1!.status).toBe("running");
    expect(useStore.getState().feed[worker.id]).toHaveLength(2);
  });
});

describe("createIngest", () => {
  it("coalesces run.events arriving within the window into a single flush", () => {
    vi.useFakeTimers();
    const applyMany = vi.spyOn(useStore.getState(), "applyMany");
    const ingest = createIngest(useStore);
    for (let i = 0; i < 20; i++) ingest(ev(worker.id, String(i)));
    expect(useStore.getState().feed[worker.id]).toBeUndefined();
    vi.advanceTimersByTime(RUN_EVENT_BATCH_MS);
    expect(applyMany).toHaveBeenCalledTimes(1);
    expect(useStore.getState().feed[worker.id]).toHaveLength(20);
    applyMany.mockRestore();
  });

  it("flushes queued events before any other message so order is kept", () => {
    vi.useFakeTimers();
    const order: string[] = [];
    const store = { getState: () => ({ ...useStore.getState(), applyMany: (m: readonly ServerMessage[]) => order.push(`events:${m.length}`), apply: (m: ServerMessage) => order.push(m.type) }) };
    const ingest = createIngest(store as never);
    ingest(ev(worker.id, "a"));
    ingest(ev(worker.id, "b"));
    ingest({ type: "task.updated", task: task({ id: "t_1", status: "done" }) });
    expect(order).toEqual(["events:2", "task.updated"]);
    vi.advanceTimersByTime(RUN_EVENT_BATCH_MS * 2);
    expect(order).toEqual(["events:2", "task.updated"]);
  });

  it("dispose drops the pending timer", () => {
    vi.useFakeTimers();
    const ingest = createIngest(useStore);
    ingest(ev(worker.id, "a"));
    ingest.dispose();
    vi.advanceTimersByTime(RUN_EVENT_BATCH_MS * 2);
    expect(useStore.getState().feed[worker.id]).toBeUndefined();
  });
});
