import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { BridgeTool } from "../runtimes/types.js";

export class BridgeAuthError extends Error {
  constructor() {
    super("Unknown run or bad bridge token");
    this.name = "BridgeAuthError";
  }
}

export interface ToolDescription {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** Per-run registry of custom tools, guarded by a per-run token. Released tools are unreachable. */
export class ToolRegistry {
  private readonly runs = new Map<string, { token: string; tools: Map<string, BridgeTool> }>();

  register(runId: string, tools: BridgeTool[]): { token: string } {
    const token = randomBytes(16).toString("hex");
    this.runs.set(runId, { token, tools: new Map(tools.map((t) => [t.name, t])) });
    return { token };
  }

  release(runId: string): void {
    this.runs.delete(runId);
  }

  private auth(runId: string, token: string) {
    const r = this.runs.get(runId);
    if (!r || !token || r.token !== token) throw new BridgeAuthError();
    return r;
  }

  describe(runId: string, token: string): ToolDescription[] {
    return [...this.auth(runId, token).tools.values()].map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: z.toJSONSchema(z.object(t.schema)) as Record<string, unknown>,
    }));
  }

  async call(runId: string, token: string, name: string, args: unknown): Promise<string> {
    const tool = this.auth(runId, token).tools.get(name);
    if (!tool) throw new Error(`Unknown tool ${name}`);
    const parsed = z.object(tool.schema).safeParse(args ?? {});
    if (!parsed.success) throw new Error(`Invalid arguments for ${name}: ${parsed.error.message}`);
    return tool.handler(parsed.data as Record<string, unknown>);
  }
}
