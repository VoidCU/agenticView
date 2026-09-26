import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatPanel } from "../src/hud/ChatPanel";
import { useState } from "react";
import { useStore } from "../src/state/store";
import { manager, worker, snapshot } from "./fixtures";

beforeEach(() => {
  useStore.getState().reset();
  useStore.getState().apply(snapshot([manager, worker]));
  useStore.getState().select(worker.id);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ChatPanel", () => {
  it("collapses and expands without unmounting its hooks", async () => {
    function Harness() {
      const [collapsed, setCollapsed] = useState(false);
      return <ChatPanel collapsed={collapsed} onCollapseChange={setCollapsed} />;
    }
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Collapse chat" }));
    const chatTab = screen.getByRole("button", { name: "Expand chat" });
    expect(chatTab).toHaveAttribute("aria-expanded", "false");
    expect(chatTab).toHaveClass("panel-tab-chat");
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    chatTab.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByRole("heading", { name: "Pixel" })).toBeInTheDocument();
  });

  it("renders the selected agent's feed with user lines on the right and agent text on the left", () => {
    const s = useStore.getState();
    s.pushUser(worker.id, "Please add a button");
    s.apply({ type: "run.event", taskId: "t", agentId: worker.id, event: { type: "text", text: "Adding the button now." } });
    s.apply({ type: "run.event", taskId: "t", agentId: worker.id, event: { type: "tool_start", name: "Edit", input: { file_path: "src/App.tsx" } } });

    render(<ChatPanel />);

    expect(screen.getByRole("heading", { name: "Pixel" })).toBeInTheDocument();
    const user = screen.getByText("Please add a button").closest(".msg");
    const agent = screen.getByText("Adding the button now.").closest(".msg");
    expect(user).toHaveClass("msg-user");
    expect(agent).toHaveClass("msg-agent");
    expect(screen.getByText(/Edit/)).toBeInTheDocument();
  });

  it("typing and pressing Enter sends chat.send with no images", async () => {
    const send = vi.fn();
    useStore.setState({ send });
    render(<ChatPanel />);
    const box = screen.getByRole("textbox", { name: /message pixel/i });
    await userEvent.type(box, "Fix the header{Enter}");
    expect(send).toHaveBeenCalledWith({ type: "chat.send", agentId: worker.id, text: "Fix the header", images: [] });
    expect(box).toHaveValue("");
    expect(screen.getByText("Fix the header")).toBeInTheDocument();
  });

  it("pasting an image uploads it and includes the returned path in images", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ path: "C:/proj/.agenticview/uploads/u_1.png" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const send = vi.fn();
    useStore.setState({ send });
    render(<ChatPanel />);
    const box = screen.getByRole("textbox", { name: /message pixel/i });
    const file = new File([new Uint8Array([1, 2, 3])], "shot.png", { type: "image/png" });
    fireEvent.paste(box, { clipboardData: { files: [file], items: [{ kind: "file", type: "image/png", getAsFile: () => file }], getData: () => "" } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toContain("/api/upload");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    await screen.findByText("shot.png");

    await userEvent.type(box, "Look at this{Enter}");
    expect(send).toHaveBeenCalledWith({ type: "chat.send", agentId: worker.id, text: "Look at this", images: ["C:/proj/.agenticview/uploads/u_1.png"] });
  });

  it("shows a prompt when no agent is selected", () => {
    useStore.getState().select(undefined);
    render(<ChatPanel />);
    expect(screen.getByText(/click a robot/i)).toBeInTheDocument();
  });
});
