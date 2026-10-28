import {
  MailSourceSchema,
  MailTagSchema,
  newId,
  type MailSender,
  type MailSource,
  type MailTag,
  type MailThread,
} from "@agenticview/shared";
import type { MailAccounts } from "./accounts.js";
import type { GmailClient } from "./gmail.js";
import { MailReconnectError } from "./oauth.js";
import type { MailStore } from "./store.js";

export type MailWhat = "accounts" | "threads" | "tags" | "sources";

/** An error the REST layer turns into `{ error }` with this status. */
export class MailHttpError extends Error {
  constructor(message: string, readonly status: 400 | 404) {
    super(message);
    this.name = "MailHttpError";
  }
}

const bad = (msg: string) => new MailHttpError(msg, 400);
const notFound = (msg: string) => new MailHttpError(msg, 404);

/** Store keys become file names: anything else (e.g. a path) is treated as unknown. */
const SAFE_KEY = /^[A-Za-z0-9_-]{1,200}$/;
const safe = (key: string) => typeof key === "string" && SAFE_KEY.test(key);

const AUTO_CHECK_MS = 600_000;
/** Threads fetched from Gmail at once during a pull. */
const PULL_CONCURRENCY = 4;
const LABEL_PREFIX = "AgenticView/";

/** "YYYY-MM-DD" as a UTC date, or undefined when it is not a real calendar date. */
function realDate(s: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined;
  const d = new Date(`${s}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? d : undefined;
}

const gmailDate = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "/");
const lastDate = (t: MailThread) => t.messages.at(-1)?.date ?? t.updatedAt;

export interface MailServiceDeps {
  store: MailStore;
  accounts: MailAccounts;
  gmail: GmailClient;
  emit: (what: MailWhat) => void;
  now?: () => Date;
  /** Drops the account's cached access token (OAuthFlow.forget) when the account is removed. */
  forgetToken?: (accountId: string) => void;
}

/** One office's Gmail work: pull sources, the pulled threads, and tags (optionally mirrored as Gmail labels). */
export class MailService {
  private readonly now: () => Date;
  /** Per-thread mutation chains, so a pull never overwrites tags set meanwhile (and vice versa). */
  private readonly threadLocks = new Map<string, Promise<unknown>>();
  /** One pull per source at a time; a second caller shares the first's result. */
  private readonly pulling = new Map<string, Promise<{ threads: number }>>();

  constructor(private readonly deps: MailServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  // ── accounts ──────────────────────────────────────────────────────────────

  /** Public status only: never the client secret or any token. */
  async status(): Promise<{ clientConfigured: boolean; accounts: Awaited<ReturnType<MailAccounts["list"]>> }> {
    const [client, accounts] = await Promise.all([this.deps.accounts.getClient(), this.deps.accounts.list()]);
    return { clientConfigured: Boolean(client), accounts };
  }

  async setClient(c: { clientId: string; clientSecret: string } | null): Promise<void> {
    await this.deps.accounts.setClient(c);
    this.deps.emit("accounts");
  }

  /** Removes the account, drops its cached token, and deletes this office's sources for it. */
  async removeAccount(id: string): Promise<void> {
    if (!(await this.deps.accounts.remove(id))) throw notFound("Unknown mail account");
    this.deps.forgetToken?.(id);
    this.deps.emit("accounts");
    const stale = (await this.deps.store.sources.list()).filter((s) => s.accountId === id);
    for (const s of stale) await this.deps.store.sources.delete(s.id);
    if (stale.length) this.deps.emit("sources");
  }

  /**
   * Runs a Gmail call for the account. A stored `needsReconnect` short-circuits before any Google call;
   * a MailReconnectError (from the refresh) tells clients the account state changed.
   */
  private async gmailCall<T>(accountId: string, fn: () => Promise<T>): Promise<T> {
    const account = (await this.deps.accounts.list()).find((a) => a.id === accountId);
    if (!account) throw notFound("Unknown mail account");
    if (account.needsReconnect) throw new MailReconnectError(accountId);
    try {
      return await fn();
    } catch (e) {
      if (e instanceof MailReconnectError) this.deps.emit("accounts");
      throw e;
    }
  }

  async senders(accountId: string): Promise<MailSender[]> {
    return this.gmailCall(accountId, () => this.deps.gmail.recentSenders(accountId));
  }

  // ── sources ───────────────────────────────────────────────────────────────

  buildQuery(source: MailSource, now: Date): { q: string; max: number } {
    void now;
    const from = `from:(${source.senders.join(" OR ")})`;
    const a = source.amount;
    switch (a.kind) {
      case "latest":
        return { q: from, max: a.n };
      case "days":
        return { q: `${from} newer_than:${a.days}d`, max: 500 };
      case "range": {
        const start = realDate(a.from);
        const end = realDate(a.to);
        if (!start || !end) throw bad("Invalid date range");
        const before = new Date(end.getTime() + 86_400_000);
        return { q: `${from} after:${gmailDate(start)} before:${gmailDate(before)}`, max: 500 };
      }
      case "sinceLast": {
        const last = source.lastPulledAt ? Date.parse(source.lastPulledAt) : NaN;
        return Number.isFinite(last)
          ? { q: `${from} after:${Math.floor(last / 1000)}`, max: 500 }
          : { q: `${from} newer_than:30d`, max: 500 };
      }
    }
  }

  async listSources(): Promise<MailSource[]> {
    return (await this.deps.store.sources.list()).sort((a, b) => a.id.localeCompare(b.id));
  }

  async upsertSource(s: Omit<MailSource, "id"> & { id?: string }): Promise<MailSource> {
    const senders = [...new Set((s.senders ?? []).map((x) => String(x).trim().toLowerCase()).filter(Boolean))];
    if (senders.length === 0) throw bad("At least one sender is required");
    if (s.amount?.kind === "range") {
      const from = realDate(s.amount.from);
      const to = realDate(s.amount.to);
      if (!from || !to) throw bad("Range dates must be real dates (YYYY-MM-DD)");
      if (from > to) throw bad("Range start must not be after its end");
    }
    if (!(await this.deps.accounts.list()).some((a) => a.id === s.accountId)) throw bad("Unknown mail account");
    let existing: MailSource | undefined;
    if (s.id !== undefined) {
      existing = safe(s.id) ? await this.deps.store.sources.read(s.id) : undefined;
      if (!existing) throw notFound("Unknown source");
    }
    const parsed = MailSourceSchema.safeParse({
      ...existing,
      ...s,
      id: existing?.id ?? newId("ms"),
      senders,
      ...(existing?.lastPulledAt && !s.lastPulledAt ? { lastPulledAt: existing.lastPulledAt } : {}),
    });
    if (!parsed.success) throw bad(`Invalid source: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")}`);
    await this.deps.store.sources.write(parsed.data.id, parsed.data);
    this.deps.emit("sources");
    return parsed.data;
  }

  async removeSource(id: string): Promise<void> {
    if (!safe(id) || !(await this.deps.store.sources.delete(id))) throw notFound("Unknown source");
    this.deps.emit("sources");
  }

  async pull(sourceId: string): Promise<{ threads: number }> {
    const running = this.pulling.get(sourceId);
    if (running) return running;
    const run = this.doPull(sourceId).finally(() => this.pulling.delete(sourceId));
    this.pulling.set(sourceId, run);
    return run;
  }

  private async doPull(sourceId: string): Promise<{ threads: number }> {
    const source = safe(sourceId) ? await this.deps.store.sources.read(sourceId) : undefined;
    if (!source) throw notFound("Unknown source");
    const startedAt = this.now();
    const { q, max } = this.buildQuery(source, startedAt);
    const { accountId } = source;
    const count = await this.gmailCall(accountId, async () => {
      const labels = await this.deps.gmail.labelNames(accountId);
      const ids = await this.deps.gmail.searchThreadIds(accountId, q, max);
      let next = 0;
      const worker = async () => {
        while (next < ids.length) {
          const gid = ids[next++]!;
          const fresh = await this.deps.gmail.getThread(accountId, gid, labels);
          await this.withThread(fresh.id, async () => {
            const old = await this.deps.store.threads.read(fresh.id);
            await this.deps.store.threads.write(fresh.id, {
              ...fresh,
              tags: old?.tags ?? [],
              sentToAtlas: old?.sentToAtlas ?? [],
              drafts: old?.drafts ?? [],
            });
          });
        }
      };
      await Promise.all(Array.from({ length: Math.min(PULL_CONCURRENCY, ids.length) }, worker));
      return ids.length;
    });
    // Re-read so an edit made during the pull is kept; the source may also have been removed meanwhile.
    const latest = await this.deps.store.sources.read(sourceId);
    if (latest) {
      await this.deps.store.sources.write(sourceId, { ...latest, lastPulledAt: startedAt.toISOString() });
      this.deps.emit("sources");
    }
    this.deps.emit("threads");
    return { threads: count };
  }

  // ── threads ───────────────────────────────────────────────────────────────

  private withThread<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.threadLocks.get(key) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => undefined);
    this.threadLocks.set(key, tail);
    void tail.then(() => {
      if (this.threadLocks.get(key) === tail) this.threadLocks.delete(key);
    });
    return run;
  }

  async listThreads(filter: { accountId?: string; sender?: string; tag?: string; label?: string; notSent?: boolean } = {}): Promise<MailThread[]> {
    const sender = filter.sender?.trim().toLowerCase();
    return (await this.deps.store.threads.list())
      .filter((t) => !filter.accountId || t.accountId === filter.accountId)
      .filter((t) => !sender || t.messages.some((m) => m.fromEmail.toLowerCase() === sender))
      .filter((t) => !filter.tag || t.tags.includes(filter.tag))
      .filter((t) => !filter.label || t.gmailLabels.includes(filter.label))
      .filter((t) => !filter.notSent || t.sentToAtlas.length === 0)
      .sort((a, b) => lastDate(b).localeCompare(lastDate(a)));
  }

  async getThread(key: string): Promise<MailThread | undefined> {
    return safe(key) ? this.deps.store.threads.read(key) : undefined;
  }

  async setThreadTags(key: string, tagIds: string[]): Promise<MailThread> {
    if (!safe(key)) throw notFound("Unknown thread");
    const ids = [...new Set(tagIds)];
    const tags = new Map((await this.deps.store.tags.list()).map((t) => [t.id, t]));
    const unknown = ids.filter((id) => !tags.has(id));
    if (unknown.length) throw bad(`Unknown tag: ${unknown.join(", ")}`);
    const out = await this.withThread(key, async () => {
      const t = await this.deps.store.threads.read(key);
      if (!t) throw notFound("Unknown thread");
      const added = ids.map((id) => tags.get(id)!).filter((tag) => !t.tags.includes(tag.id) && tag.writeToGmail);
      const labels = [...t.gmailLabels];
      if (added.length) {
        await this.gmailCall(t.accountId, async () => {
          const labelIds: string[] = [];
          for (const tag of added) labelIds.push(await this.deps.gmail.ensureLabel(t.accountId, LABEL_PREFIX + tag.name));
          await this.deps.gmail.modifyThread(t.accountId, t.gmailThreadId, labelIds);
        });
        for (const tag of added) if (!labels.includes(LABEL_PREFIX + tag.name)) labels.push(LABEL_PREFIX + tag.name);
      }
      const next: MailThread = { ...t, tags: ids, gmailLabels: labels };
      await this.deps.store.threads.write(key, next);
      return next;
    });
    this.deps.emit("threads");
    return out;
  }

  // ── tags ──────────────────────────────────────────────────────────────────

  async listTags(): Promise<MailTag[]> {
    return (await this.deps.store.tags.list()).sort((a, b) => a.name.localeCompare(b.name));
  }

  async upsertTag(t: Omit<MailTag, "id"> & { id?: string }): Promise<MailTag> {
    let existing: MailTag | undefined;
    if (t.id !== undefined) {
      existing = safe(t.id) ? await this.deps.store.tags.read(t.id) : undefined;
      if (!existing) throw notFound("Unknown tag");
    }
    const parsed = MailTagSchema.safeParse({ ...existing, ...t, name: typeof t.name === "string" ? t.name.trim() : t.name, id: existing?.id ?? newId("mt") });
    if (!parsed.success) throw bad(`Invalid tag: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")}`);
    const tag = parsed.data;
    if (tag.name.includes("/")) throw bad("Tag names cannot contain '/'");
    const clash = (await this.deps.store.tags.list()).find((x) => x.id !== tag.id && x.name.toLowerCase() === tag.name.toLowerCase());
    if (clash) throw bad(`A tag named "${clash.name}" already exists`);
    await this.deps.store.tags.write(tag.id, tag);
    this.deps.emit("tags");
    return tag;
  }

  /** Deletes the tag and strips it from every thread (Gmail labels already written are left alone). */
  async removeTag(id: string): Promise<void> {
    if (!safe(id) || !(await this.deps.store.tags.delete(id))) throw notFound("Unknown tag");
    let touched = false;
    for (const t of await this.deps.store.threads.list()) {
      if (!t.tags.includes(id)) continue;
      await this.withThread(t.id, async () => {
        const cur = await this.deps.store.threads.read(t.id);
        if (!cur) return;
        await this.deps.store.threads.write(t.id, { ...cur, tags: cur.tags.filter((x) => x !== id) });
      });
      touched = true;
    }
    this.deps.emit("tags");
    if (touched) this.deps.emit("threads");
  }

  // ── auto-check ────────────────────────────────────────────────────────────

  /** Pulls every `autoCheck` source every 10 minutes (unref'd timer). Returns a stop function. */
  startAutoCheck(): () => void {
    let busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        for (const s of await this.deps.store.sources.list()) {
          if (!s.autoCheck) continue;
          await this.pull(s.id).catch((e: unknown) => {
            if (!(e instanceof MailReconnectError)) console.warn(`[agenticview] mail auto-check of ${s.id} failed: ${(e as Error).message}`);
          });
        }
      } catch (e) {
        console.warn(`[agenticview] mail auto-check failed: ${(e as Error).message}`);
      } finally {
        busy = false;
      }
    };
    const timer = setInterval(() => void tick(), AUTO_CHECK_MS);
    timer.unref();
    return () => clearInterval(timer);
  }
}
