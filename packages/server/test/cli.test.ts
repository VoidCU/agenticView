import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { spawn, execSync, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import WebSocket from "ws";
import { createServer, type RunningServer } from "../src/server.js";
import { FakeRuntime } from "../src/runtimes/fake.js";

const repoRoot = resolve(import.meta.dirname, "../../..");
const cli = join(repoRoot, "packages/server/dist/cli.js");
let home: string;
let proj: string;
const children: ChildProcess[] = [];
let inProc: RunningServer | undefined;
const savedHome = process.env.AGENTICVIEW_HOME;

beforeAll(() => {
  execSync("npx tsc -b packages/server", { cwd: repoRoot, stdio: "inherit" });
}, 120000);
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "av-cli-home-"));
  proj = await mkdtemp(join(tmpdir(), "av cli proj-"));
  process.env.AGENTICVIEW_HOME = home;
});
afterEach(async () => {
  for (const c of children.splice(0)) c.kill();
  await inProc?.close();
  inProc = undefined;
  process.env.AGENTICVIEW_HOME = savedHome;
  await new Promise((r) => setTimeout(r, 100));
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  await rm(proj, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function run(args: string[], stdin?: string, fromCwd?: string) {
  const started = Date.now();
  const child = spawn(process.execPath, [cli, ...args], { env: { ...process.env, AGENTICVIEW_HOME: home }, stdio: ["pipe", "pipe", "pipe"], ...(fromCwd ? { cwd: fromCwd } : {}) });
  children.push(child);
  let out = "";
  let err = "";
  child.stdout.on("data", (d) => (out += String(d)));
  child.stderr.on("data", (d) => (err += String(d)));
  if (stdin !== undefined) child.stdin.end(stdin);
  const exit = new Promise<{ code: number | null; ms: number }>((res) => child.on("exit", (code) => res({ code, ms: Date.now() - started })));
  const line = (prefix: string, ms = 15000) =>
    new Promise<string>((res, rej) => {
      const t0 = Date.now();
      const i = setInterval(() => {
        const l = out.split(/\r?\n/).find((x) => x.startsWith(prefix));
        if (l) { clearInterval(i); res(l); }
        else if (Date.now() - t0 > ms) { clearInterval(i); rej(new Error(`no line '${prefix}' in stdout: ${out}\nstderr: ${err}`)); }
      }, 20);
    });
  return { child, exit, line, out: () => out, err: () => err };
}

describe("cli", () => {
  it("open starts a server for a project path with spaces, records an instance, and reuses it", async () => {
    const first = run(["open", "--project", proj, "--no-browser"]);
    const l = await first.line("AgenticView: ");
    const full = l.slice("AgenticView: ".length).trim();
    expect(full).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/#token=[0-9a-f]{32}$/);
    const url = full.split("/#")[0]!;
    expect((await fetch(`${url}/healthz`)).status).toBe(200);
    const files = await readdir(join(home, "instances"));
    expect(files).toHaveLength(1);
    const inst = JSON.parse(await readFile(join(home, "instances", files[0]!), "utf8"));
    expect(inst).toMatchObject({ url, projectPath: proj });
    expect(inst.pid).toBe(first.child.pid);
    const second = run(["open", "--project", proj, "--no-browser"]);
    const l2 = await second.line("AgenticView: ");
    expect(l2).toBe(l);
    const r = await second.exit;
    expect(r.code).toBe(0);
    expect((await fetch(`${url}/api/snapshot?token=${full.split("#token=")[1]}`)).status).toBe(200);
  }, 30000);

  it("hub starts a hub world", async () => {
    const h = run(["hub", "--no-browser"]);
    const l = await h.line("AgenticView: ");
    const url = l.slice("AgenticView: ".length).trim().split("/#")[0]!;
    expect(await (await fetch(`${url}/healthz`)).json()).toEqual({ ok: true, world: "hub" });
    expect(await readdir(join(home, "instances"))).toEqual(["hub.json"]);
  }, 30000);

  it("close stops the office for a project, removes its instance file, and is a no-op afterwards", async () => {
    const office = run(["open", "--project", proj, "--no-browser"]);
    const url = (await office.line("AgenticView: ")).slice("AgenticView: ".length).trim().split("/#")[0]!;
    const closer = run(["close", "--project", proj]);
    expect((await closer.exit).code).toBe(0);
    expect(closer.out()).toContain(`AgenticView: closed ${proj}`);
    expect((await office.exit).code).toBe(0);
    await expect(fetch(`${url}/healthz`)).rejects.toThrow();
    expect(await readdir(join(home, "instances"))).toEqual([]);
    const again = run(["close", "--project", proj]);
    expect((await again.exit).code).toBe(0);
    expect(again.out()).toContain("no office is running");
  }, 30000);

  it("close --all without --yes prints what would be closed and exits without closing", async () => {
    const a = run(["open", "--project", proj, "--no-browser"]);
    await a.line("AgenticView: ");
    const dry = run(["close", "--all"]);
    expect((await dry.exit).code).toBe(1);
    expect(dry.out()).toContain("--all will close:");
    expect(dry.out()).toContain(proj);
    expect(dry.out()).toContain("--yes");
    // Office is still running.
    const still = run(["open", "--project", proj, "--no-browser"]);
    await still.line("AgenticView: ");
    expect((await still.exit).code).toBe(0);
    a.child.kill();
    await a.exit;
  }, 30000);

  it("close --all --yes stops every running office and tidies stale instance files", async () => {
    const a = run(["open", "--project", proj, "--no-browser"]);
    const h = run(["hub", "--no-browser"]);
    await a.line("AgenticView: ");
    await h.line("AgenticView: ");
    // A stale record from a crashed office (dead pid) is removed silently.
    await writeFile(join(home, "instances", "stale.json"), JSON.stringify({ pid: 2 ** 30, url: "http://127.0.0.1:1", token: "x", projectPath: "/gone", startedAt: "" }));
    const closer = run(["close", "--all", "--yes"]);
    expect((await closer.exit).code).toBe(0);
    expect(closer.out()).toContain("closed hub");
    expect(closer.out()).toContain(`closed ${proj}`);
    expect(closer.out()).not.toContain("/gone");
    await Promise.all([a.exit, h.exit]);
    expect(await readdir(join(home, "instances"))).toEqual([]);
  }, 30000);

  it("close without --all only closes the office for the current folder, leaving other offices running", async () => {
    // Start a project office and the hub concurrently.
    const project = run(["open", "--project", proj, "--no-browser"]);
    const hub = run(["hub", "--no-browser"]);
    const projUrl = (await project.line("AgenticView: ")).slice("AgenticView: ".length).trim().split("/#")[0]!;
    const hubUrl = (await hub.line("AgenticView: ")).slice("AgenticView: ".length).trim().split("/#")[0]!;

    // close with cwd=proj (no --all, no --hub) must only close the project office.
    const closer = run(["close"], undefined, proj);
    expect((await closer.exit).code).toBe(0);
    expect(closer.out()).toContain(`AgenticView: closed ${proj}`);

    // Project office is gone.
    await project.exit;
    await expect(fetch(`${projUrl}/healthz`)).rejects.toThrow();

    // Hub is still alive.
    expect((await fetch(`${hubUrl}/healthz`)).status).toBe(200);

    // Clean up.
    hub.child.kill();
    await hub.exit;
  }, 30000);

  it("rejects /api/shutdown without the token", async () => {
    const office = run(["open", "--project", proj, "--no-browser"]);
    const url = (await office.line("AgenticView: ")).slice("AgenticView: ".length).trim().split("/#")[0]!;
    expect((await fetch(`${url}/api/shutdown`, { method: "POST" })).status).toBe(401);
    expect((await fetch(`${url}/healthz`)).status).toBe(200);
  }, 30000);

  it("hook exits 0 quickly when no server is listening", async () => {
    const h = run(["hook"], JSON.stringify({ hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: "a.ts" }, cwd: proj }));
    const r = await h.exit;
    expect(r.code).toBe(0);
    expect(r.ms).toBeLessThan(1500);
    const stale = run(["hook"], "not json");
    expect((await stale.exit).code).toBe(0);
  });

  it("hook mirrors an event into a live server matched by cwd", async () => {
    const fake = new FakeRuntime(async function* () { yield { type: "text", text: "x" }; });
    inProc = await createServer({ world: { kind: "project", projectPath: proj }, token: "tok", runtimes: new Map([["claude", fake]]) });
    await mkdir(join(home, "instances"), { recursive: true });
    await writeFile(join(home, "instances", "manual.json"), JSON.stringify({ pid: process.pid, url: inProc.url, token: "tok", projectPath: proj, startedAt: "" }));
    const ws = new WebSocket(`${inProc.url.replace("http", "ws")}/ws?token=tok`);
    const msgs: any[] = [];
    ws.on("message", (d) => msgs.push(JSON.parse(String(d))));
    await new Promise((r) => ws.on("open", r));
    const h = run(["hook"], JSON.stringify({ hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: "src/a.ts" }, cwd: proj }));
    expect((await h.exit).code).toBe(0);
    await new Promise((r) => setTimeout(r, 200));
    const m = msgs.find((x) => x.type === "mirror.event");
    expect(m?.event).toMatchObject({ kind: "PostToolUse", text: "Edit src/a.ts" });
    const h2 = run(["hook"], JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "make it blue", cwd: proj }));
    await h2.exit;
    await new Promise((r) => setTimeout(r, 200));
    expect(msgs.some((x) => x.type === "mirror.event" && x.event.text === "You: make it blue")).toBe(true);
    ws.close();
  });

  it("record-plugin-root writes the plugin root file and --help prints usage", async () => {
    const r = run(["record-plugin-root", "C:/some where/plugin"]);
    expect((await r.exit).code).toBe(0);
    expect(await readFile(join(home, "plugin-root"), "utf8")).toBe("C:/some where/plugin");
    const h = run(["--help"]);
    expect((await h.exit).code).toBe(0);
    expect(h.out()).toMatch(/open --project/);
    const bad = run(["bogus"]);
    expect((await bad.exit).code).toBe(1);
  });
});

describe("cli demo mode", () => {
  it("AGENTICVIEW_FAKE=1 answers chats with an echo and reports all providers ok", async () => {
    const started = Date.now();
    const child = spawn(process.execPath, [cli, "open", "--project", proj, "--no-browser"], { env: { ...process.env, AGENTICVIEW_HOME: home, AGENTICVIEW_FAKE: "1" }, stdio: ["ignore", "pipe", "pipe"] });
    children.push(child);
    let out = "";
    child.stdout.on("data", (d) => (out += String(d)));
    while (!out.includes("AgenticView: ") && Date.now() - started < 15000) await new Promise((r) => setTimeout(r, 30));
    const full = out.split(/\r?\n/).find((l) => l.startsWith("AgenticView: "))!.slice("AgenticView: ".length).trim();
    const [url, token] = full.split("/#token=") as [string, string];
    const ws = new WebSocket(`${url.replace("http", "ws")}/ws?token=${token}`);
    const msgs: any[] = [];
    ws.on("message", (d) => msgs.push(JSON.parse(String(d))));
    await new Promise((r) => ws.on("open", r));
    while (!msgs.some((m) => m.type === "snapshot")) await new Promise((r) => setTimeout(r, 20));
    const snap = msgs.find((m) => m.type === "snapshot");
    expect(snap.providers.every((p: any) => p.ok)).toBe(true);
    const managerId = snap.agents.find((a: any) => a.role === "manager").id;
    ws.send(JSON.stringify({ type: "chat.send", agentId: managerId, text: "build a login page" }));
    const t0 = Date.now();
    while (!msgs.some((m) => m.type === "task.updated" && m.task.status === "done") && Date.now() - t0 < 10000) await new Promise((r) => setTimeout(r, 30));
    const done = msgs.find((m) => m.type === "task.updated" && m.task.status === "done");
    expect(done.task.result).toContain('received "build a login page"');
    expect(done.task.result).toContain("Atlas (demo mode)");
    ws.close();
  }, 30000);
});
