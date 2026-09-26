import type { Move, Match, GamesData, GameRoundResult } from "@agenticview/shared";
import type { EventBus } from "../events/bus.js";
import type { AgentRegistry } from "../agents/registry.js";
/** Returns "a" if first player wins, "b" if second player wins, null for draw. */
export declare function rpsResult(a: Move, b: Move): "a" | "b" | null;
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
}
export declare class GameService {
    private readonly deps;
    private readonly gamesFile;
    private persisted;
    private loaded;
    /** agentId -> lounging-timer handle. */
    private readonly idleTimers;
    /** In-progress user best-of-3 matches, keyed by matchId. */
    private readonly userMatches;
    private autoMatchTimer;
    private stopped;
    constructor(deps: GameServiceDeps);
    private getNow;
    private getRandomInt;
    private getRandomDelay;
    private randomMove;
    private load;
    private save;
    getGames(): Promise<GamesData>;
    private recordMatch;
    /**
     * Call when an agent starts a task: cancels idle timer and clears `lounging`.
     */
    onAgentBusy(agentId: string): Promise<void>;
    /**
     * Call when an agent finishes a task: starts the idleLoungeMinutes timer.
     */
    onAgentIdle(agentId: string, idleLoungeMinutes: number): void;
    /** @internal exposed for tests. */
    triggerLounging(agentId: string): Promise<void>;
    private setLouging_internal;
    /** Returns ids of currently lounging workers. */
    private loungingAgents;
    /** Start the recurring auto-match timer. */
    start(): void;
    /** Stop all timers (call on world teardown). */
    stop(): void;
    private scheduleAutoMatch;
    /** Run one auto-match between two random lounging agents. */
    runAutoMatch(): Promise<Match | null>;
    /**
     * Handle a `game.play` message. Creates or continues a best-of-3 match.
     */
    playUser(opponentId: string, matchId: string | undefined, move: Move): Promise<GameRoundResult>;
}
