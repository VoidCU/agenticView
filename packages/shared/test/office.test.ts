import { describe, it, expect } from "vitest";
import {
  POD_SEATS,
  SEATS_BY_KIND,
  HEX_R,
  WALK_R,
  buildSpaces,
  planOffice,
  planOfficeWithSpaces,
  seatLocal,
  ringsFor,
  podCount,
} from "../src/office.js";
import { defaultAgent } from "../src/agent.js";
import type { Agent } from "../src/agent.js";

// ── Constants ──────────────────────────────────────────────────────────────────

describe("room size constants", () => {
  it("HEX_R is ~40% larger than the old value of 5", () => {
    expect(HEX_R).toBe(7);
  });

  it("WALK_R scales proportionally with HEX_R", () => {
    // Original ratio was 2.85/5 = 0.57; new should be ≥ 0.55
    expect(WALK_R / HEX_R).toBeGreaterThanOrEqual(0.55);
  });

  it("pod seats is 6", () => {
    expect(POD_SEATS).toBe(6);
    expect(SEATS_BY_KIND.pod).toBe(6);
  });

  it("meeting and lounge seat counts are unchanged", () => {
    expect(SEATS_BY_KIND.meeting).toBe(6);
    expect(SEATS_BY_KIND.lounge).toBe(4);
  });
});

// ── 6-desk pod layout ──────────────────────────────────────────────────────────

describe("seatLocal pod (6 desks, 2 rows of 3)", () => {
  it("produces 6 distinct positions", () => {
    const poses = Array.from({ length: 6 }, (_, i) => seatLocal("pod", i));
    const keys = poses.map((p) => `${p.x},${p.z}`);
    expect(new Set(keys).size).toBe(6);
  });

  it("seats 0-2 are in the front row (z < 0)", () => {
    for (let i = 0; i < 3; i++) {
      expect(seatLocal("pod", i).z).toBeLessThan(0);
    }
  });

  it("seats 3-5 are in the back row (z > 0)", () => {
    for (let i = 3; i < 6; i++) {
      expect(seatLocal("pod", i).z).toBeGreaterThan(0);
    }
  });

  it("each row has 3 distinct x positions", () => {
    const frontX = [0, 1, 2].map((i) => seatLocal("pod", i).x);
    expect(new Set(frontX).size).toBe(3);
    const backX = [3, 4, 5].map((i) => seatLocal("pod", i).x);
    expect(new Set(backX).size).toBe(3);
  });

  it("all positions fit within WALK_R", () => {
    for (let i = 0; i < 6; i++) {
      const p = seatLocal("pod", i);
      expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(WALK_R);
    }
  });

  it("front-row yaw is 0 (looks along +z), back-row yaw is PI", () => {
    for (let i = 0; i < 3; i++) expect(seatLocal("pod", i).yaw).toBeCloseTo(0);
    for (let i = 3; i < 6; i++) expect(seatLocal("pod", i).yaw).toBeCloseTo(Math.PI);
  });
});

// ── Seat migration: old seat indices remain valid ──────────────────────────────

function makeWorker(id: string, spaceId: string, seat: number): Agent {
  return defaultAgent({
    id,
    name: id,
    role: "worker",
    scope: "project",
    specialty: "test",
    placement: { space: spaceId, seat },
    createdAt: `2025-01-01T00:00:0${id.slice(-1)}.000Z`,
  });
}

describe("seat migration: old 4-seat indices still valid in 6-seat pods", () => {
  it("planOffice keeps agents at seats 0–3 (old max)", () => {
    const workers = [0, 1, 2, 3].map((seat) => makeWorker(`w${seat}`, "pod-a", seat));
    const plan = planOffice(workers);
    for (let seat = 0; seat < 4; seat++) {
      expect(plan.placements[`w${seat}`]).toMatchObject({ space: "pod-a", seat });
    }
  });

  it("planOffice reseats an agent whose seat index was >= 6 (corrupt/stale)", () => {
    // seat 7 is out of bounds for a 6-seat pod
    const w = makeWorker("w7", "pod-a", 7);
    const plan = planOffice([w]);
    expect(plan.placements["w7"]!.seat).toBeLessThan(6);
  });

  it("planOfficeWithSpaces reseats agents at seat >= 6", () => {
    const spaces = buildSpaces(1);
    const w = makeWorker("wX", "pod-a", 9);
    const plan = planOfficeWithSpaces(spaces, [w]);
    expect(plan.placements["wX"]!.seat).toBeLessThan(6);
  });
});

// ── 7+ agents in one role: pod growth ─────────────────────────────────────────

describe("7+ agents: pod growth and seating", () => {
  it("ringsFor: 6 workers fit in ring 1 (4 pods × 6 = 24 seats)", () => {
    expect(ringsFor(6)).toBe(1);
  });

  it("ringsFor: 23 workers fit in ring 1 (one spare)", () => {
    // ring 1 has 4 pods × 6 seats = 24 desks; ringsFor needs *strictly* more desks than workers.
    expect(ringsFor(23)).toBe(1);
  });

  it("ringsFor: 24 workers need ring 2 (ring 1 exactly full, no spare)", () => {
    expect(ringsFor(24)).toBe(2);
  });

  it("ring 1 has 4 pods with 24 total seats", () => {
    expect(podCount(1) * SEATS_BY_KIND.pod).toBe(24);
  });

  it("planOffice seats 7 workers in pod-a and pod-b without collision", () => {
    const workers = Array.from({ length: 7 }, (_, i) =>
      defaultAgent({
        id: `w${i}`,
        name: `Worker ${i}`,
        role: "worker",
        scope: "project",
        specialty: "dev",
        createdAt: `2025-01-01T00:00:0${i}.000Z`,
      }),
    );
    const plan = planOffice(workers);
    const keys = Object.values(plan.placements).map((p) => `${p.space}#${p.seat}`);
    expect(new Set(keys).size).toBe(7); // no collisions
    // All 7 workers placed
    for (const w of workers) {
      expect(plan.placements[w.id]).toBeDefined();
    }
  });

  it("planOffice seats exactly 6 workers in pod-a before spilling to pod-b", () => {
    const workers = Array.from({ length: 7 }, (_, i) =>
      defaultAgent({
        id: `w${i}`,
        name: `Worker ${i}`,
        role: "worker",
        scope: "project",
        specialty: "dev",
        createdAt: `2025-01-01T00:00:0${i}.000Z`,
      }),
    );
    const plan = planOffice(workers);
    const inPodA = Object.values(plan.placements).filter((p) => p.space === "pod-a");
    expect(inPodA.length).toBe(6);
    const overflow = Object.values(plan.placements).filter((p) => p.space !== "pod-a");
    expect(overflow.length).toBe(1);
  });
});
