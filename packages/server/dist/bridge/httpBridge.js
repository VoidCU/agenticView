import { Hono } from "hono";
import { BridgeAuthError } from "./toolRegistry.js";
/** HTTP face of the ToolRegistry, used by the stdio MCP bridge that Codex and Gemini spawn. */
export function bridgeRoutes(registry) {
    const app = new Hono();
    app.get("/bridge/:runId/tools", (c) => {
        try {
            return c.json(registry.describe(c.req.param("runId"), c.req.header("x-bridge-token") ?? ""));
        }
        catch (e) {
            if (e instanceof BridgeAuthError)
                return c.json({ ok: false, error: e.message }, 404);
            throw e;
        }
    });
    app.post("/bridge/:runId/call", async (c) => {
        let body;
        try {
            body = await c.req.json();
        }
        catch {
            return c.json({ ok: false, error: "Body must be JSON" }, 400);
        }
        try {
            const result = await registry.call(c.req.param("runId"), c.req.header("x-bridge-token") ?? "", String(body.name ?? ""), body.args);
            return c.json({ ok: true, result });
        }
        catch (e) {
            if (e instanceof BridgeAuthError)
                return c.json({ ok: false, error: e.message }, 404);
            return c.json({ ok: false, error: e.message });
        }
    });
    return app;
}
//# sourceMappingURL=httpBridge.js.map