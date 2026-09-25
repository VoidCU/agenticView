import { type Agent } from "@agenticview/shared";
import type { BridgeTool } from "../runtimes/types.js";
import type { AgentRegistry } from "../agents/registry.js";
export interface OfficeToolContext {
    registry: Pick<AgentRegistry, "list" | "update"> & Partial<Pick<AgentRegistry, "pinPlacements">>;
    emitAgent: (agent: Agent) => void;
}
/** Seat map of the office: every space with its free desks and who sits where. */
export declare function describeSpaces(ctx: OfficeToolContext): Promise<string>;
/**
 * Move one worker to a space (and seat). If the seat is taken the two workers swap desks.
 * Persists both placements and broadcasts them so the office animates the walk.
 */
export declare function moveWorker(ctx: OfficeToolContext, agentRef: string, spaceRef: string, seat?: number): Promise<string>;
export declare function officeTools(ctx: OfficeToolContext): BridgeTool[];
