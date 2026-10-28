import { z } from "zod";
import { type MailAccount } from "@agenticview/shared";
declare const ClientSchema: z.ZodObject<{
    clientId: z.ZodString;
    clientSecret: z.ZodString;
}, z.core.$strip>;
export type GoogleClient = z.infer<typeof ClientSchema>;
/**
 * Global Gmail state under `~/.agenticview/mail/`: the user's own Google OAuth client
 * (`google-client.json`) and one file per connected account (`accounts/<id>.json`), all written 0o600.
 */
export declare class MailAccounts {
    private readonly dir;
    private readonly clientFile;
    private readonly accountsDir;
    /** Serializes mutations so two saves of one email cannot mint two ids. */
    private lock;
    constructor(dir?: string);
    private exclusive;
    private ensureDirs;
    private accountFile;
    getClient(): Promise<GoogleClient | undefined>;
    setClient(c: GoogleClient | null): Promise<void>;
    private readStored;
    private listStored;
    /** Public shape only: never includes tokens. */
    list(): Promise<MailAccount[]>;
    getSecret(id: string): Promise<{
        refreshToken: string;
    } | undefined>;
    /** Adds an account, or (same email, case-insensitive) replaces its token and clears needsReconnect, keeping the id. */
    save(a: {
        email: string;
        refreshToken: string;
    }): Promise<MailAccount>;
    markNeedsReconnect(id: string, value: boolean): Promise<void>;
    remove(id: string): Promise<boolean>;
}
export {};
