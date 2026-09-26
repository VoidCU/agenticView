import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UsageTracker } from "../../src/manager/usageTracker.js";
import type { Agent } from "@agenticview/shared";

function fakeAgent(id = "w_test"): Agent {
  return {
    id,
    name: "Test",
    role: "worker",
    scope: "project",
    specialty: "testing",
    description: "",
    provider: "codex",
    model: "gpt-5.5",
    effort: null,
    systemPrompt: "",
    tools: { edit: true, shell: true, web: false, screenshot: false },
    permissionMode: "auto",
    appearance: { color: "#5b8cff", accent: "#ffffff", eyes: "round" },
    stats: { xp: 0, level: 1, tasksDone: 0, tasksFailed: 0 },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("UsageTracker", () => {
  let dir: string;
  let tracker: UsageTracker;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "av-usage-"));
    tracker = new UsageTracker(dir);
    await tracker.init();
  });

  afterEach(async () => {
    // persist() is fire-and-forget; wait briefly for any pending writes to finish before cleanup
    await new Promise((r) => setTimeout(r, 20));
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  });

  describe("recordRun / getUsageReport", () => {
    it("accumulates token usage per agent and provider", async () => {
      const now = new Date().toISOString();
      await tracker.recordRun({
        runId: "r_1",
        taskId: "t_1",
        agentId: "w_a",
        provider: "codex",
        model: "gpt-5.5",
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        timestamp: now,
      });
      await tracker.recordRun({
        runId: "r_2",
        taskId: "t_2",
        agentId: "w_a",
        provider: "codex",
        model: "gpt-5.5",
        inputTokens: 200,
        outputTokens: 80,
        totalTokens: 280,
        timestamp: now,
      });
      const report = tracker.getUsageReport();
      expect(report.agents["w_a"]).toBeDefined();
      expect(report.agents["w_a"]!.session.inputTokens).toBe(300);
      expect(report.agents["w_a"]!.session.outputTokens).toBe(130);
      expect(report.agents["w_a"]!.session.runs).toBe(2);
      expect(report.providers.codex.session.inputTokens).toBe(300);
    });

    it("separates today and last7Days buckets", async () => {
      const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
      const recent = new Date().toISOString();
      await tracker.recordRun({ runId: "r_1", taskId: "t_1", agentId: "w_b", provider: "antigravity", model: "gemini-3.8", inputTokens: 10, outputTokens: 5, totalTokens: 15, timestamp: old });
      await tracker.recordRun({ runId: "r_2", taskId: "t_2", agentId: "w_b", provider: "antigravity", model: "gemini-3.8", inputTokens: 20, outputTokens: 10, totalTokens: 30, timestamp: recent });
      const report = tracker.getUsageReport();
      // Old run is outside 7 days, so last7Days only has the recent one
      expect(report.agents["w_b"]!.last7Days.runs).toBe(1);
      expect(report.agents["w_b"]!.today.runs).toBe(1);
    });
  });

  describe("recordFailure / getProviderLimit / getLimitsReport", () => {
    it("classifies quota errors and stores resetAt", () => {
      const agent = fakeAgent();
      const lim = tracker.recordFailure(agent, "codex", "gpt-5.5", "You've hit your usage limit. Try again at 8:00 AM.");
      expect(lim.limited).toBe(true);
      expect(lim.errorType).toBe("quota");
      expect(lim.resetAt).toBeDefined();

      const providerLim = tracker.getProviderLimit("codex");
      expect(providerLim.limited).toBe(true);
      expect(providerLim.errorType).toBe("quota");
    });

    it("classifies auth errors as auth", () => {
      const agent = fakeAgent();
      const lim = tracker.recordFailure(agent, "codex", "gpt-5.5", "401 Unauthorized: Invalid API key");
      expect(lim.errorType).toBe("auth");
    });

    it("classifies Individual quota reached as quota", () => {
      const agent = fakeAgent("w_agy");
      const lim = tracker.recordFailure(agent, "antigravity", "gemini-3.8", "Individual quota reached. Please upgrade your subscription. Resets in 1h29m24s.");
      expect(lim.limited).toBe(true);
      expect(lim.errorType).toBe("quota");
    });

    it("getLimitsReport includes all providers", () => {
      const agent = fakeAgent();
      tracker.recordFailure(agent, "codex", "gpt-5.5", "usage limit hit");
      const report = tracker.getLimitsReport();
      expect(report.providers.codex).toBeDefined();
      expect(report.providers.codex.limit.limited).toBe(true);
      expect(report.providers.antigravity.limit.limited).toBe(false);
      expect(report.updatedAt).toBeTruthy();
    });
  });

  describe("recordRateLimits", () => {
    it("parses Codex rate_limits primary/secondary windows", () => {
      const limits = tracker.recordRateLimits("codex", "gpt-5.5", {
        primary: { used_percent: 60, window_minutes: 300, resets_at: 1758873600 },
        secondary: { used_percent: 20, window_minutes: 10080 },
      });
      expect(limits).toBeDefined();
      expect(limits!.fiveHour.status).toBe("reported");
      if (limits!.fiveHour.status === "reported") {
        expect(limits!.fiveHour.usedPercent).toBe(60);
        expect(limits!.fiveHour.percentLeft).toBe(40);
        expect(limits!.fiveHour.windowMinutes).toBe(300);
      }
      if (limits!.weekly.status === "reported") {
        expect(limits!.weekly.usedPercent).toBe(20);
        expect(limits!.weekly.percentLeft).toBe(80);
      }
    });

    it("marks provider limited when percentLeft reaches 0", () => {
      tracker.recordRateLimits("codex", "gpt-5.5", {
        primary: { used_percent: 100, window_minutes: 300 },
      });
      const providerLim = tracker.getProviderLimit("codex");
      expect(providerLim.limited).toBe(true);
      expect(providerLim.errorType).toBe("rate-limit");
    });

    it("returns not reported when no windows provided", () => {
      const limits = tracker.recordRateLimits("codex", "gpt-5.5", {});
      // No primary or secondary with used_percent
      if (limits) {
        expect(limits.fiveHour.status).toBe("not reported");
        expect(limits.weekly.status).toBe("not reported");
      }
    });
  });

  describe("recordSuccess / clearProviderLimit", () => {
    it("clears the provider limit on success when resetAt has passed", () => {
      const agent = fakeAgent();
      const past = new Date(Date.now() - 60000).toISOString();
      tracker.recordFailure(agent, "codex", "gpt-5.5", "some error");
      // Manually set a past resetAt
      (tracker as unknown as { providerLimits: Map<string, object> }).providerLimits.set("codex", { limited: true, resetAt: past });
      tracker.recordSuccess(agent, "codex", "gpt-5.5");
      expect(tracker.getProviderLimit("codex").limited).toBe(false);
    });

    it("clearProviderLimit removes the limit immediately", () => {
      const agent = fakeAgent();
      tracker.recordFailure(agent, "codex", "gpt-5.5", "quota hit");
      tracker.clearProviderLimit("codex");
      expect(tracker.getProviderLimit("codex").limited).toBe(false);
    });
  });

  describe("persistence", () => {
    it("persists and restores runs across init() calls", async () => {
      const now = new Date().toISOString();
      await tracker.recordRun({ runId: "r_p", taskId: "t_p", agentId: "w_p", provider: "claude", model: "sonnet", inputTokens: 42, outputTokens: 21, totalTokens: 63, timestamp: now });
      const tracker2 = new UsageTracker(dir);
      await tracker2.init();
      const report = tracker2.getUsageReport();
      expect(report.agents["w_p"]).toBeDefined();
      // session bucket is relative to tracker2's start time; check today/last7Days which persist
      expect(report.agents["w_p"]!.today.runs).toBe(1);
      expect(report.agents["w_p"]!.last7Days.runs).toBe(1);
    });
  });

  describe("recordClaudeLimits / getSessionModelLimits", () => {
    it("stores and retrieves limits for a session+model pair", () => {
      const limits = tracker.recordClaudeLimits("sess1", "claude-sonnet-4-6", {
        five_hour: { used_percentage: 60, resets_at: 1758873600 },
        seven_day: { used_percentage: 20 },
      });
      expect(limits.provider).toBe("claude-session");
      expect(limits.model).toBe("claude-sonnet-4-6");
      expect(limits.fiveHour.status).toBe("reported");
      if (limits.fiveHour.status === "reported") {
        expect(limits.fiveHour.usedPercent).toBe(60);
        expect(limits.fiveHour.percentLeft).toBe(40);
        expect(limits.fiveHour.resetAt).toBeDefined();
        expect(limits.fiveHour.warning).toBeUndefined();
      }
      if (limits.weekly.status === "reported") {
        expect(limits.weekly.usedPercent).toBe(20);
        expect(limits.weekly.percentLeft).toBe(80);
      }

      const sessLimits = tracker.getSessionModelLimits("sess1");
      expect(sessLimits["claude-sonnet-4-6"]).toBeDefined();
      expect(sessLimits["claude-sonnet-4-6"]!.fiveHour.status).toBe("reported");
    });

    it("sets warning=true at >=80% used", () => {
      const limits = tracker.recordClaudeLimits("sess2", "claude-opus-5", {
        five_hour: { used_percentage: 85 },
      });
      expect(limits.fiveHour.status).toBe("reported");
      if (limits.fiveHour.status === "reported") {
        expect(limits.fiveHour.warning).toBe(true);
      }
      if (limits.weekly.status === "reported") {
        expect(limits.weekly.warning).toBeUndefined();
      }
    });

    it("marks provider limited when 100% used", () => {
      tracker.recordClaudeLimits("sess3", "claude-haiku", {
        five_hour: { used_percentage: 100 },
      });
      const providerLim = tracker.getProviderLimit("claude-session");
      expect(providerLim.limited).toBe(true);
      expect(providerLim.errorType).toBe("rate-limit");
    });

    it("returns not reported for missing windows", () => {
      const limits = tracker.recordClaudeLimits("sess4", "claude-sonnet", {});
      expect(limits.fiveHour.status).toBe("not reported");
      expect(limits.weekly.status).toBe("not reported");
    });

    it("getSessionModelLimits returns empty for unknown session", () => {
      expect(tracker.getSessionModelLimits("sess_unknown")).toEqual({});
    });

    it("getLimitsReport includes claude-session model limits from sessions", () => {
      tracker.recordClaudeLimits("sess5", "claude-sonnet-4-6", {
        five_hour: { used_percentage: 50 },
      });
      const report = tracker.getLimitsReport();
      expect(report.providers["claude-session"]).toBeDefined();
      expect(report.providers["claude-session"]!.models["claude-sonnet-4-6"]).toBeDefined();
      const m = report.providers["claude-session"]!.models["claude-sonnet-4-6"]!;
      expect(m.fiveHour.status).toBe("reported");
    });

    it("persists and restores claudeSessionLimits across init() calls", async () => {
      tracker.recordClaudeLimits("sessP", "claude-sonnet", { five_hour: { used_percentage: 70 } });
      await new Promise((r) => setTimeout(r, 30));
      const tracker2 = new UsageTracker(dir);
      await tracker2.init();
      const sessLimits = tracker2.getSessionModelLimits("sessP");
      expect(sessLimits["claude-sonnet"]).toBeDefined();
      if (sessLimits["claude-sonnet"]!.fiveHour.status === "reported") {
        expect(sessLimits["claude-sonnet"]!.fiveHour.usedPercent).toBe(70);
      }
    });
  });
});
