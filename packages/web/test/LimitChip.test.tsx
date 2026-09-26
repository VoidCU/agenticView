import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LimitChip, RetryButton, SwitchAgentModal, SwitchProviderModal } from "../src/hud/LimitChip";
import { SettingsModal } from "../src/hud/SettingsModal";
import { ChatPanel } from "../src/hud/ChatPanel";
import { useStore } from "../src/state/store";
import { manager, worker, task, snapshot } from "./fixtures";
import type { LimitInfo } from "@agenticview/shared";
import * as ws from "../src/net/ws";

// vi.spyOn is used instead of vi.mock because vitest's module factory mock has a
// Windows path-resolution issue that prevents the factory from intercepting imports
// in sibling source files. vi.spyOn patches the live ESM binding directly and works
// correctly on all platforms.
// Type inferred from vi.spyOn return — avoids MockInstance vs Mock mismatch
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockApiFetch: any;

beforeEach(() => {
  useStore.getState().reset();
  // Spy on apiFetch and set a default resolved response (empty ok response)
  mockApiFetch = vi.spyOn(ws, "apiFetch").mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ providers: {}, agents: {}, updatedAt: new Date().toISOString() }),
  } as Response);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------- LimitChip ----------

describe("LimitChip", () => {
  it("renders nothing when limit is undefined", () => {
    const { container } = render(<LimitChip limit={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when not limited", () => {
    const { container } = render(<LimitChip limit={{ limited: false }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows quota label with reset time", () => {
    const resetAt = new Date(Date.now() + 3_600_000).toISOString(); // 1h from now
    const limit: LimitInfo = { limited: true, errorType: "quota", reason: "Monthly quota reached", resetAt };
    render(<LimitChip limit={limit} />);
    expect(screen.getByText(/quota hit/i)).toBeInTheDocument();
    expect(screen.getByText(/resets/i)).toBeInTheDocument();
  });

  it("shows rate-limit label with amber chip class", () => {
    const limit: LimitInfo = { limited: true, errorType: "rate-limit" };
    render(<LimitChip limit={limit} />);
    const chip = screen.getByText(/rate limited/i).closest(".chip-limit")!;
    expect(chip).toHaveClass("chip-limit-rate");
  });

  it("shows auth label", () => {
    render(<LimitChip limit={{ limited: true, errorType: "auth" }} />);
    expect(screen.getByText(/auth error/i)).toBeInTheDocument();
  });

  it("shows crash label for unknown errorType", () => {
    render(<LimitChip limit={{ limited: true }} />);
    expect(screen.getByText(/crashed/i)).toBeInTheDocument();
  });

  it("calls onSwitch when Switch button is clicked", async () => {
    const onSwitch = vi.fn();
    render(<LimitChip limit={{ limited: true, errorType: "quota" }} onSwitch={onSwitch} />);
    await userEvent.click(screen.getByRole("button", { name: /switch/i }));
    expect(onSwitch).toHaveBeenCalled();
  });

  it("does not render Switch button when onSwitch is not provided", () => {
    render(<LimitChip limit={{ limited: true, errorType: "quota" }} />);
    expect(screen.queryByRole("button", { name: /switch/i })).not.toBeInTheDocument();
  });
});

// ---------- RetryButton ----------

describe("RetryButton", () => {
  it("calls POST /api/tasks/:id/retry when Retry is clicked", async () => {
    mockApiFetch.mockResolvedValueOnce({ ok: true } as Response);
    render(<RetryButton taskId="t_abc" taskTitle="Build backend" />);
    const btn = screen.getByRole("button", { name: /retry build backend/i });
    await userEvent.click(btn);
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledWith("/api/tasks/t_abc/retry", { method: "POST" }));
  });

  it("shows error label when retry API fails", async () => {
    mockApiFetch.mockResolvedValueOnce({
      ok: false,
      statusText: "Server error",
      json: () => Promise.resolve({ error: "queue full" }),
    } as Response);
    render(<RetryButton taskId="t_fail" taskTitle="Failing task" />);
    await userEvent.click(screen.getByRole("button", { name: /retry failing task/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /retry failing task/i })).toHaveTextContent(/retry \(failed\)/i));
  });
});

// ---------- SwitchAgentModal ----------

describe("SwitchAgentModal", () => {
  it("renders provider select with all providers", () => {
    render(
      <SwitchAgentModal
        agentId="w_test"
        agentName="Pixel"
        currentProvider="claude"
        currentModel={null}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("dialog", { name: /switch pixel/i })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /provider/i })).toBeInTheDocument();
  });

  it("calls POST /api/agents/:id/switch on submit and closes", async () => {
    mockApiFetch.mockResolvedValueOnce({ ok: true } as Response);
    const onClose = vi.fn();
    render(
      <SwitchAgentModal
        agentId="w_abc"
        agentName="Nova"
        currentProvider="claude"
        currentModel={null}
        onClose={onClose}
      />,
    );
    await userEvent.selectOptions(screen.getByRole("combobox", { name: /provider/i }), "codex");
    await userEvent.click(screen.getByRole("button", { name: /^switch$/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/api/agents/w_abc/switch",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("shows error on API failure without closing", async () => {
    mockApiFetch.mockResolvedValueOnce({
      ok: false,
      statusText: "Bad Request",
      json: () => Promise.resolve({ error: "provider unavailable" }),
    } as Response);
    const onClose = vi.fn();
    render(
      <SwitchAgentModal
        agentId="w_abc"
        agentName="Nova"
        currentProvider="claude"
        currentModel={null}
        onClose={onClose}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /^switch$/i }));
    await waitFor(() => expect(screen.getByText(/provider unavailable/i)).toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
  });
});

// ---------- SwitchProviderModal ----------

describe("SwitchProviderModal", () => {
  it("renders with provider heading and switch all button", () => {
    render(<SwitchProviderModal fromProvider="claude" onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/switch all claude agents/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^switch all$/i })).toBeInTheDocument();
  });

  it("calls POST /api/providers/:provider/switch on submit", async () => {
    mockApiFetch.mockResolvedValueOnce({ ok: true } as Response);
    const onClose = vi.fn();
    render(<SwitchProviderModal fromProvider="claude" onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: /^switch all$/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/api/providers/claude/switch",
      expect.objectContaining({ method: "POST" }),
    );
  });
});

// ---------- Limited agent in ChatPanel ----------

describe("ChatPanel with limited agent", () => {
  it("shows LimitChip in chat header for a limited agent", () => {
    const limitedWorker = {
      ...worker,
      limit: { limited: true, errorType: "quota" as const, reason: "Monthly limit hit" },
    };
    useStore.getState().apply(snapshot([limitedWorker], []));
    useStore.setState({ selectedAgentId: limitedWorker.id });
    render(<ChatPanel />);
    expect(screen.getByText(/quota hit/i)).toBeInTheDocument();
  });

  it("shows no LimitChip when agent is not limited", () => {
    useStore.getState().apply(snapshot([worker], []));
    useStore.setState({ selectedAgentId: worker.id });
    render(<ChatPanel />);
    expect(screen.queryByText(/quota hit|rate limited|auth error|crashed/i)).not.toBeInTheDocument();
  });
});

// ---------- Limited provider in SettingsModal ----------

describe("SettingsModal with limited provider", () => {
  it("shows LimitChip and 'Switch all agents' button for a limited provider", async () => {
    useStore.getState().apply(snapshot([manager, worker], []));
    useStore.setState({
      providers: [
        { provider: "claude", ok: true, version: "1.0", limit: { limited: true, errorType: "quota", reason: "Quota hit" } },
        { provider: "codex", ok: false, reason: "not installed" },
        { provider: "claude-session", ok: false, reason: "no worker" },
        { provider: "antigravity", ok: false, reason: "not installed" },
        { provider: "gemini", ok: false, reason: "not installed" },
      ],
    });
    render(<SettingsModal onClose={vi.fn()} />);
    expect(screen.getByText(/quota hit/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /switch all claude agents/i })).toBeInTheDocument();
  });

  it("opens the Usage panel tab", async () => {
    // Mock the limits + usage API calls
    mockApiFetch.mockImplementation((path: string) => {
      if ((path as string).includes("limits")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ providers: {}, updatedAt: new Date().toISOString() }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ agents: {}, providers: {}, updatedAt: new Date().toISOString() }),
      } as Response);
    });
    useStore.getState().apply(snapshot([manager, worker], []));
    render(<SettingsModal onClose={vi.fn()} />);
    const usageTab = screen.getByRole("button", { name: /usage/i });
    await userEvent.click(usageTab);
    await waitFor(() => expect(screen.getByText(/no token usage/i)).toBeInTheDocument());
  });
});

// ---------- Retry in TaskBoard ----------

describe("TaskBoard retry", () => {
  it("shows Retry button for failed tasks", async () => {
    const { TaskBoard } = await import("../src/hud/TaskBoard");
    useStore.getState().apply(
      snapshot(
        [worker],
        [task({ id: "t_fail", title: "Compile error", status: "failed", assigneeId: worker.id })],
      ),
    );
    render(<TaskBoard />);
    expect(screen.getByRole("button", { name: /retry compile error/i })).toBeInTheDocument();
  });

  it("does not show Retry for non-failed tasks", async () => {
    const { TaskBoard } = await import("../src/hud/TaskBoard");
    useStore.getState().apply(
      snapshot(
        [worker],
        [task({ id: "t_run", title: "Build thing", status: "running", assigneeId: worker.id })],
      ),
    );
    render(<TaskBoard />);
    expect(screen.queryByRole("button", { name: /retry build thing/i })).not.toBeInTheDocument();
  });
});
