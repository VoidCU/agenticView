import { z } from "zod";
/** Networks the My Office wall screen (social hub) can show. Stub: nothing connects yet. */
export const SocialNetworkSchema = z.enum(["instagram", "meta"]);
export const SocialHubItemSchema = z.object({
    id: z.string(),
    network: SocialNetworkSchema,
    text: z.string(),
    ts: z.string(),
    url: z.string().optional(),
});
/** State of the social hub on the My Office wall screen. */
export const SocialHubStateSchema = z.object({
    connected: z.object({ instagram: z.boolean(), meta: z.boolean() }),
    items: z.array(SocialHubItemSchema),
});
/** Nothing connected, nothing to show. */
export function emptySocialHub() {
    return { connected: { instagram: false, meta: false }, items: [] };
}
//# sourceMappingURL=social.js.map