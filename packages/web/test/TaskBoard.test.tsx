import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TaskBoard } from "../src/hud/TaskBoard";
import { groupTasksByBoard } from "../src/state/taskGroups";
import { useStore } from "../src/state/store";
import { manager, worker, worker2, task, snapshot } from "./fixtures";

beforeEach(() => {
  useStore.getState().reset();
  // Clear persisted group-collapse state so each test starts fresh
  try { localStorage.removeItem("av:task-groups-collapsed"); } catch { /* ignore */ }
});

function agentGroup(name: string) {
  // find the group label span and return the containing .task-agent-group div
  const labelEl = screen.getByText(name, { selector: ".task-group-label" });
  return labelEl.closest<HTMLElement>(".task-agent-group")!;
}

/** Check if the agent group is in its collapsed state (button aria-expanded=false). */
function isGroupCollapsed(groupEl: HTMLElement): boolean {
  const btn = groupEl.querySelector(".task-agent-group-btn");
  return btn?.getAttribute("aria-expanded") === "false";
}

describe("TaskBoard", () => {
  it("shows ONLY this project's tasks with no folder/project groups, and displays Done status", () => {
    const statuses = ["queued", "assigned", "running", "waiting", "done", "failed", "cancelled"] as const;
    useStore.getState().apply(
      snapshot(
        [manager, worker],
        [
          task({ id: "parent", title: "Build login", kind: "request", assigneeId: manager.id }),
          ...statuses.map((status) => task({ id: status, title: `${status} task`, status, parentId: "parent" })),
          task({ id: "other", title: "Other project task", projectPath: "D:/other" }),
        ],
      ),
    );
    render(<TaskBoard />);

    // No folder/project board groups exist
    expect(screen.queryByLabelText(/Board:/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Other project task")).not.toBeInTheDocument();

    // Groups directly by agent
    expect(within(agentGroup("Atlas")).getByText("Build login")).toBeInTheDocument();
    for (const status of statuses) {
      expect(within(agentGroup("Pixel")).getByText(`${status} task`)).toBeInTheDocument();
    }

    // Done task has task-row class and .task-status showing Done
    const doneRow = screen.getByText("done task").closest<HTMLElement>(".task-row")!;
    expect(doneRow).toBeInTheDocument();
    const doneStatus = within(doneRow).getByText("Done");
    expect(doneStatus).toHaveClass("task-status");
  });

  it("filters tasks by room dropdown based on agent seating", async () => {
    const workerInPodA = { ...worker, id: "w_poda", name: "Pixel", placement: { space: "pod-a", seat: 0 } };
    const workerInPodB = { ...worker2, id: "w_podb", name: "Byte", placement: { space: "pod-b", seat: 0 } };

    useStore.getState().apply(
      snapshot(
        [manager, workerInPodA, workerInPodB],
        [
          task({ id: "t_mgr", title: "Manager plan", assigneeId: manager.id }),
          task({ id: "t_a", title: "Backend API", assigneeId: workerInPodA.id }),
          task({ id: "t_b", title: "3D Viewport", assigneeId: workerInPodB.id }),
        ],
      ),
    );
    useStore.setState({
      spaceNames: {
        "pod-a": "Backend & Release",
        "pod-b": "UI & 3D",
        "pod-c": "QA & Docs",
      },
    });

    render(<TaskBoard />);

    const roomSelect = screen.getByRole("combobox", { name: /room/i });
    expect(roomSelect).toBeInTheDocument();

    // Verify room options exist by display name
    expect(within(roomSelect).getByText("All rooms")).toBeInTheDocument();
    expect(within(roomSelect).getByText("Backend & Release")).toBeInTheDocument();
    expect(within(roomSelect).getByText("UI & 3D")).toBeInTheDocument();
    expect(within(roomSelect).getByText("QA & Docs")).toBeInTheDocument();
    expect(within(roomSelect).getByText("Meeting Room")).toBeInTheDocument();
    expect(within(roomSelect).getByText("Lounge")).toBeInTheDocument();

    // Initially "All rooms" shows all tasks
    expect(screen.getByText("Manager plan")).toBeInTheDocument();
    expect(screen.getByText("Backend API")).toBeInTheDocument();
    expect(screen.getByText("3D Viewport")).toBeInTheDocument();

    // Filter to "Backend & Release"
    await userEvent.selectOptions(roomSelect, screen.getByRole("option", { name: "Backend & Release" }));
    expect(screen.getByText("Backend API")).toBeInTheDocument();
    expect(screen.queryByText("Manager plan")).not.toBeInTheDocument();
    expect(screen.queryByText("3D Viewport")).not.toBeInTheDocument();

    // Filter to "UI & 3D"
    await userEvent.selectOptions(roomSelect, screen.getByRole("option", { name: "UI & 3D" }));
    expect(screen.getByText("3D Viewport")).toBeInTheDocument();
    expect(screen.queryByText("Backend API")).not.toBeInTheDocument();

    // Filter to empty room
    await userEvent.selectOptions(roomSelect, screen.getByRole("option", { name: "Lounge" }));
    expect(screen.getByText("No tasks in this room.")).toBeInTheDocument();

    // Switch back to "All rooms"
    await userEvent.selectOptions(roomSelect, screen.getByRole("option", { name: "All rooms" }));
    expect(screen.getByText("Backend API")).toBeInTheDocument();
    expect(screen.getByText("3D Viewport")).toBeInTheDocument();
  });

  it("shows question text and Open in Inbox button for tasks waiting on the user", async () => {
    const onOpenInbox = vi.fn();
    useStore.getState().apply(
      snapshot(
        [worker],
        [
          task({ id: "wait_1", title: "Needs clarification", status: "waiting", assigneeId: worker.id }),
        ],
      ),
    );
    useStore.setState({
      questions: [
        { id: "q_1", agentId: worker.id, taskId: "wait_1", question: "Should we use PostgreSQL or SQLite?" },
      ],
    });

    render(<TaskBoard onOpenInbox={onOpenInbox} />);

    expect(screen.getByText("Should we use PostgreSQL or SQLite?")).toBeInTheDocument();
    const openBtn = screen.getByRole("button", { name: /open.*inbox/i });
    expect(openBtn).toBeInTheDocument();

    await userEvent.click(openBtn);
    expect(onOpenInbox).toHaveBeenCalled();
  });

  it("shows no Inbox button or fake question when a waiting task has nothing pending in the Inbox", () => {
    useStore.getState().apply(
      snapshot(
        [worker],
        [task({ id: "wait_2", title: "Round 5", description: "Long request text that is not a question", status: "waiting", assigneeId: worker.id })],
      ),
    );
    useStore.setState({ questions: [], permissions: [] });
    render(<TaskBoard onOpenInbox={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /open.*inbox/i })).toBeNull();
    expect(screen.queryByText("Long request text that is not a question")).toBeNull();
  });

  it("collapses panel and agents independently and retains collapse on updates", async () => {
    useStore.getState().apply(snapshot([worker], [task({ id: "one", title: "First" })]));
    render(<TaskBoard />);
    const group = agentGroup("Pixel");
    // Click the group header button to collapse it
    await userEvent.click(within(group).getByRole("button", { name: /Pixel/i }));
    expect(isGroupCollapsed(group)).toBe(true);

    act(() =>
      useStore.getState().apply({ type: "task.updated", task: task({ id: "one", title: "First", status: "done" }) }),
    );
    // Still collapsed after update
    expect(isGroupCollapsed(group)).toBe(true);
    // Task is still in DOM (always-rendered, hidden via CSS)
    expect(within(group).getByText("Done")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Collapse tasks" }));
    expect(screen.getByRole("button", { name: /Expand tasks/ })).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(screen.getByRole("button", { name: /Expand tasks/ }));
    // Group is still collapsed after panel expand/collapse
    expect(isGroupCollapsed(group)).toBe(true);
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

  it("shows unassigned tasks and unknown agents for this project", () => {
    useStore.getState().apply(
      snapshot([], [task({ id: "missing", assigneeId: "removed" }), task({ id: "free", assigneeId: "" })]),
    );
    useStore.setState({
      world: {
        kind: "project",
        name: "proj",
        projectPath: "C:/proj",
        knownProjects: [{ name: "Empty", path: "C:/empty", lastOpened: "2026-09-25" }],
      },
    });
    render(<TaskBoard />);
    // "Empty" known project does NOT appear as a board folder
    expect(screen.queryByText("Empty")).not.toBeInTheDocument();
    expect(agentGroup("Unknown agent (removed)")).toBeInTheDocument();
    expect(agentGroup("Unassigned")).toBeInTheDocument();
  });

  it("shows an empty state when project has no tasks", () => {
    render(<TaskBoard />);
    expect(screen.getByText(/no tasks yet/i)).toBeInTheDocument();
  });
});

describe("groupTasksByBoard", () => {
  it("matches Windows project paths without conflating POSIX casing", () => {
    const groups = groupTasksByBoard([
      task({ id: "a", projectPath: "C:\\Proj\\" }),
      task({ id: "b", projectPath: "c:/proj" }),
      task({ id: "c", projectPath: "/Code" }),
      task({ id: "d", projectPath: "/code" }),
    ]);
    expect(groups.map((group) => group.tasks.length)).toEqual([2, 1, 1]);
  });
  it("uses top-level requests when no project exists and tolerates missing parents and cycles", () => {
    const groups = groupTasksByBoard([
      task({ id: "root", title: "Request", projectPath: "" }),
      task({ id: "child", parentId: "root", projectPath: "" }),
      task({ id: "orphan", parentId: "missing", projectPath: "" }),
      task({ id: "cycle", parentId: "cycle", projectPath: "" }),
    ]);
    expect(groups.find((group) => group.name === "Request")?.tasks).toHaveLength(2);
    expect(groups.flatMap((group) => group.tasks)).toHaveLength(4);
  });
});
