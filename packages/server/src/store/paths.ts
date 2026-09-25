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

/** Lines AgenticView keeps in the project's own `.gitignore`. */
export const PROJECT_GITIGNORE_LINES = [".agenticview/", ".claude/agents/agenticview-*.md"] as const;
export const PROJECT_GITIGNORE_COMMENT = "# AgenticView";

/** Canonical form of a gitignore pattern for "is it already there" checks (`/.agenticview` == `.agenticview/`). */
function canon(line: string): string {
  return line.trim().replace(/^\/+/, "").replace(/\/+$/, "");
}

/**
 * Makes sure `<project>/.gitignore` ignores the office state (`.agenticview/`) and the generated
 * subagent files (`.claude/agents/agenticview-*.md`). Creates the file when missing, appends only the
 * missing lines under a `# AgenticView` comment, keeps every user line and the file's line endings,
 * and never duplicates anything. Once that comment exists the block is the user's: removed lines stay removed. Returns the lines it added.
 */
export async function ensureRootGitignore(projectPath: string): Promise<string[]> {
  const file = join(projectPath, ".gitignore");
  let text = "";
  try {
    text = await readFile(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  // Our block is written once. After that the user owns it: a line they removed (for example to commit
  // their agents) stays removed.
  if (lines.some((l) => l.trim() === PROJECT_GITIGNORE_COMMENT)) return [];
  const have = new Set(lines.map(canon));
  const missing = PROJECT_GITIGNORE_LINES.filter((l) => !have.has(canon(l)));
  if (missing.length === 0) return [];
  const block = [PROJECT_GITIGNORE_COMMENT, ...missing];
  let prefix = text;
  if (prefix.length && !prefix.endsWith("\n")) prefix += eol;
  // A blank line between the user's entries and ours, unless the file is empty or already ends with one.
  if (prefix.length && !/(\r?\n){2}$/.test(prefix)) prefix += eol;
  await writeFile(file, prefix + block.join(eol) + eol, "utf8");
  return missing;
}

/**
 * Keeps `<project>/.agenticview/.gitignore` ignoring logs and machine-local state (harmless now that the
 * whole folder is ignored from the project's `.gitignore`, but it still protects users who remove that
 * line to commit their agents). Creates it once, and appends entries added in later versions to a file
 * an older version wrote (the user's own lines are left alone). Also updates the project `.gitignore`.
 */
export async function ensureProjectGitignore(projectPath: string): Promise<void> {
  const root = projectRoot(projectPath);
  await mkdir(root, { recursive: true });
  await ensureRootGitignore(projectPath).catch((e) => console.error("[agenticview] updating .gitignore failed", e));
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
