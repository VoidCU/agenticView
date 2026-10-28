import { create } from "zustand";
import type { MailAccount, MailAmount, MailSender, MailSource, MailTag, MailThread, Task } from "@agenticview/shared";
import { apiFetch } from "../net/ws";

export interface MailStatus {
  clientConfigured: boolean;
  accounts: MailAccount[];
}

export interface ThreadFilter {
  accountId?: string;
  sender?: string;
  tag?: string;
  label?: string;
  notSent?: boolean;
}

export type MailWhat = "accounts" | "threads" | "tags" | "sources";

export class MailApiError extends Error {
  constructor(message: string, readonly status: number, readonly needsReconnect = false, readonly accountId?: string) {
    super(message);
  }
}

async function call<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const req: RequestInit = { method: init?.method ?? "GET" };
  if (init && "body" in init) {
    req.headers = { "content-type": "application/json" };
    req.body = JSON.stringify(init.body);
  }
  const res = await apiFetch(path, req);
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const msg = typeof data.error === "string" ? data.error : `Mail request failed (${res.status})`;
    const needsReconnect = data.needsReconnect === true;
    // A revoked account: re-read the accounts so the Reconnect chip shows immediately.
    if (needsReconnect) void useMail.getState().refresh("accounts");
    throw new MailApiError(msg, res.status, needsReconnect, typeof data.accountId === "string" ? data.accountId : undefined);
  }
  return data as T;
}

function query(filter: ThreadFilter): string {
  const p = new URLSearchParams();
  if (filter.accountId) p.set("accountId", filter.accountId);
  if (filter.sender) p.set("sender", filter.sender);
  if (filter.tag) p.set("tag", filter.tag);
  if (filter.label) p.set("label", filter.label);
  if (filter.notSent) p.set("notSent", "1");
  const s = p.toString();
  return s ? `?${s}` : "";
}

const enc = encodeURIComponent;

export interface SourceInput {
  id?: string;
  accountId: string;
  senders: string[];
  amount: MailAmount;
  autoCheck?: boolean;
}

export interface TagInput {
  id?: string;
  name: string;
  color: string;
  meaning?: string;
  preferredAgentId?: string;
  writeToGmail?: boolean;
}

interface MailState {
  status: MailStatus | undefined;
  sources: MailSource[];
  threads: MailThread[];
  tags: MailTag[];
  threadFilter: ThreadFilter;
  refresh(what?: MailWhat): Promise<void>;
  setClient(creds: { clientId: string; clientSecret: string } | null): Promise<void>;
  connect(): Promise<void>;
  disconnect(id: string): Promise<void>;
  senders(accountId: string): Promise<MailSender[]>;
  saveSource(input: SourceInput): Promise<MailSource>;
  removeSource(id: string): Promise<void>;
  pull(id: string): Promise<unknown>;
  loadThreads(filter?: ThreadFilter): Promise<void>;
  setTags(threadKey: string, tagIds: string[]): Promise<MailThread>;
  saveTag(input: TagInput): Promise<MailTag>;
  removeTag(id: string): Promise<void>;
  sendToAtlas(threadKeys: string[], note?: string): Promise<Task>;
  editDraft(threadKey: string, draftId: string, body: string): Promise<unknown>;
  discardDraft(threadKey: string, draftId: string): Promise<void>;
  saveDraftToGmail(threadKey: string, draftId: string): Promise<unknown>;
  sendDraft(threadKey: string, draftId: string): Promise<unknown>;
}

export const useMail = create<MailState>((set, get) => ({
  status: undefined,
  sources: [],
  threads: [],
  tags: [],
  threadFilter: {},

  async refresh(what) {
    const all = what === undefined;
    const jobs: Promise<void>[] = [];
    if (all || what === "accounts") jobs.push(call<MailStatus>("/api/mail/status").then((status) => set({ status })));
    if (all || what === "sources") jobs.push(call<MailSource[]>("/api/mail/sources").then((sources) => set({ sources })));
    if (all || what === "tags") jobs.push(call<MailTag[]>("/api/mail/tags").then((tags) => set({ tags })));
    if (all || what === "threads") jobs.push(get().loadThreads());
    await Promise.all(jobs.map((j) => j.catch(() => undefined)));
  },

  async setClient(creds) {
    await call("/api/mail/client", { method: "PUT", body: creds });
    await get().refresh("accounts");
  },

  async connect() {
    const { authUrl } = await call<{ authUrl: string }>("/api/mail/connect", { method: "POST" });
    window.open(authUrl, "_blank", "noopener");
  },

  async disconnect(id) {
    await call(`/api/mail/accounts/${enc(id)}`, { method: "DELETE" });
    await get().refresh("accounts");
  },

  senders: (accountId) => call<MailSender[]>(`/api/mail/accounts/${enc(accountId)}/senders`),

  async saveSource(input) {
    const s = await call<MailSource>("/api/mail/sources", { method: "POST", body: input });
    await get().refresh("sources");
    return s;
  },

  async removeSource(id) {
    await call(`/api/mail/sources/${enc(id)}`, { method: "DELETE" });
    await get().refresh("sources");
  },

  async pull(id) {
    const r = await call(`/api/mail/sources/${enc(id)}/pull`, { method: "POST" });
    await get().refresh("sources");
    return r;
  },

  async loadThreads(filter) {
    const f = filter ?? get().threadFilter;
    const threads = await call<MailThread[]>(`/api/mail/threads${query(f)}`);
    set({ threads, threadFilter: f });
  },

  async setTags(threadKey, tagIds) {
    const t = await call<MailThread>(`/api/mail/threads/${enc(threadKey)}/tags`, { method: "PUT", body: { tagIds } });
    set((s) => ({ threads: s.threads.map((x) => (x.id === t.id ? t : x)) }));
    return t;
  },

  async saveTag(input) {
    const t = await call<MailTag>("/api/mail/tags", { method: "POST", body: input });
    await get().refresh("tags");
    return t;
  },

  async removeTag(id) {
    await call(`/api/mail/tags/${enc(id)}`, { method: "DELETE" });
    await get().refresh("tags");
  },

  sendToAtlas: (threadKeys, note) => call<Task>("/api/mail/send-to-atlas", { method: "POST", body: { threadKeys, ...(note ? { note } : {}) } }),

  editDraft: (k, d, body) => call(`/api/mail/drafts/${enc(k)}/${enc(d)}`, { method: "PUT", body: { body } }),

  async discardDraft(k, d) {
    await call(`/api/mail/drafts/${enc(k)}/${enc(d)}`, { method: "DELETE" });
  },

  saveDraftToGmail: (k, d) => call(`/api/mail/drafts/${enc(k)}/${enc(d)}/save-gmail`, { method: "POST" }),

  sendDraft: (k, d) => call(`/api/mail/drafts/${enc(k)}/${enc(d)}/send`, { method: "POST", body: { confirm: true } }),
}));
