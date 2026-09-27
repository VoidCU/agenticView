/**
 * Overview clicks on an agent open its conversation, never the game: lounging or not, the robot click
 * selects the agent and reveals a collapsed Chat panel (without overwriting the saved preference); the
 * game is reachable from the chat header's Play button.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ChatPanel } from "../src/hud/ChatPanel";
import { robotClick } from "../src/scene/Robot";
import { overviewAgentClick } from "../src/state/agentClick";
import { useHudPrefs } from "../src/state/hudPrefs";
import { RPS_BUSY_LINE } from "../src/state/rps";
import { useStore } from "../src/state/store";
import { useDrag } from "../src/scene/motion";
import { manager, snapshot, task, worker, worker2 } from "./fixtures";

const lounging = { ...worker, lounging: true };

function Hud() {
  const collapsed = useHudPrefs((s) => s.chatCollapsed);
  const setCollapsed = useHudPrefs((s) => s.setChatCollapsed);
  return <ChatPanel collapsed={collapsed} onCollapseChange={setCollapsed} />;
}

describe("overview click on an agent opens its chat, not a game", () => {
  const plays = vi.fn();
  const onPlay = (e: Event) => plays((e as CustomEvent<{ agentId: string }>).detail.agentId);
  beforeEach(() => {
    useStore.getState().reset();
    useStore.getState().apply(snapshot([manager, lounging, worker2]));
    useDrag.setState({ droppedAt: 0 });
    useHudPrefs.getState().setChatCollapsed(true);
    plays.mockClear();
    window.addEventListener("agenticview:play-rps", onPlay);
  });
  afterEach(() => {
    window.removeEventListener("agenticview:play-rps", onPlay);
    useHudPrefs.getState().setChatCollapsed(false);
  });

  it("a lounging agent: selected, chat expanded, and no rock-paper-scissors", () => {
    render(<Hud />);
    expect(screen.getByRole("button", { name: "Expand chat" })).toBeInTheDocument();
    act(() => robotClick(lounging.id, false, overviewAgentClick));
    expect(useStore.getState().selectedAgentId).toBe(lounging.id);
    expect(useHudPrefs.getState().chatCollapsed).toBe(false);
    expect(screen.getByRole("complementary", { name: `Chat with ${lounging.name}` })).toBeInTheDocument();
    expect(plays).not.toHaveBeenCalled();
    // Revealed for this click only: the saved preference still says collapsed.
    expect(localStorage.getItem("av:hud:chat-collapsed")).toBe("true");
  });

  it("an agent at its desk behaves the same", () => {
    act(() => robotClick(worker2.id, false, overviewAgentClick));
    expect(useStore.getState().selectedAgentId).toBe(worker2.id);
    expect(useHudPrefs.getState().chatCollapsed).toBe(false);
    expect(plays).not.toHaveBeenCalled();
  });

  it("does not fight the user: collapsing again sticks, and deselecting never re-expands", () => {
    render(<Hud />);
    act(() => robotClick(lounging.id, false, overviewAgentClick));
    fireEvent.click(screen.getByRole("button", { name: "Collapse chat" }));
    expect(useHudPrefs.getState().chatCollapsed).toBe(true);
    // Clicking the selected agent again deselects it: the chat stays collapsed.
    act(() => robotClick(lounging.id, false, overviewAgentClick));
    expect(useStore.getState().selectedAgentId).toBeUndefined();
    expect(useHudPrefs.getState().chatCollapsed).toBe(true);
    // Clicking an agent (again) is asking for its conversation: it opens.
    act(() => robotClick(worker2.id, false, overviewAgentClick));
    expect(useHudPrefs.getState().chatCollapsed).toBe(false);
  });

  it("Alt+click still bonks without selecting, and a drop is not a click", () => {
    act(() => robotClick(lounging.id, true, overviewAgentClick));
    expect(useStore.getState().selectedAgentId).toBeUndefined();
    expect(useHudPrefs.getState().chatCollapsed).toBe(true);
    useDrag.setState({ droppedAt: Date.now() });
    act(() => robotClick(lounging.id, false, overviewAgentClick));
    expect(useStore.getState().selectedAgentId).toBeUndefined();
  });
});

describe("chat header Play rock-paper-scissors button", () => {
  beforeEach(() => {
    useStore.getState().reset();
  });

  it("is visible next to the agent menu and challenges the agent (the App opens the match popup on this event)", () => {
    useStore.getState().apply(snapshot([manager, lounging]));
    useStore.getState().select(lounging.id);
    const plays = vi.fn();
    const onPlay = (e: Event) => plays((e as CustomEvent<{ agentId: string }>).detail.agentId);
    window.addEventListener("agenticview:play-rps", onPlay);
    render(<ChatPanel />);
    const button = screen.getByRole("button", { name: `Play rock-paper-scissors with ${lounging.name}` });
    expect(button).toBeEnabled();
    expect(button).toHaveTextContent("Play RPS");
    expect(button.closest(".chat-head-actions")?.querySelector(`[aria-label="Actions for ${lounging.name}"]`)).toBeTruthy();
    fireEvent.click(button);
    window.removeEventListener("agenticview:play-rps", onPlay);
    expect(plays).toHaveBeenCalledWith(lounging.id);
  });

  it("is disabled with the busy reason while the agent is on a task", () => {
    useStore.getState().apply(snapshot([manager, worker], [task({ id: "t1", status: "running", assigneeId: worker.id })]));
    useStore.getState().select(worker.id);
    const plays = vi.fn();
    window.addEventListener("agenticview:play-rps", plays);
    render(<ChatPanel />);
    const button = screen.getByTestId("chat-play-rps");
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", `${worker.name} is busy on a task: "${RPS_BUSY_LINE}"`);
    fireEvent.click(button);
    window.removeEventListener("agenticview:play-rps", plays);
    expect(plays).not.toHaveBeenCalled();
  });
});
