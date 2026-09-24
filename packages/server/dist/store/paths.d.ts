/** Global state root: `$AGENTICVIEW_HOME` or `~/.agenticview`. */
export declare function globalRoot(): string;
/** Project state root: `<projectPath>/.agenticview`. */
export declare function projectRoot(projectPath: string): string;
/** Creates `<project>/.agenticview/.gitignore` once so agent definitions stay committable while logs do not. */
export declare function ensureProjectGitignore(projectPath: string): Promise<void>;
