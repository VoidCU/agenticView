import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { newSessionUri, resumeSessionUri, sessionModelMatches, type WorkerSessionInfo } from "@agenticview/shared";
import { CreateAgentModal } from "../src/hud/CreateAgentModal";
import { ChatPanel } from "../src/hud/ChatPanel";
import { SessionsModal, modelMismatchHint, LAUNCH_FALLBACK_MS } from "../src/hud/sessions";
import { useStore } from "../src/state/store";
import { agent, manager, snapshot, task, worker } from "./fixtures";

const sess = (over: Partial<WorkerSessionInfo> & { id: string }): WorkerSessionInfo => ({
  name: over.id,
  model: null,
  cwd: "C:/proj",
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

const nova = agent({ id: "w_nova", name: "Nova", provider: "claude-session", model: "opus", session: { id: "s-a", name: "Main tab" } });

beforeEach(() => {
  useStore.getState().reset();
  useStore.getState().apply(snapshot([manager, worker, nova]));
});

describe("session helpers", () => {
  it("builds the VS Code URIs with the namespaced skill command", () => {
    expect(newSessionUri("Nova")).toBe("vscode://anthropic.claude-code/open?prompt=%2Fagenticview%3Aagenticview-work%20Nova");
    expect(newSessionUri()).toBe("vscode://anthropic.claude-code/open?prompt=%2Fagenticview%3Aagenticview-work");
    expect(resumeSessionUri("0b6f-1")).toBe("vscode://anthropic.claude-code/open?session=0b6f-1");
  });

  it("matches models by family and phrases a mismatch hint", () => {
    expect(sessionModelMatches("opus", "claude-opus-5-5[1m]")).toBe(true);
    expect(sessionModelMatches("opus", "Opus 5.5")).toBe(true);
    expect(sessionModelMatches("opus", "claude-sonnet-5")).toBe(false);
    expect(sessionModelMatches(null, "claude-sonnet-5")).toBe(true);
    // A Claude alias runs in the agent's own subagent, so the session's model does not matter.
    expect(modelMismatchHint("opus", { name: "Main tab", model: "claude-sonnet-5" })).toBeUndefined();
    expect(modelMismatchHint("my-model", { name: "Main tab", model: "claude-sonnet-5" })).toBe('Session "Main tab" is on claude-sonnet-5; run /model my-model in that session to switch.');
    expect(modelMismatchHint("opus", { name: "Main tab", model: "claude-opus-5-5" })).toBeUndefined();
  });
});

describe("Sessions panel", () => {
  it("lists sessions with state, model and bound agents, and sends rename and forget", async () => {
    const send = vi.fn();
    useStore.setState({ send, sessions: [sess({ id: "s-a", name: "Main tab", model: "claude-opus-5-5", agentIds: [nova.id] }), sess({ id: "s-b", name: "Old", online: false })] });
    render(<SessionsModal onClose={vi.fn()} />);
    const rows = document.querySelectorAll(".session-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain("claude-opus-5-5");
    expect(rows[0]!.textContent).toContain("serves Nova");
    expect(rows[1]!.textContent).toContain("last seen");
    expect(screen.getAllByRole("link", { name: "Open session" })[0]).toHaveAttribute("href", "vscode://anthropic.claude-code/open?session=s-a");

    await userEvent.click(screen.getAllByRole("button", { name: "Rename" })[0]!);
    const input = screen.getByLabelText("Session name");
    await userEvent.clear(input);
    await userEvent.type(input, "Frontend{Enter}");
    expect(send).toHaveBeenCalledWith({ type: "session.rename", id: "s-a", name: "Frontend" });

    vi.spyOn(window, "confirm").mockReturnValue(true);
    await userEvent.click(screen.getAllByRole("button", { name: "Forget" })[1]!);
    expect(send).toHaveBeenCalledWith({ type: "session.forget", id: "s-b" });

    await userEvent.selectOptions(screen.getByLabelText(/agent for the new session/i), "Nova");
    expect(screen.getByRole("link", { name: "New session" })).toHaveAttribute("href", newSessionUri("Nova"));
    expect(screen.getByText(/press enter in the new claude code tab/i)).toBeTruthy();
  });

  it("shows a fallback when the vscode:// link does not open anything", async () => {
    vi.useFakeTimers();
    try {
      useStore.setState({ sessions: [] });
      render(<SessionsModal onClose={vi.fn()} />);
      const link = screen.getByRole("link", { name: "New session" });
      link.addEventListener("click", (e) => e.preventDefault());
      act(() => link.click());
      expect(screen.queryByText(/nothing opened/i)).toBeNull();
      act(() => void vi.advanceTimersByTime(LAUNCH_FALLBACK_MS + 10));
      expect(screen.getByText(/nothing opened/i).textContent).toContain("/agenticview:agenticview-work");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("agent modal session select", () => {
  it("lists known sessions and binds the pick; no model hint for a Claude alias (its subagent runs it)", async () => {
    const send = vi.fn();
    useStore.setState({ send, sessions: [sess({ id: "s-a", name: "Main tab", model: "claude-sonnet-5" }), sess({ id: "s-b", name: "Spare", online: false })] });
    render(<CreateAgentModal onClose={vi.fn()} edit={nova} />);
    const select = screen.getByLabelText(/^session$/i) as HTMLSelectElement;
    expect(select.value).toBe("s-a");
    expect([...select.options].map((o) => o.textContent)).toEqual(["Any free session", "Main tab (online, claude-sonnet-5)", "Spare (offline)", "Open a new session…"]);
    expect(screen.queryByTestId("model-mismatch")).toBeNull();
    await userEvent.selectOptions(select, "s-b");
    expect(screen.queryByTestId("model-mismatch")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
    expect(send.mock.calls[0]![0].patch).toMatchObject({ session: { id: "s-b", name: "Spare" } });
  });

  it("'Open a new session…' shows the launch link for the agent and saves the agent unbound", async () => {
    const send = vi.fn();
    useStore.setState({ send, sessions: [] });
    render(<CreateAgentModal onClose={vi.fn()} edit={nova} />);
    await userEvent.selectOptions(screen.getByLabelText(/^session$/i), "__new__");
    expect(screen.getByRole("link", { name: /open a claude code session for nova/i })).toHaveAttribute("href", newSessionUri("Nova"));
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
    expect(send.mock.calls[0]![0].patch).toMatchObject({ session: null });
  });

  it("after creating a claude-session agent it offers to open a session for it", async () => {
    const send = vi.fn();
    const onClose = vi.fn();
    useStore.setState({ send });
    render(<CreateAgentModal onClose={onClose} />);
    await userEvent.type(screen.getByLabelText(/^name/i), "Vega");
    await userEvent.selectOptions(screen.getByLabelText(/provider/i), "claude-session");
    await userEvent.click(screen.getByRole("button", { name: /create agent/i }));
    act(() => useStore.getState().apply({ type: "agent.updated", agent: agent({ id: "w_vega", name: "Vega", provider: "claude-session" }) }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: /open a claude code session for vega/i })).toHaveAttribute("href", newSessionUri("Vega"));
  });
});

describe("chat header for a claude-session agent", () => {
  it("shows the bound session, its state and model, and the waiting banner with actions when offline", async () => {
    const send = vi.fn();
    useStore.setState({ send, sessions: [sess({ id: "s-a", name: "Main tab", model: "claude-sonnet-5", online: false }), sess({ id: "s-b", name: "Spare" })] });
    useStore.getState().apply({ type: "task.updated", task: task({ id: "t1", assigneeId: nova.id, status: "running", kind: "chat" }) });
    useStore.getState().select(nova.id);
    render(<ChatPanel />);
    expect(screen.getByTestId("session-chip").textContent).toBe("Main tab · offline · claude-sonnet-5");
    expect(screen.getByText(/waiting for session/i).textContent).toContain("Main tab");
    expect(screen.queryByText(/run \/model/i)).toBeNull();
    expect(screen.getByRole("link", { name: "Open session" })).toHaveAttribute("href", resumeSessionUri("s-a"));
    await userEvent.click(screen.getByRole("button", { name: "Use any session" }));
    expect(send).toHaveBeenCalledWith({ type: "agent.update", id: nova.id, patch: { session: null } });
    await userEvent.selectOptions(screen.getByLabelText("Move to session"), "s-b");
    expect(send).toHaveBeenCalledWith({ type: "agent.update", id: nova.id, patch: { session: { id: "s-b", name: "Spare" } } });
  });
});

describe("several agents in one session", () => {
  const run = (agentId: string, runId: string, taskId: string, extra: Partial<WorkerSessionInfo["runs"][number]> = {}) => ({
    runId,
    taskId,
    agentId,
    subagent: `agenticview-${agentId.slice(2)}`,
    subagentId: null,
    startedAt: "2026-09-25T00:00:00.000Z",
    ...extra,
  });

  it("Sessions panel shows capacity (editable) and the runs with agent names and subagents", async () => {
    const send = vi.fn();
    useStore.getState().apply({ type: "task.updated", task: task({ id: "t1", assigneeId: nova.id, status: "running", title: "Build header" }) });
    useStore.getState().apply({ type: "task.updated", task: task({ id: "t2", assigneeId: worker.id, status: "running", title: "Add endpoint" }) });
    useStore.setState({
      send,
      sessions: [sess({ id: "s-a", name: "Main tab", capacity: 4, runs: [run(nova.id, "r1", "t1", { subagentId: "abc123def456" }), run(worker.id, "r2", "t2")] })],
    });
    render(<SessionsModal onClose={vi.fn()} />);
    const row = document.querySelector(".session-row")!;
    expect(row.textContent).toContain("2 of 4 running");
    const items = screen.getAllByRole("listitem").filter((li) => li.classList.contains("session-run"));
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringMatching(/^Nova“Build header”agenticview-nova #abc123de/),
      expect.stringMatching(new RegExp(`^${worker.name}“Add endpoint”agenticview-${worker.id.slice(2)}`)),
    ]);
    await userEvent.selectOptions(screen.getByLabelText("Tasks at once in Main tab"), "2");
    expect(send).toHaveBeenCalledWith({ type: "session.capacity", id: "s-a", capacity: 2 });
  });

  it("chat header shows the session and subagent serving the agent; the work log lists its tasks and opens one", async () => {
    useStore.getState().apply({ type: "task.updated", task: task({ id: "t1", assigneeId: nova.id, status: "running", title: "Build header", startedAt: "2026-09-25T02:00:00.000Z" }) });
    useStore.getState().apply({
      type: "task.updated",
      task: task({
        id: "t0",
        assigneeId: nova.id,
        status: "done",
        title: "Set up routes",
        result: "Routes added and tested.",
        startedAt: "2026-09-25T01:00:00.000Z",
        finishedAt: "2026-09-25T01:10:00.000Z",
        worker: { runId: "r0", sessionId: "s-a", sessionName: "Main tab", subagent: "agenticview-nova", subagentId: "sub-77", files: ["src/routes.ts"] },
      }),
    });
    useStore.setState({ sessions: [sess({ id: "s-a", name: "Main tab", runs: [run(nova.id, "r1", "t1", { subagentId: "sub-99" })] })] });
    useStore.getState().select(nova.id);
    render(<ChatPanel />);
    expect(screen.getByTestId("serving-chip").textContent).toBe("Main tab › agenticview-nova #sub-99");
    const log = screen.getByTestId("work-log");
    expect(log.querySelector("summary")!.textContent).toBe("Work log 2");
    const entries = [...log.querySelectorAll(".worklog-item")];
    expect(entries.map((e) => e.querySelector(".worklog-title")!.textContent)).toEqual(["Build header", "Set up routes"]);
    await userEvent.click(screen.getByText("Set up routes"));
    expect(entries[1]!.querySelector("details")!.open).toBe(true);
    expect(entries[1]!.textContent).toContain("Routes added and tested.");
    expect(entries[1]!.textContent).toContain("Served by session Main tab as agenticview-nova (id sub-77)");
    expect(entries[1]!.textContent).toContain("src/routes.ts");
  });

  it("no serving chip when nothing of the agent is running", () => {
    useStore.setState({ sessions: [sess({ id: "s-a", name: "Main tab" })] });
    useStore.getState().select(nova.id);
    render(<ChatPanel />);
    expect(screen.queryByTestId("serving-chip")).toBeNull();
    expect(screen.queryByTestId("work-log")).toBeNull();
  });
});
