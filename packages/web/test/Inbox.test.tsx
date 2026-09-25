import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Inbox } from "../src/hud/Inbox";
import { TopBar } from "../src/hud/TopBar";
import { App } from "../src/App";
import { useStore } from "../src/state/store";
import { manager, worker, task, snapshot } from "./fixtures";

beforeEach(() => {
  useStore.getState().reset();
  window.location.hash = "#token=test-token";
});

describe("Inbox and TopBar badge", () => {
  it("renders count badge in TopBar and opens Inbox on click", async () => {
    const onInbox = vi.fn();
    useStore.getState().apply(snapshot([worker], []));
    useStore.setState({
      questions: [{ id: "q1", agentId: worker.id, taskId: "t1", question: "Which styling approach?" }],
      permissions: [{ id: "p1", agentId: worker.id, taskId: "t1", tool: "shell", input: { command: "npm test" } }],
    });

    render(<TopBar onCreate={vi.fn()} onSettings={vi.fn()} onInbox={onInbox} />);

    const inboxBtn = screen.getByRole("button", { name: /inbox/i });
    expect(inboxBtn).toBeInTheDocument();
    // Badge reflects questions + permissions count = 2
    expect(within(inboxBtn).getByText("2")).toBeInTheDocument();

    await userEvent.click(inboxBtn);
    expect(onInbox).toHaveBeenCalled();
  });

  it("lists pending questions with full question text, agent, task, and submits inline answer", async () => {
    const send = vi.fn();
    useStore.setState({ send });
    useStore.getState().apply(
      snapshot(
        [worker],
        [task({ id: "t1", title: "Setup auth", assigneeId: worker.id })],
      ),
    );
    useStore.setState({
      questions: [{ id: "q1", agentId: worker.id, taskId: "t1", question: "Should we use JWT or session cookies?" }],
    });

    const onClose = vi.fn();
    render(<Inbox onClose={onClose} />);

    expect(screen.getByRole("heading", { name: /inbox/i })).toBeInTheDocument();
    expect(screen.getByText("Pixel")).toBeInTheDocument();
    expect(screen.getByText(/Setup auth/)).toBeInTheDocument();
    expect(screen.getByText("Should we use JWT or session cookies?")).toBeInTheDocument();

    const input = screen.getByPlaceholderText("Type an answer");
    await userEvent.type(input, "JWT tokens with refresh cookies");
    const answerBtn = screen.getByRole("button", { name: "Answer" });
    expect(answerBtn).toBeEnabled();

    await userEvent.click(answerBtn);
    expect(send).toHaveBeenCalledWith({
      type: "question.respond",
      id: "q1",
      answer: "JWT tokens with refresh cookies",
    });
  });

  it("lists pending permissions with agent, task, tool, and allows inline Allow / Deny", async () => {
    const send = vi.fn();
    useStore.setState({ send });
    useStore.getState().apply(
      snapshot(
        [worker],
        [task({ id: "t2", title: "Database migration", assigneeId: worker.id })],
      ),
    );
    useStore.setState({
      permissions: [
        { id: "p1", agentId: worker.id, taskId: "t2", tool: "shell", input: { command: "npx prisma migrate dev" } },
      ],
    });

    const onClose = vi.fn();
    render(<Inbox onClose={onClose} />);

    expect(screen.getByText("Pixel")).toBeInTheDocument();
    expect(screen.getByText(/Database migration/)).toBeInTheDocument();
    expect(screen.getByText("shell")).toBeInTheDocument();
    expect(screen.getByText(/prisma migrate/)).toBeInTheDocument();

    const allowBtn = screen.getByRole("button", { name: "Allow shell" });
    const denyBtn = screen.getByRole("button", { name: "Deny shell" });
    expect(allowBtn).toBeInTheDocument();
    expect(denyBtn).toBeInTheDocument();

    await userEvent.click(allowBtn);
    expect(send).toHaveBeenCalledWith({
      type: "permission.respond",
      id: "p1",
      allow: true,
    });

    await userEvent.click(denyBtn);
    expect(send).toHaveBeenCalledWith({
      type: "permission.respond",
      id: "p1",
      allow: false,
    });
  });

  it("shows an empty state when inbox has no pending questions or permissions", () => {
    useStore.getState().apply(snapshot([worker], []));
    const onClose = vi.fn();
    render(<Inbox onClose={onClose} />);

    expect(screen.getByText(/your inbox is clear/i)).toBeInTheDocument();
  });

  it("closes when the close button is clicked", async () => {
    useStore.getState().apply(snapshot([worker], []));
    const onClose = vi.fn();
    render(<Inbox onClose={onClose} />);

    const closeBtn = screen.getByRole("button", { name: "Close" });
    await userEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it("opens Inbox panel when Open in Inbox button is clicked from waiting task in App", async () => {
    useStore.getState().apply(
      snapshot(
        [worker],
        [task({ id: "t_wait", title: "Waiting task", status: "waiting", assigneeId: worker.id })],
      ),
    );
    useStore.setState({
      questions: [{ id: "q1", agentId: worker.id, taskId: "t_wait", question: "Pick option A or B" }],
    });

    render(<App />);

    // Question text appears in the waiting task row (and possibly the QuestionToast)
    expect(screen.getAllByText("Pick option A or B").length).toBeGreaterThan(0);
    const openInboxBtn = screen.getByRole("button", { name: /open.*inbox/i });
    await userEvent.click(openInboxBtn);

    // Inbox modal opens
    const dialog = screen.getByRole("dialog", { name: /inbox/i });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByPlaceholderText("Type an answer")).toBeInTheDocument();
  });
});

