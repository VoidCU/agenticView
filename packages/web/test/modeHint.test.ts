import { describe, it, expect } from "vitest";
import { modeHint } from "../src/hud/modeHint";

describe("modeHint", () => {
  it("describes what each provider really does for each permission mode", () => {
    expect(modeHint("claude", "ask")).toMatch(/Allow\/Deny|asks you/i);
    expect(modeHint("claude", "auto-edit")).toMatch(/edits.*without asking|shell.*ask/i);
    expect(modeHint("claude", "auto")).toMatch(/never asks/i);
    expect(modeHint("codex", "ask")).toMatch(/read-only/i);
    expect(modeHint("codex", "auto-edit")).toMatch(/workspace/i);
    expect(modeHint("codex", "auto-edit")).toMatch(/Windows/i);
    expect(modeHint("codex", "auto")).toMatch(/full access/i);
    expect(modeHint("gemini", "ask")).toMatch(/default|reject/i);
    expect(modeHint("gemini", "auto-edit")).toMatch(/edits/i);
    expect(modeHint("gemini", "auto")).toMatch(/yolo|everything/i);
  });
});
