import { Hono } from "hono";
import type { World } from "../world.js";
/** REST routes: snapshot, uploads, hooks. Token middleware is applied by the server. */
export declare function apiRoutes(world: World): Hono;
/** Serves the built web bundle with an SPA fallback to index.html. Rejects path traversal. */
export declare function staticRoutes(staticDir: string): Hono;
