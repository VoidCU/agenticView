import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PlayRpsModal, rpsMoveForKey } from "../src/hud/PlayRpsModal";
import { borrowPointerFromWalk } from "../src/state/pointerLock";
import { useStore } from "../src/state/store";
import { useWalk } from "../src/state/walk";

describe("RPS keyboard mapping", () => {
  it.each([
    ["1", "", "rock"], ["r", "", "rock"], ["R", "", "rock"],
    ["2", "", "paper"], ["p", "", "paper"], ["P", "", "paper"],
    ["3", "", "scissors"], ["s", "", "scissors"], ["S", "", "scissors"],
    ["End", "Numpad1", "rock"], ["ArrowDown", "Numpad2", "paper"], ["PageDown", "Numpad3", "scissors"],
  ])("%s (%s) -> %s", (key, code, move) => {
    expect(rpsMoveForKey(key, code)).toBe(move);
  });
  it("ignores other keys", () => {
    for (const k of ["4", "q", "Enter", "Escape", " ", "w"]) expect(rpsMoveForKey(k)).toBeUndefined();
  });
});

describe("PlayRpsModal keyboard play", () => {
  afterEach(() => useWalk.setState({ walking: false, paused: false }));
  it("plays the move for 2/P and shows the key on each button", () => {
    const send = vi.fn();
    useStore.setState({ send, agents: {}, lastGameRound: undefined } as never);
    render(<PlayRpsModal agentId="a1" onClose={() => {}} />);
    expect(screen.getByTestId("rps-move-rock").textContent).toContain("[1/R]");
    expect(screen.getByTestId("rps-move-paper").textContent).toContain("[2/P]");
    expect(screen.getByTestId("rps-move-scissors").textContent).toContain("[3/S]");
    fireEvent.keyDown(window, { key: "p" });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: "game.play", opponentId: "a1", move: "paper" }));
    // Waiting for the result: a second key press does not double-play.
    fireEvent.keyDown(window, { key: "3" });
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("Escape closes", () => {
    useStore.setState({ send: vi.fn(), agents: {}, lastGameRound: undefined } as never);
    const onClose = vi.fn();
    render(<PlayRpsModal agentId="a1" onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});

describe("borrowPointerFromWalk", () => {
  afterEach(() => useWalk.setState({ walking: false, paused: false }));
  it("releases pointer lock without ending walk mode, and re-locks on restore", () => {
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    const requestPointerLock = vi.fn();
    canvas.requestPointerLock = requestPointerLock as never;
    const fakeDoc = { pointerLockElement: canvas as Element | null, exitPointerLock: vi.fn(() => { fakeDoc.pointerLockElement = null; }) };
    useWalk.setState({ walking: true, paused: false });
    const restore = borrowPointerFromWalk(fakeDoc as unknown as Document);
    expect(fakeDoc.exitPointerLock).toHaveBeenCalled();
    expect(useWalk.getState().paused).toBe(true);
    expect(useWalk.getState().walking).toBe(true);
    restore();
    expect(useWalk.getState().paused).toBe(false);
    expect(requestPointerLock).toHaveBeenCalled();
    canvas.remove();
  });
  it("is a no-op when nothing is locked (overview mode)", () => {
    const fakeDoc = { pointerLockElement: null, exitPointerLock: vi.fn() };
    borrowPointerFromWalk(fakeDoc as unknown as Document)();
    expect(fakeDoc.exitPointerLock).not.toHaveBeenCalled();
    expect(useWalk.getState().paused).toBe(false);
  });
  it("leaving walk mode clears the pause", () => {
    useWalk.setState({ walking: true, paused: true });
    useWalk.getState().setWalking(false);
    expect(useWalk.getState().paused).toBe(false);
  });
});

describe("PlayRpsModal stale match state", () => {
  it("does not send a previous opponent's matchId, and ignores their leftover round", () => {
    const send = vi.fn();
    // A finished round against a1 is still in the store when we open a game against a2.
    useStore.setState({
      send,
      agents: {},
      lastGameRound: { matchId: "gm_old", opponentId: "a1", opponentName: "Ana", round: 2, yourMove: "rock", agentMove: "scissors", winner: "you", score: { you: 2, agent: 0 }, done: true },
    } as never);
    render(<PlayRpsModal agentId="a2" onClose={() => {}} />);
    fireEvent.keyDown(window, { key: "1" });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: "game.play", opponentId: "a2", matchId: undefined }));
  });
});
