import { managerHome, nextPlacement, planOffice, seatPose, type Agent, type Placement, type SeatPose, type Space } from "@agenticview/shared";

export interface Pose extends SeatPose {
  space: string;
  seat?: number;
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

export function layoutFor(agents: Agent[], spaceNames?: Record<string, string>): OfficeLayout {
  const { spaces, placements } = planOffice(agents);
  const resolvedSpaces = spaceNames
    ? spaces.map((s) => (spaceNames[s.id]?.trim() ? { ...s, name: spaceNames[s.id]!.trim() } : s))
    : spaces;
  const byId = new Map(resolvedSpaces.map((s) => [s.id, s]));
  const office = byId.get("office")!;
  const poses: Record<string, Pose> = {};
  const occupied = new Map<string, string>();
  agents
    .filter((a) => a.role === "manager")
    .forEach((m, i) => {
      const home = managerHome(office);
      poses[m.id] = { ...home, x: home.x + i * 1.2, space: "office" };
    });
  for (const [id, p] of Object.entries(placements)) {
    const s = byId.get(p.space);
    if (!s) continue;
    poses[id] = { ...seatPose(s, p.seat), space: s.id, seat: p.seat };
    occupied.set(seatKey(p), id);
  }
  return { spaces: resolvedSpaces, poses, placements, occupied, next: nextPlacement(agents) };
}
