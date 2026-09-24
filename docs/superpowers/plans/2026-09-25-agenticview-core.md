# AgenticView Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the AgenticView Claude Code plugin: a local server that runs Claude, Codex, or Gemini coding agents in project or global scope, orchestrated by a Manager, and a browser 3D office that visualises and controls them.

**Architecture:** npm-workspace monorepo. `packages/shared` holds zod schemas and the WebSocket protocol. `packages/server` (Hono + ws) owns persistence, the task state machine, the agent registry, provider runtimes behind one `Runtime` interface, a tool bridge, and the Manager orchestrator. `packages/web` (React 19 + React Three Fiber) renders the office from server snapshots and sends commands back. A dependency-free `bin/agenticview.mjs` bootstraps installs, starts the server, and opens the browser. Plugin files at the repo root expose `/agenticview` and `/agenticview-hub` skills plus hooks.

**Tech Stack:** Node 22, TypeScript 5 (ESM, `NodeNext`), npm workspaces, vitest, zod 3, Hono + `@hono/node-server`, `ws`, `@anthropic-ai/claude-agent-sdk`, `@openai/codex-sdk`, `@modelcontextprotocol/sdk`, React 19, `@react-three/fiber`, `@react-three/drei`, `three`, zustand, Vite 6, Playwright (optional, lazy), `@testing-library/react`.

**Spec:** `docs/superpowers/specs/2026-09-24-agenticview-design.md`

## Global Constraints

- Node 22 or newer. ESM everywhere (`"type": "module"`). No CommonJS.
- Server binds `127.0.0.1` only. Every REST and WebSocket call requires the launch token.
- Task status set and transition table are exactly those in spec §4.2. Illegal transitions throw `IllegalTransitionError`.
- Agent ids: `w_` + 8 hex for workers, `m_` + 8 hex for managers; task ids `t_` + 8 hex; run ids `r_` + 8 hex.
- Project state lives in `<project>/.agenticview/`; global state in `~/.agenticview/` (override with env `AGENTICVIEW_HOME` for tests).
- Worker concurrency limit default 3 (`settings.maxConcurrentRuns`).
- XP: worker +10 per done `work`, +2 per done `chat`; manager +5 per done `request`. Level = `Math.floor(Math.sqrt(xp / 25)) + 1`.
- Task log capped at 500 entries (oldest dropped).
- Hooks must exit within 300 ms when no server is listening.
- Built bundles `packages/server/dist` and `packages/web/dist` are committed; `npm run release` rebuilds and fails on a dirty tree.
- Default provider `claude`. `provider: null` / `model: null` on an agent means inherit from project settings, then global config, then defaults.
- All tests run with `npm test` from the root; the live test only runs with `AGENTICVIEW_LIVE=1`.

## Review Focus

1. **Project path with spaces or non-ASCII characters** (Windows `Z:\My Proj\`). Everything (store roots, bridge env, CLI args, skill command) must work unchanged. Pinned in Task 3 (store) and Task 11 (CLI).
2. **Two browser tabs on the same world.** Both must receive every event and neither may double-run a task. Pinned in Task 10 (broadcast test with two clients).
3. **A Worker that never finishes** (hung CLI). `task.cancel` must abort the run, mark `cancelled`, free the concurrency slot, and the Manager's `await_tasks` must return. Pinned in Task 9.
4. **Server restart mid-run.** On boot, `running`/`waiting` tasks become `failed` with `error: "interrupted"`. Pinned in Task 5.
5. **Provider not installed or not authenticated.** `check()` must return `ok:false` with a reason, the UI must grey it out, and `agent.create` must be refused with that reason. Pinned in Task 15 and Task 13.

---

## File Structure

```
package.json                         workspaces, root scripts (test, build, release)
tsconfig.base.json                   shared compiler options
vitest.workspace.ts                  runs every package's tests
bin/agenticview.mjs                  bootstrap CLI (no deps)
.claude-plugin/plugin.json           plugin manifest
.claude-plugin/marketplace.json      marketplace entry
skills/agenticview/SKILL.md          /agenticview
skills/agenticview-hub/SKILL.md      /agenticview-hub
hooks/hooks.json                     SessionStart / UserPromptSubmit / PostToolUse / SessionEnd
hooks/hook.mjs                       hook handler (no deps)

packages/shared/src/
  ids.ts            newId(prefix)
  agent.ts          AgentSchema, Agent, Provider, Role, Scope, defaults
  task.ts           TaskSchema, Task, TaskStatus, TaskKind, TRANSITIONS
  settings.ts       ProjectSettingsSchema, GlobalConfigSchema
  runtime.ts        RunEvent, RunResult, ToolAllowance types
  protocol.ts       ServerMessage, ClientMessage unions (zod)
  xp.ts             xpFor(kind, role), levelFor(xp)
  index.ts          re-exports

packages/server/src/
  store/paths.ts            globalRoot(), projectRoot(path), ensureProjectGitignore
  store/jsonStore.ts        JsonStore<T>: read/write/list/delete with atomic writes
  tasks/transitions.ts      assertTransition, IllegalTransitionError
  tasks/taskService.ts      TaskService: create, transition, log, tree, recoverInterrupted
  agents/registry.ts        AgentRegistry: list(world), get, create, update, copyToProject, remove, ensureManager
  runtimes/types.ts         Runtime interface, RunRequest, BridgeTool
  runtimes/fake.ts          FakeRuntime (scripted responses; used by tests and demo mode)
  runtimes/claude.ts        ClaudeRuntime (Agent SDK)
  runtimes/codex.ts         CodexRuntime
  runtimes/gemini.ts        GeminiRuntime
  runtimes/index.ts         createRuntimes(settings) -> Map<Provider, Runtime>
  bridge/toolRegistry.ts    per-run tool registration + invoke
  bridge/httpBridge.ts      Hono routes /bridge/:runId/tools and /call
  bridge/stdioBridge.ts     MCP stdio process used by codex/gemini
  manager/preamble.ts       buildRosterPreamble(world, agents, tasks)
  manager/tools.ts          managerTools(ctx) -> BridgeTool[]
  manager/orchestrator.ts   Orchestrator: handleUserMessage, runTask, cancel, permissions, questions
  events/bus.ts             EventBus (typed emitter)
  api/http.ts               REST routes
  api/ws.ts                 WebSocket handler (snapshot, commands)
  api/auth.ts               token middleware
  hooks/mirror.ts           POST /hooks -> mirror.event
  screenshot/screenshot.ts  takeScreenshot(url) via playwright (lazy import)
  world.ts                  World: resolves project vs hub, wires services
  server.ts                 createServer({ project|hub, token, port }) -> { url, close }
  cli.ts                    open / hub / hook subcommands

packages/web/src/
  main.tsx, App.tsx
  state/store.ts            zustand store: snapshot, agents, tasks, feed, selection
  net/ws.ts                 connect(token) with reconnect + snapshot request
  scene/Office.tsx          Canvas, floor, lights, camera
  scene/layout.ts           desk positions for N workers + lobby
  scene/Robot.tsx           procedural robot, status ring, bubble
  scene/Beam.tsx            assignment beam
  scene/Confetti.tsx
  hud/TopBar.tsx, TaskBoard.tsx, ChatPanel.tsx, CommandBar.tsx
  hud/CreateAgentModal.tsx, SettingsModal.tsx, PermissionToast.tsx
  hub/HubView.tsx           known projects + global agents
```

---

### Task 1: Workspace scaffold and shared schemas

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `vitest.workspace.ts`, `.npmrc`
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`
- Create: `packages/shared/src/{ids,agent,task,settings,runtime,protocol,xp,index}.ts`
- Test: `packages/shared/test/schemas.test.ts`, `packages/shared/test/xp.test.ts`

**Interfaces:**
- Produces: `newId(prefix: "w"|"m"|"t"|"r"|"u"): string`; `AgentSchema`, `Agent`, `Provider = "claude"|"codex"|"gemini"`, `Role`, `Scope`, `PermissionMode`; `TaskSchema`, `Task`, `TaskStatus`, `TaskKind`, `TRANSITIONS: Record<TaskStatus, TaskStatus[]>`; `ProjectSettingsSchema`, `GlobalConfigSchema`; `RunEvent`, `RunResult`, `ToolAllowance`; `ServerMessageSchema`, `ClientMessageSchema`; `xpFor(kind: TaskKind, role: Role): number`, `levelFor(xp: number): number`.

- [ ] **Step 1: Root files**

`package.json`:
```json
{
  "name": "agenticview",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*"],
  "bin": { "agenticview": "bin/agenticview.mjs" },
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "npm run build -w packages/shared -w packages/server -w packages/web",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -b packages/shared packages/server packages/web",
    "release": "npm run build && git diff --quiet -- packages/server/dist packages/web/dist || (echo 'dist out of date: commit rebuilt bundles' && exit 1)"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "@types/node": "^22.7.0"
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true,
    "composite": true,
    "noUncheckedIndexedAccess": true
  }
}
```

`vitest.workspace.ts`:
```ts
export default ["packages/*/vitest.config.ts"];
```

`.npmrc`: `save-exact=false`

`packages/shared/package.json`:
```json
{
  "name": "@agenticview/shared",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "scripts": { "build": "tsc -b" },
  "dependencies": { "zod": "^3.23.8" }
}
```

`packages/shared/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "rootDir": "src", "outDir": "dist" }, "include": ["src"] }
```

`packages/shared/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
```

- [ ] **Step 2: Failing tests**

`packages/shared/test/schemas.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { AgentSchema, TaskSchema, TRANSITIONS, newId, defaultAgent } from "../src/index.js";

describe("ids", () => {
  it("prefixes and is 8 hex", () => {
    expect(newId("w")).toMatch(/^w_[0-9a-f]{8}$/);
    expect(newId("t")).not.toEqual(newId("t"));
  });
});

describe("AgentSchema", () => {
  it("round-trips a default worker", () => {
    const a = defaultAgent({ name: "Nova", role: "worker", scope: "project", specialty: "frontend" });
    expect(AgentSchema.parse(JSON.parse(JSON.stringify(a)))).toEqual(a);
    expect(a.provider).toBeNull();
    expect(a.stats).toEqual({ xp: 0, level: 1, tasksDone: 0, tasksFailed: 0 });
  });
  it("rejects a bad role", () => {
    expect(() => AgentSchema.parse({ ...defaultAgent({ name: "x", role: "worker", scope: "project", specialty: "" }), role: "boss" })).toThrow();
  });
});

describe("TaskSchema", () => {
  it("has the exact transition table", () => {
    expect(TRANSITIONS).toEqual({
      queued: ["assigned", "cancelled"],
      assigned: ["running", "cancelled"],
      running: ["waiting", "done", "failed", "cancelled"],
      waiting: ["running", "failed", "cancelled"],
      done: [], failed: [], cancelled: [],
    });
  });
  it("parses a minimal task", () => {
    const t = TaskSchema.parse({
      id: "t_00000001", kind: "work", title: "x", description: "y", status: "queued",
      createdBy: "user", assigneeId: "w_00000001", projectPath: "C:/p", images: [], log: [],
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(t.parentId).toBeUndefined();
  });
});
```

`packages/shared/test/xp.test.ts`:
```ts
import { it, expect } from "vitest";
import { xpFor, levelFor } from "../src/xp.js";
it("awards per spec", () => {
  expect(xpFor("work", "worker")).toBe(10);
  expect(xpFor("chat", "worker")).toBe(2);
  expect(xpFor("request", "manager")).toBe(5);
  expect(xpFor("work", "manager")).toBe(0);
});
it("levels", () => {
  expect(levelFor(0)).toBe(1);
  expect(levelFor(24)).toBe(1);
  expect(levelFor(25)).toBe(2);
  expect(levelFor(100)).toBe(3);
});
```

- [ ] **Step 3: Run, expect failure**

Run: `npm install && npx vitest run packages/shared` → FAIL (module not found).

- [ ] **Step 4: Implement**

`src/ids.ts`:
```ts
import { randomBytes } from "node:crypto";
export type IdPrefix = "w" | "m" | "t" | "r" | "u";
export function newId(prefix: IdPrefix): string {
  return `${prefix}_${randomBytes(4).toString("hex")}`;
}
```

`src/agent.ts`:
```ts
import { z } from "zod";
import { newId } from "./ids.js";
export const ProviderSchema = z.enum(["claude", "codex", "gemini"]);
export type Provider = z.infer<typeof ProviderSchema>;
export const RoleSchema = z.enum(["manager", "worker"]);
export type Role = z.infer<typeof RoleSchema>;
export const ScopeSchema = z.enum(["project", "global"]);
export type Scope = z.infer<typeof ScopeSchema>;
export const PermissionModeSchema = z.enum(["ask", "auto-edit", "auto"]);
export type PermissionMode = z.infer<typeof PermissionModeSchema>;
export const ToolAllowanceSchema = z.object({
  edit: z.boolean(), shell: z.boolean(), web: z.boolean(), screenshot: z.boolean(),
});
export type ToolAllowance = z.infer<typeof ToolAllowanceSchema>;
export const AgentSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(40),
  role: RoleSchema,
  scope: ScopeSchema,
  specialty: z.string().max(120),
  description: z.string().max(2000).default(""),
  provider: ProviderSchema.nullable(),
  model: z.string().nullable(),
  systemPrompt: z.string().max(20000).default(""),
  tools: ToolAllowanceSchema,
  permissionMode: PermissionModeSchema,
  appearance: z.object({
    color: z.string(), accent: z.string(), eyes: z.enum(["round", "visor", "dots"]),
  }),
  stats: z.object({ xp: z.number().int().min(0), level: z.number().int().min(1), tasksDone: z.number().int().min(0), tasksFailed: z.number().int().min(0) }),
  originId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Agent = z.infer<typeof AgentSchema>;

const PALETTE = ["#5b8cff", "#ff7a59", "#3ddc97", "#ffc857", "#b084f5", "#ff5fa2", "#4fd1ff"];
export function defaultAgent(init: { name: string; role: Role; scope: Scope; specialty: string } & Partial<Agent>): Agent {
  const now = new Date().toISOString();
  const isManager = init.role === "manager";
  const color = init.appearance?.color ?? PALETTE[Math.floor(Math.random() * PALETTE.length)]!;
  return {
    id: init.id ?? newId(isManager ? "m" : "w"),
    name: init.name, role: init.role, scope: init.scope, specialty: init.specialty,
    description: init.description ?? "",
    provider: init.provider ?? null, model: init.model ?? null,
    systemPrompt: init.systemPrompt ?? "",
    tools: init.tools ?? (isManager ? { edit: false, shell: false, web: false, screenshot: false } : { edit: true, shell: true, web: false, screenshot: false }),
    permissionMode: init.permissionMode ?? "auto-edit",
    appearance: init.appearance ?? { color, accent: isManager ? "#ffd166" : "#ffffff", eyes: isManager ? "visor" : "round" },
    stats: init.stats ?? { xp: 0, level: 1, tasksDone: 0, tasksFailed: 0 },
    ...(init.originId ? { originId: init.originId } : {}),
    createdAt: init.createdAt ?? now, updatedAt: init.updatedAt ?? now,
  };
}
```

`src/task.ts`:
```ts
import { z } from "zod";
export const TaskStatusSchema = z.enum(["queued", "assigned", "running", "waiting", "done", "failed", "cancelled"]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export const TaskKindSchema = z.enum(["request", "work", "chat"]);
export type TaskKind = z.infer<typeof TaskKindSchema>;
export const TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  queued: ["assigned", "cancelled"],
  assigned: ["running", "cancelled"],
  running: ["waiting", "done", "failed", "cancelled"],
  waiting: ["running", "failed", "cancelled"],
  done: [], failed: [], cancelled: [],
};
export const TaskLogEntrySchema = z.object({ ts: z.string(), type: z.string(), text: z.string() });
export type TaskLogEntry = z.infer<typeof TaskLogEntrySchema>;
export const TaskSchema = z.object({
  id: z.string(), kind: TaskKindSchema, title: z.string(), description: z.string(),
  status: TaskStatusSchema, createdBy: z.string(), assigneeId: z.string(),
  parentId: z.string().optional(), projectPath: z.string(),
  session: z.object({ provider: z.enum(["claude", "codex", "gemini"]), sessionId: z.string() }).optional(),
  images: z.array(z.string()), result: z.string().optional(), error: z.string().optional(),
  log: z.array(TaskLogEntrySchema),
  createdAt: z.string(), startedAt: z.string().optional(), finishedAt: z.string().optional(),
});
export type Task = z.infer<typeof TaskSchema>;
export const TASK_LOG_CAP = 500;
export const TERMINAL: ReadonlySet<TaskStatus> = new Set(["done", "failed", "cancelled"]);
```

`src/settings.ts`:
```ts
import { z } from "zod";
import { ProviderSchema } from "./agent.js";
export const ProjectSettingsSchema = z.object({
  defaultProvider: ProviderSchema.nullable().default(null),
  defaultModel: z.string().nullable().default(null),
  maxConcurrentRuns: z.number().int().min(1).max(10).default(3),
});
export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>;
export const GlobalConfigSchema = z.object({
  defaultProvider: ProviderSchema.default("claude"),
  defaultModel: z.string().nullable().default(null),
  maxConcurrentRuns: z.number().int().min(1).max(10).default(3),
  providers: z.object({
    claude: z.object({ apiKey: z.string().optional(), model: z.string().optional() }).default({}),
    codex: z.object({ apiKey: z.string().optional(), model: z.string().optional() }).default({}),
    gemini: z.object({ apiKey: z.string().optional(), model: z.string().optional() }).default({}),
  }).default({}),
  knownProjects: z.array(z.object({ path: z.string(), name: z.string(), lastOpened: z.string() })).default([]),
});
export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;
```

`src/runtime.ts`:
```ts
export type RunEvent =
  | { type: "text"; text: string }
  | { type: "tool_start"; name: string; input: unknown }
  | { type: "tool_end"; name: string; ok: boolean; summary: string }
  | { type: "file_changed"; path: string; kind: "create" | "modify" | "delete" }
  | { type: "permission"; id: string; tool: string; input: unknown }
  | { type: "status"; text: string };
export type StopReason = "done" | "error" | "aborted" | "max_turns";
export interface RunResult {
  sessionId?: string; text: string; stopReason: StopReason; costUsd?: number;
  usage?: { inputTokens: number; outputTokens: number }; error?: string;
}
export type PromptPart = { type: "text"; text: string } | { type: "image"; path: string };
```

`src/xp.ts`:
```ts
import type { Role } from "./agent.js";
import type { TaskKind } from "./task.js";
export function xpFor(kind: TaskKind, role: Role): number {
  if (role === "worker") return kind === "work" ? 10 : kind === "chat" ? 2 : 0;
  return kind === "request" ? 5 : 0;
}
export function levelFor(xp: number): number { return Math.floor(Math.sqrt(xp / 25)) + 1; }
```

`src/protocol.ts`:
```ts
import { z } from "zod";
import { AgentSchema, ProviderSchema, ToolAllowanceSchema, PermissionModeSchema } from "./agent.js";
import { TaskSchema } from "./task.js";
import { ProjectSettingsSchema } from "./settings.js";

export const ProviderStatusSchema = z.object({ provider: ProviderSchema, ok: z.boolean(), version: z.string().optional(), reason: z.string().optional() });
export type ProviderStatus = z.infer<typeof ProviderStatusSchema>;
export const WorldInfoSchema = z.object({ kind: z.enum(["project", "hub"]), name: z.string(), projectPath: z.string().nullable(), knownProjects: z.array(z.object({ path: z.string(), name: z.string(), lastOpened: z.string() })) });
export type WorldInfo = z.infer<typeof WorldInfoSchema>;

export const ClientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("snapshot.request") }),
  z.object({ type: z.literal("chat.send"), agentId: z.string(), text: z.string().min(1), images: z.array(z.string()).default([]), projectPath: z.string().optional() }),
  z.object({ type: z.literal("agent.create"), agent: z.object({ name: z.string(), specialty: z.string(), description: z.string().optional(), provider: ProviderSchema.nullable().optional(), model: z.string().nullable().optional(), systemPrompt: z.string().optional(), tools: ToolAllowanceSchema.optional(), permissionMode: PermissionModeSchema.optional(), scope: z.enum(["project", "global"]).optional() }) }),
  z.object({ type: z.literal("agent.update"), id: z.string(), patch: AgentSchema.partial().omit({ id: true, role: true, scope: true, stats: true, createdAt: true }) }),
  z.object({ type: z.literal("agent.copyToProject"), id: z.string() }),
  z.object({ type: z.literal("agent.delete"), id: z.string() }),
  z.object({ type: z.literal("task.cancel"), id: z.string() }),
  z.object({ type: z.literal("permission.respond"), id: z.string(), allow: z.boolean() }),
  z.object({ type: z.literal("question.respond"), id: z.string(), answer: z.string() }),
  z.object({ type: z.literal("settings.update"), settings: ProjectSettingsSchema.partial() }),
  z.object({ type: z.literal("project.open"), path: z.string() }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export type ServerMessage =
  | { type: "snapshot"; world: WorldInfo; agents: Agent[]; tasks: Task[]; providers: ProviderStatus[]; settings: ProjectSettings }
  | { type: "agent.updated"; agent: Agent } | { type: "agent.removed"; id: string }
  | { type: "task.updated"; task: Task }
  | { type: "run.event"; taskId: string; agentId: string; event: RunEvent }
  | { type: "permission.request"; id: string; agentId: string; taskId: string; tool: string; input: unknown }
  | { type: "permission.resolved"; id: string }
  | { type: "question.request"; id: string; agentId: string; taskId: string; question: string }
  | { type: "question.resolved"; id: string }
  | { type: "mirror.event"; event: { kind: string; text: string; ts: string } }
  | { type: "error"; message: string; ref?: string }
  | { type: "opened"; url: string };
import type { Agent } from "./agent.js";
import type { Task } from "./task.js";
import type { ProjectSettings } from "./settings.js";
import type { RunEvent } from "./runtime.js";
```

`src/index.ts` re-exports every module with `export * from "./x.js"`.

- [ ] **Step 5: Run, expect pass; commit**

Run: `npx vitest run packages/shared` → PASS. `git add -A && git commit -m "feat(shared): schemas, ids, xp, protocol"`.

---

### Task 2: Task transitions

**Files:**
- Create: `packages/server/package.json`, `packages/server/tsconfig.json`, `packages/server/vitest.config.ts`
- Create: `packages/server/src/tasks/transitions.ts`
- Test: `packages/server/test/tasks/transitions.test.ts`

**Interfaces:**
- Produces: `assertTransition(from: TaskStatus, to: TaskStatus): void` (throws `IllegalTransitionError`), `canTransition(from, to): boolean`.

- [ ] **Step 1: Package files**

`packages/server/package.json`:
```json
{
  "name": "@agenticview/server",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/server.js",
  "scripts": { "build": "tsc -b", "test": "vitest run" },
  "dependencies": {
    "@agenticview/shared": "0.1.0",
    "@anthropic-ai/claude-agent-sdk": "latest",
    "@openai/codex-sdk": "latest",
    "@modelcontextprotocol/sdk": "^1.12.0",
    "@hono/node-server": "^1.13.0",
    "hono": "^4.6.0",
    "ws": "^8.18.0",
    "zod": "^3.23.8"
  },
  "devDependencies": { "@types/ws": "^8.5.12" },
  "optionalDependencies": { "playwright": "^1.48.0" }
}
```
(Pin `latest` to the resolved versions after the first `npm install`.)

`tsconfig.json`: extends base, `rootDir: src`, `outDir: dist`, `references: [{ "path": "../shared" }]`.
`vitest.config.ts`: `include: ["test/**/*.test.ts"]`, `testTimeout: 15000`.

- [ ] **Step 2: Failing test**

```ts
import { describe, it, expect } from "vitest";
import { TRANSITIONS, TaskStatusSchema } from "@agenticview/shared";
import { assertTransition, canTransition, IllegalTransitionError } from "../../src/tasks/transitions.js";

describe("transitions", () => {
  const all = TaskStatusSchema.options;
  it("allows exactly the table", () => {
    for (const from of all) for (const to of all) {
      expect(canTransition(from, to)).toBe(TRANSITIONS[from].includes(to));
    }
  });
  it("throws a typed error with both states", () => {
    expect(() => assertTransition("done", "running")).toThrow(IllegalTransitionError);
    try { assertTransition("queued", "done"); } catch (e) {
      expect((e as IllegalTransitionError).message).toBe("Illegal task transition: queued -> done");
    }
  });
});
```

- [ ] **Step 3: Run → FAIL. Implement**

```ts
import { TRANSITIONS, type TaskStatus } from "@agenticview/shared";
export class IllegalTransitionError extends Error {
  constructor(public readonly from: TaskStatus, public readonly to: TaskStatus) {
    super(`Illegal task transition: ${from} -> ${to}`);
    this.name = "IllegalTransitionError";
  }
}
export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TRANSITIONS[from].includes(to);
}
export function assertTransition(from: TaskStatus, to: TaskStatus): void {
  if (!canTransition(from, to)) throw new IllegalTransitionError(from, to);
}
```

- [ ] **Step 4: Run → PASS. Commit** `feat(server): task transition table`.

---

### Task 3: File store and paths

**Files:**
- Create: `packages/server/src/store/paths.ts`, `packages/server/src/store/jsonStore.ts`
- Test: `packages/server/test/store/jsonStore.test.ts`

**Interfaces:**
- Produces: `globalRoot(): string` (env `AGENTICVIEW_HOME` or `~/.agenticview`); `projectRoot(projectPath: string): string` (`<projectPath>/.agenticview`); `ensureProjectGitignore(projectPath): Promise<void>`; `class JsonStore<T>` with `constructor(dir: string, schema: ZodType<T>)`, `read(id): Promise<T|undefined>`, `write(id, value): Promise<void>` (atomic: write `.tmp` then rename), `list(): Promise<T[]>`, `delete(id): Promise<boolean>`; `readJsonFile<T>(file, schema, fallback)`, `writeJsonFile(file, value)`.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { JsonStore, ensureProjectGitignore, projectRoot, globalRoot } from "../../src/store/index.js";

const S = z.object({ id: z.string(), n: z.number() });
let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "av space ü ")); });

describe("JsonStore", () => {
  it("writes, reads, lists, deletes in a path with spaces and unicode", async () => {
    const s = new JsonStore(join(dir, "agents"), S);
    await s.write("a", { id: "a", n: 1 });
    await s.write("b", { id: "b", n: 2 });
    expect(await s.read("a")).toEqual({ id: "a", n: 1 });
    expect((await s.list()).map(x => x.id).sort()).toEqual(["a", "b"]);
    expect(await s.delete("a")).toBe(true);
    expect(await s.read("a")).toBeUndefined();
    expect(await readdir(join(dir, "agents"))).toEqual(["b.json"]);
  });
  it("leaves no temp files and rejects invalid content", async () => {
    const s = new JsonStore(join(dir, "x"), S);
    await s.write("a", { id: "a", n: 1 });
    expect((await readdir(join(dir, "x"))).filter(f => f.endsWith(".tmp"))).toEqual([]);
    await expect(s.write("bad", { id: "bad" } as never)).rejects.toThrow();
  });
});

describe("paths", () => {
  it("resolves roots", () => {
    process.env.AGENTICVIEW_HOME = dir;
    expect(globalRoot()).toBe(dir);
    expect(projectRoot("C:/My Proj")).toBe(join("C:/My Proj", ".agenticview"));
  });
  it("creates a gitignore inside .agenticview once", async () => {
    await ensureProjectGitignore(dir);
    await ensureProjectGitignore(dir);
    const gi = await readFile(join(dir, ".agenticview", ".gitignore"), "utf8");
    expect(gi).toBe("events.log\nsessions/\nuploads/\n");
  });
});
```

- [ ] **Step 2: Run → FAIL. Implement**

`paths.ts`:
```ts
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, writeFile, access } from "node:fs/promises";
export function globalRoot(): string { return process.env.AGENTICVIEW_HOME ?? join(homedir(), ".agenticview"); }
export function projectRoot(projectPath: string): string { return join(projectPath, ".agenticview"); }
const GITIGNORE = "events.log\nsessions/\nuploads/\n";
export async function ensureProjectGitignore(projectPath: string): Promise<void> {
  const root = projectRoot(projectPath);
  await mkdir(root, { recursive: true });
  const file = join(root, ".gitignore");
  try { await access(file); } catch { await writeFile(file, GITIGNORE, "utf8"); }
}
```

`jsonStore.ts`:
```ts
import { mkdir, readFile, writeFile, rename, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { ZodType } from "zod";
export async function writeJsonFile(file: string, value: unknown): Promise<void> {
  await mkdir(join(file, ".."), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
  await rename(tmp, file);
}
export async function readJsonFile<T>(file: string, schema: ZodType<T>, fallback: T): Promise<T> {
  try { return schema.parse(JSON.parse(await readFile(file, "utf8"))); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return fallback; throw e; }
}
export class JsonStore<T extends { id: string }> {
  constructor(private readonly dir: string, private readonly schema: ZodType<T>) {}
  private file(id: string) { return join(this.dir, `${id}.json`); }
  async read(id: string): Promise<T | undefined> {
    try { return this.schema.parse(JSON.parse(await readFile(this.file(id), "utf8"))); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw e; }
  }
  async write(id: string, value: T): Promise<void> { await writeJsonFile(this.file(id), this.schema.parse(value)); }
  async list(): Promise<T[]> {
    let names: string[];
    try { names = await readdir(this.dir); } catch { return []; }
    const out: T[] = [];
    for (const n of names) if (n.endsWith(".json")) { const v = await this.read(n.slice(0, -5)); if (v) out.push(v); }
    return out;
  }
  async delete(id: string): Promise<boolean> {
    try { await unlink(this.file(id)); return true; }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return false; throw e; }
  }
}
```
`store/index.ts` re-exports both.

- [ ] **Step 3: Run → PASS. Commit** `feat(server): json store and paths`.

---

### Task 4: Agent registry

**Files:**
- Create: `packages/server/src/agents/registry.ts`
- Test: `packages/server/test/agents/registry.test.ts`

**Interfaces:**
- Consumes: `JsonStore`, `globalRoot`, `projectRoot`, `defaultAgent`, `AgentSchema`.
- Produces:
```ts
type WorldRef = { kind: "project"; projectPath: string } | { kind: "hub" };
class AgentRegistry {
  constructor(world: WorldRef)
  list(): Promise<Agent[]>                      // project: project agents + global workers; hub: global agents
  get(id: string): Promise<Agent | undefined>
  create(input: CreateAgentInput): Promise<Agent> // scope default: project world -> "project", hub -> "global"
  update(id: string, patch: Partial<Agent>): Promise<Agent>
  copyToProject(id: string): Promise<Agent>     // only in project world; source must be global
  remove(id: string): Promise<void>             // refuses to remove a manager
  ensureManager(): Promise<Agent>               // creates "Atlas" (project) or "Overseer" (hub) once
  managerId(): Promise<string>
}
class ScopeError extends Error {}
```
`CreateAgentInput = { name; specialty; description?; provider?; model?; systemPrompt?; tools?; permissionMode?; scope?; role?: Role }`.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentRegistry, ScopeError } from "../../src/agents/registry.js";

let home: string, proj: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "av-home-")); proj = await mkdtemp(join(tmpdir(), "av-proj-"));
  process.env.AGENTICVIEW_HOME = home;
});

describe("AgentRegistry", () => {
  it("creates one manager per world, idempotently", async () => {
    const r = new AgentRegistry({ kind: "project", projectPath: proj });
    const m1 = await r.ensureManager(); const m2 = await r.ensureManager();
    expect(m1.id).toBe(m2.id); expect(m1.role).toBe("manager"); expect(m1.scope).toBe("project");
    expect((await r.list()).filter(a => a.role === "manager")).toHaveLength(1);
  });
  it("project world lists project + global workers; hub lists only global", async () => {
    const p = new AgentRegistry({ kind: "project", projectPath: proj });
    const h = new AgentRegistry({ kind: "hub" });
    await p.create({ name: "Nova", specialty: "frontend" });
    await h.create({ name: "Rover", specialty: "testing" });
    await h.ensureManager();
    expect((await p.list()).map(a => a.name).sort()).toEqual(["Nova", "Rover"]);
    expect((await h.list()).map(a => a.name).sort()).toEqual(["Overseer", "Rover"]);
  });
  it("copyToProject clones a global agent with originId and new id", async () => {
    const p = new AgentRegistry({ kind: "project", projectPath: proj });
    const g = await new AgentRegistry({ kind: "hub" }).create({ name: "Rover", specialty: "testing" });
    const c = await p.copyToProject(g.id);
    expect(c.id).not.toBe(g.id); expect(c.scope).toBe("project"); expect(c.originId).toBe(g.id);
    expect(c.stats.xp).toBe(0);
    await expect(p.copyToProject(c.id)).rejects.toThrow(ScopeError);
    await expect(new AgentRegistry({ kind: "hub" }).copyToProject(g.id)).rejects.toThrow(ScopeError);
  });
  it("refuses to remove a manager, removes workers", async () => {
    const p = new AgentRegistry({ kind: "project", projectPath: proj });
    const m = await p.ensureManager();
    await expect(p.remove(m.id)).rejects.toThrow(ScopeError);
    const w = await p.create({ name: "X", specialty: "" });
    await p.remove(w.id);
    expect(await p.get(w.id)).toBeUndefined();
  });
  it("update bumps updatedAt and validates", async () => {
    const p = new AgentRegistry({ kind: "project", projectPath: proj });
    const w = await p.create({ name: "X", specialty: "" });
    const u = await p.update(w.id, { name: "Y" });
    expect(u.name).toBe("Y"); expect(u.updatedAt >= w.updatedAt).toBe(true);
    await expect(p.update(w.id, { name: "" })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run → FAIL. Implement**

```ts
import { AgentSchema, defaultAgent, type Agent, type Role, type Scope, type Provider, type ToolAllowance, type PermissionMode } from "@agenticview/shared";
import { join } from "node:path";
import { JsonStore } from "../store/jsonStore.js";
import { globalRoot, projectRoot } from "../store/paths.js";

export type WorldRef = { kind: "project"; projectPath: string } | { kind: "hub" };
export interface CreateAgentInput { name: string; specialty: string; description?: string; provider?: Provider | null; model?: string | null; systemPrompt?: string; tools?: ToolAllowance; permissionMode?: PermissionMode; scope?: Scope; role?: Role }
export class ScopeError extends Error { constructor(msg: string) { super(msg); this.name = "ScopeError"; } }

export class AgentRegistry {
  private readonly global: JsonStore<Agent>;
  private readonly project?: JsonStore<Agent>;
  constructor(private readonly world: WorldRef) {
    this.global = new JsonStore(join(globalRoot(), "agents"), AgentSchema);
    if (world.kind === "project") this.project = new JsonStore(join(projectRoot(world.projectPath), "agents"), AgentSchema);
  }
  private storeFor(scope: Scope): JsonStore<Agent> {
    if (scope === "global") return this.global;
    if (!this.project) throw new ScopeError("Project-scoped agents are not available in the hub");
    return this.project;
  }
  async list(): Promise<Agent[]> {
    const globals = (await this.global.list()).filter(a => a.role !== "manager" || this.world.kind === "hub");
    if (!this.project) return globals;
    return [...await this.project.list(), ...globals];
  }
  async get(id: string): Promise<Agent | undefined> { return (await this.project?.read(id)) ?? this.global.read(id); }
  async create(input: CreateAgentInput): Promise<Agent> {
    const scope = input.scope ?? (this.world.kind === "project" ? "project" : "global");
    const agent = defaultAgent({ ...input, role: input.role ?? "worker", scope, provider: input.provider ?? null, model: input.model ?? null });
    await this.storeFor(scope).write(agent.id, agent);
    return agent;
  }
  async update(id: string, patch: Partial<Agent>): Promise<Agent> {
    const cur = await this.get(id); if (!cur) throw new Error(`Unknown agent ${id}`);
    const next = AgentSchema.parse({ ...cur, ...patch, id: cur.id, role: cur.role, scope: cur.scope, updatedAt: new Date().toISOString() });
    await this.storeFor(cur.scope).write(id, next);
    return next;
  }
  async copyToProject(id: string): Promise<Agent> {
    if (this.world.kind !== "project" || !this.project) throw new ScopeError("copyToProject requires a project world");
    const src = await this.get(id); if (!src) throw new Error(`Unknown agent ${id}`);
    if (src.scope !== "global") throw new ScopeError("Only global agents can be copied into a project");
    const { id: _id, stats: _s, createdAt: _c, updatedAt: _u, originId: _o, ...rest } = src;
    const copy = defaultAgent({ ...rest, scope: "project", originId: src.id });
    await this.project.write(copy.id, copy);
    return copy;
  }
  async remove(id: string): Promise<void> {
    const cur = await this.get(id); if (!cur) return;
    if (cur.role === "manager") throw new ScopeError("The manager cannot be removed");
    await this.storeFor(cur.scope).delete(id);
  }
  async ensureManager(): Promise<Agent> {
    const wantScope: Scope = this.world.kind === "project" ? "project" : "global";
    const existing = (await this.list()).find(a => a.role === "manager" && a.scope === wantScope);
    if (existing) return existing;
    return this.create({ name: this.world.kind === "project" ? "Atlas" : "Overseer", specialty: "manager", role: "manager", tools: { edit: false, shell: false, web: false, screenshot: false }, permissionMode: "auto" });
  }
  async managerId(): Promise<string> { return (await this.ensureManager()).id; }
}
```

- [ ] **Step 3: Run → PASS. Commit** `feat(server): agent registry with scopes`.

---

### Task 5: TaskService

**Files:**
- Create: `packages/server/src/tasks/taskService.ts`
- Test: `packages/server/test/tasks/taskService.test.ts`

**Interfaces:**
- Consumes: `JsonStore`, `assertTransition`, `TASK_LOG_CAP`, `xpFor`, `levelFor`, `AgentRegistry`.
- Produces:
```ts
class TaskService {
  constructor(dir: string, onChange: (task: Task) => void)   // dir = <root>/tasks
  create(input: { kind: TaskKind; title: string; description: string; createdBy: string; assigneeId: string; projectPath: string; parentId?: string; images?: string[] }): Promise<Task>
  get(id): Promise<Task | undefined>;  list(): Promise<Task[]>
  transition(id, to: TaskStatus, patch?: Partial<Pick<Task,"result"|"error"|"session">>): Promise<Task>
  log(id, type: string, text: string): Promise<void>
  children(id): Promise<Task[]>
  recoverInterrupted(): Promise<Task[]>   // running|waiting -> failed "interrupted"
  awardXp(registry: AgentRegistry, task: Task): Promise<void>  // on terminal; bumps tasksDone/tasksFailed
}
```

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskService } from "../../src/tasks/taskService.js";
import { AgentRegistry } from "../../src/agents/registry.js";
import { IllegalTransitionError } from "../../src/tasks/transitions.js";

let dir: string; const onChange = vi.fn();
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "av-tasks-")); process.env.AGENTICVIEW_HOME = dir; onChange.mockClear(); });
const mk = (s: TaskService, extra = {}) => s.create({ kind: "work", title: "t", description: "d", createdBy: "user", assigneeId: "w_1", projectPath: dir, ...extra });

describe("TaskService", () => {
  it("creates queued, transitions, stamps times, notifies", async () => {
    const s = new TaskService(join(dir, "tasks"), onChange);
    const t = await mk(s);
    expect(t.status).toBe("queued"); expect(onChange).toHaveBeenCalledTimes(1);
    await s.transition(t.id, "assigned");
    const r = await s.transition(t.id, "running");
    expect(r.startedAt).toBeDefined();
    const d = await s.transition(t.id, "done", { result: "ok" });
    expect(d.finishedAt).toBeDefined(); expect(d.result).toBe("ok");
    await expect(s.transition(t.id, "running")).rejects.toThrow(IllegalTransitionError);
  });
  it("caps the log at 500", async () => {
    const s = new TaskService(join(dir, "tasks"), onChange); const t = await mk(s);
    for (let i = 0; i < 510; i++) await s.log(t.id, "text", `line ${i}`);
    const got = (await s.get(t.id))!;
    expect(got.log).toHaveLength(500); expect(got.log[0]!.text).toBe("line 10");
  });
  it("recovers interrupted tasks on boot", async () => {
    const s = new TaskService(join(dir, "tasks"), onChange); const a = await mk(s); const b = await mk(s);
    await s.transition(a.id, "assigned"); await s.transition(a.id, "running");
    await s.transition(b.id, "assigned"); await s.transition(b.id, "running"); await s.transition(b.id, "waiting");
    const s2 = new TaskService(join(dir, "tasks"), onChange);
    const fixed = await s2.recoverInterrupted();
    expect(fixed.map(t => t.status)).toEqual(["failed", "failed"]);
    expect(fixed[0]!.error).toBe("interrupted");
  });
  it("children and xp", async () => {
    const s = new TaskService(join(dir, "tasks"), onChange);
    const reg = new AgentRegistry({ kind: "project", projectPath: dir });
    const w = await reg.create({ name: "N", specialty: "" });
    const root = await mk(s, { kind: "request", assigneeId: "m_1" });
    const c = await mk(s, { parentId: root.id, assigneeId: w.id });
    expect((await s.children(root.id)).map(t => t.id)).toEqual([c.id]);
    await s.transition(c.id, "assigned"); await s.transition(c.id, "running");
    const done = await s.transition(c.id, "done");
    await s.awardXp(reg, done);
    const after = (await reg.get(w.id))!;
    expect(after.stats).toEqual({ xp: 10, level: 1, tasksDone: 1, tasksFailed: 0 });
  });
});
```

- [ ] **Step 2: Implement**

```ts
import { TaskSchema, TASK_LOG_CAP, newId, xpFor, levelFor, type Task, type TaskKind, type TaskStatus } from "@agenticview/shared";
import { JsonStore } from "../store/jsonStore.js";
import { assertTransition } from "./transitions.js";
import type { AgentRegistry } from "../agents/registry.js";

const TERMINAL = new Set<TaskStatus>(["done", "failed", "cancelled"]);
export class TaskService {
  private readonly store: JsonStore<Task>;
  private readonly locks = new Map<string, Promise<unknown>>();
  constructor(dir: string, private readonly onChange: (t: Task) => void) { this.store = new JsonStore(dir, TaskSchema); }
  private locked<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(id) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.locks.set(id, next.catch(() => undefined));
    return next;
  }
  async create(input: { kind: TaskKind; title: string; description: string; createdBy: string; assigneeId: string; projectPath: string; parentId?: string; images?: string[] }): Promise<Task> {
    const task: Task = { id: newId("t"), kind: input.kind, title: input.title, description: input.description, status: "queued", createdBy: input.createdBy, assigneeId: input.assigneeId, projectPath: input.projectPath, images: input.images ?? [], log: [], createdAt: new Date().toISOString(), ...(input.parentId ? { parentId: input.parentId } : {}) };
    await this.store.write(task.id, task); this.onChange(task); return task;
  }
  get(id: string) { return this.store.read(id); }
  list() { return this.store.list(); }
  async children(id: string): Promise<Task[]> { return (await this.list()).filter(t => t.parentId === id); }
  transition(id: string, to: TaskStatus, patch: Partial<Pick<Task, "result" | "error" | "session">> = {}): Promise<Task> {
    return this.locked(id, async () => {
      const cur = await this.store.read(id); if (!cur) throw new Error(`Unknown task ${id}`);
      assertTransition(cur.status, to);
      const now = new Date().toISOString();
      const next: Task = { ...cur, ...patch, status: to, ...(to === "running" && !cur.startedAt ? { startedAt: now } : {}), ...(TERMINAL.has(to) ? { finishedAt: now } : {}) };
      await this.store.write(id, next); this.onChange(next); return next;
    });
  }
  log(id: string, type: string, text: string): Promise<void> {
    return this.locked(id, async () => {
      const cur = await this.store.read(id); if (!cur) return;
      const next = { ...cur, log: [...cur.log, { ts: new Date().toISOString(), type, text }].slice(-TASK_LOG_CAP) };
      await this.store.write(id, next); this.onChange(next);
    });
  }
  async recoverInterrupted(): Promise<Task[]> {
    const out: Task[] = [];
    for (const t of await this.list()) if (t.status === "running" || t.status === "waiting") out.push(await this.transition(t.id, "failed", { error: "interrupted" }));
    return out;
  }
  async awardXp(registry: AgentRegistry, task: Task): Promise<void> {
    const agent = await registry.get(task.assigneeId); if (!agent) return;
    const xp = agent.stats.xp + (task.status === "done" ? xpFor(task.kind, agent.role) : 0);
    await registry.update(agent.id, { stats: { xp, level: levelFor(xp), tasksDone: agent.stats.tasksDone + (task.status === "done" ? 1 : 0), tasksFailed: agent.stats.tasksFailed + (task.status === "failed" ? 1 : 0) } });
  }
}
```

- [ ] **Step 3: Run → PASS. Commit** `feat(server): task service`.

---

### Task 6: Runtime interface and FakeRuntime

**Files:**
- Create: `packages/server/src/runtimes/types.ts`, `packages/server/src/runtimes/fake.ts`
- Test: `packages/server/test/runtimes/fake.test.ts`

**Interfaces:**
- Produces:
```ts
interface BridgeTool { name: string; description: string; schema: Record<string, z.ZodTypeAny>; handler: (args: Record<string, unknown>) => Promise<string> }
interface RunRequest { runId: string; agent: Agent; cwd: string; prompt: PromptPart[]; systemPrompt: string; sessionId?: string; tools: ToolAllowance; bridgeTools: BridgeTool[]; permissionMode: PermissionMode; model?: string; maxTurns?: number;
  onPermission?: (req: { id: string; tool: string; input: unknown }) => Promise<boolean> }
interface Runtime { provider: Provider; check(): Promise<ProviderStatus>; run(req: RunRequest, sink: (e: RunEvent) => void, signal: AbortSignal): Promise<RunResult> }
class FakeRuntime implements Runtime   // constructor(script: (req) => AsyncIterable<RunEvent | { type: "call"; tool: string; args: object }>, provider = "claude"); records `runs: RunRequest[]`
```
FakeRuntime executes `call` items by invoking `req.bridgeTools` handlers (so Manager tests exercise real tool code), honours `signal` (returns stopReason `aborted`), and concatenates `text` events into `RunResult.text`.

- [ ] **Step 1: Failing test**

```ts
import { it, expect } from "vitest";
import { z } from "zod";
import { defaultAgent } from "@agenticview/shared";
import { FakeRuntime } from "../../src/runtimes/fake.js";

const agent = defaultAgent({ name: "N", role: "worker", scope: "project", specialty: "" });
const base = { runId: "r_1", agent, cwd: ".", prompt: [{ type: "text" as const, text: "hi" }], systemPrompt: "", tools: agent.tools, bridgeTools: [], permissionMode: "auto" as const };

it("streams scripted events and calls bridge tools", async () => {
  const seen: string[] = [];
  const rt = new FakeRuntime(async function* () {
    yield { type: "text", text: "Hello " };
    yield { type: "call", tool: "echo", args: { s: "x" } };
    yield { type: "text", text: "world" };
  });
  const res = await rt.run({ ...base, bridgeTools: [{ name: "echo", description: "", schema: { s: z.string() }, handler: async a => { seen.push(String(a.s)); return "ok"; } }] }, e => seen.push(e.type), new AbortController().signal);
  expect(res.text).toBe("Hello world"); expect(res.stopReason).toBe("done");
  expect(seen).toEqual(["text", "tool_start", "x", "tool_end", "text"]);
  expect(rt.runs).toHaveLength(1);
});
it("aborts", async () => {
  const rt = new FakeRuntime(async function* () { yield { type: "text", text: "a" }; await new Promise(r => setTimeout(r, 1000)); yield { type: "text", text: "b" }; });
  const ac = new AbortController(); setTimeout(() => ac.abort(), 20);
  const res = await rt.run(base, () => {}, ac.signal);
  expect(res.stopReason).toBe("aborted");
});
```

- [ ] **Step 2: Implement**

`types.ts` holds the interfaces above. `fake.ts`:
```ts
import type { RunEvent, RunResult, ProviderStatus, Provider } from "@agenticview/shared";
import type { Runtime, RunRequest } from "./types.js";
export type FakeItem = RunEvent | { type: "call"; tool: string; args: Record<string, unknown> };
export type FakeScript = (req: RunRequest) => AsyncIterable<FakeItem>;
export class FakeRuntime implements Runtime {
  readonly runs: RunRequest[] = [];
  constructor(private readonly script: FakeScript, public readonly provider: Provider = "claude") {}
  async check(): Promise<ProviderStatus> { return { provider: this.provider, ok: true, version: "fake" }; }
  async run(req: RunRequest, sink: (e: RunEvent) => void, signal: AbortSignal): Promise<RunResult> {
    this.runs.push(req);
    let text = "";
    const aborted = new Promise<never>((_, rej) => signal.addEventListener("abort", () => rej(new Error("aborted")), { once: true }));
    try {
      const it = this.script(req)[Symbol.asyncIterator]();
      for (;;) {
        const { value, done } = await Promise.race([it.next(), aborted]);
        if (done) break;
        if (value.type === "call") {
          const tool = req.bridgeTools.find(t => t.name === value.tool);
          sink({ type: "tool_start", name: value.tool, input: value.args });
          if (!tool) { sink({ type: "tool_end", name: value.tool, ok: false, summary: "unknown tool" }); continue; }
          try { const out = await Promise.race([tool.handler(value.args), aborted]); sink({ type: "tool_end", name: value.tool, ok: true, summary: out.slice(0, 200) }); }
          catch (e) { if (signal.aborted) throw e; sink({ type: "tool_end", name: value.tool, ok: false, summary: String((e as Error).message) }); }
        } else { if (value.type === "text") text += value.text; sink(value); }
      }
      return { text, stopReason: "done", sessionId: req.sessionId ?? `fake-${req.runId}` };
    } catch (e) {
      if (signal.aborted) return { text, stopReason: "aborted" };
      return { text, stopReason: "error", error: String((e as Error).message) };
    }
  }
}
```

- [ ] **Step 3: Run → PASS. Commit** `feat(server): runtime interface and fake runtime`.

---

### Task 7: Tool bridge (registry, HTTP, stdio MCP)

**Files:**
- Create: `packages/server/src/bridge/toolRegistry.ts`, `packages/server/src/bridge/httpBridge.ts`, `packages/server/src/bridge/stdioBridge.ts`, `packages/server/src/bridge/jsonSchemaToZod.ts`
- Test: `packages/server/test/bridge/bridge.test.ts`

**Interfaces:**
- Produces:
```ts
class ToolRegistry {
  register(runId: string, tools: BridgeTool[]): { token: string }
  release(runId: string): void
  describe(runId: string, token: string): { name: string; description: string; inputSchema: Record<string, unknown> }[]  // throws BridgeAuthError
  call(runId: string, token: string, name: string, args: unknown): Promise<string>
}
function bridgeRoutes(registry: ToolRegistry): Hono   // GET /bridge/:runId/tools, POST /bridge/:runId/call  (header x-bridge-token)
function jsonSchemaToZodShape(schema: Record<string, unknown>): Record<string, z.ZodTypeAny>
// stdioBridge.ts is an executable entry: env AGENTICVIEW_BRIDGE_URL, AGENTICVIEW_RUN_ID, AGENTICVIEW_BRIDGE_TOKEN.
// It serves an MCP stdio server named "agenticview" whose tools proxy to the HTTP bridge.
```
Add dependency `zod-to-json-schema@^3.23.0` to the server package.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { ToolRegistry, BridgeAuthError } from "../../src/bridge/toolRegistry.js";
import { bridgeRoutes } from "../../src/bridge/httpBridge.js";
import { jsonSchemaToZodShape } from "../../src/bridge/jsonSchemaToZod.js";

const tools = [{ name: "add", description: "adds", schema: { a: z.number(), b: z.number() }, handler: async (x: Record<string, unknown>) => String(Number(x.a) + Number(x.b)) }];

describe("ToolRegistry", () => {
  it("describes and calls with the right token, rejects otherwise, forgets after release", async () => {
    const r = new ToolRegistry(); const { token } = r.register("r_1", tools);
    expect(r.describe("r_1", token)[0]).toMatchObject({ name: "add", inputSchema: { type: "object", properties: { a: { type: "number" } } } });
    expect(await r.call("r_1", token, "add", { a: 1, b: 2 })).toBe("3");
    expect(() => r.describe("r_1", "nope")).toThrow(BridgeAuthError);
    await expect(r.call("r_1", token, "add", { a: "x", b: 2 })).rejects.toThrow(/Invalid arguments/);
    r.release("r_1");
    expect(() => r.describe("r_1", token)).toThrow(BridgeAuthError);
  });
  it("json schema round-trips to a zod shape", () => {
    const r = new ToolRegistry(); const { token } = r.register("r_x", tools);
    const shape = z.object(jsonSchemaToZodShape(r.describe("r_x", token)[0]!.inputSchema));
    expect(shape.safeParse({ a: 1, b: 2 }).success).toBe(true);
    expect(shape.safeParse({ a: "x", b: 2 }).success).toBe(false);
  });
});

describe("bridgeRoutes", () => {
  it("serves tools and calls over HTTP with 404 for unknown/finished runs", async () => {
    const r = new ToolRegistry(); const { token } = r.register("r_2", tools); const app = bridgeRoutes(r);
    const list = await app.request("/bridge/r_2/tools", { headers: { "x-bridge-token": token } });
    expect(list.status).toBe(200); expect((await list.json())[0].name).toBe("add");
    const call = await app.request("/bridge/r_2/call", { method: "POST", headers: { "x-bridge-token": token, "content-type": "application/json" }, body: JSON.stringify({ name: "add", args: { a: 2, b: 2 } }) });
    expect(await call.json()).toEqual({ ok: true, result: "4" });
    const bad = await app.request("/bridge/r_2/call", { method: "POST", headers: { "x-bridge-token": token, "content-type": "application/json" }, body: JSON.stringify({ name: "add", args: { a: "q" } }) });
    expect(bad.status).toBe(200); expect((await bad.json()).ok).toBe(false);
    expect((await app.request("/bridge/r_2/tools", { headers: { "x-bridge-token": "bad" } })).status).toBe(404);
    r.release("r_2");
    expect((await app.request("/bridge/r_2/tools", { headers: { "x-bridge-token": token } })).status).toBe(404);
  });
});
```

- [ ] **Step 2: Implement**

`toolRegistry.ts`:
```ts
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { BridgeTool } from "../runtimes/types.js";
export class BridgeAuthError extends Error { constructor() { super("Unknown run or bad bridge token"); this.name = "BridgeAuthError"; } }
export class ToolRegistry {
  private readonly runs = new Map<string, { token: string; tools: Map<string, BridgeTool> }>();
  register(runId: string, tools: BridgeTool[]) { const token = randomBytes(16).toString("hex"); this.runs.set(runId, { token, tools: new Map(tools.map(t => [t.name, t])) }); return { token }; }
  release(runId: string) { this.runs.delete(runId); }
  private auth(runId: string, token: string) { const r = this.runs.get(runId); if (!r || r.token !== token) throw new BridgeAuthError(); return r; }
  describe(runId: string, token: string) {
    return [...this.auth(runId, token).tools.values()].map(t => ({ name: t.name, description: t.description, inputSchema: zodToJsonSchema(z.object(t.schema), { $refStrategy: "none" }) as Record<string, unknown> }));
  }
  async call(runId: string, token: string, name: string, args: unknown): Promise<string> {
    const tool = this.auth(runId, token).tools.get(name); if (!tool) throw new Error(`Unknown tool ${name}`);
    const parsed = z.object(tool.schema).safeParse(args ?? {});
    if (!parsed.success) throw new Error(`Invalid arguments for ${name}: ${parsed.error.message}`);
    return tool.handler(parsed.data);
  }
}
```

`httpBridge.ts`:
```ts
import { Hono } from "hono";
import { ToolRegistry, BridgeAuthError } from "./toolRegistry.js";
export function bridgeRoutes(registry: ToolRegistry): Hono {
  const app = new Hono();
  app.get("/bridge/:runId/tools", c => {
    try { return c.json(registry.describe(c.req.param("runId"), c.req.header("x-bridge-token") ?? "")); }
    catch (e) { if (e instanceof BridgeAuthError) return c.json({ ok: false, error: e.message }, 404); throw e; }
  });
  app.post("/bridge/:runId/call", async c => {
    const body = await c.req.json<{ name: string; args: unknown }>();
    try { return c.json({ ok: true, result: await registry.call(c.req.param("runId"), c.req.header("x-bridge-token") ?? "", body.name, body.args) }); }
    catch (e) {
      if (e instanceof BridgeAuthError) return c.json({ ok: false, error: e.message }, 404);
      return c.json({ ok: false, error: (e as Error).message });
    }
  });
  return app;
}
```

`jsonSchemaToZod.ts`:
```ts
import { z } from "zod";
export function jsonSchemaToZodShape(schema: Record<string, unknown>): Record<string, z.ZodTypeAny> {
  const props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = new Set((schema.required ?? []) as string[]);
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [k, p] of Object.entries(props)) {
    let t: z.ZodTypeAny;
    switch (p.type) {
      case "string": t = p.enum ? z.enum(p.enum as [string, ...string[]]) : z.string(); break;
      case "number": case "integer": t = z.number(); break;
      case "boolean": t = z.boolean(); break;
      case "array": t = z.array(((p.items as Record<string, unknown> | undefined)?.type === "string") ? z.string() : z.unknown()); break;
      case "object": t = z.record(z.unknown()); break;
      default: t = z.unknown();
    }
    if (typeof p.description === "string") t = t.describe(p.description);
    shape[k] = required.has(k) ? t : t.optional();
  }
  return shape;
}
```

`stdioBridge.ts`:
```ts
#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { jsonSchemaToZodShape } from "./jsonSchemaToZod.js";
const url = process.env.AGENTICVIEW_BRIDGE_URL, runId = process.env.AGENTICVIEW_RUN_ID, token = process.env.AGENTICVIEW_BRIDGE_TOKEN;
if (!url || !runId || !token) { console.error("agenticview bridge: missing env"); process.exit(2); }
const headers = { "x-bridge-token": token, "content-type": "application/json" };
const tools = (await (await fetch(`${url}/bridge/${runId}/tools`, { headers })).json()) as { name: string; description: string; inputSchema: Record<string, unknown> }[];
const server = new McpServer({ name: "agenticview", version: "0.1.0" });
for (const t of tools) {
  server.registerTool(t.name, { description: t.description, inputSchema: jsonSchemaToZodShape(t.inputSchema) }, async (args: Record<string, unknown>) => {
    const res = (await (await fetch(`${url}/bridge/${runId}/call`, { method: "POST", headers, body: JSON.stringify({ name: t.name, args }) })).json()) as { ok: boolean; result?: string; error?: string };
    return { content: [{ type: "text", text: res.ok ? (res.result ?? "") : `ERROR: ${res.error}` }], isError: !res.ok };
  });
}
await server.connect(new StdioServerTransport());
```

- [ ] **Step 3: Run → PASS. Commit** `feat(server): tool bridge`.

---

### Task 8: Claude runtime

**Files:**
- Create: `packages/server/src/runtimes/claude.ts`
- Test: `packages/server/test/runtimes/claude.test.ts`

**Interfaces:**
- Consumes: `query`, `tool`, `createSdkMcpServer` from `@anthropic-ai/claude-agent-sdk`, injected for tests: `new ClaudeRuntime({ sdk?: ClaudeSdk; apiKey?: string })` where `ClaudeSdk = { query: typeof query; tool: typeof tool; createSdkMcpServer: typeof createSdkMcpServer }`. Default: dynamic `import("@anthropic-ai/claude-agent-sdk")` on first run.
- Produces: `ClaudeRuntime implements Runtime`; pure exports `mapClaudeMessage(msg: unknown): RunEvent[]` and `claudeOptionsFor(req: RunRequest): { allowedTools: string[]; disallowedTools: string[]; permissionMode: "default" | "acceptEdits" | "bypassPermissions" }`.

Mapping rules (these are the tests):
- `tools.edit` → allowed `Read, Glob, Grep, Edit, Write, MultiEdit`; else allowed `Read, Glob, Grep` and disallowed `Edit, Write, MultiEdit`.
- `tools.shell` → allowed `Bash`; else disallowed `Bash`.
- `tools.web` → allowed `WebSearch, WebFetch`; else disallowed both.
- Every bridge tool → allowed `mcp__agenticview__<name>`.
- `permissionMode`: `auto` → `bypassPermissions`; `auto-edit` → `acceptEdits`; `ask` → `default` plus `canUseTool` that awaits `req.onPermission({ id, tool, input })` and returns `{ behavior: "allow", updatedInput: input }` or `{ behavior: "deny", message: "Denied by user in AgenticView" }` (deny when `onPermission` is absent).
- Prompt is an async iterable yielding one `SDKUserMessage` whose content is text blocks plus `image` blocks (`base64`, media type by extension: png, jpg/jpeg, webp, gif).
- Options: `cwd`, `resume: req.sessionId`, `model: req.model`, `maxTurns: req.maxTurns ?? 60`, `systemPrompt: { type: "preset", preset: "claude_code", append: req.systemPrompt }`, `mcpServers: { agenticview: createSdkMcpServer({ name: "agenticview", tools: [...] }) }` only when `bridgeTools.length > 0`, `abortController` bound to `signal`, `settingSources: ["project"]`.
- Messages → events: `assistant` text block → `text`; `tool_use` block → `tool_start`; `user` message `tool_result` block → `tool_end` (`ok: !is_error`, summary = first 200 chars of text content) and, if the matching `tool_use` was `Write|Edit|MultiEdit` with `file_path`, also `file_changed` (`kind: "modify"`, or `"create"` for Write); `result` → `RunResult` (`success` → `done`, `error_max_turns` → `max_turns`, others → `error` with `error: subtype`), `sessionId = session_id`, `costUsd = total_cost_usd`, `usage` from `usage.input_tokens/output_tokens`.
- `check()`: `ok: true` when any of `ANTHROPIC_API_KEY`, `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, `CLAUDE_CODE_USE_FOUNDRY`, `CLAUDE_CODE_USE_ANTHROPIC_AWS` is set or `apiKey` was given (it is exported as `ANTHROPIC_API_KEY` for the run); else `ok: false, reason: "Set ANTHROPIC_API_KEY (or a cloud provider env). The Agent SDK does not use the Claude Code login."`.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { defaultAgent } from "@agenticview/shared";
import { ClaudeRuntime, claudeOptionsFor, mapClaudeMessage } from "../../src/runtimes/claude.js";

const agent = defaultAgent({ name: "N", role: "worker", scope: "project", specialty: "" });
const req = (over: Partial<Parameters<typeof claudeOptionsFor>[0]> = {}) => ({ runId: "r_1", agent, cwd: "C:/p", prompt: [{ type: "text" as const, text: "do it" }], systemPrompt: "You are Nova.", tools: agent.tools, bridgeTools: [{ name: "add", description: "", schema: { a: z.number() }, handler: async () => "1" }], permissionMode: "auto-edit" as const, ...over });

const script = [
  { type: "system", subtype: "init", session_id: "s1" },
  { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Working" }, { type: "tool_use", id: "tu1", name: "Write", input: { file_path: "a.txt", content: "x" } }] } },
  { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu1", content: "ok" }] } },
  { type: "result", subtype: "success", result: "Done.", session_id: "s1", total_cost_usd: 0.01, usage: { input_tokens: 5, output_tokens: 7 }, num_turns: 1 },
];

function fakeSdk(capture: { options?: Record<string, unknown> }) {
  return {
    query: ({ options }: { prompt: unknown; options: Record<string, unknown> }) => { capture.options = options; return (async function* () { for (const m of script) yield m; })(); },
    tool: (name: string, description: string, schema: unknown, handler: unknown) => ({ name, description, schema, handler }),
    createSdkMcpServer: (cfg: { name: string; tools: unknown[] }) => ({ type: "sdk", name: cfg.name, instance: cfg }),
  } as never;
}

describe("claudeOptionsFor", () => {
  it("maps tool allowance and permission mode", () => {
    const o = claudeOptionsFor(req());
    expect(o.allowedTools).toEqual(expect.arrayContaining(["Read", "Edit", "Write", "Bash", "mcp__agenticview__add"]));
    expect(o.disallowedTools).toEqual(["WebSearch", "WebFetch"]);
    expect(o.permissionMode).toBe("acceptEdits");
    expect(claudeOptionsFor(req({ permissionMode: "auto" })).permissionMode).toBe("bypassPermissions");
    expect(claudeOptionsFor(req({ tools: { edit: false, shell: false, web: true, screenshot: false } })).disallowedTools).toEqual(["Edit", "Write", "MultiEdit", "Bash"]);
  });
});

describe("ClaudeRuntime.run", () => {
  it("streams mapped events and returns a result", async () => {
    const cap: { options?: Record<string, unknown> } = {};
    const rt = new ClaudeRuntime({ sdk: fakeSdk(cap), apiKey: "k" });
    const events: string[] = [];
    const res = await rt.run({ ...req(), sessionId: "prev" }, e => events.push(e.type), new AbortController().signal);
    expect(events).toEqual(["text", "tool_start", "tool_end", "file_changed"]);
    expect(res).toMatchObject({ text: "Done.", stopReason: "done", sessionId: "s1", costUsd: 0.01, usage: { inputTokens: 5, outputTokens: 7 } });
    expect(cap.options).toMatchObject({ cwd: "C:/p", resume: "prev", permissionMode: "acceptEdits" });
    expect((cap.options!.mcpServers as Record<string, unknown>).agenticview).toBeDefined();
  });
  it("asks the user in ask mode", async () => {
    const cap: { options?: Record<string, unknown> } = {};
    const rt = new ClaudeRuntime({ sdk: fakeSdk(cap), apiKey: "k" });
    await rt.run({ ...req({ permissionMode: "ask" }), onPermission: async () => false }, () => {}, new AbortController().signal);
    const canUse = cap.options!.canUseTool as (n: string, i: unknown, o: unknown) => Promise<{ behavior: string }>;
    expect((await canUse("Bash", { command: "rm" }, { signal: new AbortController().signal })).behavior).toBe("deny");
  });
  it("check reports the missing key reason", async () => {
    const saved = { ...process.env };
    for (const k of ["ANTHROPIC_API_KEY", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY", "CLAUDE_CODE_USE_ANTHROPIC_AWS"]) delete process.env[k];
    const s = await new ClaudeRuntime({ sdk: fakeSdk({}) }).check();
    expect(s.ok).toBe(false); expect(s.reason).toMatch(/ANTHROPIC_API_KEY/);
    process.env = saved;
  });
});

it("mapClaudeMessage ignores unknown messages", () => {
  expect(mapClaudeMessage({ type: "system", subtype: "compact_boundary" })).toEqual([]);
});
```

- [ ] **Step 2: Implement** `claude.ts` following the mapping rules. Keep a `Map<toolUseId, { name; input }>` inside `run` so `tool_result` can be paired with its `tool_use`. Load the SDK lazily: `this.sdk ??= await import("@anthropic-ai/claude-agent-sdk")`. Set `process.env.ANTHROPIC_API_KEY` only for the duration of `run` when `apiKey` was given and the env was empty (restore afterward).

- [ ] **Step 3: Run → PASS. Commit** `feat(server): claude runtime`.

---

### Task 9: Manager orchestrator

**Files:**
- Create: `packages/server/src/events/bus.ts`, `packages/server/src/manager/preamble.ts`, `packages/server/src/manager/tools.ts`, `packages/server/src/manager/orchestrator.ts`, `packages/server/src/world.ts`
- Test: `packages/server/test/manager/orchestrator.test.ts`, `packages/server/test/manager/preamble.test.ts`

**Interfaces:**
- Consumes: `AgentRegistry`, `TaskService`, `Runtime`, `ToolRegistry`, `ServerMessage`.
- Produces:
```ts
class EventBus { on(fn: (m: ServerMessage) => void): () => void; emit(m: ServerMessage): void }
function buildRosterPreamble(world: WorldInfo, agents: Agent[], tasks: Task[]): string
interface WorldDeps { world: WorldRef; registry: AgentRegistry; tasks: TaskService; runtimes: Map<Provider, Runtime>; toolRegistry: ToolRegistry; bus: EventBus; settings: () => ProjectSettings & { globalDefaultProvider: Provider; globalDefaultModel: string | null }; bridgeUrl: () => string; knownProjects: () => { path: string; name: string; lastOpened: string }[] }
class Orchestrator {
  constructor(deps: WorldDeps)
  handleUserMessage(input: { agentId: string; text: string; images?: string[]; projectPath?: string }): Promise<Task>   // manager -> request task; worker -> chat task
  startTask(taskId: string): void                       // queues respecting maxConcurrentRuns
  cancel(taskId: string): Promise<void>
  respondPermission(id: string, allow: boolean): void
  respondQuestion(id: string, answer: string): void
  awaitTask(taskId: string): Promise<Task>              // resolves when terminal
  resolveProvider(agent: Agent): { provider: Provider; model?: string }
  running(): number
}
function createWorld(ref: WorldRef, opts: { runtimes; bus; toolRegistry; bridgeUrl }): Promise<{ deps: WorldDeps; orchestrator: Orchestrator; info: () => Promise<WorldInfo> }>
```
`managerTools(ctx)` returns `BridgeTool[]` with the five tools from spec §4.4: `list_agents`, `list_tasks`, `create_agent`, `assign_task`, `await_tasks`, `ask_user`.

Behaviour to pin:
1. Manager request: `handleUserMessage({ agentId: managerId, text })` creates a `request` task assigned to the manager, transitions it `assigned → running`, runs the manager runtime with prompt `[preamble, text]`, and on completion transitions to `done` with `result = RunResult.text` (or `failed` with `error`). The manager's session id is persisted in `<root>/sessions/<agentId>.json` per world and passed as `sessionId` next time.
2. `assign_task` from inside the manager run creates a child `work` task, calls `startTask`, returns `Started task t_x for Nova`. The worker run uses `cwd = task.projectPath`, `systemPrompt` = worker role text + `agent.systemPrompt`, `prompt = [task.title + "\n\n" + task.description, ...images]`, `bridgeTools = []` (plus the screenshot tool when `agent.tools.screenshot`, Task 16).
3. Scope rule: `assign_task` to a project agent whose project differs from `task.projectPath` returns an error string starting with `ERROR: scope`; the task is not created. In the hub, `assign_task` requires `projectPath` in the args and it must be a known project.
4. Concurrency: with `maxConcurrentRuns = 1`, two `assign_task`s produce one `running` and one `assigned` task; when the first finishes, the second starts.
5. `await_tasks` resolves with `[{ id, status, result|error }]` once all are terminal; while waiting the manager's request task is `waiting`, then back to `running`.
6. Cancel: `cancel(taskId)` aborts the run's `AbortController`, transitions to `cancelled`, frees the slot, and a pending `await_tasks` returns with `status: "cancelled"`.
7. Permission: a runtime's `onPermission` emits `permission.request` on the bus and blocks; `respondPermission(id, allow)` resolves it and emits `permission.resolved`. Same for `ask_user` / `question.*`.
8. XP is awarded on every terminal transition via `tasks.awardXp`.
9. Every `RunEvent` is re-emitted as `run.event` and appended to the task log (`text` events coalesced: append to the last log entry when it is also `text` and under 2000 chars).
10. `resolveProvider`: agent.provider ?? settings.defaultProvider ?? globalDefaultProvider; model likewise. If the runtime for that provider is missing or `check()` failed, the task fails immediately with `error: "provider <p> unavailable: <reason>"`.

- [ ] **Step 1: Failing tests**

`preamble.test.ts`:
```ts
import { it, expect } from "vitest";
import { defaultAgent } from "@agenticview/shared";
import { buildRosterPreamble } from "../../src/manager/preamble.js";
it("lists roster and open tasks", () => {
  const m = defaultAgent({ id: "m_1", name: "Atlas", role: "manager", scope: "project", specialty: "manager" });
  const w = defaultAgent({ id: "w_1", name: "Nova", role: "worker", scope: "project", specialty: "frontend", provider: "gemini" });
  const g = defaultAgent({ id: "w_2", name: "Rover", role: "worker", scope: "global", specialty: "tests" });
  const out = buildRosterPreamble({ kind: "project", name: "demo", projectPath: "C:/demo", knownProjects: [] }, [m, w, g], [
    { id: "t_1", kind: "request", title: "Add dark mode", description: "", status: "running", createdBy: "user", assigneeId: "m_1", projectPath: "C:/demo", images: [], log: [], createdAt: "" },
    { id: "t_2", kind: "work", title: "CSS vars", description: "", status: "running", createdBy: "m_1", assigneeId: "w_1", parentId: "t_1", projectPath: "C:/demo", images: [], log: [], createdAt: "" },
    { id: "t_0", kind: "work", title: "old", description: "", status: "done", createdBy: "m_1", assigneeId: "w_1", projectPath: "C:/demo", images: [], log: [], createdAt: "" },
  ]);
  expect(out).toContain("## Roster");
  expect(out).toContain('- w_1 "Nova" worker/project — frontend — gemini — running t_2');
  expect(out).toContain('- w_2 "Rover" worker/global — tests — default — idle');
  expect(out).not.toContain("m_1");
  expect(out).toContain("## Open tasks");
  expect(out).toContain('- t_2 work "CSS vars" (running) → w_1, parent t_1');
  expect(out).not.toContain("t_0");
});
```

`orchestrator.test.ts` (uses `FakeRuntime` and a temp home/project; helper `setup(script, settings?)` builds a world with `createWorld` and a `Map([["claude", fake]])`; collects bus messages in `msgs`):
```ts
it("runs a manager request end to end with delegation", async () => {
  const { orch, reg, tasks, msgs } = await setup(async function* (req) {
    if (req.agent.role === "manager") {
      yield { type: "call", tool: "create_agent", args: { name: "Nova", specialty: "frontend" } };
      const nova = (await reg.list()).find(a => a.name === "Nova")!;
      yield { type: "call", tool: "assign_task", args: { agentId: nova.id, title: "CSS", description: "add vars" } };
      const child = (await tasks.list()).find(t => t.kind === "work")!;
      yield { type: "call", tool: "await_tasks", args: { taskIds: [child.id] } };
      yield { type: "text", text: "All done." };
    } else { yield { type: "text", text: "vars added" }; }
  });
  const m = await reg.ensureManager();
  const t = await orch.handleUserMessage({ agentId: m.id, text: "Add dark mode" });
  const final = await orch.awaitTask(t.id);
  expect(final.status).toBe("done"); expect(final.result).toBe("All done.");
  const child = (await tasks.list()).find(x => x.kind === "work")!;
  expect(child.status).toBe("done"); expect(child.result).toBe("vars added"); expect(child.parentId).toBe(t.id);
  expect(msgs.filter(x => x.type === "run.event").length).toBeGreaterThan(0);
  const nova = (await reg.list()).find(a => a.name === "Nova")!;
  expect(nova.stats).toMatchObject({ xp: 10, tasksDone: 1 });
  expect((await reg.get(m.id))!.stats.xp).toBe(5);
  expect(msgs.some(x => x.type === "task.updated" && x.task.id === t.id && x.task.status === "waiting")).toBe(true);
});
it("refuses cross-project assignment", async () => { /* assign_task with projectPath "C:/other" for a project agent → returns "ERROR: scope..." and no work task exists */ });
it("respects maxConcurrentRuns", async () => { /* settings maxConcurrentRuns 1; worker script waits on a deferred; two assign_task → statuses ["running","assigned"]; resolve → both done */ });
it("cancel aborts a hung worker and unblocks await_tasks", async () => { /* worker script never yields (awaits a never-resolving promise); manager awaits; orch.cancel(child) → child cancelled, manager result contains "cancelled", running() === 0 */ });
it("permission round trip", async () => { /* FakeRuntime script calls req.onPermission({id:"p1",tool:"Bash",input:{}}) and yields its result as text; test sees permission.request on bus, calls respondPermission("p1", true); final text "true" */ });
it("fails fast when the provider is unavailable", async () => { /* runtimes map without "gemini"; agent.provider "gemini"; chat → task failed, error matches /provider gemini unavailable/ */ });
it("persists the manager session id", async () => { /* two requests; second FakeRuntime run has req.sessionId === "fake-<runId of first>" */ });
```
Write each of the sketched tests in full when implementing; each comment above is its assertion list.

- [ ] **Step 2: Implement**

Key code shapes:

```ts
// preamble.ts
export function buildRosterPreamble(world: WorldInfo, agents: Agent[], tasks: Task[]): string {
  const open = tasks.filter(t => !["done", "failed", "cancelled"].includes(t.status));
  const runningBy = new Map(open.filter(t => t.status === "running" || t.status === "waiting").map(t => [t.assigneeId, t.id]));
  const lines = [`# AgenticView ${world.kind} world: ${world.name}`, world.projectPath ? `Project path: ${world.projectPath}` : `Known projects: ${world.knownProjects.map(p => `${p.name} (${p.path})`).join(", ") || "none"}`, "", "## Roster"];
  for (const a of agents.filter(a => a.role === "worker")) lines.push(`- ${a.id} "${a.name}" worker/${a.scope} — ${a.specialty || "generalist"} — ${a.provider ?? "default"} — ${runningBy.has(a.id) ? `running ${runningBy.get(a.id)}` : "idle"}`);
  if (!agents.some(a => a.role === "worker")) lines.push("- (no workers yet; use create_agent)");
  lines.push("", "## Open tasks");
  for (const t of open) lines.push(`- ${t.id} ${t.kind} "${t.title}" (${t.status}) → ${t.assigneeId}${t.parentId ? `, parent ${t.parentId}` : ""}`);
  if (open.length === 0) lines.push("- none");
  return lines.join("\n");
}
```

Manager system prompt (constant in `tools.ts`, `MANAGER_SYSTEM_PROMPT`): explains the role, that the roster preamble is authoritative, to prefer existing specialists, to create agents only when no fit exists, to give each `assign_task` a self-contained description with file hints, to call `await_tasks` before reporting, and to end with a short report for the user.

Worker system prompt (`workerSystemPrompt(agent, world)`): name, specialty, "you are working inside <projectPath>", "make the change, run relevant tests, and finish with a two-sentence summary".

Orchestrator internals: `private runs = new Map<taskId, { ac: AbortController; done: Promise<Task> }>()`, `private queue: string[]`, `private pending = new Map<string, (v: boolean | string) => void>()` for permissions/questions, `private waiters = new Map<taskId, Array<(t: Task) => void>>()`. `startTask` pushes to the queue and calls `pump()`, which starts runs while `running() < settings().maxConcurrentRuns`. `execute(task)` transitions `assigned → running`, resolves the provider, builds `RunRequest`, registers bridge tools in `toolRegistry` (`register(runId, tools)`), calls `runtime.run`, then `release(runId)`, transitions to a terminal state, awards XP, resolves waiters, and calls `pump()` again. `awaitTask` returns immediately when already terminal.

`createWorld` wires: `AgentRegistry`, `TaskService(join(root, "tasks"), t => bus.emit({ type: "task.updated", task: t }))`, `tasks.recoverInterrupted()` on boot, `registry.ensureManager()`, settings loaded from `<root>/settings.json` (project) and `globalRoot()/config.json`, and for a project world it upserts the project into `knownProjects` (name = folder basename, `lastOpened = now`).

- [ ] **Step 3: Run → PASS. Commit** `feat(server): manager orchestrator and world wiring`.

---

### Task 10: HTTP API, WebSocket, and auth

**Files:**
- Create: `packages/server/src/api/auth.ts`, `packages/server/src/api/http.ts`, `packages/server/src/api/ws.ts`, `packages/server/src/hooks/mirror.ts`, `packages/server/src/server.ts`
- Test: `packages/server/test/api/server.test.ts`

**Interfaces:**
- Produces:
```ts
createServer(opts: { world: WorldRef; token: string; port?: number; host?: "127.0.0.1"; runtimes?: Map<Provider, Runtime>; staticDir?: string }): Promise<{ url: string; port: number; close(): Promise<void>; orchestrator: Orchestrator }>
```
Routes (all require `?token=` or header `x-agenticview-token`, except `/bridge/*` which uses its own token, and `/healthz`):
- `GET /healthz` → `{ ok: true }` (no auth; used by the CLI and hooks to detect a running server)
- `GET /api/snapshot` → same payload as the `snapshot` message
- `POST /api/upload` multipart image → `{ path }` under `.agenticview/uploads/<id>.<ext>`
- `POST /hooks` `{ kind, text }` → emits `mirror.event` (token required)
- `GET /ws` WebSocket: on connect sends `snapshot`; accepts `ClientMessage`; invalid JSON or schema → `{ type: "error", message }`.
- Static files from `staticDir` (the web build) at `/`, SPA fallback to `index.html`.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, afterEach } from "vitest";
import WebSocket from "ws";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../../src/server.js";
import { FakeRuntime } from "../../src/runtimes/fake.js";

let close: () => Promise<void>;
afterEach(async () => { await close?.(); });
async function boot() {
  const home = await mkdtemp(join(tmpdir(), "av-h-")); const proj = await mkdtemp(join(tmpdir(), "av p-"));
  process.env.AGENTICVIEW_HOME = home;
  const fake = new FakeRuntime(async function* () { yield { type: "text", text: "hi there" }; });
  const s = await createServer({ world: { kind: "project", projectPath: proj }, token: "tok", runtimes: new Map([["claude", fake]]) });
  close = s.close; return { s, proj };
}
function open(url: string, token: string) {
  const ws = new WebSocket(`${url.replace("http", "ws")}/ws?token=${token}`);
  const msgs: any[] = []; ws.on("message", d => msgs.push(JSON.parse(String(d))));
  return new Promise<{ ws: WebSocket; msgs: any[] }>(res => ws.on("open", () => res({ ws, msgs })));
}
const until = (msgs: any[], pred: (m: any) => boolean) => new Promise<any>(r => { const i = setInterval(() => { const m = msgs.find(pred); if (m) { clearInterval(i); r(m); } }, 10); });

describe("server", () => {
  it("rejects missing token and serves healthz", async () => {
    const { s } = await boot();
    expect((await fetch(`${s.url}/healthz`)).status).toBe(200);
    expect((await fetch(`${s.url}/api/snapshot`)).status).toBe(401);
    expect((await fetch(`${s.url}/api/snapshot`, { headers: { "x-agenticview-token": "tok" } })).status).toBe(200);
  });
  it("sends a snapshot on connect and broadcasts to two clients", async () => {
    const { s } = await boot();
    const a = await open(s.url, "tok"); const b = await open(s.url, "tok");
    const snap = await until(a.msgs, m => m.type === "snapshot");
    expect(snap.agents.some((x: any) => x.role === "manager")).toBe(true);
    const managerId = snap.agents.find((x: any) => x.role === "manager").id;
    a.ws.send(JSON.stringify({ type: "chat.send", agentId: managerId, text: "hello" }));
    const doneA = await until(a.msgs, m => m.type === "task.updated" && m.task.status === "done");
    const doneB = await until(b.msgs, m => m.type === "task.updated" && m.task.status === "done");
    expect(doneA.task.id).toBe(doneB.task.id); expect(doneA.task.result).toBe("hi there");
    expect(b.msgs.filter(m => m.type === "task.updated" && m.task.status === "done")).toHaveLength(1);
    a.ws.close(); b.ws.close();
  });
  it("rejects a bad websocket token and malformed messages", async () => {
    const { s } = await boot();
    const bad = new WebSocket(`${s.url.replace("http", "ws")}/ws?token=nope`);
    await new Promise(r => bad.on("error", r));
    const a = await open(s.url, "tok"); a.ws.send("{not json");
    const err = await until(a.msgs, m => m.type === "error"); expect(err.message).toMatch(/JSON/); a.ws.close();
  });
  it("mirrors hook events", async () => {
    const { s } = await boot(); const a = await open(s.url, "tok");
    await fetch(`${s.url}/hooks`, { method: "POST", headers: { "content-type": "application/json", "x-agenticview-token": "tok" }, body: JSON.stringify({ kind: "PostToolUse", text: "Edit src/a.ts" }) });
    const m = await until(a.msgs, m => m.type === "mirror.event"); expect(m.event.text).toBe("Edit src/a.ts"); a.ws.close();
  });
});
```

- [ ] **Step 2: Implement**

`auth.ts`: Hono middleware `requireToken(token)` checking query `token` or header; 401 JSON otherwise. `http.ts`: `apiRoutes(deps)` with the routes above; upload uses `c.req.parseBody()` and writes with `writeFile`. `ws.ts`: `attachWs(server: http.Server, opts)` using `WebSocketServer({ noServer: true })`; on `upgrade` verify path `/ws` and token (destroy socket with `401` otherwise); per client: send snapshot, subscribe to bus (`bus.on`) and forward JSON, on `message` parse with `ClientMessageSchema.safeParse`, dispatch:
- `snapshot.request` → resend snapshot
- `chat.send` → `orchestrator.handleUserMessage`
- `agent.create` → provider check (Task 15 adds real checks; here `runtimes.get(p)?.check()`), then `registry.create` → `agent.updated`
- `agent.update` / `agent.delete` / `agent.copyToProject` → registry, emit
- `task.cancel` → `orchestrator.cancel`
- `permission.respond` / `question.respond` → orchestrator
- `settings.update` → merge and persist `<root>/settings.json`, emit fresh `snapshot`
- `project.open` (hub) → reply `{ type: "opened", url }` after `openProjectWindow` (Task 11 wires it; here it emits an `error` "not available")
Errors from any handler → `{ type: "error", message, ref: msg.type }`.

`server.ts`: `createServer` builds the Hono app (`bridgeRoutes` first, then `requireToken` for `/api/*`, `/hooks`, then `serveStatic`), `@hono/node-server` `serve({ fetch, hostname: "127.0.0.1", port: opts.port ?? 0 })`, attaches ws, resolves the bound port, sets `bridgeUrl = http://127.0.0.1:<port>`, then `createWorld`. `close()` closes ws clients and the http server.

- [ ] **Step 3: Run → PASS. Commit** `feat(server): http api, websocket, auth`.

---

### Task 11: CLI and bootstrap

**Files:**
- Create: `packages/server/src/cli.ts`, `bin/agenticview.mjs`
- Test: `packages/server/test/cli.test.ts`, `test/bin.test.mjs` (root, node test runner: `node --test test/`)

**Interfaces:**
- `packages/server/dist/cli.js` subcommands:
  - `open --project <path> [--no-browser] [--port N]` → starts a project world server, prints `AgenticView: <url>` on stdout, keeps running; if `~/.agenticview/instances/<hash(projectPath)>.json` names a live server (healthz ok), prints its URL, opens the browser, and exits 0 instead of starting a second one.
  - `hub [--no-browser]` → same for the hub world.
  - `hook` → reads the hook JSON from stdin, finds the instance file for `cwd` (or any live instance), POSTs `{ kind, text }` to `/hooks` with a 250 ms timeout, always exits 0 within 300 ms.
  - `record-plugin-root <path>` → writes `~/.agenticview/plugin-root`.
- `bin/agenticview.mjs`: resolves the repo root from its own location, checks `node_modules/@hono/node-server` exists, else runs `npm install --omit=dev --no-audit --no-fund` in the root (prints "Installing AgenticView dependencies (first run)…"), then `import()`s `packages/server/dist/cli.js` and forwards `process.argv`. Browser opening: `start "" "<url>"` on win32, `open` on darwin, `xdg-open` otherwise, via `child_process.spawn` detached; failures are non-fatal.

Instance file: `{ pid, url, token, projectPath|null, startedAt }`. The URL printed and opened includes `#token=<token>`; the page moves it into memory and clears the hash.

- [ ] **Step 1: Failing tests**

`cli.test.ts` spawns `node dist/cli.js open --project "<temp dir with a space>" --no-browser` with `AGENTICVIEW_HOME` set, waits for the `AgenticView: http://127.0.0.1:` line, hits `/healthz`, checks the instance file exists and contains the same URL, runs a second `open` for the same project and expects it to exit 0 quickly with the same URL, then kills the first. A second test runs `hook` with no live server and asserts exit 0 in under 300 ms. A third pipes a `PostToolUse` JSON into `hook` with a live server and asserts the server received it (via a WebSocket client waiting for `mirror.event`). Build the server before this test (`npm run build -w packages/server` in `globalSetup`).

`test/bin.test.mjs`: runs `node bin/agenticview.mjs --help` and expects usage text and exit 0 (this also proves the bootstrap resolves its own path).

- [ ] **Step 2: Implement** `cli.ts` with `node:util parseArgs`; hook text formatting: `UserPromptSubmit` → `You: <prompt first 120 chars>`, `PostToolUse` → `<tool_name> <file_path|command|pattern first 80 chars>`, `SessionStart` → `Session started`, `SessionEnd` → `Session ended`. Hook input fields per Claude Code docs: `hook_event_name`, `tool_name`, `tool_input`, `prompt`, `cwd`.

- [ ] **Step 3: Run → PASS. Commit** `feat: cli and bootstrap`.

---

### Task 12: Web app — scaffold, state, network, 3D office, core HUD

**Files:**
- Create: `packages/web/package.json`, `packages/web/tsconfig.json`, `packages/web/vite.config.ts`, `packages/web/vitest.config.ts`, `packages/web/index.html`
- Create: `packages/web/src/main.tsx`, `App.tsx`, `state/store.ts`, `net/ws.ts`, `scene/Office.tsx`, `scene/layout.ts`, `scene/Robot.tsx`, `scene/Beam.tsx`, `hud/TopBar.tsx`, `hud/TaskBoard.tsx`, `hud/ChatPanel.tsx`, `hud/CommandBar.tsx`, `styles.css`
- Test: `packages/web/test/store.test.ts`, `packages/web/test/layout.test.ts`, `packages/web/test/TaskBoard.test.tsx`, `packages/web/test/ChatPanel.test.tsx`

**Interfaces:**
- Consumes: `ServerMessage`, `ClientMessage`, `Agent`, `Task`, `RunEvent` from `@agenticview/shared` (web imports types and zod schemas only; the shared package has no Node-only imports except `ids.ts`, which uses `node:crypto` — move `newId` to use `globalThis.crypto.getRandomValues` so it is isomorphic).
- Produces (store):
```ts
interface Store {
  connected: boolean; world?: WorldInfo; agents: Record<string, Agent>; tasks: Record<string, Task>; providers: ProviderStatus[]; settings?: ProjectSettings;
  feed: Record<string /*agentId*/, FeedItem[]>;          // last 200 per agent: { ts, taskId, event: RunEvent } | { ts, taskId, user: string }
  bubbles: Record<string /*agentId*/, { text: string; until: number }>;
  beams: { id: string; from: string; to: string; until: number }[];
  permissions: { id: string; agentId: string; taskId: string; tool: string; input: unknown }[];
  questions: { id: string; agentId: string; taskId: string; question: string }[];
  mirror: { kind: string; text: string; ts: string }[];
  selectedAgentId?: string; celebrations: { agentId: string; until: number }[];
  apply(msg: ServerMessage): void; select(id?: string): void; send: (m: ClientMessage) => void;
}
agentStatus(agent: Agent, tasks: Task[], permissions, questions): "idle" | "thinking" | "editing" | "waiting" | "error"
layoutFor(agents: Agent[]): Record<string, { x: number; z: number; zone: "podium" | "desk" | "lobby" }>
```
Status rules: `waiting` when a permission or question is pending for the agent; `editing` when its running task's last feed event within 3 s is `file_changed`/`tool_start`; `thinking` when it has a `running`/`waiting` task; `error` when its most recent terminal task in the last 10 s is `failed`; else `idle`.
`apply` rules: `snapshot` replaces world/agents/tasks/providers/settings; `task.updated` upserts and, when a `work` task first becomes `assigned`, pushes a beam from the manager to the assignee for 1.5 s; when a `request` task becomes `done`, pushes a celebration for the manager for 2 s; `run.event` appends to `feed[agentId]` and sets a bubble (`text` → first 90 chars, `tool_start` → `⚙ <name>`, `file_changed` → `✎ <basename>`) for 4 s; `permission.request`/`question.request` push; `.resolved` remove; `mirror.event` prepends (cap 50).

Layout: manager at `(0,0)` podium; N project workers on a ring of radius `4 + 0.4*N` at equal angles starting from `-90°`; global workers on a lobby row at `z = -9`, spaced 2.2 apart, centred.

- [ ] **Step 1: Package and failing tests**

`packages/web/package.json` deps: `react@^19`, `react-dom@^19`, `three@^0.169`, `@react-three/fiber@^9`, `@react-three/drei@^10`, `zustand@^5`, `@agenticview/shared`; dev: `vite@^6`, `@vitejs/plugin-react@^4`, `@types/react`, `@types/react-dom`, `@types/three`, `vitest`, `jsdom`, `@testing-library/react@^16`, `@testing-library/user-event`, `@testing-library/jest-dom`. Scripts: `build: vite build`, `dev: vite`. `vite.config.ts`: `base: "./"`, `build.outDir: "dist"`, dev proxy `/api`, `/ws`, `/hooks` → `http://127.0.0.1:4310` (dev port used by `npm run dev` with `AGENTICVIEW_PORT=4310`).

`store.test.ts` asserts each `apply` rule above with literal messages (snapshot → agents keyed by id; run.event → bubble text `⚙ Write`; task.updated assigned → one beam from manager to worker; request done → celebration; permission.request then permission.resolved → list empty). `layout.test.ts` asserts the manager at origin, 3 project workers at 120° spacing on radius 5.2, and 2 global workers at `z = -9` with `x = ±1.1`. `TaskBoard.test.tsx` renders tasks grouped under headings `Running`, `Queued`, `Waiting`, `Done`, `Failed` with children indented under parents, and clicking a Cancel button calls `send({ type: "task.cancel", id })`. `ChatPanel.test.tsx` renders the selected agent's feed (user lines right-aligned, agent text left), typing and pressing Enter calls `send({ type: "chat.send", agentId, text, images: [] })`, and pasting an image file calls `fetch('/api/upload')` (mocked) then includes the returned path in `images`.

- [ ] **Step 2: Implement**

`net/ws.ts`: `connect(store)` reads `location.hash` for `token=`, stores it in `sessionStorage` (wrapped in try/catch), clears the hash, opens `ws://<host>/ws?token=…`, dispatches `store.apply(JSON.parse(data))`, reconnects with backoff 0.5 s → 5 s and sends `snapshot.request` after reopen; `send` queues while disconnected. Exposes `apiFetch(path, init)` that adds the token header.

`scene/Office.tsx`: `<Canvas dpr={[1, 1.5]} camera={{ position: [11, 12, 11], fov: 40 }} shadows={false}>`, `OrbitControls` (drei) limited to polar 0.6–1.3 rad, ambient + directional light, floor plane 30×30 `#1b1e2b`, lobby platform `#232a3d` at `z=-9`, desks as boxes under workers, podium as a cylinder under the manager, a `<Robot>` per agent, `<Beam>` per beam, a `+` pad (`<Html>` button) at the next free desk position that calls `onCreate()`.

`scene/Robot.tsx`: group at layout position; `useFrame` bobs `y = 0.9 + sin(t*2 + seed)*0.05` when idle, scales pulse when thinking; `sphereGeometry` radius 0.6 with `meshStandardMaterial color=agent.appearance.color`; two eye spheres (or a visor box for `eyes: "visor"`); antenna cylinder + small sphere tinted by status; `torusGeometry` ring under the body with the status colour (`idle #6b7280`, `thinking #3b82f6`, `editing #22c55e`, `waiting #f59e0b`, `error #ef4444`); `<Html center distanceFactor={12}>` name tag with level badge `Lv N` and a bubble div when `bubbles[agent.id]` is active; `onClick` → `select(agent.id)`; selected robots get an emissive accent.

`scene/Beam.tsx`: a `<Line>` (drei) from → to with `dashed` and animated `dashOffset`, removed when `until < now`.

HUD: `TopBar` (world name, provider chip per `providers` with green/grey dot, Hub/Project link, ⚙ settings button, ● connection dot), `TaskBoard` (left column), `ChatPanel` (right column: header with agent name/specialty/provider/XP bar; feed; textarea with paste handler; Send), `CommandBar` (bottom: input "Tell Atlas what to build…" → `chat.send` to the manager). `App.tsx` composes them over the canvas with CSS grid; `styles.css` dark theme, `prefers-color-scheme` respected, 16 px gutters, panels collapse to tabs under 900 px width.

- [ ] **Step 3: Run → PASS (`npx vitest run packages/web`), `npm run build -w packages/web` succeeds. Commit** `feat(web): office scene, state, hud`.

---

### Task 13: Web app — permissions, questions, create agent, settings, hub

**Files:**
- Create: `packages/web/src/hud/PermissionToast.tsx`, `hud/QuestionToast.tsx`, `hud/CreateAgentModal.tsx`, `hud/SettingsModal.tsx`, `hud/AgentMenu.tsx`, `hub/HubView.tsx`, `scene/Confetti.tsx`
- Modify: `App.tsx`, `scene/Robot.tsx` (waiting-state bubble with Allow/Deny), `scene/Office.tsx`
- Test: `packages/web/test/CreateAgentModal.test.tsx`, `test/PermissionToast.test.tsx`, `test/HubView.test.tsx`

Behaviour:
- `PermissionToast` shows tool + pretty input (`command` for Bash, `file_path` for edits) with Allow/Deny → `permission.respond`. The same buttons render inside the robot's bubble.
- `QuestionToast` shows the question with a text field → `question.respond`.
- `CreateAgentModal`: fields name, specialty, description, provider select (options from `providers`; unavailable ones disabled with the reason as title text; "Default (<provider>)" first), model (text, placeholder "provider default"), tools checkboxes (edit, shell, web, screenshot), permission mode radio, scope radio (project/global; hub shows global only), colour swatch. Submit → `agent.create`. Server errors (`type: "error", ref: "agent.create"`) are shown inline.
- `AgentMenu` (on the selected robot's chat header): Edit (opens the modal prefilled → `agent.update`), Copy to project (only for global agents in a project world → `agent.copyToProject`), Delete (confirm → `agent.delete`; hidden for managers).
- `SettingsModal`: default provider, default model, max concurrent runs → `settings.update`; a provider status list with reasons; a note for Claude explaining `ANTHROPIC_API_KEY`.
- `HubView` (when `world.kind === "hub"`): the lobby-only scene plus a "Projects" panel listing `knownProjects` with an Open button → `project.open` and the returned `opened.url` opened in a new tab; the command bar targets the hub manager and includes a project selector that fills `projectPath` on `chat.send`.
- `Confetti`: 60 small boxes bursting from the manager for 2 s when a celebration is active.

Tests: modal disables an unavailable provider and submits the expected `agent.create` payload; toast buttons send the right responses; hub view lists projects and sends `project.open` with the path.

- [ ] Steps: write tests → fail → implement → pass → `npm run build -w packages/web` → commit `feat(web): modals, permissions, hub, confetti`.

---

### Task 14: Plugin surface and README

**Files:**
- Create: `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `skills/agenticview/SKILL.md`, `skills/agenticview-hub/SKILL.md`, `hooks/hooks.json`, `hooks/hook.mjs`, `README.md`, `LICENSE` (MIT)
- Test: `test/plugin.test.mjs` (node test runner)

`plugin.json`:
```json
{ "name": "agenticview", "displayName": "AgenticView", "description": "Gamified 3D office for your coding agents: Claude, Codex, or Gemini, project or global scope, with a Manager that delegates.", "version": "0.1.0", "author": { "name": "AgenticView contributors" }, "skills": "skills/", "hooks": "hooks/hooks.json", "keywords": ["agents", "3d", "visualization", "manager"] }
```
`marketplace.json`: `{ "name": "agenticview", "plugins": [{ "name": "agenticview", "source": { "source": "github", "repo": "<owner>/agenticview" }, "description": "...", "version": "0.1.0" }] }` (owner filled in at publish time; README explains `/plugin marketplace add <owner>/agenticview` then `/plugin install agenticview@agenticview`).

`skills/agenticview/SKILL.md`:
```markdown
---
name: agenticview
description: Open the AgenticView 3D agent office for the current project in the browser. Use when the user runs /agenticview or asks to see, manage, or delegate to their agents visually.
allowed-tools: Bash(node *), Bash(cat *)
---
Run this exact command with the Bash tool from the project root and then tell the user the URL it prints:

    node "$(cat ~/.agenticview/plugin-root)/bin/agenticview.mjs" open --project "$PWD"

If the file ~/.agenticview/plugin-root is missing, tell the user to restart Claude Code once so the plugin's SessionStart hook can record its location, or to run `npx agenticview open` instead.
Do not start a second server if the command reports one is already running; just share the URL.
```
`agenticview-hub` is identical with `hub` instead of `open --project "$PWD"`.

`hooks/hooks.json`:
```json
{ "hooks": {
  "SessionStart": [{ "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/hook.mjs\" record-root \"${CLAUDE_PLUGIN_ROOT}\"" }] }],
  "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/hook.mjs\" mirror" }] }],
  "PostToolUse": [{ "matcher": "Edit|Write|MultiEdit|Bash", "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/hook.mjs\" mirror" }] }],
  "SessionEnd": [{ "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/hook.mjs\" mirror" }] }]
} }
```
`hooks/hook.mjs` is dependency-free and duplicates the tiny `hook`/`record-plugin-root` logic from the CLI (reads stdin JSON, finds `~/.agenticview/instances/*.json`, POSTs with a 250 ms `AbortSignal.timeout`, always exits 0). It must never import from `node_modules`, so it works before the first bootstrap install.

`test/plugin.test.mjs`: parses `plugin.json`, `marketplace.json`, `hooks.json` as JSON; asserts every hook command references a file that exists; runs `node hooks/hook.mjs mirror` with `{}` on stdin and no server and asserts exit 0 under 300 ms; runs `record-root <tmp>` with `AGENTICVIEW_HOME` set and asserts the file content.

README covers: what it is, install via marketplace, first run (dependency install), `/agenticview`, `/agenticview-hub`, providers and credentials (`ANTHROPIC_API_KEY`, `codex` CLI login, `gemini` CLI login), scopes, where data lives, security (localhost + token), development (`npm install`, `npm run dev`, `npm test`, `npm run release`).

- [ ] Steps: write test → fail → create files → pass → commit `feat: plugin manifest, skills, hooks, readme`.

---

### Task 15: Codex and Gemini runtimes, provider checks

**Files:**
- Create: `packages/server/src/runtimes/codex.ts`, `packages/server/src/runtimes/gemini.ts`, `packages/server/src/runtimes/index.ts`, `packages/server/src/runtimes/which.ts`
- Modify: `packages/server/src/api/ws.ts` (`agent.create` refuses unavailable providers with the check reason), `packages/server/src/server.ts` (default `runtimes = createRuntimes(config)`)
- Test: `packages/server/test/runtimes/codex.test.ts`, `packages/server/test/runtimes/gemini.test.ts`, `packages/server/test/runtimes/index.test.ts`, `packages/server/test/fixtures/fake-gemini.mjs`

**Interfaces:**
- `createRuntimes(config: GlobalConfig, opts?: { bridgeEntry?: string }): Map<Provider, Runtime>` — always registers all three; availability comes from `check()`, cached for 60 s.
- `which(cmd: string): Promise<string | undefined>` — resolves an executable on PATH (honours `PATHEXT` on Windows).
- `CodexRuntime({ sdk?: { Codex }, bridgeEntry: string, bridgeUrl: () => string, apiKey?: string })`
- `GeminiRuntime({ bin?: string, bridgeEntry: string, bridgeUrl: () => string, apiKey?: string, spawn?: typeof child_process.spawn })`

Codex mapping:
- `new Codex({ env: { ...process.env, CODEX_API_KEY? }, config: { mcp_servers: { agenticview: { command: process.execPath, args: [bridgeEntry], env: { AGENTICVIEW_BRIDGE_URL, AGENTICVIEW_RUN_ID, AGENTICVIEW_BRIDGE_TOKEN } } }, sandbox_mode, approval_policy: "never" } })` — `mcp_servers` only when `bridgeTools.length > 0`.
- `sandbox_mode`: `auto` → `danger-full-access`; `auto-edit` → `workspace-write`; `ask` → `workspace-write` (documented: Codex has no interactive prompt here; the UI labels it).
- `startThread({ workingDirectory: cwd, skipGitRepoCheck: true, model? })` or `resumeThread(sessionId)`; `runStreamed(input)` with `input = [{ type: "text", text }, ...images.map(p => ({ type: "local_image", path: p }))]`.
- Events: `item.completed` with `item.type`: `agent_message` → `text` (`item.text`); `command_execution` → `tool_start`+`tool_end` (`name: "bash"`, summary = command); `file_change` → one `file_changed` per `item.changes[]` (`kind` from `change.kind`: `add`→create, `delete`→delete, else modify); `mcp_tool_call` → `tool_start`/`tool_end` with `item.tool`; `reasoning` → `status: "thinking"`; `turn.completed` → usage; `turn.failed`/`error` → error result. `sessionId = thread.id`.
- `check()`: `which("codex")` must resolve; else reason `Install the Codex CLI (npm i -g @openai/codex) and sign in`. Authentication is not probed (a failed run reports the CLI error).

Gemini mapping:
- Spawn `gemini` with args `["-p", promptText, "--output-format", "stream-json", "--approval-mode", mode, ...(model ? ["-m", model] : []), ...(sessionId ? ["--resume", sessionId] : []), ...(bridge ? ["--allowed-mcp-server-names", "agenticview"] : [])]`, `cwd`, env plus `GEMINI_API_KEY` when configured. `mode`: `auto` → `yolo`; `auto-edit` → `auto_edit`; `ask` → `auto_edit` (labelled in the UI).
- Images: append `\n\nAttached images: @<path>` per image to the prompt text.
- Bridge: Gemini reads MCP servers from settings files, so before spawning, the runtime writes `<cwd>/.gemini/settings.json` merging `mcpServers.agenticview = { command: process.execPath, args: [bridgeEntry], env: {...}, trust: true }` (preserving other keys; restoring the previous content after the run; creating `.gemini/` only if bridge tools are needed). Documented in the README.
- Parse stdout line by line as JSON: `init` → `sessionId = session_id`; `message` with `role: "assistant"` → `text` (`content` string or joined parts); `tool_use` → `tool_start` (`name`, `input`/`args`), and when `name` is `write_file`/`replace`/`edit` with a `file_path` also `file_changed`; `tool_result` → `tool_end` (`ok = status !== "error"`); `error` → `status`; `result` → final (`status: "success"` → done; `error` → failed). Unknown lines are ignored; non-JSON lines are logged as `status`. Exit code 53 → `max_turns`; non-zero otherwise → `error` with the last 20 stderr lines.
- `check()`: `which("gemini")`; else reason `Install the Gemini CLI (npm i -g @google/gemini-cli) and sign in`.

- [ ] **Step 1: Failing tests**

`codex.test.ts`: a fake `Codex` class capturing constructor `config` and `startThread` options, whose `runStreamed` yields `thread.started {thread_id:"th1"}`, `item.completed` agent_message "Hi", `item.completed` file_change `[ { path: "a.ts", kind: "add" } ]`, `item.completed` command_execution, `turn.completed`; assert the event sequence `["text","file_changed","tool_start","tool_end"]`, `sessionId "th1"`, `config.mcp_servers.agenticview.env.AGENTICVIEW_RUN_ID === "r_1"`, `sandbox_mode "workspace-write"`, and `workingDirectory` equals `cwd`. Second test: `check()` with `which` stubbed to `undefined` returns the install reason.

`gemini.test.ts`: `fixtures/fake-gemini.mjs` prints the args it received to stderr and emits JSONL: `{"type":"init","session_id":"g1"}`, `{"type":"message","role":"assistant","content":"Hello"}`, `{"type":"tool_use","name":"write_file","input":{"file_path":"b.ts"}}`, `{"type":"tool_result","name":"write_file","status":"success"}`, `{"type":"result","status":"success"}`; run with `bin: process.execPath` and a `spawn` wrapper that prepends the fixture path; assert events `["text","tool_start","file_changed","tool_end"]`, `sessionId "g1"`, that the args include `--approval-mode auto_edit` and `--allowed-mcp-server-names agenticview`, and that `<cwd>/.gemini/settings.json` contains `mcpServers.agenticview` during the run and is restored after (write a pre-existing settings file with `{"theme":"x"}` and assert it is byte-identical afterwards). Second test: fixture exits 1 with stderr "boom" → `stopReason "error"`, `error` contains "boom". Third: abort kills the child (`stopReason "aborted"`).

`index.test.ts`: `createRuntimes` returns three providers; `check()` results are cached (stub `which` counter).

- [ ] **Step 2: Implement** as mapped. `which.ts`: split `PATH` by `path.delimiter`, on win32 also try each `PATHEXT` suffix, `fs.access` with `X_OK`.

- [ ] **Step 3: Run → PASS. Commit** `feat(server): codex and gemini runtimes`.

---

### Task 16: Screenshot tool and image input

**Files:**
- Create: `packages/server/src/screenshot/screenshot.ts`, `packages/server/src/manager/workerTools.ts`
- Modify: `packages/server/src/manager/orchestrator.ts` (worker `bridgeTools` gets `take_screenshot` when `agent.tools.screenshot`), `packages/web/src/hud/ChatPanel.tsx` (render image thumbnails in the feed for user messages and for `tool_end` summaries that start with `screenshot:`)
- Test: `packages/server/test/screenshot/screenshot.test.ts`, `packages/server/test/manager/workerTools.test.ts`

**Interfaces:**
- `takeScreenshot(url: string, outDir: string, opts?: { width?: number; height?: number; fullPage?: boolean; launch?: () => Promise<BrowserLike> }): Promise<{ path: string }>` — lazy `import("playwright")`; if it is not installed, throws `ScreenshotUnavailableError("Run: npx playwright install chromium")`. Only `http://` and `https://` URLs; `localhost` and `127.0.0.1` allowed; files are written to `<projectRoot>/.agenticview/uploads/shot-<id>.png`.
- `workerTools(ctx: { projectPath: string; agent: Agent }): BridgeTool[]` → `[take_screenshot({ url, fullPage? }) -> "screenshot: <path>"]` when allowed, else `[]`.

Tests: `takeScreenshot` with an injected fake `launch` writes a PNG buffer to the expected path and closes the browser; rejects `file:///etc/passwd` with `Only http(s) URLs`; `ScreenshotUnavailableError` surfaces as the tool's error string. `workerTools` returns `[]` when `tools.screenshot` is false.

Image input end to end (already wired): `POST /api/upload` → path → `chat.send.images` → `Task.images` → `RunRequest.prompt` image parts → per-runtime mapping (Task 8/15).

- [ ] Steps: tests → fail → implement → pass → commit `feat: screenshot tool and image input`.

---

### Task 17: Polish, live test, release

**Files:**
- Modify: `packages/web/src/scene/Robot.tsx` (level accents: Lv 2 adds a glowing ring, Lv 3 a second antenna, Lv 5+ a crown torus), `scene/Office.tsx` (file chips: last 3 `file_changed` basenames float above the desk and fade over 6 s)
- Create: `packages/server/test/live/claude.live.test.ts`, `packages/web/e2e/smoke.spec.ts`, `packages/web/playwright.config.ts`, `.github/workflows/ci.yml`
- Modify: root `package.json` (`test:e2e`, `release` scripts), `.gitignore` (keep `packages/*/dist` tracked)

- `claude.live.test.ts`: skipped unless `AGENTICVIEW_LIVE=1`; boots a project world in a temp dir with the real `ClaudeRuntime`, chats with a worker "Create a file hello.txt containing 'hi'", awaits the task, asserts the file exists and the task is `done`.
- `smoke.spec.ts` (Playwright): starts the built server with `FakeRuntime` via `AGENTICVIEW_FAKE=1` (the CLI honours this env by using a FakeRuntime that echoes the prompt), opens the URL with the token, waits for the canvas, asserts the manager name tag "Atlas" is visible, opens the create modal, creates "Nova", asserts a second name tag appears, sends "hello" in the command bar, and waits for the task board to show a Done item.
- `ci.yml`: Node 22, `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, `npx playwright install --with-deps chromium`, `npm run test:e2e`.
- `release`: `npm run build` then `git diff --quiet -- packages/server/dist packages/web/dist` else exit 1.

- [ ] Steps: implement visuals → run unit tests → build → run `npm run test:e2e` locally → run `npm run release` and commit the bundles → commit `feat: polish, e2e smoke, ci, release`.

---

## Self-review notes

- Spec coverage: §4.1 modules → Tasks 2–11, 15, 16; §4.2 data model → Task 1, 5; §4.3 runtimes → Tasks 6, 8, 15; §4.4 manager → Task 9; §4.5 protocol → Tasks 1, 10; §4.6 UI → Tasks 12, 13, 17; §4.7 plugin → Tasks 11, 14; §4.8 security → Tasks 7, 10, 16; §5 errors → Tasks 5, 9, 10, 15; §6 testing → every task plus 17; §7 build order preserved.
- Type consistency: `RunRequest`, `BridgeTool`, `Runtime` defined in Task 6 and consumed by 7, 8, 9, 15, 16; `WorldRef` from Task 4 used in 9–11; `ServerMessage`/`ClientMessage` from Task 1 used in 9, 10, 12, 13.
- Review Focus mapping: (1) Task 3 unicode/space temp dir + Task 11 space in project path; (2) Task 10 two-client test; (3) Task 9 cancel test; (4) Task 5 recover test; (5) Task 15 check reasons + Task 13 disabled provider test.
