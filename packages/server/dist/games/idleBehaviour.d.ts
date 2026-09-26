import { type Agent, type IdleBehaviour, type Placement } from "@agenticview/shared";
import type { AgentRegistry } from "../agents/registry.js";
import type { EventBus } from "../events/bus.js";
/**
 * Idle behaviour of workers: purely server-local randomness (crypto RNG by default, a seeded RNG in
 * tests). It NEVER calls a runtime or a model.
 *
 * After `idleMinutes` without work a worker starts rolling every minRollSeconds..maxRollSeconds:
 * - stay (40%): sit at a desk. A worker coming back from the lounge picks ANY free desk seat (sometimes
 *   its old one, sometimes another), persisted as its new placement; no two workers ever share a seat,
 *   and with every desk taken it keeps its own.
 * - visit (25%): a short-lived `visiting` flag (a colleague's desk or the meeting-room whiteboard) that
 *   clears itself after visitSeconds. The worker keeps its own placement meanwhile.
 * - lounge (35%): sets `lounging`, unless the lounge already holds half its spots (then it stays).
 * Workers already in the lounge re-roll too, so they drift back to desks. Busy workers are never touched
 * by a roll; a worker that gets work while lounging sits back down through the same free-seat choice.
 */
export type IdleOutcome = "stay" | "visit" | "lounge";
export interface IdleBehaviourDeps {
    registry: AgentRegistry;
    bus: EventBus;
    /** Current idle settings: the threshold in minutes (0 = off) and the roll chances/timing. */
    settings: () => {
        idleMinutes: number;
        behaviour?: Partial<IdleBehaviour>;
    };
    /** Uniform random number in [0, 1). Default: node:crypto. */
    rng?: () => number;
    /** Non-waiting lounge spots in the office (the lounge holds at most half of them). */
    loungeSpots: () => number | Promise<number>;
    /** Every desk seat of the office (pod seats) and each worker's resolved seat. */
    desks: () => Promise<{
        seats: Placement[];
        placements: Record<string, Placement>;
    }>;
    /** Space id of the whiteboard (meeting room), if the office has one. */
    whiteboardSpace?: () => string | undefined | Promise<string | undefined>;
    now?: () => number;
    setTimer?: (fn: () => void, ms: number) => unknown;
    clearTimer?: (handle: unknown) => void;
}
/** Pick an outcome from the configured chances (relative weights) with one uniform draw `r` in [0, 1). */
export declare function pickOutcome(b: Pick<IdleBehaviour, "stayChance" | "visitChance" | "loungeChance">, r: number): IdleOutcome;
export declare class IdleBehaviourService {
    private readonly deps;
    private readonly busy;
    private readonly timers;
    private readonly visitTimers;
    private stopped;
    private lock;
    constructor(deps: IdleBehaviourDeps);
    private rng;
    private behaviour;
    private setTimer;
    private clearTimer;
    /** Rolls touch shared state (lounge count, free seats): one at a time. */
    private serialize;
    /** Lounge capacity for idle rolls: half the lounge spots (at least 1 when there is a lounge). */
    loungeCap(): Promise<number>;
    /** Next roll delay in ms, uniformly within minRollSeconds..maxRollSeconds. */
    nextDelayMs(): number;
    private schedule;
    /** Office start: every idle worker begins its idle cycle. */
    start(idleWorkerIds: string[]): void;
    stop(): void;
    /** A worker got work: stop its idle cycle; if it was lounging or visiting it sits back down. */
    onBusy(agentId: string): Promise<void>;
    /** A worker finished its work: after the idle threshold it starts rolling. */
    onIdle(agentId: string): void;
    isBusy(agentId: string): boolean;
    /** One roll for one worker (exposed for tests). Returns what happened, or undefined when skipped. */
    roll(agentId: string): Promise<IdleOutcome | undefined>;
    private visit;
    /**
     * Leave the lounge and sit at a desk: ANY free desk seat or the worker's own, chosen at random. Free
     * means no other worker's resolved seat, so two workers never share one. Returns the updated agent.
     */
    sitDown(a: Agent): Promise<Agent>;
    private emit;
}
