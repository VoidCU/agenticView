import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChatPanel } from "../src/hud/ChatPanel";
import { TaskBoard } from "../src/hud/TaskBoard";
import { displayModelOf } from "../src/hud/sessions";
import { useStore } from "../src/state/store";
import { agent, manager, snapshot, task } from "./fixtures";

const nova = agent({ id: "w_nova", name: "Nova", provider: "claude-session", model: "stale-model", session: { id: "s-a", name: "Main tab" }, sessionModel: "claude-opus-5-5" });

beforeEach(() => {
  useStore.getState().reset();
  try { localStorage.removeItem("av:task-groups-collapsed"); } catch { /* ignore */ }
});

describe("session model display", () => {
  it("displayModelOf: session agents show sessionModel ?? model, others their own model", () => {
    expect(displayModelOf(nova, "claude-session", [])).toBe("claude-opus-5-5");
    expect(displayModelOf({ ...nova, sessionModel: null }, "claude-session", [])).toBe("stale-model");
    expect(displayModelOf({ ...nova, sessionModel: undefined, model: null }, "claude-session", [])).toBeNull();
    expect(displayModelOf({ ...nova, provider: "claude", model: "sonnet" }, "claude", [])).toBe("sonnet");
  });

  it("the chat header chip shows the serving session's model", () => {
    useStore.getState().apply(snapshot([manager, nova]));
    useStore.getState().select(nova.id);
    render(<ChatPanel />);
    const chip = document.querySelector(".chat-sub .chip")!;
    expect(chip.textContent).toContain("claude-opus-5-5");
    expect(chip.textContent).not.toContain("stale-model");
  });

  it("the Tasks group header shows the serving session's model", () => {
    useStore.getState().apply(snapshot([manager, nova], [task({ id: "t1", title: "Session work", assigneeId: nova.id, status: "running" })]));
    render(<TaskBoard />);
    const label = screen.getByText("Nova", { selector: ".task-group-label" });
    const group = label.closest(".task-agent-group-btn")!;
    expect(group.querySelector(".task-group-model")?.textContent).toBe("claude-opus-5-5");
  });
});
