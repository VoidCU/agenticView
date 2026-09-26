import { assignLoungeSpots, loungeSpots, rpsFacing, visitPose, yawToward, type Agent, type Match, type Space } from "@agenticview/shared";
import type { OfficeLayout } from "./layout";
import type { LoungeBreak } from "./breaks";
import { agentRevivePhase } from "./breaks";
import { whiteboardPose } from "./Whiteboard";

export interface Target {
  x: number;
  z: number;
  yaw: number;
  yOffset?: number;
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
    if (space && space.kind !== "lounge") {
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
  now: number;
}

/**
 * Every agent's current walk target. Priority (later wins): resting pose < idle visit < lounge / faint
 * < manager walks < RPS match < RPS result facing. Pure: the scene memoises it on its inputs.
 */
export function computeTargets(inp: TargetInputs): { targets: Record<string, Target>; loungeAssign: Record<string, string> } {
  const { layout, list, lounge, loungeBreaks, managerId, managerVisit, activeRpsMatch, gameAnimation, now } = inp;
  const out: Record<string, Target> = {};
  for (const id in layout.poses) out[id] = layout.poses[id]!;
  let loungeAssign = inp.prevLoungeAssign;

  // Idle visits (colleague desk / whiteboard). Slots per destination so visitors don't stack.
  const slots = new Map<string, number>();
  for (const a of list) {
    if (a.role !== "worker" || !isVisiting(a, now) || a.lounging || loungeBreaks.has(a.id)) continue;
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
      if (a.lounging && a.role === "worker") { loungeAgentIds.push(a.id); continue; }
      const phase = agentRevivePhase(a);
      if (phase === "fainted" || phase === "reviving") loungeAgentIds.push(a.id);
    }
    if (loungeAgentIds.length > 0) {
      const loungeLayout = loungeSpots(Math.max(16, loungeAgentIds.length + 2));
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

  // Manager walks to a fainted agent while it is being revived.
  if (managerId && lounge && !managerVisit) {
    const fainting = list.find((a) => agentRevivePhase(a) === "reviving");
    const agentPos = fainting ? out[fainting.id] : undefined;
    if (agentPos) {
      const p = { x: agentPos.x + 0.6, z: agentPos.z };
      out[managerId] = { ...p, yaw: yawToward(p, agentPos) };
    }
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
