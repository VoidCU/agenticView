import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Task } from "@agenticview/shared";
import { Timeline } from "../src/hud/Timeline";
import { useStore } from "../src/state/store";
import { askedQuestion, buildWorkflow, formatDuration, involvedAgents, mainTasks } from "../src/state/workflow";
import { agent, manager, snapshot, task, worker, worker2 } from "./fixtures";

const T0 = Date.parse("2026-09-27T09:00:00.000Z");
const at = (s: number) => new Date(T0 + s * 1000).toISOString();

const request = task({
  id: "r1",
  kind: "request",
  title: "Build a login page",
  description: "Build a login page",
  assigneeId: manager.id,
  createdBy: "user",
  status: "done",
  createdAt: at(0),
  startedAt: at(1),
  finishedAt: at(300),
  result: "Login page shipped.\n\n- **Form** with validation\n- Tests green",
  log: [
    { ts: at(0), type: "user", text: "Build a login page with **email** and password" },
    { ts: at(2), type: "tool_start", text: 'create_agent {"name":"Byte"}' },
    { ts: at(3), type: "tool_start", text: 'assign_task {"agentId":"w_00000001"}' },
    { ts: at(4), type: "tool_start", text: 'ask_user {"question":"Should it support SSO?\\nOkta or Google?"}' },
  ],
});
const form: Task = task({ id: "c1", parentId: "r1", title: "Build the form", assigneeId: worker.id, createdBy: manager.id, status: "failed", createdAt: at(5), startedAt: at(6), finishedAt: at(60), error: "Rate limit reached (429). Try again later.", tier: { provider: "claude", model: "sonnet" }, log: [] });
const formRetry: Task = task({ id: "c2", parentId: "r1", title: "Build the form", assigneeId: worker2.id, createdBy: manager.id, status: "done", createdAt: at(61), startedAt: at(62), finishedAt: at(200), result: "Form done: `LoginForm.tsx`\nwith tests", log: [{ ts: at(100), type: "status", text: "Switched to codex after a quota limit" }] });
const other: Task = task({ id: "r0", kind: "request", title: "Older request", assigneeId: manager.id, createdBy: "user", status: "done", createdAt: at(-500), finishedAt: at(-400), log: [] });
const chat: Task = task({ id: "ch", kind: "chat", title: "Hi Pixel", assigneeId: worker.id, createdBy: "user", status: "done", createdAt: at(-100), finishedAt: at(-90), log: [] });

const tasks = Object.fromEntries([request, form, formRetry, other, chat].map((t) => [t.id, t]));
const agents = Object.fromEntries([manager, worker, { ...worker2, provider: "codex" as const, model: "gpt-5" }].map((a) => [a.id, a]));

describe("workflow derivation", () => {
  it("lists main tasks only (requests and direct chats), newest first", () => {
    expect(mainTasks(tasks).map((t) => t.id)).toEqual(["r1", "ch", "r0"]);
  });

  it("counts every agent involved", () => {
    expect(involvedAgents(request, tasks).sort()).toEqual([manager.id, worker.id, worker2.id].sort());
  });

  it("tells the story in order: asked, received (+tools), delegations, question, failover, replies, final", () => {
    const steps = buildWorkflow(request, tasks, agents, (p) => (p === "claude" ? "Claude" : p === "codex" ? "Codex" : "Automatic"));
    expect(steps.map((s) => s.kind)).toEqual(["asked", "received", "question", "delegate", "failover", "delegate", "failover", "reply", "final"]);
    const [asked, received, question, d1, limit, d2, switched, reply, final] = steps;
    expect(asked!.summary).toBe("Build a login page with **email** and password");
    expect(received!.title).toBe("Atlas received it");
    expect(received!.tools).toEqual(["create_agent"]);
    expect(question!.title).toBe("Atlas asked you");
    expect(question!.summary).toBe("Should it support SSO?");
    expect(question!.full).toBe("Should it support SSO?\nOkta or Google?");
    expect(d1!.title).toBe("Atlas → Pixel (Claude / sonnet): Build the form");
    expect(d1!.retry).toBeUndefined();
    expect(limit!.title).toBe("Pixel hit a limit");
    expect(limit!.durationMs).toBe(54_000);
    expect(d2!.title).toBe("Atlas → Byte (Codex / gpt-5): Build the form");
    expect(d2!.retry).toBe(true);
    expect(switched!.title).toContain("Switched to codex");
    expect(reply!.title).toBe("Byte → Atlas");
    expect(reply!.summary).toBe("Form done: `LoginForm.tsx`");
    expect(reply!.full).toBe("Form done: `LoginForm.tsx`\nwith tests");
    expect(reply!.durationMs).toBe(138_000);
    expect(final!.title).toBe("Atlas's final report");
    expect(final!.durationMs).toBe(300_000);
    expect(final!.taskId).toBe("r1");
  });

  it("parses ask_user questions even when the logged JSON was cut short", () => {
    expect(askedQuestion('ask_user {"question":"Which DB?\\nPostgres or SQLite","context":"x"}')).toBe("Which DB?\nPostgres or SQLite");
    expect(askedQuestion('ask_user {"question":"Which DB is bes')).toBe("Which DB is bes");
  });

  it("formats durations", () => {
    expect(formatDuration(42_000)).toBe("42s");
    expect(formatDuration(185_000)).toBe("3m 05s");
    expect(formatDuration(4_320_000)).toBe("1h 12m");
  });
});

describe("Timeline panel", () => {
  beforeEach(() => {
    useStore.getState().reset();
    useStore.getState().apply(snapshot([manager, worker, agent({ ...worker2, provider: "codex", model: "gpt-5" })], Object.values(tasks)));
  });

  it("shows one row per request with status, time and agents involved", () => {
    render(<Timeline onClose={vi.fn()} />);
    const rows = screen.getAllByTestId("tl-entry");
    expect(rows).toHaveLength(3);
    expect(rows[0]!.textContent).toContain("Build a login page");
    expect(rows[0]!.textContent).toContain("Done");
    expect(rows[0]!.textContent).toContain("3 agents");
    expect(rows[0]!.textContent).toContain("took 5m 00s");
    expect(screen.queryByText(/Build the form/)).toBeNull(); // sub-tasks are not rows
  });

  it("opening a row shows its workflow; a step opens the task drawer", async () => {
    render(<Timeline onClose={vi.fn()} />);
    await userEvent.click(screen.getAllByRole("button", { name: /Build a login page/ })[0]!);
    const flow = screen.getByRole("list", { name: "Workflow: Build a login page" });
    const steps = within(flow).getAllByTestId("wf-step");
    expect(steps.map((s) => s.getAttribute("data-kind"))).toContain("delegate");
    expect(within(flow).getByText("Atlas → Byte (Codex / gpt-5): Build the form")).toBeInTheDocument();
    // Expand the full reply (markdown).
    const reply = steps.find((s) => s.getAttribute("data-kind") === "reply")!;
    await userEvent.click(within(reply).getByRole("button", { name: "Show all" }));
    expect(reply.querySelector(".wf-full code")!.textContent).toBe("LoginForm.tsx");
    // Clicking a step opens that task's drawer.
    await userEvent.click(within(flow).getByText("Atlas → Byte (Codex / gpt-5): Build the form"));
    const drawer = screen.getByTestId("task-drawer");
    expect(within(drawer).getByRole("heading", { name: "Build the form" })).toBeInTheDocument();
  });

  it("filters requests by an agent involved", async () => {
    render(<Timeline onClose={vi.fn()} />);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: /filter by agent/i }), worker2.id);
    expect(screen.getAllByTestId("tl-entry")).toHaveLength(1);
  });

  it("is empty with no requests, and closes", async () => {
    useStore.getState().reset();
    useStore.getState().apply(snapshot([worker], []));
    const onClose = vi.fn();
    render(<Timeline onClose={onClose} />);
    expect(screen.getByText(/no activity yet/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /close timeline/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
