import { Hono } from "hono";
import { BridgeAuthError, type ToolRegistry } from "../bridge/toolRegistry.js";
import { SessionRuntime, type WorkerReport } from "../runtimes/session.js";

const MAX_WAIT_MS = 25_000;

/**
 * Endpoints for Claude Code session workers (/agenticview-work). Mounted under /api, so they
 * require the launch token like the rest of the API. Workers identify themselves with the
 * `x-agenticview-worker` header; polls double as heartbeats.
 */
export function workerRoutes(session: SessionRuntime, toolRegistry: ToolRegistry): Hono {
  const app = new Hono();
  const workerOf = (h: string | undefined) => (h && /^[\w-]{1,64}$/.test(h) ? h : "anonymous");

  const body = async (c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown>> => {
    try {
      const b = await c.req.json();
      return b && typeof b === "object" ? (b as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  };

  app.post("/api/worker/claim", async (c) => {
    const b = await body(c);
    const wait = Math.min(MAX_WAIT_MS, Math.max(0, Number(b.waitMs ?? MAX_WAIT_MS) || 0));
    const task = await session.claim(workerOf(c.req.header("x-agenticview-worker")), wait, c.req.raw.signal);
    return c.json({ task });
  });

  app.post("/api/worker/:runId/report", async (c) => {
    const b = await body(c);
    const events = Array.isArray(b.events) ? (b.events as WorkerReport[]) : [];
    return c.json(session.report(c.req.param("runId"), events, workerOf(c.req.header("x-agenticview-worker"))));
  });

  app.post("/api/worker/:runId/complete", async (c) => {
    const b = await body(c);
    const outcome = { text: typeof b.text === "string" ? b.text : undefined, error: typeof b.error === "string" && b.error ? b.error : undefined };
    return c.json(session.complete(c.req.param("runId"), outcome, workerOf(c.req.header("x-agenticview-worker"))));
  });

  app.post("/api/worker/:runId/bridge", async (c) => {
    const runId = c.req.param("runId");
    const b = await body(c);
    const name = String(b.name ?? "");
    const access = session.bridgeAccess(runId, workerOf(c.req.header("x-agenticview-worker")));
    if (!("token" in access)) return c.json(access);
    session.emit(runId, { type: "tool_start", name, input: b.args ?? {} });
    try {
      const result = await toolRegistry.call(runId, access.token, name, b.args);
      session.emit(runId, { type: "tool_end", name, ok: true, summary: result.slice(0, 200) });
      return c.json({ ok: true, result });
    } catch (e) {
      const error = e instanceof BridgeAuthError ? "Run is no longer active" : (e as Error).message;
      session.emit(runId, { type: "tool_end", name, ok: false, summary: error });
      return c.json({ ok: false, error });
    }
  });

  return app;
}
