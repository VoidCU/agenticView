import { describe, it, expect } from "vitest";
import { levelAccents } from "../src/scene/accents";
import { fileChipsFor, FILE_CHIP_MS } from "../src/state/store";
import type { FeedItem } from "../src/state/store";

describe("levelAccents", () => {
  it("unlocks cosmetics at levels 2, 3 and 5", () => {
    expect(levelAccents(1)).toEqual({ glowRing: false, secondAntenna: false, crown: false });
    expect(levelAccents(2)).toEqual({ glowRing: true, secondAntenna: false, crown: false });
    expect(levelAccents(3)).toEqual({ glowRing: true, secondAntenna: true, crown: false });
    expect(levelAccents(4)).toEqual({ glowRing: true, secondAntenna: true, crown: false });
    expect(levelAccents(5)).toEqual({ glowRing: true, secondAntenna: true, crown: true });
    expect(levelAccents(9)).toEqual({ glowRing: true, secondAntenna: true, crown: true });
  });
});

describe("fileChipsFor", () => {
  const now = 100_000;
  const item = (ts: number, path: string): FeedItem => ({ ts, taskId: "t", event: { type: "file_changed", path, kind: "modify" } });
  it("keeps the last three recent file changes with a fade factor", () => {
    const feed: FeedItem[] = [
      item(now - 10_000, "old/gone.ts"),
      item(now - 5_000, "src/a.ts"),
      { ts: now - 4_000, taskId: "t", event: { type: "text", text: "x" } },
      item(now - 3_000, "C:\\proj\\src\\b.tsx"),
      item(now - 2_000, "src/c.css"),
      item(now - 1_000, "src/d.ts"),
    ];
    const chips = fileChipsFor(feed, now);
    expect(chips.map((c) => c.name)).toEqual(["b.tsx", "c.css", "d.ts"]);
    expect(chips[0]!.opacity).toBeCloseTo(1 - 3_000 / FILE_CHIP_MS, 5);
    expect(chips[2]!.opacity).toBeCloseTo(1 - 1_000 / FILE_CHIP_MS, 5);
  });
  it("returns nothing for an empty or stale feed", () => {
    expect(fileChipsFor([], now)).toEqual([]);
    expect(fileChipsFor([item(now - FILE_CHIP_MS - 1, "x.ts")], now)).toEqual([]);
  });
});
