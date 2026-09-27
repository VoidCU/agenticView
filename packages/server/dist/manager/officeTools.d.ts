import { type OfficeLayout, type Agent, type Space } from "@agenticview/shared";
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
/** Seat map of the office: every space with its free desks and who sits where. */
export declare function describeSpaces(ctx: OfficeToolContext): Promise<string>;
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
export declare function moveWorker(ctx: OfficeToolContext, agentRef: string, spaceRef: string, seat?: number): Promise<string>;
/**
 * Seat a worker somewhere for a while WITHOUT changing its designated desk (brainstorm meetings and the
 * walk back). If the seat is taken the two workers swap seats (placements only).
 */
export declare function seatWorker(ctx: OfficeToolContext, agentRef: string, spaceRef: string, seat?: number): Promise<string>;
export declare function officeTools(ctx: OfficeToolContext): BridgeTool[];
