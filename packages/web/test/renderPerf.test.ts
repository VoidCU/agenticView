import { describe, expect, it } from "vitest";
import { SHADOW_GRACE_MS, SHADOW_IDLE_MS, ShadowScheduler, opaqueSortByMaterialType, type SortItem } from "../src/scene/renderTuning";
import { basicMat, cachedMaterialCount, physMat, robotGeoms, stdMat } from "../src/scene/robotParts";
import { fileChipKey } from "../src/scene/Office";
import type { FeedItem } from "../src/state/store";

const item = (id: number, type: string, matId: number, z = 0): SortItem => ({ id, groupOrder: 0, renderOrder: 0, z, material: { id: matId, type } });

describe("opaque sort by material type", () => {
  it("groups materials of one type together (fewer shader program switches), then by material, then front to back", () => {
    const list = [item(1, "MeshPhysicalMaterial", 1), item(2, "MeshStandardMaterial", 2), item(3, "MeshPhysicalMaterial", 3), item(4, "MeshStandardMaterial", 2, -1), item(5, "MeshBasicMaterial", 5)];
    const sorted = [...list].sort(opaqueSortByMaterialType).map((i) => i.id);
    expect(sorted).toEqual([5, 1, 3, 4, 2]);
  });

  it("still honours renderOrder first", () => {
    const a = { ...item(1, "B", 1), renderOrder: 1 };
    const b = item(2, "A", 2);
    expect([a, b].sort(opaqueSortByMaterialType).map((i) => i.id)).toEqual([2, 1]);
  });
});

describe("ShadowScheduler", () => {
  it("refreshes every frame while something moves, then only every SHADOW_IDLE_MS", () => {
    const s = new ShadowScheduler();
    const live = new Map([["a", { x: 0, z: 0 }]]);
    let t = 1000;
    expect(s.tick(t, live)).toBe(true); // first sight counts as motion
    // Moving: every frame.
    for (let i = 0; i < 10; i++) {
      t += 16;
      live.get("a")!.x += 0.05;
      expect(s.tick(t, live)).toBe(true);
    }
    // Still, within the grace period: every frame.
    t += 16;
    expect(s.tick(t, live)).toBe(true);
    // Past the grace period: throttled.
    t += SHADOW_GRACE_MS;
    let updates = 0;
    for (let i = 0; i < 60; i++) {
      t += 1000 / 60;
      if (s.tick(t, live)) updates++;
    }
    expect(updates).toBeLessThanOrEqual(Math.ceil(1000 / SHADOW_IDLE_MS) + 1);
    expect(updates).toBeGreaterThanOrEqual(Math.floor(1000 / SHADOW_IDLE_MS) - 1);
  });

  it("a drag (forceMotion), a robot leaving and poke() all trigger a refresh", () => {
    const s = new ShadowScheduler();
    const live = new Map([["a", { x: 0, z: 0 }], ["b", { x: 1, z: 1 }]]);
    let t = 0;
    s.tick(t, live);
    t += SHADOW_GRACE_MS + 10;
    s.tick(t, live);
    t += 16;
    expect(s.tick(t, live)).toBe(false);
    expect(s.tick((t += 16), live, true)).toBe(true);
    t += SHADOW_GRACE_MS + 10;
    s.tick(t, live);
    live.delete("b");
    expect(s.tick((t += 16), live)).toBe(true);
    t += SHADOW_GRACE_MS + 10;
    s.tick(t, live);
    expect(s.tick((t += 16), live)).toBe(false);
    s.poke();
    expect(s.tick((t += 16), live)).toBe(true);
  });
});

describe("shared robot parts", () => {
  it("geometry is one set for every robot", () => {
    expect(robotGeoms()).toBe(robotGeoms());
    expect(robotGeoms().body.parameters.radius).toBe(0.6);
  });

  it("static materials are cached by their parameters", () => {
    const before = cachedMaterialCount();
    const a = stdMat({ color: "#2a2d38", roughness: 0.5, metalness: 0.3 });
    expect(stdMat({ color: "#2a2d38", roughness: 0.5, metalness: 0.3 })).toBe(a);
    expect(stdMat({ color: "#2a2d38", roughness: 0.55, metalness: 0.3 })).not.toBe(a);
    const p = physMat({ color: "#5b8cff", roughness: 0.3, metalness: 0.12, clearcoat: 0.5, clearcoatRoughness: 0.2 });
    expect(physMat({ color: "#5b8cff", roughness: 0.3, metalness: 0.12, clearcoat: 0.5, clearcoatRoughness: 0.2 })).toBe(p);
    const glow = stdMat({ color: "#22c55e", emissive: "#22c55e", emissiveIntensity: 1.6, toneMapped: false });
    expect(glow.toneMapped).toBe(false);
    expect(glow.emissiveIntensity).toBe(1.6);
    const b = basicMat({ color: "#ff00ff", opacity: 0.22 });
    expect(b.transparent).toBe(true);
    expect(cachedMaterialCount()).toBe(before + 5);
  });
});

describe("fileChipKey", () => {
  const file = (ts: number, path: string): FeedItem => ({ ts, taskId: "t", event: { type: "file_changed", path, kind: "modify" } });
  const text = (ts: number): FeedItem => ({ ts, taskId: "t", event: { type: "text", text: "hi" } });
  it("changes only when a file event arrives, not on other streamed events", () => {
    const feed = [file(1, "a.ts"), text(2)];
    const k1 = fileChipKey(feed);
    expect(fileChipKey([...feed, text(3), text(4)])).toBe(k1);
    expect(fileChipKey([...feed, file(5, "b.ts")])).not.toBe(k1);
    expect(fileChipKey(undefined)).toBe("");
  });
});
