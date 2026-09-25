import { Hono } from "hono";
import { type ToolRegistry } from "../bridge/toolRegistry.js";
import { SessionRuntime } from "../runtimes/session.js";
/**
 * Long bridge calls from a session (await_tasks) return early after this long with the tasks still
 * running, so no HTTP or MCP tool-call timeout between the session and the office can cut them off;
 * the session calls again to keep waiting.
 */
export declare const BRIDGE_AWAIT_CHUNK_SECONDS = 240;
/**
 * Endpoints for Claude Code session workers (/agenticview-work). Mounted under /api, so they
 * require the launch token like the rest of the API. Workers identify themselves with the
 * `x-agenticview-worker` header; polls double as heartbeats.
 */
export declare function workerRoutes(session: SessionRuntime, toolRegistry: ToolRegistry): Hono;
