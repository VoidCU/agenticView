import { useEffect, useState } from "react";
import { PROVIDER_LABELS } from "@agenticview/shared";
import type { LimitsReport, UsageReport, WindowLimit } from "@agenticview/shared";
import { apiFetch } from "../net/ws";
import { timeAgo } from "./ui";

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
  const entries = Object.entries(limits.providers);
  if (entries.length === 0) return <p className="empty">No provider limit data available.</p>;
  return (
    <div className="usage-limits">
      {entries.map(([provider, entry]) => (
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
          {Object.entries(entry.models).length === 0 ? (
            <p className="empty usage-no-models">No model data yet.</p>
          ) : (
            Object.entries(entry.models).map(([model, ml]) => (
              <div key={model} className="usage-model-row">
                <span className="usage-model-name">{model}</span>
                <WindowBar w={ml.fiveHour} label="5h" />
                <WindowBar w={ml.weekly} label="7d" />
              </div>
            ))
          )}
        </details>
      ))}
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
