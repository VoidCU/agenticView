import type { Role } from "./agent.js";
import type { TaskKind } from "./task.js";

export function xpFor(kind: TaskKind, role: Role): number {
  if (role === "worker") return kind === "work" ? 10 : kind === "chat" ? 2 : 0;
  return kind === "request" ? 5 : 0;
}

export function levelFor(xp: number): number {
  return Math.floor(Math.sqrt(xp / 25)) + 1;
}
