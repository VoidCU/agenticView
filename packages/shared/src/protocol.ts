import { z } from "zod";
import { AgentSchema, ProviderSchema, ToolAllowanceSchema, PermissionModeSchema, ScopeSchema, type Agent, type Provider } from "./agent.js";
import { type Task } from "./task.js";
import { EffortSchema } from "./models.js";
import { ProjectSettingsSchema, KnownProjectSchema, type ProjectSettings } from "./settings.js";
import type { RunEvent } from "./runtime.js";
import { AgentSessionSchema, MAX_SESSION_CAPACITY, type WorkerSessionInfo } from "./session.js";
import { LimitInfoSchema, type LimitInfo } from "./limits.js";
import { MoveSchema, type Match, type GamesData, type GameRoundResult } from "./games.js";
import { CustomProviderUpsertSchema, KEYED_PROVIDERS, type CustomProviderInfo, type KeyedProvider } from "./providers.js";
import { OfficeLayoutSchema, type OfficeLayout } from "./office.js";

export type { Match, GamesData, GameRoundResult };

export const ProviderStatusSchema = z.object({
  provider: ProviderSchema,
  ok: z.boolean(),
  version: z.string().optional(),
  reason: z.string().optional(),
  limit: LimitInfoSchema.optional(),
});
export type ProviderStatus = z.infer<typeof ProviderStatusSchema>;

export const WorldInfoSchema = z.object({
  kind: z.enum(["project", "hub"]),
  name: z.string(),
  projectPath: z.string().nullable(),
  knownProjects: z.array(KnownProjectSchema),
  /** The office floor plan; optional so older servers / payloads still parse. */
  layout: OfficeLayoutSchema.optional(),
});
export type WorldInfo = z.infer<typeof WorldInfoSchema>;

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
export type CreateAgentPayload = z.infer<typeof CreateAgentPayloadSchema>;

// Explicit optional overrides: partial() would still apply the defaults and wipe fields a patch omits.
// workSeat is not patchable: a `placement` patch is the user's desk move and the server sets the workSeat.
export const AgentPatchSchema = AgentSchema.partial().omit({ id: true, role: true, scope: true, stats: true, createdAt: true, updatedAt: true, originId: true, limit: true, workSeat: true }).extend({
  description: z.string().max(2000).optional(),
  systemPrompt: z.string().max(20000).optional(),
});
export type AgentPatch = z.infer<typeof AgentPatchSchema>;

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
  z.object({
    type: z.literal("agent.switch"),
    id: z.string(),
    provider: ProviderSchema.nullable().optional(),
    model: z.string().nullable().optional(),
    effort: EffortSchema.nullable().optional(),
  }),
  z.object({
    type: z.literal("provider.switchAll"),
    fromProvider: ProviderSchema,
    toProvider: ProviderSchema,
    toModel: z.string().nullable().optional(),
  }),
  z.object({ type: z.literal("agent.copyToProject"), id: z.string() }),
  z.object({ type: z.literal("agent.delete"), id: z.string() }),
  z.object({ type: z.literal("task.cancel"), id: z.string() }),
  z.object({ type: z.literal("task.retry"), id: z.string() }),
  z.object({ type: z.literal("permission.respond"), id: z.string(), allow: z.boolean() }),
  z.object({ type: z.literal("question.respond"), id: z.string(), answer: z.string() }),
  z.object({ type: z.literal("settings.update"), settings: ProjectSettingsSchema.partial() }),
  z.object({ type: z.literal("provider.setKey"), provider: z.enum(KEYED_PROVIDERS), apiKey: z.string().max(2000).nullable() }),
  z.object({ type: z.literal("provider.order"), order: z.array(z.string().max(64)).max(64) }),
  z.object({ type: z.literal("customProvider.upsert"), provider: CustomProviderUpsertSchema }),
  z.object({ type: z.literal("customProvider.remove"), id: z.string().max(64) }),
  z.object({ type: z.literal("project.open"), path: z.string() }),
  z.object({ type: z.literal("session.rename"), id: z.string().min(1).max(64), name: z.string().trim().min(1).max(60) }),
  z.object({ type: z.literal("session.forget"), id: z.string().min(1).max(64) }),
  z.object({ type: z.literal("session.capacity"), id: z.string().min(1).max(64), capacity: z.number().int().min(1).max(MAX_SESSION_CAPACITY) }),
  z.object({
    type: z.literal("limit.respond"),
    id: z.string(),
    answer: z.enum(["accept", "choose", "dismiss"]),
    provider: ProviderSchema.optional(),
    model: z.string().optional(),
  }),
  z.object({
    type: z.literal("game.play"),
    opponentId: z.string(),
    matchId: z.string().optional(),
    move: MoveSchema,
  }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export interface PendingLimitInfo {
  id: string;
  agentId: string;
  taskId: string;
  suggested?: { provider: Provider; model?: string };
  resetAt?: string;
  reason?: string;
}

export interface BrainstormParticipant {
  agentId: string;
  name: string;
  answer?: string;
  done: boolean;
}

export interface PendingPermissionInfo {
  id: string;
  agentId: string;
  taskId: string;
  tool: string;
  input: unknown;
}

export interface PendingQuestionInfo {
  id: string;
  agentId: string;
  taskId: string;
  question: string;
}

export const SpaceNamesSchema = z.record(z.string(), z.string().trim().min(1).max(40));

/** Global provider configuration the web needs. Never carries key values: only whether each is set. */
export interface ProviderConfigInfo {
  /** Custom (OpenAI-/Anthropic-compatible) providers in effect, without their keys. */
  customProviders: CustomProviderInfo[];
  /** The user's provider order, resolved over every provider in effect. */
  providerOrder: Provider[];
  /** Whether an API key is stored in AgenticView's config for each keyed built-in provider. */
  providerKeys: Record<KeyedProvider, boolean>;
  /** True when saved provider config differs from what this office started with (restart to apply). */
  restartNeeded?: boolean;
}

export interface Snapshot {
  spaceNames?: Record<string, string>;
  world: WorldInfo;
  agents: Agent[];
  /** Tasks on the wire carry an empty `log`; the persisted task keeps the full log. */
  tasks: Task[];
  providers: ProviderStatus[];
  /** What "Automatic" resolves to right now (first available provider), or null when none is. */
  autoProvider?: Provider | null;
  /** Provider config (custom providers, order, which keys are set). */
  providerConfig?: ProviderConfigInfo;
  settings: ProjectSettings;
  permissions: PendingPermissionInfo[];
  questions: PendingQuestionInfo[];
  limits?: PendingLimitInfo[];
  /** Claude Code sessions known to this office (claude-session workers). */
  sessions?: WorkerSessionInfo[];
  /**
   * Highest ring index currently in the office layout (0 = only the Manager's Office,
   * 1 = ring-1 rooms present, up to MAX_RINGS = 3).  Used by the camera to auto-fit the scene.
   */
  ringCount?: number;
  /** Rock-paper-scissors games: leaderboard and recent matches. */
  games?: GamesData;
  /**
   * The office floor plan (layout as data). Absent from older servers: the web then falls back to
   * defaultLayout(worker count).
   */
  layout?: OfficeLayout;
}

export type MirrorEvent = { kind: string; text: string; ts: string };

export type ServerMessage =
  | ({ type: "snapshot" } & Snapshot)
  | { type: "spaceNames.updated"; spaceNames: Record<string, string> }
  /** The floor plan changed (rooms moved, added, removed or re-kinded): the full new layout. */
  | { type: "layout.updated"; layout: OfficeLayout }
  | { type: "agent.updated"; agent: Agent }
  | { type: "agent.removed"; id: string }
  | { type: "task.updated"; task: Task }
  | { type: "run.event"; taskId: string; agentId: string; event: RunEvent }
  | { type: "permission.request"; id: string; agentId: string; taskId: string; tool: string; input: unknown }
  | { type: "permission.resolved"; id: string }
  | { type: "question.request"; id: string; agentId: string; taskId: string; question: string }
  | { type: "question.resolved"; id: string }
  | { type: "mirror.event"; event: MirrorEvent }
  | { type: "error"; message: string; ref?: string }
  | { type: "opened"; url: string }
  | { type: "providers.updated"; providers: ProviderStatus[]; autoProvider: Provider | null; providerConfig?: ProviderConfigInfo }
  | { type: "sessions.updated"; sessions: WorkerSessionInfo[] }
  | { type: "limit.request"; id: string; agentId: string; taskId: string; suggested?: { provider: Provider; model?: string }; resetAt?: string; reason?: string }
  | { type: "limit.resolved"; id: string }
  | { type: "brainstorm.updated"; managerId: string; requestTaskId: string; topic: string; participants: BrainstormParticipant[]; skipped: { agentId: string; name: string; reason: string }[]; complete: boolean; error?: string }
  | { type: "game.round"; matchId: string; opponentId: string; round: number; userMove: Match["moves"][0]; agentMove: Match["moves"][1]; winner: "you" | "agent" | null; score: { you: number; agent: number }; done: boolean }
  /**
   * Agent auto-match about to be played. The scene walks `players[i]` from its
   * lounge seat `seatSpotIds[i]` to game spot `spotIds[i]` (LoungeLayout.gameSpots ids,
   * local to the lounge room), they play for `playMs`, then `game.result` with the same
   * match id follows and both return to their seats.
   */
  | { type: "game.started"; matchId: string; players: [string, string]; spotIds: [string, string]; seatSpotIds: [string, string]; playMs: number }
  | { type: "game.result"; match: Match };
