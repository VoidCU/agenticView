import { Hono } from "hono";
import { ToolRegistry } from "./toolRegistry.js";
/** HTTP face of the ToolRegistry, used by the stdio MCP bridge that Codex and Gemini spawn. */
export declare function bridgeRoutes(registry: ToolRegistry): Hono;
