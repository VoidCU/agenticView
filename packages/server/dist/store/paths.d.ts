/** Global state root: `$AGENTICVIEW_HOME` or `~/.agenticview`. */
export declare function globalRoot(): string;
/** Project state root: `<projectPath>/.agenticview`. */
export declare function projectRoot(projectPath: string): string;
/**
 * Keeps `<project>/.agenticview/.gitignore` ignoring logs and machine-local state while agent definitions stay
 * committable. Creates it once, and appends entries added in later versions to a file an older version wrote
 * (the user's own lines are left alone).
 */
export declare function ensureProjectGitignore(projectPath: string): Promise<void>;
