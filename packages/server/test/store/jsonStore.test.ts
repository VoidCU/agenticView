import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { JsonStore, ensureProjectGitignore, projectRoot, globalRoot, readJsonFile, writeJsonFile } from "../../src/store/index.js";

const S = z.object({ id: z.string(), n: z.number() });
let dir: string;
const savedHome = process.env.AGENTICVIEW_HOME;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "av space ü "));
});
afterEach(async () => {
  process.env.AGENTICVIEW_HOME = savedHome;
  await rm(dir, { recursive: true, force: true });
});

describe("JsonStore", () => {
  it("writes, reads, lists, deletes in a path with spaces and unicode", async () => {
    const s = new JsonStore(join(dir, "agents"), S);
    await s.write("a", { id: "a", n: 1 });
    await s.write("b", { id: "b", n: 2 });
    expect(await s.read("a")).toEqual({ id: "a", n: 1 });
    expect((await s.list()).map((x) => x.id).sort()).toEqual(["a", "b"]);
    expect(await s.delete("a")).toBe(true);
    expect(await s.delete("a")).toBe(false);
    expect(await s.read("a")).toBeUndefined();
    expect(await readdir(join(dir, "agents"))).toEqual(["b.json"]);
  });
  it("leaves no temp files and rejects invalid content", async () => {
    const s = new JsonStore(join(dir, "x"), S);
    await s.write("a", { id: "a", n: 1 });
    expect((await readdir(join(dir, "x"))).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    await expect(s.write("bad", { id: "bad" } as never)).rejects.toThrow();
  });
  it("lists an empty result for a missing directory", async () => {
    const s = new JsonStore(join(dir, "missing"), S);
    expect(await s.list()).toEqual([]);
  });
});

describe("json files", () => {
  it("readJsonFile returns fallback when missing and parses otherwise", async () => {
    const file = join(dir, "cfg.json");
    expect(await readJsonFile(file, S, { id: "f", n: 0 })).toEqual({ id: "f", n: 0 });
    await writeJsonFile(file, { id: "x", n: 5 });
    expect(await readJsonFile(file, S, { id: "f", n: 0 })).toEqual({ id: "x", n: 5 });
  });
});

describe("paths", () => {
  it("resolves roots", () => {
    process.env.AGENTICVIEW_HOME = dir;
    expect(globalRoot()).toBe(dir);
    expect(projectRoot("C:/My Proj")).toBe(join("C:/My Proj", ".agenticview"));
  });
  it("creates a gitignore inside .agenticview once", async () => {
    await ensureProjectGitignore(dir);
    await ensureProjectGitignore(dir);
    const gi = await readFile(join(dir, ".agenticview", ".gitignore"), "utf8");
    expect(gi).toBe("events.log\nsessions/\nuploads/\ntasks/\n");
  });
});

describe("writeJsonFile under concurrent readers", () => {
  it("still lands the write when the target is briefly held open (Windows EPERM on rename)", async () => {
    const { open } = await import("node:fs/promises");
    const file = join(dir, "held.json");
    await writeJsonFile(file, { id: "a", n: 1 });
    const handle = await open(file, "r");
    setTimeout(() => void handle.close(), 60);
    await writeJsonFile(file, { id: "a", n: 2 });
    expect(await readJsonFile(file, S, { id: "x", n: 0 })).toEqual({ id: "a", n: 2 });
  });

  it("survives 200 interleaved reads and writes of the same record", async () => {
    const s = new JsonStore(join(dir, "busy"), S);
    await s.write("k", { id: "k", n: 0 });
    const ops: Promise<unknown>[] = [];
    for (let i = 1; i <= 100; i++) {
      ops.push(s.write("k", { id: "k", n: i }));
      ops.push(s.read("k"));
      ops.push(s.list());
    }
    await Promise.all(ops);
    expect((await s.read("k"))!.n).toBe(100);
  });
});
