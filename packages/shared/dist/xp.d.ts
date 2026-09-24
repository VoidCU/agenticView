import type { Role } from "./agent.js";
import type { TaskKind } from "./task.js";
export declare function xpFor(kind: TaskKind, role: Role): number;
export declare function levelFor(xp: number): number;
