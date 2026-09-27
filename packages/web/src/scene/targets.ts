import { AXIAL_DIRS, DOOR_ANGLES, LOUNGE_DOOR_ANGLE, assignLoungeSpots, loungeSpots, managerHome, rpsFacing, seatPose, visitPose, wallIsOpen, yawToward, type Agent, type Match, type Space, type Task } from "@agenticview/shared";
import { hasWhiteboard } from "./kit";
import { SEATED_LIFT, type OfficeLayout } from "./layout";
import type { LoungeBreak } from "./breaks";
import { agentRevivePhase, isFaintedCrash, limitWalk } from "./breaks";
import { whiteboardPose } from "./Whiteboard";

export interface Target {
  x: number;
  z: number;
  yaw: number;
  yOffset?: number;
}

/**
 * Workers with desk work in progress (a task assigned, running or waiting that is not a brainstorm
 * meeting): they sit at their designated desk (workSeat).
 */
export function workingAgentIds(tasks: Iterable<Task>): Set<string> {
  const out = new Set<string>();
  for (const t of tasks) if (!t.meeting && (t.status === "assigned" || t.status === "running" || t.status === "waiting")) out.add(t.assigneeId);
  return out;
}

/** Where a worker sits at its designated desk, or undefined when it has none (or the desk is gone). */
export function workSeatTarget(agent: Agent, spaces: readonly Space[]): Target | undefined {
  const w = agent.workSeat;
  const s = w && spaces.find((x) => x.id === w.space);
  if (!w || !s || w.seat < 0 || w.seat >= s.seats) return undefined;
  const p = seatPose(s, w.seat);
  return { x: p.x, z: p.z, yaw: p.yaw, yOffset: SEATED_LIFT };
}

/** How far in front of a whiteboard a visitor stands, and the sideways gap between visitors. */
export const BOARD_STAND_DIST = 1.4;
export const VISITOR_GAP = 0.85;

/** True while `agent.visiting` is set and not yet past its `until` (the server clears it; this guards a stale copy). */
export function isVisiting(agent: Agent, now: number): boolean {
  const v = agent.visiting;
  if (!v || (!v.targetAgentId && !v.spaceId)) return false;
  const until = Date.parse(v.until);
  return Number.isNaN(until) || until > now;
}

/** Earliest future `visiting.until` among agents (ms), so the scene can re-evaluate targets when a visit lapses. */
export function nextVisitExpiry(agents: readonly Agent[], now: number): number | undefined {
  let best: number | undefined;
  for (const a of agents) {
    if (!a.visiting) continue;
    const t = Date.parse(a.visiting.until);
    if (!Number.isNaN(t) && t > now && (best === undefined || t < best)) best = t;
  }
  return best;
}

/**
 * Where a visiting agent stands. `slot` spreads several visitors to the same colleague / board sideways.
 * - Colleague: beside the colleague's desk (the walkway spot the manager uses), facing the colleague.
 * - Whiteboard: in front of the room's board, facing it. Lounges have no board: no target.
 */
export function visitTarget(agent: Agent, layout: Pick<OfficeLayout, "poses" | "spaces">, slot = 0): Target | undefined {
  const v = agent.visiting;
  if (!v) return undefined;
  const side = slot === 0 ? 0 : (slot % 2 === 1 ? 1 : -1) * Math.ceil(slot / 2) * VISITOR_GAP;
  if (v.targetAgentId && v.targetAgentId !== agent.id) {
    const host = layout.poses[v.targetAgentId];
    if (host) {
      const space = layout.spaces.find((s) => s.id === host.space);
      let base: { x: number; z: number };
      if (space && host.seat !== undefined && space.kind !== "office") {
        base = visitPose(space, host.seat);
      } else {
        // The manager (no seat number): a step beside its chair, on the side away from the desk.
        base = { x: host.x + Math.cos(host.yaw) * 1.1 - Math.sin(host.yaw) * 0.5, z: host.z - Math.sin(host.yaw) * 1.1 - Math.cos(host.yaw) * 0.5 };
      }
      // Sideways relative to the line visitor -> host.
      const yaw0 = yawToward(base, host);
      const p = { x: base.x + Math.cos(yaw0) * side, z: base.z - Math.sin(yaw0) * side };
      return { x: p.x, z: p.z, yaw: yawToward(p, host), yOffset: 0 };
    }
  }
  if (v.spaceId) {
    const space = layout.spaces.find((s) => s.id === v.spaceId);
    if (space && hasWhiteboard(space.kind)) {
      const b = whiteboardPose(space);
      const fx = Math.sin(b.yaw);
      const fz = Math.cos(b.yaw);
      // Out from the board along its facing, then sideways along the board.
      const x = b.x + fx * BOARD_STAND_DIST + fz * side;
      const z = b.z + fz * BOARD_STAND_DIST - fx * side;
      return { x, z, yaw: yawToward({ x, z }, b), yOffset: 0 };
    }
  }
  return undefined;
}

/** Distance from the manager's home pose, toward the room, where a reporting agent stands (behind the visitor chairs). */
export const REPORT_DIST = 2.75;

/**
 * Where an agent reporting a provider limit stands: across the executive desk from the Manager,
 * behind the two visitor chairs, facing the Manager. Further reporters line up sideways.
 */
export function reportSpot(office: Space, slot = 0): Target {
  const home = managerHome(office);
  // The desk faces the camera side (+x/+z, 45 deg), like kit.ts officeRoom.
  const fx = Math.SQRT1_2;
  const fz = Math.SQRT1_2;
  const side = slot === 0 ? 0 : (slot % 2 === 1 ? 1 : -1) * Math.ceil(slot / 2) * VISITOR_GAP;
  const p = { x: home.x + fx * REPORT_DIST + fz * side, z: home.z + fz * REPORT_DIST - fx * side };
  return { ...p, yaw: yawToward(p, home), yOffset: 0 };
}

/**
 * The lounge doorway overflow agents queue outside: the one toward the manager's office when they share
 * a doorway, else the lounge's first doorway, else the default (-150 degrees). Follows live re-layouts.
 */
export function loungeDoorAngle(spaces: readonly Space[], lounge: Space): number {
  let first: number | undefined;
  let toOffice: number | undefined;
  AXIAL_DIRS.forEach(([dq, dr], dir) => {
    const n = spaces.find((o) => o.q === lounge.q + dq && o.r === lounge.r + dr);
    if (!n || !wallIsOpen(lounge, n)) return;
    first ??= DOOR_ANGLES[dir]!;
    if (n.kind === "office") toOffice = DOOR_ANGLES[dir]!;
  });
  return toOffice ?? first ?? LOUNGE_DOOR_ANGLE;
}

export interface TargetInputs {
  layout: OfficeLayout;
  list: readonly Agent[];
  lounge?: Space;
  loungeBreaks: ReadonlyMap<string, LoungeBreak>;
  /** Stable lounge spot assignment from the previous call; the new one is returned in `loungeAssign`. */
  prevLoungeAssign: Record<string, string>;
  managerId?: string;
  /** Worker the manager is currently walking over to (task hand-off / result). */
  managerVisit?: string;
  activeRpsMatch?: { players: [string, string]; spotIds: [string, string] };
  gameAnimation?: { match: Match; at: number };
  /** Workers with desk work in progress (workingAgentIds): they target their workSeat. */
  working?: ReadonlySet<string>;
  now: number;
}

/**
 * Every agent's current walk target. Priority (later wins): resting pose < idle visit < lounge / crash faint
 * < working at the designated desk (workSeat) < limit report at the Manager's desk
 * < manager walks < RPS match < RPS result facing. Pure: the scene memoises it on its inputs.
 */
export function computeTargets(inp: TargetInputs): { targets: Record<string, Target>; loungeAssign: Record<string, string> } {
  const { layout, list, lounge, loungeBreaks, managerId, managerVisit, activeRpsMatch, gameAnimation, now } = inp;
  const working = inp.working ?? new Set<string>();
  const out: Record<string, Target> = {};
  for (const id in layout.poses) out[id] = layout.poses[id]!;
  let loungeAssign = inp.prevLoungeAssign;

  // Idle visits (colleague desk / whiteboard). Slots per destination so visitors don't stack.
  const slots = new Map<string, number>();
  for (const a of list) {
    if (a.role !== "worker" || !isVisiting(a, now) || a.lounging || loungeBreaks.has(a.id) || working.has(a.id)) continue;
    const dest = a.visiting!.targetAgentId ? `a:${a.visiting!.targetAgentId}` : `s:${a.visiting!.spaceId}`;
    const slot = slots.get(dest) ?? 0;
    const t = visitTarget(a, layout, slot);
    if (!t) continue;
    slots.set(dest, slot + 1);
    out[a.id] = t;
  }

  if (lounge) {
    const loungeAgentIds: string[] = [];
    for (const [id] of loungeBreaks) loungeAgentIds.push(id);
    for (const a of list) {
      if (loungeBreaks.has(a.id)) continue;
      if (a.lounging && a.role === "worker" && !working.has(a.id)) { loungeAgentIds.push(a.id); continue; }
      // Crashes faint in the lounge; a limit walks to the Manager's desk (below).
      if (isFaintedCrash(a)) loungeAgentIds.push(a.id);
    }
    if (loungeAgentIds.length > 0) {
      const loungeLayout = loungeSpots(Math.max(16, loungeAgentIds.length + 2), undefined, loungeDoorAngle(layout.spaces, lounge));
      loungeAssign = assignLoungeSpots(loungeAgentIds, loungeLayout.spots, inp.prevLoungeAssign);
      for (const agentId of loungeAgentIds) {
        const spotId = loungeAssign[agentId];
        const spot = spotId ? loungeLayout.spots.find((sp) => sp.id === spotId) : undefined;
        if (!spot) continue;
        out[agentId] = { x: lounge.x + spot.x, z: lounge.z + spot.z, yaw: spot.yaw, yOffset: spot.seatHeight };
      }
    } else {
      loungeAssign = {};
    }
  }

  // Working agents sit at their designated desk (the server moves them there too; this covers a stale copy).
  for (const a of list) {
    if (a.role !== "worker" || !working.has(a.id) || loungeBreaks.has(a.id) || isFaintedCrash(a)) continue;
    const t = workSeatTarget(a, layout.spaces);
    if (t) out[a.id] = t;
  }

  // Manager walks to a fainted agent while it is being revived.
  if (managerId && lounge && !managerVisit) {
    const fainting = list.find((a) => agentRevivePhase(a) === "reviving" && isFaintedCrash(a));
    const agentPos = fainting ? out[fainting.id] : undefined;
    if (agentPos) {
      const p = { x: agentPos.x + 0.6, z: agentPos.z };
      out[managerId] = { ...p, yaw: yawToward(p, agentPos) };
    }
  }

  // Limit reports: the agent walks to the Manager's desk and stands there until the switch is decided
  // ("switching" is not overridden: it walks back to its seat). The Manager turns to face the first one.
  const office = layout.spaces.find((s) => s.kind === "office");
  if (office) {
    let slot = 0;
    let first: Target | undefined;
    for (const a of list) {
      const w = limitWalk(a);
      if (!w || w.phase === "switching") continue;
      const t = reportSpot(office, slot++);
      out[a.id] = t;
      first ??= t;
    }
    const mPose = managerId ? layout.poses[managerId] : undefined;
    if (managerId && first && mPose && !managerVisit) out[managerId] = { ...mPose, yaw: yawToward(mPose, first) };
  }

  // Manager task visits.
  if (managerId && managerVisit) {
    const p = layout.placements[managerVisit];
    const s = p && layout.spaces.find((o) => o.id === p.space);
    if (s && p) out[managerId] = visitPose(s, p.seat);
  }

  // RPS game.started: both players walk to their game spots, facing each other.
  if (activeRpsMatch && lounge) {
    const gameLayout = loungeSpots();
    for (let i = 0; i < 2; i++) {
      const playerId = activeRpsMatch.players[i]!;
      const spotId = activeRpsMatch.spotIds[i]!;
      for (const [gsa, gsb] of gameLayout.gameSpots) {
        const gs = gsa.id === spotId ? gsa : gsb.id === spotId ? gsb : null;
        if (gs) {
          out[playerId] = { x: lounge.x + gs.x, z: lounge.z + gs.z, yaw: gs.yaw, yOffset: 0 };
          break;
        }
      }
    }
  }

  // RPS game.result: the players face each other for the badge (~3 s).
  if (gameAnimation && now - gameAnimation.at < 3000) {
    const [playerA, playerB] = gameAnimation.match.players;
    const posA = out[playerA];
    const posB = out[playerB];
    if (posA && posB) {
      const { yawA, yawB } = rpsFacing(posA, posB);
      out[playerA] = { ...posA, yaw: yawA };
      out[playerB] = { ...posB, yaw: yawB };
    }
  }

  return { targets: out, loungeAssign };
}
