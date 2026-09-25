import { Hono } from "hono";
import { BridgeAuthError } from "../bridge/toolRegistry.js";
const MAX_WAIT_MS = 25_000;
/**
 * Long bridge calls from a session (await_tasks) return early after this long with the tasks still
 * running, so no HTTP or MCP tool-call timeout between the session and the office can cut them off;
 * the session calls again to keep waiting.
 */
export const BRIDGE_AWAIT_CHUNK_SECONDS = 240;
const str = (v, max) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
/**
 * Endpoints for Claude Code session workers (/agenticview-work). Mounted under /api, so they
 * require the launch token like the rest of the API. Workers identify themselves with the
 * `x-agenticview-worker` header; polls double as heartbeats.
 */
export function workerRoutes(session, toolRegistry) {
    const app = new Hono();
    const workerOf = (h) => (h && /^[\w-]{1,64}$/.test(h) ? h : "anonymous");
    const body = async (c) => {
        try {
            const b = await c.req.json();
            return b && typeof b === "object" ? b : {};
        }
        catch {
            return {};
        }
    };
    app.post("/api/worker/claim", async (c) => {
        const b = await body(c);
        const wait = Math.min(MAX_WAIT_MS, Math.max(0, Number(b.waitMs ?? MAX_WAIT_MS) || 0));
        const info = b.session && typeof b.session === "object" ? b.session : {};
        const task = await session.claim(workerOf(c.req.header("x-agenticview-worker")), wait, c.req.raw.signal, {
            model: str(info.model, 120),
            cwd: str(info.cwd, 1000),
            agent: str(info.agent, 40),
        });
        return c.json({ task });
    });
    app.post("/api/worker/:runId/report", async (c) => {
        const b = await body(c);
        const events = Array.isArray(b.events) ? b.events : [];
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
        const args = b.args && typeof b.args === "object" ? { ...b.args } : {};
        if (name === "await_tasks" && args.maxWaitSeconds === undefined)
            args.maxWaitSeconds = Number(process.env.AGENTICVIEW_AWAIT_CHUNK_SECONDS) || BRIDGE_AWAIT_CHUNK_SECONDS;
        const access = session.bridgeAccess(runId, workerOf(c.req.header("x-agenticview-worker")));
        if (!("token" in access))
            return c.json(access);
        session.emit(runId, { type: "tool_start", name, input: args });
        try {
            const result = await toolRegistry.call(runId, access.token, name, args);
            session.emit(runId, { type: "tool_end", name, ok: true, summary: result.slice(0, 200) });
            return c.json({ ok: true, result });
        }
        catch (e) {
            const error = e instanceof BridgeAuthError ? "Run is no longer active" : e.message;
            session.emit(runId, { type: "tool_end", name, ok: false, summary: error });
            return c.json({ ok: false, error });
        }
    });
    return app;
}
//# sourceMappingURL=worker.js.map