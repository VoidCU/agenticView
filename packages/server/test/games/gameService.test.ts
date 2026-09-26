import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GameService, rpsResult } from "../../src/games/gameService.js";
import { EventBus } from "../../src/events/bus.js";
import { AgentRegistry } from "../../src/agents/registry.js";
import type { Move, ServerMessage } from "@agenticview/shared";

let home: string;
let proj: string;
const savedHome = process.env.AGENTICVIEW_HOME;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "av-gm-h-"));
  proj = await mkdtemp(join(tmpdir(), "av-gm-p-"));
  process.env.AGENTICVIEW_HOME = home;
});
afterEach(async () => {
  process.env.AGENTICVIEW_HOME = savedHome;
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  await rm(proj, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function makeService(overrides: { randomInt?: (max: number) => number; randomDelay?: () => number; now?: () => number } = {}) {
  const bus = new EventBus();
  const msgs: ServerMessage[] = [];
  bus.on((m) => msgs.push(m));
  const registry = new AgentRegistry({ kind: "project", projectPath: proj });
  const svc = new GameService({
    root: proj,
    bus,
    registry,
    ...overrides,
  });
  return { svc, bus, msgs, registry };
}

// ─── rpsResult ──────────────────────────────────────────────────────────────

describe("rpsResult", () => {
  it("draws on identical moves", () => {
    expect(rpsResult("rock", "rock")).toBeNull();
    expect(rpsResult("paper", "paper")).toBeNull();
    expect(rpsResult("scissors", "scissors")).toBeNull();
  });

  it("rock beats scissors", () => {
    expect(rpsResult("rock", "scissors")).toBe("a");
    expect(rpsResult("scissors", "rock")).toBe("b");
  });

  it("scissors beats paper", () => {
    expect(rpsResult("scissors", "paper")).toBe("a");
    expect(rpsResult("paper", "scissors")).toBe("b");
  });

  it("paper beats rock", () => {
    expect(rpsResult("paper", "rock")).toBe("a");
    expect(rpsResult("rock", "paper")).toBe("b");
  });
});

// ─── Move distribution ──────────────────────────────────────────────────────

describe("move distribution", () => {
  it("produces all three moves with a real rng (chi-square-ish, very loose bound)", async () => {
    const { svc, registry } = makeService({ randomDelay: () => 999_999_999 });
    svc.start();

    // Create two lounging agents.
    const a = await registry.create({ name: "Alpha", specialty: "a", role: "worker", scope: "project" });
    const b = await registry.create({ name: "Beta", specialty: "b", role: "worker", scope: "project" });
    await registry.update(a.id, { lounging: true });
    await registry.update(b.id, { lounging: true });

    const counts: Record<Move, number> = { rock: 0, paper: 0, scissors: 0 };
    const N = 300;
    for (let i = 0; i < N; i++) {
      const match = await svc.runAutoMatch();
      if (match) counts[match.moves[0]]++;
    }
    // Each move should appear at least N/3 * 0.5 times (very loose).
    const min = N / 6;
    expect(counts.rock).toBeGreaterThan(min);
    expect(counts.paper).toBeGreaterThan(min);
    expect(counts.scissors).toBeGreaterThan(min);

    svc.stop();
  });
});

// ─── Scoring / persistence ──────────────────────────────────────────────────

describe("agent auto-match scoring", () => {
  it("records wins, losses and draws correctly", async () => {
    // Deterministic: always return 0 (rock) for both agents -> draw.
    const { svc, registry } = makeService({ randomInt: () => 0, randomDelay: () => 999_999_999 });
    svc.start();
    const a = await registry.create({ name: "Alpha", specialty: "a", role: "worker", scope: "project" });
    const b = await registry.create({ name: "Beta", specialty: "b", role: "worker", scope: "project" });
    await registry.update(a.id, { lounging: true });
    await registry.update(b.id, { lounging: true });

    const match = await svc.runAutoMatch();
    expect(match).not.toBeNull();
    expect(match!.winner).toBeNull(); // draw: both rock

    const games = await svc.getGames();
    const aStats = games.leaderboard.find((p) => p.playerId === a.id);
    const bStats = games.leaderboard.find((p) => p.playerId === b.id);
    expect(aStats?.draws).toBe(1);
    expect(bStats?.draws).toBe(1);
    svc.stop();
  });

  it("counts win for rock vs scissors (non-draw outcome recorded)", async () => {
    // Agent always plays rock (index 0) so rock vs rock = draw. Use alternating to get rock vs scissors.
    // Use a counter that returns 0 for index selections and alternates 0/2 for moves.
    let moveCall = 0;
    const { svc, registry } = makeService({
      randomInt: (max) => {
        if (max <= 2) return 0; // index selection: pick first two lounging agents
        // max === 3: alternating rock and scissors for the two moves
        return moveCall++ % 2 === 0 ? 0 : 2;
      },
      randomDelay: () => 999_999_999,
    });
    svc.start();
    const a = await registry.create({ name: "Alpha", specialty: "a", role: "worker", scope: "project" });
    const b = await registry.create({ name: "Beta", specialty: "b", role: "worker", scope: "project" });
    await registry.update(a.id, { lounging: true });
    await registry.update(b.id, { lounging: true });

    const match = await svc.runAutoMatch();
    // Rock vs scissors: first player wins, non-null winner.
    expect(match!.winner).not.toBeNull();
    expect([a.id, b.id]).toContain(match!.winner);

    const games = await svc.getGames();
    const winner = games.leaderboard.find((p) => p.playerId === match!.winner);
    expect(winner?.wins).toBe(1);
    const loser = games.leaderboard.find((p) => p.playerId !== match!.winner && p.playerId !== "you");
    expect(loser?.losses).toBe(1);
    svc.stop();
  });

  it("persists and reloads matches across service instances", async () => {
    const { svc, registry } = makeService({ randomInt: () => 0, randomDelay: () => 999_999_999 });
    svc.start();
    const a = await registry.create({ name: "Alpha", specialty: "a", role: "worker", scope: "project" });
    const b = await registry.create({ name: "Beta", specialty: "b", role: "worker", scope: "project" });
    await registry.update(a.id, { lounging: true });
    await registry.update(b.id, { lounging: true });
    await svc.runAutoMatch();
    svc.stop();

    // New service instance, same root.
    const { svc: svc2 } = makeService({ randomDelay: () => 999_999_999 });
    const games = await svc2.getGames();
    expect(games.recent).toHaveLength(1);
    expect(games.leaderboard.length).toBeGreaterThan(0);
    svc2.stop();
  });
});

// ─── User best-of-3 ──────────────────────────────────────────────────────────

describe("user best-of-3", () => {
  it("plays a full best-of-3 match and emits game.result when done", async () => {
    // Agent always plays scissors (idx 2), so user wins every round with rock (idx 0).
    const { svc, msgs, registry } = makeService({ randomInt: () => 2, randomDelay: () => 999_999_999 });
    svc.start();
    const agent = await registry.create({ name: "Nova", specialty: "x", role: "worker", scope: "project" });

    // Round 1: user rock vs agent scissors -> user wins
    const r1 = await svc.playUser(agent.id, undefined, "rock");
    expect(r1.round).toBe(1);
    expect(r1.winner).toBe("you");
    expect(r1.score).toEqual({ you: 1, agent: 0 });
    expect(r1.done).toBe(false);

    // Round 2: user rock vs agent scissors -> user wins again -> done (2-0)
    const r2 = await svc.playUser(agent.id, r1.matchId, "rock");
    expect(r2.round).toBe(2);
    expect(r2.done).toBe(true);
    expect(r2.score).toEqual({ you: 2, agent: 0 });

    // game.result should have been broadcast
    const result = msgs.find((m) => m.type === "game.result");
    expect(result).toBeDefined();
    if (result?.type === "game.result") {
      expect(result.match.winner).toBe("you");
      expect(result.match.kind).toBe("user");
      expect(result.match.players).toEqual(["you", agent.id]);
    }

    // Leaderboard has both "you" and the agent.
    const games = await svc.getGames();
    expect(games.leaderboard.find((p) => p.playerId === "you")?.wins).toBe(1);
    expect(games.leaderboard.find((p) => p.playerId === agent.id)?.losses).toBe(1);
    svc.stop();
  });

  it("records a draw when best-of-3 ends 1-1-1", async () => {
    let call = 0;
    // Sequence: agent plays rock(0), scissors(2), paper(1) — user plays paper, paper, scissors
    // Round 1: user paper vs agent rock -> user wins
    // Round 2: user paper vs agent scissors -> agent wins
    // Round 3: user scissors vs agent paper -> user wins (but let's arrange agent moves to get a draw)
    // For a match draw we need 1-1 after round 2 and draw on round 3:
    // agent: rock(0), scissors(2), rock(0); user: paper, paper, paper -> paper beats rock, agent wins scissors vs paper, paper vs rock -> user wins -> not a draw
    // Let's do: agent: scissors(2), rock(0), scissors(2); user: rock, scissors, rock
    // r1: rock vs scissors -> user wins (1-0)
    // r2: scissors vs rock -> agent wins (1-1)
    // r3: rock vs scissors -> user wins (2-1) -> not a draw
    // Actually for a tie we need score 1-1 after 3 rounds with a draw on last:
    // agent: scissors(2), rock(0), scissors(2); user: rock, paper, scissors
    // r1: rock vs scissors -> user wins (1-0)
    // r2: paper vs rock -> user wins (2-0) -> done, user wins
    // Simpler: agent always plays same as user -> all draws
    // Use the real rng for agent, but inject user moves to force draws.
    // Agent plays rock(0) always; user plays rock.
    const { svc, registry } = makeService({ randomInt: () => 0, randomDelay: () => 999_999_999 });
    svc.start();
    const agent = await registry.create({ name: "Bot", specialty: "x", role: "worker", scope: "project" });

    // 3 rounds of rock vs rock -> 3 draws -> score 0-0 -> match draw
    const r1 = await svc.playUser(agent.id, undefined, "rock");
    expect(r1.winner).toBeNull();
    const r2 = await svc.playUser(agent.id, r1.matchId, "rock");
    expect(r2.winner).toBeNull();
    const r3 = await svc.playUser(agent.id, r1.matchId, "rock");
    expect(r3.done).toBe(true);
    expect(r3.score).toEqual({ you: 0, agent: 0 });

    const games = await svc.getGames();
    expect(games.leaderboard.find((p) => p.playerId === "you")?.draws).toBe(1);
    svc.stop();
  });

  it("rejects wrong opponentId for an existing matchId", async () => {
    const { svc, registry } = makeService({ randomInt: () => 0, randomDelay: () => 999_999_999 });
    svc.start();
    const agent = await registry.create({ name: "Bot", specialty: "x", role: "worker", scope: "project" });
    const r1 = await svc.playUser(agent.id, undefined, "rock");
    await expect(svc.playUser("wrong-id", r1.matchId, "rock")).rejects.toThrow("opponentId mismatch");
    svc.stop();
  });
});

// ─── Idle lounging timer ──────────────────────────────────────────────────────

describe("idle lounging timer", () => {
  it("sets lounging after idle delay elapses (triggerLounging)", async () => {
    const { svc, registry, msgs } = makeService({ randomDelay: () => 999_999_999 });
    svc.start();
    const agent = await registry.create({ name: "Idle", specialty: "x", role: "worker", scope: "project" });

    // Before triggering, agent is not lounging.
    const before = await registry.get(agent.id);
    expect(before?.lounging).toBeUndefined();

    // Trigger directly (simulates timer firing then async completing).
    await svc.triggerLounging(agent.id);

    const after = await registry.get(agent.id);
    expect(after?.lounging).toBe(true);
    const updMsgs = msgs.filter((m) => m.type === "agent.updated") as Array<{ type: "agent.updated"; agent: { lounging?: boolean } }>;
    expect(updMsgs.some((m) => m.agent.lounging === true)).toBe(true);

    svc.stop();
  });

  it("onAgentIdle registers a timer that sets lounging using fake timers", async () => {
    vi.useFakeTimers();
    const { svc, registry } = makeService({ randomDelay: () => 999_999_999 });
    svc.start();
    const agent = await registry.create({ name: "Idle", specialty: "x", role: "worker", scope: "project" });

    svc.onAgentIdle(agent.id, 1);
    const before = await registry.get(agent.id);
    expect(before?.lounging).toBeUndefined();

    // Advance time past 1 minute, then flush the microtasks from setLouging_internal.
    vi.advanceTimersByTime(61_000);
    // Wait for the async triggerLounging to complete.
    await new Promise<void>((resolve) => { vi.useRealTimers(); setTimeout(resolve, 50); });

    const after = await registry.get(agent.id);
    expect(after?.lounging).toBe(true);

    svc.stop();
  });

  it("cancels lounging timer when agent becomes busy", async () => {
    const { svc, registry } = makeService({ randomDelay: () => 999_999_999 });
    svc.start();
    const agent = await registry.create({ name: "Worker", specialty: "x", role: "worker", scope: "project" });

    // Start idle, then immediately mark busy.
    svc.onAgentIdle(agent.id, 60); // 60 minutes — won't fire naturally
    await svc.onAgentBusy(agent.id);

    const after = await registry.get(agent.id);
    expect(after?.lounging).toBeUndefined();
    svc.stop();
  });

  it("clears lounging when agent becomes busy", async () => {
    const { svc, registry, msgs } = makeService({ randomDelay: () => 999_999_999 });
    svc.start();
    const agent = await registry.create({ name: "Worker", specialty: "x", role: "worker", scope: "project" });

    // Set the agent to lounging directly.
    await registry.update(agent.id, { lounging: true });
    // Notify service that agent is busy.
    await svc.onAgentBusy(agent.id);

    const after = await registry.get(agent.id);
    expect(after?.lounging).toBeUndefined();
    expect(msgs.some((m) => m.type === "agent.updated")).toBe(true);

    svc.stop();
  });

  it("does nothing when idleLoungeMinutes is 0", async () => {
    const { svc, registry } = makeService({ randomDelay: () => 999_999_999 });
    svc.start();
    const agent = await registry.create({ name: "Worker", specialty: "x", role: "worker", scope: "project" });

    svc.onAgentIdle(agent.id, 0);
    // No timer set, so agent stays non-lounging.
    const after = await registry.get(agent.id);
    expect(after?.lounging).toBeUndefined();
    svc.stop();
  });
});

// ─── No auto-match with fewer than 2 lounging agents ────────────────────────

describe("auto-match guard", () => {
  it("returns null when fewer than 2 lounging agents", async () => {
    const { svc, registry } = makeService({ randomDelay: () => 999_999_999 });
    svc.start();
    const a = await registry.create({ name: "Lone", specialty: "x", role: "worker", scope: "project" });
    await registry.update(a.id, { lounging: true });

    const match = await svc.runAutoMatch();
    expect(match).toBeNull();
    svc.stop();
  });
});

// ─── game.result broadcast ───────────────────────────────────────────────────

describe("game.result broadcast", () => {
  it("emits game.result for agent auto-matches", async () => {
    const { svc, msgs, registry } = makeService({ randomInt: () => 0, randomDelay: () => 999_999_999 });
    svc.start();
    const a = await registry.create({ name: "A", specialty: "x", role: "worker", scope: "project" });
    const b = await registry.create({ name: "B", specialty: "x", role: "worker", scope: "project" });
    await registry.update(a.id, { lounging: true });
    await registry.update(b.id, { lounging: true });

    await svc.runAutoMatch();

    const result = msgs.find((m) => m.type === "game.result");
    expect(result).toBeDefined();
    if (result?.type === "game.result") {
      expect(result.match.kind).toBe("agents");
      expect(result.match.players).toHaveLength(2);
    }
    svc.stop();
  });
});
