import { Hono } from "hono";
import { createAdaptorServer } from "@hono/node-server";
import { ToolRegistry } from "./bridge/toolRegistry.js";
import { bridgeRoutes } from "./bridge/httpBridge.js";
import { EventBus } from "./events/bus.js";
import { createWorld } from "./world.js";
import { requireToken } from "./api/auth.js";
import { apiRoutes, staticRoutes } from "./api/http.js";
import { attachWs } from "./api/ws.js";
const HOST = "127.0.0.1";
/** Boot one world (project or hub) behind a localhost, token-guarded HTTP + WebSocket server. */
export async function createServer(opts) {
    const bus = new EventBus();
    const toolRegistry = new ToolRegistry();
    let port = 0;
    const bridgeUrl = () => `http://${HOST}:${port}`;
    const runtimes = opts.runtimes ?? (await (await import("./runtimes/index.js")).createRuntimes({ bridgeUrl }));
    const world = await createWorld(opts.world, { runtimes, bus, toolRegistry, bridgeUrl, workerTools: opts.workerTools });
    const app = new Hono();
    app.get("/healthz", (c) => c.json({ ok: true, world: opts.world.kind }));
    app.route("/", bridgeRoutes(toolRegistry));
    app.use("/api/*", requireToken(opts.token));
    app.use("/hooks", requireToken(opts.token));
    app.route("/", apiRoutes(world));
    if (opts.staticDir)
        app.route("/", staticRoutes(opts.staticDir));
    const httpServer = createAdaptorServer({ fetch: app.fetch });
    const ws = attachWs(httpServer, { token: opts.token, world, openProject: opts.openProject });
    await new Promise((resolve, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(opts.port ?? 0, HOST, () => resolve());
    });
    const addr = httpServer.address();
    port = typeof addr === "object" && addr ? addr.port : (opts.port ?? 0);
    return {
        url: `http://${HOST}:${port}`,
        port,
        token: opts.token,
        world,
        orchestrator: world.orchestrator,
        bus,
        close: async () => {
            await ws.close();
            await new Promise((resolve) => httpServer.close(() => resolve()));
        },
    };
}
//# sourceMappingURL=server.js.map