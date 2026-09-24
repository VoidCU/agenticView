import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PermissionToast } from "../src/hud/PermissionToast";
import { QuestionToast } from "../src/hud/QuestionToast";
import { useStore } from "../src/state/store";
import { manager, worker, snapshot } from "./fixtures";

beforeEach(() => {
  useStore.getState().reset();
  useStore.getState().apply(snapshot([manager, worker]));
});

describe("PermissionToast", () => {
  it("shows the tool with a pretty input and Allow sends permission.respond allow:true", async () => {
    const send = vi.fn();
    useStore.setState({ send });
    useStore.getState().apply({ type: "permission.request", id: "p_1", agentId: worker.id, taskId: "t", tool: "Bash", input: { command: "npm test" } });
    render(<PermissionToast />);
    expect(screen.getByText("Pixel")).toBeInTheDocument();
    expect(screen.getByText("Bash")).toBeInTheDocument();
    expect(screen.getByText("npm test")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /allow/i }));
    expect(send).toHaveBeenCalledWith({ type: "permission.respond", id: "p_1", allow: true });
  });

  it("shows the file path for edits and Deny sends allow:false", async () => {
    const send = vi.fn();
    useStore.setState({ send });
    useStore.getState().apply({ type: "permission.request", id: "p_2", agentId: worker.id, taskId: "t", tool: "Edit", input: { file_path: "src/App.tsx", old: "a" } });
    render(<PermissionToast />);
    expect(screen.getByText("src/App.tsx")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /deny/i }));
    expect(send).toHaveBeenCalledWith({ type: "permission.respond", id: "p_2", allow: false });
  });
});

describe("QuestionToast", () => {
  it("shows the question and sends question.respond with the typed answer", async () => {
    const send = vi.fn();
    useStore.setState({ send });
    useStore.getState().apply({ type: "question.request", id: "q_1", agentId: worker.id, taskId: "t", question: "Which database?" });
    render(<QuestionToast />);
    expect(screen.getByText("Which database?")).toBeInTheDocument();
    await userEvent.type(screen.getByRole("textbox", { name: /answer/i }), "Postgres{Enter}");
    expect(send).toHaveBeenCalledWith({ type: "question.respond", id: "q_1", answer: "Postgres" });
  });
});
