import { Hono } from "hono";
import { type OAuthFlow } from "./oauth.js";
import { type MailService } from "./service.js";
/** Office mail REST API (mounted under the token middleware). Never returns the client secret or tokens. */
export declare function mailRoutes(mail: MailService, flow: OAuthFlow): Hono;
