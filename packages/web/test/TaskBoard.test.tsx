import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TaskBoard } from "../src/hud/TaskBoard";
import { useStore } from "../src/state/store";
import { manager, worker, task, snapshot } from "./fixtures";

beforeEach(() => {
  useStore.getState().reset();
});

describe("TaskBoard", () => {
  it("groups tasks under status headings with children indented under parents", () => {
    const parent = task({ id: "t_parent", kind: "request", title: "Build login", assigneeId: manager.id, status: "running", createdBy: "user" });
    const child = task({ id: "t_child", title: "Write form", parentId: "t_parent", status: "running" });
    const queued = task({ id: "t_q", title: "Queued one", status: "queued" });
    const assigned = task({ id: "t_a", title: "Assigned one", status: "assigned" });
    const waiting = task({ id: "t_w", title: "Waiting one", status: "waiting" });
    const done = task({ id: "t_d", title: "Done one", status: "done" });
    const failed = task({ id: "t_f", title: "Failed one", status: "failed", error: "boom" });
    useStore.getState().apply(snapshot([manager, worker], [parent, child, queued, assigned, waiting, done, failed]));

    render(<TaskBoard />);

    const section = (name: string) => screen.getByRole("region", { name });
    expect(within(section("Running")).getByText("Build login")).toBeInTheDocument();
    expect(within(section("Running")).getByText("Write form")).toBeInTheDocument();
    expect(within(section("Queued")).getByText("Queued one")).toBeInTheDocument();
    expect(within(section("Queued")).getByText("Assigned one")).toBeInTheDocument();
    expect(within(section("Waiting")).getByText("Waiting one")).toBeInTheDocument();
    expect(within(section("Done")).getByText("Done one")).toBeInTheDocument();
    expect(within(section("Failed")).getByText("Failed one")).toBeInTheDocument();

    const childRow = screen.getByText("Write form").closest("[data-depth]");
    const parentRow = screen.getByText("Build login").closest("[data-depth]");
    expect(parentRow).toHaveAttribute("data-depth", "0");
    expect(childRow).toHaveAttribute("data-depth", "1");
    expect(parentRow!.contains(childRow!)).toBe(true);
  });

  it("clicking Cancel sends task.cancel", async () => {
    const send = vi.fn();
    useStore.setState({ send });
    useStore.getState().apply(snapshot([manager, worker], [task({ id: "t_run", title: "Running one", status: "running" })]));
    render(<TaskBoard />);
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(send).toHaveBeenCalledWith({ type: "task.cancel", id: "t_run" });
  });

  it("shows an empty state when there are no tasks", () => {
    useStore.getState().apply(snapshot([manager, worker], []));
    render(<TaskBoard />);
    expect(screen.getByText(/no tasks yet/i)).toBeInTheDocument();
  });
});
