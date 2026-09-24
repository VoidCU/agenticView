/** In-process fan-out of server messages; the WebSocket layer subscribes once per client. */
export class EventBus {
    listeners = new Set();
    on(fn) {
        this.listeners.add(fn);
        return () => {
            this.listeners.delete(fn);
        };
    }
    emit(m) {
        for (const fn of [...this.listeners]) {
            try {
                fn(m);
            }
            catch (e) {
                console.error("[agenticview] bus listener failed", e);
            }
        }
    }
}
//# sourceMappingURL=bus.js.map