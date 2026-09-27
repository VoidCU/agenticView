import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { defaultLayout } from "@agenticview/shared";
import { LayoutEditor } from "../src/hud/LayoutEditor";
import { SettingsModal } from "../src/hud/SettingsModal";
import { useStore } from "../src/state/store";
import { manager, snapshot } from "./fixtures";

beforeEach(() => {
  useStore.getState().reset();
  useStore.getState().apply(snapshot([manager]));
});
afterEach(() => vi.unstubAllGlobals());

describe("layout state and editor", () => {
  it("takes layout from snapshots and layout.updated, and resets social state", () => {
    const first = defaultLayout(0);
    const message = snapshot([manager]);
    if (message.type !== "snapshot") throw new Error("Expected snapshot fixture");
    useStore.getState().apply({ ...message, layout: first });
    expect(useStore.getState().layout).toEqual(first);
    const moved = { ...first, rooms: first.rooms.map((r) => r.id === "myoffice" ? { ...r, name: "Studio" } : r) };
    useStore.getState().apply({ type: "layout.updated", layout: moved });
    expect(useStore.getState().layout).toEqual(moved);
    expect(useStore.getState().social).toEqual({ connected: { instagram: false, meta: false }, items: [] });
    useStore.getState().reset();
    expect(useStore.getState().layout).toBeNull();
  });

  it("moves a room by keyboard, rejects a disconnected draft, and Cancel restores the layout", async () => {
    const layout = defaultLayout(0);
    useStore.setState({ layout });
    render(<LayoutEditor />);
    const room = screen.getByRole("button", { name: "My Office, hex -2,0" });
    room.focus();
    fireEvent.keyDown(room, { key: "Enter" });
    fireEvent.keyDown(room, { key: "ArrowLeft" });
    const destination = screen.getByRole("button", { name: "Empty hex, hex -3,0" });
    expect(destination).toHaveFocus();
    fireEvent.keyDown(destination, { key: "Enter" });
    expect(screen.getByRole("button", { name: "My Office, hex -3,0" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save layout" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(/not connected/);
    await userEvent.click(screen.getByRole("button", { name: "Cancel layout changes" }));
    expect(screen.getByRole("button", { name: "My Office, hex -2,0" })).toBeInTheDocument();
    expect(useStore.getState().layout).toEqual(layout);
  });

  it("offers disabled social connection actions", async () => {
    render(<SettingsModal onClose={vi.fn()} initialTab="connections" />);
    expect(screen.getByRole("button", { name: "Connect Instagram" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Connect Meta" })).toBeDisabled();
    expect(screen.getAllByText("Coming soon")).toHaveLength(2);
    expect(screen.getByText(/messages, comments, likes and recent feeds/i)).toBeInTheDocument();
  });

  it("saves a valid rename through the authenticated layout endpoint", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ layout: defaultLayout(0), spaceNames: {} }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    useStore.setState({ layout: defaultLayout(0) });
    render(<LayoutEditor />);
    await userEvent.click(screen.getByRole("button", { name: "My Office, hex -2,0" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Room name" }), "Studio");
    await userEvent.click(screen.getByRole("button", { name: "Save layout" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/layout", expect.objectContaining({ method: "PUT" }));
    const [, request] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(request.body as string)).toEqual(expect.objectContaining({ version: 1, rooms: expect.any(Array), spaceNames: expect.objectContaining({ myoffice: "Studio" }) }));
  });

  it("drops a cleared room name so the save restores the default instead of failing validation", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ layout: defaultLayout(0), spaceNames: {} }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    useStore.setState({ layout: defaultLayout(0), spaceNames: { myoffice: "Den" } });
    render(<LayoutEditor />);
    await userEvent.click(screen.getByRole("button", { name: "Den, hex -2,0" }));
    await userEvent.clear(screen.getByRole("textbox", { name: "Room name" }));
    await userEvent.click(screen.getByRole("button", { name: "Save layout" }));
    const [, request] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(request.body as string).spaceNames).toEqual({});
  });

  it("Escape drops a selection without closing Settings, then closes it", () => {
    useStore.setState({ layout: defaultLayout(0) });
    const onClose = vi.fn();
    render(<SettingsModal onClose={onClose} initialTab="layout" />);
    const room = screen.getByRole("button", { name: "My Office, hex -2,0" });
    fireEvent.click(room);
    expect(room).toHaveAttribute("aria-pressed", "true");
    fireEvent.keyDown(room, { key: "Escape" });
    expect(room).toHaveAttribute("aria-pressed", "false");
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(room, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("the room type picker reflects the room under the keyboard cursor", () => {
    useStore.setState({ layout: defaultLayout(0) });
    render(<LayoutEditor />);
    const hub = defaultLayout(0).rooms.find((r) => r.q === 0 && r.r === 0)!;
    expect((screen.getByRole("combobox", { name: "Room type" }) as HTMLSelectElement).value).toBe(hub.kind);
  });
});
