import { type Agent, type LimitInfo, type LimitsReport, type Provider, type ProviderModelLimits, type RawRateLimits, type UsageReport } from "@agenticview/shared";
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
    private saveChain;
    constructor(root: string, sessionStartTime?: number);
    init(): Promise<void>;
    private persist;
    recordRun(run: RunUsageRecord): Promise<void>;
    recordRateLimits(provider: Provider, model: string, raw?: RawRateLimits): ProviderModelLimits | undefined;
    recordFailure(agent: Agent, provider: Provider, model: string, errorText: string): LimitInfo;
    recordSuccess(agent: Agent, provider: Provider, model: string): void;
    getProviderLimit(provider: Provider): LimitInfo;
    clearProviderLimit(provider: Provider): void;
    getLimitsReport(): LimitsReport;
    getModelLimits(provider: Provider, model: string): ProviderModelLimits;
    getUsageReport(): UsageReport;
}
