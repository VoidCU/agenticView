import type { Provider, ProviderStatus, RunEvent, RunResult } from "@agenticview/shared";
import type { EventSink, Runtime, RunRequest } from "./types.js";

export type FakeItem = RunEvent | { type: "call"; tool: string; args: Record<string, unknown> };
export type FakeScript = (req: RunRequest) => AsyncIterable<FakeItem>;

/**
 * Scripted runtime for tests and demo mode. `call` items invoke the run's bridge tools for real,
 * so orchestration tests exercise the actual Manager tool handlers.
 */
export class FakeRuntime implements Runtime {
  readonly runs: RunRequest[] = [];

  constructor(
    private readonly script: FakeScript,
    readonly provider: Provider = "claude",
  ) {}

  async check(): Promise<ProviderStatus> {
    return { provider: this.provider, ok: true, version: "fake" };
  }

  async run(req: RunRequest, sink: EventSink, signal: AbortSignal): Promise<RunResult> {
    this.runs.push(req);
    let text = "";
    let onAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_, rej) => {
      onAbort = () => rej(new Error("aborted"));
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    });
    aborted.catch(() => undefined);
    try {
      const it = this.script(req)[Symbol.asyncIterator]();
      for (;;) {
        const { value, done } = await Promise.race([it.next(), aborted]);
        if (done) break;
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
          } catch (e) {
            if (signal.aborted) throw e;
            sink({ type: "tool_end", name: value.tool, ok: false, summary: (e as Error).message });
          }
        } else {
          if (value.type === "text") text += value.text;
          sink(value);
        }
      }
      return { text, stopReason: "done", sessionId: req.sessionId ?? `fake-${req.runId}` };
    } catch (e) {
      if (signal.aborted) return { text, stopReason: "aborted" };
      return { text, stopReason: "error", error: (e as Error).message };
    } finally {
      if (onAbort) signal.removeEventListener("abort", onAbort);
    }
  }
}
