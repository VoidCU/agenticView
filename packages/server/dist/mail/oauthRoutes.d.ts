import { Hono } from "hono";
import type { OAuthFlow } from "./oauth.js";
/**
 * Google's loopback redirect target. It is hit by the user's browser without the office token, so it is
 * mounted outside the token middleware; the single-use, 10-minute `state` issued by OAuthFlow.start() is
 * what authenticates it. Never logs codes or tokens.
 */
export declare function oauthRoutes(flow: OAuthFlow): Hono;
