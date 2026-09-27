import { beforeEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { SLAP_HIT_MS, SLAP_MS, WAVE_MS, handPose, handState, triggerHand, type HandPose } from "../src/scene/handGesture";
import { updateWalkHand } from "../src/scene/WalkHand";
import { WALK_BUBBLE_NEAR, bubbleAnchorY } from "../src/state/bonk";
import { BONK_COOLDOWN_MS, GREET_BUSY_LINES, GREET_LINES, GREET_NOD_MS, GREET_RANGE, bonk, bonkState, greet, greetNod, interactionNod, interactionWobble, resetBonks } from "../src/state/bonk";
import { useStore } from "../src/state/store";
import { walkInteraction } from "../src/scene/WalkMode";

const pose = (): HandPose => ({ visible: false, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1 });

describe("first-person hand gestures", () => {
  it("is hidden when idle and after a gesture ends", () => {
    expect(handPose(null, 0, pose()).visible).toBe(false);
    expect(handPose("slap", -5, pose()).visible).toBe(false);
    expect(handPose("slap", SLAP_MS, pose()).visible).toBe(false);
    expect(handPose("wave", WAVE_MS, pose()).visible).toBe(false);
  });

  it("the slap is a quick 250-350 ms swing that reaches the centre of view at the hit frame", () => {
    expect(SLAP_MS).toBeGreaterThanOrEqual(250);
    expect(SLAP_MS).toBeLessThanOrEqual(350);
    const start = handPose("slap", 0, pose());
    const hit = handPose("slap", SLAP_HIT_MS, pose());
    expect(start.visible && hit.visible).toBe(true);
    expect(Math.abs(hit.x)).toBeLessThan(Math.abs(start.x));
    expect(hit.y).toBeGreaterThan(start.y);
    // Beyond the camera's near plane (0.5).
    expect(-hit.z).toBeGreaterThan(0.5);
  });

  it("pulses its scale exactly on the hit frame", () => {
    const at = (t: number) => handPose("slap", t, pose()).scale;
    expect(at(SLAP_HIT_MS)).toBeGreaterThan(1.15);
    expect(at(SLAP_HIT_MS)).toBeGreaterThan(at(SLAP_HIT_MS - 60));
    expect(at(SLAP_HIT_MS)).toBeGreaterThan(at(SLAP_HIT_MS + 60));
    expect(at(10)).toBeCloseTo(1, 2);
    expect(at(SLAP_MS - 10)).toBeCloseTo(1, 2);
  });

  it("the wave raises the hand and waggles it side to side", () => {
    const rz = [0.3, 0.4, 0.5, 0.6, 0.7].map((k) => handPose("wave", WAVE_MS * k, pose()).rz);
    expect(Math.max(...rz)).toBeGreaterThan(0.2);
    expect(Math.min(...rz)).toBeLessThan(-0.2);
    expect(handPose("wave", WAVE_MS * 0.5, pose()).y).toBeGreaterThan(handPose("wave", 5, pose()).y);
  });

  it("updateWalkHand shows the one hand group during a gesture and hides it after, reusing objects", () => {
    const root = new THREE.Group();
    const inner = new THREE.Group();
    root.add(inner);
    const cam = new THREE.PerspectiveCamera();
    cam.position.set(1, 1.7, 2);
    triggerHand("slap", 1000);
    updateWalkHand(root, cam, 1000 + SLAP_HIT_MS);
    expect(root.visible).toBe(true);
    expect(root.position.toArray()).toEqual([1, 1.7, 2]);
    expect(inner.scale.x).toBeGreaterThan(1.15);
    const posObj = inner.position;
    updateWalkHand(root, cam, 1000 + SLAP_MS + 1);
    expect(root.visible).toBe(false);
    expect(handState.gesture).toBeNull();
    expect(inner.position).toBe(posObj);
  });
});

describe("say hi (H)", () => {
  beforeEach(() => { resetBonks(); useStore.setState({ bubbles: {} }); });

  it("replies with a hardcoded friendly line in a greeting bubble", () => {
    expect(GREET_LINES).toEqual(["Hi!", "Hey boss!", "All good here."]);
    const line = greet("a1", 10_000, () => 0.5, false);
    expect(line).toBe("Hey boss!");
    expect(useStore.getState().bubbles.a1).toMatchObject({ text: "Hey boss!", bonk: true, greet: true });
  });

  it("busy agents answer briefly but politely", () => {
    const line = greet("b1", 10_000, () => 0, true);
    expect(GREET_BUSY_LINES).toContain(line);
  });

  it("shares the 2 s cooldown with bonk, both ways", () => {
    expect(bonk("a1", 10_000, () => 0, false)).toBeDefined();
    expect(greet("a1", 10_000 + BONK_COOLDOWN_MS - 1, () => 0, false)).toBeUndefined();
    expect(greet("a1", 10_000 + BONK_COOLDOWN_MS, () => 0, false)).toBe("Hi!");
    expect(bonk("a1", 10_000 + BONK_COOLDOWN_MS + 500, () => 0, false)).toBeUndefined();
  });

  it("a greeted agent nods instead of wobbling", () => {
    greet("a1", 10_000, () => 0, false);
    const b = bonkState("a1");
    expect(interactionWobble(b, 10_000 + 100)).toBe(0);
    expect(interactionNod(b, 10_000 + GREET_NOD_MS / 4)).toBeGreaterThan(0.3);
    expect(interactionNod(b, 10_000 + GREET_NOD_MS)).toBe(0);
    bonk("a1", 20_000, () => 0, false);
    expect(interactionNod(bonkState("a1"), 20_100)).toBe(0);
    expect(interactionWobble(bonkState("a1"), 20_100)).not.toBe(0);
    expect(greetNod(-1)).toBe(0);
  });

  it("H under the crosshair greets a robot within GREET_RANGE and nothing farther", () => {
    const root = new THREE.Group();
    const yaw = new THREE.Group();
    const tilt = new THREE.Group();
    const body = new THREE.Mesh();
    body.userData.robotAgentId = "r1";
    root.add(yaw);
    yaw.add(tilt);
    tilt.add(body);
    root.position.set(0, 0, -(GREET_RANGE - 0.5));
    root.updateMatrixWorld(true);
    const tmp = new THREE.Vector3();
    expect(walkInteraction([{ distance: 2, object: body }], { x: 0, z: 0 }, tmp, "greet")).toEqual({ kind: "greet", id: "r1" });
    root.position.set(0, 0, -(GREET_RANGE + 0.5));
    root.updateMatrixWorld(true);
    expect(walkInteraction([{ distance: 3, object: body }], { x: 0, z: 0 }, tmp, "greet")).toBeUndefined();
  });
});

describe("slap / greeting bubble placement in walk mode", () => {
  const HEAD = 2.35 * 0.72 + 0.1;
  it("sits over the head in the overview and when far", () => {
    expect(bubbleAnchorY(HEAD, 0, 30, -0.8, 1.5, false)).toBe(HEAD);
    expect(bubbleAnchorY(HEAD, 0, 1.7, 0, WALK_BUBBLE_NEAR + 0.5, true)).toBe(HEAD);
  });
  it("comes down into the upper part of the view when you stand next to the robot, whatever the pitch", () => {
    const vHalfFov = (38 / 2) * (Math.PI / 180);
    for (const pitch of [-0.3, -0.12, 0, 0.1])
      for (const [rootY, d] of [[0, 1.0], [0.51, 1.3], [0.51, 1.9], [0, 2.4]] as const) {
        const y = bubbleAnchorY(HEAD, rootY, 1.7, pitch, d, true);
        const aboveCentre = Math.atan2(rootY + y - 1.7, d) - pitch;
        expect(aboveCentre).toBeLessThan(vHalfFov * 0.5); // well inside the top edge
        expect(y).toBeLessThanOrEqual(HEAD);
      }
  });
});
