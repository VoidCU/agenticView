import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

/** Global state root: `$AGENTICVIEW_HOME` or `~/.agenticview`. */
export function globalRoot(): string {
  return process.env.AGENTICVIEW_HOME ?? join(homedir(), ".agenticview");
}

/** Project state root: `<projectPath>/.agenticview`. */
export function projectRoot(projectPath: string): string {
  return join(projectPath, ".agenticview");
}

const IGNORED = ["events.log", "sessions/", "uploads/", "tasks/", "worker-sessions.json"];

/**
 * Keeps `<project>/.agenticview/.gitignore` ignoring logs and machine-local state while agent definitions stay
 * committable. Creates it once, and appends entries added in later versions to a file an older version wrote
 * (the user's own lines are left alone).
 */
export async function ensureProjectGitignore(projectPath: string): Promise<void> {
  const root = projectRoot(projectPath);
  await mkdir(root, { recursive: true });
  const file = join(root, ".gitignore");
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    await writeFile(file, IGNORED.join("\n") + "\n", "utf8");
    return;
  }
  const have = new Set(text.split(/\r?\n/).map((l) => l.trim()));
  const missing = IGNORED.filter((e) => !have.has(e));
  if (missing.length === 0) return;
  await writeFile(file, (text.length && !text.endsWith("\n") ? text + "\n" : text) + missing.join("\n") + "\n", "utf8");
}
