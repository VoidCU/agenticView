import { Hono } from "hono";
import { mkdir, writeFile, stat, readFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { newId } from "@agenticview/shared";
import type { World } from "../world.js";
import { mirrorRoutes } from "../hooks/mirror.js";

const IMAGE_EXT: Record<string, string> = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif" };

/** REST routes: snapshot, uploads, hooks. Token middleware is applied by the server. */
export function apiRoutes(world: World): Hono {
  const app = new Hono();

  app.get("/api/snapshot", async (c) => c.json(await world.snapshot()));

  app.post("/api/upload", async (c) => {
    let body: Record<string, unknown>;
    try {
      body = await c.req.parseBody();
    } catch {
      return c.json({ error: "multipart form expected" }, 400);
    }
    const file = body.file;
    if (!(file instanceof File)) return c.json({ error: "field 'file' is required" }, 400);
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

const MIME: Record<string, string> = {
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
export function staticRoutes(staticDir: string): Hono {
  const app = new Hono();
  const root = resolve(staticDir);
  app.get("/*", async (c) => {
    const url = new URL(c.req.url);
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
    let file = resolve(root, rel || "index.html");
    if (!file.startsWith(root + sep) && file !== root) file = join(root, "index.html");
    try {
      const s = await stat(file);
      if (!s.isFile()) file = join(root, "index.html");
    } catch {
      file = join(root, "index.html");
    }
    try {
      const data = await readFile(file);
      const type = MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
      return c.body(data, 200, { "content-type": type, "cache-control": file.endsWith("index.html") ? "no-store" : "public, max-age=3600" });
    } catch {
      return c.text("AgenticView web bundle not built. Run: npm run build", 404);
    }
  });
  return app;
}
