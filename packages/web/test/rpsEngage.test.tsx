import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { Point } from "@agenticview/shared";
import { stepPath, useEngage, yawToViewer, type PathMotion } from "../src/scene/engage";
import { AgentMenu } from "../src/hud/AgentMenu";
import { PlayRpsModal } from "../src/hud/PlayRpsModal";
import { RPS_BUSY_LINE, agentOnTask, challengeRps, rpsResultLine, rpsThrowLine } from "../src/state/rps";
import { useStore } from "../src/state/store";
import { task, worker } from "./fixtures";

/** Straight-line router: the path is just the destination. */
const direct = (_from: Point, to: Point) => [{ x: to.x, z: to.z }];
const at = (x: number, z: number): PathMotion => ({ x, z, path: [], tx: x, tz: z, vx: 0, vz: 0 });

describe("engaged pause: path progression freezes and resumes", () => {
  it("walks, freezes while engaged, then continues the same walk to the same destination", () => {
    const st = at(0, 0);
    const target = { x: 10, z: 0 };
    const opts = { dt: 0.1, speed: 2, engaged: false, route: direct };
    stepPath(st, target, opts);
    expect(st.x).toBeCloseTo(0.2);
    // Engaged: several frames pass, nothing moves, the path and its destination are untouched.
    for (let i = 0; i < 20; i++) expect(stepPath(st, target, { ...opts, engaged: true }).walking).toBe(false);
    expect(st.x).toBeCloseTo(0.2);
    expect(st.path).toEqual([{ x: 10, z: 0 }]);
    expect(st.tx).toBe(10);
    // Released: continues toward the same place.
    const r = stepPath(st, target, opts);
    expect(r.walking).toBe(true);
    expect(st.x).toBeCloseTo(0.4);
    let arrived = 0;
    for (let i = 0; i < 100; i++) stepPath(st, target, { ...opts, onArrive: () => arrived++ });
    expect(st.x).toBe(10);
    expect(arrived).toBe(1);
  });

  it("a target that changed mid-game (a break timer expired) is picked up after release", () => {
    const st = at(0, 0);
    const route = vi.fn(direct);
    stepPath(st, { x: 5, z: 0 }, { dt: 0.1, speed: 2, engaged: false, route });
    expect(route).toHaveBeenCalledTimes(1);
    // New target while engaged: no reroute, no movement.
    stepPath(st, { x: 0, z: 5 }, { dt: 0.1, speed: 2, engaged: true, route });
    expect(route).toHaveBeenCalledTimes(1);
    expect(st.tx).toBe(5);
    // Released: reroutes to the new target and heads there.
    const r = stepPath(st, { x: 0, z: 5 }, { dt: 0.1, speed: 2, engaged: false, route });
    expect(route).toHaveBeenCalledTimes(2);
    expect(st.tz).toBe(5);
    expect(r.heading).toBeDefined();
  });

  it("a robot at rest (lounging) stays at rest while engaged and after", () => {
    const st = at(3, 3);
    expect(stepPath(st, { x: 3, z: 3 }, { dt: 0.1, speed: 2, engaged: true, route: direct }).walking).toBe(false);
    expect(stepPath(st, { x: 3, z: 3 }, { dt: 0.1, speed: 2, engaged: false, route: direct }).walking).toBe(false);
    expect(st).toMatchObject({ x: 3, z: 3 });
  });

  it("faces the viewer", () => {
    expect(yawToViewer(0, 0, 0, 5)).toBeCloseTo(0);
    expect(yawToViewer(0, 0, 5, 0)).toBeCloseTo(Math.PI / 2);
  });
});

describe("RPS emotes", () => {
  it("throw and reaction lines", () => {
    expect(rpsThrowLine({ agentMove: "rock" })).toBe("Rock!");
    expect(rpsResultLine({ winner: "you", done: false, score: { you: 1, agent: 0 } })).toBe("No way!");
    expect(rpsResultLine({ winner: "agent", done: false, score: { you: 0, agent: 1 } })).toBe("Gotcha!");
    expect(rpsResultLine({ winner: null, done: false, score: { you: 0, agent: 0 } })).toBe("Again!");
    expect(rpsResultLine({ winner: "you", done: true, score: { you: 2, agent: 1 } })).toContain("Rematch?");
  });
});

describe("busy agents decline the challenge", () => {
  afterEach(() => {
    useEngage.setState({ agentId: undefined });
    useStore.setState({ tasks: {}, agents: {}, bubbles: {} } as never);
  });

  const busyTasks = { t1: task({ id: "t1", assigneeId: worker.id, status: "running" }) };

  it("agentOnTask: running/waiting count, queued/done do not", () => {
    expect(agentOnTask(busyTasks, worker.id)).toBe(true);
    expect(agentOnTask({ t: task({ id: "t", status: "waiting" }) }, worker.id)).toBe(true);
    expect(agentOnTask({ t: task({ id: "t", status: "done" }) }, worker.id)).toBe(false);
    expect(agentOnTask({}, worker.id)).toBe(false);
  });

  it("challengeRps: busy -> declined with a busy bubble; idle -> accepted", () => {
    useStore.setState({ agents: { [worker.id]: worker }, tasks: busyTasks, bubbles: {} } as never);
    expect(challengeRps(worker.id)).toBe(false);
    expect(useStore.getState().bubbles[worker.id]?.text).toBe(RPS_BUSY_LINE);
    useStore.setState({ tasks: {}, bubbles: {} } as never);
    expect(challengeRps(worker.id)).toBe(true);
    expect(useStore.getState().bubbles[worker.id]).toBeUndefined();
  });

  it("the agent menu item is disabled for a busy agent and enabled for an idle one", () => {
    useStore.setState({ agents: { [worker.id]: worker }, tasks: busyTasks } as never);
    const { unmount } = render(<AgentMenu agent={worker} />);
    fireEvent.click(screen.getByRole("button", { name: `Actions for ${worker.name}` }));
    const item = screen.getByRole("menuitem", { name: /Play rock-paper-scissors/ }) as HTMLButtonElement;
    expect(item.disabled).toBe(true);
    expect(item.title).toContain(RPS_BUSY_LINE);
    unmount();
    act(() => useStore.setState({ tasks: {} } as never));
    render(<AgentMenu agent={worker} />);
    fireEvent.click(screen.getByRole("button", { name: `Actions for ${worker.name}` }));
    expect((screen.getByRole("menuitem", { name: "Play rock-paper-scissors" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("the open popup engages its agent and releases it on close", () => {
    useStore.setState({ send: vi.fn(), agents: { [worker.id]: worker }, lastGameRound: undefined } as never);
    const { unmount } = render(<PlayRpsModal agentId={worker.id} onClose={() => {}} />);
    expect(useEngage.getState().agentId).toBe(worker.id);
    unmount();
    expect(useEngage.getState().agentId).toBeUndefined();
  });
});

describe("PlayRpsModal reveals every round with an emote", () => {
  afterEach(() => vi.useRealTimers());
  it("the first round (which also sets the match id) is revealed and the agent reacts", () => {
    vi.useFakeTimers();
    useStore.setState({ send: vi.fn(), agents: { [worker.id]: worker }, lastGameRound: undefined, bubbles: {} } as never);
    const { container } = render(<PlayRpsModal agentId={worker.id} onClose={() => {}} />);
    act(() => useStore.setState({ lastGameRound: { matchId: "m1", round: 1, userMove: "rock", agentMove: "scissors", winner: "you", score: { you: 1, agent: 0 }, done: false } } as never));
    expect(useStore.getState().bubbles[worker.id]?.text).toBe("Scissors!");
    act(() => vi.advanceTimersByTime(800));
    expect(container.ownerDocument.querySelector(".rps-round-revealed")).not.toBeNull();
    expect(useStore.getState().bubbles[worker.id]?.text).toBe("No way!");
  });
});
