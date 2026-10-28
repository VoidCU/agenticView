import type { Provider } from "@agenticview/shared";
import type { WorldRef } from "./agents/registry.js";
import type { Runtime, BridgeTool } from "./runtimes/types.js";
import { EventBus } from "./events/bus.js";
import { type World } from "./world.js";
import type { Agent, Task } from "@agenticview/shared";
import type { Orchestrator } from "./manager/orchestrator.js";
import { MailAccounts } from "./mail/accounts.js";
import { OAuthFlow } from "./mail/oauth.js";
export interface ServerOptions {
    world: WorldRef;
    token: string;
    port?: number;
    runtimes?: Map<Provider, Runtime>;
    staticDir?: string;
    openProject?: (path: string) => Promise<string>;
    workerTools?: (agent: Agent, task: Task) => BridgeTool[];
    /** Called after an authenticated POST /api/shutdown has been answered (the CLI's `close`). */
    onShutdown?: () => void;
    /** fetch used for Google OAuth/Gmail calls (tests inject a fake). Defaults to global fetch. */
    mailFetch?: typeof fetch;
}
export interface RunningServer {
    url: string;
    port: number;
    token: string;
    world: World;
    orchestrator: Orchestrator;
    bus: EventBus;
    /** Global Gmail accounts and this server's OAuth flow (its loopback callback points at this port). */
    mail: {
        accounts: MailAccounts;
        flow: OAuthFlow;
    };
    close(): Promise<void>;
}
/** Boot one world (project or hub) behind a localhost, token-guarded HTTP + WebSocket server. */
export declare function createServer(opts: ServerOptions): Promise<RunningServer>;
