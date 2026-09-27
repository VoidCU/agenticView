import { z } from "zod";

/** Networks the My Office wall screen (social hub) can show. Stub: nothing connects yet. */
export const SocialNetworkSchema = z.enum(["instagram", "meta"]);
export type SocialNetwork = z.infer<typeof SocialNetworkSchema>;

export const SocialHubItemSchema = z.object({
  id: z.string(),
  network: SocialNetworkSchema,
  text: z.string(),
  ts: z.string(),
  url: z.string().optional(),
});
export type SocialHubItem = z.infer<typeof SocialHubItemSchema>;

/** State of the social hub on the My Office wall screen. */
export const SocialHubStateSchema = z.object({
  connected: z.object({ instagram: z.boolean(), meta: z.boolean() }),
  items: z.array(SocialHubItemSchema),
});
export type SocialHubState = z.infer<typeof SocialHubStateSchema>;

/** Nothing connected, nothing to show. */
export function emptySocialHub(): SocialHubState {
  return { connected: { instagram: false, meta: false }, items: [] };
}
