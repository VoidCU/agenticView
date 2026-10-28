import type { ZodType } from "zod";
/**
 * Atomic JSON write: temp file in the same directory, then rename over the target. Serialized per path.
 * `opts.mode` (e.g. `0o600` for secrets) is set on the temp file before the rename, so the target never
 * exists with a wider mode. Ignored by Windows.
 */
export declare function writeJsonFile(file: string, value: unknown, opts?: {
    mode?: number;
}): Promise<void>;
export declare function readJsonFile<T>(file: string, schema: ZodType<T>, fallback: T): Promise<T>;
/** One JSON file per record (`<dir>/<id>.json`), validated with a zod schema on every read and write. */
export declare class JsonStore<T extends {
    id: string;
}> {
    private readonly dir;
    private readonly schema;
    constructor(dir: string, schema: ZodType<T>);
    private file;
    read(id: string): Promise<T | undefined>;
    write(id: string, value: T): Promise<void>;
    list(): Promise<T[]>;
    delete(id: string): Promise<boolean>;
}
