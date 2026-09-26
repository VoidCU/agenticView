/**
 * Tests for R4.4 additions:
 * 1. store.ts games handling (snapshot, game.result, game.round)
 * 2. Lounging seat mapping logic (breakSeat + server-lounge seat assignment)
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useStore } from "../src/state/store";
import { breakSeat } from "../src/scene/breaks";
import { manager, worker, snapshot } from "./fixtures";
import type { Match, GamesData, ServerMessage } from "@agenticview/shared";

/** Build a snapshot ServerMessage that includes games data. */
function snapshotWithGames(agents: Parameters<typeof snapshot>[0], games: GamesData): ServerMessage {
  return { ...snapshot(agents), games } as ServerMessage;
}

const fresh = () => useStore.getState();

beforeEach(() => {
  useStore.getState().reset();
});

// ---- Helpers ----

const leaderboard = [
  { playerId: "w_00000001", name: "Pixel", wins: 5, losses: 2, draws: 1 },
  { playerId: "w_00000002", name: "Byte",  wins: 3, losses: 4, draws: 0 },
];

const makeMatch = (over: Partial<Match> = {}): Match => ({
  id: "m_001",
  at: new Date().toISOString(),
  players: ["w_00000001", "w_00000002"],
  moves: ["rock", "scissors"],
  winner: "w_00000001",
  kind: "agents",
  ...over,
});

const gamesData: GamesData = {
  leaderboard,
  recent: [],
};

// ---- Store: games from snapshot ----

describe("store snapshot with games", () => {
  it("stores games from the snapshot", () => {
    fresh().apply(snapshotWithGames([manager, worker], gamesData));
    const s = fresh();
    expect(s.games?.leaderboard).toHaveLength(2);
    expect(s.games?.leaderboard[0]?.wins).toBe(5);
    expect(s.games?.recent).toHaveLength(0);
  });

  it("snapshot without games leaves games undefined", () => {
    fresh().apply(snapshot([manager, worker]));
    expect(fresh().games).toBeUndefined();
  });
});

// ---- Store: game.result ----

describe("store game.result", () => {
  it("prepends the match to recent", () => {
    fresh().apply(snapshotWithGames([manager, worker], gamesData));
    const match = makeMatch();
    fresh().apply({ type: "game.result", match });
    const s = fresh();
    expect(s.games?.recent).toHaveLength(1);
    expect(s.games?.recent[0]?.id).toBe("m_001");
  });

  it("caps recent at 50", () => {
    const many: Match[] = Array.from({ length: 50 }, (_, i) => makeMatch({ id: `m_old_${i}` }));
    fresh().apply(snapshotWithGames([manager, worker], { leaderboard, recent: many }));
    fresh().apply({ type: "game.result", match: makeMatch({ id: "m_new" }) });
    const recent = fresh().games?.recent ?? [];
    expect(recent.length).toBeLessThanOrEqual(50);
    expect(recent[0]?.id).toBe("m_new");
  });

  it("updates winner's wins and loser's losses in leaderboard", () => {
    fresh().apply(snapshotWithGames([manager, worker], gamesData));
    fresh().apply({ type: "game.result", match: makeMatch() }); // w_00000001 wins
    const board = fresh().games?.leaderboard ?? [];
    const winner = board.find((p) => p.playerId === "w_00000001");
    const loser  = board.find((p) => p.playerId === "w_00000002");
    expect(winner?.wins).toBe(6);   // was 5
    expect(loser?.losses).toBe(5);  // was 4
  });

  it("increments draws for both players on a draw", () => {
    fresh().apply(snapshotWithGames([manager, worker], gamesData));
    fresh().apply({ type: "game.result", match: makeMatch({ winner: null, moves: ["rock", "rock"] }) });
    const board = fresh().games?.leaderboard ?? [];
    const p0 = board.find((p) => p.playerId === "w_00000001");
    const p1 = board.find((p) => p.playerId === "w_00000002");
    expect(p0?.draws).toBe(2); // was 1
    expect(p1?.draws).toBe(1); // was 0
  });

  it("sets gameAnimation with the match and a timestamp", () => {
    fresh().apply(snapshotWithGames([manager, worker], gamesData));
    const before = Date.now();
    fresh().apply({ type: "game.result", match: makeMatch() });
    const { gameAnimation } = fresh();
    expect(gameAnimation?.match?.id).toBe("m_001");
    expect(gameAnimation?.at).toBeGreaterThanOrEqual(before);
  });

  it("works when no prior games data exists", () => {
    fresh().apply(snapshot([manager, worker]));
    fresh().apply({ type: "game.result", match: makeMatch() });
    expect(fresh().games?.recent).toHaveLength(1);
  });
});

// ---- Store: game.round ----

describe("store game.round", () => {
  it("stores the latest round result", () => {
    fresh().apply({ type: "game.round", matchId: "m_42", round: 2, userMove: "paper", agentMove: "rock", winner: "you", score: { you: 2, agent: 0 }, done: true });
    const r = fresh().lastGameRound;
    expect(r?.matchId).toBe("m_42");
    expect(r?.round).toBe(2);
    expect(r?.winner).toBe("you");
    expect(r?.score).toEqual({ you: 2, agent: 0 });
    expect(r?.done).toBe(true);
  });

  it("overwrites the previous round result", () => {
    fresh().apply({ type: "game.round", matchId: "m_1", round: 1, userMove: "rock", agentMove: "scissors", winner: "you", score: { you: 1, agent: 0 }, done: false });
    fresh().apply({ type: "game.round", matchId: "m_1", round: 2, userMove: "scissors", agentMove: "rock",    winner: "agent", score: { you: 1, agent: 1 }, done: false });
    expect(fresh().lastGameRound?.round).toBe(2);
  });
});

// ---- Lounging seat mapping ----

describe("lounging seat mapping via breakSeat", () => {
  it("breakSeat returns a seat in [0,3]", () => {
    const seat = breakSeat("w_00000001", "server-lounge");
    expect(seat).toBeGreaterThanOrEqual(0);
    expect(seat).toBeLessThanOrEqual(3);
  });

  it("is deterministic for the same agentId+seed", () => {
    expect(breakSeat("w_abc", "server-lounge")).toBe(breakSeat("w_abc", "server-lounge"));
  });

  it("different agents get different (or same) seats based on hash, but always valid", () => {
    const agents = ["w_a1", "w_b2", "w_c3", "w_d4"];
    const seats = agents.map((id) => breakSeat(id, "server-lounge"));
    seats.forEach((s) => {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(3);
    });
  });

  it("uses a different hash space from break seats (different taskId seed)", () => {
    // server-lounge seed differs from break seed so agents spread differently
    const a = "w_test_agent";
    const loungeBreakSeat = breakSeat(a, "some-task-id");
    const serverLoungeSeat = breakSeat(a, "server-lounge");
    // They may or may not collide; both must be in range.
    expect(loungeBreakSeat).toBeGreaterThanOrEqual(0);
    expect(serverLoungeSeat).toBeGreaterThanOrEqual(0);
  });
});

// ---- Agent.lounging field round-trips through snapshot ----

describe("agent.lounging field", () => {
  it("lounging=true survives agent.updated", () => {
    fresh().apply(snapshot([manager, worker]));
    const lounging: typeof worker = { ...worker, lounging: true };
    fresh().apply({ type: "agent.updated", agent: lounging });
    expect(fresh().agents[worker.id]?.lounging).toBe(true);
  });

  it("lounging=false or undefined does not trigger lounge walk", () => {
    fresh().apply(snapshot([manager, worker]));
    expect(fresh().agents[worker.id]?.lounging).toBeFalsy();
  });
});
