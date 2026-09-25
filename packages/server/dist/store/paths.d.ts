/** Global state root: `$AGENTICVIEW_HOME` or `~/.agenticview`. */
export declare function globalRoot(): string;
/** Project state root: `<projectPath>/.agenticview`. */
export declare function projectRoot(projectPath: string): string;
/** Lines AgenticView keeps in the project's own `.gitignore`. */
export declare const PROJECT_GITIGNORE_LINES: readonly [".agenticview/", ".claude/agents/agenticview-*.md"];
export declare const PROJECT_GITIGNORE_COMMENT = "# AgenticView";
/**
 * Makes sure `<project>/.gitignore` ignores the office state (`.agenticview/`) and the generated
 * subagent files (`.claude/agents/agenticview-*.md`). Creates the file when missing, appends only the
 * missing lines under a `# AgenticView` comment, keeps every user line and the file's line endings,
 * and never duplicates anything. Once that comment exists the block is the user's: removed lines stay removed. Returns the lines it added.
 */
export declare function ensureRootGitignore(projectPath: string): Promise<string[]>;
/**
 * Keeps `<project>/.agenticview/.gitignore` ignoring logs and machine-local state (harmless now that the
 * whole folder is ignored from the project's `.gitignore`, but it still protects users who remove that
 * line to commit their agents). Creates it once, and appends entries added in later versions to a file
 * an older version wrote (the user's own lines are left alone). Also updates the project `.gitignore`.
 */
export declare function ensureProjectGitignore(projectPath: string): Promise<void>;
