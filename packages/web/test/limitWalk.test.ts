import { describe, expect, it } from "vitest";
import { route, spaceAt, type Agent } from "@agenticview/shared";
import { layoutFor } from "../src/scene/layout";
import { computeTargets, reportSpot } from "../src/scene/targets";
import { isFaintedCrash, limitWalk, limitWalkBubble } from "../src/scene/breaks";
import { buildColliders } from "../src/scene/colliders";
import { agent, manager } from "./fixtures";

const NOW = Date.parse("2026-09-27T10:00:00.000Z");
const w = (i: number, over: Partial<Agent> = {}) =>
  agent({ id: `w_${String(i).padStart(8, "0")}`, name: `W${i}`, provider: "codex", createdAt: `2026-09-25T00:00:${String(i).padStart(2, "0")}.000Z`, ...over });

function targetsFor(list: Agent[]) {
  const layout = layoutFor(list);
  const lounge = layout.spaces.find((s) => s.kind === "lounge");
  return { layout, ...computeTargets({ layout, list, lounge, loungeBreaks: new Map(), prevLoungeAssign: {}, managerId: manager.id, now: NOW }) };
}

const limited = (phase: "fainted" | "reviving" | "done", extra: Partial<NonNullable<Agent["revive"]>> = {}): Partial<Agent> => ({
  revive: { phase, cause: "limit", failedProvider: "codex", failedTaskId: "t1", ...extra },
});

describe("limit walk: phases and bubbles", () => {
  it("fainted = reporting, reviving = deciding, done = switching", () => {
    expect(limitWalk(w(1, limited("fainted")))).toEqual({ phase: "reporting", failedProvider: "codex" });
    expect(limitWalk(w(1, limited("reviving", { switchTo: { provider: "gemini", model: "flash" } })))?.phase).toBe("deciding");
    const sw = limitWalk(w(1, { provider: "gemini", ...limited("done", { switchTo: { provider: "gemini", model: "flash" } }) }))!;
    expect(sw.phase).toBe("switching");
    expect(limitWalkBubble(sw)).toBe("Switching to Gemini!");
    expect(limitWalkBubble(limitWalk(w(1, limited("fainted")))!)).toBe("Hit my Codex limit!");
  });

  it("a crash is not a limit walk: it faints in the lounge", () => {
    const crashed = w(1, { revive: { phase: "fainted", cause: "crash", failedTaskId: "t1" } });
    expect(limitWalk(crashed)).toBeUndefined();
    expect(isFaintedCrash(crashed)).toBe(true);
    expect(isFaintedCrash(w(2, limited("fainted")))).toBe(false);
  });

  it("a revive from an older server (no cause) is treated as a limit unless the limit says crash", () => {
    expect(limitWalk(w(1, { revive: { phase: "fainted" } }))?.phase).toBe("reporting");
    expect(limitWalk(w(1, { revive: { phase: "fainted" }, limit: { limited: true, errorType: "crash" } }))).toBeUndefined();
  });
});

describe("limit walk: targets", () => {
  it("a reporting agent walks to the Manager's desk (through doorways) and the Manager turns to face it", () => {
    const rep = w(1, limited("fainted"));
    const { layout, targets } = targetsFor([manager, rep, w(2)]);
    const office = layout.spaces.find((s) => s.kind === "office")!;
    const t = targets[rep.id]!;
    expect(t).toMatchObject(reportSpot(office, 0));
    expect(spaceAt(layout.spaces, t.x, t.z)?.kind).toBe("office");
    // Facing the Manager, who turned to face it.
    const m = targets[manager.id]!;
    const mPose = layout.poses[manager.id]!;
    expect(m.x).toBeCloseTo(mPose.x);
    expect(Math.atan2(t.x - m.x, t.z - m.z)).toBeCloseTo(m.yaw, 5);
    expect(Math.atan2(m.x - t.x, m.z - t.z)).toBeCloseTo(t.yaw, 1);
    // Reachable from its pod desk through doorways.
    const path = route(layout.spaces, layout.poses[rep.id]!, t);
    expect(path.at(-1)!.x).toBeCloseTo(t.x, 5);
    expect(path.length).toBeGreaterThan(2);
  });

  it("the report spot is open floor (no static collider)", () => {
    const layout = layoutFor([manager, w(1)]);
    const office = layout.spaces.find((s) => s.kind === "office")!;
    const solids = buildColliders(layout, { excludeKinds: ["chair"] });
    for (let slot = 0; slot < 3; slot++) {
      const p = reportSpot(office, slot);
      for (const s of solids) {
        if (s.kind === "circle") expect(Math.hypot(p.x - s.circle.cx, p.z - s.circle.cz)).toBeGreaterThan(s.circle.r);
        else if (s.kind === "box") expect(p.x > s.box.minX && p.x < s.box.maxX && p.z > s.box.minZ && p.z < s.box.maxZ).toBe(false);
        else {
          const dx = p.x - s.obox.cx, dz = p.z - s.obox.cz;
          const lx = dx * s.obox.cos - dz * s.obox.sin, lz = dx * s.obox.sin + dz * s.obox.cos;
          expect(Math.abs(lx) < s.obox.hw && Math.abs(lz) < s.obox.hd).toBe(false);
        }
      }
    }
  });

  it("stays there while deciding; when switching it heads back to its own seat", () => {
    const deciding = w(1, limited("reviving"));
    const a = targetsFor([manager, deciding]);
    const office = a.layout.spaces.find((s) => s.kind === "office")!;
    expect(a.targets[deciding.id]).toMatchObject(reportSpot(office, 0));
    const switching = w(1, limited("done", { switchTo: { provider: "gemini" } }));
    const b = targetsFor([manager, switching]);
    expect(b.targets[switching.id]).toEqual(b.layout.poses[switching.id]);
    // The Manager back at its desk pose.
    expect(b.targets[manager.id]).toEqual(b.layout.poses[manager.id]);
  });

  it("two reporters line up side by side; a crashed agent lies in the lounge instead", () => {
    const r1 = w(1, limited("fainted"));
    const r2 = w(2, limited("fainted"));
    const crash = w(3, { revive: { phase: "fainted", cause: "crash" } });
    const { layout, targets } = targetsFor([manager, r1, r2, crash]);
    expect(Math.hypot(targets[r1.id]!.x - targets[r2.id]!.x, targets[r1.id]!.z - targets[r2.id]!.z)).toBeGreaterThan(0.7);
    expect(spaceAt(layout.spaces, targets[crash.id]!.x, targets[crash.id]!.z)?.kind).toBe("lounge");
  });
});
