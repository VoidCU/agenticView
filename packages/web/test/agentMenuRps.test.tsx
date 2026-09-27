import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AgentMenu } from "../src/hud/AgentMenu";
import { worker } from "./fixtures";
import { manager, snapshot } from "./fixtures";
import { defaultLayout } from "@agenticview/shared";
import { useStore } from "../src/state/store";

describe("challenge to rock-paper-scissors from anywhere", () => {
  it("the agent menu offers RPS for a worker at its desk (not lounging)", () => {
    expect(worker.lounging).toBeFalsy();
    const onPlay = vi.fn();
    const handler = (e: Event) => onPlay((e as CustomEvent<{ agentId: string }>).detail.agentId);
    window.addEventListener("agenticview:play-rps", handler);
    render(<AgentMenu agent={worker} />);
    fireEvent.click(screen.getByRole("button", { name: `Actions for ${worker.name}` }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Play rock-paper-scissors" }));
    window.removeEventListener("agenticview:play-rps", handler);
    expect(onPlay).toHaveBeenCalledWith(worker.id);
  });
});

describe("room moves", () => {
  it("lists layout rooms and sends a free seat in the chosen room", () => {
    useStore.getState().reset();
    useStore.getState().apply(snapshot([manager, worker]));
    const send = vi.fn();
    useStore.setState({ layout: defaultLayout(1), send });
    render(<AgentMenu agent={worker} />);
    fireEvent.click(screen.getByRole("button", { name: `Actions for ${worker.name}` }));
    const select = screen.getByRole("combobox", { name: `Move ${worker.name} to room` });
    expect(screen.getByRole("option", { name: "Research Room" })).toBeInTheDocument();
    fireEvent.change(select, { target: { value: "research" } });
    expect(send).toHaveBeenCalledWith({ type: "agent.update", id: worker.id, patch: { placement: { space: "research", seat: 0 } } });
  });
});
