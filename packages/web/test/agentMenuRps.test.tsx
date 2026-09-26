import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AgentMenu } from "../src/hud/AgentMenu";
import { worker } from "./fixtures";

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
