import { z } from "zod";
import { AgentSchema, ProviderSchema, ToolAllowanceSchema, PermissionModeSchema, ScopeSchema } from "./agent.js";
import { ProjectSettingsSchema, KnownProjectSchema } from "./settings.js";
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
    systemPrompt: z.string().optional(),
    tools: ToolAllowanceSchema.optional(),
    permissionMode: PermissionModeSchema.optional(),
    scope: ScopeSchema.optional(),
    appearance: AgentSchema.shape.appearance.optional(),
});
export const AgentPatchSchema = AgentSchema.partial().omit({ id: true, role: true, scope: true, stats: true, createdAt: true, updatedAt: true, originId: true });
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
]);
//# sourceMappingURL=protocol.js.map