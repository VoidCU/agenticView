import { z } from "zod";
/** Networks the My Office wall screen (social hub) can show. Stub: nothing connects yet. */
export declare const SocialNetworkSchema: z.ZodEnum<{
    instagram: "instagram";
    meta: "meta";
}>;
export type SocialNetwork = z.infer<typeof SocialNetworkSchema>;
export declare const SocialHubItemSchema: z.ZodObject<{
    id: z.ZodString;
    network: z.ZodEnum<{
        instagram: "instagram";
        meta: "meta";
    }>;
    text: z.ZodString;
    ts: z.ZodString;
    url: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type SocialHubItem = z.infer<typeof SocialHubItemSchema>;
/** State of the social hub on the My Office wall screen. */
export declare const SocialHubStateSchema: z.ZodObject<{
    connected: z.ZodObject<{
        instagram: z.ZodBoolean;
        meta: z.ZodBoolean;
    }, z.core.$strip>;
    items: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        network: z.ZodEnum<{
            instagram: "instagram";
            meta: "meta";
        }>;
        text: z.ZodString;
        ts: z.ZodString;
        url: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type SocialHubState = z.infer<typeof SocialHubStateSchema>;
/** Nothing connected, nothing to show. */
export declare function emptySocialHub(): SocialHubState;
