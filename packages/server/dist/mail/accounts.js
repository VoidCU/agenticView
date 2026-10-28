import { mkdir, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { MailAccountSchema, newId } from "@agenticview/shared";
import { globalRoot } from "../store/paths.js";
import { readJsonFile, writeJsonFile } from "../store/jsonStore.js";
/** Secrets on disk are owner-only. */
const SECRET_MODE = 0o600;
const ClientSchema = z.object({ clientId: z.string().min(1), clientSecret: z.string().min(1) });
/** On-disk account record: the public shape plus the refresh token (never returned by list()). */
const StoredAccountSchema = MailAccountSchema.extend({ refreshToken: z.string().min(1) });
/** Account ids are `newId("ma")`; anything else (e.g. a path) is rejected before touching the disk. */
const ACCOUNT_ID = /^ma_[0-9a-f]{8}$/;
function isENOENT(e) {
    return e?.code === "ENOENT";
}
function publicShape(a) {
    const out = { id: a.id, email: a.email, connectedAt: a.connectedAt };
    if (a.needsReconnect)
        out.needsReconnect = true;
    return out;
}
/**
 * Global Gmail state under `~/.agenticview/mail/`: the user's own Google OAuth client
 * (`google-client.json`) and one file per connected account (`accounts/<id>.json`), all written 0o600.
 */
export class MailAccounts {
    dir;
    clientFile;
    accountsDir;
    /** Serializes mutations so two saves of one email cannot mint two ids. */
    lock = Promise.resolve();
    constructor(dir = join(globalRoot(), "mail")) {
        this.dir = dir;
        this.clientFile = join(dir, "google-client.json");
        this.accountsDir = join(dir, "accounts");
    }
    exclusive(fn) {
        const run = this.lock.then(fn, fn);
        this.lock = run.catch(() => undefined);
        return run;
    }
    async ensureDirs() {
        await mkdir(this.accountsDir, { recursive: true, mode: 0o700 });
    }
    accountFile(id) {
        return ACCOUNT_ID.test(id) ? join(this.accountsDir, `${id}.json`) : undefined;
    }
    async getClient() {
        const c = await readJsonFile(this.clientFile, ClientSchema.optional(), undefined).catch(() => undefined);
        return c ? { clientId: c.clientId, clientSecret: c.clientSecret } : undefined;
    }
    async setClient(c) {
        await this.exclusive(async () => {
            if (c === null) {
                await unlink(this.clientFile).catch((e) => {
                    if (!isENOENT(e))
                        throw e;
                });
                return;
            }
            const v = ClientSchema.parse({ clientId: c.clientId.trim(), clientSecret: c.clientSecret.trim() });
            await this.ensureDirs();
            await writeJsonFile(this.clientFile, v, { mode: SECRET_MODE });
        });
    }
    async readStored(id) {
        const file = this.accountFile(id);
        if (!file)
            return undefined;
        try {
            return await readJsonFile(file, StoredAccountSchema.optional(), undefined);
        }
        catch {
            return undefined; // corrupt record: treat as absent
        }
    }
    async listStored() {
        let names;
        try {
            names = await readdir(this.accountsDir);
        }
        catch (e) {
            if (isENOENT(e))
                return [];
            throw e;
        }
        const out = [];
        for (const n of names) {
            if (!n.endsWith(".json"))
                continue;
            const a = await this.readStored(n.slice(0, -5));
            if (a)
                out.push(a);
        }
        return out.sort((x, y) => x.connectedAt.localeCompare(y.connectedAt));
    }
    /** Public shape only: never includes tokens. */
    async list() {
        return (await this.listStored()).map(publicShape);
    }
    async getSecret(id) {
        const a = await this.readStored(id);
        return a ? { refreshToken: a.refreshToken } : undefined;
    }
    /** Adds an account, or (same email, case-insensitive) replaces its token and clears needsReconnect, keeping the id. */
    async save(a) {
        return this.exclusive(async () => {
            const email = a.email.trim();
            const existing = (await this.listStored()).find((x) => x.email.toLowerCase() === email.toLowerCase());
            const rec = StoredAccountSchema.parse({
                id: existing?.id ?? newId("ma"),
                email,
                connectedAt: new Date().toISOString(),
                refreshToken: a.refreshToken,
            });
            await this.ensureDirs();
            await writeJsonFile(this.accountFile(rec.id), rec, { mode: SECRET_MODE });
            return publicShape(rec);
        });
    }
    async markNeedsReconnect(id, value) {
        await this.exclusive(async () => {
            const a = await this.readStored(id);
            if (!a)
                return;
            const next = { ...a };
            if (value)
                next.needsReconnect = true;
            else
                delete next.needsReconnect;
            await writeJsonFile(this.accountFile(id), next, { mode: SECRET_MODE });
        });
    }
    async remove(id) {
        return this.exclusive(async () => {
            const file = this.accountFile(id);
            if (!file)
                return false;
            try {
                await unlink(file);
                return true;
            }
            catch (e) {
                if (isENOENT(e))
                    return false;
                throw e;
            }
        });
    }
}
//# sourceMappingURL=accounts.js.map