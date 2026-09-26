/**
 * Tests for solved/resolved failures on task board and kanban.
 *
 * Covers:
 * - boardColumn: resolved failure maps to 'done'
 * - countBranches: resolved failures count as done
 * - TaskBoard: shows 'Solved' status for resolved failure, 'Solved by <title>' link
 * - PodBoard: resolved failure card is in Done column with solved badge
 * - PodBoard drawer: shows resolution section, 'Undo solved' button
 * - PodBoard drawer: 'Mark solved...' button appears for unresolved failures
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Space } from "@agenticview/shared";
import { boardColumn, countBranches } from "../src/state/boards";
import { TaskBoard } from "../src/hud/TaskBoard";
import { PodBoard } from "../src/hud/PodBoard";
import { useStore } from "../src/state/store";
import { manager, worker, task, snapshot } from "./fixtures";

beforeEach(() => useStore.getState().reset());

const podA: Space = { id: "pod-a", name: "Pod A", kind: "pod", q: 1, r: 0, ring: 1, x: 0, z: 0, seats: 4 };

const resolution = { byTaskId: "fix1", note: "Fixed in follow-up task", at: "2026-09-26T10:00:00.000Z" };
const resolutionNoTask = { note: "Marked acceptable", at: "2026-09-26T10:00:00.000Z" };

// ── boardColumn helper ─────────────────────────────────────────────────────────

describe("boardColumn with resolution", () => {
  it("maps unresolved failed task to 'failed'", () => {
    const t = task({ id: "f1", status: "failed" });
    expect(boardColumn(t)).toBe("failed");
  });

  it("maps resolved failed task to 'done'", () => {
    const t = task({ id: "f2", status: "failed", resolution });
    expect(boardColumn(t)).toBe("done");
  });
});

// ── countBranches with resolution ─────────────────────────────────────────────

describe("countBranches with resolved failures", () => {
  it("counts resolved failure as done", () => {
    const branches = [
      { task: task({ id: "a", status: "done" }), children: [] },
      { task: task({ id: "b", status: "failed", resolution }), children: [] },
      { task: task({ id: "c", status: "failed" }), children: [] },
    ];
    const { total, done } = countBranches(branches);
    expect(total).toBe(3);
    expect(done).toBe(2); // 'done' + resolved failure
  });
});

// ── TaskBoard: Solved status ───────────────────────────────────────────────────

describe("TaskBoard: solved failures", () => {
  function setup(taskOverrides: Parameters<typeof task>[0]) {
    useStore.getState().apply(snapshot([worker], [task(taskOverrides)]));
    render(<TaskBoard />);
  }

  it("shows 'Solved' status for a failed task with resolution", () => {
    setup({ id: "f1", status: "failed", resolution: resolutionNoTask });
    const row = screen.getByText("Do a thing").closest(".task-row")!;
    // The task-status span should say "Solved"
    const statusSpan = within(row as HTMLElement).getByText("Solved", { selector: ".task-status" });
    expect(statusSpan).toBeInTheDocument();
    expect(statusSpan).toHaveClass("task-status");
  });

  it("shows 'Solved by <title>' link when byTaskId resolves to a known task", () => {
    const fixTask = task({ id: "fix1", title: "Follow-up fix", status: "done", assigneeId: worker.id });
    const failedTask = task({ id: "f1", status: "failed", resolution });
    useStore.getState().apply(snapshot([worker], [failedTask, fixTask]));
    render(<TaskBoard />);
    // aria-label is "Solved by task: Follow-up fix"; visible text is "Solved by Follow-up fix"
    expect(screen.getByRole("button", { name: /solved by task: follow-up fix/i })).toBeInTheDocument();
  });

  it("shows 'failed' status for unresolved failure", () => {
    setup({ id: "f2", status: "failed" });
    const row = screen.getByText("Do a thing").closest(".task-row")!;
    expect(within(row as HTMLElement).getByText("failed")).toBeInTheDocument();
  });

  it("hides error text for solved failures", () => {
    setup({ id: "f3", status: "failed", error: "Oops", resolution: resolutionNoTask });
    expect(screen.queryByText("Oops")).not.toBeInTheDocument();
  });

  it("adds task-solved class to li for solved task", () => {
    setup({ id: "f4", status: "failed", resolution: resolutionNoTask });
    const li = screen.getByText("Do a thing").closest("li")!;
    expect(li).toHaveClass("task-solved");
  });
});

// ── PodBoard: kanban column routing ───────────────────────────────────────────

describe("PodBoard: resolved failure in Done column", () => {
  function setupPod(tasks: ReturnType<typeof task>[]) {
    const w = { ...worker, placement: { space: "pod-a", seat: 0 } };
    useStore.getState().apply(snapshot([manager, w], tasks));
    render(<PodBoard space={podA} onClose={vi.fn()} />);
    return w;
  }

  it("resolved failure appears in Done column, not Failed", () => {
    const w = { ...worker, placement: { space: "pod-a", seat: 0 } };
    useStore.getState().apply(snapshot([manager, w], [
      task({ id: "f1", title: "Solved failure", status: "failed", resolution: resolutionNoTask, assigneeId: w.id }),
      task({ id: "f2", title: "Live failure", status: "failed", assigneeId: w.id }),
    ]));
    render(<PodBoard space={podA} onClose={vi.fn()} />);

    const doneCol = screen.getByTestId("kanban-col-done");
    const failedCol = screen.getByTestId("kanban-col-failed");

    expect(within(doneCol).getByText("Solved failure")).toBeInTheDocument();
    expect(within(failedCol).getByText("Live failure")).toBeInTheDocument();
    expect(within(failedCol).queryByText("Solved failure")).not.toBeInTheDocument();
  });

  it("solved badge appears on resolved failure card", () => {
    const w = { ...worker, placement: { space: "pod-a", seat: 0 } };
    useStore.getState().apply(snapshot([manager, w], [
      task({ id: "f1", title: "Solved task", status: "failed", resolution: resolutionNoTask, assigneeId: w.id }),
    ]));
    render(<PodBoard space={podA} onClose={vi.fn()} />);
    expect(screen.getByLabelText("Solved")).toBeInTheDocument();
  });
});

// ── PodBoard drawer: resolution section and actions ───────────────────────────

describe("PodBoard drawer: resolution UI", () => {
  async function openDrawer(taskOverrides: Parameters<typeof task>[0]) {
    const w = { ...worker, placement: { space: "pod-a", seat: 0 } };
    useStore.getState().apply(snapshot([manager, w], [task({ ...taskOverrides, assigneeId: w.id })]));
    render(<PodBoard space={podA} onClose={vi.fn()} />);
    const card = screen.getByRole("button", { name: new RegExp(taskOverrides.title ?? "Do a thing", "i") });
    await userEvent.click(card);
    return screen.getByTestId("task-drawer");
  }

  it("shows resolution section for solved failure", async () => {
    const drawer = await openDrawer({ id: "f1", title: "Solved task", status: "failed", resolution: resolutionNoTask });
    expect(within(drawer).getByTestId("resolution-section")).toBeInTheDocument();
    expect(within(drawer).getByText("Marked acceptable")).toBeInTheDocument();
  });

  it("shows 'Undo solved' button for resolved failure", async () => {
    const drawer = await openDrawer({ id: "f2", title: "Resolved task", status: "failed", resolution: resolutionNoTask });
    expect(within(drawer).getByTestId("undo-solved-btn")).toBeInTheDocument();
  });

  it("shows 'Mark solved...' button for unresolved failure", async () => {
    const drawer = await openDrawer({ id: "f3", title: "Failed task", status: "failed" });
    expect(within(drawer).getByTestId("mark-solved-btn")).toBeInTheDocument();
  });

  it("does not show 'Mark solved...' for non-failed tasks", async () => {
    const drawer = await openDrawer({ id: "d1", title: "Done task", status: "done" });
    expect(within(drawer).queryByTestId("mark-solved-btn")).not.toBeInTheDocument();
  });

  it("opens mark-solved form when button is clicked", async () => {
    const drawer = await openDrawer({ id: "f4", title: "Open form task", status: "failed" });
    await userEvent.click(within(drawer).getByTestId("mark-solved-btn"));
    expect(within(drawer).getByTestId("mark-solved-form")).toBeInTheDocument();
    expect(within(drawer).getByRole("textbox", { name: /resolution note/i })).toBeInTheDocument();
  });

  it("shows 'Solved' badge in drawer status for resolved failure", async () => {
    const drawer = await openDrawer({ id: "f5", title: "Solved badge task", status: "failed", resolution: resolutionNoTask });
    expect(within(drawer).getByText("Solved")).toBeInTheDocument();
  });
});

// ── Manager board progress: resolved failures count as done ───────────────────

describe("Manager board progress bar counts resolved failures as done", () => {
  it("counts a resolved failure in the done total", () => {
    const branches = [
      { task: task({ id: "a", status: "done" }), children: [] },
      { task: task({ id: "b", status: "failed", resolution }), children: [] },
      { task: task({ id: "c", status: "running" }), children: [] },
    ];
    const { total, done } = countBranches(branches);
    expect(done).toBe(2);
    expect(total).toBe(3);
  });
});
