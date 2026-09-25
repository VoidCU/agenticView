import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CreateAgentModal } from "../src/hud/CreateAgentModal";
import { useStore } from "../src/state/store";
import { manager, worker, snapshot } from "./fixtures";

beforeEach(() => {
  useStore.getState().reset();
  useStore.getState().apply(snapshot([manager, worker]));
});

describe("CreateAgentModal", () => {
  it("disables unavailable providers with the reason as title and submits agent.create", async () => {
    const send = vi.fn();
    useStore.setState({ send });
    const onClose = vi.fn();
    render(<CreateAgentModal onClose={onClose} />);

    const select = screen.getByLabelText(/provider/i) as HTMLSelectElement;
    const codex = screen.getByRole("option", { name: /codex/i }) as HTMLOptionElement;
    expect(codex).toBeDisabled();
    expect(codex).toHaveAttribute("title", "codex CLI not installed");
    expect((screen.getByRole("option", { name: "Claude" }) as HTMLOptionElement).disabled).toBe(false);
    expect(select.options[0]?.textContent).toMatch(/automatic \(claude\)/i);
    const session = screen.getByRole("option", { name: /claude code session/i }) as HTMLOptionElement;
    expect(session.disabled).toBe(false);
    expect(session.textContent).toMatch(/no worker yet/);

    await userEvent.type(screen.getByLabelText(/^name/i), "Nova");
    await userEvent.type(screen.getByLabelText(/specialty/i), "Backend APIs");
    await userEvent.type(screen.getByLabelText(/description/i), "Owns the server");
    await userEvent.selectOptions(select, "gemini");
    await userEvent.type(screen.getByLabelText(/model/i), "gemini-2.5-pro");
    await userEvent.click(screen.getByLabelText(/^web$/i));
    await userEvent.click(screen.getByLabelText(/ask before every tool/i));
    await userEvent.click(screen.getByLabelText(/global/i));
    await userEvent.click(screen.getByRole("button", { name: /create agent/i }));

    expect(send).toHaveBeenCalledTimes(1);
    const msg = send.mock.calls[0]![0];
    expect(msg).toMatchObject({
      type: "agent.create",
      agent: {
        name: "Nova",
        specialty: "Backend APIs",
        description: "Owns the server",
        provider: "gemini",
        model: "gemini-2.5-pro",
        tools: { edit: true, shell: true, web: true, screenshot: false },
        permissionMode: "ask",
        scope: "global",
      },
    });
    expect(msg.agent.appearance.color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("uses the default provider when none is chosen and closes after the agent appears", async () => {
    const send = vi.fn();
    useStore.setState({ send });
    const onClose = vi.fn();
    render(<CreateAgentModal onClose={onClose} />);
    await userEvent.type(screen.getByLabelText(/^name/i), "Echo");
    await userEvent.click(screen.getByRole("button", { name: /create agent/i }));
    const msg = send.mock.calls[0]![0];
    expect(msg.agent.provider).toBeNull();
    expect(msg.agent.model).toBeNull();
    expect(msg.agent.scope).toBe("project");
  });

  it("shows a server error for agent.create inline", async () => {
    useStore.setState({ send: vi.fn() });
    render(<CreateAgentModal onClose={vi.fn()} />);
    await userEvent.type(screen.getByLabelText(/^name/i), "Echo");
    await userEvent.click(screen.getByRole("button", { name: /create agent/i }));
    useStore.getState().apply({ type: "error", message: "codex: not installed", ref: "agent.create" });
    expect(await screen.findByRole("alert")).toHaveTextContent("codex: not installed");
  });

  it("prefills from an existing agent and sends agent.update", async () => {
    const send = vi.fn();
    useStore.setState({ send });
    render(<CreateAgentModal onClose={vi.fn()} edit={worker} />);
    expect(screen.getByLabelText(/^name/i)).toHaveValue("Pixel");
    await userEvent.clear(screen.getByLabelText(/specialty/i));
    await userEvent.type(screen.getByLabelText(/specialty/i), "Design systems");
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: "agent.update", id: worker.id, patch: expect.objectContaining({ specialty: "Design systems" }) }));
  });
});
