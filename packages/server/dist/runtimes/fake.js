/**
 * Scripted runtime for tests and demo mode. `call` items invoke the run's bridge tools for real,
 * so orchestration tests exercise the actual Manager tool handlers.
 */
export class FakeRuntime {
    script;
    provider;
    runs = [];
    constructor(script, provider = "claude") {
        this.script = script;
        this.provider = provider;
    }
    async check() {
        return { provider: this.provider, ok: true, version: "fake" };
    }
    async run(req, sink, signal) {
        this.runs.push(req);
        let text = "";
        let onAbort;
        const aborted = new Promise((_, rej) => {
            onAbort = () => rej(new Error("aborted"));
            if (signal.aborted)
                onAbort();
            else
                signal.addEventListener("abort", onAbort, { once: true });
        });
        aborted.catch(() => undefined);
        try {
            const it = this.script(req)[Symbol.asyncIterator]();
            for (;;) {
                const { value, done } = await Promise.race([it.next(), aborted]);
                if (done)
                    break;
                if (value.type === "call") {
                    const tool = req.bridgeTools.find((t) => t.name === value.tool);
                    sink({ type: "tool_start", name: value.tool, input: value.args });
                    if (!tool) {
                        sink({ type: "tool_end", name: value.tool, ok: false, summary: "unknown tool" });
                        continue;
                    }
                    try {
                        const out = await Promise.race([tool.handler(value.args), aborted]);
                        sink({ type: "tool_end", name: value.tool, ok: true, summary: out.slice(0, 200) });
                    }
                    catch (e) {
                        if (signal.aborted)
                            throw e;
                        sink({ type: "tool_end", name: value.tool, ok: false, summary: e.message });
                    }
                }
                else {
                    if (value.type === "text")
                        text += value.text;
                    sink(value);
                }
            }
            return { text, stopReason: "done", sessionId: req.sessionId ?? `fake-${req.runId}` };
        }
        catch (e) {
            if (signal.aborted)
                return { text, stopReason: "aborted" };
            return { text, stopReason: "error", error: e.message };
        }
        finally {
            if (onAbort)
                signal.removeEventListener("abort", onAbort);
        }
    }
}
//# sourceMappingURL=fake.js.map