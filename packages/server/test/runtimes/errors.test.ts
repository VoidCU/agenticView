import { describe, it, expect } from "vitest";
import { extractCliError, classifyError, parseResetAt, isLimitActive } from "../../src/runtimes/errors.js";

describe("extractCliError", () => {
  it("filters out 'Reading prompt from stdin...' and returns the actual error line", () => {
    const raw = "Reading prompt from stdin...\nERROR: You've hit your usage limit ... try again at 7:12 AM";
    const cleaned = extractCliError(raw);
    expect(cleaned).toBe("ERROR: You've hit your usage limit ... try again at 7:12 AM");
  });

  it("filters out 'Reading additional input from stdin...' and extracts JSON error message", () => {
    const raw = `Reading additional input from stdin...\n{"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The 'gpt-4o' model is not supported when using Codex with a ChatGPT account."}}`;
    const cleaned = extractCliError(raw);
    expect(cleaned).toBe("The 'gpt-4o' model is not supported when using Codex with a ChatGPT account.");
  });

  it("strips Codex Exec exited with code 1 prefix and extracts prominent error", () => {
    const raw = `Codex Exec exited with code 1: Reading additional input from stdin...\nYou’ve hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at 7:12 AM.`;
    const cleaned = extractCliError(raw);
    expect(cleaned).toBe("You’ve hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at 7:12 AM.");
  });

  it("unwraps stringified JSON error payloads", () => {
    const raw = JSON.stringify({ type: "error", message: "Quota exceeded for quota metric 'Queries' and limit 'Queries per minute'" });
    expect(extractCliError(raw)).toBe("Quota exceeded for quota metric 'Queries' and limit 'Queries per minute'");
  });

  it("handles stderr from agy or gemini", () => {
    const stderr = `Using model gemini-2.5-pro\nError: 403 Forbidden: API key not valid. Please pass a valid API key.`;
    expect(extractCliError(stderr)).toBe("Error: 403 Forbidden: API key not valid. Please pass a valid API key.");
  });
});

describe("classifyError", () => {
  it("classifies usage limits and quota errors as quota", () => {
    expect(classifyError("You've hit your usage limit ... try again at 7:12 AM")).toBe("quota");
    expect(classifyError("Exceeded your current quota, please check your plan and billing details")).toBe("quota");
    expect(classifyError("insufficient_quota: out of credits")).toBe("quota");
    expect(classifyError("Please purchase more credits to continue")).toBe("quota");
  });

  it("classifies rate limit and 429 errors as rate-limit", () => {
    expect(classifyError("429 Too Many Requests: Rate limit exceeded")).toBe("rate-limit");
    expect(classifyError("Rate limit reached for requests per minute (RPM). Please wait 30s.")).toBe("rate-limit");
    expect(classifyError("RESOURCE_EXHAUSTED: Throttling request due to high load")).toBe("rate-limit");
  });

  it("classifies auth and permission errors as auth", () => {
    expect(classifyError("401 Unauthorized: Invalid API key provided")).toBe("auth");
    expect(classifyError("Forbidden: please sign in with `codex login`")).toBe("auth");
    expect(classifyError("Authentication failed: session expired, login required")).toBe("auth");
  });

  it("classifies unexpected errors as crash", () => {
    expect(classifyError("Process killed with signal SIGSEGV")).toBe("crash");
    expect(classifyError("Command failed with exit code 137 (OOM)")).toBe("crash");
    expect(classifyError("SyntaxError: Unexpected token")).toBe("crash");
  });
});

describe("parseResetAt", () => {
  it("parses clock time like '7:12 AM' into ISO string", () => {
    // If now is 03:00 AM on 2026-09-26, 7:12 AM is later today
    const now = new Date("2026-09-26T03:00:00.000Z");
    const result = parseResetAt("ERROR: You've hit your usage limit ... try again at 7:12 AM", now);
    expect(result).toBeDefined();
    const parsed = new Date(result!);
    expect(parsed.getHours()).toBe(7);
    expect(parsed.getMinutes()).toBe(12);
  });

  it("bumps to tomorrow if clock time has already passed today", () => {
    // If now is 10:00 AM on 2026-09-26, 7:12 AM should be tomorrow 2026-09-27
    const now = new Date("2026-09-26T10:00:00.000");
    const result = parseResetAt("You've hit your usage limit ... try again at 7:12 AM", now);
    expect(result).toBeDefined();
    const parsed = new Date(result!);
    expect(parsed.getTime()).toBeGreaterThan(now.getTime());
    expect(parsed.getHours()).toBe(7);
    expect(parsed.getMinutes()).toBe(12);
    expect(parsed.getDate()).toBe(27);
  });

  it("parses relative durations like 'try again in 20 minutes'", () => {
    const now = new Date("2026-09-26T03:00:00.000Z");
    const result = parseResetAt("Rate limit exceeded. Try again in 20 minutes.", now);
    expect(result).toBeDefined();
    expect(new Date(result!).getTime()).toBe(now.getTime() + 20 * 60 * 1000);
  });

  it("parses unix timestamp like 'resets_at: 1758873600'", () => {
    const result = parseResetAt('{"resets_at": 1758873600}');
    expect(result).toBe(new Date(1758873600 * 1000).toISOString());
  });

  it("parses direct ISO string", () => {
    const result = parseResetAt("Reset scheduled for 2026-09-26T12:00:00.000Z");
    expect(result).toBe("2026-09-26T12:00:00.000Z");
  });

  it("returns undefined when no reset time is found", () => {
    expect(parseResetAt("Something went wrong")).toBeUndefined();
  });
});

describe("isLimitActive", () => {
  it("returns true for active limit without resetAt", () => {
    expect(isLimitActive({ limited: true })).toBe(true);
  });

  it("returns true when resetAt is in the future", () => {
    const future = new Date(Date.now() + 60000).toISOString();
    expect(isLimitActive({ limited: true, resetAt: future })).toBe(true);
  });

  it("returns false when resetAt has passed", () => {
    const past = new Date(Date.now() - 60000).toISOString();
    expect(isLimitActive({ limited: true, resetAt: past })).toBe(false);
  });

  it("returns false when limited is false", () => {
    expect(isLimitActive({ limited: false })).toBe(false);
  });
});
