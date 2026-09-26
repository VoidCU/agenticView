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
    recordFailure(agent: Agent, provider: Provider, model: string, errorText: string): LimitInfo;
    recordSuccess(agent: Agent, provider: Provider, model: string): void;
    getProviderLimit(provider: Provider): LimitInfo;
    clearProviderLimit(provider: Provider): void;
    getLimitsReport(): LimitsReport;
    getModelLimits(provider: Provider, model: string): ProviderModelLimits;
    getUsageReport(): UsageReport;
}
