import { describe, it, expect } from "vitest";
import { z } from "zod";
import { ToolRegistry, BridgeAuthError } from "../../src/bridge/toolRegistry.js";
import { bridgeRoutes } from "../../src/bridge/httpBridge.js";
import { jsonSchemaToZodShape } from "../../src/bridge/jsonSchemaToZod.js";
import type { BridgeTool } from "../../src/runtimes/types.js";

const tools: BridgeTool[] = [
  {
    name: "add",
    description: "adds",
    schema: { a: z.number().describe("first"), b: z.number() },
    handler: async (x) => String(Number(x.a) + Number(x.b)),
  },
];

describe("ToolRegistry", () => {
  it("describes and calls with the right token, rejects otherwise, forgets after release", async () => {
    const r = new ToolRegistry();
    const { token } = r.register("r_1", tools);
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    const desc = r.describe("r_1", token);
    expect(desc[0]).toMatchObject({ name: "add", description: "adds", inputSchema: { type: "object", properties: { a: { type: "number", description: "first" } } } });
    expect(await r.call("r_1", token, "add", { a: 1, b: 2 })).toBe("3");
    expect(() => r.describe("r_1", "nope")).toThrow(BridgeAuthError);
    await expect(r.call("r_1", "nope", "add", {})).rejects.toThrow(BridgeAuthError);
    await expect(r.call("r_1", token, "add", { a: "x", b: 2 })).rejects.toThrow(/Invalid arguments/);
    await expect(r.call("r_1", token, "missing", {})).rejects.toThrow(/Unknown tool/);
    r.release("r_1");
    expect(() => r.describe("r_1", token)).toThrow(BridgeAuthError);
  });

  it("json schema round-trips to a zod shape", () => {
    const r = new ToolRegistry();
    const { token } = r.register("r_x", [
      ...tools,
      {
        name: "mixed",
        description: "",
        schema: { s: z.string(), flag: z.boolean().optional(), tags: z.array(z.string()), mode: z.enum(["a", "b"]), obj: z.record(z.string(), z.unknown()) },
        handler: async () => "",
      },
    ]);
    const [add, mixed] = r.describe("r_x", token);
    const addShape = z.object(jsonSchemaToZodShape(add!.inputSchema));
    expect(addShape.safeParse({ a: 1, b: 2 }).success).toBe(true);
    expect(addShape.safeParse({ a: "x", b: 2 }).success).toBe(false);
    expect(addShape.safeParse({ a: 1 }).success).toBe(false);
    const mixedShape = z.object(jsonSchemaToZodShape(mixed!.inputSchema));
    expect(mixedShape.safeParse({ s: "x", tags: ["t"], mode: "a", obj: { k: 1 } }).success).toBe(true);
    expect(mixedShape.safeParse({ s: "x", tags: ["t"], mode: "zzz", obj: {} }).success).toBe(false);
    expect(mixedShape.safeParse({ s: "x", flag: true, tags: [1], mode: "a", obj: {} }).success).toBe(false);
  });
});

describe("bridgeRoutes", () => {
  it("serves tools and calls over HTTP with 404 for unknown/finished runs", async () => {
    const r = new ToolRegistry();
    const { token } = r.register("r_2", tools);
    const app = bridgeRoutes(r);
    const list = await app.request("/bridge/r_2/tools", { headers: { "x-bridge-token": token } });
    expect(list.status).toBe(200);
    expect((await list.json())[0].name).toBe("add");
    const call = await app.request("/bridge/r_2/call", {
      method: "POST",
      headers: { "x-bridge-token": token, "content-type": "application/json" },
      body: JSON.stringify({ name: "add", args: { a: 2, b: 2 } }),
    });
    expect(await call.json()).toEqual({ ok: true, result: "4" });
    const bad = await app.request("/bridge/r_2/call", {
      method: "POST",
      headers: { "x-bridge-token": token, "content-type": "application/json" },
      body: JSON.stringify({ name: "add", args: { a: "q" } }),
    });
    expect(bad.status).toBe(200);
    expect((await bad.json()).ok).toBe(false);
    expect((await app.request("/bridge/r_2/tools", { headers: { "x-bridge-token": "bad" } })).status).toBe(404);
    expect((await app.request("/bridge/r_2/tools")).status).toBe(404);
    r.release("r_2");
    expect((await app.request("/bridge/r_2/tools", { headers: { "x-bridge-token": token } })).status).toBe(404);
    const gone = await app.request("/bridge/r_2/call", { method: "POST", headers: { "x-bridge-token": token, "content-type": "application/json" }, body: JSON.stringify({ name: "add", args: {} }) });
    expect(gone.status).toBe(404);
  });
});
