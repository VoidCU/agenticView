import { Hono } from "hono";
import { z } from "zod";
import type { EventBus } from "../events/bus.js";

const HookBody = z.object({ kind: z.string().min(1).max(64), text: z.string().max(2000) });

/** Receives events from the user's own Claude Code session (plugin hooks) and mirrors them into the office. */
export function mirrorRoutes(bus: EventBus): Hono {
  const app = new Hono();
  app.post("/hooks", async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: "JSON body expected" }, 400);
    }
    const parsed = HookBody.safeParse(raw);
    if (!parsed.success) return c.json({ error: "kind and text are required" }, 400);
    bus.emit({ type: "mirror.event", event: { ...parsed.data, ts: new Date().toISOString() } });
    return c.json({ ok: true });
  });
  return app;
}
