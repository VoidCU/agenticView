import { type Agent, type LimitInfo, type LimitsReport, type Provider, type ProviderModelLimits, type RawRateLimits, type UsageReport } from "@agenticview/shared";
/** Rate-limit window as posted by a Claude Code session worker. */
export interface ClaudeRateLimitWindow {
    used_percentage: number;
    resets_at?: number;
}
export interface RunUsageRecord {
    runId: string;
    taskId: string;
    agentId: string;
    provider: Provider;
    model: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    timestamp: string;
}
export declare class UsageTracker {
    private readonly root;
    private readonly file;
    private readonly sessionStartTime;
    private runs;
    private rateLimits;
    private providerLimits;
    /** Keyed by "${sessionId}:${model}"; latest rate limits posted by a Claude Code session. */
    private claudeSessionLimits;
    private saveChain;
    constructor(root: string, sessionStartTime?: number);
    init(): Promise<void>;
    private persist;
    recordRun(run: RunUsageRecord): Promise<void>;
    recordRateLimits(provider: Provider, model: string, raw?: RawRateLimits): ProviderModelLimits | undefined;
    /**
     * Store rate limits posted by a Claude Code session worker via POST /api/claude-limits.
     * Returns the built ProviderModelLimits entry.
     */
    recordClaudeLimits(sessionId: string, model: string, rateLimits: {
        five_hour?: ClaudeRateLimitWindow;
        seven_day?: ClaudeRateLimitWindow;
    }): ProviderModelLimits;
    /** All model limits reported by a specific Claude Code session, keyed by model string. */
    getSessionModelLimits(sessionId: string): Record<string, ProviderModelLimits>;
    /** Aggregate claude-session limits across all sessions: most recently updated entry per model. */
    private getClaudeSessionAggregateModels;
    /**
     * Records a failed run. Only quota and rate-limit failures mark the provider (and the agent's
     * chip) as LIMITED: a crash or auth error says nothing about the provider's remaining quota, and
     * marking those limited left "LIMITED" chips stuck on agents after unrelated failures.
     */
    recordFailure(agent: Agent, provider: Provider, model: string, errorText: string): LimitInfo | undefined;
    recordSuccess(agent: Agent, provider: Provider, model: string): void;
    getProviderLimit(provider: Provider): LimitInfo;
    clearProviderLimit(provider: Provider): void;
    /** Built-in and registered custom providers, plus any provider that appears in recorded runs (e.g. a removed custom one). */
    private knownProviders;
    getLimitsReport(): LimitsReport;
    getModelLimits(provider: Provider, model: string): ProviderModelLimits;
    getUsageReport(): UsageReport;
}
