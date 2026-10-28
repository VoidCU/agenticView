import { z } from "zod";
/** A connected Gmail account (public/wire shape; tokens never leave the server). */
export declare const MailAccountSchema: z.ZodObject<{
    id: z.ZodString;
    email: z.ZodString;
    connectedAt: z.ZodString;
    needsReconnect: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export type MailAccount = z.infer<typeof MailAccountSchema>;
/** How much mail a source pulls. */
export declare const MailAmountSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"latest">;
    n: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"days">;
    days: z.ZodNumber;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"range">;
    from: z.ZodString;
    to: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"sinceLast">;
}, z.core.$strip>], "kind">;
export type MailAmount = z.infer<typeof MailAmountSchema>;
export declare const MailSourceSchema: z.ZodObject<{
    id: z.ZodString;
    accountId: z.ZodString;
    senders: z.ZodArray<z.ZodString>;
    amount: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"latest">;
        n: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"days">;
        days: z.ZodNumber;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"range">;
        from: z.ZodString;
        to: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"sinceLast">;
    }, z.core.$strip>], "kind">;
    autoCheck: z.ZodDefault<z.ZodBoolean>;
    lastPulledAt: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type MailSource = z.infer<typeof MailSourceSchema>;
export declare const MailMessageSchema: z.ZodObject<{
    id: z.ZodString;
    from: z.ZodString;
    fromEmail: z.ZodString;
    to: z.ZodString;
    cc: z.ZodOptional<z.ZodString>;
    date: z.ZodString;
    text: z.ZodString;
    messageIdHeader: z.ZodOptional<z.ZodString>;
    attachments: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        size: z.ZodNumber;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type MailMessage = z.infer<typeof MailMessageSchema>;
export declare const MailDraftSchema: z.ZodObject<{
    id: z.ZodString;
    body: z.ZodString;
    createdAt: z.ZodString;
    taskId: z.ZodOptional<z.ZodString>;
    agentId: z.ZodOptional<z.ZodString>;
    flagged: z.ZodBoolean;
    gmailDraftId: z.ZodOptional<z.ZodString>;
    sentAt: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type MailDraft = z.infer<typeof MailDraftSchema>;
export declare const MailThreadSchema: z.ZodObject<{
    id: z.ZodString;
    accountId: z.ZodString;
    gmailThreadId: z.ZodString;
    subject: z.ZodString;
    messages: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        from: z.ZodString;
        fromEmail: z.ZodString;
        to: z.ZodString;
        cc: z.ZodOptional<z.ZodString>;
        date: z.ZodString;
        text: z.ZodString;
        messageIdHeader: z.ZodOptional<z.ZodString>;
        attachments: z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            size: z.ZodNumber;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    gmailLabels: z.ZodArray<z.ZodString>;
    tags: z.ZodArray<z.ZodString>;
    sentToAtlas: z.ZodArray<z.ZodObject<{
        taskId: z.ZodString;
        at: z.ZodString;
    }, z.core.$strip>>;
    drafts: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        body: z.ZodString;
        createdAt: z.ZodString;
        taskId: z.ZodOptional<z.ZodString>;
        agentId: z.ZodOptional<z.ZodString>;
        flagged: z.ZodBoolean;
        gmailDraftId: z.ZodOptional<z.ZodString>;
        sentAt: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    updatedAt: z.ZodString;
}, z.core.$strip>;
export type MailThread = z.infer<typeof MailThreadSchema>;
export declare const MailTagSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    color: z.ZodString;
    meaning: z.ZodString;
    preferredAgentId: z.ZodOptional<z.ZodString>;
    writeToGmail: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>;
export type MailTag = z.infer<typeof MailTagSchema>;
export declare const MailSenderSchema: z.ZodObject<{
    email: z.ZodString;
    name: z.ZodString;
    count: z.ZodNumber;
    lastDate: z.ZodString;
}, z.core.$strip>;
export type MailSender = z.infer<typeof MailSenderSchema>;
