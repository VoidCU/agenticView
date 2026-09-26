import { describe, it, expect } from "vitest";
import {
  HEX_R,
  HEX_APOTHEM,
  POD_SEATS,
  seatLocal,
  seatPose,
  buildSpaces,
  planOffice,
  type Agent,
} from "@agenticview/shared";
import { layoutFor } from "../src/scene/layout";
import { solidsForLayout, type SolidBox, type SolidCircle } from "../src/scene/solids";
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
  const spaces = buildSpaces(1);
  const lounge = spaces.find((s) => s.kind === "lounge")!;
  const layout = layoutFor([]);
  const loungeSolids = solidsForLayout(layout).filter(
    (s) => Math.hypot(s.x - lounge.x, s.z - lounge.z) < HEX_R,
  );

  // Scoreboard location as configured in LoungeScoreboard.tsx
  const angle = 210 * DEG;
  const dist = HEX_APOTHEM - 0.08;
  const sbX = lounge.x + dist * Math.cos(angle);
  const sbZ = lounge.z + dist * Math.sin(angle);

  it("is placed on the clear wall facing the camera without overlapping furniture", () => {
    // Scoreboard should be near the outer wall at 210 degrees
    const wallDist = Math.hypot(sbX - lounge.x, sbZ - lounge.z);
    expect(wallDist).toBeCloseTo(HEX_APOTHEM - 0.08, 2);

    // Normal points toward center: (lounge.x - sbX, lounge.z - sbZ)
    // At angle 210°, vector to center has positive X and positive Z (facing +X, +Z camera)
    const normalX = lounge.x - sbX;
    const normalZ = lounge.z - sbZ;
    expect(normalX).toBeGreaterThan(0);
    expect(normalZ).toBeGreaterThan(0);

    // Verify distance to all interior furniture (excluding walls)
    const nonWallSolids = loungeSolids.filter((s) => s.kind !== "wall");
    for (const solid of nonWallSolids) {
      const d = Math.hypot(sbX - solid.x, sbZ - solid.z);
      // All furniture should be at least 1.5 units away from scoreboard
      expect(d).toBeGreaterThan(1.5);
    }
  });

  it("is clear of the kitchenette at corner 240 and sofa at corner 180", () => {
    const k240Dist = (4.6 * HEX_R) / 6;
    const kx = lounge.x + k240Dist * Math.cos(240 * DEG);
    const kz = lounge.z + k240Dist * Math.sin(240 * DEG);
    expect(Math.hypot(sbX - kx, sbZ - kz)).toBeGreaterThan(2.0);

    const s180Dist = (4.5 * HEX_R) / 6;
    const sx = lounge.x + s180Dist * Math.cos(180 * DEG);
    const sz = lounge.z + s180Dist * Math.sin(180 * DEG);
    expect(Math.hypot(sbX - sx, sbZ - sz)).toBeGreaterThan(2.0);
  });
});
