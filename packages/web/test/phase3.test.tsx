/**
 * Phase 3 tests:
 * - Store: limit.request / limit.resolved / Snapshot.limits / brainstorm.updated
 * - Inbox: InboxLimitItem actions (accept, choose other, dismiss)
 * - SettingsModal: limitPolicy and loungeBreaks controls
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useStore } from "../src/state/store";
import { Inbox } from "../src/hud/Inbox";
import { SettingsModal } from "../src/hud/SettingsModal";
import type { ServerMessage } from "@agenticview/shared";
import { manager, worker, task, snapshot } from "./fixtures";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function mkSnapshot(extra: Partial<Extract<ServerMessage, { type: "snapshot" }>> = {}): ServerMessage {
  return {
    type: "snapshot",
    world: { kind: "project", name: "demo", projectPath: "C:/demo", knownProjects: [] },
    agents: [],
    tasks: [],
    providers: [],
    settings: { defaultProvider: null, defaultModel: null, maxConcurrentRuns: 3, limitPolicy: "ask" as const, loungeBreaks: true, preferCheapModels: true },
    permissions: [],
    questions: [],
    ...extra,
  };
}

beforeEach(() => {
  useStore.getState().reset();
  window.location.hash = "#token=test-token";
});

// ---------------------------------------------------------------------------
// Store: limit state management
// ---------------------------------------------------------------------------

describe("store: limit handling", () => {
  it("restores limits from a snapshot", () => {
    useStore.getState().apply(mkSnapshot({
      limits: [
        { id: "lim1", agentId: "w_1", taskId: "t_1", reason: "quota", resetAt: "2026-09-27T00:00:00.000Z" },
      ],
    }));
    const limits = useStore.getState().limits;
    expect(limits).toHaveLength(1);
    expect(limits[0]).toMatchObject({ id: "lim1", agentId: "w_1", taskId: "t_1", reason: "quota" });
  });

  it("adds a limit on limit.request", () => {
    useStore.getState().apply({ type: "limit.request", id: "lim2", agentId: "w_2", taskId: "t_2", reason: "rate-limit", resetAt: "2026-09-27T01:00:00.000Z" });
    const limits = useStore.getState().limits;
    expect(limits).toHaveLength(1);
    expect(limits[0]!.id).toBe("lim2");
  });

  it("removes a limit on limit.resolved", () => {
    useStore.getState().apply({ type: "limit.request", id: "lim3", agentId: "w_3", taskId: "t_3" });
    useStore.getState().apply({ type: "limit.resolved", id: "lim3" });
    expect(useStore.getState().limits).toHaveLength(0);
  });

  it("limit.request carries suggested provider", () => {
    useStore.getState().apply({
      type: "limit.request",
      id: "lim4",
      agentId: "w_4",
      taskId: "t_4",
      suggested: { provider: "gemini", model: "gemini-2.0-flash" },
    });
    const l = useStore.getState().limits[0]!;
    expect(l.suggested?.provider).toBe("gemini");
    expect(l.suggested?.model).toBe("gemini-2.0-flash");
  });

  it("snapshot replaces stale limits", () => {
    useStore.getState().apply({ type: "limit.request", id: "old", agentId: "w_1", taskId: "t_1" });
    useStore.getState().apply(mkSnapshot()); // no limits in snapshot
    expect(useStore.getState().limits).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Store: brainstorm.updated mapping
// ---------------------------------------------------------------------------

describe("store: brainstorm.updated", () => {
  it("maps protocol message to BrainstormState correctly", () => {
    const msg: ServerMessage = {
      type: "brainstorm.updated",
      managerId: "m_1",
      requestTaskId: "t_1",
      topic: "Best testing framework?",
      participants: [
        { agentId: "w_1", name: "Pixel", answer: "Vitest", done: true },
        { agentId: "w_2", name: "Byte", done: false },
      ],
      skipped: [],
      complete: false,
    };
    useStore.getState().apply(msg);
    const bs = useStore.getState().brainstorm!;
    expect(bs.topic).toBe("Best testing framework?");
    expect(bs.participants).toEqual(["Pixel", "Byte"]);
    expect(bs.answers).toEqual(["Vitest"]);
    expect(bs.complete).toBe(false);
  });

  it("sets complete flag when brainstorm finishes", () => {
    useStore.getState().apply({
      type: "brainstorm.updated",
      managerId: "m_1",
      requestTaskId: "t_1",
      topic: "Done?",
      participants: [{ agentId: "w_1", name: "Pixel", answer: "Yes", done: true }],
      skipped: [],
      complete: true,
    });
    expect(useStore.getState().brainstorm!.complete).toBe(true);
    expect(useStore.getState().brainstorm!.answers).toEqual(["Yes"]);
  });
});

// ---------------------------------------------------------------------------
// Inbox: InboxLimitItem actions
// ---------------------------------------------------------------------------

describe("Inbox: limit items", () => {
  it("shows limit item with agent name, task and reason", () => {
    useStore.getState().apply(snapshot([worker], [task({ id: "t1", title: "Deploy app", assigneeId: worker.id })]));
    useStore.setState({
      limits: [{ id: "lim1", agentId: worker.id, taskId: "t1", reason: "quota hit", suggested: { provider: "gemini" } }],
    });

    render(<Inbox onClose={vi.fn()} />);

    expect(screen.getByText("Pixel")).toBeInTheDocument();
    expect(screen.getByText(/Deploy app/)).toBeInTheDocument();
    expect(screen.getByText(/quota hit/)).toBeInTheDocument();
    expect(screen.getByTestId("inbox-limit-lim1")).toBeInTheDocument();
  });

  it("Accept button sends limit.respond with accept + suggested provider", async () => {
    const send = vi.fn();
    useStore.getState().apply(snapshot([worker], [task({ id: "t1", title: "Deploy", assigneeId: worker.id })]));
    useStore.setState({
      send,
      limits: [{ id: "lim1", agentId: worker.id, taskId: "t1", reason: "quota", suggested: { provider: "gemini", model: "gemini-2.0-flash" } }],
    });

    render(<Inbox onClose={vi.fn()} />);

    const acceptBtn = screen.getByRole("button", { name: /accept/i });
    await userEvent.click(acceptBtn);

    expect(send).toHaveBeenCalledWith({
      type: "limit.respond",
      id: "lim1",
      answer: "accept",
      provider: "gemini",
      model: "gemini-2.0-flash",
    });
  });

  it("Dismiss button sends limit.respond with dismiss", async () => {
    const send = vi.fn();
    useStore.getState().apply(snapshot([worker], [task({ id: "t1", title: "Deploy", assigneeId: worker.id })]));
    useStore.setState({
      send,
      limits: [{ id: "lim2", agentId: worker.id, taskId: "t1", reason: "rate-limit", suggested: { provider: "codex" } }],
    });

    render(<Inbox onClose={vi.fn()} />);

    const dismissBtn = screen.getByRole("button", { name: /dismiss.*pixel/i });
    await userEvent.click(dismissBtn);

    expect(send).toHaveBeenCalledWith({ type: "limit.respond", id: "lim2", answer: "dismiss" });
  });

  it("Choose other shows provider/model picker and sends limit.respond with choose", async () => {
    const send = vi.fn();
    useStore.getState().apply(snapshot([worker], [task({ id: "t1", title: "Deploy", assigneeId: worker.id })]));
    useStore.setState({
      send,
      limits: [{ id: "lim3", agentId: worker.id, taskId: "t1", reason: "quota", suggested: { provider: "gemini" } }],
    });

    render(<Inbox onClose={vi.fn()} />);

    const chooseBtn = screen.getByRole("button", { name: /choose other/i });
    await userEvent.click(chooseBtn);

    const providerSelect = screen.getByRole("combobox", { name: /provider/i });
    await userEvent.selectOptions(providerSelect, "codex");

    const switchBtn = screen.getByRole("button", { name: "Switch" });
    await userEvent.click(switchBtn);

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ type: "limit.respond", id: "lim3", answer: "choose", provider: "codex" })
    );
  });

  it("counts limits in inbox badge", () => {
    useStore.getState().apply(snapshot([worker], []));
    useStore.setState({
      limits: [{ id: "lim1", agentId: worker.id, taskId: "t1" }],
      questions: [{ id: "q1", agentId: worker.id, taskId: "t1", question: "?" }],
    });

    render(<Inbox onClose={vi.fn()} />);
    // title should show (2)
    expect(screen.getByRole("heading", { name: /inbox \(2\)/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// SettingsModal: limitPolicy and loungeBreaks
// ---------------------------------------------------------------------------

describe("SettingsModal: limit policy and lounge breaks", () => {
  it("shows limitPolicy select with current value 'ask'", () => {
    useStore.getState().apply(snapshot([manager], []));
    render(<SettingsModal onClose={vi.fn()} />);

    const limitSelect = screen.getByRole("combobox", { name: /limit policy/i });
    expect(limitSelect).toBeInTheDocument();
    expect((limitSelect as HTMLSelectElement).value).toBe("ask");
  });

  it("shows loungeBreaks checkbox checked by default", () => {
    useStore.getState().apply(snapshot([manager], []));
    render(<SettingsModal onClose={vi.fn()} />);

    const checkbox = screen.getByRole("checkbox", { name: /lounge breaks/i });
    expect(checkbox).toBeChecked();
  });

  it("sends settings.update with limitPolicy=auto when changed and saved", async () => {
    const send = vi.fn();
    useStore.getState().apply(snapshot([manager], []));
    useStore.setState({ send });

    render(<SettingsModal onClose={vi.fn()} />);

    const limitSelect = screen.getByRole("combobox", { name: /limit policy/i });
    await userEvent.selectOptions(limitSelect, "auto");

    const saveBtn = screen.getByRole("button", { name: /save settings/i });
    await userEvent.click(saveBtn);

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ type: "settings.update", settings: expect.objectContaining({ limitPolicy: "auto" }) })
    );
  });

  it("sends settings.update with loungeBreaks=false when toggled off", async () => {
    const send = vi.fn();
    useStore.getState().apply(snapshot([manager], []));
    useStore.setState({ send });

    render(<SettingsModal onClose={vi.fn()} />);

    const checkbox = screen.getByRole("checkbox", { name: /lounge breaks/i });
    await userEvent.click(checkbox);

    const saveBtn = screen.getByRole("button", { name: /save settings/i });
    await userEvent.click(saveBtn);

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ type: "settings.update", settings: expect.objectContaining({ loungeBreaks: false }) })
    );
  });
});
