import { z } from "zod";
import { assignableSpaces, findSpace, planOffice, planOfficeWithSpaces, type Agent, type Placement, type Space } from "@agenticview/shared";
import type { BridgeTool } from "../runtimes/types.js";
import type { AgentRegistry } from "../agents/registry.js";

export interface OfficeToolContext {
  registry: Pick<AgentRegistry, "list" | "update"> & Partial<Pick<AgentRegistry, "pinPlacements">>;
  emitAgent: (agent: Agent) => void;
  spaceNames?: () => Record<string, string>;
  renameSpace?: (id: string, name: string) => Promise<void>;
  /**
   * When the world has an explicit room layout (from addRoom), returns those spaces.
   * When absent the office tools fall back to planOffice (auto-grow from worker count).
   */
  spaces?: () => Space[];
}

function findWorker(agents: Agent[], ref: string): Agent | undefined {
  const k = ref.trim().toLowerCase();
  return agents.find((a) => a.role === "worker" && (a.id === ref || a.name.toLowerCase() === k));
}

/** Seat map of the office: every space with its free desks and who sits where. */
export async function describeSpaces(ctx: OfficeToolContext): Promise<string> {
  const agents = await ctx.registry.list();
  const plan = ctx.spaces ? planOfficeWithSpaces(ctx.spaces(), agents) : planOffice(agents);
  const who = new Map<string, Agent>();
  for (const a of agents) {
    const p = plan.placements[a.id];
    if (p) who.set(`${p.space}#${p.seat}`, a);
  }
  const rows = plan.spaces.map((s) => ({
    id: s.id,
    name: ctx.spaceNames?.()[s.id] ?? s.name,
    defaultName: s.name,
    kind: s.kind,
    seats: Array.from({ length: s.seats }, (_, seat) => {
      const a = who.get(`${s.id}#${seat}`);
      return a ? { seat, agentId: a.id, name: a.name } : { seat, free: true };
    }),
  }));
  return JSON.stringify(rows, null, 2);
}

/**
 * Move one worker to a space (and seat). If the seat is taken the two workers swap desks.
 * Persists both placements and broadcasts them so the office animates the walk.
 */
export async function moveWorker(ctx: OfficeToolContext, agentRef: string, spaceRef: string, seat?: number): Promise<string> {
  const agents = await ctx.registry.list();
  const worker = findWorker(agents, agentRef);
  if (!worker) return `ERROR: unknown worker ${agentRef} (use list_agents)`;
  const spaces = ctx.spaces ? ctx.spaces().filter((s) => s.seats > 0) : assignableSpaces(agents);
  const room = spaces.find(s => s.id === spaceRef) ?? spaces.find(s => ctx.spaceNames?.()[s.id]?.toLowerCase() === spaceRef.trim().toLowerCase()) ?? findSpace(spaces, spaceRef);
  const space = room && { ...room, name: ctx.spaceNames?.()[room.id] ?? room.name };
  if (!space) return `ERROR: unknown space ${spaceRef}; pick one of: ${spaces.map((s) => s.id).join(", ")}`;
  const plan = ctx.spaces ? planOfficeWithSpaces(ctx.spaces(), agents) : planOffice(agents);
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
      description: "Show the office floor plan: every space (pods, meeting room, lounge) with its seats and who sits in each.",
      schema: {},
      handler: async () => describeSpaces(ctx),
    },
    {
      name: "rename_space",
      description: "Name a room after its role. Empty name restores the default; use the id or current name.",
      schema: { space: z.string().min(1), name: z.string().trim().max(40) },
      handler: async (args) => {
        const spaces = planOffice(await ctx.registry.list()).spaces;
        const ref = String(args.space).trim();
        const space = spaces.find(s => s.id === ref) ?? spaces.find(s => ctx.spaceNames?.()[s.id]?.toLowerCase() === ref.toLowerCase()) ?? findSpace(spaces, ref);
        if (!space) return `ERROR: unknown space ${ref}`;
        if (!ctx.renameSpace) return "ERROR: room naming unavailable";
        const name = z.string().trim().max(40).parse(args.name);
        if (name && spaces.some(s => s.id !== space.id && [s.id, s.name, ctx.spaceNames?.()[s.id]].some(n => n?.toLowerCase() === name.toLowerCase()))) return "ERROR: room name already in use";
        await ctx.renameSpace(space.id, name);
        return JSON.stringify({ id: space.id, name: name || space.name, defaultName: space.name });
      },
    },
    {
      name: "move_worker",
      description: "Move a worker to another space in the office (e.g. to group a team in one pod or pull people into the meeting room). If the seat is taken the two workers swap.",
      schema: {
        agent: z.string().min(1).describe("Worker id or name"),
        space: z.string().min(1).describe("Space id or name from list_spaces, e.g. pod-b or 'Meeting Room'"),
        seat: z.number().int().min(0).optional().describe("Seat number; omit for the first free seat"),
      },
      handler: async (args) => moveWorker(ctx, String(args.agent), String(args.space), args.seat as number | undefined),
    },
    {
      name: "arrange_workers",
      description: "Rearrange several workers at once. Moves are applied in order; each behaves like move_worker.",
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
