import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MailThread, Provider, Task } from "@agenticview/shared";
import { MailAccounts } from "../../src/mail/accounts.js";
import type { GmailClient } from "../../src/mail/gmail.js";
import { MailStore } from "../../src/mail/store.js";
import { MailService } from "../../src/mail/service.js";
import { createServer, type RunningServer } from "../../src/server.js";
import { FakeRuntime } from "../../src/runtimes/fake.js";
import type { Runtime } from "../../src/runtimes/types.js";

let dir: string;
let server: RunningServer | undefined;
const savedHome = process.env.AGENTICVIEW_HOME;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "av-maildraft-"));
});
afterEach(async () => {
  await server?.close();
  server = undefined;
  process.env.AGENTICVIEW_HOME = savedHome;
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const ME = "me@example.com";

function thread(accountId: string, gid: string, extra: Partial<MailThread> = {}): MailThread {
  return {
    id: `${accountId}_${gid}`,
    accountId,
    gmailThreadId: gid,
    subject: "Invoice question",
    messages: [
      { id: "m1", from: "Cust", fromEmail: "cust@x.com", to: ME, date: "2026-10-26T10:00:00.000Z", text: "Where is my invoice?", messageIdHeader: "<m1@x.com>", attachments: [] },
      { id: "m2", from: "Me", fromEmail: ME, to: "cust@x.com", date: "2026-10-26T11:00:00.000Z", text: "Looking.", messageIdHeader: "<m2@example.com>", attachments: [] },
      { id: "m3", from: "Other", fromEmail: "other@x.com", to: ME, date: "2026-10-27T09:00:00.000Z", text: "Any news?", messageIdHeader: "<m3@x.com>", attachments: [] },
      { id: "m4", from: "Me", fromEmail: ME, to: "other@x.com", date: "2026-10-27T10:00:00.000Z", text: "Soon.", messageIdHeader: "<m4@example.com>", attachments: [] },
    ],
    gmailLabels: [],
    tags: [],
    sentToAtlas: [],
    drafts: [],
    updatedAt: "2026-10-27T10:00:00.000Z",
    ...extra,
  };
}

function fakeGmail() {
  const calls: { fn: string; args: unknown[] }[] = [];
  return {
    calls,
    async createDraft(accountId: string, gid: string, raw: string) {
      calls.push({ fn: "createDraft", args: [accountId, gid, raw] });
      return "gd_1";
    },
    async send(accountId: string, gid: string, raw: string) {
      calls.push({ fn: "send", args: [accountId, gid, raw] });
    },
  };
}

function task(extra: Partial<Task>): Task {
  return {
    id: "t_work",
    kind: "work",
    title: "t",
    description: "d",
    status: "done",
    createdBy: "agent",
    assigneeId: "ag_worker",
    projectPath: "",
    images: [],
    log: [],
    createdAt: "2026-10-28T00:00:00.000Z",
    ...extra,
  };
}

async function setup() {
  const accounts = new MailAccounts(join(dir, "global"));
  const account = await accounts.save({ email: ME, refreshToken: "rt" });
  const store = new MailStore(join(dir, "office"));
  const gmail = fakeGmail();
  const emitted: string[] = [];
  const started: { agentId: string; text: string; mail: { threadIds: string[] } }[] = [];
  const children = new Map<string, Task[]>();
  const svc = new MailService({
    store,
    accounts,
    gmail: gmail as unknown as GmailClient,
    emit: (what) => emitted.push(what),
    now: () => new Date("2026-10-28T12:00:00.000Z"),
    startRequest: async (input) => {
      started.push(input);
      return task({ id: "t_req", kind: "request", status: "assigned", assigneeId: input.agentId, description: input.text, mail: input.mail });
    },
    managerId: () => "ag_atlas",
    agentName: async (id) => (id === "ag_ledger" ? "Ledger" : undefined),
    taskChildren: async (id) => children.get(id) ?? [],
  });
  return { accounts, account, store, gmail, emitted, started, children, svc };
}

describe("MailService.sendToAtlas", () => {
  it("sendToAtlas builds fenced, tagged request and marks sentToAtlas", async () => {
    const { account, store, svc, started, emitted } = await setup();
    await store.tags.write("mt_bill", { id: "mt_bill", name: "billing", color: "#112233", meaning: "Invoices and payments", preferredAgentId: "ag_ledger", writeToGmail: false });
    const a = thread(account.id, "g1", { tags: ["mt_bill"] });
    const b = thread(account.id, "g2", { subject: "Other" });
    await store.threads.write(a.id, a);
    await store.threads.write(b.id, b);

    const req = await svc.sendToAtlas({ threadKeys: [a.id, b.id], note: "Please be polite.", managerId: "ag_atlas" });
    expect(req.id).toBe("t_req");
    expect(started).toHaveLength(1);
    expect(started[0]!.agentId).toBe("ag_atlas");
    expect(started[0]!.mail).toEqual({ threadIds: [a.id, b.id] });
    const text = started[0]!.text;
    expect(text.startsWith("Please be polite.")).toBe(true);
    expect(text).toContain('Tag "billing": Invoices and payments. Preferred agent: Ledger (ag_ledger)');
    expect(text).toContain(
      "For each email thread below, assign one work task with assign_task and pass its threadId. The worker's whole result must be only the reply body. Prefer the tag's preferred agent when it fits.",
    );
    expect(text).toContain(`<<<EMAIL THREAD ${a.id}`);
    expect(text).toContain(`<<<EMAIL THREAD ${b.id}`);
    expect(text).toContain(">>>END EMAIL THREAD");
    expect(text).toContain("Tags: billing");
    // The request returned by the orchestrator carries the threads.
    expect(req.description).toBe(text);
    expect(req.mail).toEqual({ threadIds: [a.id, b.id] });

    for (const id of [a.id, b.id]) {
      expect((await store.threads.read(id))!.sentToAtlas).toEqual([{ taskId: "t_req", at: "2026-10-28T12:00:00.000Z" }]);
    }
    expect(emitted).toContain("threads");
  });

  it("refuses unknown or unsafe thread keys without starting a request", async () => {
    const { svc, started } = await setup();
    await expect(svc.sendToAtlas({ threadKeys: ["ma_x_nope"], managerId: "ag_atlas" })).rejects.toMatchObject({ status: 404 });
    await expect(svc.sendToAtlas({ threadKeys: ["../etc"], managerId: "ag_atlas" })).rejects.toMatchObject({ status: 404 });
    expect(started).toHaveLength(0);
  });
});

describe("MailService.onTaskChanged", () => {
  it("done work task adds a flagged/unflagged draft once", async () => {
    const { account, store, svc, emitted } = await setup();
    const t = thread(account.id, "g1");
    await store.threads.write(t.id, t);

    const bare = task({ id: "t_w1", parentId: "t_req", result: "  Hi, your invoice is attached.\n  ", mail: { threadIds: [t.id] } });
    await svc.onTaskChanged(bare);
    await svc.onTaskChanged(bare);
    let drafts = (await store.threads.read(t.id))!.drafts;
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ body: "Hi, your invoice is attached.", taskId: "t_w1", agentId: "ag_worker", flagged: false });
    expect(emitted.filter((e) => e === "threads")).toHaveLength(1);

    const chatty = task({ id: "t_w2", parentId: "t_req", result: "Here is a draft reply:\n\nHi there", mail: { threadIds: [t.id] } });
    await svc.onTaskChanged(chatty);
    drafts = (await store.threads.read(t.id))!.drafts;
    expect(drafts).toHaveLength(2);
    expect(drafts[0]).toMatchObject({ taskId: "t_w2", flagged: true });

    // Not done, no result, several threads or no mail: nothing.
    await svc.onTaskChanged(task({ id: "t_w3", status: "running", result: "x", mail: { threadIds: [t.id] } }));
    await svc.onTaskChanged(task({ id: "t_w4", mail: { threadIds: [t.id] } }));
    await svc.onTaskChanged(task({ id: "t_w5", result: "x", mail: { threadIds: [t.id, t.id + "b"] } }));
    await svc.onTaskChanged(task({ id: "t_w6", result: "x" }));
    expect((await store.threads.read(t.id))!.drafts).toHaveLength(2);
  });

  it("never throws, even for an unknown or unsafe thread", async () => {
    const { svc } = await setup();
    await expect(svc.onTaskChanged(task({ result: "x", mail: { threadIds: ["../x"] } }))).resolves.toBeUndefined();
    await expect(svc.onTaskChanged(task({ result: "x", mail: { threadIds: ["ma_x_missing"] } }))).resolves.toBeUndefined();
  });

  it("request result becomes the draft when Atlas assigned no work", async () => {
    const { account, store, svc, children } = await setup();
    const t = thread(account.id, "g1");
    await store.threads.write(t.id, t);
    const req = task({ id: "t_req", kind: "request", assigneeId: "ag_atlas", result: "Thanks, the invoice is on its way.", mail: { threadIds: [t.id] } });
    await svc.onTaskChanged(req);
    await svc.onTaskChanged(req);
    const drafts = (await store.threads.read(t.id))!.drafts;
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ body: "Thanks, the invoice is on its way.", taskId: "t_req", agentId: "ag_atlas", flagged: false });

    // A request whose child already drafted the thread adds nothing.
    const t2 = thread(account.id, "g2");
    await store.threads.write(t2.id, t2);
    const child = task({ id: "t_child", parentId: "t_req2", result: "Hello.", mail: { threadIds: [t2.id] } });
    children.set("t_req2", [child]);
    await svc.onTaskChanged(child);
    await svc.onTaskChanged(task({ id: "t_req2", kind: "request", assigneeId: "ag_atlas", result: "I assigned it.", mail: { threadIds: [t2.id] } }));
    expect((await store.threads.read(t2.id))!.drafts.map((d) => d.taskId)).toEqual(["t_child"]);

    // A request for several threads never drafts from its own result.
    const t3 = thread(account.id, "g3");
    await store.threads.write(t3.id, t3);
    await svc.onTaskChanged(task({ id: "t_req3", kind: "request", result: "Done.", mail: { threadIds: [t3.id, t.id] } }));
    expect((await store.threads.read(t3.id))!.drafts).toHaveLength(0);
  });
});

describe("MailService draft actions", () => {
  async function withDraft() {
    const s = await setup();
    const t = thread(s.account.id, "g1");
    await s.store.threads.write(t.id, t);
    await s.svc.onTaskChanged(task({ id: "t_w1", result: "Hi,\nIt is attached.", mail: { threadIds: [t.id] } }));
    const draftId = (await s.store.threads.read(t.id))!.drafts[0]!.id;
    return { ...s, t, draftId };
  }

  it("saveDraftToGmail replies to the latest external message with threading headers", async () => {
    const { svc, gmail, t, draftId, account, store } = await withDraft();
    const d = await svc.saveDraftToGmail(t.id, draftId);
    expect(d.gmailDraftId).toBe("gd_1");
    expect((await store.threads.read(t.id))!.drafts[0]!.gmailDraftId).toBe("gd_1");
    const call = gmail.calls.find((c) => c.fn === "createDraft")!;
    expect(call.args[0]).toBe(account.id);
    expect(call.args[1]).toBe("g1");
    const mime = Buffer.from(call.args[2] as string, "base64url").toString("utf8");
    expect(mime).toContain(`From: ${ME}\r\n`);
    expect(mime).toContain("To: other@x.com\r\n");
    expect(mime).toContain("Subject: Re: Invoice question\r\n");
    expect(mime).toContain("In-Reply-To: <m3@x.com>\r\n");
    expect(mime).toContain("References: <m1@x.com> <m2@example.com> <m3@x.com> <m4@example.com>\r\n");
    expect(mime.endsWith("\r\n\r\nHi,\r\nIt is attached.")).toBe(true);
  });

  it("goes through the reconnect guard", async () => {
    const { svc, gmail, t, draftId, accounts, account } = await withDraft();
    await accounts.markNeedsReconnect(account.id, true);
    await expect(svc.saveDraftToGmail(t.id, draftId)).rejects.toMatchObject({ name: "MailReconnectError" });
    await expect(svc.sendDraft(t.id, draftId)).rejects.toMatchObject({ name: "MailReconnectError" });
    expect(gmail.calls).toHaveLength(0);
  });

  it("cannot send twice", async () => {
    const { svc, gmail, t, draftId, store } = await withDraft();
    const sent = await svc.sendDraft(t.id, draftId);
    expect(sent.sentAt).toBe("2026-10-28T12:00:00.000Z");
    expect((await store.threads.read(t.id))!.drafts[0]!.sentAt).toBe("2026-10-28T12:00:00.000Z");
    await expect(svc.sendDraft(t.id, draftId)).rejects.toMatchObject({ status: 400 });
    // Two sends racing: only one reaches Gmail.
    const t2 = thread(t.accountId, "g9");
    await store.threads.write(t2.id, t2);
    await svc.onTaskChanged(task({ id: "t_w9", result: "Hello.", mail: { threadIds: [t2.id] } }));
    const d2 = (await store.threads.read(t2.id))!.drafts[0]!.id;
    const results = await Promise.allSettled([svc.sendDraft(t2.id, d2), svc.sendDraft(t2.id, d2)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(gmail.calls.filter((c) => c.fn === "send")).toHaveLength(2);
    // Sent drafts cannot be edited or discarded.
    await expect(svc.editDraft(t.id, draftId, "changed")).rejects.toMatchObject({ status: 400 });
  });

  it("edit and discard; unknown keys and draft ids are 404", async () => {
    const { svc, t, draftId, store } = await withDraft();
    const edited = await svc.editDraft(t.id, draftId, "New body");
    expect(edited.body).toBe("New body");
    expect((await store.threads.read(t.id))!.drafts[0]!.body).toBe("New body");
    await expect(svc.editDraft(t.id, "md_nope", "x")).rejects.toMatchObject({ status: 404 });
    await expect(svc.editDraft("../x", draftId, "x")).rejects.toMatchObject({ status: 404 });
    await expect(svc.discardDraft(t.id, "../x")).rejects.toMatchObject({ status: 404 });
    await expect(svc.saveDraftToGmail("ma_none_x", draftId)).rejects.toMatchObject({ status: 404 });
    await expect(svc.sendDraft(t.id, "md_nope")).rejects.toMatchObject({ status: 404 });
    await svc.discardDraft(t.id, draftId);
    expect((await store.threads.read(t.id))!.drafts).toHaveLength(0);
    await expect(svc.discardDraft(t.id, draftId)).rejects.toMatchObject({ status: 404 });
  });
});

describe("mail draft routes", () => {
  const H = { "x-agenticview-token": "tok", "content-type": "application/json" };

  async function boot(world: { kind: "project"; projectPath: string } | { kind: "hub" }) {
    process.env.AGENTICVIEW_HOME = join(dir, "home");
    const runtimes = new Map<Provider, Runtime>([["claude", new FakeRuntime(async function* () { yield { type: "text", text: "x" }; })]]);
    server = await createServer({ world, token: "tok", runtimes });
    return server;
  }

  it("send requires confirm:true", async () => {
    const proj = join(dir, "proj");
    const s = await boot({ kind: "project", projectPath: proj });
    const a = await s.mail.accounts.save({ email: ME, refreshToken: "rt" });
    const t = thread(a.id, "g1", {
      drafts: [{ id: "md_1", body: "Hello", createdAt: "2026-10-28T00:00:00.000Z", flagged: false }],
    });
    await new MailStore(join(proj, ".agenticview", "mail")).threads.write(t.id, t);
    const url = (d: string, tail = "") => `${s.url}/api/mail/drafts/${t.id}/${d}${tail}`;
    for (const body of [{}, { confirm: "true" }, { confirm: false }, { confirm: 1 }]) {
      expect((await fetch(url("md_1", "/send"), { method: "POST", headers: H, body: JSON.stringify(body) })).status).toBe(400);
    }
    expect((await fetch(url("md_nope", "/send"), { method: "POST", headers: H, body: JSON.stringify({ confirm: true }) })).status).toBe(404);
    expect((await fetch(url("md_nope"), { method: "PUT", headers: H, body: JSON.stringify({ body: "x" }) })).status).toBe(404);
    expect((await fetch(url("md_nope"), { method: "DELETE", headers: H })).status).toBe(404);
    expect((await fetch(url("md_nope", "/save-gmail"), { method: "POST", headers: H })).status).toBe(404);
    const put = await fetch(url("md_1"), { method: "PUT", headers: H, body: JSON.stringify({ body: "Edited" }) });
    expect(put.status).toBe(200);
    expect((await put.json()).body).toBe("Edited");
    expect((await fetch(url("md_1"), { method: "DELETE", headers: H })).status).toBe(200);
  });

  it("send-to-atlas validates its body and starts the manager's request", async () => {
    const proj = join(dir, "proj");
    const s = await boot({ kind: "project", projectPath: proj });
    const a = await s.mail.accounts.save({ email: ME, refreshToken: "rt" });
    const t = thread(a.id, "g1");
    const store = new MailStore(join(proj, ".agenticview", "mail"));
    await store.threads.write(t.id, t);
    const post = (body: unknown) => fetch(`${s.url}/api/mail/send-to-atlas`, { method: "POST", headers: H, body: JSON.stringify(body) });
    expect((await post({ threadKeys: [] })).status).toBe(400);
    expect((await post({ threadKeys: Array.from({ length: 21 }, (_, i) => `k${i}`) })).status).toBe(400);
    expect((await post({ threadKeys: [t.id], note: "x".repeat(2001) })).status).toBe(400);
    expect((await post({ threadKeys: ["ma_x_nope"] })).status).toBe(404);
    const r = await post({ threadKeys: [t.id], note: "Short replies." });
    expect(r.status).toBe(200);
    const req = (await r.json()) as Task;
    expect(req.kind).toBe("request");
    expect(req.assigneeId).toBe(await s.world.registry.managerId());
    expect(req.mail).toEqual({ threadIds: [t.id] });
    expect((await store.threads.read(t.id))!.sentToAtlas.map((x) => x.taskId)).toEqual([req.id]);
  });

  it("send-to-atlas in the hub is a 400 (no project to work in)", async () => {
    const s = await boot({ kind: "hub" });
    const a = await s.mail.accounts.save({ email: ME, refreshToken: "rt" });
    const t = thread(a.id, "g1");
    const store = new MailStore(join(dir, "home", "mail"));
    await store.threads.write(t.id, t);
    const r = await fetch(`${s.url}/api/mail/send-to-atlas`, { method: "POST", headers: H, body: JSON.stringify({ threadKeys: [t.id] }) });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/project/i);
    expect((await store.threads.read(t.id))!.sentToAtlas).toHaveLength(0);
  });
});
