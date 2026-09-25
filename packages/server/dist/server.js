import { Hono } from "hono";
import { createAdaptorServer } from "@hono/node-server";
import { ToolRegistry } from "./bridge/toolRegistry.js";
import { bridgeRoutes } from "./bridge/httpBridge.js";
import { EventBus } from "./events/bus.js";
import { createWorld } from "./world.js";
import { requireToken } from "./api/auth.js";
import { apiRoutes, staticRoutes } from "./api/http.js";
import { attachWs } from "./api/ws.js";
import { workerTools } from "./manager/workerTools.js";
import { SessionRuntime } from "./runtimes/session.js";
import { workerRoutes } from "./api/worker.js";
const HOST = "127.0.0.1";
/** Boot one world (project or hub) behind a localhost, token-guarded HTTP + WebSocket server. */
export async function createServer(opts) {
    const bus = new EventBus();
    const toolRegistry = new ToolRegistry();
    let port = 0;
    const bridgeUrl = () => `http://${HOST}:${port}`;
    const runtimes = opts.runtimes ?? (await (await import("./runtimes/index.js")).createRuntimes({ bridgeUrl }));
    const workerToolsFor = opts.workerTools ?? ((agent, task) => workerTools({ projectPath: task.projectPath || process.cwd(), agent }));
    const world = await createWorld(opts.world, { runtimes, bus, toolRegistry, bridgeUrl, workerTools: workerToolsFor });
    const app = new Hono();
    app.get("/healthz", (c) => c.json({ ok: true, world: opts.world.kind }));
    app.route("/", bridgeRoutes(toolRegistry));
    app.use("/api/*", requireToken(opts.token));
    app.use("/hooks", requireToken(opts.token));
    // Graceful stop for `agenticview close`: answer first, then let the owner tear down (signals are unreliable on Windows).
    app.post("/api/shutdown", (c) => {
        if (!opts.onShutdown)
            return c.json({ error: "shutdown not supported" }, 501);
        setTimeout(() => opts.onShutdown?.(), 50);
        return c.json({ ok: true });
    });
    const session = runtimes.get("claude-session");
    if (session instanceof SessionRuntime) {
        session.onWorkersChanged = () => void world.emitProviders().catch(() => undefined);
        app.route("/", workerRoutes(session, toolRegistry));
    }
    // Sessions go offline by time alone; re-check now and then so the office sees it.
    const pulse = session instanceof SessionRuntime ? setInterval(() => session.pulse(), 15_000) : undefined;
    pulse?.unref();
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
            if (pulse)
                clearInterval(pulse);
            await ws.close();
            await new Promise((resolve) => httpServer.close(() => resolve()));
        },
    };
}
//# sourceMappingURL=server.js.map