import type { Provider } from "@agenticview/shared";
import type { WorldRef } from "./agents/registry.js";
import type { Runtime, BridgeTool } from "./runtimes/types.js";
import { EventBus } from "./events/bus.js";
import { type World } from "./world.js";
import type { Agent, Task } from "@agenticview/shared";
import type { Orchestrator } from "./manager/orchestrator.js";
export interface ServerOptions {
    world: WorldRef;
    token: string;
    port?: number;
    runtimes?: Map<Provider, Runtime>;
    staticDir?: string;
    openProject?: (path: string) => Promise<string>;
    workerTools?: (agent: Agent, task: Task) => BridgeTool[];
}
export interface RunningServer {
    url: string;
    port: number;
    token: string;
    world: World;
    orchestrator: Orchestrator;
    bus: EventBus;
    close(): Promise<void>;
}
/** Boot one world (project or hub) behind a localhost, token-guarded HTTP + WebSocket server. */
export declare function createServer(opts: ServerOptions): Promise<RunningServer>;
