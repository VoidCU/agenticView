import type { Provider, ProviderStatus, RunEvent, RunResult } from "@agenticview/shared";
import type { EventSink, Runtime, RunRequest } from "./types.js";
export type FakeItem = RunEvent | {
    type: "call";
    tool: string;
    args: Record<string, unknown>;
};
export type FakeScript = (req: RunRequest) => AsyncIterable<FakeItem>;
/**
 * Scripted runtime for tests and demo mode. `call` items invoke the run's bridge tools for real,
 * so orchestration tests exercise the actual Manager tool handlers.
 */
export declare class FakeRuntime implements Runtime {
    private readonly script;
    readonly provider: Provider;
    readonly runs: RunRequest[];
    constructor(script: FakeScript, provider?: Provider);
    check(): Promise<ProviderStatus>;
    run(req: RunRequest, sink: EventSink, signal: AbortSignal): Promise<RunResult>;
}
