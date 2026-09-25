import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

/** Where running offices are recorded: `$AGENTICVIEW_HOME` or `~/.agenticview` (USERPROFILE / HOME). */
export function instancesRoot(): string {
  return process.env.AGENTICVIEW_HOME ?? join(process.env.USERPROFILE ?? process.env.HOME ?? ".", ".agenticview");
}

export interface Instance {
  pid: number;
  url: string;
  token: string;
  projectPath: string | null;
  startedAt: string;
}

/** The instance file for a project (keyed by its lower-cased absolute path) or the hub. */
export function instanceFile(projectPath: string | null): string {
  const key = projectPath ? createHash("sha1").update(resolve(projectPath).toLowerCase()).digest("hex").slice(0, 16) : "hub";
  return join(instancesRoot(), "instances", `${key}.json`);
}

/** The office running for this project (or the hub), if its instance file exists and it answers /healthz. */
export async function liveInstance(projectPath: string | null): Promise<Instance | undefined> {
  try {
    const inst = JSON.parse(await readFile(instanceFile(projectPath), "utf8")) as Instance;
    const res = await fetch(`${inst.url}/healthz`, { signal: AbortSignal.timeout(700) });
    return res.ok ? inst : undefined;
  } catch {
    return undefined;
  }
}
