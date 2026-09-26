import { z } from "zod";
export const MoveSchema = z.enum(["rock", "paper", "scissors"]);
/** A single finished match (agents vs agents or user vs agent). */
export const MatchSchema = z.object({
    id: z.string(),
    at: z.string(),
    /** [playerA_id, playerB_id]. For user matches playerA is "you". */
    players: z.tuple([z.string(), z.string()]),
    /** [moveA, moveB]. For best-of-3 user matches this is the deciding round's moves. */
    moves: z.tuple([MoveSchema, MoveSchema]),
    /** Winning player id, or null for a draw. */
    winner: z.string().nullable(),
    kind: z.enum(["agents", "user"]),
});
export const PlayerStatsSchema = z.object({
    playerId: z.string(),
    name: z.string(),
    wins: z.number().int().min(0),
    losses: z.number().int().min(0),
    draws: z.number().int().min(0),
});
export const GamesDataSchema = z.object({
    leaderboard: z.array(PlayerStatsSchema),
    recent: z.array(MatchSchema),
});
//# sourceMappingURL=games.js.map