import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MailSource, MailThread } from "@agenticview/shared";
import { MailAccounts } from "../../src/mail/accounts.js";
import { MailReconnectError } from "../../src/mail/oauth.js";
import type { GmailClient } from "../../src/mail/gmail.js";
import { MailStore } from "../../src/mail/store.js";
import { MailService } from "../../src/mail/service.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "av-mailsvc-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

type RawThread = Omit<MailThread, "tags" | "sentToAtlas" | "drafts">;

function rawThread(accountId: string, gid: string, date: string, from = "a@x.com"): RawThread {
  return {
    id: `${accountId}_${gid}`,
    accountId,
    gmailThreadId: gid,
    subject: `Subject ${gid}`,
    messages: [{ id: `m-${gid}`, from: "A", fromEmail: from, to: "me@example.com", date, text: "hi", attachments: [] }],
    gmailLabels: [],
    updatedAt: date,
  };
}

/** A fake GmailClient recording calls; threads come from `threads`. */
function fakeGmail(threads: RawThread[] = []) {
  const calls: { fn: string; args: unknown[] }[] = [];
  let fail: Error | undefined;
  const g = {
    calls,
    threads,
    failWith(e: Error | undefined) {
      fail = e;
    },
    async labelNames() {
      calls.push({ fn: "labelNames", args: [] });
      if (fail) throw fail;
      return new Map<string, string>();
    },
    async searchThreadIds(accountId: string, q: string, max: number) {
      calls.push({ fn: "searchThreadIds", args: [accountId, q, max] });
      if (fail) throw fail;
      return g.threads.map((t) => t.gmailThreadId);
    },
    async getThread(accountId: string, gid: string) {
      calls.push({ fn: "getThread", args: [accountId, gid] });
      const t = g.threads.find((x) => x.gmailThreadId === gid);
      if (!t) throw new Error("missing");
      return structuredClone(t);
    },
    async recentSenders(accountId: string) {
      calls.push({ fn: "recentSenders", args: [accountId] });
      if (fail) throw fail;
      return [{ email: "a@x.com", name: "A", count: 2, lastDate: "2026-10-27T00:00:00.000Z" }];
    },
    async ensureLabel(accountId: string, name: string) {
      calls.push({ fn: "ensureLabel", args: [accountId, name] });
      return `Label_${name}`;
    },
    async modifyThread(accountId: string, gid: string, add: string[]) {
      calls.push({ fn: "modifyThread", args: [accountId, gid, add] });
    },
  };
  return g;
}

async function setup(threads: RawThread[] = []) {
  const accounts = new MailAccounts(join(dir, "global"));
  const account = await accounts.save({ email: "me@example.com", refreshToken: "rt" });
  const gmail = fakeGmail(threads);
  const emitted: string[] = [];
  const svc = new MailService({
    store: new MailStore(join(dir, "office")),
    accounts,
    gmail: gmail as unknown as GmailClient,
    emit: (what) => emitted.push(what),
    now: () => new Date("2026-10-28T12:00:00.000Z"),
  });
  return { accounts, account, gmail, emitted, svc };
}

const NOW = new Date("2026-10-28T12:00:00.000Z");
const src = (amount: MailSource["amount"], extra: Partial<MailSource> = {}): MailSource => ({
  id: "ms_00000000",
  accountId: "ma_00000000",
  senders: ["a@x.com", "b@y.com"],
  amount,
  autoCheck: false,
  ...extra,
});

describe("MailService.buildQuery", () => {
  it("latest: senders only, max = n", async () => {
    const { svc } = await setup();
    expect(svc.buildQuery(src({ kind: "latest", n: 50 }), NOW)).toEqual({ q: "from:(a@x.com OR b@y.com)", max: 50 });
  });
  it("days: newer_than, max 500", async () => {
    const { svc } = await setup();
    expect(svc.buildQuery(src({ kind: "days", days: 7 }), NOW)).toEqual({ q: "from:(a@x.com OR b@y.com) newer_than:7d", max: 500 });
  });
  it("range: after from, before to + 1 day", async () => {
    const { svc } = await setup();
    expect(svc.buildQuery(src({ kind: "range", from: "2026-10-01", to: "2026-10-27" }), NOW)).toEqual({
      q: "from:(a@x.com OR b@y.com) after:2026/10/01 before:2026/10/28",
      max: 500,
    });
    // Month and year rollover.
    expect(svc.buildQuery(src({ kind: "range", from: "2026-12-01", to: "2026-12-31" }), NOW).q).toBe(
      "from:(a@x.com OR b@y.com) after:2026/12/01 before:2027/01/01",
    );
  });
  it("sinceLast: after epoch seconds of lastPulledAt, else newer_than:30d", async () => {
    const { svc } = await setup();
    const last = "2026-10-27T10:00:00.000Z";
    expect(svc.buildQuery(src({ kind: "sinceLast" }, { lastPulledAt: last }), NOW)).toEqual({
      q: `from:(a@x.com OR b@y.com) after:${Math.floor(Date.parse(last) / 1000)}`,
      max: 500,
    });
    expect(svc.buildQuery(src({ kind: "sinceLast" }), NOW)).toEqual({ q: "from:(a@x.com OR b@y.com) newer_than:30d", max: 500 });
  });
});

describe("MailService sources", () => {
  it("upsertSource lower-cases and de-dupes senders, and rejects bad ranges", async () => {
    const { svc, account, emitted } = await setup();
    const s = await svc.upsertSource({ accountId: account.id, senders: ["A@X.com", " a@x.com", "b@y.com"], amount: { kind: "latest", n: 10 }, autoCheck: false });
    expect(s.senders).toEqual(["a@x.com", "b@y.com"]);
    expect(s.id).toMatch(/^ms_[0-9a-f]{8}$/);
    expect(emitted).toContain("sources");
    const bad = (from: string, to: string) =>
      svc.upsertSource({ accountId: account.id, senders: ["a@x.com"], amount: { kind: "range", from, to }, autoCheck: false });
    await expect(bad("2026-10-27", "2026-10-01")).rejects.toMatchObject({ status: 400 });
    await expect(bad("2026-02-30", "2026-03-01")).rejects.toMatchObject({ status: 400 });
    await expect(svc.upsertSource({ accountId: "ma_ffffffff", senders: ["a@x.com"], amount: { kind: "sinceLast" }, autoCheck: false })).rejects.toMatchObject({ status: 400 });
    await svc.removeSource(s.id);
    expect(await svc.listSources()).toEqual([]);
  });
});

describe("MailService pull", () => {
  it("pull preserves tags and drafts on re-pull", async () => {
    const { svc, account, gmail, emitted } = await setup();
    gmail.threads.push(rawThread(account.id, "t1", "2026-10-20T00:00:00.000Z"), rawThread(account.id, "t2", "2026-10-25T00:00:00.000Z"));
    const s = await svc.upsertSource({ accountId: account.id, senders: ["a@x.com"], amount: { kind: "latest", n: 50 }, autoCheck: false });
    expect(await svc.pull(s.id)).toEqual({ threads: 2 });
    expect((await svc.listSources())[0]!.lastPulledAt).toBe("2026-10-28T12:00:00.000Z");
    expect(emitted).toContain("threads");

    const tag = await svc.upsertTag({ name: "Urgent", color: "#ff0000", meaning: "now", writeToGmail: false });
    const key = `${account.id}_t1`;
    await svc.setThreadTags(key, [tag.id]);
    // Simulate a draft and a send-to-Atlas record stored on the thread.
    const store = (svc as unknown as { deps: { store: MailStore } }).deps.store;
    const t = (await store.threads.read(key))!;
    await store.threads.write(key, {
      ...t,
      drafts: [{ id: "d1", body: "draft", createdAt: "2026-10-27T00:00:00.000Z", flagged: false }],
      sentToAtlas: [{ taskId: "t_1", at: "2026-10-27T00:00:00.000Z" }],
    });

    gmail.threads[0]!.subject = "Updated subject";
    await svc.pull(s.id);
    const after = (await svc.getThread(key))!;
    expect(after.subject).toBe("Updated subject");
    expect(after.tags).toEqual([tag.id]);
    expect(after.drafts.map((d) => d.id)).toEqual(["d1"]);
    expect(after.sentToAtlas).toHaveLength(1);

    // Sorted newest first.
    expect((await svc.listThreads()).map((x) => x.gmailThreadId)).toEqual(["t2", "t1"]);
    expect((await svc.listThreads({ tag: tag.id })).map((x) => x.gmailThreadId)).toEqual(["t1"]);
    expect((await svc.listThreads({ notSent: true })).map((x) => x.gmailThreadId)).toEqual(["t2"]);
  });

  it("pull on MailReconnectError emits accounts and rethrows", async () => {
    const { svc, account, gmail, emitted } = await setup();
    const s = await svc.upsertSource({ accountId: account.id, senders: ["a@x.com"], amount: { kind: "sinceLast" }, autoCheck: false });
    gmail.failWith(new MailReconnectError(account.id));
    await expect(svc.pull(s.id)).rejects.toBeInstanceOf(MailReconnectError);
    expect(emitted).toContain("accounts");
  });

  it("does not call Gmail for an account that needs reconnecting", async () => {
    const { svc, account, gmail, accounts } = await setup();
    const s = await svc.upsertSource({ accountId: account.id, senders: ["a@x.com"], amount: { kind: "sinceLast" }, autoCheck: false });
    await accounts.markNeedsReconnect(account.id, true);
    await expect(svc.pull(s.id)).rejects.toBeInstanceOf(MailReconnectError);
    await expect(svc.senders(account.id)).rejects.toBeInstanceOf(MailReconnectError);
    expect(gmail.calls).toEqual([]);
  });
});

describe("MailService tags", () => {
  it("setThreadTags writes AgenticView/<name> label only for writeToGmail tags", async () => {
    const { svc, account, gmail } = await setup([]);
    gmail.threads.push(rawThread(account.id, "t1", "2026-10-20T00:00:00.000Z"));
    const s = await svc.upsertSource({ accountId: account.id, senders: ["a@x.com"], amount: { kind: "latest", n: 5 }, autoCheck: false });
    await svc.pull(s.id);
    const local = await svc.upsertTag({ name: "Local", color: "#00ff00", meaning: "", writeToGmail: false });
    const synced = await svc.upsertTag({ name: "Synced", color: "#0000ff", meaning: "", writeToGmail: true });
    const key = `${account.id}_t1`;
    gmail.calls.length = 0;
    const t = await svc.setThreadTags(key, [local.id, synced.id]);
    expect(t.tags).toEqual([local.id, synced.id]);
    expect(gmail.calls.filter((c) => c.fn === "ensureLabel").map((c) => c.args[1])).toEqual(["AgenticView/Synced"]);
    expect(gmail.calls.filter((c) => c.fn === "modifyThread")).toEqual([{ fn: "modifyThread", args: [account.id, "t1", ["Label_AgenticView/Synced"]] }]);
    // Re-setting the same tags adds nothing new: no further Gmail writes.
    gmail.calls.length = 0;
    await svc.setThreadTags(key, [synced.id, local.id]);
    expect(gmail.calls).toEqual([]);
    await expect(svc.setThreadTags(key, ["mt_ffffffff"])).rejects.toMatchObject({ status: 400 });
    await expect(svc.setThreadTags("nope", [])).rejects.toMatchObject({ status: 404 });
  });

  it("removeTag strips it from threads", async () => {
    const { svc, account, gmail } = await setup();
    gmail.threads.push(rawThread(account.id, "t1", "2026-10-20T00:00:00.000Z"));
    const s = await svc.upsertSource({ accountId: account.id, senders: ["a@x.com"], amount: { kind: "latest", n: 5 }, autoCheck: false });
    await svc.pull(s.id);
    const a = await svc.upsertTag({ name: "A", color: "#000000", meaning: "", writeToGmail: false });
    const b = await svc.upsertTag({ name: "B", color: "#111111", meaning: "", writeToGmail: false });
    const key = `${account.id}_t1`;
    await svc.setThreadTags(key, [a.id, b.id]);
    await svc.removeTag(a.id);
    expect((await svc.getThread(key))!.tags).toEqual([b.id]);
    expect((await svc.listTags()).map((t) => t.id)).toEqual([b.id]);
  });
});
