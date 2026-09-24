import { randomBytes } from "node:crypto";
import { z } from "zod";
export class BridgeAuthError extends Error {
    constructor() {
        super("Unknown run or bad bridge token");
        this.name = "BridgeAuthError";
    }
}
/** Per-run registry of custom tools, guarded by a per-run token. Released tools are unreachable. */
export class ToolRegistry {
    runs = new Map();
    register(runId, tools) {
        const token = randomBytes(16).toString("hex");
        this.runs.set(runId, { token, tools: new Map(tools.map((t) => [t.name, t])) });
        return { token };
    }
    release(runId) {
        this.runs.delete(runId);
    }
    auth(runId, token) {
        const r = this.runs.get(runId);
        if (!r || !token || r.token !== token)
            throw new BridgeAuthError();
        return r;
    }
    describe(runId, token) {
        return [...this.auth(runId, token).tools.values()].map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: z.toJSONSchema(z.object(t.schema)),
        }));
    }
    async call(runId, token, name, args) {
        const tool = this.auth(runId, token).tools.get(name);
        if (!tool)
            throw new Error(`Unknown tool ${name}`);
        const parsed = z.object(tool.schema).safeParse(args ?? {});
        if (!parsed.success)
            throw new Error(`Invalid arguments for ${name}: ${parsed.error.message}`);
        return tool.handler(parsed.data);
    }
}
//# sourceMappingURL=toolRegistry.js.map