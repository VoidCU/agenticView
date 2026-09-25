import { useState } from "react";
import { EFFORT_LABELS, PROVIDER_LABELS, type Provider } from "@agenticview/shared";
import type { LimitInfo } from "@agenticview/shared";
import { apiFetch } from "../net/ws";
import { Modal } from "./ui";
import { timeAgo } from "./ui";

export type { LimitInfo };

const ERROR_TYPE_LABEL: Record<string, string> = {
  quota: "Quota hit",
  "rate-limit": "Rate limited",
  auth: "Auth error",
  crash: "Crashed",
};

const ERROR_TYPE_CLASS: Record<string, string> = {
  quota: "chip-limit-quota",
  "rate-limit": "chip-limit-rate",
  auth: "chip-limit-auth",
  crash: "chip-limit-crash",
};

/** A small chip that appears when an agent (or provider) is limited. */
export function LimitChip({
  limit,
  onSwitch,
}: {
  limit: LimitInfo | undefined;
  onSwitch?: () => void;
}) {
  if (!limit?.limited) return null;
  const label = ERROR_TYPE_LABEL[limit.errorType ?? "crash"] ?? "Limited";
  const cls = ERROR_TYPE_CLASS[limit.errorType ?? "crash"] ?? "chip-limit-crash";
  const resetLabel = limit.resetAt ? `resets ${timeAgo(limit.resetAt)}` : undefined;

  return (
    <span className={`chip chip-limit ${cls}`} title={limit.reason ?? label}>
      <span className="chip-dot" aria-hidden="true" />
      {label}
      {resetLabel && <span className="chip-limit-reset">{resetLabel}</span>}
      {onSwitch && (
        <button
          type="button"
          className="chip-limit-switch"
          onClick={(e) => {
            e.stopPropagation();
            onSwitch();
          }}
          aria-label="Switch provider or model"
        >
          Switch
        </button>
      )}
    </span>
  );
}

// ---------- Switch agent modal ----------

interface SwitchAgentModalProps {
  agentId: string;
  agentName: string;
  currentProvider: Provider | null;
  currentModel: string | null;
  onClose: () => void;
}

export function SwitchAgentModal({ agentId, agentName, currentProvider, currentModel, onClose }: SwitchAgentModalProps) {
  const providers = Object.keys(PROVIDER_LABELS) as Provider[];
  const [provider, setProvider] = useState<Provider | "">(currentProvider ?? "");
  const [model, setModel] = useState(currentModel ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/agents/${agentId}/switch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: provider || null, model: model.trim() || null }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? res.statusText);
      }
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Switch ${agentName}`} onClose={onClose}>
      <div className="form">
        <div className="form-grid">
          <label className="field">
            <span>Provider</span>
            <select value={provider} onChange={(e) => setProvider(e.target.value as Provider | "")}>
              <option value="">Keep current ({currentProvider ?? "auto"})</option>
              {providers.map((p) => (
                <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Model</span>
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="provider default"
              autoComplete="off"
            />
          </label>
        </div>
        {error && <p className="form-error">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>
            {busy ? "Switching…" : "Switch"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ---------- Switch all agents on provider modal ----------

interface SwitchProviderModalProps {
  fromProvider: Provider;
  onClose: () => void;
}

export function SwitchProviderModal({ fromProvider, onClose }: SwitchProviderModalProps) {
  const providers = (Object.keys(PROVIDER_LABELS) as Provider[]).filter((p) => p !== fromProvider);
  const [toProvider, setToProvider] = useState<Provider>(providers[0] ?? "claude");
  const [toModel, setToModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/providers/${fromProvider}/switch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toProvider, toModel: toModel.trim() || null }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? res.statusText);
      }
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Switch all ${PROVIDER_LABELS[fromProvider]} agents`} onClose={onClose}>
      <div className="form">
        <p className="hint">Move every agent currently on <strong>{PROVIDER_LABELS[fromProvider]}</strong> to a new provider.</p>
        <div className="form-grid">
          <label className="field">
            <span>New provider</span>
            <select value={toProvider} onChange={(e) => setToProvider(e.target.value as Provider)}>
              {providers.map((p) => (
                <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Model (optional)</span>
            <input
              value={toModel}
              onChange={(e) => setToModel(e.target.value)}
              placeholder="provider default"
              autoComplete="off"
            />
          </label>
        </div>
        {error && <p className="form-error">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>
            {busy ? "Switching…" : "Switch all"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Retry a failed task. Returns a promise that resolves when the request completes. */
export async function retryTask(taskId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await apiFetch(`/api/tasks/${taskId}/retry`, { method: "POST" });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: j.error ?? res.statusText };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** A small inline "Retry" button for failed tasks. */
export function RetryButton({ taskId, taskTitle }: { taskId: string; taskTitle: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleRetry = async () => {
    setBusy(true);
    setErr(null);
    const result = await retryTask(taskId);
    setBusy(false);
    if (!result.ok) setErr(result.error ?? "Failed to retry");
  };

  return (
    <span className="retry-wrap">
      <button
        type="button"
        className="btn btn-xs btn-ghost retry-btn"
        onClick={handleRetry}
        disabled={busy}
        aria-label={`Retry ${taskTitle}`}
        title={err ?? undefined}
      >
        {busy ? "Retrying…" : err ? "Retry (failed)" : "Retry"}
      </button>
    </span>
  );
}
