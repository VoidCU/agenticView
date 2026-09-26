import { describe, it, expect, vi, beforeEach } from "vitest";
import { Orchestrator, type WorldDeps } from "../src/manager/orchestrator.js";
import type { Runtime } from "../src/runtimes/types.js";
import type { Agent } from "@agenticview/shared";
import { defaultAgent } from "@agenticview/shared";

// ── minimal stubs ──────────────────────────────────────────────────────────────

function makeRuntime(ok = true): Runtime {
  return {
    check: async () => ({ provider: "codex", ok }),
    run: async () => ({ stopReason: "done", text: "ok" }),
  } as unknown as Runtime;
}

function makeWorker(overrides: Partial<Agent> = {}): Agent {
  return defaultAgent({
    id: "w1",
    name: "Worker",
    role: "worker",
    scope: "project",
    specialty: "dev",
    provider: "claude",
    ...overrides,
  });
}

function makeDeps(overrides: Partial<WorldDeps> = {}): WorldDeps {
  return {
    world: { kind: "project", projectPath: "/tmp/proj" },
    root: "/tmp/root",
    registry: {
      get: async () => undefined,
      list: async () => [],
      update: async () => undefined as unknown as Agent,
      ensureManager: async () => {},
    } as unknown as WorldDeps["registry"],
    tasks: {
      get: async () => undefined,
      list: async () => [],
      transition: async () => undefined,
      log: async () => {},
    } as unknown as WorldDeps["tasks"],
    runtimes: new Map([
      ["codex", makeRuntime(true)],
      ["antigravity", makeRuntime(true)],
      ["claude-session", makeRuntime(true)],
    ] as [import("@agenticview/shared").Provider, Runtime][]),
    toolRegistry: { register: () => ({ token: "t" }), release: () => {} } as unknown as WorldDeps["toolRegistry"],
    bus: { emit: () => {}, on: () => {} } as unknown as WorldDeps["bus"],
    settings: () => ({
      defaultProvider: null,
      defaultModel: null,
      maxConcurrentRuns: 3,
      limitPolicy: "auto",
      failoverOrder: ["codex", "antigravity", "claude-session"],
      loungeBreaks: true,
      preferCheapModels: false,
      idleLoungeMinutes: 0,
      globalDefaultProvider: null,
      globalDefaultModel: null,
      providerModels: {},
    }),
    info: async () => ({ kind: "project", name: "Test", projectPath: "/tmp/proj", knownProjects: [] }),
    bridgeUrl: () => "http://localhost",
    knownProjects: () => [],
    usageTracker: {
      getProviderLimit: () => undefined,
      recordFailure: () => ({ limited: false }),
      recordSuccess: () => {},
      getSessionModelLimits: () => ({}),
      clearProviderLimit: () => {},
    } as unknown as WorldDeps["usageTracker"],
    reviveDelayMs: 0,
    reviveClearMs: 0,
    ...overrides,
  };
}

// ── pickReviveProvider tests ───────────────────────────────────────────────────

describe("pickReviveProvider – failoverOrder", () => {
  it("picks the next provider after the failed one in failoverOrder", () => {
    const deps = makeDeps();
    const orch = new Orchestrator(deps);
    // failoverOrder = ['codex', 'antigravity', 'claude-session']
    // failed = 'codex' → next is 'antigravity'
    const result = orch.pickReviveProvider("codex");
    expect(result?.provider).toBe("antigravity");
  });

  it("wraps around when the failed provider is the last in the list", () => {
    const deps = makeDeps();
    const orch = new Orchestrator(deps);
    // failed = 'claude-session' → wraps to 'codex'
    const result = orch.pickReviveProvider("claude-session");
    expect(result?.provider).toBe("codex");
  });

  it("skips providers not in the runtimes map", () => {
    const deps = makeDeps({
      runtimes: new Map([
        // only antigravity and claude-session configured, not codex
        ["antigravity", makeRuntime(true)],
        ["claude-session", makeRuntime(true)],
      ] as [import("@agenticview/shared").Provider, Runtime][]),
    });
    const orch = new Orchestrator(deps);
    // failed = 'codex', next in order is 'antigravity' but codex not in runtimes either
    const result = orch.pickReviveProvider("codex");
    expect(result?.provider).toBe("antigravity");
  });

  it("skips limited providers", () => {
    const deps = makeDeps({
      usageTracker: {
        getProviderLimit: (p: import("@agenticview/shared").Provider) =>
          p === "antigravity" ? { limited: true } : undefined,
        recordFailure: () => ({ limited: false }),
        recordSuccess: () => {},
        getSessionModelLimits: () => ({}),
        clearProviderLimit: () => {},
      } as unknown as WorldDeps["usageTracker"],
    });
    const orch = new Orchestrator(deps);
    // failed = 'codex', antigravity is limited → should pick claude-session
    const result = orch.pickReviveProvider("codex");
    expect(result?.provider).toBe("claude-session");
  });

  it("returns undefined when all providers in failoverOrder are limited or absent", () => {
    const deps = makeDeps({
      runtimes: new Map() as unknown as WorldDeps["runtimes"],
    });
    const orch = new Orchestrator(deps);
    const result = orch.pickReviveProvider("codex");
    expect(result).toBeUndefined();
  });

  it("uses failover default model for known providers", () => {
    const deps = makeDeps();
    const orch = new Orchestrator(deps);
    const result = orch.pickReviveProvider("codex");
    // antigravity failover model is 'gemini-3.8-flash-high'
    expect(result?.model).toBe("gemini-3.8-flash-high");
  });

  it("falls back to REVIVE_CANDIDATES_FALLBACK when failoverOrder is empty", () => {
    const deps = makeDeps({
      settings: () => ({
        defaultProvider: null,
        defaultModel: null,
        maxConcurrentRuns: 3,
        limitPolicy: "auto",
        failoverOrder: [],
        loungeBreaks: true,
        preferCheapModels: false,
        idleLoungeMinutes: 0,
        globalDefaultProvider: null,
        globalDefaultModel: null,
        providerModels: {},
      }),
      runtimes: new Map([
        ["claude-session", makeRuntime(true)],
        ["antigravity", makeRuntime(true)],
        ["codex", makeRuntime(true)],
        ["gemini", makeRuntime(true)],
        ["claude", makeRuntime(true)],
      ] as [import("@agenticview/shared").Provider, Runtime][]),
    });
    const orch = new Orchestrator(deps);
    // With empty failoverOrder the fallback is ["claude-session", "antigravity", "codex", "gemini", "claude"]
    // failed = 'claude', first non-failed in fallback is 'claude-session'
    const result = orch.pickReviveProvider("claude");
    expect(result?.provider).toBe("claude-session");
  });
});

// ── crash handling ─────────────────────────────────────────────────────────────

describe("crash error classification triggers revive", () => {
  it("classifyError returns 'crash' for unexpected errors", async () => {
    const { classifyError } = await import("../src/runtimes/errors.js");
    expect(classifyError("process exited with signal SIGSEGV")).toBe("crash");
    expect(classifyError("out of memory")).toBe("crash");
    expect(classifyError("ECONNRESET")).toBe("crash");
  });

  it("classifyError still returns 'quota' for quota errors", async () => {
    const { classifyError } = await import("../src/runtimes/errors.js");
    expect(classifyError("usage limit reached")).toBe("quota");
  });

  it("classifyError still returns 'rate-limit' for rate-limit errors", async () => {
    const { classifyError } = await import("../src/runtimes/errors.js");
    expect(classifyError("rate limit exceeded")).toBe("rate-limit");
  });
});

// ── failoverOrder in settings schema ──────────────────────────────────────────

describe("ProjectSettingsSchema includes failoverOrder", () => {
  it("defaults to ['codex', 'antigravity', 'claude-session']", async () => {
    const { ProjectSettingsSchema } = await import("@agenticview/shared");
    const s = ProjectSettingsSchema.parse({});
    expect(s.failoverOrder).toEqual(["codex", "antigravity", "claude-session"]);
  });

  it("accepts a custom order", async () => {
    const { ProjectSettingsSchema } = await import("@agenticview/shared");
    const s = ProjectSettingsSchema.parse({ failoverOrder: ["antigravity", "codex"] });
    expect(s.failoverOrder).toEqual(["antigravity", "codex"]);
  });

  it("accepts an empty list to disable failover", async () => {
    const { ProjectSettingsSchema } = await import("@agenticview/shared");
    const s = ProjectSettingsSchema.parse({ failoverOrder: [] });
    expect(s.failoverOrder).toEqual([]);
  });
});
