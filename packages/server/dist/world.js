import { basename, join } from "node:path";
import { GlobalConfigSchema, SpaceNamesSchema, PROVIDER_ORDER, ProjectSettingsSchema, WorkerSessionFileSchema, buildSpaces, ringsFor, MAX_RINGS, ExplicitRoomsSchema, planOfficeWithSpaces, } from "@agenticview/shared";
import { UsageTracker } from "./manager/usageTracker.js";
import { SessionRuntime } from "./runtimes/session.js";
import { subagentNames, syncSubagents, writeSubagent } from "./agents/subagents.js";
import { AgentRegistry } from "./agents/registry.js";
import { TaskService } from "./tasks/taskService.js";
import { Orchestrator } from "./manager/orchestrator.js";
import { readJsonFile, writeJsonFile } from "./store/jsonStore.js";
import { ensureProjectGitignore, globalRoot, projectRoot } from "./store/paths.js";
import { isTerminal } from "@agenticview/shared";
import { cleanupGeminiSettings } from "./runtimes/gemini.js";
import { cleanupAntigravityPlugins } from "./runtimes/antigravity.js";
import { GameService } from "./games/gameService.js";
// ── Explicit-room helpers (used by addRoom / removeRoom) ─────────────────────
/** Build a Space[] from an explicit room list, assigning seats by kind. */
function buildSpacesFromExplicit(rooms) {
    const SEATS_BY_KIND = { pod: 4, meeting: 6, lounge: 4 };
    return [
        // Manager's office is always present at origin.
        { id: "office", name: "Manager's Office", kind: "office", q: 0, r: 0, x: 0, z: 0, ring: 0, seats: 0 },
        ...rooms.map((rm) => {
            const { q, r } = rm;
            // Axial to flat-top world coords (HEX_R = 5, sqrt3 * 5 / 2 ≈ 4.33)
            const x = 5 * 1.5 * q;
            const z = 5 * Math.sqrt(3) * (r + q / 2);
            const ring = Math.max(Math.abs(q), Math.abs(r), Math.abs(-q - r));
            return { id: rm.id, name: rm.name, kind: rm.kind, q, r, x, z, ring, seats: SEATS_BY_KIND[rm.kind] ?? 4 };
        }),
    ];
}
/** Returns the largest ring index present in an explicit room list (minimum 1). */
function currentOfficeRings(rooms) {
    let max = 1;
    for (const rm of rooms) {
        const ring = Math.max(Math.abs(rm.q), Math.abs(rm.r), Math.abs(-rm.q - rm.r));
        if (ring > max)
            max = ring;
    }
    return max;
}
/** Hexes used by the meeting-room and lounge in ring-1 of the default layout. */
const RESERVED_HEX = new Set(["0,-1", "-1,0"]);
/** Find the next free hex coordinate to place a new room (spiral outward). */
function nextAddRoomHex(rooms) {
    const taken = new Set(rooms.map((rm) => `${rm.q},${rm.r}`));
    taken.add("0,0"); // manager's office
    // Spiral outward ring by ring up to MAX_RINGS.
    for (let ring = 1; ring <= MAX_RINGS; ring++) {
        // Produce all hexes at this ring distance.
        const hexes = [];
        let q = ring;
        let r = -ring;
        const dirs = [[0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1], [1, 0]];
        for (let d = 0; d < 6; d++) {
            for (let s = 0; s < ring; s++) {
                hexes.push({ q, r });
                q += dirs[d][0];
                r += dirs[d][1];
            }
        }
        for (const h of hexes) {
            const key = `${h.q},${h.r}`;
            if (!taken.has(key) && !RESERVED_HEX.has(key))
                return h;
        }
    }
    return undefined;
}
/** Generate a unique room id given the kind and current rooms. */
function nextRoomId(kind, rooms) {
    if (kind !== "pod") {
        const existing = rooms.filter((r) => r.kind === kind).length;
        return existing === 0 ? kind : `${kind}-${existing + 1}`;
    }
    const letters = "abcdefghijklmnopqrstuvwxyz";
    const existingPods = new Set(rooms.filter((r) => r.kind === "pod").map((r) => r.id));
    for (const letter of letters) {
        const id = `pod-${letter}`;
        if (!existingPods.has(id))
            return id;
    }
    return `pod-${rooms.filter((r) => r.kind === "pod").length}`;
}
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
            antigravity: globalConfig.providers.antigravity.model,
            gemini: globalConfig.providers.gemini.model,
        },
    });
    const officeFile = join(root, "office.json");
    let spaceNames = await readJsonFile(officeFile, SpaceNamesSchema, {});
    let nameWrites = Promise.resolve();
    const renameSpace = (id, name) => {
        const work = nameWrites.then(async () => {
            const next = { ...spaceNames };
            if (name)
                next[id] = name;
            else
                delete next[id];
            await writeJsonFile(officeFile, next);
            spaceNames = next;
            opts.bus.emit({ type: "spaceNames.updated", spaceNames: { ...next } });
        });
        nameWrites = work.catch(() => undefined);
        return work;
    };
    // Explicit room layout (rooms.json).  null = no file yet → fall back to auto-grow for ringCount.
    const roomsFile = join(root, "rooms.json");
    let explicitRooms = await readJsonFile(roomsFile, ExplicitRoomsSchema.nullable(), null);
    let roomWrites = Promise.resolve();
    const writeRooms = (next) => {
        const work = roomWrites.then(() => writeJsonFile(roomsFile, next));
        roomWrites = work.catch(() => undefined);
        return work;
    };
    /**
     * On the first explicit addRoom call, initialise rooms.json from the auto-grown layout so
     * existing workers keep their spaces.
     */
    const ensureRoomsInitialized = async () => {
        if (explicitRooms !== null)
            return explicitRooms;
        const agents = await registry.list();
        const workers = agents.filter((a) => a.role === "worker");
        const baseSpaces = buildSpaces(Math.max(1, ringsFor(workers.length)));
        const rooms = baseSpaces
            .filter((s) => s.kind !== "office")
            .map((s) => ({ id: s.id, kind: s.kind, name: s.name, q: s.q, r: s.r }));
        explicitRooms = rooms;
        await writeRooms(rooms);
        return rooms;
    };
    const registry = new AgentRegistry(ref);
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
    const info = async () => {
        const cfg = await readGlobalConfig();
        globalConfig = cfg;
        return {
            kind: ref.kind,
            name: ref.kind === "project" ? basename(ref.projectPath) || ref.projectPath : "Hub",
            projectPath: ref.kind === "project" ? ref.projectPath : null,
            knownProjects: cfg.knownProjects,
        };
    };
    const usageTracker = new UsageTracker(root);
    await usageTracker.init();
    const gameService = new GameService({ root, bus: opts.bus, registry });
    gameService.start();
    // Idle lounge tracking: watch task state transitions on the bus.
    opts.bus.on((m) => {
        if (m.type === "task.updated") {
            const { task } = m;
            const agentId = task.assigneeId;
            const s = settings();
            if (task.status === "running" || task.status === "assigned") {
                void gameService.onAgentBusy(agentId);
            }
            else if (isTerminal(task.status)) {
                gameService.onAgentIdle(agentId, s.idleLoungeMinutes);
            }
        }
    });
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
        usageTracker,
        emitProviders: () => emitProvidersFn(),
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
    /** The agent's last finished tasks, newest first, for the "Your recent work" digest. */
    const recentWork = async (agentId, exceptTaskId) => (await tasks.list())
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
            prepare: async (req) => {
                const task = req.taskId ? await tasks.get(req.taskId) : undefined;
                // A brainstorm must not inherit the saved subagent's editing tools or instructions.
                const readOnly = task?.readOnly === true;
                const target = task?.projectPath || (ref.kind === "project" ? ref.projectPath : "");
                const work = await recentWork(req.agent.id, req.taskId);
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
        sessionRuntime.onSessionsChanged = () => void sessions().then((list) => opts.bus.emit({ type: "sessions.updated", sessions: list }), () => undefined);
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
    if (sessionRuntime)
        await syncProjectSubagents();
    const providerStatuses = async () => {
        const out = [];
        for (const p of PROVIDER_ORDER) {
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
    emitProvidersFn = async () => {
        opts.bus.emit({ type: "providers.updated", providers: await providerStatuses(), autoProvider: await orchestrator.autoProvider() });
    };
    // Snapshot helper (defined here so addRoom/removeRoom can broadcast it before the return object).
    const snapshot = async () => {
        const agents = await registry.list();
        const rc = explicitRooms !== null
            ? currentOfficeRings(explicitRooms)
            : ringsFor(agents.filter((a) => a.role === "worker").length);
        return {
            spaceNames: { ...spaceNames },
            world: await info(),
            agents,
            tasks: (await tasks.list()).map(toWire),
            providers: await providerStatuses(),
            autoProvider: await orchestrator.autoProvider(),
            settings: projectSettings,
            sessions: await sessions(),
            ringCount: rc,
            games: await gameService.getGames(),
            ...orchestrator.pending(),
        };
    };
    // addRoom: ring-by-ring explicit room placement.
    const addRoomFn = async (kind, name) => {
        const rooms = await ensureRoomsInitialized();
        const hex = nextAddRoomHex(rooms);
        if (!hex) {
            return { ok: false, message: `The office is full (${MAX_RINGS} rings). Remove an empty room first.` };
        }
        const id = nextRoomId(kind, rooms);
        const podCount = rooms.filter((r) => r.kind === "pod").length;
        const defaultName = kind === "pod" ? `Pod ${String.fromCharCode(65 + podCount)}` : kind === "meeting" ? "Meeting Room" : "Lounge";
        const newRoom = { id, kind, name: name.trim() || defaultName, q: hex.q, r: hex.r };
        const next = [...rooms, newRoom];
        explicitRooms = next;
        await writeRooms(next);
        // Persist a display-name override so list_spaces and the client see the custom name immediately.
        if (newRoom.name !== defaultName)
            await renameSpace(id, newRoom.name);
        void snapshot().then((s) => opts.bus.emit({ type: "snapshot", ...s }));
        return { ok: true, spaceId: id };
    };
    // removeRoom: only empty rooms (no seated agents), never the Manager's Office.
    const removeRoomFn = async (spaceId) => {
        if (spaceId === "office")
            return { ok: false, message: "Cannot remove the Manager's Office." };
        const rooms = explicitRooms;
        if (rooms === null || !rooms.find((r) => r.id === spaceId)) {
            return { ok: false, message: `Unknown room '${spaceId}'.` };
        }
        const agents = await registry.list();
        const spaces = buildSpacesFromExplicit(rooms);
        const plan = planOfficeWithSpaces(spaces, agents);
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
        const next = rooms.filter((r) => r.id !== spaceId);
        explicitRooms = next;
        await writeRooms(next);
        if (spaceNames[spaceId])
            await renameSpace(spaceId, "");
        void snapshot().then((s) => opts.bus.emit({ type: "snapshot", ...s }));
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
            updatePatch.limit = undefined;
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
        retryTask: async (taskId) => {
            const cur = await tasks.get(taskId);
            if (!cur)
                throw new Error(`Unknown task ${taskId}`);
            if (cur.status !== "failed")
                throw new Error(`Only failed tasks can be retried (status is ${cur.status})`);
            // transition() clears the resolution automatically when moving to queued.
            const retried = await tasks.transition(taskId, "queued", { error: undefined, result: undefined });
            orchestrator.startTask(taskId);
            return retried;
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
        removeRoom: removeRoomFn,
        snapshot,
    };
}
/** Wire form of a task: identical minus the (potentially large) log. */
export function toWire(task) {
    return { ...task, log: [] };
}
//# sourceMappingURL=world.js.map