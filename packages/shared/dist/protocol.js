import { z } from "zod";
import { AgentSchema, ProviderSchema, ToolAllowanceSchema, PermissionModeSchema, ScopeSchema } from "./agent.js";
import { EffortSchema } from "./models.js";
import { ProjectSettingsSchema, KnownProjectSchema } from "./settings.js";
import { AgentSessionSchema, MAX_SESSION_CAPACITY } from "./session.js";
export const ProviderStatusSchema = z.object({
    provider: ProviderSchema,
    ok: z.boolean(),
    version: z.string().optional(),
    reason: z.string().optional(),
});
export const WorldInfoSchema = z.object({
    kind: z.enum(["project", "hub"]),
    name: z.string(),
    projectPath: z.string().nullable(),
    knownProjects: z.array(KnownProjectSchema),
});
export const CreateAgentPayloadSchema = z.object({
    name: z.string().min(1).max(40),
    specialty: z.string().max(120),
    description: z.string().optional(),
    provider: ProviderSchema.nullable().optional(),
    model: z.string().nullable().optional(),
    effort: EffortSchema.nullable().optional(),
    systemPrompt: z.string().optional(),
    tools: ToolAllowanceSchema.optional(),
    permissionMode: PermissionModeSchema.optional(),
    scope: ScopeSchema.optional(),
    session: AgentSessionSchema.nullable().optional(),
    appearance: AgentSchema.shape.appearance.optional(),
});
// Explicit optional overrides: partial() would still apply the defaults and wipe fields a patch omits.
export const AgentPatchSchema = AgentSchema.partial().omit({ id: true, role: true, scope: true, stats: true, createdAt: true, updatedAt: true, originId: true }).extend({
    description: z.string().max(2000).optional(),
    systemPrompt: z.string().max(20000).optional(),
});
export const ClientMessageSchema = z.discriminatedUnion("type", [
    z.object({ type: z.literal("snapshot.request") }),
    z.object({
        type: z.literal("chat.send"),
        agentId: z.string(),
        text: z.string().min(1),
        images: z.array(z.string()).default([]),
        projectPath: z.string().optional(),
    }),
    z.object({ type: z.literal("agent.create"), agent: CreateAgentPayloadSchema }),
    z.object({ type: z.literal("agent.update"), id: z.string(), patch: AgentPatchSchema }),
    z.object({ type: z.literal("agent.copyToProject"), id: z.string() }),
    z.object({ type: z.literal("agent.delete"), id: z.string() }),
    z.object({ type: z.literal("task.cancel"), id: z.string() }),
    z.object({ type: z.literal("permission.respond"), id: z.string(), allow: z.boolean() }),
    z.object({ type: z.literal("question.respond"), id: z.string(), answer: z.string() }),
    z.object({ type: z.literal("settings.update"), settings: ProjectSettingsSchema.partial() }),
    z.object({ type: z.literal("project.open"), path: z.string() }),
    z.object({ type: z.literal("session.rename"), id: z.string().min(1).max(64), name: z.string().trim().min(1).max(60) }),
    z.object({ type: z.literal("session.forget"), id: z.string().min(1).max(64) }),
    z.object({ type: z.literal("session.capacity"), id: z.string().min(1).max(64), capacity: z.number().int().min(1).max(MAX_SESSION_CAPACITY) }),
]);
//# sourceMappingURL=protocol.js.map