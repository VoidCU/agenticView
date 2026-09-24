import { describe, it, expect } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../../src/server.js";
import { ClaudeRuntime } from "../../src/runtimes/claude.js";

const live = process.env.AGENTICVIEW_LIVE === "1";

describe.skipIf(!live)("live: claude worker", () => {
  it("creates a file in a temp project when asked", async () => {
    const home = await mkdtemp(join(tmpdir(), "av-live-home-"));
    const proj = await mkdtemp(join(tmpdir(), "av-live-proj-"));
    process.env.AGENTICVIEW_HOME = home;
    const server = await createServer({ world: { kind: "project", projectPath: proj }, token: "tok", runtimes: new Map([["claude", new ClaudeRuntime()]]) });
    try {
      const worker = await server.world.registry.create({ name: "Live", specialty: "files", permissionMode: "auto" });
      const task = await server.orchestrator.handleUserMessage({ agentId: worker.id, text: "Create a file named hello.txt in the current directory containing exactly the text: hi" });
      const done = await server.orchestrator.awaitTask(task.id);
      expect(done.status).toBe("done");
      expect((await readFile(join(proj, "hello.txt"), "utf8")).trim()).toBe("hi");
    } finally {
      await server.close();
      await rm(home, { recursive: true, force: true });
      await rm(proj, { recursive: true, force: true });
    }
  }, 300_000);
});
