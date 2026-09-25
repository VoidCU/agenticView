import { Hono } from "hono";
import { type ToolRegistry } from "../bridge/toolRegistry.js";
import { SessionRuntime } from "../runtimes/session.js";
/**
 * Endpoints for Claude Code session workers (/agenticview-work). Mounted under /api, so they
 * require the launch token like the rest of the API. Workers identify themselves with the
 * `x-agenticview-worker` header; polls double as heartbeats.
 */
export declare function workerRoutes(session: SessionRuntime, toolRegistry: ToolRegistry): Hono;
