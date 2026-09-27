import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";

let srv: Server | undefined;
let home: string | undefined;
const saved = { home: process.env.AGENTICVIEW_HOME, idle: process.env.AGENTICVIEW_IDLE_WAIT_SECONDS };

afterEach(async () => {
  await new Promise((r) => (srv ? srv.close(() => r(null)) : r(null)));
  srv = undefined;
  if (saved.home === undefined) delete process.env.AGENTICVIEW_HOME; else process.env.AGENTICVIEW_HOME = saved.home;
  if (saved.idle === undefined) delete process.env.AGENTICVIEW_IDLE_WAIT_SECONDS; else process.env.AGENTICVIEW_IDLE_WAIT_SECONDS = saved.idle;
  if (home) await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

/** Fake office whose /api/worker/claim always returns no tasks with the given servable count. */
async function fakeOffice(servable: number, proj: string): Promise<void> {
  home = await mkdtemp(join(tmpdir(), "av-doze-home-"));
  process.env.AGENTICVIEW_HOME = home;
  srv = createServer((req, res) => {
    if (req.url === "/healthz") { res.end(JSON.stringify({ ok: true })); return; }
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ tasks: [], cancelled: [], gone: [], capacity: 4, held: 0, servable, task: null }));
    });
  });
  await new Promise((r) => srv!.listen(0, "127.0.0.1", () => r(null)));
  const port = (srv!.address() as { port: number }).port;
  const key = createHash("sha1").update(resolve(proj).toLowerCase()).digest("hex").slice(0, 16);
  await mkdir(join(home, "instances"), { recursive: true });
  await writeFile(join(home, "instances", key + ".json"), JSON.stringify({ pid: process.pid, url: "http://127.0.0.1:" + port, token: "t", projectPath: proj, startedAt: new Date().toISOString() }));
}

describe("worker-mcp idle doze", () => {
  it("stretches the wait toward the idle cap when the office has no claude-session agents", async () => {
    const proj = await mkdtemp(join(tmpdir(), "av-doze-proj-"));
    try {
      await fakeOffice(0, proj);
      process.env.AGENTICVIEW_IDLE_WAIT_SECONDS = "3";
      const { nextTask } = await import("../src/worker-mcp.js");
      const t0 = Date.now();
      const out = await nextTask({ wait_seconds: 1, project: proj, session_id: "doze-test" } as never);
      const elapsed = Date.now() - t0;
      const text = JSON.stringify(out);
      expect(text).toContain("doze");
      // Waited past the requested 1s toward the 3s idle cap.
      expect(elapsed).toBeGreaterThanOrEqual(2500);
      expect(elapsed).toBeLessThan(15000);
    } finally {
      await rm(proj, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }, 30000);

  it("keeps the requested wait when agents are servable", async () => {
    const proj = await mkdtemp(join(tmpdir(), "av-doze2-proj-"));
    try {
      await fakeOffice(2, proj);
      process.env.AGENTICVIEW_IDLE_WAIT_SECONDS = "10";
      const { nextTask } = await import("../src/worker-mcp.js");
      const t0 = Date.now();
      const out = await nextTask({ wait_seconds: 1, project: proj, session_id: "doze-test-2" } as never);
      const elapsed = Date.now() - t0;
      expect(JSON.stringify(out)).toContain("No task arrived yet");
      expect(elapsed).toBeLessThan(6000);
    } finally {
      await rm(proj, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }, 30000);
});
