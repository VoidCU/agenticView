import { describe, expect, it } from "vitest";
import { buildSpaces } from "@agenticview/shared";
import { boardLines, boardRowsLayout, BOARD_REFRESH_MS, BOARD_MAX_LINES, BOARD_FACE_NUDGE, BOARD_ROWS_TOP, whiteboardPose } from "../src/scene/Whiteboard";
import { Kit, furnishSpace, WHITEBOARD_FACE } from "../src/scene/kit";
import { useWalk } from "../src/state/walk";
import { task, worker } from "./fixtures";

describe("whiteboard lines", () => {
  const podA = buildSpaces(1).find((s) => s.id === "pod-a")!;
  it("lists the pod's tasks with status, active work before done", () => {
    const lines = boardLines(podA, [worker], [
      task({ id: "d", title: "Done thing", status: "done", finishedAt: new Date(0).toISOString() }),
      task({ id: "r", title: "Running thing", status: "running" }),
      task({ id: "q", title: "Queued thing", status: "assigned" }),
    ]);
    expect(lines).toEqual([
      { title: "Running thing", status: "running" },
      { title: "Queued thing", status: "queued" },
      { title: "Done thing", status: "done" },
    ]);
  });
  it("throttles redraws to at most once a second and caps rows", () => {
    expect(BOARD_REFRESH_MS).toBeGreaterThanOrEqual(1000);
    expect(BOARD_MAX_LINES).toBeGreaterThan(3);
  });
});

describe("walk-mode board rows layout", () => {
  // Canvas height used by the board face: 1024 wide at the physical face's aspect.
  const h = Math.round((1024 * WHITEBOARD_FACE.h) / WHITEBOARD_FACE.w);
  it.each([0, 1, 3, BOARD_MAX_LINES, BOARD_MAX_LINES + 1, 40])("%i tasks: every row ends inside the canvas", (total) => {
    const l = boardRowsLayout(h, total);
    expect(l.shown).toBe(Math.min(total, BOARD_MAX_LINES));
    expect(l.top).toBe(BOARD_ROWS_TOP);
    expect(l.top + l.shown * l.rowH).toBeLessThanOrEqual(h);
    expect(l.rowH).toBeGreaterThan(30); // still readable pills
  });
  it("keeps the '+N more' footer below the last row, never on top of it", () => {
    const l = boardRowsLayout(h, BOARD_MAX_LINES + 5);
    expect(l.footerY).not.toBeNull();
    // Footer text is ~26px tall, centred on footerY.
    expect(l.top + l.shown * l.rowH).toBeLessThanOrEqual(l.footerY! - 13);
    expect(l.footerY! + 13).toBeLessThanOrEqual(h);
    expect(boardRowsLayout(h, BOARD_MAX_LINES).footerY).toBeNull();
  });
  it("uses the compact row height when there are only a few tasks", () => {
    expect(boardRowsLayout(h, 2).rowH).toBe(58);
  });
});

describe("walk exit position", () => {
  it("records where the player stopped so the You robot can walk home", () => {
    useWalk.getState().setExitAt({ x: 3, z: -2 });
    expect(useWalk.getState().exitAt).toMatchObject({ x: 3, z: -2 });
  });
});

describe("whiteboard overlay pose mirrors kit.ts", () => {
  const spaces = buildSpaces(2);
  // Every room with a board, across a bigger floor: the office, several pods at different hex
  // positions, and meeting rooms (which use a different corner slot).
  const rooms = buildSpaces(3).filter((s) => s.kind !== "lounge");
  it("covers several rooms and both corner slots", () => {
    expect(rooms.length).toBeGreaterThanOrEqual(4);
    expect(new Set(rooms.map((r) => r.kind))).toEqual(new Set(["office", "pod", "meeting"]));
  });
  it.each(rooms.map((s) => [s.id, s] as const))("%s: live face sits 2-4 mm in front of the physical board", (_kind, space) => {
    const kit = new Kit();
    furnishSpace(kit, space, { seats: new Map() });
    const boards = kit.items.filter((it) => it.mat === "whiteboard");
    expect(boards).toHaveLength(1);
    const b = boards[0]!;
    const pose = whiteboardPose(space);
    expect(pose.yaw).toBeCloseTo(b.yaw, 9);
    expect(b.rx).toBe(0);
    const nx = Math.sin(b.yaw), nz = Math.cos(b.yaw);
    // Physical front face = box centre + half depth along the normal.
    const front = { x: b.x + nx * b.sz / 2, z: b.z + nz * b.sz / 2 };
    const dx = pose.face[0] - front.x, dz = pose.face[2] - front.z;
    const along = dx * nx + dz * nz;
    expect(along).toBeGreaterThanOrEqual(0.002);
    expect(along).toBeLessThanOrEqual(0.004);
    expect(Math.abs(dx * nz - dz * nx)).toBeLessThan(1e-9); // no sideways drift
    expect(pose.face[1]).toBeCloseTo(b.y, 9);
    expect(BOARD_FACE_NUDGE).toBeGreaterThanOrEqual(0.002);
  });
  it("uses different corners for pods and meeting rooms", () => {
    const pod = spaces.find((s) => s.kind === "pod")!;
    const meet = spaces.find((s) => s.kind === "meeting")!;
    const a = whiteboardPose({ ...pod, x: 0, z: 0 }), m = whiteboardPose({ ...meet, x: 0, z: 0 });
    expect(a.yaw).not.toBeCloseTo(m.yaw, 3);
  });
});
