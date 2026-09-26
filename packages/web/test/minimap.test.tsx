import { afterEach, describe, expect, it } from "vitest";
import { buildSpaces } from "@agenticview/shared";
import { viewOrder, keyToRoom } from "../src/scene/roomKeys";
import { activityLabel, resolveMapPoint, roomOccupancy, spreadRoomPoints } from "../src/state/minimap";
import { MiniMap } from "../src/scene/MiniMap";
import { useStore } from "../src/state/store";
import { manager, worker, worker2, snapshot } from "./fixtures";
import { usePositions } from "../src/state/positions";
import { useMapOpen } from "../src/state/map";
import { useWalk } from "../src/state/walk";
import { fireEvent, render, screen, cleanup } from "@testing-library/react";

afterEach(cleanup);

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

describe("mini-map positions", () => {
  const ids = new Set(["pod-a", "lounge"]);

  it("prefers live room coordinates and falls back to the assigned seat when missing or stale", () => {
    expect(resolveMapPoint("a", { x: 8, z: -2, spaceId: "lounge", activity: "break" }, { x: 1, z: 2, spaceId: "pod-a" }, ids)).toMatchObject({ x: 8, z: -2, spaceId: "lounge", activity: "break", live: true });
    expect(resolveMapPoint("a", undefined, { x: 1, z: 2, spaceId: "pod-a" }, ids)).toMatchObject({ x: 1, z: 2, spaceId: "pod-a", activity: "desk", live: false });
    expect(resolveMapPoint("a", { x: 8, z: -2, spaceId: "removed", activity: "walking" }, { x: 1, z: 2, spaceId: "pod-a" }, ids)?.spaceId).toBe("pod-a");
    expect(resolveMapPoint("a", undefined, undefined, ids)).toBeUndefined();
  });

  it("counts live occupancy by room and spreads coincident markers", () => {
    const points = [
      { agentId: "a", x: 1, z: 2, spaceId: "lounge", activity: "lounge" as const, live: true },
      { agentId: "b", x: 1, z: 2, spaceId: "lounge", activity: "break" as const, live: true },
      { agentId: "c", x: 3, z: 4, spaceId: "pod-a", activity: "desk" as const, live: false },
    ];
    expect(roomOccupancy(points)).toEqual(new Map([["lounge", 2], ["pod-a", 1]]));
    const spread = spreadRoomPoints([{ x: 40, y: 40 }, { x: 40, y: 40 }, { x: 40, y: 40 }], { x: 40, y: 40 }, 18);
    expect(new Set(spread.map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`)).size).toBe(3);
  });

  it("shows the live activity tooltip, room occupancy and selects the clicked agent", () => {
    useStore.getState().reset();
    useStore.getState().apply(snapshot([manager, worker, worker2]));
    const lounge = buildSpaces(1).find((space) => space.id === "lounge")!;
    usePositions.getState().set({
      [worker.id]: { x: lounge.x, z: lounge.z, spaceId: "lounge", activity: "lounge" },
      [worker2.id]: { x: lounge.x, z: lounge.z, spaceId: "lounge", activity: "break" },
    });
    useMapOpen.getState().setOpen(true);
    useWalk.getState().setWalking(false);
    render(<MiniMap />);
    expect(screen.getByRole("button", { name: "Pixel, In the lounge, Lounge" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Byte, On a break, Lounge" })).toBeInTheDocument();
    expect(document.querySelector(`.minimap-agent[data-agent-id="${worker.id}"] title`)?.textContent).toBe("Pixel · In the lounge");
    expect(document.querySelector(".minimap-agent-lounge .minimap-activity-ring")).toBeInTheDocument();
    expect(screen.getByText("Lounge 2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Pixel, In the lounge, Lounge" }));
    expect(useStore.getState().selectedAgentId).toBe(worker.id);
    expect(activityLabel("fainted")).toBe("Fainted");
  });

  it("renders the player marker and direction in walk mode when the scene publishes it", () => {
    useStore.getState().reset();
    useStore.getState().apply(snapshot([manager, worker]));
    const lounge = buildSpaces(1).find((space) => space.id === "lounge")!;
    usePositions.getState().setPlayer({ x: lounge.x, z: lounge.z, yaw: 0.4, spaceId: lounge.id });
    useMapOpen.getState().setOpen(true);
    useWalk.getState().setWalking(true);
    render(<MiniMap />);
    expect(screen.getByLabelText("You are here")).toBeInTheDocument();
    useWalk.getState().setWalking(false);
    usePositions.getState().setPlayer(undefined);
  });
});
