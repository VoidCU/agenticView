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
    kind: LoungeSpotKind;
    /** Centre of the furniture piece, relative to the lounge room centre. */
    x: number;
    z: number;
    /** Yaw of the whole piece (which way it "faces"). */
    yaw: number;
    /** Number of seats this piece provides. */
    seats: number;
}
export interface LoungeLayout {
    /** All spots, ordered: sofas → armchairs → counter → beanbags → standing → waiting. */
    spots: LoungeSpot[];
    /** Furniture pieces Pixel uses to render meshes.  Positions match the spots above. */
    furniture: LoungeFurniturePiece[];
}
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
