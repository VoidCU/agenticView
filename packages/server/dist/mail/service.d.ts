import { type MailDraft, type MailSender, type MailSource, type MailTag, type MailThread, type Task } from "@agenticview/shared";
import type { MailAccounts } from "./accounts.js";
import type { GmailClient } from "./gmail.js";
import type { MailStore } from "./store.js";
export type MailWhat = "accounts" | "threads" | "tags" | "sources";
/** An error the REST layer turns into `{ error }` with this status. */
export declare class MailHttpError extends Error {
    readonly status: 400 | 404;
    constructor(message: string, status: 400 | 404);
}
export interface MailServiceDeps {
    store: MailStore;
    accounts: MailAccounts;
    gmail: GmailClient;
    emit: (what: MailWhat) => void;
    now?: () => Date;
    /** Drops the account's cached access token (OAuthFlow.forget) when the account is removed. */
    forgetToken?: (accountId: string) => void;
    /** Starts (or joins) the Manager's request for these threads (Orchestrator.handleUserMessage). Resolved at call time. */
    startRequest?: (input: {
        agentId: string;
        text: string;
        mail: {
            threadIds: string[];
        };
    }) => Promise<Task>;
    /** This office's manager agent id, when known. */
    managerId?: () => string | undefined;
    /** An agent's display name, for the tag routing lines. */
    agentName?: (agentId: string) => Promise<string | undefined>;
    /** A request's direct child tasks (to tell whether a worker already drafted its thread). */
    taskChildren?: (taskId: string) => Promise<Task[]>;
}
/** Sent to the Manager with every Send to Atlas request. */
export declare const ATLAS_ROUTING = "For each email thread below, assign one work task with assign_task and pass its threadId. The worker's whole result must be only the reply body. Prefer the tag's preferred agent when it fits.";
/** One office's Gmail work: pull sources, the pulled threads, and tags (optionally mirrored as Gmail labels). */
export declare class MailService {
    private readonly deps;
    private readonly now;
    /** Per-thread mutation chains, so a pull never overwrites tags set meanwhile (and vice versa). */
    private readonly threadLocks;
    /** One pull per source at a time; a second caller shares the first's result. */
    private readonly pulling;
    constructor(deps: MailServiceDeps);
    /** Public status only: never the client secret or any token. */
    status(): Promise<{
        clientConfigured: boolean;
        accounts: Awaited<ReturnType<MailAccounts["list"]>>;
    }>;
    setClient(c: {
        clientId: string;
        clientSecret: string;
    } | null): Promise<void>;
    /** Removes the account, drops its cached token, and deletes this office's sources for it. */
    removeAccount(id: string): Promise<void>;
    /**
     * Runs a Gmail call for the account. A stored `needsReconnect` short-circuits before any Google call;
     * a MailReconnectError (from the refresh) tells clients the account state changed.
     */
    private gmailCall;
    senders(accountId: string): Promise<MailSender[]>;
    buildQuery(source: MailSource, now: Date): {
        q: string;
        max: number;
    };
    listSources(): Promise<MailSource[]>;
    upsertSource(s: Omit<MailSource, "id"> & {
        id?: string;
    }): Promise<MailSource>;
    removeSource(id: string): Promise<void>;
    pull(sourceId: string): Promise<{
        threads: number;
    }>;
    private doPull;
    private withThread;
    listThreads(filter?: {
        accountId?: string;
        sender?: string;
        tag?: string;
        label?: string;
        notSent?: boolean;
    }): Promise<MailThread[]>;
    getThread(key: string): Promise<MailThread | undefined>;
    setThreadTags(key: string, tagIds: string[]): Promise<MailThread>;
    listTags(): Promise<MailTag[]>;
    upsertTag(t: Omit<MailTag, "id"> & {
        id?: string;
    }): Promise<MailTag>;
    /** Deletes the tag and strips it from every thread (Gmail labels already written are left alone). */
    removeTag(id: string): Promise<void>;
    /** This office's manager agent id, when known. */
    managerId(): string | undefined;
    /**
     * Starts the Manager's request for these threads: the user's note, one routing line per used tag, the
     * routing instruction, then each thread fenced as data. Every thread records the request in `sentToAtlas`.
     */
    sendToAtlas(input: {
        threadKeys: string[];
        note?: string;
        managerId: string;
    }): Promise<Task>;
    /** Tasks already turned into drafts (or found to have no thread); a later state event never re-adds one. */
    private readonly draftedTasks;
    /**
     * TaskService state-change hook. A finished mail work task's result becomes a reply draft on its thread;
     * a finished single-thread request's own result does too when none of its work tasks drafted that thread.
     * Idempotent per task id; never throws.
     */
    onTaskChanged(task: Task): Promise<void>;
    private draftFromTask;
    /** Runs `fn` on the thread and draft under the thread lock; unknown keys or draft ids are 404. */
    private withDraft;
    private static replace;
    /** New body; a Gmail copy saved earlier no longer matches, so its id is dropped. Sent drafts are final. */
    editDraft(key: string, draftId: string, body: string): Promise<MailDraft>;
    discardDraft(key: string, draftId: string): Promise<void>;
    /** The draft as a reply MIME (base64url) to the newest message not sent by the account itself. */
    private replyRaw;
    /** Saves the draft as a Gmail draft reply in its thread and records the Gmail draft id. */
    saveDraftToGmail(key: string, draftId: string): Promise<MailDraft>;
    /** Sends the draft as a reply in its thread. Runs under the thread lock, so it can never send twice. */
    sendDraft(key: string, draftId: string): Promise<MailDraft>;
    /** Pulls every `autoCheck` source every 10 minutes (unref'd timer). Returns a stop function. */
    startAutoCheck(): () => void;
}
