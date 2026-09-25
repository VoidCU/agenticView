import type { Agent, Placement } from "./agent.js";
/**
 * The office is a honeycomb of flat-top hexagonal rooms ("spaces").
 * Axial coordinates (q, r); world x/z on the floor plane (y up).
 * Angles are measured in the x/z plane: angle 0 points along +x, 90 degrees along +z.
 */
/** Circumradius of one hex room (center to corner). */
export declare const HEX_R = 5;
/** Center to the middle of a wall (where the doorway is). */
export declare const HEX_APOTHEM: number;
/** Everyone walks along this circle inside a room; furniture stays inside it or out in the corners. */
export declare const WALK_R = 2.85;
/** Widest honeycomb the office grows to. */
export declare const MAX_RINGS = 3;
export type SpaceKind = "office" | "pod" | "meeting" | "lounge";
export interface Space {
    id: string;
    name: string;
    kind: SpaceKind;
    q: number;
    r: number;
    x: number;
    z: number;
    /** Ring index (0 for the manager's office). */
    ring: number;
    /** How many worker seats the space has (0 for the manager's office). */
    seats: number;
}
export interface Point {
    x: number;
    z: number;
}
export interface SeatPose extends Point {
    /** Direction the robot looks, radians around Y (three.js convention: 0 looks along +z). */
    yaw: number;
}
/** Neighbour offsets. Direction i points from a center toward the doorway at angle DOOR_ANGLES[i]. */
export declare const AXIAL_DIRS: ReadonlyArray<readonly [number, number]>;
export declare const DOOR_ANGLES: readonly number[];
export declare const SEATS_BY_KIND: Record<SpaceKind, number>;
export declare function axialToWorld(q: number, r: number, size?: number): Point;
export declare function worldToAxial(x: number, z: number, size?: number): {
    q: number;
    r: number;
};
export declare function hexDistance(a: {
    q: number;
    r: number;
}, b: {
    q: number;
    r: number;
}): number;
/** Hexes of ring k, walked in a fixed order. */
export declare function hexRing(k: number): {
    q: number;
    r: number;
}[];
/** Every space of a honeycomb with `rings` rings around the manager's office (clamped to 1..MAX_RINGS). */
export declare function buildSpaces(rings: number): Space[];
export declare function podCount(rings: number): number;
/** Id of the pod with the given index (0 → pod-a), independent of ring count. */
export declare function podId(index: number): string;
/** Rings needed to seat `workers` in pods with at least one desk to spare. */
export declare function ringsFor(workers: number): number;
export declare function spaceAt(spaces: Space[], x: number, z: number): Space | undefined;
export declare function neighbors(spaces: Space[], s: Space): {
    dir: number;
    space: Space;
}[];
/** World-space midpoint of the doorway in wall `dir` of space `s`. */
export declare function doorPoint(s: Space, dir: number): Point;
/** The six corners of a space, starting at angle 0 and going counter-clockwise in angle. */
export declare function hexCorners(s: Point, radius?: number): Point[];
export declare function yawToward(from: Point, to: Point): number;
/** Local seat layout of each kind, relative to the space center. */
export declare function seatLocal(kind: SpaceKind, seat: number): SeatPose;
export declare function seatPose(s: Space, seat: number): SeatPose;
/** Where the manager stands in its own office: behind the desk, looking toward the camera. */
export declare function managerHome(s: Space): SeatPose;
/** Where the manager stops to talk to whoever sits at `seat`: a step toward the walkway, facing them. */
export declare function visitPose(s: Space, seat: number): SeatPose;
export declare function angleDiff(a: number, b: number): number;
/** Cheapest chain of spaces from a to b. Crossing the meeting room or lounge costs more than going round. */
export declare function spacePath(spaces: Space[], from: Space, to: Space): Space[];
/**
 * Waypoints from `from` to `to`, never crossing a wall: step out to the room's walkway,
 * go round it to a doorway, through the doorway, and so on until the target room, then step in to the target.
 * The first point is `from` itself.
 */
export declare function route(spaces: Space[], from: Point, to: Point): Point[];
export declare function pathLength(pts: Point[]): number;
export interface OfficePlan {
    spaces: Space[];
    /** Resolved seat of every worker (persisted placement when valid, else auto-assigned). */
    placements: Record<string, Placement>;
}
/**
 * Resolve every worker's seat. Workers keep a valid persisted placement (first come by creation wins a
 * contested seat); everyone else fills free pod desks in pod order. The honeycomb grows a ring when
 * the pods are full, and also far enough to contain any persisted placement.
 */
export declare function planOffice(agents: Agent[]): OfficePlan;
export declare function firstFreeSeat(spaces: Space[], taken: Set<string>): Placement | undefined;
/** The seat a newly created worker would take. */
export declare function nextPlacement(agents: Agent[]): Placement | undefined;
/** Find a space by id or (case-insensitive) name. */
export declare function findSpace(spaces: Space[], ref: string): Space | undefined;
/** Everywhere a worker could be moved to: the current honeycomb plus the next ring (so the manager can expand). */
export declare function assignableSpaces(agents: Agent[]): Space[];
