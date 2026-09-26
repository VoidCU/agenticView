import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Space } from "@agenticview/shared";
import { PodBoard } from "../src/hud/PodBoard";
import { filesChangedForTask, countBranches } from "../src/state/boards";
import { useStore } from "../src/state/store";
import { manager, worker, worker2, task, snapshot } from "./fixtures";
import type { FeedItem } from "../src/state/store";

beforeEach(() => useStore.getState().reset());

const podA: Space = { id: "pod-a", name: "Pod A", kind: "pod", q: 1, r: 0, ring: 1, x: 0, z: 0, seats: 4 };
const officeSpace: Space = { id: "office", name: "Manager's Office", kind: "office", q: 0, r: 0, ring: 0, x: 0, z: 0, seats: 1 };

// ── boards.ts helpers ─────────────────────────────────────────────────────────

describe("filesChangedForTask", () => {
  it("returns unique paths in encounter order", () => {
    const feed: FeedItem[] = [
      { ts: 1, taskId: "t1", event: { type: "file_changed", path: "/a/foo.ts", kind: "modify" } },
      { ts: 2, taskId: "t1", event: { type: "file_changed", path: "/a/bar.ts", kind: "create" } },
      { ts: 3, taskId: "t1", event: { type: "file_changed", path: "/a/foo.ts", kind: "modify" } }, // duplicate
      { ts: 4, taskId: "other", event: { type: "file_changed", path: "/a/other.ts", kind: "modify" } },
    ];
    expect(filesChangedForTask("t1", feed)).toEqual(["/a/foo.ts", "/a/bar.ts"]);
  });

  it("returns empty array when no file events for task", () => {
    const feed: FeedItem[] = [{ ts: 1, taskId: "other", event: { type: "text", text: "hi" } }];
    expect(filesChangedForTask("t1", feed)).toEqual([]);
  });
});

describe("countBranches", () => {
  it("counts nested branches recursively", () => {
    const branches = [
      { task: task({ id: "a", status: "done" }), children: [
        { task: task({ id: "b", status: "done" }), children: [] },
        { task: task({ id: "c", status: "running" }), children: [] },
      ] },
      { task: task({ id: "d", status: "failed" }), children: [] },
    ];
    const { total, done } = countBranches(branches);
    expect(total).toBe(4);
    expect(done).toBe(2);
  });

  it("returns 0/0 for empty branches", () => {
    expect(countBranches([])).toEqual({ total: 0, done: 0 });
  });
});

// ── PodBoard kanban ───────────────────────────────────────────────────────────

describe("PodBoard kanban columns", () => {
  it("renders all 5 columns with correct task grouping", () => {
    const workerInPodA = { ...worker, placement: { space: "pod-a", seat: 0 } };
    useStore.getState().apply(
      snapshot(
        [manager, workerInPodA],
        [
          task({ id: "q1", status: "queued", assigneeId: workerInPodA.id }),
          task({ id: "q2", status: "assigned", assigneeId: workerInPodA.id }),
          task({ id: "r1", status: "running", assigneeId: workerInPodA.id }),
          task({ id: "w1", status: "waiting", assigneeId: workerInPodA.id }),
          task({ id: "d1", status: "done", assigneeId: workerInPodA.id }),
          task({ id: "f1", status: "failed", assigneeId: workerInPodA.id }),
        ],
      ),
    );
    render(<PodBoard space={podA} onClose={vi.fn()} />);

    // All five columns are rendered
    expect(screen.getByRole("region", { name: "Queued" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "In progress" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Waiting on you" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Done (recent)" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Failed" })).toBeInTheDocument();

    // Assigned tasks map to Queued
    const queuedCol = screen.getByTestId("kanban-col-queued");
    expect(within(queuedCol).getAllByTestId("kanban-card")).toHaveLength(2); // queued + assigned

    // Done and failed each have one card
    expect(within(screen.getByTestId("kanban-col-done")).getAllByTestId("kanban-card")).toHaveLength(1);
    expect(within(screen.getByTestId("kanban-col-failed")).getAllByTestId("kanban-card")).toHaveLength(1);
  });

  it("shows empty-pod message when no workers are seated", () => {
    useStore.getState().apply(snapshot([manager], [])); // no workers at all
    render(<PodBoard space={podA} onClose={vi.fn()} />);
    expect(screen.getByText(/no workers seated/i)).toBeInTheDocument();
  });
});

// ── Filter chips ──────────────────────────────────────────────────────────────

describe("PodBoard filter chips", () => {
  it("shows agent chips and filters columns on toggle", async () => {
    const w1 = { ...worker, id: "w_alpha", name: "Alpha", placement: { space: "pod-a", seat: 0 } };
    const w2 = { ...worker2, id: "w_beta", name: "Beta", placement: { space: "pod-a", seat: 1 } };
    useStore.getState().apply(
      snapshot(
        [manager, w1, w2],
        [
          task({ id: "ta", title: "Alpha task", status: "queued", assigneeId: w1.id }),
          task({ id: "tb", title: "Beta task", status: "queued", assigneeId: w2.id }),
        ],
      ),
    );
    render(<PodBoard space={podA} onClose={vi.fn()} />);

    // Both tasks visible initially
    expect(screen.getByText("Alpha task")).toBeInTheDocument();
    expect(screen.getByText("Beta task")).toBeInTheDocument();

    // Click Alpha's chip to filter
    const alphaChip = screen.getByTestId(`filter-chip-${w1.id}`);
    await userEvent.click(alphaChip);
    expect(alphaChip).toHaveAttribute("aria-pressed", "true");

    // Beta task disappears
    expect(screen.getByText("Alpha task")).toBeInTheDocument();
    expect(screen.queryByText("Beta task")).not.toBeInTheDocument();

    // Click All to reset
    await userEvent.click(screen.getByTestId("filter-chip-all"));
    expect(screen.getByText("Beta task")).toBeInTheDocument();
  });

  it("multi-selects two agents", async () => {
    const w1 = { ...worker, id: "w_a1", name: "A1", placement: { space: "pod-a", seat: 0 } };
    const w2 = { ...worker2, id: "w_a2", name: "A2", placement: { space: "pod-a", seat: 1 } };
    useStore.getState().apply(
      snapshot(
        [manager, w1, w2],
        [
          task({ id: "t1", title: "Task A1", assigneeId: w1.id }),
          task({ id: "t2", title: "Task A2", assigneeId: w2.id }),
        ],
      ),
    );
    render(<PodBoard space={podA} onClose={vi.fn()} />);

    await userEvent.click(screen.getByTestId(`filter-chip-${w1.id}`));
    await userEvent.click(screen.getByTestId(`filter-chip-${w2.id}`));

    // Both selected, both tasks visible
    expect(screen.getByText("Task A1")).toBeInTheDocument();
    expect(screen.getByText("Task A2")).toBeInTheDocument();
    expect(screen.getByTestId(`filter-chip-${w1.id}`)).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId(`filter-chip-${w2.id}`)).toHaveAttribute("aria-pressed", "true");
  });
});

// ── Detail drawer ─────────────────────────────────────────────────────────────

describe("PodBoard task drawer", () => {
  function renderPodWithTask(t: ReturnType<typeof task>) {
    const workerInPodA = { ...worker, placement: { space: "pod-a", seat: 0 } };
    useStore.getState().apply(snapshot([manager, workerInPodA], [t]));
    return render(<PodBoard space={podA} onClose={vi.fn()} />);
  }

  it("opens drawer when card is clicked and closes with close button", async () => {
    renderPodWithTask(task({ id: "d1", title: "My task", description: "A description" }));

    const card = screen.getByRole("button", { name: /my task/i });
    expect(screen.queryByTestId("task-drawer")).not.toBeInTheDocument();

    await userEvent.click(card);
    expect(screen.getByTestId("task-drawer")).toBeInTheDocument();
    expect(screen.getByText("A description")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /close drawer/i }));
    expect(screen.queryByTestId("task-drawer")).not.toBeInTheDocument();
  });

  it("toggles drawer closed when the same card is clicked again", async () => {
    renderPodWithTask(task({ id: "d2", title: "Toggle me" }));
    const card = screen.getByRole("button", { name: /toggle me/i });
    await userEvent.click(card);
    expect(screen.getByTestId("task-drawer")).toBeInTheDocument();
    await userEvent.click(card);
    expect(screen.queryByTestId("task-drawer")).not.toBeInTheDocument();
  });

  it("shows result and error in drawer", async () => {
    renderPodWithTask(task({ id: "d3", title: "Fail task", status: "failed", error: "Something went wrong" }));
    await userEvent.click(screen.getByRole("button", { name: /fail task/i }));
    const drawer = screen.getByTestId("task-drawer");
    expect(within(drawer).getByText("Something went wrong")).toBeInTheDocument();
  });

  it("shows files changed in drawer from feed events", async () => {
    const workerInPodA = { ...worker, placement: { space: "pod-a", seat: 0 } };
    useStore.getState().apply(
      snapshot([manager, workerInPodA], [task({ id: "d4", title: "File task" })]),
    );
    useStore.setState({
      feed: {
        [workerInPodA.id]: [
          { ts: 1, taskId: "d4", event: { type: "file_changed", path: "/src/index.ts", kind: "modify" } },
          { ts: 2, taskId: "d4", event: { type: "file_changed", path: "/src/App.tsx", kind: "create" } },
        ],
      },
    });
    render(<PodBoard space={podA} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /file task/i }));
    const drawer = screen.getByTestId("task-drawer");
    expect(within(drawer).getByText("index.ts")).toBeInTheDocument();
    expect(within(drawer).getByText("App.tsx")).toBeInTheDocument();
  });

  it("shows Open in Inbox button for waiting tasks", async () => {
    const onOpenInbox = vi.fn();
    const workerInPodA = { ...worker, placement: { space: "pod-a", seat: 0 } };
    useStore.getState().apply(
      snapshot([manager, workerInPodA], [task({ id: "d5", title: "Waiting task", status: "waiting" })]),
    );
    render(<PodBoard space={podA} onClose={vi.fn()} onOpenInbox={onOpenInbox} />);
    await userEvent.click(screen.getByRole("button", { name: /waiting task/i }));
    const drawer = screen.getByTestId("task-drawer");
    const inboxBtn = within(drawer).getByRole("button", { name: /open in inbox/i });
    expect(inboxBtn).toBeInTheDocument();
    await userEvent.click(inboxBtn);
    expect(onOpenInbox).toHaveBeenCalled();
  });
});

// ── Manager board ─────────────────────────────────────────────────────────────

describe("Manager board", () => {
  it("renders requests with delegated tasks and progress bar", async () => {
    const childDone = task({ id: "c1", title: "Child done", status: "done", parentId: "req1", assigneeId: worker.id });
    const childRunning = task({ id: "c2", title: "Child running", status: "running", parentId: "req1", assigneeId: worker.id });
    const request = task({ id: "req1", title: "Build login", kind: "request", assigneeId: manager.id });

    useStore.getState().apply(snapshot([manager, worker], [request, childDone, childRunning]));
    render(<PodBoard space={officeSpace} onClose={vi.fn()} />);

    // Row for the request
    const rows = screen.getAllByTestId("manager-row");
    expect(rows).toHaveLength(1);
    expect(within(rows[0]!).getByText("Build login")).toBeInTheDocument();

    // Progress bar should show 1/2
    expect(within(rows[0]!).getByTestId("manager-progress-bar")).toBeInTheDocument();

    // Expand to see delegated tasks
    await userEvent.click(within(rows[0]!).getByRole("button", { name: /build login/i }));
    const delegated = screen.getByTestId("delegated-cards");
    expect(within(delegated).getByText("Child done")).toBeInTheDocument();
    expect(within(delegated).getByText("Child running")).toBeInTheDocument();
  });

  it("shows empty state when no manager requests exist", () => {
    useStore.getState().apply(snapshot([manager, worker], []));
    render(<PodBoard space={officeSpace} onClose={vi.fn()} />);
    expect(screen.getByText(/no requests yet/i)).toBeInTheDocument();
  });
});
