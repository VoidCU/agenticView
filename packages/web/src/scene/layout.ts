import type { Agent } from "@agenticview/shared";

export type Zone = "podium" | "desk" | "lobby";
export interface Spot {
  x: number;
  z: number;
  zone: Zone;
}

export const LOBBY_Z = -9;
export const LOBBY_SPACING = 2.2;

export function ringRadius(count: number): number {
  return 4 + 0.4 * count;
}

function ringSpot(index: number, count: number): { x: number; z: number } {
  const r = ringRadius(count);
  const angle = -Math.PI / 2 + (index * 2 * Math.PI) / count;
  return { x: r * Math.cos(angle), z: r * Math.sin(angle) };
}

function byCreation(a: Agent, b: Agent): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

/**
 * Desk positions: manager on the podium at the origin, project workers on a ring
 * whose radius grows with head-count, global workers on the lobby row at z=-9.
 */
export function layoutFor(agents: Agent[]): Record<string, Spot> {
  const out: Record<string, Spot> = {};
  const managers = agents.filter((a) => a.role === "manager");
  const project = agents.filter((a) => a.role === "worker" && a.scope === "project").sort(byCreation);
  const global = agents.filter((a) => a.role === "worker" && a.scope === "global").sort(byCreation);

  managers.forEach((m, i) => {
    out[m.id] = { x: i * 1.6, z: 0, zone: "podium" };
  });
  project.forEach((w, i) => {
    out[w.id] = { ...ringSpot(i, project.length), zone: "desk" };
  });
  const width = (global.length - 1) * LOBBY_SPACING;
  global.forEach((w, i) => {
    out[w.id] = { x: -width / 2 + i * LOBBY_SPACING, z: LOBBY_Z, zone: "lobby" };
  });
  return out;
}

/** Where the next project worker's desk would be: the last slot of a ring one larger. */
export function nextDeskFor(agents: Agent[]): Spot {
  const n = agents.filter((a) => a.role === "worker" && a.scope === "project").length;
  return { ...ringSpot(n, n + 1), zone: "desk" };
}

/** Where the next global worker would stand in the lobby. */
export function nextLobbyFor(agents: Agent[]): Spot {
  const n = agents.filter((a) => a.role === "worker" && a.scope === "global").length;
  const width = n * LOBBY_SPACING;
  return { x: -width / 2 + n * LOBBY_SPACING, z: LOBBY_Z, zone: "lobby" };
}
