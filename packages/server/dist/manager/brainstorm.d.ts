import type { BridgeTool } from "../runtimes/types.js";
import { type ManagerToolContext } from "./tools.js";
/** Same-topic calls in a manager turn reuse the run, including after a bounded wait. */
export declare function brainstormTool(ctx: ManagerToolContext): BridgeTool;
