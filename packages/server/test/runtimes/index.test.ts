import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, access, chmod, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, delimiter } from "node:path";
import { createRuntimes } from "../../src/runtimes/index.js";
import { which } from "../../src/runtimes/which.js";

let home: string;
const savedHome = process.env.AGENTICVIEW_HOME;
const savedPath = process.env.PATH;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "av-rt-"));
  process.env.AGENTICVIEW_HOME = home;
});
afterEach(async () => {
  process.env.AGENTICVIEW_HOME = savedHome;
  process.env.PATH = savedPath;
  await rm(home, { recursive: true, force: true });
});

describe("createRuntimes", () => {
  it("registers all three providers and caches check results", async () => {
    let calls = 0;
    const map = await createRuntimes({ bridgeUrl: () => "http://127.0.0.1:1", which: async () => { calls++; return undefined; } });
    expect([...map.keys()].sort()).toEqual(["claude", "claude-session", "codex", "gemini"]);
    const codex = map.get("codex")!;
    const a = await codex.check();
    const b = await codex.check();
    expect(a.ok).toBe(false);
    expect(b).toEqual(a);
    expect(calls).toBe(1);
    await map.get("gemini")!.check();
    expect(calls).toBe(2);
  });
});

describe("which", () => {
  it("finds an executable on PATH honouring PATHEXT on windows", async () => {
    const bin = join(home, "bin");
    await (await import("node:fs/promises")).mkdir(bin, { recursive: true });
    const name = process.platform === "win32" ? "fakecli.cmd" : "fakecli";
    await writeFile(join(bin, name), process.platform === "win32" ? "@echo off\r\n" : "#!/bin/sh\n");
    if (process.platform !== "win32") await chmod(join(bin, name), 0o755);
    process.env.PATH = `${bin}${delimiter}${savedPath ?? ""}`;
    const found = await which("fakecli");
    expect(found).toBeDefined();
    await access(found!);
    expect(await which("definitely-not-a-real-cli-xyz")).toBeUndefined();
  });
});
