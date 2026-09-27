import { Fragment, useEffect, useRef, useState } from "react";
import { providerLabelOf } from "@agenticview/shared";
import type { LimitsReport, ProviderModelLimits, TokenUsageBucket, UsageAggregate, UsageReport, WindowLimit } from "@agenticview/shared";
import { apiFetch } from "../net/ws";
import { useStore } from "../state/store";

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

const PERIODS = [
  { key: "session", label: "Session" },
  { key: "today", label: "Today" },
  { key: "last7Days", label: "7 days" },
] as const;

const NUM = new Intl.NumberFormat();
/** "12,345" (locale thousands separators). */
export function fmtNum(n: number): string {
  return NUM.format(Math.round(n));
}

/** Providers whose plan windows (5h / weekly) can be reported: Codex per turn, Claude Code sessions via the statusline. */
const WINDOW_PROVIDERS = ["codex", "claude-session"] as const;

/** A labelled plan-window bar: "% left", reset time, colour by headroom. */
export function PlanWindow({ w, label, limited }: { w: WindowLimit; label: string; limited?: boolean }) {
  if (w.status === "not reported") {
    return (
      <div className="plan-window plan-window-nr">
        <span className="plan-window-label">{label}</span>
        <span className="plan-window-na">not reported</span>
      </div>
    );
  }
  const pct = w.percentLeft;
  const tone = limited || pct <= 0 ? "danger" : pct < 10 ? "danger" : pct < 25 ? "warn" : "ok";
  const reset = w.resetAt ? formatResetAt(w.resetAt) : "";
  return (
    <div className={`plan-window plan-${tone}`}>
      <span className="plan-window-label">{label}</span>
      <div
        className="plan-bar"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label}: ${pct}% left${reset ? `, resets ${reset}` : ""}`}
      >
        <div className="plan-bar-fill" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
      </div>
      <span className="plan-window-pct">{pct}% left</span>
      <span className="plan-window-reset">{reset ? `resets ${reset}` : ""}</span>
    </div>
  );
}

function PlanLimits({ limits }: { limits: LimitsReport }) {
  useTick(30_000);
  const limitedOthers = Object.entries(limits.providers).filter(([p, e]) => !(WINDOW_PROVIDERS as readonly string[]).includes(p) && e.limit.limited);
  return (
    <section className="settings-section usage-plan" aria-labelledby="usage-plan-head">
      <header>
        <h3 id="usage-plan-head">Plan limits</h3>
        <p className="section-desc">
          Rolling 5-hour and weekly windows, as the provider reports them. Other providers only show a limit when a run hits one.
        </p>
      </header>
      {WINDOW_PROVIDERS.map((p) => {
        const entry = limits.providers[p];
        const models = Object.entries(entry?.models ?? {});
        const limited = entry?.limit.limited;
        return (
          <div key={p} className="plan-provider">
            <div className="plan-provider-head">
              <h4>{providerLabelOf(p)}</h4>
              {limited && (
                <span className={`usage-limited-badge usage-limited-${entry!.limit.errorType ?? "crash"}`}>
                  {entry!.limit.errorType ?? "limited"}
                  {entry!.limit.resetAt && ` · resets ${formatResetAt(entry!.limit.resetAt)}`}
                </span>
              )}
            </div>
            {models.length === 0 ? (
              <p className="plan-empty">
                {p === "claude-session" ? (
                  <>
                    Not reported yet: run <code>/agenticview-statusline</code> in your Claude Code session to report its plan windows.
                  </>
                ) : (
                  "Not reported yet: Codex reports its windows after its next run."
                )}
              </p>
            ) : (
              models.map(([model, ml]) => (
                <div key={model} className="plan-model">
                  <span className="plan-model-name">{model}</span>
                  <PlanWindow w={ml.fiveHour} label="5 hours" limited={limited} />
                  <PlanWindow w={ml.weekly} label="Weekly" limited={limited} />
                </div>
              ))
            )}
          </div>
        );
      })}
      {limitedOthers.length > 0 && (
        <ul className="plan-others">
          {limitedOthers.map(([p, e]) => (
            <li key={p}>
              <strong>{providerLabelOf(p)}</strong>{" "}
              <span className={`usage-limited-badge usage-limited-${e.limit.errorType ?? "crash"}`}>
                {e.limit.errorType ?? "limited"}
                {e.limit.resetAt && ` · resets ${formatResetAt(e.limit.resetAt)}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

interface UsageRow {
  key: string;
  name: string;
  sub?: string;
  agg: UsageAggregate;
}

function sumRows(rows: UsageRow[]): UsageAggregate {
  const zero = () => ({ inputTokens: 0, outputTokens: 0, totalTokens: 0, runs: 0 });
  const out: UsageAggregate = { session: zero(), today: zero(), last7Days: zero() };
  for (const r of rows) {
    for (const { key } of PERIODS) {
      out[key].inputTokens += r.agg[key].inputTokens;
      out[key].outputTokens += r.agg[key].outputTokens;
      out[key].totalTokens += r.agg[key].totalTokens;
      out[key].runs += r.agg[key].runs;
    }
  }
  return out;
}

/** In/out tokens for Session / Today / 7 days, right-aligned, with a totals row. */
export function UsageTable({ title, rows, nameHead }: { title: string; rows: UsageRow[]; nameHead: string }) {
  const total = sumRows(rows);
  const cell = (b: TokenUsageBucket, k: "inputTokens" | "outputTokens") => (
    <td className="num" title={`${fmtNum(b.inputTokens + b.outputTokens)} tokens in ${fmtNum(b.runs)} run${b.runs === 1 ? "" : "s"}`}>
      {b.runs === 0 ? <span className="num-zero">–</span> : fmtNum(b[k])}
    </td>
  );
  return (
    <div className="usage-table-wrap">
      <table className="usage-grid" aria-label={title}>
        <thead>
          <tr>
            <th scope="col" rowSpan={2} className="usage-name-col">
              {nameHead}
            </th>
            {PERIODS.map((p) => (
              <th key={p.key} scope="colgroup" colSpan={2} className="usage-period">
                {p.label}
              </th>
            ))}
          </tr>
          <tr>
            {PERIODS.map((p) => (
              <Fragment key={p.key}>
                <th scope="col" className="num">
                  In
                </th>
                <th scope="col" className="num">
                  Out
                </th>
              </Fragment>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <th scope="row" className="usage-name">
                <span>{r.name}</span>
                {r.sub && <span className="usage-sub">{r.sub}</span>}
              </th>
              {PERIODS.map((p) => (
                <Fragment key={p.key}>
                  {cell(r.agg[p.key], "inputTokens")}
                  {cell(r.agg[p.key], "outputTokens")}
                </Fragment>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Total</th>
            {PERIODS.map((p) => (
              <Fragment key={p.key}>
                <td className="num">{fmtNum(total[p.key].inputTokens)}</td>
                <td className="num">{fmtNum(total[p.key].outputTokens)}</td>
              </Fragment>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

const hasRuns = (agg: UsageAggregate) => agg.last7Days.runs > 0 || agg.session.runs > 0;

/** Rows for the per-agent and per-provider/model tables (only entries with runs in the last 7 days). */
export function usageRows(usage: UsageReport, agentName: (id: string) => string | undefined): { agents: UsageRow[]; models: UsageRow[] } {
  const agents = Object.entries(usage.agents)
    .filter(([, agg]) => hasRuns(agg))
    .map(([id, agg]) => ({ key: id, name: agentName(id) ?? id, sub: agentName(id) ? undefined : "removed agent", agg }))
    .sort((a, b) => b.agg.last7Days.totalTokens - a.agg.last7Days.totalTokens);
  const models: UsageRow[] = usage.models
    ? usage.models
        .filter((m) => hasRuns(m.usage))
        .map((m) => ({ key: `${m.provider}|${m.model}`, name: providerLabelOf(m.provider), sub: m.model === "default" ? "provider default" : m.model, agg: m.usage }))
    : Object.entries(usage.providers)
        .filter(([, agg]) => hasRuns(agg))
        .map(([p, agg]) => ({ key: p, name: providerLabelOf(p), agg }));
  models.sort((a, b) => b.agg.last7Days.totalTokens - a.agg.last7Days.totalTokens);
  return { agents, models };
}

type AutoRefresh = "off" | "30s";

export function UsagePanel() {
  const agents = useStore((s) => s.agents);
  const [limits, setLimits] = useState<LimitsReport | null>(null);
  const [usage, setUsage] = useState<UsageReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [auto, setAuto] = useState<AutoRefresh>("off");

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [limRes, useRes] = await Promise.all([apiFetch("/api/limits"), apiFetch("/api/usage")]);
      if (!limRes.ok || !useRes.ok) throw new Error("Could not load usage data from the office server.");
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
  useEffect(() => {
    if (auto === "off") return;
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [auto]);

  const rows = usage ? usageRows(usage, (id) => agents[id]?.name) : { agents: [], models: [] };
  const empty = rows.agents.length === 0 && rows.models.length === 0;

  return (
    <div className="usage-panel">
      <div className="usage-toolbar">
        <span className="usage-updated" aria-live="polite">
          {loading ? "Loading…" : usage ? `Updated ${new Date(usage.updatedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : ""}
        </span>
        <label className="usage-auto">
          <span>Auto-refresh</span>
          <select value={auto} onChange={(e) => setAuto(e.target.value as AutoRefresh)} aria-label="Auto-refresh">
            <option value="off">Off</option>
            <option value="30s">Every 30 s</option>
          </select>
        </label>
        <button type="button" className="btn btn-ghost btn-sm usage-refresh" onClick={() => void load()} disabled={loading}>
          Refresh
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {limits && <PlanLimits limits={limits} />}
      <section className="settings-section" aria-labelledby="usage-tokens-head">
        <header>
          <h3 id="usage-tokens-head">Tokens</h3>
          <p className="section-desc">Input and output tokens per run as the provider reports them. Session = since this office started.</p>
        </header>
        {usage && empty && <p className="empty-note">No token usage recorded yet. Numbers appear after an agent finishes its first run.</p>}
        {!usage && !loading && !error && <p className="empty-note">No usage data.</p>}
        {rows.models.length > 0 && <UsageTable title="Token usage by provider and model" nameHead="Provider / model" rows={rows.models} />}
        {rows.agents.length > 0 && <UsageTable title="Token usage by agent" nameHead="Agent" rows={rows.agents} />}
      </section>
    </div>
  );
}
