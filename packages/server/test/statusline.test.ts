/**
 * Tests for bin/statusline.mjs
 *
 * Spawns the script as a child process and feeds it JSON on stdin.
 */
import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { createServer as createHttpServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../../../..");
const scriptPath = join(repoRoot, "bin", "statusline.mjs");

/** Run statusline.mjs with given stdin JSON and env overrides. Returns {stdout, stderr, code}. */
function runStatusline(input: string, env: Record<string, string | undefined> = {}): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((res) => {
    const child = spawn(process.execPath, [scriptPath], {
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("close", (code) => res({ stdout, stderr, code }));
    child.stdin.write(input);
    child.stdin.end();
  });
}

/** Start a minimal HTTP server that records the last POST body, responding 200 immediately. */
function startFakeOffice(): Promise<{
  url: string;
  lastBody: () => Record<string, unknown> | null;
  lastHeaders: () => Record<string, string | string[]>;
  close: () => Promise<void>;
}> {
  return new Promise((res, rej) => {
    let body: Record<string, unknown> | null = null;
    let headers: Record<string, string | string[]> = {};
    const srv: Server = createHttpServer((req: IncomingMessage, resp: ServerResponse) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        if (req.url === "/healthz") {
          resp.writeHead(200);
          resp.end("ok");
          return;
        }
        if (req.url === "/api/claude-limits") {
          headers = req.headers as Record<string, string | string[]>;
          try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { body = null; }
          resp.writeHead(200, { "content-type": "application/json" });
          resp.end("{}");
          return;
        }
        resp.writeHead(404);
        resp.end();
      });
    });
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address() as { port: number };
      res({
        url: `http://127.0.0.1:${addr.port}`,
        lastBody: () => body,
        lastHeaders: () => headers,
        close: () => new Promise<void>((r) => srv.close(() => r())),
      });
    });
    srv.on("error", rej);
  });
}

/** Write an instance file for a project dir so statusline can discover the office. */
async function writeInstanceFile(home: string, projectPath: string | null, officeUrl: string, token: string): Promise<void> {
  const key = projectPath
    ? createHash("sha1").update(resolve(projectPath).toLowerCase()).digest("hex").slice(0, 16)
    : "hub";
  const dir = join(home, "instances");
  await mkdir(dir, { recursive: true });
  const inst = { pid: process.pid, url: officeUrl, token, projectPath, startedAt: new Date().toISOString() };
  await writeFile(join(dir, `${key}.json`), JSON.stringify(inst));
}

describe("statusline.mjs", () => {
  it("always exits 0", async () => {
    const { code } = await runStatusline("garbage not json");
    expect(code).toBe(0);
  });

  it("prints default output with model and rate limits", async () => {
    const input = JSON.stringify({
      session_id: "sess-1",
      model: { id: "claude-opus-4-5", display_name: "Opus 4.5" },
      cwd: "/tmp/myproject",
      rate_limits: {
        five_hour: { used_percentage: 42, resets_at: 9999999 },
        seven_day: { used_percentage: 18, resets_at: 9999999 },
      },
    });
    const { stdout, code } = await runStatusline(input);
    expect(code).toBe(0);
    expect(stdout).toContain("Opus 4.5");
    expect(stdout).toContain("5h 42%");
    expect(stdout).toContain("week 18%");
  });

  it("prints model only when rate limits are absent", async () => {
    const input = JSON.stringify({
      session_id: "sess-2",
      model: { id: "claude-sonnet-4-6", display_name: "Sonnet 4.6" },
      cwd: "/tmp/proj2",
    });
    const { stdout, code } = await runStatusline(input);
    expect(code).toBe(0);
    expect(stdout.trim()).toBe("Sonnet 4.6");
  });

  it("prints nothing (empty line) when JSON has no recognisable fields", async () => {
    const { stdout, code } = await runStatusline(JSON.stringify({ foo: "bar" }));
    expect(code).toBe(0);
    expect(stdout.trim()).toBe("");
  });

  it("exits 0 and prints quickly when office is unreachable (<1s)", async () => {
    // Point to a port that refuses connections
    const home = await mkdtemp(join(tmpdir(), "av-sl-unreachable-"));
    const proj = await mkdtemp(join(tmpdir(), "av-sl-proj-"));
    try {
      // Write an instance file pointing at a port that is not listening
      await writeInstanceFile(home, proj, "http://127.0.0.1:19999", "tok");
      const input = JSON.stringify({
        session_id: "sess-3",
        model: { id: "claude-opus-4-5", display_name: "Opus 4.5" },
        cwd: proj,
        rate_limits: { five_hour: { used_percentage: 10, resets_at: 0 } },
      });
      const t0 = Date.now();
      const { stdout, code } = await runStatusline(input, { AGENTICVIEW_HOME: home });
      const elapsed = Date.now() - t0;
      expect(code).toBe(0);
      expect(stdout).toContain("Opus 4.5");
      expect(elapsed).toBeLessThan(1000);
    } finally {
      await rm(home, { recursive: true, force: true, maxRetries: 3 });
      await rm(proj, { recursive: true, force: true, maxRetries: 3 });
    }
  }, 5000);

  it("POSTs body to a fake server with the right auth header", async () => {
    const office = await startFakeOffice();
    const home = await mkdtemp(join(tmpdir(), "av-sl-post-"));
    const proj = await mkdtemp(join(tmpdir(), "av-sl-postproj-"));
    try {
      await writeInstanceFile(home, proj, office.url, "secret-token");
      const input = JSON.stringify({
        session_id: "sess-post",
        model: { id: "claude-opus-4-5", display_name: "Opus 4.5" },
        cwd: proj,
        rate_limits: {
          five_hour: { used_percentage: 55, resets_at: 1234567890 },
        },
      });
      const { code } = await runStatusline(input, { AGENTICVIEW_HOME: home });
      // Give the fire-and-forget time to land (script waits up to ~1.1s internally)
      await new Promise((r) => setTimeout(r, 500));
      expect(code).toBe(0);
      const body = office.lastBody();
      expect(body).not.toBeNull();
      expect(body?.session_id).toBe("sess-post");
      expect((body?.rate_limits as Record<string, unknown>)?.five_hour).toBeDefined();
      const hdrs = office.lastHeaders();
      expect(hdrs["x-agenticview-token"]).toBe("secret-token");
    } finally {
      await office.close();
      await rm(home, { recursive: true, force: true, maxRetries: 3 });
      await rm(proj, { recursive: true, force: true, maxRetries: 3 });
    }
  }, 10000);

  it("wrap passthrough: AGENTICVIEW_STATUSLINE_WRAP echoes its own output", async () => {
    const input = JSON.stringify({
      session_id: "sess-wrap",
      model: { id: "claude-sonnet-4-6", display_name: "Sonnet 4.6" },
      cwd: "/tmp/wraptest",
    });
    // Use a platform-safe echo command that simply prints a fixed string
    const wrapCmd = process.platform === "win32" ? "echo WRAPPED_OUTPUT" : "echo WRAPPED_OUTPUT";
    const { stdout, code } = await runStatusline(input, { AGENTICVIEW_STATUSLINE_WRAP: wrapCmd });
    expect(code).toBe(0);
    expect(stdout).toContain("WRAPPED_OUTPUT");
    // Default model line should NOT appear when wrap is active
    expect(stdout).not.toContain("Sonnet 4.6");
  });

  it("--wrap-b64 runs the user's previous status-line command with the same stdin", async () => {
    const input = JSON.stringify({ session_id: "s", model: { display_name: "Sonnet 4.6" }, cwd: "/tmp/wraptest" });
    // The previous command reads the statusLine JSON from stdin, proving stdin is forwarded.
    const prev = `node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log('PREV:'+JSON.parse(s).model.display_name))"`;
    const b64 = Buffer.from(prev).toString("base64");
    const out = await new Promise<{ stdout: string; code: number | null }>((res) => {
      const child = spawn(process.execPath, [scriptPath, "--wrap-b64", b64], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, AGENTICVIEW_STATUSLINE_WRAP: "" } });
      let stdout = "";
      child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
      child.on("close", (code) => res({ stdout, code }));
      child.stdin.end(input);
    });
    expect(out.code).toBe(0);
    expect(out.stdout).toContain("PREV:Sonnet 4.6");
  });
});

describe("SessionStart record-root", () => {
  it("refreshes a stable copy of the relay so upgrades never break the status line", async () => {
    const { mkdtemp, readFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const home = await mkdtemp(join(tmpdir(), "av-sl-home-"));
    const saved = process.env.AGENTICVIEW_HOME;
    process.env.AGENTICVIEW_HOME = home;
    try {
      const { recordRoot } = (await import(pathToFileURL(join(repoRoot, "hooks", "hook.mjs")).href)) as { recordRoot: (p: string) => Promise<void> };
      await recordRoot(repoRoot);
      expect(await readFile(join(home, "plugin-root"), "utf8")).toBe(repoRoot);
      expect(await readFile(join(home, "statusline.mjs"), "utf8")).toBe(await readFile(scriptPath, "utf8"));
    } finally {
      if (saved === undefined) delete process.env.AGENTICVIEW_HOME;
      else process.env.AGENTICVIEW_HOME = saved;
      await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});

describe("SessionStart record-root version guard", () => {
  it("never lets an older plugin folder replace a newer recorded one, but replaces a missing one", async () => {
    const { mkdtemp, mkdir: mk, writeFile: wf, readFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const base = await mkdtemp(join(tmpdir(), "av-root-guard-"));
    const home = join(base, "home");
    const plugin = async (v: string) => {
      const dir = join(base, `plugin-${v}`);
      await mk(join(dir, ".claude-plugin"), { recursive: true });
      await wf(join(dir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "agenticview", version: v }));
      return dir;
    };
    const saved = process.env.AGENTICVIEW_HOME;
    process.env.AGENTICVIEW_HOME = home;
    try {
      const { recordRoot, compareVersions } = (await import(pathToFileURL(join(repoRoot, "hooks", "hook.mjs")).href)) as {
        recordRoot: (p: string) => Promise<void>;
        compareVersions: (a: string, b: string) => number;
      };
      expect(compareVersions("0.2.10", "0.2.9")).toBeGreaterThan(0);
      const newer = await plugin("0.2.9");
      const older = await plugin("0.2.5");
      await recordRoot(newer);
      await recordRoot(older);
      expect(await readFile(join(home, "plugin-root"), "utf8")).toBe(newer);
      await rm(newer, { recursive: true, force: true });
      await recordRoot(older);
      expect(await readFile(join(home, "plugin-root"), "utf8")).toBe(older);
    } finally {
      if (saved === undefined) delete process.env.AGENTICVIEW_HOME;
      else process.env.AGENTICVIEW_HOME = saved;
      await rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});
