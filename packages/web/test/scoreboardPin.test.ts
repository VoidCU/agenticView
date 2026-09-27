import { describe, expect, it } from "vitest";
import { scoreboardTextureKey } from "../src/scene/LoungeScoreboard";
import { scoreboardFrame } from "../src/scene/kit";

describe("lounge scoreboard", () => {
  it("texture key changes when the user's row changes, even outside the top 6", () => {
    const agents = Array.from({ length: 8 }, (_, i) => ({ playerId: "a" + i, name: "A" + i, wins: 20 - i, losses: 0, draws: 0 }));
    const you = { playerId: "you", name: "You", wins: 0, losses: 3, draws: 0 };
    const before = scoreboardTextureKey([...agents, you]);
    const after = scoreboardTextureKey([...agents, { ...you, wins: 1 }]);
    expect(after).not.toBe(before);
  });

  it("the stand sits by the 120-degree corner (old lamp spot), away from the 180-degree sofa corner", () => {
    const sb = scoreboardFrame();
    const angle = ((Math.atan2(sb.z, sb.x) * 180) / Math.PI + 360) % 360;
    expect(angle).toBeGreaterThan(60);
    expect(angle).toBeLessThan(140);
    // Far from the 180-degree corner where sofa A stands.
    const sofaA = { x: 7 * Math.cos(Math.PI), z: 7 * Math.sin(Math.PI) };
    expect(Math.hypot(sb.x - sofaA.x, sb.z - sofaA.z)).toBeGreaterThan(4);
  });
});
