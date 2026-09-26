import { z } from "zod";
import { newId } from "./ids.js";
import { EffortSchema } from "./models.js";
import { AgentSessionSchema } from "./session.js";
import { LimitInfoSchema } from "./limit-info.js";

export const ProviderSchema = z.enum(["claude", "claude-session", "codex", "antigravity", "gemini"]);
export type Provider = z.infer<typeof ProviderSchema>;
export const RoleSchema = z.enum(["manager", "worker"]);
export type Role = z.infer<typeof RoleSchema>;
export const ScopeSchema = z.enum(["project", "global"]);
export type Scope = z.infer<typeof ScopeSchema>;
export const PermissionModeSchema = z.enum(["ask", "auto-edit", "auto"]);
export type PermissionMode = z.infer<typeof PermissionModeSchema>;

export const ToolAllowanceSchema = z.object({
  edit: z.boolean(),
  shell: z.boolean(),
  web: z.boolean(),
  screenshot: z.boolean(),
});
export type ToolAllowance = z.infer<typeof ToolAllowanceSchema>;

export const AgentStatsSchema = z.object({
  xp: z.number().int().min(0),
  level: z.number().int().min(1),
  tasksDone: z.number().int().min(0),
  tasksFailed: z.number().int().min(0),
});
export type AgentStats = z.infer<typeof AgentStatsSchema>;

export const AppearanceSchema = z.object({
  color: z.string(),
  accent: z.string(),
  eyes: z.enum(["round", "visor", "dots"]),
});
export type Appearance = z.infer<typeof AppearanceSchema>;

export const PlacementSchema = z.object({
  /** Space id from the office honeycomb, e.g. "pod-a", "meeting". */
  space: z.string().min(1).max(40),
  seat: z.number().int().min(0).max(31),
});
export type Placement = z.infer<typeof PlacementSchema>;

export const AgentReviveSchema = z.object({
  phase: z.enum(["fainted", "reviving", "done"]),
  managerId: z.string().optional(),
  suggested: z.object({ provider: ProviderSchema, model: z.string().optional() }).optional(),
  failedTaskId: z.string().optional(),
  resetAt: z.string().optional(),
});
export type AgentRevive = z.infer<typeof AgentReviveSchema>;

export const AgentSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(40),
  role: RoleSchema,
  scope: ScopeSchema,
  specialty: z.string().max(120),
  description: z.string().max(2000).default(""),
  provider: ProviderSchema.nullable(),
  model: z.string().nullable(),
  effort: EffortSchema.nullable().optional(),
  systemPrompt: z.string().max(20000).default(""),
  tools: ToolAllowanceSchema,
  permissionMode: PermissionModeSchema,
  appearance: AppearanceSchema,
  stats: AgentStatsSchema,
  originId: z.string().optional(),
  /** Which space and desk a worker sits at in the office. */
  placement: PlacementSchema.optional(),
  /** claude-session agents: the Claude Code session that serves this agent (sticky; null = any free session). */
  session: AgentSessionSchema.nullable().optional(),
  /** Rate limit, quota or auth failure state for this agent. */
  limit: LimitInfoSchema.optional(),
  /** Revive state machine: set when the agent's provider hit a limit and a revival is in progress. */
  revive: AgentReviveSchema.optional(),
  /** True when the worker has been idle long enough to be in the lounge. Cleared when assigned a task. */
  lounging: z.boolean().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Agent = z.infer<typeof AgentSchema>;

export const PALETTE = ["#5b8cff", "#ff7a59", "#3ddc97", "#ffc857", "#b084f5", "#ff5fa2", "#4fd1ff"] as const;

export const MANAGER_TOOLS: ToolAllowance = { edit: false, shell: false, web: false, screenshot: false };
export const WORKER_TOOLS: ToolAllowance = { edit: true, shell: true, web: false, screenshot: false };

export type AgentInit = { name: string; role: Role; scope: Scope; specialty: string } & Partial<Omit<Agent, "name" | "role" | "scope" | "specialty">>;

export function defaultAgent(init: AgentInit): Agent {
  const now = new Date().toISOString();
  const isManager = init.role === "manager";
  const color = init.appearance?.color ?? PALETTE[Math.floor(Math.random() * PALETTE.length)]!;
  const agent: Agent = {
    id: init.id ?? newId(isManager ? "m" : "w"),
    name: init.name,
    role: init.role,
    scope: init.scope,
    specialty: init.specialty,
    description: init.description ?? "",
    provider: init.provider ?? null,
    model: init.model ?? null,
    effort: init.effort ?? null,
    systemPrompt: init.systemPrompt ?? "",
    tools: init.tools ?? (isManager ? { ...MANAGER_TOOLS } : { ...WORKER_TOOLS }),
    permissionMode: init.permissionMode ?? (isManager ? "auto" : "auto-edit"),
    appearance: init.appearance ?? { color, accent: isManager ? "#ffd166" : "#ffffff", eyes: isManager ? "visor" : "round" },
    stats: init.stats ?? { xp: 0, level: 1, tasksDone: 0, tasksFailed: 0 },
    createdAt: init.createdAt ?? now,
    updatedAt: init.updatedAt ?? now,
  };
  if (init.originId) agent.originId = init.originId;
  if (init.session) agent.session = init.session;
  if (init.limit) agent.limit = init.limit;
  return agent;
}

/** Automatic provider resolution order: the first provider whose check() is ok wins. */
export const PROVIDER_ORDER: readonly Provider[] = ["claude", "claude-session", "codex", "antigravity", "gemini"];

export const PROVIDER_LABELS: Record<Provider, string> = {
  claude: "Claude",
  "claude-session": "Claude Code session",
  codex: "Codex",
  antigravity: "Antigravity",
  gemini: "Gemini",
};
