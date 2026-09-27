import { describe, expect, it } from "vitest";
import { scoreboardTextureKey } from "../src/scene/LoungeScoreboard";
import type { PlayerStats } from "@agenticview/shared";

describe("lounge scoreboard texture refresh key", () => {
  it("changes when standings change and remains stable for equal standings", () => {
    const initial: PlayerStats[] = [{ playerId: "you", name: "You", wins: 0, losses: 0, draws: 0 }];
    const changed = [{ ...initial[0]!, wins: 1 }];
    expect(scoreboardTextureKey(initial)).toBe(scoreboardTextureKey([{ ...initial[0]! }]));
    expect(scoreboardTextureKey(changed)).not.toBe(scoreboardTextureKey(initial));
  });
});
