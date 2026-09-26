import { describe, expect, it } from "vitest";
import { buildSpaces } from "@agenticview/shared";
import { viewOrder, keyToRoom } from "../src/scene/roomKeys";

describe("viewOrder", () => {
  it("puts office first, then pods, then meeting, then lounge", () => {
    const spaces = buildSpaces(1);
    const order = viewOrder(spaces);
    expect(order[0]).toBe("office");
    const podIndices = order.slice(1, -2);
    expect(podIndices.every((id) => id.startsWith("pod-"))).toBe(true);
    expect(order[order.length - 2]).toBe("meeting");
    expect(order[order.length - 1]).toBe("lounge");
  });

  it("orders pods alphabetically within the same ring", () => {
    const spaces = buildSpaces(1);
    const order = viewOrder(spaces);
    const pods = order.filter((id) => id.startsWith("pod-"));
    expect(pods).toEqual([...pods].sort());
  });

  it("returns all spaces exactly once", () => {
    const spaces = buildSpaces(2);
    const order = viewOrder(spaces);
    expect(order).toHaveLength(spaces.length);
    expect(new Set(order).size).toBe(spaces.length);
  });

  it("ring-1 pods come before ring-2 pods", () => {
    const spaces = buildSpaces(2);
    const order = viewOrder(spaces);
    const pods = order.filter((id) => id.startsWith("pod-"));
    const ring1 = spaces.filter((s) => s.kind === "pod" && s.ring === 1).map((s) => s.id);
    const ring2 = spaces.filter((s) => s.kind === "pod" && s.ring === 2).map((s) => s.id);
    const firstRing2 = pods.findIndex((id) => ring2.includes(id));
    const lastRing1 = pods.reduce((max, id, i) => (ring1.includes(id) ? i : max), -1);
    expect(lastRing1).toBeLessThan(firstRing2);
  });

  it("returns an empty array for an empty spaces list", () => {
    expect(viewOrder([])).toEqual([]);
  });
});

describe("keyToRoom", () => {
  const spaces = buildSpaces(1);

  it('maps "1" to office (first in order)', () => {
    expect(keyToRoom("1", spaces)).toBe("office");
  });

  it('maps "2" through "5" to the four pods', () => {
    const order = viewOrder(spaces);
    for (let n = 2; n <= 5; n++) {
      expect(keyToRoom(String(n), spaces)).toBe(order[n - 1]);
      expect(keyToRoom(String(n), spaces)!.startsWith("pod-")).toBe(true);
    }
  });

  it('maps "6" to meeting and "7" to lounge for a 1-ring layout', () => {
    expect(keyToRoom("6", spaces)).toBe("meeting");
    expect(keyToRoom("7", spaces)).toBe("lounge");
  });

  it("returns undefined for keys beyond the number of rooms", () => {
    // 1-ring has 7 spaces; key "8" and "9" are out of range.
    expect(keyToRoom("8", spaces)).toBeUndefined();
    expect(keyToRoom("9", spaces)).toBeUndefined();
  });

  it("returns undefined for non-digit or out-of-range keys", () => {
    expect(keyToRoom("0", spaces)).toBeUndefined();
    expect(keyToRoom("a", spaces)).toBeUndefined();
    expect(keyToRoom("Escape", spaces)).toBeUndefined();
    expect(keyToRoom("", spaces)).toBeUndefined();
  });

  it("works with a 2-ring layout (more than 9 spaces)", () => {
    const big = buildSpaces(2);
    const order = viewOrder(big);
    // All 9 keys should map to the first 9 in order.
    for (let n = 1; n <= 9; n++) {
      expect(keyToRoom(String(n), big)).toBe(order[n - 1]);
    }
  });
});
