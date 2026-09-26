/**
 * Tests for Claude Code session plan-limits display:
 * - formatResetAt formatting function
 * - ClaudeWindowLine component (text format, warning and red states)
 * - ClaudeModelLimits block
 * - SessionsModal shows per-session claudeLimits
 * - UsagePanel LimitsSection shows statusline hint when nothing reported
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { formatResetAt, ClaudeWindowLine, ClaudeModelLimits } from "../src/hud/UsagePanel";
import { SessionsModal } from "../src/hud/sessions";
import { useStore } from "../src/state/store";
import type { ProviderModelLimits, WindowLimit, WorkerSessionInfo } from "@agenticview/shared";

beforeEach(() => {
  useStore.getState().reset();
});

// ---- formatResetAt ----

describe("formatResetAt", () => {
  const NOW = 1_700_000_000_000; // fixed reference time

  it("returns empty string for invalid ISO", () => {
    expect(formatResetAt("not-a-date", NOW)).toBe("");
  });

  it("returns 'now' for the present or past", () => {
    expect(formatResetAt(new Date(NOW).toISOString(), NOW)).toBe("now");
    expect(formatResetAt(new Date(NOW - 5000).toISOString(), NOW)).toBe("now");
  });

  it("formats minutes-only when < 60 min away", () => {
    const iso = new Date(NOW + 45 * 60_000).toISOString();
    expect(formatResetAt(iso, NOW)).toBe("in 45m");
  });

  it("formats hours+minutes for 1–23 h away", () => {
    const iso = new Date(NOW + (2 * 3600 + 10 * 60) * 1000).toISOString();
    expect(formatResetAt(iso, NOW)).toMatch(/^in 2h 10m$/);
  });

  it("formats hours-only when minutes = 0", () => {
    const iso = new Date(NOW + 3 * 3600_000).toISOString();
    expect(formatResetAt(iso, NOW)).toBe("in 3h");
  });

  it("formats as weekday+time for >= 24 h away", () => {
    const iso = new Date(NOW + 48 * 3600_000).toISOString();
    const result = formatResetAt(iso, NOW);
    // Should look like "Mon 09:00" or similar (locale-dependent but has a space)
    expect(result).toMatch(/\w+\s\d{1,2}:\d{2}/);
  });
});

// ---- ClaudeWindowLine ----

describe("ClaudeWindowLine", () => {
  const NOW = 1_700_000_000_000;
  const resetAt = new Date(NOW + 2 * 3600_000 + 10 * 60_000).toISOString(); // 2h10m from now

  it("shows 'not reported' for not-reported window", () => {
    const w: WindowLimit = { status: "not reported" };
    render(<ClaudeWindowLine w={w} label="5h" now={NOW} />);
    expect(screen.getByText(/not reported/i)).toBeInTheDocument();
    expect(screen.getByText("5h:")).toBeInTheDocument();
  });

  it("shows percentLeft and reset time for a reported window", () => {
    const w: WindowLimit = { status: "reported", percentLeft: 72, usedPercent: 28, resetAt };
    render(<ClaudeWindowLine w={w} label="5h" now={NOW} />);
    expect(screen.getByText(/72% left/)).toBeInTheDocument();
    expect(screen.getByText(/in 2h 10m/)).toBeInTheDocument();
  });

  it("applies warn class and icon when warning:true", () => {
    const w: WindowLimit = { status: "reported", percentLeft: 15, usedPercent: 85, warning: true, resetAt };
    const { container } = render(<ClaudeWindowLine w={w} label="5h" now={NOW} />);
    expect(container.querySelector(".claude-window-warn")).toBeInTheDocument();
    expect(screen.getByText("!")).toBeInTheDocument();
  });

  it("applies red class when isLimited=true", () => {
    const w: WindowLimit = { status: "reported", percentLeft: 5, usedPercent: 95, warning: true, resetAt };
    const { container } = render(<ClaudeWindowLine w={w} label="Week" now={NOW} isLimited />);
    expect(container.querySelector(".claude-window-red")).toBeInTheDocument();
  });

  it("applies red class when percentLeft is 0", () => {
    const w: WindowLimit = { status: "reported", percentLeft: 0, usedPercent: 100, warning: true, resetAt };
    const { container } = render(<ClaudeWindowLine w={w} label="5h" now={NOW} />);
    expect(container.querySelector(".claude-window-red")).toBeInTheDocument();
  });

  it("shows no icon and no warn/red class for a healthy window", () => {
    const w: WindowLimit = { status: "reported", percentLeft: 80, usedPercent: 20 };
    const { container } = render(<ClaudeWindowLine w={w} label="Week" now={NOW} />);
    expect(container.querySelector(".claude-window-warn")).toBeNull();
    expect(container.querySelector(".claude-window-red")).toBeNull();
    expect(container.querySelector(".claude-window-icon")).toBeNull();
  });
});

// ---- ClaudeModelLimits ----

describe("ClaudeModelLimits", () => {
  const NOW = 1_700_000_000_000;

  it("renders model name and both windows", () => {
    const ml: ProviderModelLimits = {
      provider: "claude-session",
      model: "claude-sonnet-5",
      fiveHour: { status: "reported", percentLeft: 60, usedPercent: 40 },
      weekly: { status: "reported", percentLeft: 90, usedPercent: 10 },
      updatedAt: new Date(NOW).toISOString(),
    };
    render(<ClaudeModelLimits model="claude-sonnet-5" ml={ml} />);
    expect(screen.getByText("claude-sonnet-5")).toBeInTheDocument();
    expect(screen.getByText("5h:")).toBeInTheDocument();
    expect(screen.getByText("Week:")).toBeInTheDocument();
    expect(screen.getAllByText(/% left/)).toHaveLength(2);
  });
});

// ---- SessionsModal with claudeLimits ----

const sess = (over: Partial<WorkerSessionInfo> & { id: string }): WorkerSessionInfo => ({
  name: over.id,
  model: null,
  cwd: null,
  firstSeen: "2026-09-25T00:00:00.000Z",
  lastSeen: "2026-09-25T00:00:00.000Z",
  named: false,
  online: true,
  currentTaskId: null,
  capacity: 4,
  runs: [],
  agentIds: [],
  ...over,
});

describe("SessionsModal claude limits", () => {

  it("shows the statusline hint when a session has no claudeLimits", () => {
    useStore.setState({ sessions: [sess({ id: "s-a", name: "Main tab" })] });
    render(<SessionsModal onClose={vi.fn()} />);
    // Modal uses createPortal, so use screen (queries document)
    expect(screen.getByText(/agenticview-statusline/)).toBeInTheDocument();
  });

  it("shows per-model limits when claudeLimits are present", () => {
    const claudeLimits: Record<string, ProviderModelLimits> = {
      "claude-sonnet-5": {
        provider: "claude-session",
        model: "claude-sonnet-5",
        fiveHour: { status: "reported", percentLeft: 55, usedPercent: 45 },
        weekly: { status: "reported", percentLeft: 80, usedPercent: 20 },
        updatedAt: "2026-09-25T00:00:00.000Z",
      },
    };
    useStore.setState({
      sessions: [sess({ id: "s-a", name: "Main tab", claudeLimits })],
    });
    render(<SessionsModal onClose={vi.fn()} />);
    expect(screen.getByText("claude-sonnet-5")).toBeInTheDocument();
    expect(screen.getAllByText(/% left/)).toHaveLength(2);
  });

  it("shows warning style on a window that has warning:true", () => {
    const claudeLimits: Record<string, ProviderModelLimits> = {
      "claude-opus-5": {
        provider: "claude-session",
        model: "claude-opus-5",
        fiveHour: { status: "reported", percentLeft: 12, usedPercent: 88, warning: true },
        weekly: { status: "reported", percentLeft: 40, usedPercent: 60 },
        updatedAt: "2026-09-25T00:00:00.000Z",
      },
    };
    useStore.setState({ sessions: [sess({ id: "s-b", name: "Spare", claudeLimits })] });
    render(<SessionsModal onClose={vi.fn()} />);
    // Modal uses createPortal so querySelector must target the document, not container
    expect(document.querySelector(".claude-window-warn")).toBeInTheDocument();
  });
});
