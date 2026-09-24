export type Which = (cmd: string) => Promise<string | undefined>;
/** Resolve an executable on PATH. On Windows, tries each PATHEXT suffix when the name has none. */
export declare const which: Which;
