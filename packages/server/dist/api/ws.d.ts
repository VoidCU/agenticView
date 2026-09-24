import type { Server as HttpServer } from "node:http";
import type { World } from "../world.js";
export interface WsOptions {
    token: string;
    world: World;
    /** Hub only: open a project world and return its URL. */
    openProject?: (path: string) => Promise<string>;
}
/** Attach the /ws endpoint: token-guarded upgrade, snapshot on connect, bus fan-out, command dispatch. */
export declare function attachWs(server: HttpServer, opts: WsOptions): {
    close(): Promise<void>;
};
