import type { AgentPosition } from "./positions";

export interface MapPoint { agentId: string; x: number; z: number; spaceId: string; activity: AgentPosition["activity"]; live: boolean }

/** Resolve a live position only when its room still exists; otherwise preserve the desk fallback. */
export function resolveMapPoint(
  agentId: string,
  live: AgentPosition | undefined,
  fallback: { x: number; z: number; spaceId: string } | undefined,
  validSpaceIds: ReadonlySet<string>,
): MapPoint | undefined {
  if (live?.spaceId && validSpaceIds.has(live.spaceId)) return { agentId, x: live.x, z: live.z, spaceId: live.spaceId, activity: live.activity, live: true };
  if (fallback && validSpaceIds.has(fallback.spaceId)) return { agentId, ...fallback, activity: "desk", live: false };
  return undefined;
}

export function roomOccupancy(points: readonly MapPoint[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const point of points) counts.set(point.spaceId, (counts.get(point.spaceId) ?? 0) + 1);
  return counts;
}

/** Nudge coincident/nearby dots apart without moving them outside their room. */
export function spreadRoomPoints<T extends { x: number; y: number }>(
  points: readonly T[], center: { x: number; y: number }, radius: number, minimumGap = 5,
): Array<T & { x: number; y: number }> {
  const placed: Array<T & { x: number; y: number }> = [];
  const directions = 12;
  for (const point of points) {
    let candidate = { ...point };
    const collides = (x: number, y: number) => placed.some((p) => Math.hypot(p.x - x, p.y - y) < minimumGap);
    if (collides(candidate.x, candidate.y)) {
      let found = false;
      for (let r = minimumGap; r <= radius && !found; r += minimumGap) {
        for (let i = 0; i < directions; i++) {
          const angle = (Math.PI * 2 * i) / directions;
          const x = point.x + Math.cos(angle) * r;
          const y = point.y + Math.sin(angle) * r;
          if (Math.hypot(x - center.x, y - center.y) <= radius && !collides(x, y)) {
            candidate = { ...point, x, y };
            found = true;
            break;
          }
        }
      }
    }
    placed.push(candidate);
  }
  return placed;
}

export function activityLabel(activity: AgentPosition["activity"]): string {
  return activity === "desk" ? "At desk" : activity === "break" ? "On a break" : activity === "fainted" ? "Fainted" : activity === "walking" ? "Walking" : activity === "meeting" ? "In a meeting" : activity === "waiting" ? "Waiting" : "In the lounge";
}
