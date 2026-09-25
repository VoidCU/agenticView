import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, writeFile, access } from "node:fs/promises";
/** Global state root: `$AGENTICVIEW_HOME` or `~/.agenticview`. */
export function globalRoot() {
    return process.env.AGENTICVIEW_HOME ?? join(homedir(), ".agenticview");
}
/** Project state root: `<projectPath>/.agenticview`. */
export function projectRoot(projectPath) {
    return join(projectPath, ".agenticview");
}
const GITIGNORE = "events.log\nsessions/\nuploads/\ntasks/\nworker-sessions.json\n";
/** Creates `<project>/.agenticview/.gitignore` once so agent definitions stay committable while logs do not. */
export async function ensureProjectGitignore(projectPath) {
    const root = projectRoot(projectPath);
    await mkdir(root, { recursive: true });
    const file = join(root, ".gitignore");
    try {
        await access(file);
    }
    catch {
        await writeFile(file, GITIGNORE, "utf8");
    }
}
//# sourceMappingURL=paths.js.map