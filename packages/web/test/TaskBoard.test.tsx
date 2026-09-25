import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TaskBoard } from "../src/hud/TaskBoard";
import { groupTasksByBoard } from "../src/state/taskGroups";
import { useStore } from "../src/state/store";
import { manager, worker, task, snapshot } from "./fixtures";

beforeEach(() => useStore.getState().reset());

function board(name: string) { return screen.getByLabelText(`Board: ${name}`).closest("details")!; }
function agentGroup(container: HTMLElement, name: string) { return within(container).getByLabelText(`Agent: ${name}`).closest("details")!; }

describe("TaskBoard", () => {
  it("groups projects then assignees, keeping delegated tasks and every status visible", () => {
    const statuses = ["queued", "assigned", "running", "waiting", "done", "failed", "cancelled"] as const;
    useStore.getState().apply(snapshot([manager, worker], [
      task({ id: "parent", title: "Build login", kind: "request", assigneeId: manager.id }),
      ...statuses.map(status => task({ id: status, title: `${status} task`, status, parentId: "parent" })),
      task({ id: "other", title: "Other project task", projectPath: "D:/other" }),
    ]));
    render(<TaskBoard />);
    expect(within(agentGroup(board("proj"), "Atlas")).getByText("Build login")).toBeInTheDocument();
    for (const status of statuses) expect(within(agentGroup(board("proj"), "Pixel")).getByText(`${status} task`)).toBeInTheDocument();
    expect(within(board("proj")).queryByText("Other project task")).not.toBeInTheDocument();
    expect(within(agentGroup(board("other"), "Pixel")).getByText("Other project task")).toBeInTheDocument();
  });

  it("collapses panel, boards and agents independently and retains collapse on updates", async () => {
    useStore.getState().apply(snapshot([worker], [task({ id: "one", title: "First" })]));
    render(<TaskBoard />);
    const group = agentGroup(board("proj"), "Pixel");
    await userEvent.click(within(group).getByText("Pixel"));
    expect(group).not.toHaveAttribute("open");
    act(() => useStore.getState().apply({ type: "task.updated", task: task({ id: "one", title: "First", status: "done" }) }));
    expect(group).not.toHaveAttribute("open");
    expect(within(group).getByText("done")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Collapse tasks" }));
    expect(screen.getByRole("button", { name: "Expand tasks" })).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(screen.getByRole("button", { name: "Expand tasks" }));
    expect(group).not.toHaveAttribute("open");
    await userEvent.click(screen.getByLabelText("Board: proj"));
    expect(board("proj")).not.toHaveAttribute("open");
  });

  it("selects agents by keyboard and cancels without changing selection", async () => {
    const send = vi.fn();
    useStore.setState({ send });
    useStore.getState().apply(snapshot([worker], [task({ id: "run", title: "Running one", status: "running" })]));
    render(<TaskBoard />);
    screen.getByRole("button", { name: "View Running one" }).focus();
    await userEvent.keyboard("{Enter}");
    expect(useStore.getState().selectedAgentId).toBe(worker.id);
    await userEvent.click(screen.getByRole("button", { name: "Cancel Running one" }));
    expect(send).toHaveBeenCalledWith({ type: "task.cancel", id: "run" });
    expect(useStore.getState().selectedAgentId).toBe(worker.id);
  });

  it("shows known empty projects, missing agents and unassigned tasks", () => {
    useStore.getState().apply(snapshot([], [task({ id: "missing", assigneeId: "removed" }), task({ id: "free", assigneeId: "" })]));
    useStore.setState({ world: { kind: "project", name: "proj", projectPath: "C:/proj", knownProjects: [{ name: "Empty", path: "C:/empty", lastOpened: "2026-09-25" }] } });
    render(<TaskBoard />);
    expect(within(board("Empty")).getByText("No tasks loaded for this board.")).toBeInTheDocument();
    expect(agentGroup(board("proj"), "Unknown agent (removed)")).toBeInTheDocument();
    expect(agentGroup(board("proj"), "Unassigned")).toBeInTheDocument();
  });

  it("shows an empty state", () => {
    render(<TaskBoard />);
    expect(screen.getByText(/no tasks yet/i)).toBeInTheDocument();
  });
});

describe("groupTasksByBoard", () => {
  it("matches Windows project paths without conflating POSIX casing", () => {
    const groups = groupTasksByBoard([
      task({ id: "a", projectPath: "C:\\Proj\\" }), task({ id: "b", projectPath: "c:/proj" }),
      task({ id: "c", projectPath: "/Code" }), task({ id: "d", projectPath: "/code" }),
    ]);
    expect(groups.map(group => group.tasks.length)).toEqual([2, 1, 1]);
  });
  it("uses top-level requests when no project exists and tolerates missing parents and cycles", () => {
    const groups = groupTasksByBoard([
      task({ id: "root", title: "Request", projectPath: "" }),
      task({ id: "child", parentId: "root", projectPath: "" }),
      task({ id: "orphan", parentId: "missing", projectPath: "" }),
      task({ id: "cycle", parentId: "cycle", projectPath: "" }),
    ]);
    expect(groups.find(group => group.name === "Request")?.tasks).toHaveLength(2);
    expect(groups.flatMap(group => group.tasks)).toHaveLength(4);
  });
});
