import { join } from "node:path";
import { randomInt as cryptoRandomInt } from "node:crypto";
import { z } from "zod";
import { newId, loungeAssignmentFor, nearbyRpsPairs } from "@agenticview/shared";
import { MoveSchema, MatchSchema } from "@agenticview/shared";
import type { Move, Match, GamesData, GameRoundResult, PlayerStats } from "@agenticview/shared";
import { readJsonFile, writeJsonFile } from "../store/jsonStore.js";
import type { EventBus } from "../events/bus.js";
import type { AgentRegistry } from "../agents/registry.js";

// ─── Persistence schema ─────────────────────────────────────────────────────

const StatsRecordSchema = z.record(
  z.string(),
  z.object({
    wins: z.number().int().min(0),
    losses: z.number().int().min(0),
    draws: z.number().int().min(0),
  }),
);
const PersistedGamesSchema = z.object({
  stats: StatsRecordSchema.default({}),
  recent: z.array(MatchSchema).default([]),
});
type PersistedGames = z.infer<typeof PersistedGamesSchema>;

// ─── In-memory user match state ──────────────────────────────────────────────

interface UserMatchState {
  matchId: string;
  opponentId: string;
  opponentName: string;
  round: number;
  score: { you: number; agent: number };
  /** Rounds played so far. */
  rounds: Array<{ userMove: Move; agentMove: Move; winner: "you" | "agent" | null }>;
}

// ─── RPS logic ───────────────────────────────────────────────────────────────

/** Returns "a" if first player wins, "b" if second player wins, null for draw. */
export function rpsResult(a: Move, b: Move): "a" | "b" | null {
  if (a === b) return null;
  if (
    (a === "rock" && b === "scissors") ||
    (a === "scissors" && b === "paper") ||
    (a === "paper" && b === "rock")
  )
    return "a";
  return "b";
}

const MOVES: Move[] = ["rock", "paper", "scissors"];

// ─── Service deps ────────────────────────────────────────────────────────────

export interface GameServiceDeps {
  root: string;
  bus: EventBus;
  registry: AgentRegistry;
  /** Override for tests: return current time in ms. */
  now?: () => number;
  /** Override for tests: return integer in [0, max). */
  randomInt?: (max: number) => number;
  /** Override for tests: returns auto-match delay ms (default 45000-120000). */
  randomDelay?: () => number;
  /** Walk-and-play time between game.started and game.result (default MATCH_PLAY_MS). */
  matchPlayMs?: number;
}

/** Time the scene gets to walk both players to the game spots and play. */
export const MATCH_PLAY_MS = 6000;

const MAX_RECENT = 50;
const MIN_DELAY_MS = 45_000;
const MAX_DELAY_MS = 120_000;

// ─── GameService ─────────────────────────────────────────────────────────────

export class GameService {
  private readonly gamesFile: string;
  private persisted: PersistedGames = { stats: {}, recent: [] };
  private loaded = false;

  /** agentId -> lounging-timer handle. */
  private readonly idleTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /** In-progress user best-of-3 matches, keyed by matchId. */
  private readonly userMatches = new Map<string, UserMatchState>();

  private autoMatchTimer: ReturnType<typeof setTimeout> | null = null;
  /** Last lounge spot assignment, so spots stay stable like in the scene. */
  private loungePrior: Record<string, string> = {};
  private stopped = false;

  constructor(private readonly deps: GameServiceDeps) {
    this.gamesFile = join(deps.root, "games.json");
  }

  private getNow(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  private getRandomInt(max: number): number {
    if (max <= 1) return 0;
    const raw = this.deps.randomInt ? this.deps.randomInt(max) : cryptoRandomInt(max);
    return raw % max;
  }

  private getRandomDelay(): number {
    if (this.deps.randomDelay) return this.deps.randomDelay();
    return this.getRandomInt(MAX_DELAY_MS - MIN_DELAY_MS + 1) + MIN_DELAY_MS;
  }

  private randomMove(): Move {
    return MOVES[this.getRandomInt(3)]!;
  }

  // ─── Persistence ─────────────────────────────────────────────────────────

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.persisted = await readJsonFile(this.gamesFile, PersistedGamesSchema, { stats: {}, recent: [] });
    this.loaded = true;
  }

  private async save(): Promise<void> {
    await writeJsonFile(this.gamesFile, this.persisted);
  }

  async getGames(): Promise<GamesData> {
    await this.load();
    const agents = await this.deps.registry.list();
    const agentNameMap = new Map(agents.map((a) => [a.id, a.name]));

    const statsEntries = Object.entries(this.persisted.stats);
    const leaderboard: PlayerStats[] = statsEntries.map(([playerId, s]) => ({
      playerId,
      name: playerId === "you" ? "You" : (agentNameMap.get(playerId) ?? playerId),
      ...s,
    }));
    leaderboard.sort((a, b) => b.wins - a.wins || a.losses - b.losses);

    return { leaderboard, recent: [...this.persisted.recent] };
  }

  private async recordMatch(match: Match): Promise<void> {
    await this.load();
    const [a, b] = match.players;
    const inc = (id: string, field: "wins" | "losses" | "draws") => {
      const cur = this.persisted.stats[id] ?? { wins: 0, losses: 0, draws: 0 };
      this.persisted.stats[id] = { ...cur, [field]: cur[field] + 1 };
    };
    if (match.winner === null) {
      inc(a, "draws");
      inc(b, "draws");
    } else if (match.winner === a) {
      inc(a, "wins");
      inc(b, "losses");
    } else {
      inc(b, "wins");
      inc(a, "losses");
    }
    this.persisted.recent = [match, ...this.persisted.recent].slice(0, MAX_RECENT);
    await this.save();
    this.deps.bus.emit({ type: "game.result", match });
  }

  // ─── Idle / lounge tracking ───────────────────────────────────────────────

  /**
   * Call when an agent starts a task: cancels idle timer and clears `lounging`.
   */
  async onAgentBusy(agentId: string): Promise<void> {
    const timer = this.idleTimers.get(agentId);
    if (timer) {
      clearTimeout(timer);
      this.idleTimers.delete(agentId);
    }
    const agent = await this.deps.registry.get(agentId);
    if (agent?.lounging) {
      const updated = await this.deps.registry.update(agentId, { lounging: undefined });
      this.deps.bus.emit({ type: "agent.updated", agent: updated });
    }
  }

  /**
   * Call when an agent finishes a task: starts the idleLoungeMinutes timer.
   */
  onAgentIdle(agentId: string, idleLoungeMinutes: number): void {
    if (idleLoungeMinutes <= 0) return;
    // Clear any existing timer first.
    const existing = this.idleTimers.get(agentId);
    if (existing) clearTimeout(existing);
    const ms = idleLoungeMinutes * 60 * 1000;
    const timer = setTimeout(() => {
      this.idleTimers.delete(agentId);
      this.setLouging_internal(agentId);
    }, ms);
    this.idleTimers.set(agentId, timer);
  }

  /** @internal exposed for tests. */
  async triggerLounging(agentId: string): Promise<void> {
    const agent = await this.deps.registry.get(agentId);
    if (!agent || agent.lounging) return;
    const updated = await this.deps.registry.update(agentId, { lounging: true });
    this.deps.bus.emit({ type: "agent.updated", agent: updated });
  }

  private setLouging_internal(agentId: string): void {
    void this.triggerLounging(agentId);
  }

  /** Returns ids of currently lounging workers. */
  private async loungingAgents(): Promise<{ id: string; name: string }[]> {
    const agents = await this.deps.registry.list();
    return agents.filter((a) => a.role === "worker" && a.lounging).map((a) => ({ id: a.id, name: a.name }));
  }

  // ─── Agent auto-matches ───────────────────────────────────────────────────

  /** Start the recurring auto-match timer. */
  start(): void {
    this.stopped = false;
    this.scheduleAutoMatch();
  }

  /** Stop all timers (call on world teardown). */
  stop(): void {
    this.stopped = true;
    if (this.autoMatchTimer) {
      clearTimeout(this.autoMatchTimer);
      this.autoMatchTimer = null;
    }
    for (const t of this.idleTimers.values()) clearTimeout(t);
    this.idleTimers.clear();
  }

  private scheduleAutoMatch(): void {
    if (this.stopped) return;
    const delay = this.getRandomDelay();
    this.autoMatchTimer = setTimeout(() => {
      this.autoMatchTimer = null;
      void this.runAutoMatch().finally(() => this.scheduleAutoMatch());
    }, delay);
  }

  /** Run one auto-match between two random lounging agents. */
  async runAutoMatch(): Promise<Match | null> {
    if (this.stopped) return null;
    const lounging = await this.loungingAgents();
    if (lounging.length < 2) return null;
    // Only neighbours (spots within RPS_PAIR_MAX_DIST) may play each other.
    const { layout, assignment } = loungeAssignmentFor(lounging.map((l) => l.id), this.loungePrior);
    this.loungePrior = assignment;
    const pairs = nearbyRpsPairs(assignment, layout.spots);
    if (pairs.length === 0) return null;
    const pair = pairs[this.getRandomInt(pairs.length)]!;
    const a = { id: pair.a };
    const b = { id: pair.b };
    const matchId = newId("gm");
    const game = layout.gameSpots[0]!;
    const playMs = this.deps.matchPlayMs ?? MATCH_PLAY_MS;
    this.deps.bus.emit({
      type: "game.started",
      matchId,
      players: [a.id, b.id],
      spotIds: [game[0].id, game[1].id],
      seatSpotIds: [assignment[a.id]!, assignment[b.id]!],
      playMs,
    });
    if (playMs > 0) await new Promise((r) => setTimeout(r, playMs));
    if (this.stopped) return null;
    const moveA = this.randomMove();
    const moveB = this.randomMove();
    const res = rpsResult(moveA, moveB);
    const winner = res === "a" ? a.id : res === "b" ? b.id : null;
    const match: Match = {
      id: matchId,
      at: new Date(this.getNow()).toISOString(),
      players: [a.id, b.id],
      moves: [moveA, moveB],
      winner,
      kind: "agents",
    };
    await this.recordMatch(match);
    return match;
  }

  // ─── User best-of-3 ──────────────────────────────────────────────────────

  /**
   * Handle a `game.play` message. Creates or continues a best-of-3 match.
   */
  async playUser(opponentId: string, matchId: string | undefined, move: Move): Promise<GameRoundResult> {
    let state: UserMatchState;

    if (matchId && this.userMatches.has(matchId)) {
      state = this.userMatches.get(matchId)!;
      if (state.opponentId !== opponentId) throw new Error("opponentId mismatch for existing matchId");
    } else {
      // New match.
      const agent = await this.deps.registry.get(opponentId);
      const opponentName = agent?.name ?? opponentId;
      const id = newId("gm");
      state = { matchId: id, opponentId, opponentName, round: 0, score: { you: 0, agent: 0 }, rounds: [] };
      this.userMatches.set(id, state);
    }

    state.round++;
    const agentMove = this.randomMove();
    const res = rpsResult(move, agentMove);
    const roundWinner: "you" | "agent" | null = res === "a" ? "you" : res === "b" ? "agent" : null;
    if (roundWinner === "you") state.score.you++;
    else if (roundWinner === "agent") state.score.agent++;
    state.rounds.push({ userMove: move, agentMove, winner: roundWinner });

    // Best-of-3: done when one side has 2 wins, or all 3 rounds played.
    const done = state.score.you >= 2 || state.score.agent >= 2 || state.round >= 3;

    const result: GameRoundResult = {
      matchId: state.matchId,
      round: state.round,
      userMove: move,
      agentMove,
      winner: roundWinner,
      score: { ...state.score },
      done,
    };

    if (done) {
      this.userMatches.delete(state.matchId);
      const matchWinner =
        state.score.you > state.score.agent
          ? "you"
          : state.score.agent > state.score.you
            ? opponentId
            : null;
      const lastRound = state.rounds[state.rounds.length - 1]!;
      const match: Match = {
        id: state.matchId,
        at: new Date(this.getNow()).toISOString(),
        players: ["you", opponentId],
        moves: [lastRound.userMove, lastRound.agentMove],
        winner: matchWinner,
        kind: "user",
      };
      await this.recordMatch(match);
    }

    return result;
  }
}
