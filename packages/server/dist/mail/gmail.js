import { bodyText, parseAddress } from "./text.js";
const BASE = "https://gmail.googleapis.com/gmail/v1/users/me/";
const BACKOFF_MS = [500, 1000, 2000];
const CONCURRENCY = 8;
const header = (p, name) => p?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
function attachments(p, out = []) {
    if (!p)
        return out;
    if (p.filename)
        out.push({ name: p.filename, size: p.body?.size ?? 0 });
    for (const c of p.parts ?? [])
        attachments(c, out);
    return out;
}
/** Fetch-based Gmail REST client. `token` supplies a fresh access token per request. */
export class GmailClient {
    token;
    fetchImpl;
    constructor(token, fetchImpl = fetch) {
        this.token = token;
        this.fetchImpl = fetchImpl;
    }
    /**
     * One Gmail call. 429 and 5xx are retried with backoff, except that a non-idempotent call (`once`: a send
     * or a draft create) is never retried on 5xx: Google may have accepted it, and a retry could send twice.
     * A 429 means Google did not accept it, so that is retried for every call.
     */
    async request(accountId, path, init = {}) {
        for (let attempt = 0;; attempt++) {
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
                return (text ? JSON.parse(text) : {});
            }
            const retryable = res.status === 429 || (res.status >= 500 && !init.once);
            if (retryable && attempt < BACKOFF_MS.length) {
                await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt]));
                continue;
            }
            throw Object.assign(new Error(`Gmail ${init.method ?? "GET"} ${path.split("?")[0]} failed: ${res.status}`), { status: res.status });
        }
    }
    async profileEmail(accountId) {
        const p = await this.request(accountId, "profile");
        return p.emailAddress;
    }
    async recentSenders(accountId, opts = {}) {
        const scan = opts.scan ?? 300;
        const limit = opts.limit ?? 50;
        const ids = [];
        let pageToken;
        while (ids.length < scan) {
            const qs = new URLSearchParams({ labelIds: "INBOX", maxResults: String(Math.min(500, scan - ids.length)) });
            if (pageToken)
                qs.set("pageToken", pageToken);
            const page = await this.request(accountId, `messages?${qs}`);
            for (const m of page.messages ?? [])
                ids.push(m.id);
            pageToken = page.nextPageToken;
            if (!pageToken || !page.messages?.length)
                break;
        }
        ids.length = Math.min(ids.length, scan);
        const bySender = new Map();
        let next = 0;
        const worker = async () => {
            while (next < ids.length) {
                const id = ids[next++];
                let m;
                try {
                    m = await this.request(accountId, `messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From`);
                }
                catch (e) {
                    if (e.status === 404)
                        continue;
                    throw e;
                }
                const from = header(m.payload, "From");
                if (!from)
                    continue;
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
                }
                else {
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
    async searchThreadIds(accountId, q, max = 100) {
        const out = [];
        const seen = new Set();
        let pageToken;
        while (out.length < max) {
            const qs = new URLSearchParams({ q, maxResults: String(Math.min(500, max)) });
            if (pageToken)
                qs.set("pageToken", pageToken);
            const page = await this.request(accountId, `threads?${qs}`);
            for (const t of page.threads ?? []) {
                if (seen.has(t.id) || out.length >= max)
                    continue;
                seen.add(t.id);
                out.push(t.id);
            }
            pageToken = page.nextPageToken;
            if (!pageToken)
                break;
        }
        return out;
    }
    async getThread(accountId, gmailThreadId, labelNames) {
        const t = await this.request(accountId, `threads/${encodeURIComponent(gmailThreadId)}?format=full`);
        const raw = [...(t.messages ?? [])].sort((a, b) => Number(a.internalDate ?? 0) - Number(b.internalDate ?? 0));
        const labels = new Set();
        const messages = raw.map((m) => {
            for (const l of m.labelIds ?? []) {
                const n = labelNames.get(l);
                if (n)
                    labels.add(n);
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
    async labelNames(accountId) {
        const r = await this.request(accountId, "labels");
        const out = new Map();
        for (const l of r.labels ?? []) {
            if (l.type === "user")
                out.set(l.id, l.name);
            else if (l.id === "STARRED")
                out.set(l.id, "Starred");
            else if (l.id === "IMPORTANT")
                out.set(l.id, "Important");
        }
        return out;
    }
    async ensureLabel(accountId, name) {
        const r = await this.request(accountId, "labels");
        const found = (r.labels ?? []).find((l) => l.name.toLowerCase() === name.toLowerCase());
        if (found)
            return found.id;
        const made = await this.request(accountId, "labels", { method: "POST", body: { name } });
        return made.id;
    }
    async modifyThread(accountId, gmailThreadId, addLabelIds) {
        await this.request(accountId, `threads/${encodeURIComponent(gmailThreadId)}/modify`, {
            method: "POST",
            body: { addLabelIds },
        });
    }
    async createDraft(accountId, gmailThreadId, raw) {
        const d = await this.request(accountId, "drafts", {
            method: "POST",
            once: true,
            body: { message: { raw, threadId: gmailThreadId } },
        });
        return d.id;
    }
    /** Replaces a saved Gmail draft's message (the same draft id, so no second copy). */
    async updateDraft(accountId, draftId, gmailThreadId, raw) {
        await this.request(accountId, `drafts/${encodeURIComponent(draftId)}`, {
            method: "PUT",
            body: { id: draftId, message: { raw, threadId: gmailThreadId } },
        });
    }
    /** Sends a saved Gmail draft; Gmail removes it from Drafts. */
    async sendDraftById(accountId, draftId) {
        await this.request(accountId, "drafts/send", { method: "POST", body: { id: draftId }, once: true });
    }
    /** Deletes a saved Gmail draft; one that is already gone (404) is fine. */
    async deleteDraft(accountId, draftId) {
        try {
            await this.request(accountId, `drafts/${encodeURIComponent(draftId)}`, { method: "DELETE" });
        }
        catch (e) {
            if (e.status !== 404)
                throw e;
        }
    }
    async send(accountId, gmailThreadId, raw) {
        await this.request(accountId, "messages/send", { method: "POST", body: { raw, threadId: gmailThreadId }, once: true });
    }
}
//# sourceMappingURL=gmail.js.map