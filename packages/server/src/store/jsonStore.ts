import { mkdir, readFile, writeFile, rename, readdir, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ZodType } from "zod";

function code(e: unknown): string | undefined {
  return (e as NodeJS.ErrnoException)?.code;
}

function isENOENT(e: unknown): boolean {
  return code(e) === "ENOENT";
}

/** Windows reports these when a rename target is momentarily held open by a reader. */
const TRANSIENT = new Set(["EPERM", "EBUSY", "EACCES"]);
const MAX_ATTEMPTS = 30;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function renameWithRetry(tmp: string, file: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(tmp, file);
      return;
    } catch (e) {
      if (!TRANSIENT.has(code(e) ?? "") || attempt >= MAX_ATTEMPTS - 1) throw e;
      await sleep(Math.min(5 * 2 ** Math.min(attempt, 5), 200));
    }
  }
}

/** One write chain per path: later writes wait for earlier ones, so "last write wins" holds. */
const inflight = new Map<string, Promise<void>>();

/** Wait for any in-flight write to `file`, so a read never lands inside the rename window. */
async function settled(file: string): Promise<void> {
  const p = inflight.get(file);
  if (p) await p;
}

/** Atomic JSON write: temp file in the same directory, then rename over the target. Serialized per path. */
export function writeJsonFile(file: string, value: unknown): Promise<void> {
  const prev = inflight.get(file) ?? Promise.resolve();
  const work = prev.then(async () => {
    await mkdir(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
    try {
      await writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
      await renameWithRetry(tmp, file);
    } catch (e) {
      await unlink(tmp).catch(() => undefined);
      throw e;
    }
  });
  const chain = work.then(
    () => undefined,
    () => undefined,
  );
  inflight.set(file, chain);
  void chain.then(() => {
    if (inflight.get(file) === chain) inflight.delete(file);
  });
  return work;
}

export async function readJsonFile<T>(file: string, schema: ZodType<T>, fallback: T): Promise<T> {
  await settled(file);
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
    const file = this.file(id);
    await settled(file);
    try {
      return this.schema.parse(JSON.parse(await readFile(file, "utf8")));
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
    const file = this.file(id);
    await settled(file);
    try {
      await unlink(file);
      return true;
    } catch (e) {
      if (isENOENT(e)) return false;
      throw e;
    }
  }
}
