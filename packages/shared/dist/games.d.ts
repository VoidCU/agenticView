import { z } from "zod";
export declare const MoveSchema: z.ZodEnum<{
    rock: "rock";
    paper: "paper";
    scissors: "scissors";
}>;
export type Move = z.infer<typeof MoveSchema>;
/** A single finished match (agents vs agents or user vs agent). */
export declare const MatchSchema: z.ZodObject<{
    id: z.ZodString;
    at: z.ZodString;
    players: z.ZodTuple<[z.ZodString, z.ZodString], null>;
    moves: z.ZodTuple<[z.ZodEnum<{
        rock: "rock";
        paper: "paper";
        scissors: "scissors";
    }>, z.ZodEnum<{
        rock: "rock";
        paper: "paper";
        scissors: "scissors";
    }>], null>;
    winner: z.ZodNullable<z.ZodString>;
    kind: z.ZodEnum<{
        agents: "agents";
        user: "user";
    }>;
}, z.core.$strip>;
export type Match = z.infer<typeof MatchSchema>;
export declare const PlayerStatsSchema: z.ZodObject<{
    playerId: z.ZodString;
    name: z.ZodString;
    wins: z.ZodNumber;
    losses: z.ZodNumber;
    draws: z.ZodNumber;
}, z.core.$strip>;
export type PlayerStats = z.infer<typeof PlayerStatsSchema>;
export declare const GamesDataSchema: z.ZodObject<{
    leaderboard: z.ZodArray<z.ZodObject<{
        playerId: z.ZodString;
        name: z.ZodString;
        wins: z.ZodNumber;
        losses: z.ZodNumber;
        draws: z.ZodNumber;
    }, z.core.$strip>>;
    recent: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        at: z.ZodString;
        players: z.ZodTuple<[z.ZodString, z.ZodString], null>;
        moves: z.ZodTuple<[z.ZodEnum<{
            rock: "rock";
            paper: "paper";
            scissors: "scissors";
        }>, z.ZodEnum<{
            rock: "rock";
            paper: "paper";
            scissors: "scissors";
        }>], null>;
        winner: z.ZodNullable<z.ZodString>;
        kind: z.ZodEnum<{
            agents: "agents";
            user: "user";
        }>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type GamesData = z.infer<typeof GamesDataSchema>;
/** Result of one round in a user best-of-3 match. */
export interface GameRoundResult {
    matchId: string;
    round: number;
    userMove: Move;
    agentMove: Move;
    /** Round winner: "you", "agent", or null for draw. */
    winner: "you" | "agent" | null;
    score: {
        you: number;
        agent: number;
    };
    done: boolean;
}
