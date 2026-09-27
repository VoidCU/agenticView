import type { PermissionMode, Provider, ProviderStatus, RunEvent, RunResult, ToolAllowance } from "@agenticview/shared";
import type { Codex as CodexClass, ThreadEvent, SandboxMode } from "@openai/codex-sdk";
import type { EventSink, Runtime, RunRequest } from "./types.js";
import { type Which } from "./which.js";
export interface CodexSdk {
    Codex: typeof CodexClass;
}
export interface CodexCustomEndpoint {
    /** Provider id this runtime serves ("custom:<slug>"). */
    provider: Provider;
    /** Display name (model_providers.<id>.name). */
    name: string;
    baseUrl: string;
    apiKey?: string;
    /** Model used when the agent sets none. */
    defaultModel?: string | null;
}
export interface CodexRuntimeOptions {
    sdk?: CodexSdk;
    /** Run against a custom OpenAI-compatible endpoint instead of OpenAI (engine "openai" custom providers). */
    custom?: CodexCustomEndpoint;
    bridgeEntry: string;
    bridgeUrl: () => string;
    apiKey?: string;
    which?: Which;
}
export declare const CODEX_MISSING_REASON = "Install the Codex CLI (npm i -g @openai/codex) and sign in with `codex login` or set CODEX_API_KEY.";
/**
 * Permission mode → Codex sandbox. `ask` cannot prompt through the SDK, so it is read-only (the most
 * restrictive setting). Codex's Windows sandbox cannot write files, so `auto-edit` needs full access there.
 */
export declare function sandboxFor(mode: PermissionMode, platform?: NodeJS.Platform, tools?: ToolAllowance): SandboxMode;
/** Pure mapping from Codex thread events to RunEvents. `started` tracks tool items that already emitted tool_start. */
export declare function mapCodexEvent(ev: ThreadEvent, started: Set<string>): RunEvent[];
export declare class CodexRuntime implements Runtime {
    private readonly opts;
    readonly provider: Provider;
    private sdk?;
    private readonly which;
    constructor(opts: CodexRuntimeOptions);
    check(): Promise<ProviderStatus>;
    private loadSdk;
    run(req: RunRequest, sink: EventSink, signal: AbortSignal): Promise<RunResult>;
}
/** ThreadOptions for a run: sandbox, plus model and `modelReasoningEffort` when the agent sets them. */
export declare function codexThreadOptions(req: RunRequest, platform: NodeJS.Platform): Record<string, unknown>;
/** Env var a custom endpoint's key is passed in (model_providers.<id>.env_key); only ever in the child env. */
export declare const CUSTOM_KEY_ENV = "AGENTICVIEW_CUSTOM_KEY";
/** Codex config-table id for a custom provider ("custom:my-llm" -> "agenticview_my_llm"). */
export declare function codexProviderId(provider: string): string;
/**
 * Child env and `--config` overrides for one Codex run. For a custom OpenAI-compatible endpoint the
 * overrides define `model_providers.<id>` (Responses API; codex 0.156 dropped the chat wire API) and select
 * it with `model_provider`, so the user's ~/.codex config and login stay untouched. Keys go to the child
 * env only, never into this process's env.
 */
export declare function codexEnvAndConfig(base: NodeJS.ProcessEnv, opts: Pick<CodexRuntimeOptions, "apiKey" | "custom">): {
    env: Record<string, string>;
    config: Record<string, unknown>;
};
