import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureProjectGitignore, ensureRootGitignore } from "../../src/store/paths.js";

let proj: string;
beforeEach(async () => {
  proj = await mkdtemp(join(tmpdir(), "av-gi-"));
});
afterEach(async () => {
  await rm(proj, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
const gi = () => readFile(join(proj, ".gitignore"), "utf8");

describe("project .gitignore", () => {
  it("creates the file with the AgenticView block when missing", async () => {
    expect(await ensureRootGitignore(proj)).toEqual([".agenticview/", ".claude/agents/agenticview-*.md", ".agents/plugins/agenticview-*"]);
    expect(await gi()).toBe("# AgenticView\n.agenticview/\n.claude/agents/agenticview-*.md\n.agents/plugins/agenticview-*\n");
  });

  it("appends to an existing file, keeps user lines, and is idempotent", async () => {
    await writeFile(join(proj, ".gitignore"), "node_modules\ndist/");
    await ensureRootGitignore(proj);
    const once = await gi();
    expect(once).toBe("node_modules\ndist/\n\n# AgenticView\n.agenticview/\n.claude/agents/agenticview-*.md\n.agents/plugins/agenticview-*\n");
    expect(await ensureRootGitignore(proj)).toEqual([]);
    expect(await gi()).toBe(once);
  });

  it("keeps CRLF line endings", async () => {
    await writeFile(join(proj, ".gitignore"), "node_modules\r\n");
    await ensureRootGitignore(proj);
    expect(await gi()).toBe("node_modules\r\n\r\n# AgenticView\r\n.agenticview/\r\n.claude/agents/agenticview-*.md\r\n.agents/plugins/agenticview-*\r\n");
  });

  it("only adds what is missing, recognising equivalent patterns", async () => {
    await writeFile(join(proj, ".gitignore"), "/.agenticview\n");
    expect(await ensureRootGitignore(proj)).toEqual([".claude/agents/agenticview-*.md", ".agents/plugins/agenticview-*"]);
    expect(await gi()).toBe("/.agenticview\n\n# AgenticView\n.claude/agents/agenticview-*.md\n.agents/plugins/agenticview-*\n");
  });

  it("appends new entries to an older block that already has the comment (version upgrade)", async () => {
    // Simulate a gitignore written by an older version that only had two entries.
    await writeFile(join(proj, ".gitignore"), "# AgenticView\n.agenticview/\n.claude/agents/agenticview-*.md\n");
    const added = await ensureRootGitignore(proj);
    expect(added).toEqual([".agents/plugins/agenticview-*"]);
    expect(await gi()).toBe("# AgenticView\n.agenticview/\n.claude/agents/agenticview-*.md\n.agents/plugins/agenticview-*\n");
    // Idempotent after update.
    expect(await ensureRootGitignore(proj)).toEqual([]);
  });

  it("ensureProjectGitignore writes both the project and the inner .agenticview/.gitignore", async () => {
    await ensureProjectGitignore(proj);
    expect(await gi()).toContain(".agenticview/");
    expect(await readFile(join(proj, ".agenticview", ".gitignore"), "utf8")).toContain("worker-sessions.json");
  });
});
