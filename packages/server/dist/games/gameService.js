import { join } from "node:path";
import { randomInt as cryptoRandomInt } from "node:crypto";
import { z } from "zod";
import { newId } from "@agenticview/shared";
import { MatchSchema } from "@agenticview/shared";
import { readJsonFile, writeJsonFile } from "../store/jsonStore.js";
// ─── Persistence schema ─────────────────────────────────────────────────────
const StatsRecordSchema = z.record(z.string(), z.object({
    wins: z.number().int().min(0),
    losses: z.number().int().min(0),
    draws: z.number().int().min(0),
}));
const PersistedGamesSchema = z.object({
    stats: StatsRecordSchema.default({}),
    recent: z.array(MatchSchema).default([]),
});
// ─── RPS logic ───────────────────────────────────────────────────────────────
/** Returns "a" if first player wins, "b" if second player wins, null for draw. */
export function rpsResult(a, b) {
    if (a === b)
        return null;
    if ((a === "rock" && b === "scissors") ||
        (a === "scissors" && b === "paper") ||
        (a === "paper" && b === "rock"))
        return "a";
    return "b";
}
const MOVES = ["rock", "paper", "scissors"];
const MAX_RECENT = 50;
const MIN_DELAY_MS = 45_000;
const MAX_DELAY_MS = 120_000;
// ─── GameService ─────────────────────────────────────────────────────────────
export class GameService {
    deps;
    gamesFile;
    persisted = { stats: {}, recent: [] };
    loaded = false;
    /** agentId -> lounging-timer handle. */
    idleTimers = new Map();
    /** In-progress user best-of-3 matches, keyed by matchId. */
    userMatches = new Map();
    autoMatchTimer = null;
    stopped = false;
    constructor(deps) {
        this.deps = deps;
        this.gamesFile = join(deps.root, "games.json");
    }
    getNow() {
        return this.deps.now ? this.deps.now() : Date.now();
    }
    getRandomInt(max) {
        if (max <= 1)
            return 0;
        const raw = this.deps.randomInt ? this.deps.randomInt(max) : cryptoRandomInt(max);
        return raw % max;
    }
    getRandomDelay() {
        if (this.deps.randomDelay)
            return this.deps.randomDelay();
        return this.getRandomInt(MAX_DELAY_MS - MIN_DELAY_MS + 1) + MIN_DELAY_MS;
    }
    randomMove() {
        return MOVES[this.getRandomInt(3)];
    }
    // ─── Persistence ─────────────────────────────────────────────────────────
    async load() {
        if (this.loaded)
            return;
        this.persisted = await readJsonFile(this.gamesFile, PersistedGamesSchema, { stats: {}, recent: [] });
        this.loaded = true;
    }
    async save() {
        await writeJsonFile(this.gamesFile, this.persisted);
    }
    async getGames() {
        await this.load();
        const agents = await this.deps.registry.list();
        const agentNameMap = new Map(agents.map((a) => [a.id, a.name]));
        const statsEntries = Object.entries(this.persisted.stats);
        const leaderboard = statsEntries.map(([playerId, s]) => ({
            playerId,
            name: playerId === "you" ? "You" : (agentNameMap.get(playerId) ?? playerId),
            ...s,
        }));
        leaderboard.sort((a, b) => b.wins - a.wins || a.losses - b.losses);
        return { leaderboard, recent: [...this.persisted.recent] };
    }
    async recordMatch(match) {
        await this.load();
        const [a, b] = match.players;
        const inc = (id, field) => {
            const cur = this.persisted.stats[id] ?? { wins: 0, losses: 0, draws: 0 };
            this.persisted.stats[id] = { ...cur, [field]: cur[field] + 1 };
        };
        if (match.winner === null) {
            inc(a, "draws");
            inc(b, "draws");
        }
        else if (match.winner === a) {
            inc(a, "wins");
            inc(b, "losses");
        }
        else {
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
    async onAgentBusy(agentId) {
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
    onAgentIdle(agentId, idleLoungeMinutes) {
        if (idleLoungeMinutes <= 0)
            return;
        // Clear any existing timer first.
        const existing = this.idleTimers.get(agentId);
        if (existing)
            clearTimeout(existing);
        const ms = idleLoungeMinutes * 60 * 1000;
        const timer = setTimeout(() => {
            this.idleTimers.delete(agentId);
            this.setLouging_internal(agentId);
        }, ms);
        this.idleTimers.set(agentId, timer);
    }
    /** @internal exposed for tests. */
    async triggerLounging(agentId) {
        const agent = await this.deps.registry.get(agentId);
        if (!agent || agent.lounging)
            return;
        const updated = await this.deps.registry.update(agentId, { lounging: true });
        this.deps.bus.emit({ type: "agent.updated", agent: updated });
    }
    setLouging_internal(agentId) {
        void this.triggerLounging(agentId);
    }
    /** Returns ids of currently lounging workers. */
    async loungingAgents() {
        const agents = await this.deps.registry.list();
        return agents.filter((a) => a.role === "worker" && a.lounging).map((a) => ({ id: a.id, name: a.name }));
    }
    // ─── Agent auto-matches ───────────────────────────────────────────────────
    /** Start the recurring auto-match timer. */
    start() {
        this.stopped = false;
        this.scheduleAutoMatch();
    }
    /** Stop all timers (call on world teardown). */
    stop() {
        this.stopped = true;
        if (this.autoMatchTimer) {
            clearTimeout(this.autoMatchTimer);
            this.autoMatchTimer = null;
        }
        for (const t of this.idleTimers.values())
            clearTimeout(t);
        this.idleTimers.clear();
    }
    scheduleAutoMatch() {
        if (this.stopped)
            return;
        const delay = this.getRandomDelay();
        this.autoMatchTimer = setTimeout(() => {
            this.autoMatchTimer = null;
            void this.runAutoMatch().finally(() => this.scheduleAutoMatch());
        }, delay);
    }
    /** Run one auto-match between two random lounging agents. */
    async runAutoMatch() {
        if (this.stopped)
            return null;
        const lounging = await this.loungingAgents();
        if (lounging.length < 2)
            return null;
        // Pick two distinct random indices.
        const idxA = this.getRandomInt(lounging.length);
        let idxB = this.getRandomInt(lounging.length - 1);
        if (idxB >= idxA)
            idxB++;
        const a = lounging[idxA];
        const b = lounging[idxB];
        const moveA = this.randomMove();
        const moveB = this.randomMove();
        const res = rpsResult(moveA, moveB);
        const winner = res === "a" ? a.id : res === "b" ? b.id : null;
        const match = {
            id: newId("gm"),
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
    async playUser(opponentId, matchId, move) {
        let state;
        if (matchId && this.userMatches.has(matchId)) {
            state = this.userMatches.get(matchId);
            if (state.opponentId !== opponentId)
                throw new Error("opponentId mismatch for existing matchId");
        }
        else {
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
        const roundWinner = res === "a" ? "you" : res === "b" ? "agent" : null;
        if (roundWinner === "you")
            state.score.you++;
        else if (roundWinner === "agent")
            state.score.agent++;
        state.rounds.push({ userMove: move, agentMove, winner: roundWinner });
        // Best-of-3: done when one side has 2 wins, or all 3 rounds played.
        const done = state.score.you >= 2 || state.score.agent >= 2 || state.round >= 3;
        const result = {
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
            const matchWinner = state.score.you > state.score.agent
                ? "you"
                : state.score.agent > state.score.you
                    ? opponentId
                    : null;
            const lastRound = state.rounds[state.rounds.length - 1];
            const match = {
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
//# sourceMappingURL=gameService.js.map