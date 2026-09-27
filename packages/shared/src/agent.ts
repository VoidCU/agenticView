import { z } from "zod";
import { newId } from "./ids.js";
import { EffortSchema } from "./models.js";
import { AgentSessionSchema } from "./session.js";
import { LimitInfoSchema } from "./limit-info.js";

export const BUILTIN_PROVIDERS = ["claude", "claude-session", "codex", "copilot", "antigravity", "gemini"] as const;
export const BuiltinProviderSchema = z.enum(BUILTIN_PROVIDERS);
export type BuiltinProvider = z.infer<typeof BuiltinProviderSchema>;
/** Prefix of a user-configured provider id ("custom:<slug>"); the slug is the entry's id in config.providers.custom. */
export const CUSTOM_PROVIDER_PREFIX = "custom:";
export type CustomProviderRef = `custom:${string}`;
export const CUSTOM_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
export const CustomProviderRefSchema = z
  .string()
  .regex(/^custom:[a-z0-9][a-z0-9-]{0,31}$/, "custom provider ids look like custom:<slug>") as unknown as z.ZodType<CustomProviderRef>;
/** A built-in provider, or a user-configured OpenAI-/Anthropic-compatible endpoint ("custom:<slug>"). */
export const ProviderSchema = z.union([BuiltinProviderSchema, CustomProviderRefSchema]);
export type Provider = BuiltinProvider | CustomProviderRef;
export function isCustomProvider(p: string | null | undefined): p is CustomProviderRef {
  return typeof p === "string" && p.startsWith(CUSTOM_PROVIDER_PREFIX);
}
export function isBuiltinProvider(p: string | null | undefined): p is BuiltinProvider {
  return typeof p === "string" && (BUILTIN_PROVIDERS as readonly string[]).includes(p);
}
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

/**
 * Revive state machine after a provider failure. For a quota / rate limit (`cause` "limit") the office
 * shows it as a walk: fainted = the agent walks to the Manager's desk and reports the limit; reviving =
 * it stands there while the switch is decided; done = it says "Switching to <switchTo>!" and walks
 * back to its seat while the retried task runs. A crash (`cause` "crash") faints in the lounge instead.
 */
export const AgentReviveSchema = z.object({
  phase: z.enum(["fainted", "reviving", "done"]),
  /** What failed: a quota / rate limit, or a crash. Absent on records from older servers (treated as a limit). */
  cause: z.enum(["limit", "crash"]).optional(),
  /** The provider that hit the limit. */
  failedProvider: ProviderSchema.optional(),
  managerId: z.string().optional(),
  suggested: z.object({ provider: ProviderSchema, model: z.string().optional() }).optional(),
  /** The provider/model the agent is being switched to (set once the decision has landed). */
  switchTo: z.object({ provider: ProviderSchema.nullable(), model: z.string().nullable().optional() }).optional(),
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
  /**
   * Idle behaviour: a short visit to a colleague's desk or the meeting-room whiteboard. Set and cleared
   * by the server (purely random, no model call); the agent keeps its own placement meanwhile.
   */
  visiting: z.object({ targetAgentId: z.string().optional(), spaceId: z.string().optional(), until: z.string() }).optional(),
  /**
   * Wire-only (never persisted): claude-session agents run on the model of the Claude Code session that
   * serves them. The server fills this with that session's reported model so the UI can show it.
   */
  sessionModel: z.string().nullable().optional(),
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
export const PROVIDER_ORDER: readonly BuiltinProvider[] = ["claude", "claude-session", "codex", "copilot", "antigravity", "gemini"];

export const PROVIDER_LABELS: Record<BuiltinProvider, string> = {
  claude: "Claude",
  "claude-session": "Claude Code session",
  codex: "Codex",
  copilot: "GitHub Copilot",
  antigravity: "Antigravity",
  gemini: "Gemini",
};
