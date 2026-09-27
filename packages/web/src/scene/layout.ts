import {
  managerHome,
  nextPlacement,
  planOffice,
  seatPose,
  userHome,
  yawToward,
  type Agent,
  type OfficeLayout as FloorPlan,
  type Placement,
  type SeatPose,
  type Space,
} from "@agenticview/shared";
import { CHAIR_SEAT_TOP, MANAGER_DESK_CLEARANCE } from "./kit";

/**
 * Height (world units, above the robot origin) of the underside of the robot body sphere, minus a
 * few cm of cushion sink: (0.05 tilt + 0.9 centre - 0.6 radius) * ROBOT_SCALE 0.72 - 0.04.
 */
export const ROBOT_SEAT_CONTACT = 0.21;
/** How high a seated robot rests: its body sits on the chair seat instead of its feet on the floor. */
export const SEATED_LIFT = CHAIR_SEAT_TOP - ROBOT_SEAT_CONTACT;

export interface Pose extends SeatPose {
  space: string;
  seat?: number;
  /** Seated on a chair: robots rest on the seat cushion (kit CHAIR_SEAT_TOP) once they arrive. */
  yOffset?: number;
  /** The manager at its executive desk (its chair is "<office id>#0"). */
  manager?: boolean;
}

export interface OfficeLayout {
  spaces: Space[];
  /** Resting pose of every agent: the manager at home, workers at their desks. */
  poses: Record<string, Pose>;
  placements: Record<string, Placement>;
  /** "space#seat" -> agent id. */
  occupied: Map<string, string>;
  /** The desk a new worker would get. */
  next?: Placement;
}

export const seatKey = (p: Placement) => `${p.space}#${p.seat}`;

/**
 * The scene's view of the floor plan: rooms from `layout` (the server's OfficeLayout; null/undefined
 * until it arrives, then the default plan for the roster, as before), seats and resting poses.
 * Nothing assumes where the manager's office is: it is the room of kind "office".
 */
export function layoutFor(agents: Agent[], spaceNames?: Record<string, string>, layout?: FloorPlan | null): OfficeLayout {
  const { spaces, placements } = planOffice(agents, layout, spaceNames);
  const resolvedSpaces = spaceNames
    ? spaces.map((s) => (spaceNames[s.id]?.trim() ? { ...s, name: spaceNames[s.id]!.trim() } : s))
    : spaces;
  const byId = new Map(resolvedSpaces.map((s) => [s.id, s]));
  const office = resolvedSpaces.find((s) => s.kind === "office") ?? resolvedSpaces[0]!;
  const poses: Record<string, Pose> = {};
  const occupied = new Map<string, string>();
  agents
    .filter((a) => a.role === "manager")
    .forEach((m, i) => {
      const home = managerHome(office);
      // Back off from the desk (which is 0.78 along the facing direction) so the body clears it.
      poses[m.id] = { ...home, x: home.x + i * 1.2 - Math.sin(home.yaw) * MANAGER_DESK_CLEARANCE, z: home.z - Math.cos(home.yaw) * MANAGER_DESK_CLEARANCE, space: office.id, yOffset: SEATED_LIFT, manager: true };
    });
  for (const [id, p] of Object.entries(placements)) {
    const s = byId.get(p.space);
    if (!s) continue;
    poses[id] = { ...seatPose(s, p.seat), space: s.id, seat: p.seat, yOffset: SEATED_LIFT };
    occupied.set(seatKey(p), id);
  }
  return { spaces: resolvedSpaces, poses, placements, occupied, next: nextPlacement(agents, layout) };
}

/**
 * The 'You' robot's resting pose: seated in My Office's desk chair (shared userHome, facing the wall
 * screen). Plans without a My Office fall back to the old spot in front of the manager.
 */
export function youHome(office: Space, myOffice?: Space): SeatPose & { yOffset?: number } {
  if (myOffice) return { ...userHome(myOffice), yOffset: SEATED_LIFT };
  const a = Math.PI / 4;
  const p = { x: office.x + 2.25 * Math.cos(a), z: office.z + 2.25 * Math.sin(a) };
  return { ...p, yaw: yawToward(p, managerHome(office)) };
}

/** Stable identity of a floor plan (rooms, kinds, hexes, names): changes exactly when the scene must rebuild. */
export function planSignature(spaces: readonly Space[]): string {
  return spaces.map((s) => `${s.id}:${s.kind}@${s.q},${s.r}`).join("|");
}

export { solidsForLayout, type SolidBox, type SolidCircle, type SolidObstacle } from "./solids";

/**
 * Seats whose owner is currently elsewhere (lounge, meeting, visiting, playing, walking home):
 * the agent's current target is not its resting pose. Returns sorted "space#seat" keys joined with
 * "," (the manager's desk is "office#0") so callers can memoise furniture on a plain string.
 */
export function awaySeatSignature(
  layout: Pick<OfficeLayout, "poses">,
  targets: Record<string, { x: number; z: number } | undefined>,
  /** Live robot positions: an owner still walking back (target = seat, not there yet) is also away. */
  live?: ReadonlyMap<string, { x: number; z: number }>,
): string {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const [id, pose] of Object.entries(layout.poses)) {
    const key = pose.manager ? `${pose.space}#0` : pose.seat === undefined ? undefined : `${pose.space}#${pose.seat}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const t = targets[id];
    const at = live?.get(id);
    if (!t || Math.hypot(t.x - pose.x, t.z - pose.z) > 0.3 || (at && Math.hypot(at.x - pose.x, at.z - pose.z) > 0.3)) out.push(key);
  }
  return out.sort().join(",");
}
