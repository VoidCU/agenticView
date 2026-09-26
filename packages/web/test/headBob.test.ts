import { describe, expect, it } from "vitest";
import { BOB_AMP_X, BOB_AMP_Y, BOB_FREQ, WALK_SPEED, bobWeightStep, headBobSide, headBobY } from "../src/scene/walkPhysics";

describe("walk head-bob", () => {
  it("is millimetre-scale", () => {
    expect(BOB_AMP_Y).toBeLessThanOrEqual(0.01);
    expect(BOB_AMP_X).toBeLessThanOrEqual(0.005);
    for (let p = 0; p < 20; p += 0.1) {
      expect(Math.abs(headBobY(p, 1))).toBeLessThanOrEqual(BOB_AMP_Y + 1e-12);
      expect(Math.abs(headBobSide(p, 1))).toBeLessThanOrEqual(BOB_AMP_X + 1e-12);
    }
  });

  it("steps at a natural walking cadence (about 1.5-2.5 bobs per second at full speed)", () => {
    const hz = (BOB_FREQ * WALK_SPEED) / Math.PI;
    expect(hz).toBeGreaterThan(1.5);
    expect(hz).toBeLessThan(2.5);
  });

  it("eases in when starting, eases out when stopping, and is exactly zero standing still", () => {
    let w = 0;
    w = bobWeightStep(w, WALK_SPEED, 1 / 60);
    expect(w).toBeGreaterThan(0);
    expect(w).toBeLessThan(0.2); // no instant jolt
    for (let i = 0; i < 120; i++) w = bobWeightStep(w, WALK_SPEED, 1 / 60);
    expect(w).toBeGreaterThan(0.95);
    const slow = bobWeightStep(1, WALK_SPEED / 2, 10);
    expect(slow).toBeCloseTo(0.5, 6); // scales with actual speed
    w = bobWeightStep(w, 0, 1 / 60);
    expect(w).toBeGreaterThan(0.8); // eases out, not a snap
    for (let i = 0; i < 600; i++) w = bobWeightStep(w, 0, 1 / 60);
    expect(w).toBe(0);
    expect(headBobY(1.234, w)).toBe(0);
    expect(headBobSide(1.234, w)).toBe(0);
  });
});
