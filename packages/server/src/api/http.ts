import { Hono } from "hono";
import { mkdir, writeFile, stat, readFile } from "node:fs/promises";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { extname, join, normalize, resolve, sep } from "node:path";
import { newId, ClaudeLimitsBodySchema, ProviderSchema, SwitchAgentPayloadSchema, SwitchProviderPayloadSchema } from "@agenticview/shared";
import type { World } from "../world.js";
import { mirrorRoutes } from "../hooks/mirror.js";

const execFile = promisify(execFileCb);
const DIFF_CAP = 200 * 1024; // 200 KB

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFile("git", args, { cwd, maxBuffer: DIFF_CAP + 4096 });
  return stdout;
}

async function taskChanges(world: World, taskId: string): Promise<{ files: { path: string; kind: string }[]; diff: string; truncated: boolean }> {
  const task = await world.tasks.get(taskId);
  if (!task) throw Object.assign(new Error(`Unknown task ${taskId}`), { status: 404 });

  // Extract file_changed log entries, keeping last kind per path.
  const seen = new Map<string, string>();
  for (const e of task.log) {
    if (e.type !== "file_changed") continue;
    const sp = e.text.indexOf(" ");
    if (sp < 0) continue;
    const kind = e.text.slice(0, sp);
    const path = e.text.slice(sp + 1);
    seen.set(path, kind);
  }

  const files = [...seen.entries()].map(([path, kind]) => ({ path, kind }));
  if (files.length === 0) return { files, diff: "", truncated: false };

  const projectPath = task.projectPath;
  const resolvedProject = resolve(projectPath);

  // Validate each path stays inside projectPath.
  const validPaths: string[] = [];
  for (const { path } of files) {
    const abs = resolve(projectPath, path);
    if (abs !== resolvedProject && !abs.startsWith(resolvedProject + sep)) continue;
    validPaths.push(path);
  }
  if (validPaths.length === 0) return { files, diff: "", truncated: false };

  // Check git availability.
  const isGit = await runGit(projectPath, ["rev-parse", "--git-dir"]).then(() => true, () => false);
  if (!isGit) return { files, diff: "", truncated: false };

  let diff = "";
  let truncated = false;

  // Tracked changes (modified, deleted, and committed new files).
  const trackedDiff = await runGit(projectPath, ["diff", "HEAD", "--", ...validPaths]).catch(() => "");
  if (trackedDiff.length > DIFF_CAP) {
    diff = trackedDiff.slice(0, DIFF_CAP);
    truncated = true;
  } else {
    diff = trackedDiff;
  }

  // For "create" paths not appearing in tracked diff: might be untracked new files.
  if (!truncated) {
    for (const { path, kind } of files) {
      if (kind !== "create") continue;
      const inHead = await runGit(projectPath, ["ls-files", "--error-unmatch", "--", path]).then(() => true, () => false);
      if (inHead) continue; // already in git diff HEAD
      const abs = resolve(projectPath, path);
      let content: string;
      try {
        content = await readFile(abs, "utf-8");
      } catch {
        continue; // file gone
      }
      const lines = content.split("\n");
      // Remove trailing empty line from split if file ended with \n
      const lineCount = lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
      const hunkLines = lines
        .slice(0, lineCount)
        .map((l) => `+${l}`)
        .join("\n");
      const patch = `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${lineCount} @@\n${hunkLines}\n`;
      if (diff.length + patch.length > DIFF_CAP) {
        truncated = true;
        break;
      }
      diff += patch;
    }
  }

  return { files, diff, truncated };
}

const IMAGE_EXT: Record<string, string> = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif" };

/** REST routes: snapshot, uploads, hooks. Token middleware is applied by the server. */
export function apiRoutes(world: World): Hono {
  const app = new Hono();

  app.get("/api/snapshot", async (c) => c.json(await world.snapshot()));

  app.get("/api/limits", async (c) => c.json(await world.getLimits()));

  app.get("/api/usage", async (c) => c.json(await world.getUsage()));

  app.post("/api/claude-limits", async (c) => {
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      return c.json({ error: "JSON body expected" }, 400);
    }
    const parsed = ClaudeLimitsBodySchema.safeParse(json);
    if (!parsed.success) {
      return c.json({ error: `Invalid body: ${parsed.error.issues.map((i) => i.message).join(", ")}` }, 400);
    }
    const { session_id, model, cwd: _cwd, rate_limits } = parsed.data;
    // Silently ignore bodies without rate_limits.
    if (!rate_limits) return c.body(null, 204);

    // Normalise the model field: string or {id?, display_name?} -> string.
    let modelStr = "unknown";
    if (typeof model === "string" && model.trim()) {
      modelStr = model.trim().slice(0, 120);
    } else if (model && typeof model === "object") {
      const m = (model.id ?? model.display_name ?? "").trim();
      if (m) modelStr = m.slice(0, 120);
    }

    world.usageTracker.recordClaudeLimits(session_id, modelStr, rate_limits);

    // Broadcast updated sessions so the Sessions panel reflects the new limits.
    const sessions = await world.sessions();
    world.bus.emit({ type: "sessions.updated", sessions });

    return c.body(null, 204);
  });

  app.post("/api/agents/:id/switch", async (c) => {
    const id = c.req.param("id");
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      return c.json({ error: "JSON body expected" }, 400);
    }
    const parsed = SwitchAgentPayloadSchema.safeParse(json);
    if (!parsed.success) {
      return c.json({ error: `Invalid body: ${parsed.error.issues.map((i) => i.message).join(", ")}` }, 400);
    }
    try {
      const agent = await world.switchAgent(id, parsed.data);
      return c.json({ ok: true, agent });
    } catch (e) {
      const msg = (e as Error).message;
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
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      return c.json({ error: "JSON body expected" }, 400);
    }
    const parsed = SwitchProviderPayloadSchema.safeParse(json);
    if (!parsed.success) {
      return c.json({ error: `Invalid body: ${parsed.error.issues.map((i) => i.message).join(", ")}` }, 400);
    }
    try {
      const result = await world.switchProvider(provParsed.data, parsed.data);
      return c.json({ ok: true, ...result });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  });

  app.get("/api/tasks/:id/changes", async (c) => {
    const id = c.req.param("id");
    try {
      const result = await taskChanges(world, id);
      return c.json(result);
    } catch (e) {
      const err = e as Error & { status?: number };
      return c.json({ error: err.message }, (err.status ?? 500) as 404 | 500);
    }
  });

  app.post("/api/tasks/:id/retry", async (c) => {
    const id = c.req.param("id");
    try {
      const task = await world.retryTask(id);
      return c.json({ ok: true, task });
    } catch (e) {
      const msg = (e as Error).message;
      const status = msg.includes("Unknown task") ? 404 : 400;
      return c.json({ error: msg }, status);
    }
  });

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
