import { z } from "zod";
import type { Agent, Placement } from "./agent.js";
/**
 * Office layout — honeycomb of flat-top hexagonal rooms ("spaces").
 * Axial coordinates (q, r); world x/z on the floor plane (y up).
 * Angles are measured in the x/z plane: angle 0 points along +x, 90 degrees along +z.
 *
 * The floor plan is data (OfficeLayout: every room with its kind and hex, see "layout as data" below).
 * The default plan (defaultLayout) puts the lounge in the centre, the Manager's Office west of it, the
 * meeting room north, four pods on the rest of ring 1 and My Office / Production Room / Research Room on
 * the west of ring 2; pods grow outward (growLayout) up to MAX_RINGS. validateLayout holds the rules.
 *
 * Legacy (0.2.16 and earlier, kept for rooms.json migration and old call sites): the Manager's Office was
 * hard-wired to the origin, ring 1 = four pods + meeting + lounge, rings 2/3 whole shells of pods
 * (buildSpaces, hexesForRing, nextAddRoomHex, ExplicitRoom, buildSpacesFromExplicit).
 */
/** Circumradius of one hex room (center to corner). */
export declare const HEX_R = 7;
/** Center to the middle of a wall (where the doorway is). */
export declare const HEX_APOTHEM: number;
/** Everyone walks along this circle inside a room; furniture stays inside it or out in the corners. */
export declare const WALK_R = 3.99;
/** Widest honeycomb the office grows to. */
export declare const MAX_RINGS = 3;
/** Desks per pod (2 rows of 3). */
export declare const POD_SEATS = 6;
/** Every kind of room. "office" is the manager's office, "myoffice" the human user's own room. */
export declare const SPACE_KINDS: readonly ["office", "pod", "meeting", "lounge", "myoffice", "production", "research"];
export type SpaceKind = (typeof SPACE_KINDS)[number];
export declare const SpaceKindSchema: z.ZodEnum<{
    office: "office";
    pod: "pod";
    meeting: "meeting";
    lounge: "lounge";
    myoffice: "myoffice";
    production: "production";
    research: "research";
}>;
/** Most hexes the honeycomb can hold (1 + 3·k·(k+1) for k = MAX_RINGS): 37. */
export declare const MAX_HEXES: number;
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
/** Default display name of each kind (pods get "Pod <letter>" from their id, see defaultRoomName). */
export declare const DEFAULT_ROOM_NAMES: Record<SpaceKind, string>;
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
/** Rooms reachable through a doorway of `s` (walls carrying a screen have no doorway). */
export declare function neighbors(spaces: Space[], s: Space): {
    dir: number;
    space: Space;
}[];
/** World-space midpoint of the doorway in wall `dir` of space `s`. */
export declare function doorPoint(s: Space, dir: number): Point;
/** The six corners of a space, starting at angle 0 and going counter-clockwise in angle. */
export declare function hexCorners(s: Point, radius?: number): Point[];
export declare function yawToward(from: Point, to: Point): number;
export interface WallScreenAnchor {
    /** Wall-midpoint angle (radians, x/z plane, local to the room). */
    angle: number;
    angleDeg: number;
    /** AXIAL_DIRS index of that wall (the neighbour on the other side is never reached through it). */
    dir: number;
    /** Centre of the screen's inner face, local to the room centre. */
    x: number;
    z: number;
    /** Height of the screen centre above the floor. */
    y: number;
    width: number;
    height: number;
    /** The way the screen faces (into the room), three.js yaw. */
    yaw: number;
}
/** My Office wall screen (social hub): the -150° (north-west) wall. */
export declare const WALL_SCREEN: WallScreenAnchor;
/** Production Room big screen: the -90° (north) wall. */
export declare const PRODUCTION_SCREEN: WallScreenAnchor;
/** The screen wall of a room kind, if it has one. */
export declare function screenWall(kind: SpaceKind): WallScreenAnchor | undefined;
export declare const MYOFFICE_FOOTPRINT: {
    readonly desk: {
        readonly x: number;
        readonly z: number;
        readonly w: 1.9;
        readonly d: 0.85;
        readonly yaw: number;
    };
    readonly chair: {
        readonly x: number;
        readonly z: number;
    };
};
export declare const PRODUCTION_FOOTPRINT: {
    readonly desks: readonly [{
        readonly x: -1;
        readonly z: -0.6;
        readonly w: 1.6;
        readonly d: 0.8;
    }, {
        readonly x: 1;
        readonly z: -0.6;
        readonly w: 1.6;
        readonly d: 0.8;
    }];
    readonly seats: readonly [{
        readonly x: -1;
        readonly z: 0.3;
    }, {
        readonly x: 1;
        readonly z: 0.3;
    }];
};
export declare const RESEARCH_FOOTPRINT: {
    readonly table: {
        readonly x: 0;
        readonly z: 0;
        readonly w: 2.8;
        readonly d: 1.1;
    };
    readonly seats: readonly [{
        readonly x: -0.7;
        readonly z: -1;
    }, {
        readonly x: 0.7;
        readonly z: -1;
    }, {
        readonly x: -0.7;
        readonly z: 1;
    }, {
        readonly x: 0.7;
        readonly z: 1;
    }];
};
/**
 * False when the wall between two adjacent rooms carries a screen on either side (no doorway there).
 * Non-adjacent rooms return false.
 */
export declare function wallIsOpen(a: {
    kind: SpaceKind;
    q: number;
    r: number;
}, b: {
    kind: SpaceKind;
    q: number;
    r: number;
}): boolean;
/** Where the human user's "You" avatar spawns in My Office: at the executive desk, facing the wall screen. */
export declare function userHome(s: Point): SeatPose;
/** Local seat layout of each kind, relative to the space center. */
export declare function seatLocal(kind: SpaceKind, seat: number): SeatPose;
export declare function seatPose(s: Space, seat: number): SeatPose;
/** Where the manager stands in its own office: behind the desk, looking toward the camera. */
export declare function managerHome(s: Space): SeatPose;
/** Where the manager stops to talk to whoever sits at `seat`: a step toward the walkway, facing them. */
export declare function visitPose(s: Space, seat: number): SeatPose;
export declare function angleDiff(a: number, b: number): number;
/**
 * Cheapest chain of spaces from a to b. Crossing a meeting room, lounge, office, my office, production or
 * research room costs more than going round through pods.
 */
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
 * Resolve every worker's seat on `layout` (default: defaultLayout for the roster size). Workers keep a
 * valid persisted placement (first come by creation wins a contested seat); a seat that no longer exists
 * (unknown room, seat out of range, a kind without seats) and workers without one fill the first free pod
 * desk in layout order. Without a layout the plan grows a ring only when every pod desk is taken, so a
 * stale seat in a ring the roster does not need is ignored and that worker is reseated inside.
 */
export declare function planOffice(agents: Agent[], layout?: OfficeLayout | null, spaceNames?: Record<string, string>): OfficePlan;
export declare function firstFreeSeat(spaces: Space[], taken: Set<string>): Placement | undefined;
/** The seat a newly created worker would take. */
export declare function nextPlacement(agents: Agent[], layout?: OfficeLayout | null): Placement | undefined;
/** Find a space by id or (case-insensitive) name. */
export declare function findSpace(spaces: Space[], ref: string): Space | undefined;
/** Everywhere a worker could be moved to: every seat of the current honeycomb (it grows by itself when full). */
export declare function assignableSpaces(agents: Agent[], layout?: OfficeLayout | null): Space[];
/**
 * Same as `planOffice` but uses a pre-built Space[] instead of deriving it from worker count.
 * Used when the world has an explicit room layout (addRoom/removeRoom).
 */
export declare function planOfficeWithSpaces(spaces: Space[], agents: Agent[]): OfficePlan;
/** Explicit room record persisted in rooms.json. */
export interface ExplicitRoom {
    id: string;
    kind: "pod" | "meeting" | "lounge";
    name: string;
    q: number;
    r: number;
}
export declare const ExplicitRoomSchema: z.ZodObject<{
    id: z.ZodString;
    kind: z.ZodEnum<{
        pod: "pod";
        meeting: "meeting";
        lounge: "lounge";
    }>;
    name: z.ZodString;
    q: z.ZodNumber;
    r: z.ZodNumber;
}, z.core.$strip>;
export declare const ExplicitRoomsSchema: z.ZodArray<z.ZodObject<{
    id: z.ZodString;
    kind: z.ZodEnum<{
        pod: "pod";
        meeting: "meeting";
        lounge: "lounge";
    }>;
    name: z.ZodString;
    q: z.ZodNumber;
    r: z.ZodNumber;
}, z.core.$strip>>;
/**
 * All hexes for a given ring in the canonical addRoom order.
 * Ring 1: RING1_PODS (4) then MEETING_HEX then LOUNGE_HEX.
 * Rings 2+: hexRing(k) sorted by viewOrder (closest to camera first).
 */
export declare function hexesForRing(ring: number): readonly {
    q: number;
    r: number;
}[];
/**
 * Returns the current maximum ring in use (0 = only manager's office).
 */
export declare function currentOfficeRings(rooms: {
    q: number;
    r: number;
}[]): number;
/**
 * Returns the next hex to use for addRoom (ring-by-ring order).
 * Returns null when all MAX_RINGS rings are full.
 * The ring-fill rule is enforced implicitly: ring k is only considered when ring k-1 is completely full.
 */
export declare function nextAddRoomHex(rooms: {
    q: number;
    r: number;
}[]): {
    q: number;
    r: number;
    ring: number;
} | null;
/** Generate a unique room ID for the next room of the given kind. */
export declare function nextRoomId(kind: Exclude<SpaceKind, "office">, rooms: ExplicitRoom[]): string;
/** Builds a Space[] from an explicit room list (always prepends the Manager's Office at ring 0). */
export declare function buildSpacesFromExplicit(rooms: ExplicitRoom[]): Space[];
export declare const LayoutRoomSchema: z.ZodObject<{
    id: z.ZodString;
    kind: z.ZodEnum<{
        office: "office";
        pod: "pod";
        meeting: "meeting";
        lounge: "lounge";
        myoffice: "myoffice";
        production: "production";
        research: "research";
    }>;
    name: z.ZodOptional<z.ZodString>;
    q: z.ZodNumber;
    r: z.ZodNumber;
}, z.core.$strip>;
export type LayoutRoom = z.infer<typeof LayoutRoomSchema>;
/** The floor plan: every room, including the manager's office and My Office, on its hex. */
export declare const OfficeLayoutSchema: z.ZodObject<{
    version: z.ZodLiteral<1>;
    rooms: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        kind: z.ZodEnum<{
            office: "office";
            pod: "pod";
            meeting: "meeting";
            lounge: "lounge";
            myoffice: "myoffice";
            production: "production";
            research: "research";
        }>;
        name: z.ZodOptional<z.ZodString>;
        q: z.ZodNumber;
        r: z.ZodNumber;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type OfficeLayout = z.infer<typeof OfficeLayoutSchema>;
export interface Hex {
    q: number;
    r: number;
}
export interface LayoutMove {
    /** Room id to move. */
    space: string;
    toHex: Hex;
}
/**
 * Hexes of the default plan (the user's sketch; minimap: world x to the right, world z downward,
 * so west = -x, north = -z). The lounge takes the centre, the manager's office sits west of it,
 * the meeting room north, and the three new rooms fill the west side of ring 2.
 */
export declare const DEFAULT_HEXES: {
    readonly lounge: {
        readonly q: 0;
        readonly r: 0;
    };
    readonly office: {
        readonly q: -1;
        readonly r: 0;
    };
    readonly meeting: {
        readonly q: 0;
        readonly r: -1;
    };
    readonly myoffice: {
        readonly q: -2;
        readonly r: 0;
    };
    readonly production: {
        readonly q: -1;
        readonly r: -1;
    };
    readonly research: {
        readonly q: -2;
        readonly r: 1;
    };
};
/** Ring-1 pods of the default plan, in pod-a.. order. */
export declare const DEFAULT_RING1_PODS: readonly Hex[];
/** Default display name of a room: "Pod C" for pod-c, "Meeting Room 2" for meeting-2, else the kind's name. */
export declare function defaultRoomName(kind: SpaceKind, id: string): string;
/** A fresh id for a new room of `kind`: the first unused pod-<letter>, else the kind, then kind-2, kind-3... */
export declare function newRoomId(layout: OfficeLayout, kind: SpaceKind): string;
/**
 * Next hex a new room of `kind` would take: free, within MAX_RINGS, sharing an open wall (doorway)
 * with an existing room; nearest ring first, then the side facing the camera (viewOrder).
 */
export declare function nextGrowthHex(layout: OfficeLayout, kind?: SpaceKind): Hex | null;
/**
 * Append pods (fresh pod ids) on free hexes that share a doorway with the plan until the pods have at
 * least one desk to spare for `workerCount` workers, or the honeycomb is full. Nearest ring first, then
 * the camera-facing side. Returns the same layout object when nothing needs to grow.
 */
export declare function growLayout(layout: OfficeLayout, workerCount: number): OfficeLayout;
/**
 * The default floor plan for `workerCount` workers: lounge in the centre, manager's office west of it,
 * meeting room north, ring-1 pods pod-a..pod-d as always, My Office / Production Room / Research Room on
 * the west side of ring 2, and whole rings of pods (like ringsFor) until the pods have a desk to spare.
 */
export declare function defaultLayout(workerCount?: number): OfficeLayout;
/** Spaces of a layout (manager's office first, then layout order). Names: spaceNames > room.name > default. */
export declare function buildSpacesFromLayout(layout: OfficeLayout, spaceNames?: Record<string, string>): Space[];
/** Ids of rooms reachable from the manager's office through doorways (screen walls are solid). */
export declare function reachableRooms(layout: OfficeLayout): Set<string>;
export interface ValidateLayoutContext {
    /** Seated workers (persisted placements): a room holding one may not disappear or lose that seat. */
    placements?: Record<string, Placement> | Placement[];
    /** The layout being replaced: only rooms that existed there count as "removed". */
    previous?: OfficeLayout | null;
}
export type LayoutValidation = {
    ok: true;
} | {
    ok: false;
    errors: string[];
};
/**
 * Check a layout: schema; exactly one manager's office and one My Office (lounge / meeting / pod /
 * production / research are free); unique ids and hexes; every hex within MAX_RINGS of the centre
 * (so at most MAX_HEXES rooms); every room reachable from the manager's office through doorways; and,
 * with `ctx.placements`, no seated worker losing their room or seat.
 */
export declare function validateLayout(layout: OfficeLayout, ctx?: ValidateLayoutContext): LayoutValidation;
/**
 * Move rooms to other hexes, in order. A move onto an occupied hex swaps the two rooms.
 * Throws on an unknown room id; the result is not validated (call validateLayout).
 */
export declare function applyLayoutMoves(layout: OfficeLayout, moves: LayoutMove[]): OfficeLayout;
/**
 * Change what the hex holds: a different kind replaces the room there with a fresh room of that kind
 * (new id, custom name dropped); an empty hex gets a new room; `null` removes the room; the same kind
 * is a no-op. The result is not validated (call validateLayout).
 */
export declare function setRoomKind(layout: OfficeLayout, hex: Hex, kind: SpaceKind | null): OfficeLayout;
