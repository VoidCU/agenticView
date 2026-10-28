import { Hono, type Context } from "hono";
import { z } from "zod";
import { MailAmountSchema } from "@agenticview/shared";
import { MailReconnectError, type OAuthFlow } from "./oauth.js";
import { MailHttpError, type MailService } from "./service.js";

const ClientBody = z.union([
  z.null(),
  z.object({ clientId: z.string().trim().min(1).max(1000), clientSecret: z.string().trim().min(1).max(1000) }),
]);

const SourceBody = z.object({
  id: z.string().optional(),
  accountId: z.string().min(1),
  senders: z.array(z.string().max(320)).min(1).max(100),
  amount: MailAmountSchema,
  autoCheck: z.boolean().default(false),
});

const TagBody = z.object({
  id: z.string().optional(),
  name: z.string(),
  color: z.string(),
  meaning: z.string().default(""),
  preferredAgentId: z.string().optional(),
  writeToGmail: z.boolean().default(false),
});

const TagIdsBody = z.object({ tagIds: z.array(z.string()).max(100) });

const SendToAtlasBody = z.object({
  threadKeys: z.array(z.string().max(300)).min(1).max(20),
  note: z.string().max(2000).optional(),
});

const DraftBody = z.object({ body: z.string().max(100_000) });

/** Sending is irreversible: the client must say so explicitly. */
const ConfirmBody = z.object({ confirm: z.literal(true) });

/** Route params are always present on matched routes; `wrap` erases their types. */
const param = (c: Context, k: string): string => c.req.param(k) ?? "";

type Parsed<T> = { ok: true; data: T } | { ok: false; res: Response };

async function body<T>(c: Context, schema: z.ZodType<T>): Promise<Parsed<T>> {
  let json: unknown;
  try {
    json = await c.req.json();
  } catch {
    return { ok: false, res: c.json({ error: "JSON body expected" }, 400) };
  }
  const r = schema.safeParse(json);
  if (!r.success) {
    return { ok: false, res: c.json({ error: `Invalid body: ${r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join(", ")}` }, 400) };
  }
  return { ok: true, data: r.data };
}

/** Maps service errors to `{ error }` responses; a revoked account is 409 with `needsReconnect`. */
function fail(c: Context, e: unknown): Response {
  if (e instanceof MailReconnectError) return c.json({ error: e.message, accountId: e.accountId, needsReconnect: true }, 409);
  if (e instanceof MailHttpError) return c.json({ error: e.message }, e.status);
  const msg = e instanceof Error ? e.message : "Mail request failed";
  // Errors carrying an upstream HTTP status come from Gmail/Google.
  return c.json({ error: msg }, typeof (e as { status?: unknown })?.status === "number" ? 502 : 500);
}

/** Office mail REST API (mounted under the token middleware). Never returns the client secret or tokens. */
export function mailRoutes(mail: MailService, flow: OAuthFlow): Hono {
  const app = new Hono();
  const wrap = (fn: (c: Context) => Promise<Response>) => async (c: Context) => {
    try {
      return await fn(c);
    } catch (e) {
      return fail(c, e);
    }
  };

  app.get("/api/mail/status", wrap(async (c) => c.json(await mail.status())));

  app.put("/api/mail/client", wrap(async (c) => {
    const b = await body(c, ClientBody);
    if (!b.ok) return b.res;
    await mail.setClient(b.data);
    return c.json({ clientConfigured: b.data !== null });
  }));

  app.post("/api/mail/connect", wrap(async (c) => {
    try {
      return c.json(await flow.start());
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  }));

  app.delete("/api/mail/accounts/:id", wrap(async (c) => {
    await mail.removeAccount(param(c, "id"));
    return c.json({ ok: true });
  }));

  app.get("/api/mail/accounts/:id/senders", wrap(async (c) => c.json(await mail.senders(param(c, "id")))));

  app.get("/api/mail/sources", wrap(async (c) => c.json(await mail.listSources())));
  app.post("/api/mail/sources", wrap(async (c) => {
    const b = await body(c, SourceBody);
    if (!b.ok) return b.res;
    return c.json(await mail.upsertSource(b.data));
  }));
  app.delete("/api/mail/sources/:id", wrap(async (c) => {
    await mail.removeSource(param(c, "id"));
    return c.json({ ok: true });
  }));
  app.post("/api/mail/sources/:id/pull", wrap(async (c) => c.json(await mail.pull(param(c, "id")))));

  app.get("/api/mail/threads", wrap(async (c) => {
    const q = (k: string) => c.req.query(k) || undefined;
    return c.json(await mail.listThreads({
      accountId: q("accountId"),
      sender: q("sender"),
      tag: q("tag"),
      label: q("label"),
      notSent: c.req.query("notSent") === "1",
    }));
  }));
  app.get("/api/mail/threads/:key", wrap(async (c) => {
    const t = await mail.getThread(param(c, "key"));
    return t ? c.json(t) : c.json({ error: "Unknown thread" }, 404);
  }));
  app.put("/api/mail/threads/:key/tags", wrap(async (c) => {
    const b = await body(c, TagIdsBody);
    if (!b.ok) return b.res;
    return c.json(await mail.setThreadTags(param(c, "key"), b.data.tagIds));
  }));

  app.post("/api/mail/send-to-atlas", wrap(async (c) => {
    const b = await body(c, SendToAtlasBody);
    if (!b.ok) return b.res;
    const managerId = mail.managerId();
    if (!managerId) return c.json({ error: "This office has no manager to send mail to" }, 400);
    return c.json(await mail.sendToAtlas({ threadKeys: b.data.threadKeys, ...(b.data.note !== undefined ? { note: b.data.note } : {}), managerId }));
  }));

  app.put("/api/mail/drafts/:key/:draftId", wrap(async (c) => {
    const b = await body(c, DraftBody);
    if (!b.ok) return b.res;
    return c.json(await mail.editDraft(param(c, "key"), param(c, "draftId"), b.data.body));
  }));
  app.delete("/api/mail/drafts/:key/:draftId", wrap(async (c) => {
    await mail.discardDraft(param(c, "key"), param(c, "draftId"));
    return c.json({ ok: true });
  }));
  app.post("/api/mail/drafts/:key/:draftId/save-gmail", wrap(async (c) => c.json(await mail.saveDraftToGmail(param(c, "key"), param(c, "draftId")))));
  app.post("/api/mail/drafts/:key/:draftId/send", wrap(async (c) => {
    const b = await body(c, ConfirmBody);
    if (!b.ok) return c.json({ error: "Sending needs { confirm: true }" }, 400);
    return c.json(await mail.sendDraft(param(c, "key"), param(c, "draftId")));
  }));

  app.get("/api/mail/tags", wrap(async (c) => c.json(await mail.listTags())));
  app.post("/api/mail/tags", wrap(async (c) => {
    const b = await body(c, TagBody);
    if (!b.ok) return b.res;
    return c.json(await mail.upsertTag(b.data));
  }));
  app.delete("/api/mail/tags/:id", wrap(async (c) => {
    await mail.removeTag(param(c, "id"));
    return c.json({ ok: true });
  }));

  return app;
}
