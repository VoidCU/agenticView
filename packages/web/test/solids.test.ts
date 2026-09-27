import { describe, it, expect } from "vitest";
import {
  HEX_R,
  HEX_APOTHEM,
  POD_SEATS,
  seatLocal,
  seatPose,
  buildSpaces,
  planOffice,
  doorPoint,
  type Agent,
} from "@agenticview/shared";
import { layoutFor } from "../src/scene/layout";
import { solidsForLayout, type SolidBox, type SolidCircle } from "../src/scene/solids";
import { SCOREBOARD_STAND, scoreboardFrame } from "../src/scene/kit";
import { monitorPoseForSeat } from "../src/scene/DeskMonitor";

const DEG = Math.PI / 180;

function makeWorker(i: number): Agent {
  return {
    id: `w_${String(i).padStart(8, "0")}`,
    name: `Worker ${i}`,
    role: "worker",
    scope: "project",
    specialty: "",
    description: "",
    provider: "claude",
    model: null,
    systemPrompt: "",
    tools: { edit: true, shell: true, web: true, screenshot: false },
    permissionMode: "ask",
    appearance: { color: "#ff8800", accent: "#ffd166", eyes: "dots" },
    stats: { xp: 0, level: 1, tasksDone: 0, tasksFailed: 0 },
    createdAt: new Date(1700000000000 + i * 1000).toISOString(),
    updatedAt: "",
  };
}

describe("seat positions (6 per pod)", () => {
  it("defines 6 seats per pod in 2 rows of 3", () => {
    expect(POD_SEATS).toBe(6);
    const seats = Array.from({ length: 6 }, (_, i) => seatLocal("pod", i));

    // Verify 6 distinct seat positions
    const keys = new Set(seats.map((s) => `${s.x.toFixed(2)},${s.z.toFixed(2)}`));
    expect(keys.size).toBe(6);

    // Row 0: seats 0, 1, 2 at z = -1.4 facing +z (yaw = 0)
    for (let i = 0; i < 3; i++) {
      expect(seats[i]!.z).toBeCloseTo(-1.4, 2);
      expect(seats[i]!.yaw).toBe(0);
      expect(seats[i]!.x).toBeCloseTo((i - 1) * 1.2, 2);
    }

    // Row 1: seats 3, 4, 5 at z = 1.4 facing -z (yaw = π)
    for (let i = 3; i < 6; i++) {
      expect(seats[i]!.z).toBeCloseTo(1.4, 2);
      expect(seats[i]!.yaw).toBeCloseTo(Math.PI, 4);
      expect(seats[i]!.x).toBeCloseTo((i - 3 - 1) * 1.2, 2);
    }
  });

  it("assigns first 6 workers to pod-a seats 0-5", () => {
    const workers = Array.from({ length: 7 }, (_, i) => makeWorker(i + 1));
    const plan = planOffice(workers);
    for (let seat = 0; seat < 6; seat++) {
      expect(plan.placements[workers[seat]!.id]).toEqual({ space: "pod-a", seat });
    }
    // 7th worker goes to pod-b
    expect(plan.placements[workers[6]!.id]).toEqual({ space: "pod-b", seat: 0 });
  });

  it("provides monitor poses for all 6 pod seats", () => {
    for (let seat = 0; seat < 6; seat++) {
      const pose = monitorPoseForSeat(0, 0, seat);
      expect(pose).not.toBeNull();
      expect(pose!.position[1]).toBe(1.06);
      expect(Number.isFinite(pose!.position[0])).toBe(true);
      expect(Number.isFinite(pose!.position[2])).toBe(true);
    }
    // Seat 6 out of bounds returns null
    expect(monitorPoseForSeat(0, 0, 6)).toBeNull();
  });
});

describe("solidsForLayout", () => {
  const agents = Array.from({ length: 6 }, (_, i) => makeWorker(i + 1));
  const layout = layoutFor(agents);
  const solids = solidsForLayout(layout);

  it("exports solid boxes and circles", () => {
    expect(solids.length).toBeGreaterThan(0);
    const boxes = solids.filter((s): s is SolidBox => "w" in s && "d" in s);
    const circles = solids.filter((s): s is SolidCircle => "r" in s);
    expect(boxes.length).toBeGreaterThan(0);
    expect(circles.length).toBeGreaterThan(0);
  });

  it("contains all expected obstacle kinds", () => {
    const kinds = new Set(solids.map((s) => s.kind));
    expect(kinds.has("wall")).toBe(true);
    expect(kinds.has("desk")).toBe(true);
    expect(kinds.has("chair")).toBe(true);
    expect(kinds.has("partition")).toBe(true);
    expect(kinds.has("shelf")).toBe(true);
    expect(kinds.has("whiteboard")).toBe(true);
    expect(kinds.has("credenza")).toBe(true);
    expect(kinds.has("sofa")).toBe(true);
    expect(kinds.has("table")).toBe(true);
    expect(kinds.has("plant")).toBe(true);
  });

  it("renders 6 desks per pod space", () => {
    const podA = layout.spaces.find((s) => s.id === "pod-a")!;
    const podDesks = solids.filter(
      (s): s is SolidBox =>
        s.kind === "desk" &&
        Math.hypot(s.x - podA.x, s.z - podA.z) < HEX_R * 0.7,
    );
    expect(podDesks.length).toBe(6);
  });

  it("creates walls with doorway openings on shared edges", () => {
    const walls = solids.filter((s): s is SolidBox => s.kind === "wall");
    // Shared walls have segments of length (HEX_R - DOOR_W) / 2
    const sharedSegmentLen = (HEX_R - 1.8) / 2;
    const hasDoorwaySegments = walls.some((w) => Math.abs(w.w - sharedSegmentLen) < 0.01);
    expect(hasDoorwaySegments).toBe(true);
  });
});

describe("lounge scoreboard placement", () => {
  // The lounge is the centre hex of the default plan, so every one of its walls can hold a doorway:
  // the board stands on a wall run next to the 180 corner (kit scoreboardFrame), never in a doorway.
  const layout = layoutFor([]);
  const lounge = layout.spaces.find((s) => s.kind === "lounge")!;
  const sb = scoreboardFrame();
  const sbX = lounge.x + sb.x;
  const sbZ = lounge.z + sb.z;
  const loungeSolids = solidsForLayout(layout).filter((s) => Math.hypot(s.x - lounge.x, s.z - lounge.z) < HEX_R);

  it("stands beside a wall, facing into the room and toward the camera side", () => {
    const d = Math.hypot(sbX - lounge.x, sbZ - lounge.z);
    expect(d).toBeGreaterThan(HEX_APOTHEM - 1);
    expect(d).toBeLessThan(HEX_R);
    // Facing (sin yaw, cos yaw) points into the room and toward +x/+z.
    expect(Math.sin(sb.yaw)).toBeGreaterThan(0);
    expect(Math.cos(sb.yaw)).toBeGreaterThan(0);
    expect(Math.sin(sb.yaw) * (lounge.x - sbX) + Math.cos(sb.yaw) * (lounge.z - sbZ)).toBeGreaterThan(0);
  });

  it("never covers a doorway: both board edges stay clear of every doorway gap", () => {
    for (const side of [-1, 1]) {
      const ex = sbX + side * (SCOREBOARD_STAND.w / 2) * Math.cos(sb.yaw);
      const ez = sbZ - side * (SCOREBOARD_STAND.w / 2) * Math.sin(sb.yaw);
      for (let dir = 0; dir < 6; dir++) {
        const door = doorPoint(lounge, dir);
        expect(Math.hypot(ex - door.x, ez - door.z)).toBeGreaterThan(0.9 + 0.2);
      }
    }
  });

  it("has its own collider and keeps clear of the other lounge furniture", () => {
    expect(loungeSolids.some((s) => s.kind === "scoreboard")).toBe(true);
    for (const s of loungeSolids.filter((o) => o.kind !== "wall" && o.kind !== "scoreboard")) {
      expect(Math.hypot(sbX - s.x, sbZ - s.z)).toBeGreaterThan(1.3);
    }
  });
});
