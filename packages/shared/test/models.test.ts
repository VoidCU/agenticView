import { describe, expect, it } from "vitest";
import { AgentSchema, AgentPatchSchema, EffortSchema, MODEL_CATALOGUE, ProviderSchema, defaultAgent, effectiveEffort, effortsFor, findModel, modelLabel } from "../src/index.js";

describe("model catalogue", () => {
  it("covers every provider with unique ids and valid efforts", () => {
    for (const p of ProviderSchema.options) {
      const cat = MODEL_CATALOGUE[p];
      const ids = cat.models.map((m) => m.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const e of [...cat.defaultEfforts, ...cat.models.flatMap((m) => m.efforts)]) expect(EffortSchema.safeParse(e).success).toBe(true);
    }
  });

  it("uses aliases for Claude and hides effort for Haiku and Gemini", () => {
    expect(MODEL_CATALOGUE.claude.models.map((m) => m.id)).toEqual(["opus", "sonnet", "haiku", "fable"]);
    expect(effortsFor("claude", "opus")).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(effortsFor("claude", "haiku")).toEqual([]);
    expect(effortsFor("gemini", null)).toEqual([]);
    expect(effortsFor("gemini", "pro")).toEqual([]);
  });

  it("Codex efforts follow the model; custom ids fall back to the provider default set", () => {
    expect(effortsFor("codex", "gpt-6-sol")).toContain("max");
    expect(effortsFor("codex", "gpt-6-sol")).not.toContain("ultra");
    expect(effortsFor("codex", "gpt-5.5")).not.toContain("max");
    expect(effortsFor("codex", "my-custom")).toEqual(["low", "medium", "high"]);
  });

  it("effectiveEffort drops unsupported levels", () => {
    expect(effectiveEffort("claude", "opus", "max")).toBe("max");
    expect(effectiveEffort("claude", "haiku", "high")).toBeNull();
    expect(effectiveEffort("claude", "opus", "ultra")).toBeNull();
    expect(effectiveEffort("gemini", "pro", "high")).toBeNull();
    expect(effectiveEffort("codex", "gpt-5.5", "xhigh")).toBe("xhigh");
    expect(effectiveEffort("codex", null, null)).toBeNull();
  });

  it("labels known and custom models", () => {
    expect(findModel("claude", "opus")?.label).toMatch(/Opus/);
    expect(modelLabel("claude", "opus")).toBe("Opus");
    expect(modelLabel("claude", "claude-opus-5-5")).toBe("claude-opus-5-5");
    expect(modelLabel("claude", null)).toBeNull();
  });
});

describe("agent effort persistence", () => {
  it("defaults to null and round-trips; old agents without effort still parse", () => {
    const a = defaultAgent({ name: "A", role: "worker", scope: "project", specialty: "" });
    expect(a.effort).toBeNull();
    const withEffort = { ...a, effort: "high" };
    expect(AgentSchema.parse(withEffort).effort).toBe("high");
    const { effort: _e, ...legacy } = a;
    expect(AgentSchema.safeParse(legacy).success).toBe(true);
  });

  it("a patch without effort/description leaves them out", () => {
    const patch = AgentPatchSchema.parse({ name: "B" });
    expect(patch).toEqual({ name: "B" });
    expect(AgentPatchSchema.parse({ effort: null }).effort).toBeNull();
  });
});
