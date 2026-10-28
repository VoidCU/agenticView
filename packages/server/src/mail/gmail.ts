import type { MailMessage, MailSender, MailThread } from "@agenticview/shared";
import { bodyText, parseAddress, type GmailPayload } from "./text.js";

const BASE = "https://gmail.googleapis.com/gmail/v1/users/me/";
const BACKOFF_MS = [500, 1000, 2000];
const CONCURRENCY = 8;

type RawMessage = {
  id: string;
  threadId?: string;
  internalDate?: string;
  labelIds?: string[];
  payload?: GmailPayload;
};

const header = (p: GmailPayload | undefined, name: string): string | undefined =>
  p?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;

function attachments(p: GmailPayload | undefined, out: { name: string; size: number }[] = []) {
  if (!p) return out;
  if (p.filename) out.push({ name: p.filename, size: p.body?.size ?? 0 });
  for (const c of p.parts ?? []) attachments(c, out);
  return out;
}

/** Fetch-based Gmail REST client. `token` supplies a fresh access token per request. */
export class GmailClient {
  constructor(
    private readonly token: (accountId: string) => Promise<string>,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async request<T>(accountId: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const token = await this.token(accountId);
      const res = await this.fetchImpl(BASE + path, {
        method: init.method ?? "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      });
      if (res.ok) {
        const text = await res.text();
        return (text ? JSON.parse(text) : {}) as T;
      }
      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt < BACKOFF_MS.length) {
        await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt]));
        continue;
      }
      throw Object.assign(new Error(`Gmail ${init.method ?? "GET"} ${path.split("?")[0]} failed: ${res.status}`), { status: res.status });
    }
  }

  async profileEmail(accountId: string): Promise<string> {
    const p = await this.request<{ emailAddress: string }>(accountId, "profile");
    return p.emailAddress;
  }

  async recentSenders(accountId: string, opts: { scan?: number; limit?: number } = {}): Promise<MailSender[]> {
    const scan = opts.scan ?? 300;
    const limit = opts.limit ?? 50;
    const ids: string[] = [];
    let pageToken: string | undefined;
    while (ids.length < scan) {
      const qs = new URLSearchParams({ labelIds: "INBOX", maxResults: String(Math.min(500, scan - ids.length)) });
      if (pageToken) qs.set("pageToken", pageToken);
      const page = await this.request<{ messages?: { id: string }[]; nextPageToken?: string }>(
        accountId,
        `messages?${qs}`,
      );
      for (const m of page.messages ?? []) ids.push(m.id);
      pageToken = page.nextPageToken;
      if (!pageToken || !page.messages?.length) break;
    }
    ids.length = Math.min(ids.length, scan);

    const bySender = new Map<string, MailSender & { at: number }>();
    let next = 0;
    const worker = async () => {
      while (next < ids.length) {
        const id = ids[next++]!;
        let m: RawMessage;
        try {
          m = await this.request<RawMessage>(
            accountId,
            `messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From`,
          );
        } catch (e) {
          if ((e as { status?: number }).status === 404) continue;
          throw e;
        }
        const from = header(m.payload, "From");
        if (!from) continue;
        const { name, email } = parseAddress(from);
        const at = Number(m.internalDate ?? 0);
        const cur = bySender.get(email);
        if (cur) {
          cur.count++;
          if (at > cur.at) {
            cur.at = at;
            cur.lastDate = new Date(at).toISOString();
            cur.name = name;
          }
        } else {
          bySender.set(email, { email, name, count: 1, lastDate: new Date(at).toISOString(), at });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker));

    return [...bySender.values()]
      .sort((a, b) => b.at - a.at)
      .slice(0, limit)
      .map(({ at: _at, ...s }) => s);
  }

  async searchThreadIds(accountId: string, q: string, max = 100): Promise<string[]> {
    const out: string[] = [];
    const seen = new Set<string>();
    let pageToken: string | undefined;
    while (out.length < max) {
      const qs = new URLSearchParams({ q, maxResults: String(Math.min(500, max)) });
      if (pageToken) qs.set("pageToken", pageToken);
      const page = await this.request<{ threads?: { id: string }[]; nextPageToken?: string }>(
        accountId,
        `threads?${qs}`,
      );
      for (const t of page.threads ?? []) {
        if (seen.has(t.id) || out.length >= max) continue;
        seen.add(t.id);
        out.push(t.id);
      }
      pageToken = page.nextPageToken;
      if (!pageToken) break;
    }
    return out;
  }

  async getThread(
    accountId: string,
    gmailThreadId: string,
    labelNames: Map<string, string>,
  ): Promise<Omit<MailThread, "tags" | "sentToAtlas" | "drafts">> {
    const t = await this.request<{ messages?: RawMessage[] }>(
      accountId,
      `threads/${encodeURIComponent(gmailThreadId)}?format=full`,
    );
    const raw = [...(t.messages ?? [])].sort((a, b) => Number(a.internalDate ?? 0) - Number(b.internalDate ?? 0));
    const labels = new Set<string>();
    const messages: MailMessage[] = raw.map((m) => {
      for (const l of m.labelIds ?? []) {
        const n = labelNames.get(l);
        if (n) labels.add(n);
      }
      const from = parseAddress(header(m.payload, "From") ?? "");
      const cc = header(m.payload, "Cc");
      const mid = header(m.payload, "Message-ID");
      return {
        id: m.id,
        from: from.name,
        fromEmail: from.email,
        to: header(m.payload, "To") ?? "",
        ...(cc ? { cc } : {}),
        date: new Date(Number(m.internalDate ?? 0)).toISOString(),
        text: m.payload ? bodyText(m.payload) : "",
        ...(mid ? { messageIdHeader: mid } : {}),
        attachments: attachments(m.payload),
      };
    });
    return {
      id: `${accountId}_${gmailThreadId}`,
      accountId,
      gmailThreadId,
      subject: header(raw[0]?.payload, "Subject") ?? "",
      messages,
      gmailLabels: [...labels],
      updatedAt: messages.at(-1)?.date ?? new Date(0).toISOString(),
    };
  }

  async labelNames(accountId: string): Promise<Map<string, string>> {
    const r = await this.request<{ labels?: { id: string; name: string; type?: string }[] }>(accountId, "labels");
    const out = new Map<string, string>();
    for (const l of r.labels ?? []) {
      if (l.type === "user") out.set(l.id, l.name);
      else if (l.id === "STARRED") out.set(l.id, "Starred");
      else if (l.id === "IMPORTANT") out.set(l.id, "Important");
    }
    return out;
  }

  async ensureLabel(accountId: string, name: string): Promise<string> {
    const r = await this.request<{ labels?: { id: string; name: string }[] }>(accountId, "labels");
    const found = (r.labels ?? []).find((l) => l.name.toLowerCase() === name.toLowerCase());
    if (found) return found.id;
    const made = await this.request<{ id: string }>(accountId, "labels", { method: "POST", body: { name } });
    return made.id;
  }

  async modifyThread(accountId: string, gmailThreadId: string, addLabelIds: string[]): Promise<void> {
    await this.request(accountId, `threads/${encodeURIComponent(gmailThreadId)}/modify`, {
      method: "POST",
      body: { addLabelIds },
    });
  }

  async createDraft(accountId: string, gmailThreadId: string, raw: string): Promise<string> {
    const d = await this.request<{ id: string }>(accountId, "drafts", {
      method: "POST",
      body: { message: { raw, threadId: gmailThreadId } },
    });
    return d.id;
  }

  /** Replaces a saved Gmail draft's message (the same draft id, so no second copy). */
  async updateDraft(accountId: string, draftId: string, gmailThreadId: string, raw: string): Promise<void> {
    await this.request(accountId, `drafts/${encodeURIComponent(draftId)}`, {
      method: "PUT",
      body: { id: draftId, message: { raw, threadId: gmailThreadId } },
    });
  }

  /** Sends a saved Gmail draft; Gmail removes it from Drafts. */
  async sendDraftById(accountId: string, draftId: string): Promise<void> {
    await this.request(accountId, "drafts/send", { method: "POST", body: { id: draftId } });
  }

  /** Deletes a saved Gmail draft; one that is already gone (404) is fine. */
  async deleteDraft(accountId: string, draftId: string): Promise<void> {
    try {
      await this.request(accountId, `drafts/${encodeURIComponent(draftId)}`, { method: "DELETE" });
    } catch (e) {
      if ((e as { status?: number }).status !== 404) throw e;
    }
  }

  async send(accountId: string, gmailThreadId: string, raw: string): Promise<void> {
    await this.request(accountId, "messages/send", { method: "POST", body: { raw, threadId: gmailThreadId } });
  }
}
