import { z } from "zod";

/** A connected Gmail account (public/wire shape; tokens never leave the server). */
export const MailAccountSchema = z.object({
  id: z.string(),
  email: z.string(),
  connectedAt: z.string(),
  needsReconnect: z.boolean().optional(),
});
export type MailAccount = z.infer<typeof MailAccountSchema>;

const DateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** How much mail a source pulls. */
export const MailAmountSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("latest"), n: z.number().int().min(1).max(500).default(50) }),
  z.object({ kind: z.literal("days"), days: z.number().int().min(1).max(3650) }),
  z.object({ kind: z.literal("range"), from: DateOnly, to: DateOnly }),
  z.object({ kind: z.literal("sinceLast") }),
]);
export type MailAmount = z.infer<typeof MailAmountSchema>;

export const MailSourceSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  /** Lower-cased sender emails. */
  senders: z.array(z.string()).min(1),
  amount: MailAmountSchema,
  autoCheck: z.boolean().default(false),
  lastPulledAt: z.string().optional(),
});
export type MailSource = z.infer<typeof MailSourceSchema>;

export const MailMessageSchema = z.object({
  id: z.string(),
  from: z.string(),
  fromEmail: z.string(),
  to: z.string(),
  cc: z.string().optional(),
  /** ISO timestamp. */
  date: z.string(),
  text: z.string(),
  messageIdHeader: z.string().optional(),
  attachments: z.array(z.object({ name: z.string(), size: z.number() })),
});
export type MailMessage = z.infer<typeof MailMessageSchema>;

export const MailDraftSchema = z.object({
  id: z.string(),
  body: z.string(),
  createdAt: z.string(),
  taskId: z.string().optional(),
  agentId: z.string().optional(),
  flagged: z.boolean(),
  gmailDraftId: z.string().optional(),
  sentAt: z.string().optional(),
});
export type MailDraft = z.infer<typeof MailDraftSchema>;

export const MailThreadSchema = z.object({
  /** `${accountId}_${gmailThreadId}`; also the JsonStore id. */
  id: z.string(),
  accountId: z.string(),
  gmailThreadId: z.string(),
  subject: z.string(),
  /** Oldest first. */
  messages: z.array(MailMessageSchema),
  /** Gmail label names. */
  gmailLabels: z.array(z.string()),
  /** MailTag ids. */
  tags: z.array(z.string()),
  sentToAtlas: z.array(z.object({ taskId: z.string(), at: z.string() })),
  /** Newest first. */
  drafts: z.array(MailDraftSchema),
  updatedAt: z.string(),
});
export type MailThread = z.infer<typeof MailThreadSchema>;

export const MailTagSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(40),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  meaning: z.string().max(200),
  preferredAgentId: z.string().optional(),
  writeToGmail: z.boolean().default(false),
});
export type MailTag = z.infer<typeof MailTagSchema>;

export const MailSenderSchema = z.object({
  email: z.string(),
  name: z.string(),
  count: z.number(),
  lastDate: z.string(),
});
export type MailSender = z.infer<typeof MailSenderSchema>;
