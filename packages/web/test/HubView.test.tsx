import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProjectsPanel } from "../src/hub/HubView";
import { useStore } from "../src/state/store";
import { agent } from "./fixtures";

const hubManager = agent({ id: "m_00000009", name: "Hub", role: "manager", scope: "global", specialty: "Hub manager" });

beforeEach(() => {
  useStore.getState().reset();
  useStore.getState().apply({
    type: "snapshot",
    permissions: [],
    questions: [],
    world: {
      kind: "hub",
      name: "Hub",
      projectPath: null,
      knownProjects: [
        { path: "C:/work/alpha", name: "alpha", lastOpened: "2026-09-24T10:00:00.000Z" },
        { path: "C:/work/beta", name: "beta", lastOpened: "2026-09-23T10:00:00.000Z" },
      ],
    },
    agents: [hubManager],
    tasks: [],
    providers: [{ provider: "claude", ok: true }],
    settings: { defaultProvider: null, defaultModel: null, maxConcurrentRuns: 3 },
  });
});

describe("HubView projects panel", () => {
  it("lists known projects and Open sends project.open with the path", async () => {
    const send = vi.fn();
    useStore.setState({ send });
    render(<ProjectsPanel />);
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("beta")).toBeInTheDocument();
    const buttons = screen.getAllByRole("button", { name: /^open$/i });
    expect(buttons).toHaveLength(2);
    await userEvent.click(buttons[1]!);
    expect(send).toHaveBeenCalledWith({ type: "project.open", path: "C:/work/beta" });
  });

  it("opens the returned url in a new tab", () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    render(<ProjectsPanel />);
    act(() => useStore.getState().apply({ type: "opened", url: "http://127.0.0.1:4311/#token=abc" }));
    expect(open).toHaveBeenCalledWith("http://127.0.0.1:4311/#token=abc", "_blank", expect.anything());
    vi.unstubAllGlobals();
  });
});
