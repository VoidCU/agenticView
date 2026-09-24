import { WebSocketServer } from "ws";
import { ClientMessageSchema, defaultAgent } from "@agenticview/shared";
import { tokenOf } from "./auth.js";
async function handle(msg, world, opts, send) {
    const { orchestrator, registry, bus } = world;
    switch (msg.type) {
        case "snapshot.request":
            send({ type: "snapshot", ...(await world.snapshot()) });
            return;
        case "chat.send":
            await orchestrator.handleUserMessage({ agentId: msg.agentId, text: msg.text, images: msg.images, projectPath: msg.projectPath });
            return;
        case "agent.create": {
            const scope = msg.agent.scope ?? (world.ref.kind === "project" ? "project" : "global");
            const draft = defaultAgent({ ...msg.agent, role: "worker", scope, provider: msg.agent.provider ?? null, model: msg.agent.model ?? null });
            const problem = await orchestrator.providerProblem(draft);
            if (problem)
                throw new Error(problem);
            const agent = await registry.create({ ...msg.agent, scope });
            bus.emit({ type: "agent.updated", agent });
            return;
        }
        case "agent.update": {
            const agent = await registry.update(msg.id, msg.patch);
            bus.emit({ type: "agent.updated", agent });
            return;
        }
        case "agent.copyToProject": {
            const agent = await registry.copyToProject(msg.id);
            bus.emit({ type: "agent.updated", agent });
            return;
        }
        case "agent.delete":
            await registry.remove(msg.id);
            bus.emit({ type: "agent.removed", id: msg.id });
            return;
        case "task.cancel":
            await orchestrator.cancel(msg.id);
            return;
        case "permission.respond":
            orchestrator.respondPermission(msg.id, msg.allow);
            return;
        case "question.respond":
            orchestrator.respondQuestion(msg.id, msg.answer);
            return;
        case "settings.update":
            await world.updateSettings(msg.settings);
            bus.emit({ type: "snapshot", ...(await world.snapshot()) });
            return;
        case "project.open": {
            if (world.ref.kind !== "hub" || !opts.openProject)
                throw new Error("project.open is only available in the hub");
            send({ type: "opened", url: await opts.openProject(msg.path) });
            return;
        }
    }
}
/** Attach the /ws endpoint: token-guarded upgrade, snapshot on connect, bus fan-out, command dispatch. */
export function attachWs(server, opts) {
    const wss = new WebSocketServer({ noServer: true });
    const clients = new Set();
    server.on("upgrade", (req, socket, head) => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        const token = tokenOf(url.searchParams.get("token") ?? undefined, req.headers["x-agenticview-token"]);
        if (url.pathname !== "/ws" || token !== opts.token) {
            socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
            socket.destroy();
            return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
    });
    wss.on("connection", (ws) => {
        clients.add(ws);
        const send = (m) => {
            if (ws.readyState === ws.OPEN)
                ws.send(JSON.stringify(m));
        };
        const off = opts.world.bus.on(send);
        void opts.world.snapshot().then((s) => send({ type: "snapshot", ...s }));
        ws.on("message", (data) => {
            let raw;
            try {
                raw = JSON.parse(String(data));
            }
            catch {
                send({ type: "error", message: "Message must be JSON" });
                return;
            }
            const parsed = ClientMessageSchema.safeParse(raw);
            if (!parsed.success) {
                const ref = typeof raw?.type === "string" ? String(raw.type) : undefined;
                send({ type: "error", message: `Invalid message: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`, ref });
                return;
            }
            void handle(parsed.data, opts.world, opts, send).catch((e) => send({ type: "error", message: e.message, ref: parsed.data.type }));
        });
        ws.on("close", () => {
            off();
            clients.delete(ws);
        });
    });
    return {
        close: () => new Promise((resolve) => {
            for (const c of clients)
                c.terminate();
            wss.close(() => resolve());
        }),
    };
}
//# sourceMappingURL=ws.js.map