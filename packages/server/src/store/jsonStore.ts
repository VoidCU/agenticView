import { mkdir, readFile, writeFile, rename, readdir, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ZodType } from "zod";

function isENOENT(e: unknown): boolean {
  return (e as NodeJS.ErrnoException)?.code === "ENOENT";
}

/** Atomic JSON write: write to a temp file in the same directory, then rename over the target. */
export async function writeJsonFile(file: string, value: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
    await rename(tmp, file);
  } catch (e) {
    await unlink(tmp).catch(() => undefined);
    throw e;
  }
}

export async function readJsonFile<T>(file: string, schema: ZodType<T>, fallback: T): Promise<T> {
  try {
    return schema.parse(JSON.parse(await readFile(file, "utf8")));
  } catch (e) {
    if (isENOENT(e)) return fallback;
    throw e;
  }
}

/** One JSON file per record (`<dir>/<id>.json`), validated with a zod schema on every read and write. */
export class JsonStore<T extends { id: string }> {
  constructor(
    private readonly dir: string,
    private readonly schema: ZodType<T>,
  ) {}

  private file(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  async read(id: string): Promise<T | undefined> {
    try {
      return this.schema.parse(JSON.parse(await readFile(this.file(id), "utf8")));
    } catch (e) {
      if (isENOENT(e)) return undefined;
      throw e;
    }
  }

  async write(id: string, value: T): Promise<void> {
    await writeJsonFile(this.file(id), this.schema.parse(value));
  }

  async list(): Promise<T[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch (e) {
      if (isENOENT(e)) return [];
      throw e;
    }
    const out: T[] = [];
    for (const n of names) {
      if (!n.endsWith(".json")) continue;
      const v = await this.read(n.slice(0, -5));
      if (v) out.push(v);
    }
    return out;
  }

  async delete(id: string): Promise<boolean> {
    try {
      await unlink(this.file(id));
      return true;
    } catch (e) {
      if (isENOENT(e)) return false;
      throw e;
    }
  }
}
