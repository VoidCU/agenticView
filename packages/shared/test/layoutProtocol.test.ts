import { describe, it, expect } from "vitest";
import { WorldInfoSchema, type ServerMessage, type Snapshot } from "../src/protocol.js";
import { SocialHubStateSchema, emptySocialHub } from "../src/social.js";
import { defaultLayout } from "../src/office.js";

describe("layout on the wire", () => {
  const world = { kind: "project" as const, name: "x", projectPath: null, knownProjects: [] };

  it("WorldInfo parses with and without a layout", () => {
    expect(WorldInfoSchema.parse(world)).toEqual(world);
    const withLayout = { ...world, layout: defaultLayout(0) };
    expect(WorldInfoSchema.parse(withLayout)).toEqual(withLayout);
    expect(WorldInfoSchema.safeParse({ ...world, layout: { version: 1, rooms: [{ id: "x", kind: "garage", q: 0, r: 0 }] } }).success).toBe(false);
  });

  it("snapshot and layout.updated carry the full layout", () => {
    const layout = defaultLayout(0);
    const snap: Pick<Snapshot, "layout"> = { layout };
    const msg: ServerMessage = { type: "layout.updated", layout };
    expect(snap.layout).toBe(msg.layout);
  });
});

describe("SocialHubState", () => {
  it("empty hub: nothing connected, no items", () => {
    expect(SocialHubStateSchema.parse(emptySocialHub())).toEqual({ connected: { instagram: false, meta: false }, items: [] });
  });
});
