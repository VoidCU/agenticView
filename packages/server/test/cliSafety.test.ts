import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { spawn, execSync, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../../..");
const cli = join(repoRoot, "packages/server/dist/cli.js");
let home: string;
let proj: string;
const children: ChildProcess[] = [];
const savedHome = process.env.AGENTICVIEW_HOME;

beforeAll(() => {
  execSync("npx tsc -b packages/server", { cwd: repoRoot, stdio: "inherit" });
}, 120000);
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "av-cli-safe-home-"));
  proj = await mkdtemp(join(tmpdir(), "av-cli-safe-proj-"));
  process.env.AGENTICVIEW_HOME = home;
});
afterEach(async () => {
  for (const c of children.splice(0)) c.kill();
  process.env.AGENTICVIEW_HOME = savedHome;
  await new Promise((r) => setTimeout(r, 100));
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  await rm(proj, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function run(args: string[]) {
  const child = spawn(process.execPath, [cli, ...args], { env: { ...process.env, AGENTICVIEW_HOME: home }, stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  let out = "";
  let err = "";
  child.stdout.on("data", (d) => (out += String(d)));
  child.stderr.on("data", (d) => (err += String(d)));
  const exit = new Promise<number | null>((res) => child.on("exit", (code) => res(code)));
  const line = (prefix: string, ms = 15000) =>
    new Promise<string>((res, rej) => {
      const t0 = Date.now();
      const i = setInterval(() => {
        const l = out.split(/\r?\n/).find((x) => x.startsWith(prefix));
        if (l) { clearInterval(i); res(l); }
        else if (Date.now() - t0 > ms) { clearInterval(i); rej(new Error(`no line '${prefix}': ${out}\n${err}`)); }
      }, 20);
    });
  return { exit, line, err: () => err };
}

describe("cli safety", () => {
  it("refuses to open a project path that does not exist", async () => {
    const r = run(["open", "--project", join(proj, "missing-dir"), "--no-browser"]);
    expect(await r.exit).toBe(1);
    expect(r.err()).toMatch(/not a directory|does not exist/i);
    await expect(readdir(join(home, "instances"))).rejects.toThrow();
  });

  it("writes the instance file readable by the owner only", async () => {
    const first = run(["open", "--project", proj, "--no-browser"]);
    await first.line("AgenticView: ");
    const files = await readdir(join(home, "instances"));
    const s = await stat(join(home, "instances", files[0]!));
    if (process.platform !== "win32") expect(s.mode & 0o777).toBe(0o600);
    else expect(s.isFile()).toBe(true);
  }, 30000);
});
