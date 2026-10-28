import {
  MailSourceSchema,
  MailTagSchema,
  newId,
  type MailDraft,
  type MailSender,
  type MailSource,
  type MailTag,
  type MailThread,
  type Task,
} from "@agenticview/shared";
import type { MailAccounts } from "./accounts.js";
import type { GmailClient } from "./gmail.js";
import { MailReconnectError } from "./oauth.js";
import type { MailStore } from "./store.js";
import { buildReplyMime, looksLikeBareReply, renderThreadForTask } from "./text.js";

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
  /** Starts (or joins) the Manager's request for these threads (Orchestrator.handleUserMessage). Resolved at call time. */
  startRequest?: (input: { agentId: string; text: string; mail: { threadIds: string[] } }) => Promise<Task>;
  /** This office's manager agent id, when known. */
  managerId?: () => string | undefined;
  /** An agent's display name, for the tag routing lines. */
  agentName?: (agentId: string) => Promise<string | undefined>;
  /** True for an existing worker agent (a tag's preferred agent); without it no preferred agent is accepted. */
  isWorker?: (agentId: string) => Promise<boolean>;
  /** A request's direct child tasks (to tell whether a worker already drafted its thread). */
  taskChildren?: (taskId: string) => Promise<Task[]>;
}

/** Sent to the Manager with every Send to Atlas request. */
export const ATLAS_ROUTING =
  "For each email thread below, assign one work task with assign_task and pass its threadId. The worker's whole result must be only the reply body. Prefer the tag's preferred agent when it fits.";

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
    if (t.preferredAgentId !== undefined && !(await this.deps.isWorker?.(t.preferredAgentId))) {
      throw bad("The preferred agent must be an existing worker");
    }
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

  // ── Send to Atlas ─────────────────────────────────────────────────────────

  /** This office's manager agent id, when known. */
  managerId(): string | undefined {
    return this.deps.managerId?.();
  }

  /**
   * Starts the Manager's request for these threads: the user's note, one routing line per used tag, the
   * routing instruction, then each thread fenced as data. Every thread records the request in `sentToAtlas`.
   */
  async sendToAtlas(input: { threadKeys: string[]; note?: string; managerId: string }): Promise<Task> {
    const keys = [...new Set(input.threadKeys)];
    if (keys.length === 0) throw bad("At least one thread is required");
    const start = this.deps.startRequest;
    if (!start) throw bad("Send to Atlas is not available in this office");
    const threads: MailThread[] = [];
    for (const key of keys) {
      const t = safe(key) ? await this.deps.store.threads.read(key) : undefined;
      if (!t) throw notFound("Unknown thread");
      threads.push(t);
    }
    const tags = new Map((await this.deps.store.tags.list()).map((t) => [t.id, t]));
    const used: MailTag[] = [];
    for (const t of threads) {
      for (const id of t.tags) {
        const tag = tags.get(id);
        if (tag && !used.includes(tag)) used.push(tag);
      }
    }
    const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
    const tagLines: string[] = [];
    for (const tag of used) {
      let line = `Tag "${oneLine(tag.name)}": ${oneLine(tag.meaning).replace(/\.+$/, "")}`;
      const agentId = tag.preferredAgentId;
      const name = agentId ? await this.deps.agentName?.(agentId) : undefined;
      if (agentId && name) line += `. Preferred agent: ${oneLine(name)} (${agentId})`;
      tagLines.push(line);
    }
    const text = [
      input.note?.trim() ?? "",
      tagLines.join("\n"),
      ATLAS_ROUTING,
      ...threads.map((t) => renderThreadForTask(t, t.tags.flatMap((id) => (tags.has(id) ? [tags.get(id)!.name] : [])))),
    ]
      .filter(Boolean)
      .join("\n\n");
    const task = await start({ agentId: input.managerId, text, mail: { threadIds: keys } });
    const at = this.now().toISOString();
    for (const key of keys) {
      await this.withThread(key, async () => {
        const cur = await this.deps.store.threads.read(key);
        if (cur) await this.deps.store.threads.write(key, { ...cur, sentToAtlas: [...cur.sentToAtlas, { taskId: task.id, at }] });
      });
    }
    this.deps.emit("threads");
    return task;
  }

  // ── drafts ────────────────────────────────────────────────────────────────

  /** Tasks already turned into drafts (or found to have no thread); a later state event never re-adds one. */
  private readonly draftedTasks = new Set<string>();

  /**
   * TaskService state-change hook. A finished mail work task's result becomes a reply draft on its thread;
   * a finished single-thread request's own result does too when none of its work tasks drafted that thread.
   * Idempotent per task id; never throws.
   */
  async onTaskChanged(task: Task): Promise<void> {
    try {
      await this.draftFromTask(task);
    } catch (e) {
      console.warn(`[agenticview] mail draft from task ${task.id} failed (${(e as Error)?.name ?? "error"})`);
    }
  }

  private async draftFromTask(task: Task): Promise<void> {
    if (task.kind !== "work" && task.kind !== "request") return;
    if (task.status !== "done" || !task.result?.trim() || task.mail?.threadIds.length !== 1) return;
    if (this.draftedTasks.has(task.id)) return;
    const key = task.mail.threadIds[0]!;
    if (!safe(key)) return;
    const result = task.result;
    const childIds = task.kind === "request" ? new Set((await this.deps.taskChildren?.(task.id) ?? []).map((c) => c.id)) : undefined;
    const added = await this.withThread(key, async () => {
      const t = await this.deps.store.threads.read(key);
      if (!t) return false;
      if (t.drafts.some((d) => d.taskId === task.id)) return false;
      if (childIds && t.drafts.some((d) => d.taskId !== undefined && childIds.has(d.taskId))) return false;
      const draft: MailDraft = {
        id: newId("md"),
        body: result.trim(),
        createdAt: this.now().toISOString(),
        taskId: task.id,
        agentId: task.assigneeId,
        flagged: !looksLikeBareReply(result),
      };
      await this.deps.store.threads.write(key, { ...t, drafts: [draft, ...t.drafts] });
      return true;
    });
    this.draftedTasks.add(task.id);
    if (added) this.deps.emit("threads");
  }

  /** Runs `fn` on the thread and draft under the thread lock; unknown keys or draft ids are 404. */
  private async withDraft<T>(key: string, draftId: string, fn: (t: MailThread, d: MailDraft) => Promise<{ next?: MailThread; out: T }>): Promise<T> {
    if (!safe(key)) throw notFound("Unknown thread");
    if (!safe(draftId)) throw notFound("Unknown draft");
    const out = await this.withThread(key, async () => {
      const t = await this.deps.store.threads.read(key);
      if (!t) throw notFound("Unknown thread");
      const d = t.drafts.find((x) => x.id === draftId);
      if (!d) throw notFound("Unknown draft");
      const r = await fn(t, d);
      if (r.next) await this.deps.store.threads.write(key, r.next);
      return r;
    });
    if (out.next) this.deps.emit("threads");
    return out.out;
  }

  private static replace(t: MailThread, d: MailDraft): MailThread {
    return { ...t, drafts: t.drafts.map((x) => (x.id === d.id ? d : x)) };
  }

  /**
   * New body. The Gmail draft saved earlier keeps its id: the next save or send updates that same Gmail
   * draft, so no stale copy is left behind. Sent drafts are final.
   */
  async editDraft(key: string, draftId: string, body: string): Promise<MailDraft> {
    return this.withDraft(key, draftId, async (t, d) => {
      if (d.sentAt) throw bad("This draft was already sent");
      const next: MailDraft = { ...d, body };
      return { next: MailService.replace(t, next), out: next };
    });
  }

  /** Removes the draft; its saved Gmail copy (not yet sent) is deleted too, unless the account is gone. */
  async discardDraft(key: string, draftId: string): Promise<void> {
    await this.withDraft(key, draftId, async (t, d) => {
      const gmailDraftId = d.gmailDraftId;
      if (gmailDraftId && !d.sentAt && (await this.deps.accounts.list()).some((a) => a.id === t.accountId)) {
        await this.gmailCall(t.accountId, () => this.deps.gmail.deleteDraft(t.accountId, gmailDraftId));
      }
      return { next: { ...t, drafts: t.drafts.filter((x) => x.id !== d.id) }, out: undefined };
    });
  }

  /** The draft as a reply MIME (base64url) to the newest message not sent by the account itself. */
  private async replyRaw(t: MailThread, body: string): Promise<string> {
    const account = (await this.deps.accounts.list()).find((a) => a.id === t.accountId);
    if (!account) throw notFound("Unknown mail account");
    const own = account.email.toLowerCase();
    const target = [...t.messages].reverse().find((m) => m.fromEmail.toLowerCase() !== own);
    if (!target) throw bad("This thread has no message from someone else to reply to");
    const refs = t.messages.flatMap((m) => (m.messageIdHeader ? [m.messageIdHeader] : [])).join(" ");
    return buildReplyMime({
      from: account.email,
      to: target.fromEmail,
      subject: t.subject,
      ...(target.messageIdHeader ? { inReplyTo: target.messageIdHeader } : {}),
      ...(refs ? { references: refs } : {}),
      body,
    });
  }

  /**
   * Saves the draft as a Gmail draft reply in its thread and records the Gmail draft id. Saved before:
   * that Gmail draft is updated in place instead of creating another.
   */
  async saveDraftToGmail(key: string, draftId: string): Promise<MailDraft> {
    return this.withDraft(key, draftId, async (t, d) => {
      if (d.sentAt) throw bad("This draft was already sent");
      const raw = await this.replyRaw(t, d.body);
      const saved = d.gmailDraftId;
      const gmailDraftId = await this.gmailCall(t.accountId, async () => {
        if (!saved) return this.deps.gmail.createDraft(t.accountId, t.gmailThreadId, raw);
        await this.deps.gmail.updateDraft(t.accountId, saved, t.gmailThreadId, raw);
        return saved;
      });
      const next: MailDraft = { ...d, gmailDraftId };
      return { next: MailService.replace(t, next), out: next };
    });
  }

  /**
   * Sends the draft as a reply in its thread. Runs under the thread lock, so it can never send twice. A
   * draft saved to Gmail is updated to the current body and sent as that Gmail draft (Gmail then drops it
   * from Drafts), so no saved copy remains; otherwise it goes out via messages/send.
   */
  async sendDraft(key: string, draftId: string): Promise<MailDraft> {
    return this.withDraft(key, draftId, async (t, d) => {
      if (d.sentAt) throw bad("This draft was already sent");
      const raw = await this.replyRaw(t, d.body);
      const saved = d.gmailDraftId;
      await this.gmailCall(t.accountId, async () => {
        if (!saved) return this.deps.gmail.send(t.accountId, t.gmailThreadId, raw);
        await this.deps.gmail.updateDraft(t.accountId, saved, t.gmailThreadId, raw);
        await this.deps.gmail.sendDraftById(t.accountId, saved);
      });
      const { gmailDraftId: _sent, ...rest } = d;
      void _sent;
      const next: MailDraft = { ...rest, sentAt: this.now().toISOString() };
      return { next: MailService.replace(t, next), out: next };
    });
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
