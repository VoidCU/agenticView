import type { Server as HttpServer } from "node:http";
import { Hono } from "hono";
import { createAdaptorServer } from "@hono/node-server";
import type { Provider } from "@agenticview/shared";
import type { WorldRef } from "./agents/registry.js";
import type { Runtime, BridgeTool } from "./runtimes/types.js";
import { ToolRegistry } from "./bridge/toolRegistry.js";
import { bridgeRoutes } from "./bridge/httpBridge.js";
import { EventBus } from "./events/bus.js";
import { createWorld, type World } from "./world.js";
import { requireToken } from "./api/auth.js";
import { apiRoutes, staticRoutes } from "./api/http.js";
import { attachWs } from "./api/ws.js";
import type { Agent, Task } from "@agenticview/shared";
import type { Orchestrator } from "./manager/orchestrator.js";
import { workerTools } from "./manager/workerTools.js";
import { SessionRuntime } from "./runtimes/session.js";
import { workerRoutes } from "./api/worker.js";

export interface ServerOptions {
  world: WorldRef;
  token: string;
  port?: number;
  runtimes?: Map<Provider, Runtime>;
  staticDir?: string;
  openProject?: (path: string) => Promise<string>;
  workerTools?: (agent: Agent, task: Task) => BridgeTool[];
}

export interface RunningServer {
  url: string;
  port: number;
  token: string;
  world: World;
  orchestrator: Orchestrator;
  bus: EventBus;
  close(): Promise<void>;
}

const HOST = "127.0.0.1";

/** Boot one world (project or hub) behind a localhost, token-guarded HTTP + WebSocket server. */
export async function createServer(opts: ServerOptions): Promise<RunningServer> {
  const bus = new EventBus();
  const toolRegistry = new ToolRegistry();
  let port = 0;
  const bridgeUrl = () => `http://${HOST}:${port}`;

  const runtimes = opts.runtimes ?? (await (await import("./runtimes/index.js")).createRuntimes({ bridgeUrl }));
  const workerToolsFor = opts.workerTools ?? ((agent: Agent, task: Task) => workerTools({ projectPath: task.projectPath || process.cwd(), agent }));
  const world = await createWorld(opts.world, { runtimes, bus, toolRegistry, bridgeUrl, workerTools: workerToolsFor });

  const app = new Hono();
  app.get("/healthz", (c) => c.json({ ok: true, world: opts.world.kind }));
  app.route("/", bridgeRoutes(toolRegistry));
  app.use("/api/*", requireToken(opts.token));
  app.use("/hooks", requireToken(opts.token));
  const session = runtimes.get("claude-session");
  if (session instanceof SessionRuntime) {
    session.onWorkersChanged = () => void world.emitProviders().catch(() => undefined);
    app.route("/", workerRoutes(session, toolRegistry));
  }
  app.route("/", apiRoutes(world));
  if (opts.staticDir) app.route("/", staticRoutes(opts.staticDir));

  const httpServer = createAdaptorServer({ fetch: app.fetch }) as HttpServer;
  const ws = attachWs(httpServer, { token: opts.token, world, openProject: opts.openProject });

  await new Promise<void>((resolve, reject) => {
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
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}
