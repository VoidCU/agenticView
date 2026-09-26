import { useState, type FormEvent } from "react";
import type { Provider } from "@agenticview/shared";
import { useStore } from "../state/store";
import { LimitChip, SwitchProviderModal } from "./LimitChip";
import { UsagePanel } from "./UsagePanel";
import { Modal, ProviderChip, automaticLabel, providerLabel } from "./ui";

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const settings = useStore((s) => s.settings);
  const providers = useStore((s) => s.providers);
  const autoProvider = useStore((s) => s.autoProvider);
  const send = useStore((s) => s.send);
  const world = useStore((s) => s.world);
  const [provider, setProvider] = useState<Provider | "">(settings?.defaultProvider ?? "");
  const [model, setModel] = useState(settings?.defaultModel ?? "");
  const [max, setMax] = useState(settings?.maxConcurrentRuns ?? 3);
  const [limitPolicy, setLimitPolicy] = useState<"ask" | "auto">(settings?.limitPolicy ?? "ask");
  const [loungeBreaks, setLoungeBreaks] = useState(settings?.loungeBreaks ?? true);
  const [tab, setTab] = useState<"settings" | "usage">("settings");
  const [switchProvider, setSwitchProvider] = useState<Provider | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    send({
      type: "settings.update",
      settings: {
        defaultProvider: provider || null,
        defaultModel: model.trim() || null,
        maxConcurrentRuns: Math.min(10, Math.max(1, Math.round(max))),
        limitPolicy,
        loungeBreaks,
      },
    });
    onClose();
  };

  const claude = providers.find((p) => p.provider === "claude");
  return (
    <Modal title={world?.kind === "hub" ? "Hub settings" : "Project settings"} onClose={onClose} wide>
      <div className="settings-tabs">
        <button
          type="button"
          className={`tab ${tab === "settings" ? "tab-on" : ""}`}
          aria-pressed={tab === "settings"}
          onClick={() => setTab("settings")}
        >
          Settings
        </button>
        <button
          type="button"
          className={`tab ${tab === "usage" ? "tab-on" : ""}`}
          aria-pressed={tab === "usage"}
          onClick={() => setTab("usage")}
        >
          Usage &amp; Limits
        </button>
      </div>

      {tab === "settings" && (
        <form className="form" onSubmit={submit}>
          <div className="form-grid">
            <label className="field">
              <span>Default provider</span>
              <select value={provider} onChange={(e) => setProvider(e.target.value as Provider | "")}>
                <option value="">{automaticLabel(autoProvider)}</option>
                {providers.map((p) => (
                  <option key={p.provider} value={p.provider} disabled={!p.ok && p.provider !== "claude-session"} title={p.ok ? undefined : p.reason}>
                    {providerLabel(p.provider)}
                    {p.ok ? "" : p.provider === "claude-session" ? " (no worker yet)" : " (unavailable)"}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Default model</span>
              <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="provider default" autoComplete="off" />
            </label>
            <label className="field">
              <span>Workers running at once</span>
              <input type="number" min={1} max={10} value={max} onChange={(e) => setMax(Number(e.target.value))} />
            </label>
            <label className="field">
              <span>When an agent hits a limit</span>
              <select
                value={limitPolicy}
                onChange={(e) => setLimitPolicy(e.target.value as "ask" | "auto")}
                aria-label="Limit policy"
              >
                <option value="ask">Ask me</option>
                <option value="auto">Switch automatically</option>
              </select>
            </label>
            <label className="field field-toggle">
              <span>Lounge breaks</span>
              <input
                type="checkbox"
                checked={loungeBreaks}
                onChange={(e) => setLoungeBreaks(e.target.checked)}
                aria-label="Lounge breaks"
              />
            </label>
          </div>

          <fieldset className="field-set">
            <legend>Providers on this machine</legend>
            <ul className="provider-list">
              {providers.map((p) => (
                <li key={p.provider} className="provider-list-item">
                  <ProviderChip status={p} />
                  <span className="provider-reason">{p.ok ? "Ready" : p.reason ?? "Unavailable"}</span>
                  {p.limit?.limited && (
                    <LimitChip
                      limit={p.limit}
                      onSwitch={() => setSwitchProvider(p.provider)}
                    />
                  )}
                  {p.limit?.limited && (
                    <button
                      type="button"
                      className="btn btn-xs btn-ghost"
                      onClick={() => setSwitchProvider(p.provider)}
                      aria-label={`Switch all ${providerLabel(p.provider)} agents`}
                    >
                      Switch all agents
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {claude && !claude.ok && (
              <p className="hint">
                The <strong>Claude</strong> provider uses the API: set <code>ANTHROPIC_API_KEY</code> in the environment that starts AgenticView, then reopen the office.
              </p>
            )}
            {claude?.ok && (
              <p className="hint">
                The <strong>Claude</strong> provider uses <code>ANTHROPIC_API_KEY</code> from the environment that started AgenticView.
              </p>
            )}
            <p className="hint">
              On a Claude Max or Pro plan? Use the <strong>Claude Code session</strong> provider: run <code>/agenticview-work</code> in a Claude Code session for this
              project and it picks up queued tasks with its own tools. Open more sessions for more parallel workers.
            </p>
          </fieldset>

          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Save settings
            </button>
          </div>
        </form>
      )}

      {tab === "usage" && <UsagePanel />}

      {switchProvider && (
        <SwitchProviderModal
          fromProvider={switchProvider}
          onClose={() => setSwitchProvider(null)}
        />
      )}
    </Modal>
  );
}
