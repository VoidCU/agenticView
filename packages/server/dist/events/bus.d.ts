import type { ServerMessage } from "@agenticview/shared";
export type BusListener = (m: ServerMessage) => void;
/** In-process fan-out of server messages; the WebSocket layer subscribes once per client. */
export declare class EventBus {
    private readonly listeners;
    on(fn: BusListener): () => void;
    emit(m: ServerMessage): void;
}
