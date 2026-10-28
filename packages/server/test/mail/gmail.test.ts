import { describe, it, expect, vi, afterEach } from "vitest";
import { GmailClient } from "../../src/mail/gmail.js";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const b64 = (s: string) => Buffer.from(s).toString("base64url");

type Call = { url: string; method: string; body?: string; auth?: string };
function fake(route: (url: URL, init: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const impl = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({
      url: String(input),
      method: init.method ?? "GET",
      body: init.body as string | undefined,
      auth: (init.headers as Record<string, string> | undefined)?.Authorization,
    });
    return route(url, init);
  }) as unknown as typeof fetch;
  return { impl, calls };
}
const client = (impl: typeof fetch) => new GmailClient(async () => "tok", impl);

afterEach(() => vi.useRealTimers());

describe("GmailClient", () => {
  it("recentSenders groups by address, sorts by most recent, caps at limit", async () => {
    const msgs: Record<string, { from: string; at: number }> = {
      m1: { from: "Ann <ann@x.com>", at: 1000 },
      m2: { from: "Bob <bob@x.com>", at: 5000 },
      m3: { from: "Ann <ANN@x.com>", at: 3000 },
      m4: { from: "cat@x.com", at: 2000 },
      m5: { from: "Bob <bob@x.com>", at: 4000 },
    };
    const { impl, calls } = fake((url) => {
      if (url.pathname.endsWith("/messages")) {
        return json({ messages: Object.keys(msgs).map((id) => ({ id, threadId: "t" + id })) });
      }
      const id = url.pathname.split("/").pop()!;
      const m = msgs[id]!;
      return json({ id, internalDate: String(m.at), payload: { headers: [{ name: "From", value: m.from }] } });
    });
    const gc = client(impl);
    const all = await gc.recentSenders("a1");
    expect(all.map((s) => [s.email, s.count])).toEqual([
      ["bob@x.com", 2],
      ["ann@x.com", 2],
      ["cat@x.com", 1],
    ]);
    expect(all[0]!.name).toBe("Bob");
    expect(all[0]!.lastDate).toBe(new Date(5000).toISOString());
    expect(calls[0]!.auth).toBe("Bearer tok");
    expect(calls.some((c) => c.url.includes("format=metadata") && c.url.includes("metadataHeaders=From"))).toBe(true);
    expect(await gc.recentSenders("a1", { limit: 2 })).toHaveLength(2);
  });

  it("searchThreadIds pages and dedupes", async () => {
    const { impl, calls } = fake((url) => {
      if (url.searchParams.get("pageToken") === "p2") return json({ threads: [{ id: "t2" }, { id: "t3" }] });
      return json({ threads: [{ id: "t1" }, { id: "t2" }], nextPageToken: "p2" });
    });
    const ids = await client(impl).searchThreadIds("a1", "from:x");
    expect(ids).toEqual(["t1", "t2", "t3"]);
    expect(calls[0]!.url).toContain("q=from%3Ax");
    const capped = await client(impl).searchThreadIds("a1", "from:x", 2);
    expect(capped).toEqual(["t1", "t2"]);
  });

  it("getThread maps headers, labels, attachments and oldest-first order", async () => {
    const { impl } = fake(() =>
      json({
        id: "gt",
        messages: [
          {
            id: "m2",
            internalDate: "2000",
            labelIds: ["INBOX", "Label_1", "Nope"],
            payload: {
              mimeType: "multipart/mixed",
              headers: [
                { name: "From", value: "Bob <bob@x.com>" },
                { name: "To", value: "me@x.com" },
                { name: "Cc", value: "c@x.com" },
                { name: "Subject", value: "Re: Hi" },
                { name: "Message-ID", value: "<2@x>" },
              ],
              parts: [
                { mimeType: "text/plain", body: { data: b64("second") } },
                { mimeType: "application/pdf", filename: "a.pdf", body: { size: 42 } },
              ],
            },
          },
          {
            id: "m1",
            internalDate: "1000",
            labelIds: ["STARRED"],
            payload: {
              mimeType: "text/plain",
              headers: [
                { name: "From", value: "Ann <ann@x.com>" },
                { name: "To", value: "me@x.com" },
                { name: "Subject", value: "Hi" },
              ],
              body: { data: b64("first") },
            },
          },
        ],
      }),
    );
    const names = new Map([
      ["Label_1", "Clients"],
      ["STARRED", "Starred"],
    ]);
    const t = await client(impl).getThread("a1", "gt", names);
    expect(t.id).toBe("a1_gt");
    expect(t.accountId).toBe("a1");
    expect(t.gmailThreadId).toBe("gt");
    expect(t.subject).toBe("Hi");
    expect(t.messages.map((m) => m.id)).toEqual(["m1", "m2"]);
    const m2 = t.messages[1]!;
    expect(m2).toMatchObject({
      from: "Bob",
      fromEmail: "bob@x.com",
      to: "me@x.com",
      cc: "c@x.com",
      text: "second",
      messageIdHeader: "<2@x>",
      date: new Date(2000).toISOString(),
      attachments: [{ name: "a.pdf", size: 42 }],
    });
    expect(t.messages[0]!.cc).toBeUndefined();
    expect([...t.gmailLabels].sort()).toEqual(["Clients", "Starred"]);
    expect(t.updatedAt).toBe(new Date(2000).toISOString());
  });

  it("retries 429 then succeeds", async () => {
    vi.useFakeTimers();
    let n = 0;
    const { impl, calls } = fake(() => (++n < 3 ? json({}, 429) : json({ emailAddress: "me@x.com" })));
    const p = client(impl).profileEmail("a1");
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await p).toBe("me@x.com");
    expect(calls).toHaveLength(3);
  });

  it("fails after three retries", async () => {
    vi.useFakeTimers();
    const { impl, calls } = fake(() => json({}, 503));
    const p = client(impl).profileEmail("a1");
    const assertion = expect(p).rejects.toThrow(/503/);
    await vi.advanceTimersByTimeAsync(3500);
    await assertion;
    expect(calls).toHaveLength(4);
  });

  it("labelNames maps ids and ensureLabel creates when missing", async () => {
    const { impl, calls } = fake((_url, init) => {
      if (init.method === "POST") return json({ id: "L9", name: "Atlas" });
      return json({
        labels: [
          { id: "L1", name: "Clients", type: "user" },
          { id: "STARRED", name: "STARRED", type: "system" },
          { id: "INBOX", name: "INBOX", type: "system" },
        ],
      });
    });
    const gc = client(impl);
    const names = await gc.labelNames("a1");
    expect(names.get("L1")).toBe("Clients");
    expect(names.get("STARRED")).toBe("Starred");
    expect(names.has("INBOX")).toBe(false);
    expect(await gc.ensureLabel("a1", "clients")).toBe("L1");
    expect(await gc.ensureLabel("a1", "Atlas")).toBe("L9");
    expect(JSON.parse(calls.at(-1)!.body!)).toMatchObject({ name: "Atlas" });
  });

  it("createDraft posts message.raw and threadId", async () => {
    const { impl, calls } = fake(() => json({ id: "d1" }));
    expect(await client(impl).createDraft("a1", "gt", "RAWDATA")).toBe("d1");
    const c = calls[0]!;
    expect(c.method).toBe("POST");
    expect(c.url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/drafts");
    expect(JSON.parse(c.body!)).toEqual({ message: { raw: "RAWDATA", threadId: "gt" } });
  });

  it("send and modifyThread post the right bodies", async () => {
    const { impl, calls } = fake(() => json({}));
    const gc = client(impl);
    await gc.send("a1", "gt", "RAW");
    await gc.modifyThread("a1", "gt", ["L1"]);
    expect(JSON.parse(calls[0]!.body!)).toEqual({ raw: "RAW", threadId: "gt" });
    expect(calls[1]!.url).toContain("/threads/gt/modify");
    expect(JSON.parse(calls[1]!.body!)).toEqual({ addLabelIds: ["L1"] });
  });
});
