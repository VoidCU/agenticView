import { join } from "node:path";
import { PROVIDER_ORDER, } from "@agenticview/shared";
import { readJsonFile, writeJsonFile } from "../store/jsonStore.js";
import { classifyError, isLimitActive, parseResetAt } from "../runtimes/errors.js";
import { z } from "zod";
const PersistedUsageSchema = z.object({
    runs: z.array(z.object({
        runId: z.string(),
        taskId: z.string(),
        agentId: z.string(),
        provider: z.string(),
        model: z.string(),
        inputTokens: z.number().int().min(0),
        outputTokens: z.number().int().min(0),
        totalTokens: z.number().int().min(0),
        timestamp: z.string(),
    })).default([]),
    rateLimits: z.record(z.string(), z.object({
        provider: z.string(),
        model: z.string(),
        fiveHour: z.any(),
        weekly: z.any(),
        updatedAt: z.string(),
    })).default({}),
    providerLimits: z.record(z.string(), z.object({
        limited: z.boolean(),
        errorType: z.enum(["quota", "rate-limit", "auth", "crash"]).optional(),
        reason: z.string().optional(),
        resetAt: z.string().optional(),
    })).default({}),
    /** Keyed by "${sessionId}:${model}"; stores the latest limits posted by a Claude Code session. */
    claudeSessionLimits: z.record(z.string(), z.object({
        provider: z.string(),
        model: z.string(),
        fiveHour: z.any(),
        weekly: z.any(),
        updatedAt: z.string(),
    })).default({}),
});
export class UsageTracker {
    root;
    file;
    sessionStartTime;
    runs = [];
    rateLimits = new Map();
    providerLimits = new Map();
    /** Keyed by "${sessionId}:${model}"; latest rate limits posted by a Claude Code session. */
    claudeSessionLimits = new Map();
    saveChain = Promise.resolve();
    constructor(root, sessionStartTime = Date.now()) {
        this.root = root;
        this.file = join(this.root, "usage.json");
        this.sessionStartTime = sessionStartTime;
    }
    async init() {
        try {
            const data = await readJsonFile(this.file, PersistedUsageSchema, {
                runs: [],
                rateLimits: {},
                providerLimits: {},
                claudeSessionLimits: {},
            });
            const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
            this.runs = data.runs.filter((r) => new Date(r.timestamp).getTime() >= cutoff);
            for (const [k, v] of Object.entries(data.rateLimits)) {
                this.rateLimits.set(k, v);
            }
            for (const [p, lim] of Object.entries(data.providerLimits)) {
                if (isLimitActive(lim)) {
                    this.providerLimits.set(p, lim);
                }
            }
            for (const [k, v] of Object.entries(data.claudeSessionLimits)) {
                this.claudeSessionLimits.set(k, v);
            }
        }
        catch {
            this.runs = [];
            this.rateLimits.clear();
            this.providerLimits.clear();
            this.claudeSessionLimits.clear();
        }
    }
    persist() {
        const data = {
            runs: this.runs,
            rateLimits: Object.fromEntries(this.rateLimits.entries()),
            providerLimits: Object.fromEntries(this.providerLimits.entries()),
            claudeSessionLimits: Object.fromEntries(this.claudeSessionLimits.entries()),
        };
        const next = this.saveChain.then(() => writeJsonFile(this.file, data)).catch(() => undefined);
        this.saveChain = next;
        return next;
    }
    async recordRun(run) {
        this.runs.push(run);
        const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
        if (this.runs.length > 5000 || (this.runs.length > 0 && new Date(this.runs[0].timestamp).getTime() < cutoff)) {
            this.runs = this.runs.filter((r) => new Date(r.timestamp).getTime() >= cutoff);
        }
        await this.persist();
    }
    recordRateLimits(provider, model, raw) {
        if (!raw)
            return undefined;
        const now = new Date().toISOString();
        const parseWindow = (w, defaultMinutes = 300) => {
            if (!w || w.used_percent === undefined) {
                return { status: "not reported" };
            }
            const used = Math.max(0, Math.min(100, Math.round(w.used_percent)));
            const percentLeft = Math.max(0, Math.min(100, 100 - used));
            const rawReset = w.resets_at ?? w.reset_at;
            let resetAt;
            if (typeof rawReset === "number") {
                const ms = rawReset > 1e11 ? rawReset : rawReset * 1000;
                resetAt = new Date(ms).toISOString();
            }
            else if (typeof rawReset === "string") {
                resetAt = parseResetAt(rawReset) ?? rawReset;
            }
            return {
                status: "reported",
                percentLeft,
                usedPercent: used,
                resetAt,
                windowMinutes: w.window_minutes ?? defaultMinutes,
            };
        };
        const fiveHour = parseWindow(raw.primary, 300);
        const weekly = parseWindow(raw.secondary, 10080);
        const limits = {
            provider,
            model,
            fiveHour,
            weekly,
            updatedAt: now,
        };
        const key = `${provider}:${model}`;
        this.rateLimits.set(key, limits);
        // If 100% of either window is used, mark provider as limited
        if ((fiveHour.status === "reported" && fiveHour.percentLeft <= 0) ||
            (weekly.status === "reported" && weekly.percentLeft <= 0)) {
            const resetAt = (fiveHour.status === "reported" ? fiveHour.resetAt : undefined) ?? (weekly.status === "reported" ? weekly.resetAt : undefined);
            this.providerLimits.set(provider, {
                limited: true,
                errorType: "rate-limit",
                reason: `Rate limit reached for ${provider}/${model}`,
                resetAt,
            });
        }
        void this.persist();
        return limits;
    }
    /**
     * Store rate limits posted by a Claude Code session worker via POST /api/claude-limits.
     * Returns the built ProviderModelLimits entry.
     */
    recordClaudeLimits(sessionId, model, rateLimits) {
        const now = new Date().toISOString();
        const parseWindow = (w) => {
            if (!w)
                return { status: "not reported" };
            const usedPercent = Math.max(0, Math.min(100, Math.round(w.used_percentage)));
            const percentLeft = Math.max(0, 100 - usedPercent);
            let resetAt;
            if (typeof w.resets_at === "number" && w.resets_at > 0) {
                const ms = w.resets_at > 1e11 ? w.resets_at : w.resets_at * 1000;
                resetAt = new Date(ms).toISOString();
            }
            const warning = usedPercent >= 80;
            return { status: "reported", usedPercent, percentLeft, resetAt, ...(warning ? { warning } : {}) };
        };
        const fiveHour = parseWindow(rateLimits.five_hour);
        const weekly = parseWindow(rateLimits.seven_day);
        const limits = {
            provider: "claude-session",
            model,
            fiveHour,
            weekly,
            updatedAt: now,
        };
        const key = `${sessionId}:${model}`;
        this.claudeSessionLimits.set(key, limits);
        // Mark provider as limited when a window is fully consumed.
        if ((fiveHour.status === "reported" && fiveHour.percentLeft <= 0) ||
            (weekly.status === "reported" && weekly.percentLeft <= 0)) {
            const resetAt = (fiveHour.status === "reported" ? fiveHour.resetAt : undefined) ??
                (weekly.status === "reported" ? weekly.resetAt : undefined);
            this.providerLimits.set("claude-session", {
                limited: true,
                errorType: "rate-limit",
                reason: `Rate limit reached for claude-session/${model}`,
                resetAt,
            });
        }
        void this.persist();
        return limits;
    }
    /** All model limits reported by a specific Claude Code session, keyed by model string. */
    getSessionModelLimits(sessionId) {
        const result = {};
        const prefix = `${sessionId}:`;
        for (const [key, limits] of this.claudeSessionLimits.entries()) {
            if (key.startsWith(prefix)) {
                result[limits.model] = limits;
            }
        }
        return result;
    }
    /** Aggregate claude-session limits across all sessions: most recently updated entry per model. */
    getClaudeSessionAggregateModels() {
        const byModel = new Map();
        for (const limits of this.claudeSessionLimits.values()) {
            const existing = byModel.get(limits.model);
            if (!existing || limits.updatedAt > existing.updatedAt) {
                byModel.set(limits.model, limits);
            }
        }
        return Object.fromEntries(byModel.entries());
    }
    recordFailure(agent, provider, model, errorText) {
        const errorType = classifyError(errorText);
        const resetAt = parseResetAt(errorText);
        const limitInfo = {
            limited: true,
            errorType,
            reason: errorText,
            resetAt,
        };
        // Mark the provider as limited
        this.providerLimits.set(provider, limitInfo);
        void this.persist();
        return limitInfo;
    }
    recordSuccess(agent, provider, model) {
        // If provider was previously limited, check if it should be cleared
        const current = this.providerLimits.get(provider);
        if (current && (!current.resetAt || new Date(current.resetAt).getTime() <= Date.now())) {
            this.providerLimits.delete(provider);
            void this.persist();
        }
    }
    getProviderLimit(provider) {
        const lim = this.providerLimits.get(provider);
        if (!lim)
            return { limited: false };
        if (!isLimitActive(lim)) {
            this.providerLimits.delete(provider);
            void this.persist();
            return { limited: false };
        }
        return lim;
    }
    clearProviderLimit(provider) {
        this.providerLimits.delete(provider);
        void this.persist();
    }
    getLimitsReport() {
        const now = new Date().toISOString();
        const providers = {};
        for (const p of PROVIDER_ORDER) {
            const limit = this.getProviderLimit(p);
            const models = {};
            for (const [, modelLimit] of this.rateLimits.entries()) {
                if (modelLimit.provider === p) {
                    models[modelLimit.model] = modelLimit;
                }
            }
            // For claude-session, also merge in limits reported directly by session workers.
            if (p === "claude-session") {
                for (const [model, limEntry] of Object.entries(this.getClaudeSessionAggregateModels())) {
                    if (!models[model] || limEntry.updatedAt > models[model].updatedAt) {
                        models[model] = limEntry;
                    }
                }
            }
            providers[p] = {
                limit,
                models,
            };
        }
        return {
            providers,
            updatedAt: now,
        };
    }
    getModelLimits(provider, model) {
        const key = `${provider}:${model}`;
        const found = this.rateLimits.get(key);
        if (found)
            return found;
        // Only Codex exposes 5-hour and weekly windows.
        // Antigravity (agy), Claude Code, and Gemini expose nothing, so report "not reported".
        return {
            provider,
            model,
            fiveHour: { status: "not reported" },
            weekly: { status: "not reported" },
            updatedAt: new Date().toISOString(),
        };
    }
    getUsageReport() {
        const now = Date.now();
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayStart = today.getTime();
        const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
        const calcBucket = (runs) => {
            let inputTokens = 0;
            let outputTokens = 0;
            for (const r of runs) {
                inputTokens += r.inputTokens || 0;
                outputTokens += r.outputTokens || 0;
            }
            return {
                inputTokens,
                outputTokens,
                totalTokens: inputTokens + outputTokens,
                runs: runs.length,
            };
        };
        const calcAggregate = (runs) => ({
            session: calcBucket(runs.filter((r) => new Date(r.timestamp).getTime() >= this.sessionStartTime)),
            today: calcBucket(runs.filter((r) => new Date(r.timestamp).getTime() >= todayStart)),
            last7Days: calcBucket(runs.filter((r) => new Date(r.timestamp).getTime() >= sevenDaysAgo)),
        });
        const agents = {};
        const agentMap = new Map();
        for (const r of this.runs) {
            const arr = agentMap.get(r.agentId) ?? [];
            arr.push(r);
            agentMap.set(r.agentId, arr);
        }
        for (const [id, rList] of agentMap.entries()) {
            agents[id] = calcAggregate(rList);
        }
        const providers = {};
        for (const p of PROVIDER_ORDER) {
            const pRuns = this.runs.filter((r) => r.provider === p);
            providers[p] = calcAggregate(pRuns);
        }
        return {
            agents,
            providers,
            updatedAt: new Date().toISOString(),
        };
    }
}
//# sourceMappingURL=usageTracker.js.map