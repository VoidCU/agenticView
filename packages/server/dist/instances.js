import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
/** Where running offices are recorded: `$AGENTICVIEW_HOME` or `~/.agenticview` (USERPROFILE / HOME). */
export function instancesRoot() {
    return process.env.AGENTICVIEW_HOME ?? join(process.env.USERPROFILE ?? process.env.HOME ?? ".", ".agenticview");
}
/** The instance file for a project (keyed by its lower-cased absolute path) or the hub. */
export function instanceFile(projectPath) {
    const key = projectPath ? createHash("sha1").update(resolve(projectPath).toLowerCase()).digest("hex").slice(0, 16) : "hub";
    return join(instancesRoot(), "instances", `${key}.json`);
}
/** The office running for this project (or the hub), if its instance file exists and it answers /healthz. */
export async function liveInstance(projectPath) {
    try {
        const inst = JSON.parse(await readFile(instanceFile(projectPath), "utf8"));
        const res = await fetch(`${inst.url}/healthz`, { signal: AbortSignal.timeout(700) });
        return res.ok ? inst : undefined;
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=instances.js.map