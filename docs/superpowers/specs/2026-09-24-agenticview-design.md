# AgenticView — Design Spec

Date: 2026-09-24
Status: approved for planning

## 1. Purpose

AgenticView is a Claude Code plugin that turns a project's AI agents into a
gamified 3D "office" in the browser. From any project, one slash command opens
the office. Spherical robots are the agents. One robot is the Manager; the rest
are Workers with specialties. The user chats with any robot, creates new robots
from the UI, and hands work to the Manager, who splits it and dispatches
Workers. Workers edit the real project files, so the user can return to VS Code
at any time to review the code.

Claude is the default runtime because this ships as a Claude Code plugin, but
every agent can instead run on OpenAI Codex or Gemini. Agents come in two
scopes: project agents that live inside one project and only work there, and
global agents that live in the user's home folder, appear in every project, and
can be sent to work on any project.

## 2. Goals and non-goals

Goals

- One command from any project opens a working office in the browser.
- The Manager always holds an accurate map of the roster and the task tree.
- Every agent runs on Claude, Codex, or Gemini through one runtime interface.
- Project and global scopes with clear rules for where each may work.
- Agents can see: a screenshot tool for agents and image paste for the user.
- Simple to install, quick to start, and fully tested with no known bugs.

Non-goals (this version)

- A VS Code webview. The office runs in the browser. The same page can be
  embedded later.
- Multi-user or remote access. The server binds to localhost only.
- Desktop screen recording. "Seeing" means screenshots of URLs and pasted images.
- Custom 3D model import. Robots are procedural.

## 3. Concepts

Scope
: `project` agents are stored in `<project>/.agenticview/agents/` and may only
  run with that project as working directory. `global` agents are stored in
  `~/.agenticview/agents/` and may run with any known project as working
  directory. A global agent can be copied into a project, which creates a new
  project agent carrying an `originId` back to the global one.

World
: A world is one office. A project world shows that project's agents plus all
  global agents (in a visually separate "Lobby" zone). The Hub world shows only
  global agents and the list of known projects.

Agent
: A named robot with a role (`manager` or `worker`), a specialty, a provider
  (`claude`, `codex`, `gemini`, or inherit), a model, a system prompt, a tool
  allowance, a permission mode, an appearance, and stats (XP, level, tasks done
  and failed).

Manager
: Exactly one per world, created automatically the first time a world opens.
  It receives user requests, decomposes them, assigns child tasks, waits for
  results, and reports back. It reads the project but never edits it.

Task
: A unit of work with a status, an assignee, an optional parent, a target
  project path, a log, and a result. Tasks form a tree under the user's request.

Provider
: A runtime adapter. Claude uses the Claude Agent SDK. Codex uses
  `@openai/codex-sdk`, which drives the installed `codex` CLI. Gemini spawns the
  installed `gemini` CLI in headless streaming mode.

## 4. Architecture

Monorepo with npm workspaces. The repo root is the plugin root.

```
agenticview/
  .claude-plugin/plugin.json        plugin manifest
  .claude-plugin/marketplace.json   lets users `/plugin marketplace add` this repo
  skills/agenticview/SKILL.md       /agenticview  (project world)
  skills/agenticview-hub/SKILL.md   /agenticview-hub (global world)
  hooks/hooks.json                  records plugin root; mirrors the user's session
  bin/agenticview.mjs               bootstrap: ensure deps, start server, open browser
  packages/shared/                  types, zod schemas, ws protocol
  packages/server/                  Node 22, TypeScript, Hono + ws
  packages/web/                     React 19, React Three Fiber, zustand, Vite
  docs/
```

### 4.1 Server modules

- `store` — JSON file persistence with atomic writes. Two roots: global
  (`~/.agenticview`) and project (`<project>/.agenticview`). Writes a
  `.gitignore` inside the project folder so agent definitions are committable
  while logs and sessions are not.
- `registry` — loads, merges, creates, updates, copies, and deletes agents.
  Enforces scope rules and the one-Manager-per-world rule.
- `tasks` — task state machine and tree. Statuses: `queued`, `assigned`,
  `running`, `waiting`, `done`, `failed`, `cancelled`. Allowed transitions are
  a fixed table; anything else throws.
- `runtimes` — `Runtime` interface plus `claude`, `codex`, `gemini` adapters.
  All adapters emit the same normalized `RunEvent` stream.
- `bridge` — exposes per-run custom tools to agents. Claude gets an in-process
  MCP server. Codex and Gemini get a stdio MCP bridge process that forwards
  tool calls to the server over localhost HTTP with a per-run token.
- `manager` — orchestration. Builds the Manager's roster preamble every turn,
  provides its tools, spawns Worker runs, enforces a concurrency limit.
- `events` — in-process event bus fanned out to WebSocket clients.
- `api` — REST plus WebSocket endpoints, token-guarded.
- `screenshot` — headless Chromium screenshot of a URL (Playwright, lazy).
- `hooks` — receives mirrored events from the user's own Claude Code session.

### 4.2 Data model

Agent (stored as `agents/<id>.json`)

```
id, name, role: "manager"|"worker", scope: "project"|"global",
specialty, description, provider: "claude"|"codex"|"gemini"|null,
model: string|null, systemPrompt,
tools: { edit, shell, web, screenshot }   (booleans)
permissionMode: "ask"|"auto-edit"|"auto",
appearance: { color, accent, eyes: "round"|"visor"|"dots" },
stats: { xp, level, tasksDone, tasksFailed },
originId?: string, createdAt, updatedAt
```

`provider: null` and `model: null` mean "use the world default". World
defaults come from `<project>/.agenticview/settings.json`, then
`~/.agenticview/config.json`, then the built-in default (`claude`).

Task (stored as `tasks/<id>.json` in the target project, or `hub-tasks/` for the
Hub)

```
id, kind: "request"|"work"|"chat", title, description,
status, createdBy: "user"|agentId, assigneeId, parentId?, projectPath,
session?: { provider, sessionId }, images: string[] (paths under .agenticview/uploads),
result?: string, error?: string,
log: [{ ts, type, text }],   capped at 500 entries
createdAt, startedAt?, finishedAt?
```

Transition table

```
queued    -> assigned, cancelled
assigned  -> running, cancelled
running   -> waiting, done, failed, cancelled
waiting   -> running, failed, cancelled
done | failed | cancelled -> (terminal)
```

XP: a Worker gains 10 XP per done `work` task and 2 per `chat`; the Manager gains
5 per done `request`. Level is `floor(sqrt(xp / 25)) + 1`. Levels unlock
cosmetic accents only.

### 4.3 Runtime interface

```ts
interface Runtime {
  provider: Provider
  check(): Promise<{ ok: boolean; version?: string; reason?: string }>
  run(req: RunRequest, sink: (e: RunEvent) => void, signal: AbortSignal): Promise<RunResult>
}

RunRequest {
  agent: Agent, cwd: string,
  prompt: Array<{ type: "text", text } | { type: "image", path }>,
  sessionId?: string,           // resume if the provider supports it
  systemPrompt: string,
  tools: ToolAllowance,         // from agent.tools, mapped per provider
  bridgeTools: BridgeTool[],    // custom tools (Manager tools, screenshot)
  permissionMode, model?: string, maxTurns?: number
}

RunEvent =
  | { type: "text", text }                      // assistant prose (may be partial)
  | { type: "tool_start", name, input }
  | { type: "tool_end", name, ok, summary }
  | { type: "file_changed", path, kind: "create"|"modify"|"delete" }
  | { type: "permission", id, tool, input }     // needs user decision
  | { type: "status", text }                    // e.g. "thinking"

RunResult { sessionId?, text, stopReason: "done"|"error"|"aborted"|"max_turns", costUsd?, usage? }
```

Provider mapping

| Concern | Claude | Codex | Gemini |
|---|---|---|---|
| Entry | `query()` from `@anthropic-ai/claude-agent-sdk` | `Codex.startThread().runStreamed()` | spawn `gemini -p ... --output-format stream-json` |
| Working dir | `options.cwd` | `workingDirectory`, `skipGitRepoCheck: true` | child `cwd` |
| Resume | `options.resume` | `resumeThread(id)` | `--resume <id>` |
| Custom tools | in-process MCP server | `config.mcp_servers.agenticview` stdio bridge | bridge registered in settings, `--allowed-mcp-server-names agenticview` |
| Permissions | `permissionMode` + `canUseTool` → UI bubble | sandbox mode from permission mode | `--approval-mode` from permission mode |
| Images | image content block in user message | `{ type: "local_image", path }` | `@path` reference in prompt |
| Auth | `ANTHROPIC_API_KEY` (or Bedrock, Vertex, Foundry env) as the Agent SDK docs require | ChatGPT login or `CODEX_API_KEY` | Google login or `GEMINI_API_KEY` |

The Agent SDK does not reuse the Claude Code interactive login. The settings
screen shows which credential the Claude provider found and how to set one.
Keys are read from the environment and from `~/.agenticview/config.json`
(`providers.claude.apiKey`), which is written with user-only permissions.

`check()` reports whether the CLI or SDK is installed and authenticated. The UI
shows unavailable providers greyed out with the reason, and creating an agent on
an unavailable provider is rejected with that reason.

Only Claude supports interactive permission prompts. For Codex and Gemini, the
`ask` mode maps to the most restrictive non-interactive setting the provider
offers, and the UI says so.

### 4.4 Manager orchestration

The Manager runs as a normal agent with the project as working directory and
read-only file tools. Every turn its prompt begins with a fresh roster and task
preamble generated by the server, so its map never goes stale:

```
## Roster
- w_01 "Nova" worker/project — frontend (React, CSS) — claude — idle
- g_07 "Atlas Jr" worker/global — testing — gemini — running task t_33
## Open tasks
- t_31 request "Add dark mode" (running) ...
```

Manager tools (bridge tools):

- `list_agents()` and `list_tasks()` — re-read state on demand.
- `create_agent({ name, specialty, provider?, model?, systemPrompt?, tools? })`
  — creates a project Worker (or a global one in the Hub).
- `assign_task({ agentId, title, description, parentTaskId })` — creates a
  `work` task and starts it; returns the task id immediately.
- `await_tasks({ taskIds })` — blocks until each is terminal; returns results.
- `ask_user({ question })` — surfaces a question bubble; blocks until answered.

Flow for a user request: the server creates a `request` task, runs the Manager
with the message, and streams its events to the UI. Worker runs spawned by
`assign_task` respect a concurrency limit (default 3). When a Worker finishes,
its task becomes `done` or `failed`, XP is awarded, and the result is returned
to the Manager through `await_tasks`. The Manager's final text becomes the
request's result.

Direct chat with a Worker creates a `chat` task assigned to it and runs it
immediately, resuming that agent's session for that project when available.

Scope rules enforced by the server:

- A project agent may only be assigned tasks whose `projectPath` is its project.
- A global agent may be assigned tasks for any known project.
- In the Hub, every task must name a `projectPath` from the known projects list.
- Copying a global agent into a project creates a new project agent; the
  original is untouched.

### 4.5 Web protocol

Server → client

```
snapshot { world, agents, tasks, providers, settings }
agent.updated { agent } | agent.removed { id }
task.updated { task }
run.event { taskId, agentId, event: RunEvent }
permission.request { id, agentId, taskId, tool, input }
question.request { id, agentId, taskId, question }
mirror.event { event }          // the user's own Claude Code session
```

Client → server

```
chat.send { agentId, text, images[] }
agent.create { ... } | agent.update | agent.copyToProject { id } | agent.delete { id }
task.cancel { id }
permission.respond { id, allow } | question.respond { id, answer }
settings.update { ... }
project.open { path }           // Hub only
```

All REST and WebSocket calls require the launch token, passed once in the URL
and then held in memory by the page.

### 4.6 Web UI

Scene (React Three Fiber)

- Isometric office floor. Manager podium in the centre. Worker desks around it
  in a ring. The Lobby for global agents is a raised platform at one side with
  a different floor tint. An empty desk with a "+" pad opens the creation
  wizard.
- Robots are procedural: sphere body, two eyes, antenna, coloured status ring.
  Status colours: grey idle, blue thinking, green editing, amber waiting for
  the user, red error. Idle robots bob; running robots pulse.
- Speech bubbles show the latest tool or sentence. A beam animates from Manager
  to Worker on assignment. Edited file chips float above the desk. A completed
  request triggers a short confetti burst on the Manager.
- Rendering budget: low-poly meshes, capped device pixel ratio, no
  post-processing by default. Target 60 fps on integrated graphics with 20
  robots.

HUD

- Top bar: world name, default provider, Hub/Project switch, settings.
- Left: task board grouped by status, with the task tree.
- Right: chat panel for the selected robot, with image paste and a live event
  feed.
- Bottom: command bar that talks to the Manager.
- Modals: create agent, settings, provider status.

### 4.7 Plugin surface

- `skills/agenticview/SKILL.md` and `skills/agenticview-hub/SKILL.md` are the
  `/agenticview` and `/agenticview-hub` commands. A skill cannot run a shell
  command itself and does not see `${CLAUDE_PLUGIN_ROOT}`, so each skill
  instructs Claude to run the bootstrap through the Bash tool, which runs in
  the project directory:
  `node "$(cat ~/.agenticview/plugin-root)/bin/agenticview.mjs" open --project "$PWD"`.
- `hooks/hooks.json` registers a `SessionStart` hook that writes
  `${CLAUDE_PLUGIN_ROOT}` to `~/.agenticview/plugin-root`, plus
  `UserPromptSubmit`, `PostToolUse`, and `SessionEnd` hooks that post the event
  to the running server if one is listening. When none is, the hook exits
  within 300 ms. This shows the user's own Claude Code session as a "You"
  robot in the office.
- `bin/agenticview.mjs` is dependency-free. On first run it installs
  production dependencies for the workspace, then starts the server on a free
  localhost port with a random token and opens the browser. Later runs skip
  the install. `npx agenticview` works the same way outside the plugin.
- Plugins have no install-time build step, so the built server and web
  bundles (`packages/*/dist`) are committed. A `release` script rebuilds them
  and fails if the working tree still differs afterwards, which keeps the
  committed bundles honest.

### 4.8 Security

- Server binds `127.0.0.1` only. A random token is required on every request.
- Agents only receive tools the user allowed on that agent.
- The bridge token is per run and rejected after the run ends.
- Uploaded images are stored under `.agenticview/uploads` and never served
  outside the token-guarded API.

## 5. Error handling

- Provider not available: reported in `check()`, shown in the UI, agent
  creation refused with the reason.
- Runtime crash or non-zero exit: task `failed` with the last stderr lines in
  `error`; the robot turns red; the Manager receives the failure from
  `await_tasks` and decides whether to retry or report.
- Server restart with running tasks: on boot, any task still `running` or
  `waiting` is marked `failed` with reason "interrupted" so the Manager's map
  stays truthful.
- Invalid state transition: throws; never silently ignored.
- WebSocket drop: the page reconnects and requests a fresh snapshot.
- Bridge call for an unknown or finished run: HTTP 404, never executed.

## 6. Testing

- `shared`: schema round-trip tests for every stored type.
- `server`: task state machine (every allowed and forbidden transition), store
  atomicity and `.gitignore` creation, registry scope rules and copy semantics,
  Manager tool handlers against a fake runtime, each adapter against a fake
  (Claude: mocked `query`; Codex: mocked SDK; Gemini: a fake `gemini` script
  emitting JSONL), bridge endpoints and token rejection, WebSocket protocol.
- `web`: store and panel tests with Testing Library; a Playwright smoke test
  that opens the page against a server running with a fake runtime, sees the
  robots, creates an agent, and sends a chat.
- Live: one opt-in test (`AGENTICVIEW_LIVE=1`) that runs a real Claude Worker
  in a temp directory and asserts the file it was asked to create exists.
- CI: `npm test` runs everything except the live test.

## 7. Build order

1. Skeleton: workspaces, shared types, store, task machine, registry, Claude
   runtime, REST + WebSocket, bootstrap, 3D office with a fixed roster, chat
   with one Worker that edits real files.
2. Manager, bridge (in-process and stdio), Manager tools, task tree, permission
   bubbles, persistence of sessions, scope rules, Hub world, known projects.
3. Codex and Gemini adapters, provider checks, settings UI, create-agent
   wizard, copy-to-project, XP and levels, screenshot tool, image paste, hooks
   mirroring, marketplace files, README.
