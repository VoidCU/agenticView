import type { MiddlewareHandler } from "hono";

export function tokenOf(query: string | undefined, header: string | undefined): string {
  return query ?? header ?? "";
}

/** Requires the launch token as `?token=` or the `x-agenticview-token` header. */
export function requireToken(token: string): MiddlewareHandler {
  return async (c, next) => {
    const got = tokenOf(c.req.query("token"), c.req.header("x-agenticview-token"));
    if (!got || got !== token) return c.json({ error: "unauthorized" }, 401);
    await next();
  };
}
