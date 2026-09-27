/**
 * Chat from walk mode: C on an agent within CHAT_RANGE opens its chat expanded, with the mouse freed
 * and the message box focused; Esc closes it (panel back to how it was) and walking resumes. C typed
 * into any text field never triggers it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as THREE from "three";
import { ChatPanel } from "../src/hud/ChatPanel";
import { CHAT_RANGE, WALK_HINT_KEYS, walkInteraction } from "../src/scene/WalkMode";
import { useHudPrefs } from "../src/state/hudPrefs";
import { useStore } from "../src/state/store";
import { useWalk } from "../src/state/walk";
import { closeWalkChat, endWalkChat, installWalkChatEscape, isTypingTarget, isWalkChatKey, openWalkChat, useWalkChat } from "../src/state/walkChat";
import { manager, snapshot, worker } from "./fixtures";

function robotAt(x: number, z: number, id: string) {
  const root = new THREE.Group();
  root.position.set(x, 0, z);
  const yaw = new THREE.Group(); const tilt = new THREE.Group(); const body = new THREE.Group();
  body.userData = { robotAgentId: id };
  const mesh = new THREE.Mesh();
  root.add(yaw); yaw.add(tilt); tilt.add(body); body.add(mesh);
  root.updateMatrixWorld(true);
  return mesh;
}

describe("C targets the agent under the crosshair, like E/H/G", () => {
  const tmp = new THREE.Vector3();
  const cam = { x: 0, z: 0 };
  it("opens a chat with a robot within CHAT_RANGE (about 3 units)", () => {
    expect(CHAT_RANGE).toBe(3);
    expect(walkInteraction([{ distance: 2.5, object: robotAt(0, 2.8, "r1") }], cam, tmp, "chat")).toEqual({ kind: "chat", id: "r1" });
    expect(walkInteraction([{ distance: 0.9, object: robotAt(0, 1, "r1") }], cam, tmp, "chat")).toEqual({ kind: "chat", id: "r1" });
  });
  it("ignores a robot farther away, and boards, monitors or the wall screen", () => {
    expect(walkInteraction([{ distance: 4, object: robotAt(0, CHAT_RANGE + 0.5, "r2") }], cam, tmp, "chat")).toBeUndefined();
    const board = new THREE.Mesh(); board.userData = { boardSpaceId: "pod-a" };
    const mon = new THREE.Mesh(); mon.userData = { agentId: "m1" };
    const screenMesh = new THREE.Mesh(); screenMesh.userData = { wallScreenKind: "myoffice" };
    for (const object of [board, mon, screenMesh]) expect(walkInteraction([{ distance: 1, object }], cam, tmp, "chat")).toBeUndefined();
  });
});

describe("the C key guard", () => {
  const key = (init: KeyboardEventInit & { target?: Element }) => {
    const e = new KeyboardEvent("keydown", { code: "KeyC", key: "c", bubbles: true, ...init });
    if (init.target) Object.defineProperty(e, "target", { value: init.target });
    return e;
  };
  beforeEach(() => useWalk.setState({ walking: true, paused: false, locked: true }));
  afterEach(() => {
    useWalk.setState({ walking: false, paused: false, locked: false });
    document.body.innerHTML = "";
  });

  it("fires for a plain C with focus on the page", () => {
    expect(isWalkChatKey(key({}))).toBe(true);
  });
  it.each([
    ["input", () => document.createElement("input")],
    ["textarea", () => document.createElement("textarea")],
    ["select", () => document.createElement("select")],
    ["contenteditable", () => { const d = document.createElement("div"); d.setAttribute("contenteditable", "true"); d.tabIndex = 0; return d; }],
    ["inside a contenteditable", () => { const d = document.createElement("div"); d.setAttribute("contenteditable", ""); const s = document.createElement("span"); s.tabIndex = 0; d.appendChild(s); return s; }],
  ])("never fires while typing in a %s", (_name, make) => {
    const el = make();
    document.body.appendChild(el.closest("[contenteditable]") ?? el);
    el.focus();
    expect(isTypingTarget(el)).toBe(true);
    expect(isWalkChatKey(key({ target: el }))).toBe(false);
  });
  it("never fires for Ctrl/Cmd/Alt+C (copy), a held key, another key, a dialog, or while an overlay has the mouse", () => {
    expect(isWalkChatKey(key({ ctrlKey: true }))).toBe(false);
    expect(isWalkChatKey(key({ metaKey: true }))).toBe(false);
    expect(isWalkChatKey(key({ altKey: true }))).toBe(false);
    expect(isWalkChatKey(key({ repeat: true }))).toBe(false);
    expect(isWalkChatKey(key({ code: "KeyV", key: "v" }))).toBe(false);
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.appendChild(dialog);
    expect(isWalkChatKey(key({}))).toBe(false);
    dialog.remove();
    useWalk.setState({ paused: true });
    expect(isWalkChatKey(key({}))).toBe(false);
  });
});

describe("opening and closing a walk chat", () => {
  let lockEl: Element | null = null;
  const canvas = document.createElement("canvas");
  let uninstall: () => void = () => {};
  const requestLock = () => (canvas as unknown as { requestPointerLock: ReturnType<typeof vi.fn> }).requestPointerLock;

  /** The chat panel wired to the HUD prefs, as App.tsx mounts it. */
  function Hud() {
    const collapsed = useHudPrefs((s) => s.chatCollapsed);
    const setCollapsed = useHudPrefs((s) => s.setChatCollapsed);
    return <ChatPanel collapsed={collapsed} onCollapseChange={setCollapsed} />;
  }

  beforeEach(() => {
    useStore.getState().reset();
    useStore.getState().apply(snapshot([manager, worker]));
    document.body.appendChild(canvas);
    lockEl = canvas;
    Object.defineProperty(document, "pointerLockElement", { configurable: true, get: () => lockEl });
    document.exitPointerLock = vi.fn(() => { lockEl = null; });
    (canvas as unknown as { requestPointerLock: () => void }).requestPointerLock = vi.fn(() => { lockEl = canvas; });
    useWalk.setState({ walking: true, paused: false, locked: true });
    uninstall = installWalkChatEscape();
  });
  afterEach(() => {
    uninstall();
    endWalkChat();
    useWalk.setState({ walking: false, paused: false, locked: false });
    useHudPrefs.getState().setChatCollapsed(false);
    canvas.remove();
  });

  it("expands a collapsed chat on the agent, frees the mouse and focuses the message box", async () => {
    useHudPrefs.getState().setChatCollapsed(true);
    render(<Hud />);
    expect(screen.getByRole("button", { name: "Expand chat" })).toBeInTheDocument();
    act(() => openWalkChat(worker.id));
    expect(useHudPrefs.getState().chatCollapsed).toBe(false);
    expect(useStore.getState().selectedAgentId).toBe(worker.id);
    expect(document.exitPointerLock).toHaveBeenCalledTimes(1);
    expect(useWalk.getState().paused).toBe(true);
    expect(useWalk.getState().walking).toBe(true);
    const box = screen.getByRole("textbox", { name: `Message ${worker.name}` });
    expect(box).toHaveFocus();
    // Type straight away; a "c" typed here goes into the message, not the walk keys.
    await userEvent.keyboard("can you check this");
    expect(box).toHaveValue("can you check this");
  });

  it("Esc closes the chat back to collapsed and resumes walking (mouse re-captured on request)", async () => {
    useHudPrefs.getState().setChatCollapsed(true);
    render(<Hud />);
    act(() => openWalkChat(worker.id));
    const exitWalk = vi.fn();
    window.addEventListener("keydown", exitWalk); // stands in for the walk/scene Esc handlers
    await userEvent.keyboard("{Escape}");
    window.removeEventListener("keydown", exitWalk);
    expect(exitWalk).not.toHaveBeenCalled(); // Esc closed the chat, it did not leave walk mode
    expect(useWalkChat.getState().session).toBeUndefined();
    expect(useHudPrefs.getState().chatCollapsed).toBe(true);
    expect(screen.getByRole("button", { name: "Expand chat" })).toBeInTheDocument();
    expect(useWalk.getState().paused).toBe(false);
    expect(useWalk.getState().walking).toBe(true);
    expect(requestLock()).toHaveBeenCalled();
  });

  it("an already expanded chat stays expanded on close, with focus out of the message box", async () => {
    render(<Hud />);
    act(() => openWalkChat(manager.id));
    const box = screen.getByRole("textbox", { name: `Message ${manager.name}` });
    expect(box).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(useHudPrefs.getState().chatCollapsed).toBe(false);
    expect(box).not.toHaveFocus();
    expect(useWalk.getState().paused).toBe(false);
  });

  it("C on a second agent switches the chat but keeps the original state to restore", () => {
    useHudPrefs.getState().setChatCollapsed(true);
    render(<Hud />);
    act(() => openWalkChat(worker.id));
    act(() => openWalkChat(manager.id));
    expect(document.exitPointerLock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("textbox", { name: `Message ${manager.name}` })).toHaveFocus();
    act(() => { closeWalkChat(); });
    expect(useHudPrefs.getState().chatCollapsed).toBe(true);
  });

  it("Esc with no walk chat open is left to the other handlers", async () => {
    const other = vi.fn();
    window.addEventListener("keydown", other);
    await userEvent.keyboard("{Escape}");
    window.removeEventListener("keydown", other);
    expect(other).toHaveBeenCalled();
  });

  it("a dialog opened from the chat gets Esc first", async () => {
    render(<Hud />);
    act(() => openWalkChat(worker.id));
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.appendChild(dialog);
    await userEvent.keyboard("{Escape}");
    expect(useWalkChat.getState().session).toBeDefined();
    dialog.remove();
  });

  it("the walk hint lists C chat with the other walk keys", () => {
    expect(WALK_HINT_KEYS).toBe("E slap · H say hi · G play RPS · C chat · Esc exit");
  });
});
