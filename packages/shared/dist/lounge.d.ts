/**
 * Lounge spot model and assignment for the AgenticView lounge room.
 *
 * `loungeSpots(capacityHint, hexR)` returns a deterministic, scale-aware set of
 * physical spots inside (and optionally outside) the lounge room.  Pixel reads
 * the companion `furniture` array to place meshes at the same positions.
 *
 * `assignLoungeSpots(agentIds, spots, prior?)` assigns each agent to a unique
 * spot and is stable: agents in `prior` keep their spot when it is still free.
 *
 * `rpsFacing(a, b)` returns yaw angles so two players look at each other.
 */
export type LoungeSpotKind = "sofa" | "armchair" | "counter" | "beanbag" | "standing";
export interface LoungeSpot {
    /** Unique within one `LoungeLayout`; format: "kind-N" (e.g. "sofa-0"). */
    id: string;
    kind: LoungeSpotKind;
    /** X position relative to the lounge room centre. */
    x: number;
    /** Z position relative to the lounge room centre. */
    z: number;
    /** Yaw (radians) the occupant faces — three.js convention: 0 along +z. */
    yaw: number;
    pose: "sit" | "stand" | "floor";
    /** Eye/hip height in world units (0 = floor, 0.5 = low seat, 1.0 = standing). */
    seatHeight: number;
    /** Convenience unit-vector derived from yaw. */
    facing: {
        x: number;
        z: number;
    };
    /** True for overflow spots placed just outside the doorway. */
    waiting?: boolean;
}
export interface LoungeFurniturePiece {
    /** Stable id, e.g. "sofa-0". */
    id: string;
    kind: LoungeSpotKind;
    /** Centre of the furniture piece, relative to the lounge room centre. */
    x: number;
    z: number;
    /** Yaw of the whole piece: its front (local +z) faces this way (three.js convention). */
    yaw: number;
    /** Number of seats this piece provides. */
    seats: number;
    /** Footprint width along the piece's local x axis (world units). */
    w: number;
    /** Footprint depth along the piece's local z axis (world units). */
    d: number;
}
/** Standing spot used while two agents play rock-paper-scissors. */
export interface LoungeGameSpot {
    /** "game-<pair>-a" / "game-<pair>-b". */
    id: string;
    x: number;
    z: number;
    /** Faces the partner spot of the same pair. */
    yaw: number;
}
export interface LoungeLayout {
    /** All spots, ordered: sofas → armchairs → counter → beanbags → standing → waiting. */
    spots: LoungeSpot[];
    /** Furniture pieces Pixel uses to render meshes and colliders (same footprints). */
    furniture: LoungeFurniturePiece[];
    /** Facing pairs of standing spots across the coffee table: [a, b] per pair. */
    gameSpots: [LoungeGameSpot, LoungeGameSpot][];
    /** Coffee table radius (table at the room centre). */
    tableR: number;
    /** Doorway direction (radians, local) whose walkway to the centre is kept clear. */
    doorAngle: number;
}
/** Max distance (world units) between two lounging agents' spots for an auto RPS match. */
export declare const RPS_PAIR_MAX_DIST = 1.5;
/**
 * Generate a full lounge layout scaled to `hexR` (default `HEX_R`).
 *
 * Base capacity (no waiting spots): 16 spots.
 * When `capacityHint > 16`, additional waiting spots are appended (distinct
 * positions just outside the main doorway).
 *
 * All positions are **local to the lounge room centre** so the caller can add
 * the room's world (x, z) to get world coordinates.
 */
export declare function loungeSpots(capacityHint?: number, hexR?: number): LoungeLayout;
/**
 * Pairs of lounging agents whose assigned spots are within `maxDist` of each
 * other (default RPS_PAIR_MAX_DIST). Waiting (overflow) spots never pair.
 * Deterministic: sorted by distance, then agent ids. Each pair is [a, b] with a < b.
 */
export declare function nearbyRpsPairs(assignment: Record<string, string>, spots: LoungeSpot[], maxDist?: number): {
    a: string;
    b: string;
    dist: number;
}[];
/** The layout + assignment the scene uses for a set of lounging agents (same call as Office.tsx). */
export declare function loungeAssignmentFor(agentIds: string[], prior?: Record<string, string>): {
    layout: LoungeLayout;
    assignment: Record<string, string>;
};
/**
 * Deterministically assign each agentId to a unique LoungeSpot.
 *
 * Rules:
 * 1. Agents present in `prior` keep their spot when the spot still exists.
 * 2. Unassigned agents are given the next free spot in `spots` order, sorted by agentId.
 * 3. If there are more agents than spots the excess agents remain unassigned.
 *
 * Returns a map `agentId → spotId`.
 */
export declare function assignLoungeSpots(agentIds: string[], spots: LoungeSpot[], prior?: Record<string, string>): Record<string, string>;
/**
 * Given the positions of two RPS players (local to any common origin), return
 * the yaw each should use so they look directly at each other.
 */
export declare function rpsFacing(a: {
    x: number;
    z: number;
}, b: {
    x: number;
    z: number;
}): {
    yawA: number;
    yawB: number;
};
