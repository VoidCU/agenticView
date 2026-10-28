import { Hono } from "hono";
import type { OAuthFlow } from "./oauth.js";

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ESC[ch]!);

function page(title: string, message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>` +
    `<style>body{font:16px system-ui,sans-serif;max-width:36rem;margin:4rem auto;padding:0 1rem}</style></head>` +
    `<body><h1>${esc(title)}</h1><p>${esc(message)}</p></body></html>`;
}

const HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
};

/**
 * Google's loopback redirect target. It is hit by the user's browser without the office token, so it is
 * mounted outside the token middleware; the single-use, 10-minute `state` issued by OAuthFlow.start() is
 * what authenticates it. Never logs codes or tokens.
 */
export function oauthRoutes(flow: OAuthFlow): Hono {
  const app = new Hono();
  app.get("/oauth/google/callback", async (c) => {
    const fail = (msg: string) => c.html(page("Gmail not connected", msg), 400, HEADERS);
    const error = c.req.query("error");
    if (error) return fail(`Google sign-in failed: ${error.slice(0, 200)}`);
    const state = c.req.query("state");
    const code = c.req.query("code");
    if (!state || !code) return fail("Missing state or code.");
    try {
      const account = await flow.complete(state, code);
      return c.html(page("Gmail connected", `Gmail connected: ${account.email}. You can close this tab.`), 200, HEADERS);
    } catch (e) {
      return fail(e instanceof Error ? e.message : "Connection failed.");
    }
  });
  return app;
}
