import { Hono } from "hono";
import type { EventBus } from "../events/bus.js";
/** Receives events from the user's own Claude Code session (plugin hooks) and mirrors them into the office. */
export declare function mirrorRoutes(bus: EventBus): Hono;
