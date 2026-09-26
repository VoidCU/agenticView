import { useEffect, useRef, useState } from "react";
import { PROVIDER_LABELS } from "@agenticview/shared";
import type { LimitsReport, ProviderModelLimits, UsageReport, WindowLimit } from "@agenticview/shared";
import { apiFetch } from "../net/ws";
import { timeAgo } from "./ui";

/**
 * Formats a future ISO timestamp as a relative "in Xh Ym" string for times within 24 h,
 * or an absolute "Mon 09:00" string for times further out. Used for reset countdowns.
 */
export function formatResetAt(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const diff = Math.max(0, t - now);
  if (diff === 0) return "now";
  const totalMinutes = Math.ceil(diff / 60_000);
  if (totalMinutes < 60) return `in ${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours < 24) return mins > 0 ? `in ${hours}h ${mins}m` : `in ${hours}h`;
  // For longer waits, show weekday + time
  const d = new Date(t);
  const day = d.toLocaleDateString(undefined, { weekday: "short" });
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return `${day} ${time}`;
}

/** A hook that forces a re-render every `ms` milliseconds (for live countdown displays). */
function useTick(ms: number): void {
  const [, setTick] = useState(0);
  const ref = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  useEffect(() => {
    ref.current = setInterval(() => setTick((n) => n + 1), ms);
    return () => clearInterval(ref.current);
  }, [ms]);
}

/** Compact one-line representation of a single rate-limit window (5h or Week). */
export function ClaudeWindowLine({
  w,
  label,
  now,
  isLimited,
}: {
  w: WindowLimit;
  label: string;
  now?: number;
  isLimited?: boolean;
}) {
  if (w.status === "not reported") {
    return (
      <span className="claude-window-line claude-window-nr">
        <span className="claude-window-label">{label}:</span>
        <span className="muted">not reported</span>
      </span>
    );
  }
  const { percentLeft, resetAt, warning } = w;
  const red = isLimited || percentLeft <= 0;
  const cls = red ? "claude-window-red" : warning ? "claude-window-warn" : "";
  const resetStr = resetAt ? formatResetAt(resetAt, now ?? Date.now()) : undefined;
  return (
    <span className={`claude-window-line ${cls}`}>
      <span className="claude-window-label">{label}:</span>
      <span className="claude-window-pct">
        {warning && !red && <span className="claude-window-icon" aria-hidden="true">!</span>}
        {red && <span className="claude-window-icon" aria-hidden="true">!</span>}
        {percentLeft}% left
      </span>
      {resetStr && <span className="claude-window-reset">{resetStr}</span>}
    </span>
  );
}

/** Two-line block for one model's claude-session limits. */
export function ClaudeModelLimits({
  model,
  ml,
  isLimited,
}: {
  model: string;
  ml: ProviderModelLimits;
  isLimited?: boolean;
}) {
  return (
    <div className="claude-model-limits">
      <span className="claude-limits-model">{model}</span>
      <ClaudeWindowLine w={ml.fiveHour} label="5h" isLimited={isLimited} />
      <ClaudeWindowLine w={ml.weekly} label="Week" isLimited={isLimited} />
    </div>
  );
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function WindowBar({ w, label }: { w: WindowLimit; label: string }) {
  if (w.status === "not reported") {
    return (
      <div className="usage-window">
        <span className="usage-window-label">{label}</span>
        <span className="usage-window-val muted">not reported</span>
      </div>
    );
  }
  const pct = w.percentLeft;
  const danger = pct < 10;
  const warn = pct < 25;
  return (
    <div className="usage-window">
      <span className="usage-window-label">{label}</span>
      <div className="usage-bar-wrap">
        <div
          className={`usage-bar ${danger ? "usage-bar-danger" : warn ? "usage-bar-warn" : ""}`}
          style={{ width: `${Math.max(1, pct)}%` }}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${label}: ${pct}% left`}
        />
      </div>
      <span className="usage-window-val">{pct}% left</span>
      {w.resetAt && <span className="usage-window-reset muted">resets {timeAgo(w.resetAt)}</span>}
    </div>
  );
}

function LimitsSection({ limits }: { limits: LimitsReport }) {
  useTick(30_000);
  const entries = Object.entries(limits.providers);
  if (entries.length === 0) return <p className="empty">No provider limit data available.</p>;
  return (
    <div className="usage-limits">
      {entries.map(([provider, entry]) => {
        const isClaudeSession = provider === "claude-session";
        const modelEntries = Object.entries(entry.models);
        const allNotReported =
          modelEntries.length === 0 ||
          modelEntries.every(
            ([, ml]) =>
              ml.fiveHour.status === "not reported" && ml.weekly.status === "not reported",
          );
        return (
          <details key={provider} className="usage-provider-group" open>
            <summary className="usage-provider-summary">
              <span className="usage-provider-name">{PROVIDER_LABELS[provider as keyof typeof PROVIDER_LABELS] ?? provider}</span>
              {entry.limit.limited && (
                <span className={`usage-limited-badge usage-limited-${entry.limit.errorType ?? "crash"}`}>
                  {entry.limit.errorType ?? "limited"}
                  {entry.limit.resetAt && ` · resets ${timeAgo(entry.limit.resetAt)}`}
                </span>
              )}
            </summary>
            {isClaudeSession ? (
              allNotReported ? (
                <p className="empty usage-no-models claude-statusline-hint">
                  not reported — run <code>/agenticview-statusline</code> in your Claude Code session to enable reporting
                </p>
              ) : (
                <div className="usage-claude-session-models">
                  {modelEntries.map(([model, ml]) => (
                    <ClaudeModelLimits key={model} model={model} ml={ml} isLimited={entry.limit.limited} />
                  ))}
                </div>
              )
            ) : (
              modelEntries.length === 0 ? (
                <p className="empty usage-no-models">No model data yet.</p>
              ) : (
                modelEntries.map(([model, ml]) => (
                  <div key={model} className="usage-model-row">
                    <span className="usage-model-name">{model}</span>
                    <WindowBar w={ml.fiveHour} label="5h" />
                    <WindowBar w={ml.weekly} label="7d" />
                  </div>
                ))
              )
            )}
          </details>
        );
      })}
    </div>
  );
}

function UsageSection({ usage }: { usage: UsageReport }) {
  const periods: Array<{ key: keyof typeof usage.agents[string]; label: string }> = [
    { key: "session", label: "Session" },
    { key: "today", label: "Today" },
    { key: "last7Days", label: "7 days" },
  ];

  return (
    <div className="usage-tokens">
      <h3 className="usage-sub-head">By provider</h3>
      <table className="usage-table" aria-label="Provider token usage">
        <thead>
          <tr>
            <th>Provider</th>
            {periods.map((p) => (
              <th key={p.key}>{p.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Object.entries(usage.providers).map(([provider, agg]) => (
            <tr key={provider}>
              <td>{PROVIDER_LABELS[provider as keyof typeof PROVIDER_LABELS] ?? provider}</td>
              {periods.map((p) => (
                <td key={p.key} className="usage-num" title={`${agg[p.key].totalTokens} tokens, ${agg[p.key].runs} runs`}>
                  {fmtTokens(agg[p.key].totalTokens)}
                  <span className="usage-runs"> ({agg[p.key].runs})</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {Object.keys(usage.agents).length > 0 && (
        <>
          <h3 className="usage-sub-head">By agent</h3>
          <table className="usage-table" aria-label="Agent token usage">
            <thead>
              <tr>
                <th>Agent</th>
                {periods.map((p) => (
                  <th key={p.key}>{p.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(usage.agents).map(([agentId, agg]) => (
                <tr key={agentId}>
                  <td className="usage-agent-id" title={agentId}>{agentId}</td>
                  {periods.map((p) => (
                    <td key={p.key} className="usage-num" title={`${agg[p.key].totalTokens} tokens, ${agg[p.key].runs} runs`}>
                      {fmtTokens(agg[p.key].totalTokens)}
                      <span className="usage-runs"> ({agg[p.key].runs})</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

export function UsagePanel() {
  const [limits, setLimits] = useState<LimitsReport | null>(null);
  const [usage, setUsage] = useState<UsageReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [limRes, useRes] = await Promise.all([apiFetch("/api/limits"), apiFetch("/api/usage")]);
      if (!limRes.ok || !useRes.ok) throw new Error("Failed to load data");
      const [lim, use] = await Promise.all([limRes.json() as Promise<LimitsReport>, useRes.json() as Promise<UsageReport>]);
      setLimits(lim);
      setUsage(use);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  if (loading) return <p className="empty">Loading usage data…</p>;
  if (error) return (
    <div>
      <p className="form-error">{error}</p>
      <button type="button" className="btn btn-ghost btn-xs" onClick={() => void load()}>Retry</button>
    </div>
  );

  return (
    <div className="usage-panel">
      {limits && <LimitsSection limits={limits} />}
      {usage && (Object.keys(usage.providers).length > 0 || Object.keys(usage.agents).length > 0) ? (
        <UsageSection usage={usage} />
      ) : (
        <p className="empty">No token usage recorded yet.</p>
      )}
      <button type="button" className="btn btn-ghost btn-xs usage-refresh" onClick={() => void load()}>
        Refresh
      </button>
    </div>
  );
}
