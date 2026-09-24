import { type Agent, type Task, type WorldInfo } from "@agenticview/shared";
/** Fresh, authoritative roster + open-task map injected at the top of every Manager turn. */
export declare function buildRosterPreamble(world: WorldInfo, agents: Agent[], tasks: Task[]): string;
