import { basename, join } from "node:path";
import { readFile } from "node:fs/promises";
import { GlobalConfigSchema, SpaceNamesSchema, PROVIDER_ORDER, ProjectSettingsSchema, WorkerSessionFileSchema, MAX_RINGS, ExplicitRoomsSchema, OfficeLayoutSchema, buildSpacesFromLayout, migrateLegacyLayout, validateLayout, growLayout, nextGrowthHex, newRoomId, defaultRoomName, planOffice, loungeSpots, customRef, orderedProviders, toCustomInfo, isBuiltinProvider, isCustomProvider, CustomProviderConfigSchema, } from "@agenticview/shared";
import { UsageTracker } from "./manager/usageTracker.js";
import { SessionRuntime } from "./runtimes/session.js";
import { subagentNames, syncSubagents, writeSubagent } from "./agents/subagents.js";
import { AgentMemory } from "./agents/memory.js";
import { AgentRegistry } from "./agents/registry.js";
import { TaskService } from "./tasks/taskService.js";
import { coverInsteadOfRetry } from "./tasks/retryGuard.js";
import { Orchestrator } from "./manager/orchestrator.js";
import { readJsonFile, writeJsonFile } from "./store/jsonStore.js";
import { ensureProjectGitignore, globalRoot, projectRoot } from "./store/paths.js";
import { describeWorkSeatMoves, isTerminal, migrateWorkSeats } from "@agenticview/shared";
import { moveWorker } from "./manager/officeTools.js";
import { cleanupGeminiSettings } from "./runtimes/gemini.js";
import { cleanupAntigravityPlugins } from "./runtimes/antigravity.js";
import { cleanupCopilotTemp } from "./runtimes/copilot.js";
import { GameService } from "./games/gameService.js";
import { IdleBehaviourService } from "./games/idleBehaviour.js";
// ─────────────────────────────────────────────────────────────────────────────
export function globalConfigPath() {
    return join(globalRoot(), "config.json");
}
export async function readGlobalConfig() {
    return readJsonFile(globalConfigPath(), GlobalConfigSchema, GlobalConfigSchema.parse({}));
}
export async function rememberProject(projectPath) {
    const cfg = await readGlobalConfig();
    const now = new Date().toISOString();
    const rest = cfg.knownProjects.filter((p) => p.path !== projectPath);
    cfg.knownProjects = [{ path: projectPath, name: basename(projectPath) || projectPath, lastOpened: now }, ...rest].slice(0, 50);
    await writeJsonFile(globalConfigPath(), cfg);
    return cfg;
}
/** Wire persistence, registry, tasks, and the orchestrator for one project or the hub. */
export async function createWorld(ref, opts) {
    const root = ref.kind === "project" ? projectRoot(ref.projectPath) : globalRoot();
    if (ref.kind === "project")
        await ensureProjectGitignore(ref.projectPath);
    let globalConfig = await readGlobalConfig();
    if (ref.kind === "project")
        globalConfig = await rememberProject(ref.projectPath);
    // Provider config applied to the runtime map (keys, custom endpoints). Re-applied whenever the saved
    // config changes, including from another office (info() re-reads it), so no restart is needed.
    let appliedSig = "";
    const providerSig = (cfg) => JSON.stringify([cfg.providers, cfg.providerOrder]);
    const applyConfig = async (cfg) => {
        const sig = providerSig(cfg);
        if (sig === appliedSig)
            return;
        appliedSig = sig;
        const { applyProviderConfig } = await import("./runtimes/index.js");
        applyProviderConfig(opts.runtimes, cfg);
    };
    await applyConfig(globalConfig);
    const settingsFile = join(root, "settings.json");
    let projectSettings = ref.kind === "project"
        ? await readJsonFile(settingsFile, ProjectSettingsSchema, ProjectSettingsSchema.parse({}))
        : ProjectSettingsSchema.parse({ defaultProvider: null, defaultModel: null, maxConcurrentRuns: globalConfig.maxConcurrentRuns });
    const settings = () => ({
        ...projectSettings,
        globalDefaultProvider: globalConfig.defaultProvider,
        globalDefaultModel: globalConfig.defaultModel,
        providerModels: {
            claude: globalConfig.providers.claude.model,
            codex: globalConfig.providers.codex.model,
            copilot: globalConfig.providers.copilot.model,
            antigravity: globalConfig.providers.antigravity.model,
            gemini: globalConfig.providers.gemini.model,
            ...Object.fromEntries(globalConfig.providers.custom.map((c) => [customRef(c.id), c.defaultModel ?? undefined])),
        },
        providerOrder: orderedProviders(globalConfig.providerOrder, [...PROVIDER_ORDER, ...globalConfig.providers.custom.map((c) => customRef(c.id))]),
    });
    const officeFile = join(root, "office.json");
    let spaceNames = await readJsonFile(officeFile, SpaceNamesSchema, {});
    const renameSpace = (id, name) => serializeLayout(async () => {
        const next = { ...spaceNames };
        if (name)
            next[id] = name;
        else
            delete next[id];
        await writeJsonFile(officeFile, next);
        spaceNames = next;
        opts.bus.emit({ type: "spaceNames.updated", spaceNames: { ...next } });
    });
    const registry = new AgentRegistry(ref);
    const layoutFile = join(root, "layout.json");
    let layout;
    let savedLayout = null;
    try {
        const raw = JSON.parse(await readFile(layoutFile, "utf8"));
        const parsed = OfficeLayoutSchema.parse(raw);
        const check = validateLayout(parsed);
        if (!check.ok)
            throw new Error(check.errors.join("; "));
        savedLayout = parsed;
    }
    catch (e) {
        if (e.code !== "ENOENT")
            console.error("[agenticview] invalid layout.json; migrating legacy rooms:", e);
    }
    const legacyRooms = savedLayout ? null : await readJsonFile(join(root, "rooms.json"), ExplicitRoomsSchema.nullable(), null).catch((e) => {
        console.error("[agenticview] invalid rooms.json; using default rooms:", e);
        return null;
    });
    const migrated = migrateLegacyLayout({ rooms: legacyRooms, spaceNames, workers: await registry.list(), layout: savedLayout });
    layout = migrated.layout;
    if (!savedLayout)
        await writeJsonFile(layoutFile, layout);
    if (JSON.stringify(spaceNames) !== JSON.stringify(migrated.spaceNames)) {
        spaceNames = migrated.spaceNames;
        await writeJsonFile(officeFile, spaceNames);
    }
    for (const [id, placement] of Object.entries(migrated.placements))
        await registry.update(id, { placement });
    if (!savedLayout)
        console.info(`[agenticview] layout migration: dropped ${migrated.dropped.length} rooms (${migrated.dropped.join(", ") || "none"}); moved ${Object.keys(migrated.placements).length} seats`);
    /**
     * Every worker gets a unique designated desk (workSeat): on office start (older offices adopt their
     * current seat; duplicates and seats that no longer exist move to a free desk) and after a layout change
     * that removed a room. Desks that change hands are released first, so none is ever shared.
     */
    const syncWorkSeats = (why, emit) => registry.withDeskLock(async () => {
        const agents = await registry.list();
        const result = migrateWorkSeats(agents, buildSpacesFromLayout(layout, spaceNames));
        if (result.unseated.length)
            console.warn(`[agenticview] workSeat migration (${why}): no free desk for ${result.unseated.join(", ")}`);
        if (!result.changed)
            return;
        const byId = new Map(agents.map((a) => [a.id, a]));
        for (const m of result.moves)
            if (byId.get(m.agentId)?.workSeat)
                await registry.update(m.agentId, { workSeat: undefined });
        for (const m of result.moves) {
            const a = await registry.update(m.agentId, { workSeat: m.to });
            if (emit)
                opts.bus.emit({ type: "agent.updated", agent: a });
        }
        console.info(`[agenticview] workSeat migration (${why}): ${describeWorkSeatMoves(result.moves).join("; ")}`);
    });
    await syncWorkSeats("office start", false);
    let layoutWrites = Promise.resolve();
    const serializeLayout = (fn) => {
        const work = layoutWrites.then(fn);
        layoutWrites = work.then(() => undefined, () => undefined);
        return work;
    };
    const applyLayout = async (next, names) => {
        const agents = await registry.list();
        const replacements = new Set(layout.rooms.filter((old) => next.rooms.some((room) => room.q === old.q && room.r === old.r && room.id !== old.id && room.kind !== old.kind)).map((room) => room.id));
        const currentSeats = planOffice(agents, layout, spaceNames).placements;
        const placements = Object.fromEntries(Object.entries(currentSeats).filter(([, seat]) => !replacements.has(seat.space)));
        const check = validateLayout(next, { previous: layout, placements });
        if (!check.ok)
            throw new Error(check.errors.join("; "));
        const nextPlan = planOffice(agents, next, names ?? spaceNames);
        const unseated = agents.filter((a) => a.role === "worker" && !nextPlan.placements[a.id]);
        if (unseated.length)
            throw new Error(`No free pod desk for ${unseated.map((a) => a.name).join(", ")}; add a pod before changing this room`);
        const parsedNames = names === undefined ? spaceNames : SpaceNamesSchema.parse(names);
        const ids = new Set(next.rooms.map((r) => r.id));
        const cleanedNames = Object.fromEntries(Object.entries(parsedNames).filter(([id]) => ids.has(id)));
        const changed = JSON.stringify(next) !== JSON.stringify(layout);
        const namesChanged = JSON.stringify(cleanedNames) !== JSON.stringify(spaceNames);
        if (changed)
            await writeJsonFile(layoutFile, next);
        if (namesChanged)
            await writeJsonFile(officeFile, cleanedNames);
        layout = next;
        spaceNames = cleanedNames;
        const plan = planOffice(agents, layout, spaceNames);
        for (const a of agents) {
            const p = plan.placements[a.id];
            if (p && (a.placement?.space !== p.space || a.placement?.seat !== p.seat)) {
                const moved = await registry.update(a.id, { placement: p });
                opts.bus.emit({ type: "agent.updated", agent: moved });
            }
        }
        if (changed)
            await syncWorkSeats("layout change", true);
        if (changed)
            opts.bus.emit({ type: "layout.updated", layout });
        if (namesChanged)
            opts.bus.emit({ type: "spaceNames.updated", spaceNames: { ...spaceNames } });
        return layout;
    };
    // Lock order is always desk lock, then layout queue: a layout change can re-run the workSeat migration
    // (desk lock) and creating a worker can grow the layout (layout queue) while holding the desk lock.
    const updateLayout = (next, names) => registry.withDeskLock(() => serializeLayout(() => applyLayout(next, names)));
    const editLayout = (edit) => registry.withDeskLock(() => serializeLayout(() => applyLayout(edit(layout))));
    registry.useLayout(() => layout, async (workerCount) => {
        await editLayout((current) => growLayout(current, workerCount));
    });
    // Only state changes go on the wire, and never with the log: the web feed is built from run.events.
    const tasks = new TaskService(ref.kind === "project" ? join(root, "tasks") : join(root, "hub-tasks"), (task, kind) => {
        if (kind === "state")
            opts.bus.emit({ type: "task.updated", task: toWire(task) });
    });
    await tasks.recoverInterrupted();
    await registry.ensureManager();
    if (ref.kind === "project") {
        await cleanupGeminiSettings(ref.projectPath);
        await cleanupAntigravityPlugins(ref.projectPath);
    }
    // Copilot's per-run files live in the OS temp dir, shared by every office (only day-old ones go).
    await cleanupCopilotTemp();
    const info = async () => {
        const cfg = await readGlobalConfig();
        globalConfig = cfg;
        if (providerSig(cfg) !== appliedSig) {
            await applyConfig(cfg);
            void emitProvidersFn();
        }
        return {
            kind: ref.kind,
            name: ref.kind === "project" ? basename(ref.projectPath) || ref.projectPath : "Hub",
            projectPath: ref.kind === "project" ? ref.projectPath : null,
            knownProjects: cfg.knownProjects,
            layout,
        };
    };
    // Per-agent task memory: <project>/.agenticview/memory/<agentId>.jsonl (the world root for hub work without a project).
    const memory = new AgentMemory((projectPath) => join(projectPath ? projectRoot(projectPath) : root, "memory"));
    const usageTracker = new UsageTracker(root);
    await usageTracker.init();
    const gameService = new GameService({ root, bus: opts.bus, registry });
    gameService.start();
    // Idle behaviour (desk / visit / lounge rolls): server-local randomness only, never a model call.
    const officeSpaces = async () => {
        const agents = await registry.list();
        const spaces = buildSpacesFromLayout(layout, spaceNames);
        return { spaces, agents };
    };
    const loungeBaseSpots = loungeSpots(0).spots.filter((sp) => !sp.waiting).length;
    const idle = new IdleBehaviourService({
        registry,
        bus: opts.bus,
        settings: () => ({ idleMinutes: settings().idleLoungeMinutes, behaviour: settings().idleBehaviour }),
        loungeSpots: async () => (await officeSpaces()).spaces.filter((s) => s.kind === "lounge").length * loungeBaseSpots,
        desks: async () => {
            const { spaces, agents } = await officeSpaces();
            const seats = spaces.filter((s) => s.kind === "pod").flatMap((s) => Array.from({ length: s.seats }, (_, seat) => ({ space: s.id, seat })));
            return { seats, placements: planOffice(agents, layout, spaceNames).placements };
        },
        whiteboardSpace: async () => (await officeSpaces()).spaces.find((s) => s.kind === "meeting")?.id,
    });
    const hasOpenWork = async (agentId) => (await tasks.list()).some((t) => t.assigneeId === agentId && !isTerminal(t.status));
    opts.bus.on((m) => {
        if (m.type === "task.updated") {
            const { task } = m;
            const agentId = task.assigneeId;
            if (task.status === "running" || task.status === "assigned" || task.status === "waiting" || task.status === "queued") {
                // Working means sitting at the designated desk; brainstorm (meeting) work keeps the Meeting Room.
                const toDesk = task.status !== "queued" && !task.meeting;
                if (!idle.isBusy(agentId))
                    void idle.onBusy(agentId, { toDesk }).catch(() => undefined);
                else if (toDesk)
                    void idle.toWorkSeat(agentId).catch(() => undefined);
            }
            else if (isTerminal(task.status)) {
                void hasOpenWork(agentId).then((open) => {
                    if (!open)
                        idle.onIdle(agentId);
                }, () => undefined);
            }
        }
    });
    {
        const openTasks = (await tasks.list()).filter((t) => !isTerminal(t.status));
        const open = new Set(openTasks.map((t) => t.assigneeId));
        const workers = (await registry.list()).filter((a) => a.role === "worker");
        idle.start(workers.filter((a) => !open.has(a.id)).map((a) => a.id));
        // Workers with work in progress sit at their designated desk from the start.
        for (const a of workers) {
            if (!open.has(a.id))
                continue;
            const toDesk = openTasks.some((t) => t.assigneeId === a.id && t.status !== "queued" && !t.meeting);
            void idle.onBusy(a.id, { toDesk }).catch(() => undefined);
        }
    }
    let emitProvidersFn = async () => undefined;
    const deps = {
        world: ref,
        root,
        registry,
        tasks,
        runtimes: opts.runtimes,
        toolRegistry: opts.toolRegistry,
        bus: opts.bus,
        settings,
        info,
        bridgeUrl: opts.bridgeUrl,
        knownProjects: () => globalConfig.knownProjects,
        workerTools: opts.workerTools,
        spaceNames: () => ({ ...spaceNames }),
        renameSpace,
        removeRoom: (spaceId) => removeRoomFn(spaceId),
        layout: () => layout,
        updateLayout,
        editLayout,
        spaces: () => buildSpacesFromLayout(layout, spaceNames),
        usageTracker,
        emitProviders: () => emitProvidersFn(),
        sessions: () => sessions(),
        memory,
    };
    const orchestrator = new Orchestrator(deps);
    // Claude Code sessions (claude-session workers): records persist next to the agents, and the
    // agent<->session binding persists on each agent.
    const sessionRt = opts.runtimes.get("claude-session");
    const sessionRuntime = sessionRt instanceof SessionRuntime ? sessionRt : undefined;
    const sessionsFile = join(root, "worker-sessions.json");
    const sessions = async () => {
        if (!sessionRuntime)
            return [];
        const agents = await registry.list();
        return sessionRuntime.sessionList().map(({ currentRunId: _r, currentAgentId: _a, ...s }) => {
            const claudeLimits = usageTracker.getSessionModelLimits(s.id);
            return {
                ...s,
                agentIds: agents.filter((a) => a.session?.id === s.id).map((a) => a.id),
                ...(Object.keys(claudeLimits).length > 0 ? { claudeLimits } : {}),
            };
        });
    };
    // Subagent files (.claude/agents/agenticview-<slug>.md) for the claude-session agents: the session
    // launches each task in its agent's subagent. Writes are chained so syncs never interleave.
    const onSession = async (a) => (await orchestrator.resolveProviderLive(a)).provider === "claude-session";
    const sessionAgents = async () => {
        const out = [];
        for (const a of await registry.list())
            if (await onSession(a))
                out.push(a);
        return out;
    };
    let fileChain = Promise.resolve();
    const chained = (fn) => {
        const next = fileChain.then(fn, fn);
        fileChain = next.catch(() => undefined);
        return next;
    };
    const syncProjectSubagents = () => ref.kind !== "project"
        ? Promise.resolve(undefined)
        : chained(async () => syncSubagents(ref.projectPath, await sessionAgents(), async (id) => {
            const a = await registry.get(id);
            return Boolean(a && (await onSession(a)));
        })).catch((e) => {
            console.error("[agenticview] syncing subagent files failed", e);
            return undefined;
        });
    /**
     * The agent's latest memory records, newest first, for the "Your recent work" digest (one store for
     * every provider). Falls back to the task history for agents with no memory yet (older offices).
     */
    const recentWork = async (agentId, exceptTaskId, projectPath) => {
        const key = projectPath || (ref.kind === "project" ? ref.projectPath : "");
        const records = await memory.recent(key, agentId).catch(() => []);
        if (records.length > 0) {
            return records.map((r) => ({
                taskId: r.taskId,
                title: r.title,
                status: r.status,
                summary: r.outcome,
                files: r.files,
                finishedAt: r.at,
                ...(r.subagentId ? { subagentId: r.subagentId } : {}),
                ...(r.sessionName ? { sessionName: r.sessionName } : {}),
                ...(r.provider ? { provider: r.provider } : {}),
                ...(r.model ? { model: r.model } : {}),
                ...(r.taskId === exceptTaskId ? { earlierAttempt: true } : {}),
            }));
        }
        return historyWork(agentId, exceptTaskId);
    };
    const historyWork = async (agentId, exceptTaskId) => (await tasks.list())
        .filter((t) => t.assigneeId === agentId && t.id !== exceptTaskId && isTerminal(t.status))
        .sort((a, b) => (b.finishedAt ?? b.createdAt).localeCompare(a.finishedAt ?? a.createdAt))
        .slice(0, 5)
        .map((t) => {
        const files = t.worker?.files ?? [...new Set(t.log.filter((l) => l.type === "file_changed").map((l) => l.text.replace(/^\S+\s+/, "")))];
        const summary = (t.status === "done" ? t.result : (t.error ?? t.result)) ?? "";
        return {
            taskId: t.id,
            title: t.title,
            status: t.status,
            summary: summary.replace(/\s+/g, " ").trim().slice(0, 300),
            files: files.slice(0, 12),
            ...(t.finishedAt ? { finishedAt: t.finishedAt } : {}),
            ...(t.worker?.subagentId ? { subagentId: t.worker.subagentId } : {}),
            ...(t.worker?.sessionName ? { sessionName: t.worker.sessionName } : {}),
        };
    });
    if (sessionRuntime) {
        const saved = await readJsonFile(sessionsFile, WorkerSessionFileSchema, { sessions: [] }).catch(() => ({ sessions: [] }));
        sessionRuntime.attach({
            bindingOf: async (id) => (await registry.get(id))?.session?.id ?? null,
            bind: async (id, s) => {
                const agent = await registry.update(id, { session: s });
                opts.bus.emit({ type: "agent.updated", agent });
            },
            findAgent: async (ref) => {
                const all = await registry.list();
                const k = ref.trim().toLowerCase();
                const a = all.find((x) => x.id === ref.trim()) ?? all.find((x) => x.name.toLowerCase() === k);
                return a ? { id: a.id, name: a.name } : undefined;
            },
            save: (list) => writeJsonFile(sessionsFile, { sessions: list }),
            sessionAgentIds: async () => (await sessionAgents()).map((a) => a.id),
            prepare: async (req) => {
                const task = req.taskId ? await tasks.get(req.taskId) : undefined;
                // A brainstorm must not inherit the saved subagent's editing tools or instructions.
                const readOnly = task?.readOnly === true;
                const target = task?.projectPath || (ref.kind === "project" ? ref.projectPath : "");
                const work = await recentWork(req.agent.id, req.taskId, task?.projectPath);
                // Hub runs without a target project: no folder to put a subagent in, the session does it itself.
                if (!target) {
                    if (readOnly)
                        throw new Error("Read-only session tasks require a project for the restricted subagent");
                    return { subagent: null, recentWork: work };
                }
                if (ref.kind === "project")
                    await syncProjectSubagents();
                const agent = (await registry.get(req.agent.id)) ?? req.agent;
                const peers = ref.kind === "project" ? await sessionAgents() : [];
                const names = subagentNames(peers.some((p) => p.id === agent.id) ? peers : [...peers, agent]);
                const out = await chained(() => writeSubagent(target, agent, names.get(agent.id), readOnly));
                if (readOnly && out.status === "user-file")
                    throw new Error(`Cannot use user-authored read-only subagent ${out.name}`);
                return { subagent: out.name, recentWork: work };
            },
            attribute: async (info) => {
                if (!info.taskId)
                    return;
                await tasks.setWorker(info.taskId, {
                    runId: info.runId,
                    sessionId: info.sessionId,
                    sessionName: info.sessionName,
                    ...(info.subagent ? { subagent: info.subagent } : {}),
                    ...(info.subagentId ? { subagentId: info.subagentId } : {}),
                    ...(info.files ? { files: info.files } : {}),
                });
            },
        }, saved.sessions);
        // Session models as last seen: when one changes, its agents' wire `sessionModel` changes too.
        const lastModels = new Map(sessionRuntime.sessionList().map((s) => [s.id, s.model]));
        sessionRuntime.onSessionsChanged = () => {
            void sessions().then((list) => opts.bus.emit({ type: "sessions.updated", sessions: list }), () => undefined);
            const changed = sessionRuntime.sessionList().filter((s) => (lastModels.get(s.id) ?? null) !== s.model);
            for (const s of changed)
                lastModels.set(s.id, s.model);
            if (changed.length === 0)
                return;
            const ids = new Set(changed.map((s) => s.id));
            void registry.list().then((all) => {
                for (const a of all)
                    if (a.session?.id && ids.has(a.session.id))
                        opts.bus.emit({ type: "agent.updated", agent: a });
            }, () => undefined);
        };
        // A binding changed in the office (or a new agent): a waiting session may now take its task.
        opts.bus.on((m) => {
            if (m.type === "agent.updated" || m.type === "agent.removed") {
                sessionRuntime.kick();
                // New, edited, re-providered or deleted agent: refresh its subagent file (or remove it).
                void syncProjectSubagents();
                void sessions().then((list) => opts.bus.emit({ type: "sessions.updated", sessions: list }), () => undefined);
            }
        });
    }
    // Migration: claude-session agents no longer store a model or effort (they inherit the session's).
    for (const a of await registry.list()) {
        if (a.provider === "claude-session" && (a.model || a.effort))
            await registry.update(a.id, {}).catch(() => undefined);
    }
    if (sessionRuntime)
        await syncProjectSubagents();
    /** Wire form of an agent: claude-session agents carry the model of the session serving them. */
    const decorateAgent = (a) => {
        if (a.provider !== "claude-session" || !sessionRuntime)
            return a;
        const boundId = a.session?.id ?? sessionRuntime.sessionList().find((s) => s.runs.some((r) => r.agentId === a.id))?.id;
        return { ...a, sessionModel: (boundId && sessionRuntime.session(boundId)?.model) || null };
    };
    const decorate = (m) => {
        if (m.type === "agent.updated")
            return { ...m, agent: decorateAgent(m.agent) };
        if (m.type === "snapshot")
            return { ...m, agents: m.agents.map(decorateAgent) };
        return m;
    };
    const providerStatuses = async () => {
        const out = [];
        for (const p of settings().providerOrder ?? PROVIDER_ORDER) {
            const rt = opts.runtimes.get(p);
            const base = rt ? await rt.check() : { provider: p, ok: false, reason: "not configured" };
            const lim = usageTracker.getProviderLimit(p);
            if (lim && lim.limited) {
                base.limit = lim;
            }
            out.push(base);
        }
        return out;
    };
    /** Provider config for the web: custom providers without keys, the resolved order, which keys are set. */
    const providerConfig = () => ({
        customProviders: globalConfig.providers.custom.map(toCustomInfo),
        providerOrder: [...(settings().providerOrder ?? PROVIDER_ORDER)],
        providerKeys: {
            claude: Boolean(globalConfig.providers.claude.apiKey),
            codex: Boolean(globalConfig.providers.codex.apiKey),
            gemini: Boolean(globalConfig.providers.gemini.apiKey),
        },
    });
    /** Write the global config through `fn`, rebuild the affected runtimes, and push the change to clients. */
    const mutateConfig = async (fn) => {
        const cfg = await readGlobalConfig();
        fn(cfg);
        await writeJsonFile(globalConfigPath(), cfg);
        globalConfig = cfg;
        await applyConfig(cfg);
        await emitProvidersFn();
        opts.bus.emit({ type: "snapshot", ...(await snapshot()) });
    };
    emitProvidersFn = async () => {
        opts.bus.emit({ type: "providers.updated", providers: await providerStatuses(), autoProvider: await orchestrator.autoProvider(), providerConfig: providerConfig() });
    };
    // Snapshot helper (defined here so addRoom/removeRoom can broadcast it before the return object).
    const snapshot = async () => {
        const agents = await registry.list();
        const rc = Math.max(1, ...layout.rooms.map((r) => Math.max(Math.abs(r.q), Math.abs(r.r), Math.abs(-r.q - r.r))));
        return {
            spaceNames: { ...spaceNames },
            layout,
            world: await info(),
            agents,
            tasks: (await tasks.list()).map(toWire),
            providers: await providerStatuses(),
            autoProvider: await orchestrator.autoProvider(),
            providerConfig: providerConfig(),
            settings: projectSettings,
            sessions: await sessions(),
            ringCount: rc,
            games: await gameService.getGames(),
            ...orchestrator.pending(),
        };
    };
    const addRoomFn = async (kind, name) => {
        let id = "";
        try {
            await editLayout((current) => {
                const hex = nextGrowthHex(current, kind);
                if (!hex)
                    throw new Error(`The office is full (${MAX_RINGS} rings). Remove an empty room first.`);
                id = newRoomId(current, kind);
                const custom = name.trim();
                return { version: 1, rooms: [...current.rooms, { id, kind, ...hex, ...(custom && custom !== defaultRoomName(kind, id) ? { name: custom } : {}) }] };
            });
        }
        catch (e) {
            return { ok: false, message: e.message };
        }
        return { ok: true, spaceId: id };
    };
    // removeRoom: only empty rooms (no seated agents), never the Manager's Office.
    const removeRoomFn = async (spaceId) => {
        if (spaceId === "office" || spaceId === "myoffice")
            return { ok: false, message: `Cannot remove ${spaceId === "office" ? "the Manager's Office" : "My Office"}.` };
        if (!layout.rooms.find((r) => r.id === spaceId)) {
            return { ok: false, message: `Unknown room '${spaceId}'.` };
        }
        const agents = await registry.list();
        const plan = planOffice(agents, layout, spaceNames);
        const seatedIds = Object.entries(plan.placements)
            .filter(([, p]) => p.space === spaceId)
            .map(([agentId]) => agentId);
        if (seatedIds.length > 0) {
            const names = seatedIds.map((agentId) => agents.find((a) => a.id === agentId)?.name ?? agentId);
            return {
                ok: false,
                message: `Cannot remove '${spaceId}': ${names.join(", ")} ${names.length === 1 ? "is" : "are"} seated there. Move them first.`,
            };
        }
        const next = { version: 1, rooms: layout.rooms.filter((r) => r.id !== spaceId) };
        try {
            await updateLayout(next);
        }
        catch (e) {
            return { ok: false, message: e.message };
        }
        return { ok: true };
    };
    return {
        ref,
        root,
        registry,
        tasks,
        orchestrator,
        bus: opts.bus,
        runtimes: opts.runtimes,
        settings,
        info,
        providerStatuses,
        sessions,
        sessionRuntime,
        syncSubagents: syncProjectSubagents,
        usageTracker,
        emitProviders: emitProvidersFn,
        switchAgent: async (id, patch) => {
            const cur = await registry.get(id);
            if (!cur)
                throw new Error(`Unknown agent ${id}`);
            const updatePatch = {};
            if ("provider" in patch)
                updatePatch.provider = patch.provider ?? null;
            if ("model" in patch)
                updatePatch.model = patch.model ?? null;
            if ("effort" in patch)
                updatePatch.effort = patch.effort ?? null;
            // A provider change clears agent.limit in the registry (limits are per provider); a model or effort
            // change on the same, still-limited provider keeps it.
            const updated = await registry.update(id, updatePatch);
            opts.bus.emit({ type: "agent.updated", agent: updated });
            if (updated.provider === "claude-session" || cur.provider === "claude-session") {
                await syncProjectSubagents();
            }
            return updated;
        },
        switchProvider: async (fromProvider, patch) => {
            const all = await registry.list();
            const matching = all.filter((a) => a.provider === fromProvider);
            const updatedAgents = [];
            for (const a of matching) {
                const next = await registry.update(a.id, {
                    provider: patch.toProvider,
                    model: patch.toModel ?? null,
                    limit: undefined,
                });
                opts.bus.emit({ type: "agent.updated", agent: next });
                updatedAgents.push(next);
            }
            usageTracker.clearProviderLimit(fromProvider);
            await emitProvidersFn();
            if (fromProvider === "claude-session" || patch.toProvider === "claude-session") {
                await syncProjectSubagents();
            }
            return { count: updatedAgents.length, agents: updatedAgents };
        },
        retryTask: async (taskId, retryOpts) => {
            const cur = await tasks.get(taskId);
            if (!cur)
                throw new Error(`Unknown task ${taskId}`);
            if (cur.status !== "failed")
                throw new Error(`Only failed tasks can be retried (status is ${cur.status})`);
            if (!retryOpts?.force) {
                const cover = await coverInsteadOfRetry(tasks, taskId);
                if (cover)
                    return { task: cover.task, rerun: false, message: cover.message, ...(cover.byTaskId ? { byTaskId: cover.byTaskId } : {}) };
            }
            // transition() clears the resolution automatically when moving to queued.
            const retried = await tasks.transition(taskId, "queued", { error: undefined, result: undefined });
            orchestrator.startTask(taskId);
            return { task: retried, rerun: true, message: `Retrying task ${taskId}` };
        },
        resolveTask: async (taskId, byTaskId, note) => {
            const task = await tasks.get(taskId);
            if (!task)
                throw new Error(`Unknown task ${taskId}`);
            if (byTaskId !== undefined) {
                const byTask = await tasks.get(byTaskId);
                if (!byTask)
                    throw new Error(`byTaskId ${byTaskId} not found`);
                if (byTask.status !== "done")
                    throw new Error(`byTaskId ${byTaskId} is not done (status is ${byTask.status})`);
            }
            return tasks.setResolution(taskId, { byTaskId, note, at: new Date().toISOString() });
        },
        unresolveTask: async (taskId) => {
            return tasks.clearResolution(taskId);
        },
        getLimits: async () => usageTracker.getLimitsReport(),
        getUsage: async () => usageTracker.getUsageReport(),
        getGames: () => gameService.getGames(),
        playUser: (opponentId, matchId, move) => gameService.playUser(opponentId, matchId, move),
        updateSettings: async (patch) => {
            projectSettings = ProjectSettingsSchema.parse({ ...projectSettings, ...patch });
            if (ref.kind === "project")
                await writeJsonFile(settingsFile, projectSettings);
            else {
                const cfg = await readGlobalConfig();
                if (patch.maxConcurrentRuns)
                    cfg.maxConcurrentRuns = patch.maxConcurrentRuns;
                if (patch.defaultProvider !== undefined)
                    cfg.defaultProvider = patch.defaultProvider;
                if (patch.defaultModel !== undefined)
                    cfg.defaultModel = patch.defaultModel;
                await writeJsonFile(globalConfigPath(), cfg);
                globalConfig = cfg;
            }
            return projectSettings;
        },
        addRoom: addRoomFn,
        layout: () => layout,
        updateLayout,
        editLayout,
        setProviderKey: (provider, apiKey) => mutateConfig((cfg) => {
            const key = apiKey?.trim();
            if (key)
                cfg.providers[provider].apiKey = key;
            else
                delete cfg.providers[provider].apiKey;
        }),
        setProviderOrder: (order) => mutateConfig((cfg) => {
            cfg.providerOrder = [...new Set(order.filter((p) => isBuiltinProvider(p) || isCustomProvider(p)))];
        }),
        upsertCustomProvider: (entry) => mutateConfig((cfg) => {
            const prev = cfg.providers.custom.find((c) => c.id === entry.id);
            const { apiKey, ...rest } = entry;
            const key = apiKey === undefined ? prev?.apiKey : apiKey?.trim() || undefined;
            const next = CustomProviderConfigSchema.parse({ ...rest, ...(key ? { apiKey: key } : {}) });
            cfg.providers.custom = prev ? cfg.providers.custom.map((c) => (c.id === entry.id ? next : c)) : [...cfg.providers.custom, next];
        }),
        removeCustomProvider: (id) => mutateConfig((cfg) => {
            cfg.providers.custom = cfg.providers.custom.filter((c) => c.id !== id);
            cfg.providerOrder = cfg.providerOrder.filter((p) => p !== customRef(id));
        }),
        removeRoom: removeRoomFn,
        moveDesk: (agentId, desk) => moveWorker({
            registry,
            emitAgent: (agent) => opts.bus.emit({ type: "agent.updated", agent }),
            spaceNames: () => ({ ...spaceNames }),
            spaces: () => buildSpacesFromLayout(layout, spaceNames),
            layout: () => layout,
        }, agentId, desk.space, desk.seat),
        decorate,
        snapshot,
    };
}
/** Wire form of a task: identical minus the (potentially large) log. */
export function toWire(task) {
    return { ...task, log: [] };
}
//# sourceMappingURL=world.js.map