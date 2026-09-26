import { beforeEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { BONK_ANIM_MS, BONK_BUSY_LINES, BONK_COOLDOWN_MS, BONK_LINES, BONK_LOOK_MS, BONK_RANGE, bonk, bonkLooking, bonkState, bonkWobble, bonkedAt, isBusyAgent, resetBonks } from "../src/state/bonk";
import { task, worker } from "./fixtures";
import { useStore } from "../src/state/store";
import { CHALLENGE_RANGE, walkInteraction } from "../src/scene/WalkMode";

describe("bonk", () => {
  beforeEach(() => { resetBonks(); useStore.setState({ bubbles: {} }); });

  it("shows a hardcoded friendly line as a short bubble", () => {
    const line = bonk("a1", 10_000, () => 0.99);
    expect(line).toBe(BONK_LINES[BONK_LINES.length - 1]);
    const b = useStore.getState().bubbles.a1!;
    expect(b).toMatchObject({ text: line, bonk: true });
    expect(b.until).toBeGreaterThan(10_000);
    expect(b.until - 10_000).toBeLessThanOrEqual(3000);
    expect(BONK_LINES).toEqual(["Hey!", "I'm working!", "Ouch, boss.", "Careful!", "Back to it…"]);
  });

  it("has a 2 s per-agent cooldown", () => {
    expect(BONK_COOLDOWN_MS).toBe(2000);
    expect(bonk("a1", 10_000, () => 0)).toBe("Hey!");
    expect(bonk("a1", 11_999, () => 0)).toBeUndefined();
    expect(bonkedAt("a1")).toBe(10_000);
    expect(bonk("a2", 11_999, () => 0)).toBe("Hey!"); // other agents are independent
    expect(bonk("a1", 12_000, () => 0.3)).toBe(BONK_LINES[1]);
  });

  it("busy agents use the busy lines and only glance; idle agents look at you for a moment", () => {
    expect(bonk("b1", 50_000, () => 0, true)).toBe(BONK_BUSY_LINES[0]);
    expect(BONK_BUSY_LINES).toEqual(["Busy!", "Can't talk — shipping.", "Later, boss."]);
    const busy = bonkState("b1");
    expect(bonkLooking(busy, 50_000 + BONK_ANIM_MS / 2)).toBe(true);
    expect(bonkLooking(busy, 50_000 + BONK_ANIM_MS + 1)).toBe(false); // turned back to the desk
    bonk("i1", 50_000, () => 0, false);
    const idle = bonkState("i1");
    expect(bonkLooking(idle, 50_000 + BONK_ANIM_MS + 1)).toBe(true);
    expect(bonkLooking(idle, 50_000 + BONK_LOOK_MS)).toBe(false);
    expect(bonkState("i1")).toBe(idle); // state object reused, no per-bonk allocation after the first
    bonk("i1", 60_000, () => 0, true);
    expect(bonkState("i1")).toBe(idle);
    expect(idle!.busy).toBe(true);
  });

  it("a worker running a task counts as busy", () => {
    useStore.setState({ agents: { [worker.id]: worker }, tasks: {}, permissions: [], questions: [], feed: {} } as never);
    expect(isBusyAgent(worker.id)).toBe(false);
    const t = task({ id: "t-run", status: "running", assigneeId: worker.id });
    useStore.setState({ tasks: { [t.id]: t } } as never);
    expect(isBusyAgent(worker.id)).toBe(true);
    expect(BONK_BUSY_LINES as readonly string[]).toContain(bonk(worker.id, 90_000));
  });

  it("wobble is a damped squash-and-stretch that ends", () => {
    expect(bonkWobble(-Infinity)).toBe(0);
    expect(bonkWobble(-5)).toBe(0);
    expect(bonkWobble(BONK_ANIM_MS)).toBe(0);
    const peaks = [0.1, 0.3, 0.5, 0.7, 0.9].map((k) => Math.abs(bonkWobble(k * BONK_ANIM_MS)));
    expect(Math.max(...peaks)).toBeGreaterThan(0.2);
    for (let i = 1; i <= 1000; i++) expect(Math.abs(bonkWobble((i / 1000) * BONK_ANIM_MS))).toBeLessThanOrEqual(1);
  });
});

describe("walk-mode crosshair interaction", () => {
  function robotAt(x: number, z: number, id: string) {
    const root = new THREE.Group();
    root.position.set(x, 0, z);
    const yaw = new THREE.Group(); const tilt = new THREE.Group(); const body = new THREE.Group();
    body.userData = { robotAgentId: id };
    const mesh = new THREE.Mesh();
    root.add(yaw); yaw.add(tilt); tilt.add(body); body.add(mesh);
    root.updateMatrixWorld(true);
    return mesh;
  }
  const tmp = new THREE.Vector3();
  const cam = { x: 0, z: 0 };

  it("bonks a robot within range on click or E", () => {
    const hit = [{ distance: 1.2, object: robotAt(0, 1.5, "r1") }];
    expect(walkInteraction(hit, cam, tmp)).toEqual({ kind: "bonk", id: "r1" });
    expect(walkInteraction(hit, cam, tmp, "bonk")).toEqual({ kind: "bonk", id: "r1" });
  });
  it("a farther robot is selected on click and ignored by E", () => {
    const hit = [{ distance: 3, object: robotAt(0, BONK_RANGE + 1.2, "r2") }];
    expect(walkInteraction(hit, cam, tmp)).toEqual({ kind: "select", id: "r2" });
    expect(walkInteraction(hit, cam, tmp, "bonk")).toBeUndefined();
  });
  it("G challenges any agent within a few units to RPS, wherever it is", () => {
    const near = [{ distance: 2.2, object: robotAt(0, CHALLENGE_RANGE - 0.2, "r3") }];
    expect(walkInteraction(near, cam, tmp, "challenge")).toEqual({ kind: "challenge", id: "r3" });
    const far = [{ distance: 5, object: robotAt(0, CHALLENGE_RANGE + 1, "r4") }];
    expect(walkInteraction(far, cam, tmp, "challenge")).toBeUndefined();
    const board = new THREE.Mesh(); board.userData = { boardSpaceId: "pod-a" };
    expect(walkInteraction([{ distance: 1, object: board }], cam, tmp, "challenge")).toBeUndefined();
  });
  it("whiteboards and monitors keep their click actions, but not on E", () => {
    const board = new THREE.Mesh(); board.userData = { boardSpaceId: "pod-a" };
    const mon = new THREE.Mesh(); mon.userData = { agentId: "m1" };
    expect(walkInteraction([{ distance: 2, object: board }], cam, tmp)).toEqual({ kind: "board", id: "pod-a" });
    expect(walkInteraction([{ distance: 2, object: mon }], cam, tmp)).toEqual({ kind: "select", id: "m1" });
    expect(walkInteraction([{ distance: 2, object: board }], cam, tmp, "bonk")).toBeUndefined();
  });
});
