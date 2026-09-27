import { z } from "zod";
import { assignableSpaces, designatedSeats, isDeskKind, findSpace, freeDeskFor, placementKey, planOffice, planOfficeWithSpaces, seatLabel, applyLayoutMoves, setRoomKind, defaultRoomName, SpaceKindSchema, type OfficeLayout, type Agent, type Placement, type Space } from "@agenticview/shared";
import type { BridgeTool } from "../runtimes/types.js";
import type { AgentRegistry } from "../agents/registry.js";

export interface OfficeToolContext {
  registry: Pick<AgentRegistry, "list" | "update"> & Partial<Pick<AgentRegistry, "pinPlacements" | "withDeskLock">>;
  emitAgent: (agent: Agent) => void;
  spaceNames?: () => Record<string, string>;
  renameSpace?: (id: string, name: string) => Promise<void>;
  /** Spaces built from the world's persisted layout; tests without a world use planOffice. */
  spaces?: () => Space[];
  layout?: () => OfficeLayout;
  updateLayout?: (layout: OfficeLayout) => Promise<OfficeLayout>;
  editLayout?: (edit: (current: OfficeLayout) => OfficeLayout) => Promise<OfficeLayout>;
}

function findWorker(agents: Agent[], ref: string): Agent | undefined {
  const k = ref.trim().toLowerCase();
  return agents.find((a) => a.role === "worker" && (a.id === ref || a.name.toLowerCase() === k));
}

/** Seat map of the office: every space with its free desks and who sits where. */
export async function describeSpaces(ctx: OfficeToolContext): Promise<string> {
  const agents = await ctx.registry.list();
  const plan = officePlan(ctx, agents);
  const desks = designatedSeats(agents);
  const who = new Map<string, Agent>();
  for (const a of agents) {
    const p = plan.placements[a.id];
    if (p) who.set(`${p.space}#${p.seat}`, a);
  }
  const rows = plan.spaces.map((s) => ({
    id: s.id,
    name: ctx.spaceNames?.()[s.id] ?? s.name,
    defaultName: ctx.layout?.().rooms.find((r) => r.id === s.id)?.name ?? defaultRoomName(s.kind, s.id),
    kind: s.kind,
    seats: Array.from({ length: s.seats }, (_, seat) => {
      const a = who.get(`${s.id}#${seat}`);
      const owner = desks.get(`${s.id}#${seat}`);
      const desk = owner ? { designatedFor: owner.name } : {};
      return a ? { seat, agentId: a.id, name: a.name, ...desk } : { seat, free: true, ...desk };
    }),
  }));
  return JSON.stringify(rows, null, 2);
}

/** Desks a displaced worker can go to: every pod desk, in layout order. */
function podSeats(spaces: Space[]): Placement[] {
  return spaces.filter((s) => s.kind === "pod").flatMap((s) => Array.from({ length: s.seats }, (_, seat) => ({ space: s.id, seat })));
}

function officePlan(ctx: OfficeToolContext, agents: Agent[]) {
  return ctx.spaces ? planOfficeWithSpaces(ctx.spaces(), agents) : planOffice(agents, ctx.layout?.(), ctx.spaceNames?.());
}

/**
 * Sit `agentId` at `desk` (placement only, plus `patch`). Anyone else sitting there gets up first: to its
 * own workSeat, else a free desk that is nobody's designated one, else any free desk, else the lounge.
 * Returns what the displaced workers did, for the tool message.
 */
async function sitAt(ctx: OfficeToolContext, agentId: string, desk: Placement, patch: Partial<Agent> = {}): Promise<string[]> {
  const agents = await ctx.registry.list();
  const plan = officePlan(ctx, agents);
  const key = placementKey(desk);
  const notes: string[] = [];
  const placements = { ...plan.placements, [agentId]: desk };
  for (const s of agents.filter((a) => a.id !== agentId && a.role === "worker" && plan.placements[a.id] && placementKey(plan.placements[a.id]!) === key)) {
    const spot = freeDeskFor(s.id, podSeats(plan.spaces), placements, agents);
    if (spot) placements[s.id] = spot;
    else delete placements[s.id];
    ctx.emitAgent(await ctx.registry.update(s.id, spot ? { placement: spot } : { placement: undefined, lounging: true, visiting: undefined }));
    notes.push(`${s.name} got up from there and ${spot ? `moved to ${spot.space} seat ${spot.seat}` : "went to the lounge"}`);
  }
  ctx.emitAgent(await ctx.registry.update(agentId, { ...patch, placement: { space: desk.space, seat: desk.seat } }));
  return notes;
}

/**
 * Give one worker a new designated desk (workSeat) in a space and walk it there. This is an owner action
 * (the Manager's move_worker / arrange_workers, or the user dragging the agent) and the only way a
 * workSeat changes after create_agent.
 *
 * The whole check-and-write runs under the registry's desk lock, so a user drag and a Manager move onto
 * the same desk at the same moment are applied one after the other (the second sees the first's desk and
 * swaps or is refused) and two agents never end up with the same designated desk.
 *
 * - A space without work desks (meeting room, lounge): only a temporary seat (seatWorker); the
 *   designated desk does not change.
 * - No seat: the first desk of the space that is nobody's workSeat (a free one first).
 * - A seat that is another worker's workSeat: the two SWAP designated desks (the other worker gets the
 *   mover's old workSeat). The other worker's desk is released before the mover takes it, so two agents
 *   never share a workSeat at any point. A mover without a workSeat cannot swap: refused.
 * - Anyone merely sitting at the destination (idle) gets up and moves elsewhere.
 */
export async function moveWorker(ctx: OfficeToolContext, agentRef: string, spaceRef: string, seat?: number): Promise<string> {
  const run = () => moveWorkerLocked(ctx, agentRef, spaceRef, seat);
  return ctx.registry.withDeskLock ? ctx.registry.withDeskLock(run) : run();
}

async function moveWorkerLocked(ctx: OfficeToolContext, agentRef: string, spaceRef: string, seat?: number): Promise<string> {
  const agents = await ctx.registry.list();
  const worker = findWorker(agents, agentRef);
  if (!worker) return `ERROR: unknown worker ${agentRef} (use list_agents)`;
  const space = resolveSpace(ctx, agents, spaceRef);
  if (typeof space === "string") return space;
  if (!isDeskKind(space.kind)) {
    const out = await seatWorker(ctx, worker.id, space.id, seat);
    if (out.startsWith("ERROR:")) return out;
    return `${out} (temporary seat: ${space.name} has no work desks, so ${worker.name}'s designated desk is unchanged)`;
  }
  const plan = officePlan(ctx, agents);
  const designated = designatedSeats(agents, worker.id);
  const deskKey = (n: number) => `${space.id}#${n}`;
  const sitter = (n: number) => agents.find((a) => a.id !== worker.id && a.role === "worker" && plan.placements[a.id] && placementKey(plan.placements[a.id]!) === deskKey(n));
  let target: number | undefined;
  if (seat === undefined) {
    const all = Array.from({ length: space.seats }, (_, n) => n);
    target = all.find((n) => !designated.has(deskKey(n)) && !sitter(n)) ?? all.find((n) => !designated.has(deskKey(n)));
    if (target === undefined) return `ERROR: every desk in ${space.name} is someone's designated desk; pass a seat number to swap desks with its owner`;
  } else {
    if (seat < 0 || seat >= space.seats) return `ERROR: ${space.name} has seats 0-${space.seats - 1}`;
    target = seat;
  }
  const dest: Placement = { space: space.id, seat: target };
  const label = seatLabel(plan.spaces, dest, ctx.spaceNames?.());
  const owner = designated.get(placementKey(dest));
  const oldDesk = worker.workSeat ? { ...worker.workSeat } : undefined;
  if (owner && !oldDesk) return `ERROR: ${label} is ${owner.name}'s designated desk and ${worker.name} has no desk to swap; move ${owner.name} first`;
  // Auto-seated workers would shift once this one moves; persist where they sit now.
  for (const pinned of (await ctx.registry.pinPlacements?.()) ?? []) ctx.emitAgent(pinned);
  const notes: string[] = [];
  if (owner && oldDesk) {
    // Swap designated desks without ever sharing one: release the owner's, hand it over, then give the
    // owner the mover's old one.
    const ownerSeated = plan.placements[owner.id] && placementKey(plan.placements[owner.id]!) === placementKey(dest);
    await ctx.registry.update(owner.id, { workSeat: undefined });
    await ctx.registry.update(worker.id, { workSeat: dest });
    if (ownerSeated) notes.push(...(await sitAt(ctx, owner.id, oldDesk, { workSeat: oldDesk })));
    else ctx.emitAgent(await ctx.registry.update(owner.id, { workSeat: oldDesk }));
    notes.unshift(`${owner.name} swapped to ${seatLabel(plan.spaces, oldDesk, ctx.spaceNames?.())} (its new designated desk)`);
  }
  notes.push(...(await sitAt(ctx, worker.id, dest, { workSeat: dest })));
  return [`Moved ${worker.name} to ${space.name} seat ${target} (its designated desk)`, ...notes].join("; ");
}

function resolveSpace(ctx: OfficeToolContext, agents: Agent[], spaceRef: string): Space | string {
  const spaces = ctx.spaces ? ctx.spaces().filter((s) => s.seats > 0) : assignableSpaces(agents, ctx.layout?.());
  const room = spaces.find(s => s.id === spaceRef) ?? spaces.find(s => ctx.spaceNames?.()[s.id]?.toLowerCase() === spaceRef.trim().toLowerCase()) ?? findSpace(spaces, spaceRef);
  if (!room) return `ERROR: unknown space ${spaceRef}; pick one of: ${spaces.map((s) => s.id).join(", ")}`;
  return { ...room, name: ctx.spaceNames?.()[room.id] ?? room.name };
}

/**
 * Seat a worker somewhere for a while WITHOUT changing its designated desk (brainstorm meetings and the
 * walk back). If the seat is taken the two workers swap seats (placements only).
 */
export async function seatWorker(ctx: OfficeToolContext, agentRef: string, spaceRef: string, seat?: number): Promise<string> {
  const agents = await ctx.registry.list();
  const worker = findWorker(agents, agentRef);
  if (!worker) return `ERROR: unknown worker ${agentRef} (use list_agents)`;
  const space = resolveSpace(ctx, agents, spaceRef);
  if (typeof space === "string") return space;
  const plan = officePlan(ctx, agents);
  const occupant = (n: number) => agents.find((a) => a.id !== worker.id && plan.placements[a.id]?.space === space.id && plan.placements[a.id]?.seat === n);
  let target: number;
  if (seat === undefined) {
    const free = Array.from({ length: space.seats }, (_, n) => n).find((n) => !occupant(n));
    if (free === undefined) return `ERROR: ${space.name} is full; pass a seat number to swap with whoever sits there`;
    target = free;
  } else {
    if (seat < 0 || seat >= space.seats) return `ERROR: ${space.name} has seats 0-${space.seats - 1}`;
    target = seat;
  }
  const from = plan.placements[worker.id];
  const dest: Placement = { space: space.id, seat: target };
  // Auto-seated workers would shift once this one moves; persist where they sit now.
  for (const pinned of (await ctx.registry.pinPlacements?.()) ?? []) ctx.emitAgent(pinned);
  const other = occupant(target);
  const moved = await ctx.registry.update(worker.id, { placement: dest });
  ctx.emitAgent(moved);
  if (other) {
    const back = from ? { ...from } : undefined;
    const swapped = await ctx.registry.update(other.id, { placement: back });
    ctx.emitAgent(swapped);
    return `Moved ${worker.name} to ${space.name} seat ${target}; ${other.name} swapped to ${from ? `${from.space} seat ${from.seat}` : "the next free desk"}`;
  }
  return `Moved ${worker.name} to ${space.name} seat ${target}`;
}

export function officeTools(ctx: OfficeToolContext): BridgeTool[] {
  return [
    {
      name: "list_spaces",
      description: "Show the office floor plan: every space (pods, meeting room, lounge) with its seats, who sits in each, and whose designated desk (workSeat) each seat is.",
      schema: {},
      handler: async () => describeSpaces(ctx),
    },
    {
      name: "rename_space",
      description: "Name a room after its role. Empty name restores the default; use the id or current name.",
      schema: { space: z.string().min(1), name: z.string().trim().max(40) },
      handler: async (args) => {
        const spaces = ctx.spaces?.() ?? planOffice(await ctx.registry.list(), ctx.layout?.()).spaces;
        const ref = String(args.space).trim();
        const space = spaces.find(s => s.id === ref) ?? spaces.find(s => ctx.spaceNames?.()[s.id]?.toLowerCase() === ref.toLowerCase()) ?? findSpace(spaces, ref);
        if (!space) return `ERROR: unknown space ${ref}`;
        if (!ctx.renameSpace) return "ERROR: room naming unavailable";
        const name = z.string().trim().max(40).parse(args.name);
        if (name && spaces.some(s => s.id !== space.id && [s.id, s.name, ctx.spaceNames?.()[s.id]].some(n => n?.toLowerCase() === name.toLowerCase()))) return "ERROR: room name already in use";
        await ctx.renameSpace(space.id, name);
        const room = ctx.layout?.().rooms.find((r) => r.id === space.id);
        const fallback = room?.name ?? defaultRoomName(space.kind, space.id);
        return JSON.stringify({ id: space.id, name: name || fallback, defaultName: fallback });
      },
    },
    {
      name: "set_layout",
      description: "Move several rooms to hexes in order; moving onto an occupied hex swaps the rooms.",
      schema: { moves: z.array(z.object({ space: z.string().min(1), toHex: z.object({ q: z.number().int(), r: z.number().int() }) })).min(1).max(40) },
      handler: async (args) => {
        if (!ctx.layout || !ctx.updateLayout) return "ERROR: layout editing unavailable";
        try {
          const edit = (current: OfficeLayout) => applyLayoutMoves(current, args.moves as { space: string; toHex: { q: number; r: number } }[]);
          const next = ctx.editLayout ? await ctx.editLayout(edit) : await ctx.updateLayout(edit(ctx.layout()));
          return JSON.stringify(next);
        } catch (e) { return `ERROR: ${(e as Error).message}`; }
      },
    },
    {
      name: "move_room",
      description: "Move one room to a hex; swaps with the room there if occupied.",
      schema: { space: z.string().min(1), q: z.number().int(), r: z.number().int() },
      handler: async (args) => {
        if (!ctx.layout || !ctx.updateLayout) return "ERROR: layout editing unavailable";
        try {
          const edit = (current: OfficeLayout) => applyLayoutMoves(current, [{ space: String(args.space), toHex: { q: Number(args.q), r: Number(args.r) } }]);
          const next = ctx.editLayout ? await ctx.editLayout(edit) : await ctx.updateLayout(edit(ctx.layout()));
          return JSON.stringify(next);
        } catch (e) { return `ERROR: ${(e as Error).message}`; }
      },
    },
    {
      name: "set_room_kind",
      description: "Add or replace a room at a hex, or remove an empty room with null. The manager's office and My Office are required.",
      schema: { q: z.number().int(), r: z.number().int(), kind: SpaceKindSchema.nullable() },
      handler: async (args) => {
        if (!ctx.layout || !ctx.updateLayout) return "ERROR: layout editing unavailable";
        try {
          const edit = (current: OfficeLayout) => setRoomKind(current, { q: Number(args.q), r: Number(args.r) }, args.kind as OfficeLayout["rooms"][number]["kind"] | null);
          const next = ctx.editLayout ? await ctx.editLayout(edit) : await ctx.updateLayout(edit(ctx.layout()));
          return JSON.stringify(next);
        } catch (e) { return `ERROR: ${(e as Error).message}`; }
      },
    },
    {
      name: "move_worker",
      description: "Give a worker a new designated desk (its workSeat: where it always sits while working) and walk it there, e.g. to group a team in one pod. Designated desks are only in work rooms (pods, Production Room, Research Room); moving a worker to the meeting room or lounge is just a temporary seat and keeps its designated desk. Omit seat for the first desk nobody owns. If the seat is another worker's designated desk the two SWAP designated desks (never shared, not even briefly); a worker without a desk cannot swap and is refused. An idle worker merely sitting there gets up and moves elsewhere.",
      schema: {
        agent: z.string().min(1).describe("Worker id or name"),
        space: z.string().min(1).describe("Space id or name from list_spaces, e.g. pod-b; the meeting room or lounge only seats the worker temporarily"),
        seat: z.number().int().min(0).optional().describe("Seat number; omit for the first free seat"),
      },
      handler: async (args) => moveWorker(ctx, String(args.agent), String(args.space), args.seat as number | undefined),
    },
    {
      name: "arrange_workers",
      description: "Rearrange several workers' designated desks at once. Moves are applied in order; each behaves like move_worker (swaps designated desks when the seat is taken; a move to the meeting room or lounge is a temporary seat that keeps the designated desk).",
      schema: {
        moves: z
          .array(z.object({ agent: z.string().min(1), space: z.string().min(1), seat: z.number().int().min(0).optional() }))
          .min(1)
          .max(40),
      },
      handler: async (args) => {
        const out: string[] = [];
        for (const m of args.moves as { agent: string; space: string; seat?: number }[]) out.push(await moveWorker(ctx, m.agent, m.space, m.seat));
        return out.join("\n");
      },
    },
  ];
}
