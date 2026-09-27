import { randomInt } from "node:crypto";
import { IdleBehaviourSchema, freeDeskFor, type Agent, type IdleBehaviour, type Placement } from "@agenticview/shared";
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
 * by a roll. Idle wandering only ever changes `placement`, never the designated desk (`workSeat`).
 *
 * Getting work (anything but a brainstorm meeting) walks the worker to its workSeat. An idle worker
 * sitting there (a squatter) gets up first: to its own workSeat, else a free desk nobody owns, else any
 * free desk, else the lounge.
 */

export type IdleOutcome = "stay" | "visit" | "lounge";

export interface IdleBehaviourDeps {
  registry: AgentRegistry;
  bus: EventBus;
  /** Current idle settings: the threshold in minutes (0 = off) and the roll chances/timing. */
  settings: () => { idleMinutes: number; behaviour?: Partial<IdleBehaviour> };
  /** Uniform random number in [0, 1). Default: node:crypto. */
  rng?: () => number;
  /** Non-waiting lounge spots in the office (the lounge holds at most half of them). */
  loungeSpots: () => number | Promise<number>;
  /** Every desk seat of the office (pod seats) and each worker's resolved seat. */
  desks: () => Promise<{ seats: Placement[]; placements: Record<string, Placement> }>;
  /** Space id of the whiteboard (meeting room), if the office has one. */
  whiteboardSpace?: () => string | undefined | Promise<string | undefined>;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

const cryptoRng = (): number => randomInt(0, 2 ** 32) / 2 ** 32;

/** Pick an outcome from the configured chances (relative weights) with one uniform draw `r` in [0, 1). */
export function pickOutcome(b: Pick<IdleBehaviour, "stayChance" | "visitChance" | "loungeChance">, r: number): IdleOutcome {
  const total = b.stayChance + b.visitChance + b.loungeChance;
  if (total <= 0) return "stay";
  const x = r * total;
  if (x < b.stayChance) return "stay";
  if (x < b.stayChance + b.visitChance) return "visit";
  return "lounge";
}

const seatKey = (p: Placement) => `${p.space}#${p.seat}`;

export class IdleBehaviourService {
  private readonly busy = new Set<string>();
  private readonly timers = new Map<string, unknown>();
  private readonly visitTimers = new Map<string, unknown>();
  private stopped = false;
  private lock: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: IdleBehaviourDeps) {}

  private rng(): number {
    const r = (this.deps.rng ?? cryptoRng)();
    return Math.min(Math.max(r, 0), 0.999999999);
  }

  private behaviour(): IdleBehaviour {
    return IdleBehaviourSchema.parse(this.deps.settings().behaviour ?? {});
  }

  private setTimer(fn: () => void, ms: number): unknown {
    // Idle timers never keep the process alive.
    return (this.deps.setTimer ?? ((f, t) => setTimeout(f, t).unref()))(fn, ms);
  }

  private clearTimer(h: unknown): void {
    if (h === undefined) return;
    (this.deps.clearTimer ?? ((x) => clearTimeout(x as ReturnType<typeof setTimeout>)))(h);
  }

  /** Rolls touch shared state (lounge count, free seats): one at a time. */
  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.lock.then(fn, fn);
    this.lock = next.catch(() => undefined);
    return next;
  }

  /** Lounge capacity for idle rolls: half the lounge spots (at least 1 when there is a lounge). */
  async loungeCap(): Promise<number> {
    const spots = await this.deps.loungeSpots();
    return spots <= 0 ? 0 : Math.max(1, Math.floor(spots / 2));
  }

  /** Next roll delay in ms, uniformly within minRollSeconds..maxRollSeconds. */
  nextDelayMs(): number {
    const b = this.behaviour();
    const lo = Math.min(b.minRollSeconds, b.maxRollSeconds);
    const hi = Math.max(b.minRollSeconds, b.maxRollSeconds);
    return Math.round((lo + this.rng() * (hi - lo)) * 1000);
  }

  private schedule(agentId: string, ms: number): void {
    this.clearTimer(this.timers.get(agentId));
    if (this.stopped) return;
    this.timers.set(
      agentId,
      this.setTimer(() => {
        this.timers.delete(agentId);
        void this.roll(agentId)
          .catch((e) => console.error("[agenticview] idle roll failed", (e as Error).message))
          .finally(() => {
            if (!this.busy.has(agentId) && !this.stopped) this.schedule(agentId, this.nextDelayMs());
          });
      }, ms),
    );
  }

  /** Office start: every idle worker begins its idle cycle. */
  start(idleWorkerIds: string[]): void {
    for (const id of idleWorkerIds) this.onIdle(id);
  }

  stop(): void {
    this.stopped = true;
    for (const h of this.timers.values()) this.clearTimer(h);
    for (const h of this.visitTimers.values()) this.clearTimer(h);
    this.timers.clear();
    this.visitTimers.clear();
  }

  /**
   * A worker got work: stop its idle cycle. With `toDesk` (every task but a brainstorm meeting) it walks
   * to its designated desk (workSeat); otherwise, if it was lounging or visiting, it sits back down.
   */
  async onBusy(agentId: string, opts: { toDesk?: boolean } = {}): Promise<void> {
    this.busy.add(agentId);
    this.clearTimer(this.timers.get(agentId));
    this.timers.delete(agentId);
    this.clearTimer(this.visitTimers.get(agentId));
    this.visitTimers.delete(agentId);
    await this.serialize(async () => {
      const a = await this.deps.registry.get(agentId);
      if (!a || a.role !== "worker") return;
      if (opts.toDesk && a.workSeat) await this.takeWorkSeat(a);
      else if (a.lounging) await this.sitDown(a);
      else if (a.visiting) this.emit(await this.deps.registry.update(a.id, { visiting: undefined }));
    });
  }

  /** A busy worker starts (more) desk work: walk it to its workSeat. Idempotent. */
  toWorkSeat(agentId: string): Promise<void> {
    return this.serialize(async () => {
      const a = await this.deps.registry.get(agentId);
      if (a && a.role === "worker" && a.workSeat) await this.takeWorkSeat(a);
    });
  }

  /**
   * Sit `a` at its workSeat, displacing whoever else sits there (squatter rule). No-op when it is already
   * seated there and neither lounging nor visiting. Returns the updated agent.
   */
  private async takeWorkSeat(a: Agent): Promise<Agent> {
    const desk = a.workSeat!;
    const key = seatKey(desk);
    const { seats, placements } = await this.deps.desks();
    const agents = await this.deps.registry.list();
    const next: Record<string, Placement> = { ...placements, [a.id]: desk };
    for (const s of agents) {
      const p = placements[s.id];
      if (s.id === a.id || s.role !== "worker" || !p || seatKey(p) !== key) continue;
      const spot = freeDeskFor(s.id, seats, next, agents);
      if (spot) next[s.id] = spot;
      else delete next[s.id];
      this.emit(await this.deps.registry.update(s.id, spot ? { placement: spot } : { placement: undefined, lounging: true, visiting: undefined }));
    }
    if (!a.lounging && !a.visiting && a.placement && seatKey(a.placement) === key) return a;
    const moved = await this.deps.registry.update(a.id, { placement: { space: desk.space, seat: desk.seat }, lounging: undefined, visiting: undefined });
    this.emit(moved);
    return moved;
  }

  /** A worker finished its work: after the idle threshold it starts rolling. */
  onIdle(agentId: string): void {
    this.busy.delete(agentId);
    const minutes = this.deps.settings().idleMinutes;
    if (minutes <= 0) return;
    this.schedule(agentId, minutes * 60_000);
  }

  isBusy(agentId: string): boolean {
    return this.busy.has(agentId);
  }

  /** One roll for one worker (exposed for tests). Returns what happened, or undefined when skipped. */
  roll(agentId: string): Promise<IdleOutcome | undefined> {
    return this.serialize(async () => {
      if (this.busy.has(agentId)) return undefined;
      const a = await this.deps.registry.get(agentId);
      if (!a || a.role !== "worker") return undefined;
      const b = this.behaviour();
      let outcome = pickOutcome(b, this.rng());
      if (outcome === "lounge" && !a.lounging) {
        const lounging = (await this.deps.registry.list()).filter((x) => x.role === "worker" && x.lounging).length;
        if (lounging >= (await this.loungeCap())) outcome = "stay";
      }
      if (outcome === "lounge") {
        if (!a.lounging) this.emit(await this.deps.registry.update(a.id, { lounging: true, visiting: undefined }));
      } else if (outcome === "stay") {
        if (a.lounging) await this.sitDown(a);
        else if (a.visiting) this.emit(await this.deps.registry.update(a.id, { visiting: undefined }));
      } else {
        await this.visit(a, b);
      }
      return outcome;
    });
  }

  private async visit(a: Agent, b: IdleBehaviour): Promise<void> {
    // Leaving the lounge for a visit: sit back down first (a new desk may be chosen), then walk over.
    const base = a.lounging ? await this.sitDown(a) : a;
    const all = await this.deps.registry.list();
    const colleagues = all.filter((x) => x.role === "worker" && x.id !== a.id && !x.lounging);
    const board = await this.deps.whiteboardSpace?.();
    const targets: Array<{ targetAgentId?: string; spaceId?: string }> = [...colleagues.map((c) => ({ targetAgentId: c.id })), ...(board ? [{ spaceId: board }] : [])];
    if (targets.length === 0) return;
    const target = targets[Math.floor(this.rng() * targets.length)]!;
    const now = this.deps.now?.() ?? Date.now();
    const until = new Date(now + b.visitSeconds * 1000).toISOString();
    this.emit(await this.deps.registry.update(base.id, { visiting: { ...target, until } }));
    this.clearTimer(this.visitTimers.get(a.id));
    this.visitTimers.set(
      a.id,
      this.setTimer(() => {
        this.visitTimers.delete(a.id);
        void this.serialize(async () => {
          const cur = await this.deps.registry.get(a.id);
          if (cur?.visiting?.until === until) this.emit(await this.deps.registry.update(a.id, { visiting: undefined }));
        }).catch(() => undefined);
      }, b.visitSeconds * 1000),
    );
  }

  /**
   * Leave the lounge and sit at a desk: ANY free desk seat or the worker's own, chosen at random. Free
   * means no other worker's resolved seat, so two workers never share one. Returns the updated agent.
   */
  async sitDown(a: Agent): Promise<Agent> {
    const { seats, placements } = await this.deps.desks();
    const own = placements[a.id] ?? a.placement;
    const taken = new Set(Object.entries(placements).filter(([id]) => id !== a.id).map(([, p]) => seatKey(p)));
    const free = seats.filter((s) => !taken.has(seatKey(s)) && (!own || seatKey(s) !== seatKey(own)));
    const choices: Placement[] = [...(own ? [own] : []), ...free];
    const pick = choices.length ? choices[Math.floor(this.rng() * choices.length)]! : undefined;
    const patch: Partial<Agent> = { lounging: undefined, visiting: undefined };
    if (pick && (!a.placement || seatKey(pick) !== seatKey(a.placement))) patch.placement = { space: pick.space, seat: pick.seat };
    const next = await this.deps.registry.update(a.id, patch);
    this.emit(next);
    return next;
  }

  private emit(agent: Agent): void {
    this.deps.bus.emit({ type: "agent.updated", agent });
  }
}
