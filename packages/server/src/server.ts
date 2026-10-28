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
import { MailAccounts } from "./mail/accounts.js";
import { OAuthFlow } from "./mail/oauth.js";
import { oauthRoutes } from "./mail/oauthRoutes.js";
import { mailRoutes } from "./mail/routes.js";

export interface ServerOptions {
  world: WorldRef;
  token: string;
  port?: number;
  runtimes?: Map<Provider, Runtime>;
  staticDir?: string;
  openProject?: (path: string) => Promise<string>;
  workerTools?: (agent: Agent, task: Task) => BridgeTool[];
  /** Called after an authenticated POST /api/shutdown has been answered (the CLI's `close`). */
  onShutdown?: () => void;
  /** fetch used for Google OAuth/Gmail calls (tests inject a fake). Defaults to global fetch. */
  mailFetch?: typeof fetch;
}

export interface RunningServer {
  url: string;
  port: number;
  token: string;
  world: World;
  orchestrator: Orchestrator;
  bus: EventBus;
  /** Global Gmail accounts and this server's OAuth flow (its loopback callback points at this port). */
  mail: { accounts: MailAccounts; flow: OAuthFlow };
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
  const mailAccounts = new MailAccounts();
  const oauthFlow = new OAuthFlow(
    mailAccounts,
    () => `${bridgeUrl()}/oauth/google/callback`,
    () => bus.emit({ type: "mail.changed", what: "accounts" }),
    opts.mailFetch ?? fetch,
  );
  const mail = { accounts: mailAccounts, flow: oauthFlow };
  const world = await createWorld(opts.world, {
    runtimes,
    bus,
    toolRegistry,
    bridgeUrl,
    workerTools: workerToolsFor,
    mail: { ...mail, fetch: opts.mailFetch ?? fetch },
  });

  const app = new Hono();
  app.get("/healthz", (c) => c.json({ ok: true, world: opts.world.kind }));
  app.route("/", bridgeRoutes(toolRegistry));
  // Google's OAuth redirect arrives from the user's browser without the office token, so this route is
  // deliberately mounted BEFORE the token middleware (and is outside /api/* anyway). The single-use,
  // 10-minute OAuth state issued by OAuthFlow.start() is what guards it.
  app.route("/", oauthRoutes(oauthFlow));
  app.use("/api/*", requireToken(opts.token));
  app.use("/hooks", requireToken(opts.token));
  // Graceful stop for `agenticview close`: answer first, then let the owner tear down (signals are unreliable on Windows).
  app.post("/api/shutdown", (c) => {
    if (!opts.onShutdown) return c.json({ error: "shutdown not supported" }, 501);
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
  // Before apiRoutes: it ends with an /api/* 404 catch-all.
  app.route("/", mailRoutes(world.mail, oauthFlow));
  app.route("/", apiRoutes(world));
  if (opts.staticDir) app.route("/", staticRoutes(opts.staticDir));

  const stopMailCheck = world.mail.startAutoCheck();

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
    mail,
    close: async () => {
      if (pulse) clearInterval(pulse);
      stopMailCheck();
      await ws.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}
