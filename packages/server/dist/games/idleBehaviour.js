import { randomInt } from "node:crypto";
import { IdleBehaviourSchema } from "@agenticview/shared";
const cryptoRng = () => randomInt(0, 2 ** 32) / 2 ** 32;
/** Pick an outcome from the configured chances (relative weights) with one uniform draw `r` in [0, 1). */
export function pickOutcome(b, r) {
    const total = b.stayChance + b.visitChance + b.loungeChance;
    if (total <= 0)
        return "stay";
    const x = r * total;
    if (x < b.stayChance)
        return "stay";
    if (x < b.stayChance + b.visitChance)
        return "visit";
    return "lounge";
}
const seatKey = (p) => `${p.space}#${p.seat}`;
export class IdleBehaviourService {
    deps;
    busy = new Set();
    timers = new Map();
    visitTimers = new Map();
    stopped = false;
    lock = Promise.resolve();
    constructor(deps) {
        this.deps = deps;
    }
    rng() {
        const r = (this.deps.rng ?? cryptoRng)();
        return Math.min(Math.max(r, 0), 0.999999999);
    }
    behaviour() {
        return IdleBehaviourSchema.parse(this.deps.settings().behaviour ?? {});
    }
    setTimer(fn, ms) {
        // Idle timers never keep the process alive.
        return (this.deps.setTimer ?? ((f, t) => setTimeout(f, t).unref()))(fn, ms);
    }
    clearTimer(h) {
        if (h === undefined)
            return;
        (this.deps.clearTimer ?? ((x) => clearTimeout(x)))(h);
    }
    /** Rolls touch shared state (lounge count, free seats): one at a time. */
    serialize(fn) {
        const next = this.lock.then(fn, fn);
        this.lock = next.catch(() => undefined);
        return next;
    }
    /** Lounge capacity for idle rolls: half the lounge spots (at least 1 when there is a lounge). */
    async loungeCap() {
        const spots = await this.deps.loungeSpots();
        return spots <= 0 ? 0 : Math.max(1, Math.floor(spots / 2));
    }
    /** Next roll delay in ms, uniformly within minRollSeconds..maxRollSeconds. */
    nextDelayMs() {
        const b = this.behaviour();
        const lo = Math.min(b.minRollSeconds, b.maxRollSeconds);
        const hi = Math.max(b.minRollSeconds, b.maxRollSeconds);
        return Math.round((lo + this.rng() * (hi - lo)) * 1000);
    }
    schedule(agentId, ms) {
        this.clearTimer(this.timers.get(agentId));
        if (this.stopped)
            return;
        this.timers.set(agentId, this.setTimer(() => {
            this.timers.delete(agentId);
            void this.roll(agentId)
                .catch((e) => console.error("[agenticview] idle roll failed", e.message))
                .finally(() => {
                if (!this.busy.has(agentId) && !this.stopped)
                    this.schedule(agentId, this.nextDelayMs());
            });
        }, ms));
    }
    /** Office start: every idle worker begins its idle cycle. */
    start(idleWorkerIds) {
        for (const id of idleWorkerIds)
            this.onIdle(id);
    }
    stop() {
        this.stopped = true;
        for (const h of this.timers.values())
            this.clearTimer(h);
        for (const h of this.visitTimers.values())
            this.clearTimer(h);
        this.timers.clear();
        this.visitTimers.clear();
    }
    /** A worker got work: stop its idle cycle; if it was lounging or visiting it sits back down. */
    async onBusy(agentId) {
        this.busy.add(agentId);
        this.clearTimer(this.timers.get(agentId));
        this.timers.delete(agentId);
        this.clearTimer(this.visitTimers.get(agentId));
        this.visitTimers.delete(agentId);
        await this.serialize(async () => {
            const a = await this.deps.registry.get(agentId);
            if (!a || a.role !== "worker")
                return;
            if (a.lounging)
                await this.sitDown(a);
            else if (a.visiting)
                this.emit(await this.deps.registry.update(a.id, { visiting: undefined }));
        });
    }
    /** A worker finished its work: after the idle threshold it starts rolling. */
    onIdle(agentId) {
        this.busy.delete(agentId);
        const minutes = this.deps.settings().idleMinutes;
        if (minutes <= 0)
            return;
        this.schedule(agentId, minutes * 60_000);
    }
    isBusy(agentId) {
        return this.busy.has(agentId);
    }
    /** One roll for one worker (exposed for tests). Returns what happened, or undefined when skipped. */
    roll(agentId) {
        return this.serialize(async () => {
            if (this.busy.has(agentId))
                return undefined;
            const a = await this.deps.registry.get(agentId);
            if (!a || a.role !== "worker")
                return undefined;
            const b = this.behaviour();
            let outcome = pickOutcome(b, this.rng());
            if (outcome === "lounge" && !a.lounging) {
                const lounging = (await this.deps.registry.list()).filter((x) => x.role === "worker" && x.lounging).length;
                if (lounging >= (await this.loungeCap()))
                    outcome = "stay";
            }
            if (outcome === "lounge") {
                if (!a.lounging)
                    this.emit(await this.deps.registry.update(a.id, { lounging: true, visiting: undefined }));
            }
            else if (outcome === "stay") {
                if (a.lounging)
                    await this.sitDown(a);
                else if (a.visiting)
                    this.emit(await this.deps.registry.update(a.id, { visiting: undefined }));
            }
            else {
                await this.visit(a, b);
            }
            return outcome;
        });
    }
    async visit(a, b) {
        // Leaving the lounge for a visit: sit back down first (a new desk may be chosen), then walk over.
        const base = a.lounging ? await this.sitDown(a) : a;
        const all = await this.deps.registry.list();
        const colleagues = all.filter((x) => x.role === "worker" && x.id !== a.id && !x.lounging);
        const board = await this.deps.whiteboardSpace?.();
        const targets = [...colleagues.map((c) => ({ targetAgentId: c.id })), ...(board ? [{ spaceId: board }] : [])];
        if (targets.length === 0)
            return;
        const target = targets[Math.floor(this.rng() * targets.length)];
        const now = this.deps.now?.() ?? Date.now();
        const until = new Date(now + b.visitSeconds * 1000).toISOString();
        this.emit(await this.deps.registry.update(base.id, { visiting: { ...target, until } }));
        this.clearTimer(this.visitTimers.get(a.id));
        this.visitTimers.set(a.id, this.setTimer(() => {
            this.visitTimers.delete(a.id);
            void this.serialize(async () => {
                const cur = await this.deps.registry.get(a.id);
                if (cur?.visiting?.until === until)
                    this.emit(await this.deps.registry.update(a.id, { visiting: undefined }));
            }).catch(() => undefined);
        }, b.visitSeconds * 1000));
    }
    /**
     * Leave the lounge and sit at a desk: ANY free desk seat or the worker's own, chosen at random. Free
     * means no other worker's resolved seat, so two workers never share one. Returns the updated agent.
     */
    async sitDown(a) {
        const { seats, placements } = await this.deps.desks();
        const own = placements[a.id] ?? a.placement;
        const taken = new Set(Object.entries(placements).filter(([id]) => id !== a.id).map(([, p]) => seatKey(p)));
        const free = seats.filter((s) => !taken.has(seatKey(s)) && (!own || seatKey(s) !== seatKey(own)));
        const choices = [...(own ? [own] : []), ...free];
        const pick = choices.length ? choices[Math.floor(this.rng() * choices.length)] : undefined;
        const patch = { lounging: undefined, visiting: undefined };
        if (pick && (!a.placement || seatKey(pick) !== seatKey(a.placement)))
            patch.placement = { space: pick.space, seat: pick.seat };
        const next = await this.deps.registry.update(a.id, patch);
        this.emit(next);
        return next;
    }
    emit(agent) {
        this.deps.bus.emit({ type: "agent.updated", agent });
    }
}
//# sourceMappingURL=idleBehaviour.js.map