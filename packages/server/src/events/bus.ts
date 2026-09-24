import type { ServerMessage } from "@agenticview/shared";

export type BusListener = (m: ServerMessage) => void;

/** In-process fan-out of server messages; the WebSocket layer subscribes once per client. */
export class EventBus {
  private readonly listeners = new Set<BusListener>();

  on(fn: BusListener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  emit(m: ServerMessage): void {
    for (const fn of [...this.listeners]) {
      try {
        fn(m);
      } catch (e) {
        console.error("[agenticview] bus listener failed", e);
      }
    }
  }
}
