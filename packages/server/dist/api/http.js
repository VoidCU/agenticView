import { Hono } from "hono";
import { mkdir, writeFile, stat, readFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { newId, ClaudeLimitsBodySchema, ProviderSchema, SwitchAgentPayloadSchema, SwitchProviderPayloadSchema } from "@agenticview/shared";
import { mirrorRoutes } from "../hooks/mirror.js";
const IMAGE_EXT = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif" };
/** REST routes: snapshot, uploads, hooks. Token middleware is applied by the server. */
export function apiRoutes(world) {
    const app = new Hono();
    app.get("/api/snapshot", async (c) => c.json(await world.snapshot()));
    app.get("/api/limits", async (c) => c.json(await world.getLimits()));
    app.get("/api/usage", async (c) => c.json(await world.getUsage()));
    app.post("/api/claude-limits", async (c) => {
        let json;
        try {
            json = await c.req.json();
        }
        catch {
            return c.json({ error: "JSON body expected" }, 400);
        }
        const parsed = ClaudeLimitsBodySchema.safeParse(json);
        if (!parsed.success) {
            return c.json({ error: `Invalid body: ${parsed.error.issues.map((i) => i.message).join(", ")}` }, 400);
        }
        const { session_id, model, cwd: _cwd, rate_limits } = parsed.data;
        // Silently ignore bodies without rate_limits.
        if (!rate_limits)
            return c.body(null, 204);
        // Normalise the model field: string or {id?, display_name?} -> string.
        let modelStr = "unknown";
        if (typeof model === "string" && model.trim()) {
            modelStr = model.trim().slice(0, 120);
        }
        else if (model && typeof model === "object") {
            const m = (model.id ?? model.display_name ?? "").trim();
            if (m)
                modelStr = m.slice(0, 120);
        }
        world.usageTracker.recordClaudeLimits(session_id, modelStr, rate_limits);
        // Broadcast updated sessions so the Sessions panel reflects the new limits.
        const sessions = await world.sessions();
        world.bus.emit({ type: "sessions.updated", sessions });
        return c.body(null, 204);
    });
    app.post("/api/agents/:id/switch", async (c) => {
        const id = c.req.param("id");
        let json;
        try {
            json = await c.req.json();
        }
        catch {
            return c.json({ error: "JSON body expected" }, 400);
        }
        const parsed = SwitchAgentPayloadSchema.safeParse(json);
        if (!parsed.success) {
            return c.json({ error: `Invalid body: ${parsed.error.issues.map((i) => i.message).join(", ")}` }, 400);
        }
        try {
            const agent = await world.switchAgent(id, parsed.data);
            return c.json({ ok: true, agent });
        }
        catch (e) {
            const msg = e.message;
            const status = msg.includes("Unknown agent") ? 404 : 400;
            return c.json({ error: msg }, status);
        }
    });
    app.post("/api/providers/:provider/switch", async (c) => {
        const providerParam = c.req.param("provider");
        const provParsed = ProviderSchema.safeParse(providerParam);
        if (!provParsed.success) {
            return c.json({ error: `Invalid provider: ${providerParam}` }, 400);
        }
        let json;
        try {
            json = await c.req.json();
        }
        catch {
            return c.json({ error: "JSON body expected" }, 400);
        }
        const parsed = SwitchProviderPayloadSchema.safeParse(json);
        if (!parsed.success) {
            return c.json({ error: `Invalid body: ${parsed.error.issues.map((i) => i.message).join(", ")}` }, 400);
        }
        try {
            const result = await world.switchProvider(provParsed.data, parsed.data);
            return c.json({ ok: true, ...result });
        }
        catch (e) {
            return c.json({ error: e.message }, 400);
        }
    });
    app.post("/api/tasks/:id/retry", async (c) => {
        const id = c.req.param("id");
        try {
            const task = await world.retryTask(id);
            return c.json({ ok: true, task });
        }
        catch (e) {
            const msg = e.message;
            const status = msg.includes("Unknown task") ? 404 : 400;
            return c.json({ error: msg }, status);
        }
    });
    app.post("/api/upload", async (c) => {
        let body;
        try {
            body = await c.req.parseBody();
        }
        catch {
            return c.json({ error: "multipart form expected" }, 400);
        }
        const file = body.file;
        if (!(file instanceof File))
            return c.json({ error: "field 'file' is required" }, 400);
        const ext = IMAGE_EXT[file.type] ?? (extname(file.name) || ".png");
        const dir = join(world.root, "uploads");
        await mkdir(dir, { recursive: true });
        const path = join(dir, `${newId("u")}${ext}`);
        await writeFile(path, Buffer.from(await file.arrayBuffer()));
        return c.json({ path });
    });
    app.route("/", mirrorRoutes(world.bus));
    app.all("/api/*", (c) => c.json({ error: "not found" }, 404));
    return app;
}
const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".map": "application/json",
    ".wasm": "application/wasm",
};
/** Serves the built web bundle with an SPA fallback to index.html. Rejects path traversal. */
export function staticRoutes(staticDir) {
    const app = new Hono();
    const root = resolve(staticDir);
    app.get("/*", async (c) => {
        const url = new URL(c.req.url);
        const rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
        let file = resolve(root, rel || "index.html");
        if (!file.startsWith(root + sep) && file !== root)
            file = join(root, "index.html");
        try {
            const s = await stat(file);
            if (!s.isFile())
                file = join(root, "index.html");
        }
        catch {
            file = join(root, "index.html");
        }
        try {
            const data = await readFile(file);
            const type = MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
            return c.body(data, 200, { "content-type": type, "cache-control": file.endsWith("index.html") ? "no-store" : "public, max-age=3600" });
        }
        catch {
            return c.text("AgenticView web bundle not built. Run: npm run build", 404);
        }
    });
    return app;
}
//# sourceMappingURL=http.js.map