/** Where running offices are recorded: `$AGENTICVIEW_HOME` or `~/.agenticview` (USERPROFILE / HOME). */
export declare function instancesRoot(): string;
export interface Instance {
    pid: number;
    url: string;
    token: string;
    projectPath: string | null;
    startedAt: string;
}
/** The instance file for a project (keyed by its lower-cased absolute path) or the hub. */
export declare function instanceFile(projectPath: string | null): string;
/** The office running for this project (or the hub), if its instance file exists and it answers /healthz. */
export declare function liveInstance(projectPath: string | null): Promise<Instance | undefined>;
