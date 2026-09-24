import type { MiddlewareHandler } from "hono";
export declare function tokenOf(query: string | undefined, header: string | undefined): string;
/** Requires the launch token as `?token=` or the `x-agenticview-token` header. */
export declare function requireToken(token: string): MiddlewareHandler;
