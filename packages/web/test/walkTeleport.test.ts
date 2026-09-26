/**
 * Regression: walking into a robot (at its desk and fixed chair) or a sofa sometimes threw the walker
 * noticeably away. Root cause: a walker that started a step already overlapping an obstacle (a chair
 * shoved them in, a long frame) was pushed out through the face OPPOSITE its velocity, i.e. often
 * across the whole obstacle in one frame. Depenetration now goes through the nearest face, is clamped
 * per frame, and never lets the walker go deeper.
 */
import { describe, expect, it } from "vitest";
import { MAX_DEPEN_PER_FRAME, PLAYER_RADIUS, nearbySolids, overlapsAny, penetration, resolveMove, type Solid } from "../src/scene/colliders";
import { ChairField } from "../src/scene/pushChairs";
import { buildColliders } from "../src/scene/colliders";
import { layoutFor } from "../src/scene/layout";
import { movePlayer } from "../src/scene/walkPhysics";
import { agent, manager } from "./fixtures";

const STEP = 4.5 / 60;
const obox = (cx: number, cz: number, w: number, d: number, rot: number): Solid => ({ kind: "obox", obox: { cx, cz, hw: w / 2, hd: d / 2, cos: Math.cos(rot), sin: Math.sin(rot) } });
const desk = obox(0, 0, 1.18, 0.66, 0);
const sofa = obox(3, 1, 2.2, 0.86, 0.6);

describe("deep overlap is resolved gently through the nearest face", () => {
  it("standing still inside a desk: at most MAX_DEPEN_PER_FRAME per frame, always toward the near face", () => {
    // Centre inside the desk, much nearer its +x end: the near exit is +x.
    let p = { x: 0.45, z: 0.05 };
    for (let i = 0; i < 20; i++) {
      const n = resolveMove([desk], p.x, p.z, 0, 0);
      const moved = Math.hypot(n.x - p.x, n.z - p.z);
      expect(moved).toBeLessThanOrEqual(MAX_DEPEN_PER_FRAME + 1e-9);
      expect(n.x).toBeGreaterThanOrEqual(p.x - 1e-9);
      p = n;
    }
    expect(overlapsAny([desk], p.x, p.z, PLAYER_RADIUS)).toBe(false);
    expect(p.x).toBeGreaterThan(0.59); // out the +x end, never the -x end
  });

  it("walking toward the FAR side while overlapping never jumps across (the old bug)", () => {
    // Old resolver: inside + moving -x => snapped to the -x face (about 1.1 units away) in one frame.
    const start = { x: 0.5, z: 0 };
    const n = resolveMove([desk], start.x, start.z, -STEP, 0);
    expect(Math.hypot(n.x - start.x, n.z - start.z)).toBeLessThanOrEqual(STEP + MAX_DEPEN_PER_FRAME);
    expect(n.x).toBeGreaterThan(0);
    // Never deeper than where it started.
    expect(penetration(desk, n.x, n.z, PLAYER_RADIUS, { x: 0, z: 0 })).toBeLessThanOrEqual(penetration(desk, start.x, start.z, PLAYER_RADIUS, { x: 0, z: 0 }) + 1e-9);
  });

  it("deep inside a big round table: eased out radially over several frames, no jump", () => {
    const table: Solid = { kind: "circle", circle: { cx: 0, cz: 0, r: 2.1 } };
    let p = { x: 0.3, z: 0.4 };
    let frames = 0;
    while (overlapsAny([table], p.x, p.z, PLAYER_RADIUS) && frames < 200) {
      const n = resolveMove([table], p.x, p.z, 0, 0);
      expect(Math.hypot(n.x - p.x, n.z - p.z)).toBeLessThanOrEqual(MAX_DEPEN_PER_FRAME + 1e-9);
      p = n;
      frames++;
    }
    expect(frames).toBeGreaterThan(5);
    expect(Math.atan2(p.z, p.x)).toBeCloseTo(Math.atan2(0.4, 0.3), 5);
  });

  it("a fast diagonal approach into a rotated sofa's corner slides, never jumps", () => {
    for (const [ax, az] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0.3, -1], [-1, 0.2]] as const) {
      const len = Math.hypot(ax, az);
      // Start 2.5 units out along the approach direction, walk at twice walk speed (a 30 fps frame).
      let p = { x: 3 - (ax / len) * 2.5, z: 1 - (az / len) * 2.5 };
      for (let i = 0; i < 90; i++) {
        const dx = (ax / len) * STEP * 2;
        const dz = (az / len) * STEP * 2;
        const n = resolveMove([sofa], p.x, p.z, dx, dz);
        expect(Math.hypot(n.x - p.x, n.z - p.z)).toBeLessThanOrEqual(STEP * 2 + 1e-6);
        expect(overlapsAny([sofa], n.x, n.z, PLAYER_RADIUS - 1e-6)).toBe(false);
        p = n;
      }
    }
  });

  it("walking into every seated robot's desk and chair in a real office never moves more than a step", () => {
    const layout = layoutFor([manager, ...Array.from({ length: 6 }, (_, i) => agent({ id: `w${i}`, name: `W${i}` }))]);
    const solids = buildColliders(layout);
    const pod = layout.spaces.find((s) => s.kind === "pod")!;
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2;
      let p = { x: pod.x + Math.cos(ang) * 3, z: pod.z + Math.sin(ang) * 3 };
      for (let i = 0; i < 120; i++) {
        const n = movePlayer(layout.spaces, p.x, p.z, -Math.cos(ang) * STEP, -Math.sin(ang) * STEP, solids);
        expect(Math.hypot(n.x - p.x, n.z - p.z)).toBeLessThanOrEqual(STEP + 1e-6);
        p = n;
      }
    }
  });
});

describe("chairs never shove the walker far in one frame", () => {
  it("a chair gliding into a standing walker eases them out by at most maxPush", () => {
    const f = new ChairField();
    f.sync([{ id: "c", x: 0, z: 0, yaw: 0, pushable: false, first: 0, count: 1 } as never]);
    const p = { x: 0.05, z: 0 }; // walker centre inside the seat
    const blocked = () => false;
    f.interact(p, PLAYER_RADIUS, 1 / 60, blocked, 0, MAX_DEPEN_PER_FRAME);
    expect(Math.hypot(p.x - 0.05, p.z)).toBeLessThanOrEqual(MAX_DEPEN_PER_FRAME + 1e-9);
    expect(p.x).toBeGreaterThan(0.05); // toward the nearer side
  });
});

describe("broad phase", () => {
  it("only nearby solids are considered", () => {
    const layout = layoutFor([manager]);
    const solids = buildColliders(layout);
    const pod = layout.spaces.find((s) => s.kind === "pod")!;
    const near = nearbySolids(solids, pod.x, pod.z + 2, STEP, 0, PLAYER_RADIUS);
    expect(near.length).toBeGreaterThan(0);
    expect(near.length).toBeLessThan(solids.length / 3);
  });
});
